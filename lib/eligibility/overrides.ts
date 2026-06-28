// Biller manual override persistence (see manual_override_requirements.md).
// Additive layer: never touches the raw PCC tables, never mutates engine.ts
// output — just an upsertable {patient_id -> decision/note} side table.

import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { Decision, DecisionOverride } from "../types";

export async function setOverride(
  patientId: string,
  decision: Decision,
  note: string | null
): Promise<DecisionOverride> {
  const [row] = await db
    .insert(schema.decisionOverrides)
    .values({ patientId, decision, note })
    .onConflictDoUpdate({
      target: schema.decisionOverrides.patientId,
      set: { decision, note, overriddenAt: new Date() },
    })
    .returning();
  return {
    decision: row.decision as Decision,
    note: row.note,
    overridden_at: row.overriddenAt!.toISOString(),
  };
}

export async function clearOverride(patientId: string): Promise<void> {
  await db.delete(schema.decisionOverrides).where(eq(schema.decisionOverrides.patientId, patientId));
}

/** All current overrides, keyed by patient_id, for merging into computeEligibility(). */
export async function getOverridesMap(): Promise<Map<string, DecisionOverride>> {
  const rows = await db.select().from(schema.decisionOverrides);
  const map = new Map<string, DecisionOverride>();
  for (const r of rows) {
    map.set(r.patientId, {
      decision: r.decision as Decision,
      note: r.note,
      overridden_at: r.overriddenAt!.toISOString(),
    });
  }
  return map;
}
