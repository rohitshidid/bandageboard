// Deterministic wound extraction (no network). Handles the shapes the PCC API
// actually returns:
//   - assessment raw_json: nested {sections:[{questions:[{question,answer}]}]}
//   - assessment "Wound narrative" free text
//   - assessment flat {wound_type, length_cm, ...} (docs/fixtures)
//   - progress notes: labeled SPN + prose ("Measures A x B cm")
// Adds multi-wound primary selection (largest area wins) + evidence snippets.
// Returns null when nothing wound-like is found -> caller may try the LLM path.

import type {
  Assessment,
  DrainageAmount,
  ExtractedWound,
  Note,
} from "../types";

export type Source =
  | { kind: "assessment"; data: Assessment }
  | { kind: "note"; data: Note };

const WOUND_TYPES: [RegExp, string][] = [
  [/pressure (ulcer|injury)/i, "pressure_ulcer"],
  [/diabetic|dfu/i, "diabetic_foot_ulcer"],
  [/venous/i, "venous_stasis_ulcer"],
  [/arterial/i, "arterial_ulcer"],
  [/surgical site|surgical wound/i, "surgical_site_infection"],
  [/abscess/i, "abscess"],
  [/\bburn\b/i, "burn"],
];

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function matchType(s: string | null | undefined): string | null {
  if (!s) return null;
  for (const [re, t] of WOUND_TYPES) if (re.test(s)) return t;
  return null;
}

function normStage(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/n\/?a/i.test(s)) return null;
  const m = /(\d|unstageable)/i.exec(s);
  if (!m) return null;
  return m[1].toLowerCase() === "unstageable" ? "unstageable" : m[1];
}

function normDrainage(s: string | null | undefined): DrainageAmount | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/\bnone|absent|no drainage\b/.test(t)) return "none";
  if (/heavy|large|copious|profuse/.test(t)) return "heavy";
  if (/mod(erate)?/.test(t)) return "moderate";
  if (/light|scant|minimal|\bmin\b|small/.test(t)) return "light";
  return null;
}

interface Fields {
  wound_type: string | null;
  stage: string | null;
  location: string | null;
  length_cm: number | null;
  width_cm: number | null;
  depth_cm: number | null;
  drainage_amount: DrainageAmount | null;
}

/** Parse a single free-text / labeled clinical segment into wound fields. */
export function parseText(text: string): Fields {
  const labeled = (label: string) =>
    new RegExp(`${label}\\s*:?\\s*([^\\n/]+)`, "i").exec(text)?.[1]?.trim() ?? null;
  const cm = (label: string) =>
    num(new RegExp(`${label}\\s*:?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*cm`, "i").exec(text)?.[1] ?? null);

  // "Measures 2.9 cm x 2.8 cm" / "5.9 x 4.5cm" / "...x 1.8 cm".
  const trip = /([0-9]+(?:\.[0-9]+)?)\s*(?:cm)?\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*(?:cm)?(?:\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*cm)?/i.exec(text);
  const length_cm = cm("Length") ?? num(trip?.[1]);
  const width_cm = cm("Width") ?? num(trip?.[2]);
  const depth_cm =
    cm("Depth") ??
    num(trip?.[3]) ??
    num(/depth[:\s]+([0-9]+(?:\.[0-9]+)?)\s*cm/i.exec(text)?.[1] ?? null) ??
    num(/([0-9]+(?:\.[0-9]+)?)\s*cm\s*deep/i.exec(text)?.[1] ?? null);

  const loc =
    labeled("Location") ??
    /\bto\s+([A-Za-z][A-Za-z ]+?)\s*(?:\/|measures|,|\.|$)/i.exec(text)?.[1]?.trim() ??
    null;

  return {
    wound_type: matchType(labeled("Wound Type")) ?? matchType(text),
    stage: normStage(/stage\s*:?\s*([^/\n,]+)/i.exec(text)?.[1] ?? null),
    location: loc,
    length_cm,
    width_cm,
    depth_cm,
    drainage_amount: normDrainage(labeled("Drainage")) ?? normDrainage(text),
  };
}

function empty(f: Fields): boolean {
  return !f.wound_type && f.length_cm == null && f.width_cm == null;
}

function area(f: Fields): number {
  return (f.length_cm ?? 0) * (f.width_cm ?? 0);
}

/**
 * Split a note into per-wound segments. Real multi-wound notes read like:
 * "Pressure Ulcer Left buttock measures 5.9x4.5cm ... Heel wound also eval - L heel 3.5x2.7 ...".
 * Split on wound-introducing cues so each wound parses independently.
 */
function splitWounds(text: string): string[] {
  const parts = text.split(
    /(?=\b(?:pressure ulcer|diabetic|venous|arterial|surgical|abscess|burn|heel wound|second wound|wound\s*#?\s*2|also eval)\b)/i
  );
  const segs = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return segs.length ? segs : [text];
}

function evidence(text: string, maxLen = 120): string {
  const m = /([^.\n]*(?:measures|cm|stage|drainage)[^.\n]*)/i.exec(text);
  const snip = (m?.[1] ?? text).trim();
  return snip.length > maxLen ? snip.slice(0, maxLen) + "…" : snip;
}

function fromAssessment(a: Assessment): ExtractedWound[] {
  if (!a.raw_json) return [];
  let j: any;
  try {
    j = JSON.parse(a.raw_json);
  } catch {
    return [];
  }

  // Flat docs/fixture shape.
  if (j.wound_type !== undefined || j.length_cm !== undefined) {
    const f: Fields = {
      wound_type: matchType(String(j.wound_type ?? "")) ?? (j.wound_type ?? null),
      stage: j.stage != null ? normStage(String(j.stage)) ?? String(j.stage) : null,
      location: j.location ?? null,
      length_cm: num(j.length_cm),
      width_cm: num(j.width_cm),
      depth_cm: num(j.depth_cm),
      drainage_amount: normDrainage(String(j.drainage_amount ?? "")),
    };
    return empty(f) ? [] : [mk(a.patient_id, f, "assessment", 0.95, `assessment#${a.id} (flat)`, true)];
  }

  // Nested sections shape.
  if (Array.isArray(j.sections)) {
    const qa = new Map<string, string>();
    for (const s of j.sections) {
      for (const q of s.questions ?? []) {
        if (q?.question) qa.set(String(q.question).toLowerCase(), String(q.answer ?? ""));
      }
    }
    const narrative = qa.get("wound narrative");
    if (narrative) {
      return parseAll(a.patient_id, narrative, "assessment", 0.65, `assessment#${a.id} narrative`);
    }
    const get = (k: string) => qa.get(k) ?? null;
    const f: Fields = {
      wound_type: matchType(get("wound type")),
      stage: normStage(get("stage")),
      location: get("location"),
      length_cm: num(get("length (cm)") ?? get("length")),
      width_cm: num(get("width (cm)") ?? get("width")),
      depth_cm: num(get("depth (cm)") ?? get("depth")),
      drainage_amount: normDrainage(get("drainage amount") ?? get("drainage")),
    };
    return empty(f) ? [] : [mk(a.patient_id, f, "assessment", 0.9, `assessment#${a.id} structured`, true)];
  }

  return [];
}

function fromNote(n: Note): ExtractedWound[] {
  return parseAll(n.patient_id, n.note_text ?? "", "note_structured", 0.6, `note#${n.id}`);
}

/** Parse ALL wound segments in a text, primary (largest area) first. */
function parseAll(
  patient_id: number,
  text: string,
  source: ExtractedWound["source"],
  confidence: number,
  evidencePrefix: string
): ExtractedWound[] {
  const segs = splitWounds(text);
  const candidates = segs
    .map((seg) => ({ f: parseText(seg), seg }))
    .filter(({ f }) => !empty(f))
    .sort((a, b) => area(b.f) - area(a.f));
  if (candidates.length === 0) return [];

  // Multi-wound text is messier -> slightly lower confidence.
  const conf = candidates.length > 1 ? Math.max(confidence - 0.05, 0.5) : confidence;
  return candidates.map((c, i) =>
    mk(patient_id, c.f, source, conf, `${evidencePrefix}: "${evidence(c.seg)}"`, i === 0)
  );
}

function mk(
  patient_id: number,
  f: Fields,
  source: ExtractedWound["source"],
  confidence: number,
  evidence: string,
  is_primary: boolean
): ExtractedWound {
  return { patient_id, ...f, source, confidence, is_primary, evidence };
}

/** All wounds described by a single source, primary first. */
export function extractWounds(source: Source): ExtractedWound[] {
  return source.kind === "assessment"
    ? fromAssessment(source.data)
    : fromNote(source.data);
}

/** Sync deterministic extraction — the primary wound only. Null if none. */
export function extractWound(source: Source): ExtractedWound | null {
  return extractWounds(source)[0] ?? null;
}
