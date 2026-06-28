// Biller manual override persistence (see manual_override_requirements.md).
// Additive layer: never touches the raw PCC tables, never mutates engine.ts
// output — just an upsertable {(patient_id, wound_index) -> decision/note} table.
// woundIndex = position in that patient's wounds[] array (0 = primary).

import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { Decision, DecisionOverride } from "../types";

export async function setOverride(
  patientId: string,
  woundIndex: number,
  decision: Decision,
  note: string | null
): Promise<DecisionOverride> {
  const [row] = await db
    .insert(schema.decisionOverrides)
    .values({ patientId, woundIndex, decision, note })
    .onConflictDoUpdate({
      target: [schema.decisionOverrides.patientId, schema.decisionOverrides.woundIndex],
      set: { decision, note, overriddenAt: new Date() },
    })
    .returning();
  return {
    decision: row.decision as Decision,
    note: row.note,
    overridden_at: row.overriddenAt!.toISOString(),
  };
}

export async function clearOverride(patientId: string, woundIndex: number): Promise<void> {
  await db
    .delete(schema.decisionOverrides)
    .where(
      and(eq(schema.decisionOverrides.patientId, patientId), eq(schema.decisionOverrides.woundIndex, woundIndex))
    );
}

/** All current overrides: patient_id -> wound_index -> override, for merging into computeEligibility(). */
export async function getOverridesMap(): Promise<Map<string, Map<number, DecisionOverride>>> {
  const rows = await db.select().from(schema.decisionOverrides);
  const map = new Map<string, Map<number, DecisionOverride>>();
  for (const r of rows) {
    const byIndex = map.get(r.patientId) ?? new Map<number, DecisionOverride>();
    byIndex.set(r.woundIndex, {
      decision: r.decision as Decision,
      note: r.note,
      overridden_at: r.overriddenAt!.toISOString(),
    });
    map.set(r.patientId, byIndex);
  }
  return map;
}
