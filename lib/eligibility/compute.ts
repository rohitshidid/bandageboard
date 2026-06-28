// Joins stored raw rows into EligibilityResult[]. This is the server-side glue
// between Person 1 (data + rules) and the API boundary. PHI never leaves here
// un-masked — only EligibilityResult fields are returned.

import { db, schema } from "../db/client";
import { extractWound, extractWoundAsync, type Source } from "../extract";
import { buildResult } from "./engine";
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

function woundsDisagree(a: ExtractedWound | null, b: ExtractedWound | null): boolean {
  if (!a || !b) return false;
  if (a.wound_type && b.wound_type && a.wound_type !== b.wound_type) return true;
  const off = (x: number | null, y: number | null) =>
    x != null && y != null && Math.abs(x - y) > 0.5; // >0.5cm apart
  return off(a.length_cm, b.length_cm) || off(a.width_cm, b.width_cm) || off(a.depth_cm, b.depth_cm);
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
  const [pats, diags, covs, nts, asmts] = await Promise.all([
    db.select().from(schema.patients),
    db.select().from(schema.diagnoses),
    db.select().from(schema.coverage),
    db.select().from(schema.notes),
    db.select().from(schema.assessments),
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

    // Prefer assessment (cleanest). Also extract a note to detect conflicts.
    // EXTRACT_USE_LLM=true routes hard narratives through the LLM (de-identified);
    // default off keeps the per-request path deterministic, fast, and free.
    const useLLM = process.env.EXTRACT_USE_LLM === "true";
    const pick = async (sources: Source[]) => {
      for (const s of sources) {
        const w = useLLM ? await extractWoundAsync(s) : extractWound(s);
        if (w) return w;
      }
      return null;
    };
    const fromAsmt = await pick(patientAsmts.map((a) => ({ kind: "assessment", data: a })));
    const fromNote = await pick(patientNotes.map((n) => ({ kind: "note", data: n })));

    const wound = fromAsmt ?? fromNote;
    const conflict = woundsDisagree(fromAsmt, fromNote);
    const hadClinicalSource = patientNotes.length > 0 || patientAsmts.length > 0;

    const result = buildResult({ patient, coverage, diagnoses, wound, hadClinicalSource, conflict });
    if (filters.decision && result.decision !== filters.decision) continue;
    results.push(result);
  }

  return results;
}
