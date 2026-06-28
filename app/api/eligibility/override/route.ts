// POST /api/eligibility/override — biller manually sets a patient's decision.
// DELETE /api/eligibility/override?patient_id=FA-001 — clears it, reverting to
// the system decision. See manual_override_requirements.md.
//
// Additive layer only: never touches the rules engine or raw PCC tables.

import { NextRequest, NextResponse } from "next/server";
import { setOverride, clearOverride } from "@/lib/eligibility/overrides";
import type { Decision } from "@/lib/types";

export const dynamic = "force-dynamic";

const DECISIONS: Decision[] = ["auto_accept", "flag_for_review", "reject"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const patient_id = String(body?.patient_id ?? "");
    const decision = body?.decision as Decision;
    const note = body?.note ? String(body.note) : null;

    if (!patient_id || !DECISIONS.includes(decision)) {
      return NextResponse.json(
        { error: "patient_id and a valid decision (auto_accept|flag_for_review|reject) are required" },
        { status: 400 }
      );
    }

    const override = await setOverride(patient_id, decision, note);
    return NextResponse.json({ patient_id, ...override });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const patient_id = req.nextUrl.searchParams.get("patient_id");
    if (!patient_id) {
      return NextResponse.json({ error: "patient_id query param is required" }, { status: 400 });
    }
    await clearOverride(patient_id);
    return NextResponse.json({ patient_id, cleared: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
