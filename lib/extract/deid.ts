// PHI core: de-identification. Tokenize identifiers OUT of clinical text before
// it ever reaches an LLM, then restore them locally afterward. Used by the LLM
// extractor (Person 2) and reusable by Person 1's summary generator.
//
// Rule: clinical content (wound type, measurements, drainage) stays; anything
// that identifies a person (name, DOB, patient/MRN ids, clinician names, dates)
// becomes an opaque placeholder. Round-trips: reidentify(deidentify(x)) === x.

import type { Patient } from "../types";

export interface DeidResult {
  text: string;
  /** placeholder -> original value, for local restoration */
  map: Record<string, string>;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip identifiers from clinical text. Pass the patient record to also remove
 * that patient's known name / id / DOB even when they appear inline.
 */
export function deidentify(text: string, patient?: Partial<Patient>): DeidResult {
  let out = text ?? "";
  const map: Record<string, string> = {};
  let counters: Record<string, number> = {};

  const token = (kind: string, value: string): string => {
    // Reuse a placeholder if we've already seen this exact value.
    const existing = Object.entries(map).find(([, v]) => v === value);
    if (existing) return existing[0];
    counters[kind] = (counters[kind] ?? 0) + 1;
    const ph = `[${kind}_${counters[kind]}]`;
    map[ph] = value;
    return ph;
  };

  const replaceLiteral = (value: string | null | undefined, kind: string) => {
    if (!value) return;
    const re = new RegExp(`\\b${escapeRe(value)}\\b`, "g");
    out = out.replace(re, () => token(kind, value));
  };

  // 1. Known identifiers for this patient (most reliable).
  replaceLiteral(patient?.first_name, "NAME");
  replaceLiteral(patient?.last_name, "NAME");
  replaceLiteral(patient?.patient_id, "ID");
  replaceLiteral(patient?.birth_date, "DATE");

  // 2. Generic patterns.
  // PCC patient ids like FA-001 / FB-123.
  out = out.replace(/\b[A-Z]{2}-\d{2,4}\b/g, (m) => token("ID", m));
  // Clinician names: "RN Smith", "Dr. Jones", "Dr Patel", "NP Garcia".
  out = out.replace(/\b(?:RN|MD|NP|LPN|Dr\.?|PA)\s+[A-Z][a-z]+\b/g, (m) => token("NAME", m));
  // ISO dates and US dates.
  out = out.replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:]+)?\b/g, (m) => token("DATE", m));
  out = out.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, (m) => token("DATE", m));
  // MRN / record numbers.
  out = out.replace(/\b(?:MRN|Record)\s*#?\s*\d+\b/gi, (m) => token("ID", m));

  return { text: out, map };
}

/** Restore identifiers from a de-identified string using its map. */
export function reidentify(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [ph, value] of Object.entries(map)) {
    out = out.split(ph).join(value);
  }
  return out;
}
