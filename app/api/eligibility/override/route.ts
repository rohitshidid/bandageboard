// POST /api/eligibility/override — biller manually sets a single wound's decision.
// DELETE /api/eligibility/override?patient_id=FA-001&wound_index=0 — clears it,
// reverting that wound to the system decision. See manual_override_requirements.md.
//
// wound_index = position in that patient's wounds[] array (0 = primary).
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
    const wound_index = Number(body?.wound_index);
    const decision = body?.decision as Decision;
    const note = body?.note ? String(body.note) : null;

    if (!patient_id || !Number.isInteger(wound_index) || wound_index < 0 || !DECISIONS.includes(decision)) {
      return NextResponse.json(
        {
          error:
            "patient_id, a non-negative integer wound_index, and a valid decision (auto_accept|flag_for_review|reject) are required",
        },
        { status: 400 }
      );
    }

    const override = await setOverride(patient_id, wound_index, decision, note);
    return NextResponse.json({ patient_id, wound_index, ...override });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const patient_id = req.nextUrl.searchParams.get("patient_id");
    const wound_index = Number(req.nextUrl.searchParams.get("wound_index"));
    if (!patient_id || !Number.isInteger(wound_index) || wound_index < 0) {
      return NextResponse.json(
        { error: "patient_id and a non-negative integer wound_index query param are required" },
        { status: 400 }
      );
    }
    await clearOverride(patient_id, wound_index);
    return NextResponse.json({ patient_id, wound_index, cleared: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
