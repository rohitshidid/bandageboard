// Joins stored raw rows into EligibilityResult[]. This is the server-side glue
// between Person 1 (data + rules) and the API boundary. PHI never leaves here
// un-masked — only EligibilityResult fields are returned.

import { db, schema } from "../db/client";
import { extractWound, extractWounds, extractWoundAsync, type Source } from "../extract";
import { buildResult, decideWound } from "./engine";
import { getOverridesMap } from "./overrides";
import type {
  Assessment,
  Coverage,
  Decision,
  Diagnosis,
  EligibilityResult,
  ExtractedWound,
  Note,
  Patient,
} from "../types";

function rowToPatient(r: typeof schema.patients.$inferSelect): Patient {
  return {
    id: r.id,
    patient_id: r.patientId,
    facility_id: r.facilityId,
    first_name: r.firstName,
    last_name: r.lastName,
    birth_date: r.birthDate,
    gender: r.gender,
    primary_payer_code: r.primaryPayerCode,
    last_modified_at: r.lastModifiedAt ? r.lastModifiedAt.toISOString() : null,
    is_new_admission: r.isNewAdmission ?? false,
  };
}

/** Text of the most recently dated note/assessment (by effective/assessment date). */
function latestWoundText(notes: Note[], assessments: Assessment[]): string | null {
  const dateOf = (d: string | null) => (d ? Date.parse(d) : -Infinity);
  const docs = [
    ...notes.map((n) => ({ time: dateOf(n.effective_date), text: n.note_text })),
    ...assessments.map((a) => ({ time: dateOf(a.assessment_date), text: a.raw_json })),
  ].filter((d) => d.text);
  if (docs.length === 0) return null;
  docs.sort((a, b) => b.time - a.time);
  return docs[0].text;
}

function woundsDisagree(a: ExtractedWound | null, b: ExtractedWound | null): boolean {
  if (!a || !b) return false;
  if (a.wound_type && b.wound_type && a.wound_type !== b.wound_type) return true;
  const off = (x: number | null, y: number | null) =>
    x != null && y != null && Math.abs(x - y) > 0.5; // >0.5cm apart
  return off(a.length_cm, b.length_cm) || off(a.width_cm, b.width_cm) || off(a.depth_cm, b.depth_cm);
}

const woundArea = (w: ExtractedWound) => (w.length_cm ?? 0) * (w.width_cm ?? 0);

const closeDim = (a: number | null, b: number | null) =>
  a == null || b == null || Math.abs(a - b) <= 1.0; // within 1cm = "same"

/** Two extractions describe the SAME physical wound. */
function sameWound(a: ExtractedWound, b: ExtractedWound): boolean {
  if (a.wound_type && b.wound_type && a.wound_type !== b.wound_type) return false;
  return closeDim(a.length_cm, b.length_cm) && closeDim(a.width_cm, b.width_cm);
}

/**
 * Collapse the same wound seen across a note + an assessment (different wording
 * but same type and similar size) into one, keeping the highest-confidence copy.
 * Genuinely distinct wounds (different type, or sizes >1cm apart) stay separate.
 */
function dedupeWounds(wounds: ExtractedWound[]): ExtractedWound[] {
  const clusters: ExtractedWound[] = [];
  for (const w of wounds) {
    const hit = clusters.findIndex((c) => sameWound(c, w));
    if (hit === -1) clusters.push(w);
    else if (w.confidence > clusters[hit].confidence) clusters[hit] = w;
  }
  return clusters.sort((a, b) => woundArea(b) - woundArea(a));
}

export interface EligibilityFilters {
  facility?: number;
  decision?: Decision;
  payer?: string; // matches primary_payer_code
}

/** Compute eligibility for every stored patient, newest data wins. */
export async function computeEligibility(
  filters: EligibilityFilters = {}
): Promise<EligibilityResult[]> {
  // Pull everything once and group in memory (300 patients — cheap).
  const [pats, diags, covs, nts, asmts, overrides] = await Promise.all([
    db.select().from(schema.patients),
    db.select().from(schema.diagnoses),
    db.select().from(schema.coverage),
    db.select().from(schema.notes),
    db.select().from(schema.assessments),
    getOverridesMap(),
  ]);

  const byStr = <T extends { patientId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.patientId) ?? m.set(r.patientId, []).get(r.patientId)!).push(r);
    return m;
  };
  const byInt = <T extends { patientId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) (m.get(r.patientId) ?? m.set(r.patientId, []).get(r.patientId)!).push(r);
    return m;
  };

  const diagsBy = byStr(diags);
  const covsBy = byStr(covs);
  const notesBy = byInt(nts);
  const asmtsBy = byInt(asmts);

  const results: EligibilityResult[] = [];

  for (const pr of pats) {
    const patient = rowToPatient(pr);
    if (filters.facility && patient.facility_id !== filters.facility) continue;
    if (filters.payer && patient.primary_payer_code !== filters.payer) continue;

    const coverage: Coverage[] = (covsBy.get(patient.patient_id) ?? []).map((c) => ({
      id: c.id,
      patient_id: c.patientId,
      payer_name: c.payerName,
      payer_code: c.payerCode,
      payer_type: c.payerType,
      effective_from: c.effectiveFrom ? c.effectiveFrom.toISOString() : null,
      effective_to: c.effectiveTo ? c.effectiveTo.toISOString() : null,
    }));

    const diagnoses: Diagnosis[] = (diagsBy.get(patient.patient_id) ?? []).map((d) => ({
      id: d.id,
      patient_id: d.patientId,
      icd10_code: d.icd10Code,
      icd10_description: d.icd10Description,
      clinical_status: d.clinicalStatus,
      onset_date: d.onsetDate,
    }));

    const patientNotes: Note[] = (notesBy.get(patient.id) ?? []).map((n) => ({
      id: n.id,
      patient_id: n.patientId,
      note_type: n.noteType,
      effective_date: n.effectiveDate ? n.effectiveDate.toISOString() : null,
      note_text: n.noteText,
    }));

    const patientAsmts: Assessment[] = (asmtsBy.get(patient.id) ?? []).map((a) => ({
      id: a.id,
      patient_id: a.patientId,
      assessment_type: a.assessmentType,
      assessment_date: a.assessmentDate,
      raw_json: a.rawJson,
    }));

    // Extract ALL wounds across every source, then dedupe (a wound may appear
    // in both a note and an assessment). Primary = largest area.
    const asmtSources: Source[] = patientAsmts.map((a) => ({ kind: "assessment", data: a }));
    const noteSources: Source[] = patientNotes.map((n) => ({ kind: "note", data: n }));
    const allWounds = dedupeWounds([
      ...asmtSources.flatMap((s) => extractWounds(s)),
      ...noteSources.flatMap((s) => extractWounds(s)),
    ]);

    // Optional LLM upgrade of the primary for hard narratives (de-identified).
    const useLLM = process.env.EXTRACT_USE_LLM === "true";
    let primary = allWounds[0] ?? null;
    if (useLLM && (!primary || primary.confidence < 0.75)) {
      for (const s of [...asmtSources, ...noteSources]) {
        const better = await extractWoundAsync(s);
        if (better && better.source === "note_llm") {
          primary = better;
          if (!allWounds.length) allWounds.push(better);
          else allWounds[0] = better;
          break;
        }
      }
    }

    // Per-wound claim status.
    const wounds = allWounds.map((w) => decideWound(patient, coverage, diagnoses, w));
    const multiple_wounds = allWounds.length > 1;

    // Conflict between the best note and best assessment wound -> primary flags.
    const bestAsmt = asmtSources.flatMap((s) => extractWounds(s))[0] ?? null;
    const bestNote = noteSources.flatMap((s) => extractWounds(s))[0] ?? null;
    const conflict = woundsDisagree(bestAsmt, bestNote);
    const hadClinicalSource = patientNotes.length > 0 || patientAsmts.length > 0;

    const result = buildResult({
      patient,
      coverage,
      diagnoses,
      hadClinicalSource,
      conflict,
      latestWoundText: latestWoundText(patientNotes, patientAsmts),
      wound: primary, wounds, multiple_wounds,
    });

    // Biller manual override (see manual_override_requirements.md): the override
    // decision/note become the EFFECTIVE decision/reason; the system's own
    // decision/reason are preserved alongside, never overwritten.
    const override = overrides.get(patient.patient_id);
    if (override) {
      result.system_decision = result.decision;
      result.system_reason = result.reason;
      result.override = override;
      result.decision = override.decision;
      result.reason = override.note ?? `Overridden by biller to ${override.decision}.`;
    }

    if (filters.decision && result.decision !== filters.decision) continue;
    results.push(result);
  }

  return results;
}
