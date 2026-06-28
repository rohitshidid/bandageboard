// /api/sync
//   POST ?reset=1            -> start a fresh full sync (cursor back to facility 0).
//   POST                     -> process the NEXT batch; UI loops until allDone.
//   GET                      -> { lastSyncAt } for the UI.
//   GET ?facility=101&limit= -> Vercel Cron: one resumable slice.
// Chunked + resumable so no single request has to load all 300 patients. The PCC
// client retries 429/5xx until the API responds. Optional SYNC_SECRET protects it.

import { NextRequest, NextResponse } from "next/server";
import { syncSlice, syncNextBatch, resetSyncCursors, getLastSync } from "@/lib/ingest/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return true;
  return req.headers.get("x-sync-secret") === secret || req.nextUrl.searchParams.get("secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const sp = req.nextUrl.searchParams;
    if (sp.get("reset") === "1") await resetSyncCursors();
    const batch = sp.get("batch") ? Number(sp.get("batch")) : 20;
    const result = await syncNextBatch(batch);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;

  // Cron mode: a single resumable slice for one facility.
  if (sp.get("facility")) {
    const facility = Number(sp.get("facility"));
    if (![101, 102, 103].includes(facility)) {
      return NextResponse.json({ error: "facility must be 101, 102, or 103" }, { status: 422 });
    }
    try {
      const result = await syncSlice({
        facilityId: facility,
        limit: sp.get("limit") ? Number(sp.get("limit")) : 25,
        since: sp.get("since") ?? undefined,
      });
      return NextResponse.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json({ lastSyncAt: await getLastSync() });
}
