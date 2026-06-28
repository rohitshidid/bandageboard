// LLM extraction for Envive narratives the regex parser can't handle.
// HARD PHI RULE: the model only ever sees DE-IDENTIFIED text. Identifiers are
// tokenized out here before the request and never sent.
//
// Uses the official Anthropic SDK with structured outputs (messages.parse + a
// zod schema). Model defaults to claude-opus-4-8; override with EXTRACT_MODEL.
// Degrades gracefully: no ANTHROPIC_API_KEY, or any error -> returns null, so
// the pipeline still runs (those patients flag_for_review).

import { z } from "zod";
import { deidentify } from "./deid";
import type { Assessment, ExtractedWound, Note } from "../types";

// Anthropic SDK is loaded lazily inside the call so the deterministic path
// (and pure unit tests) never depend on it at module-eval time.

type Source =
  | { kind: "assessment"; data: Assessment }
  | { kind: "note"; data: Note };

const WoundSchema = z.object({
  found: z.boolean(),
  wound_type: z.string().nullable(),
  stage: z.string().nullable(),
  location: z.string().nullable(),
  length_cm: z.number().nullable(),
  width_cm: z.number().nullable(),
  depth_cm: z.number().nullable(),
  drainage_amount: z.enum(["none", "light", "moderate", "heavy"]).nullable(),
  evidence: z.string().nullable(),
});

const SYSTEM = `You extract structured wound data from a single de-identified clinical note.
The text has had names, dates, and IDs replaced with [PLACEHOLDER] tokens — ignore those.
Return only what is explicitly stated. Do not guess or infer missing measurements.
If the note describes multiple wounds, return the PRIMARY (largest / most severe) one.
Set found=false if there is no wound described.
Normalize wound_type to one of: pressure_ulcer, diabetic_foot_ulcer, venous_stasis_ulcer,
arterial_ulcer, surgical_site_infection, abscess, burn. Measurements in cm.
evidence = the short phrase the measurements came from.`;

function sourceText(source: Source): { patientId: number; text: string } {
  if (source.kind === "note") {
    return { patientId: source.data.patient_id, text: source.data.note_text ?? "" };
  }
  // Assessment narrative path.
  let text = "";
  try {
    const j = JSON.parse(source.data.raw_json ?? "{}");
    const narr = (j.sections ?? [])
      .flatMap((s: any) => s.questions ?? [])
      .find((q: any) => /narrative/i.test(q?.question ?? ""));
    text = narr?.answer ?? source.data.raw_json ?? "";
  } catch {
    text = source.data.raw_json ?? "";
  }
  return { patientId: source.data.patient_id, text };
}

export async function extractWoundLLM(source: Source): Promise<ExtractedWound | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { patientId, text } = sourceText(source);
  if (!text.trim()) return null;

  // De-identify BEFORE the model sees anything.
  const { text: clean } = deidentify(text);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const client = new Anthropic();
    const resp = await client.messages.parse({
      model: process.env.EXTRACT_MODEL ?? "claude-opus-4-8",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: clean }],
      output_config: { format: zodOutputFormat(WoundSchema) },
    });
    const o = resp.parsed_output;
    if (!o || !o.found) return null;
    return {
      patient_id: patientId,
      wound_type: o.wound_type,
      stage: o.stage,
      location: o.location,
      length_cm: o.length_cm,
      width_cm: o.width_cm,
      depth_cm: o.depth_cm,
      drainage_amount: o.drainage_amount,
      source: "note_llm",
      confidence: 0.8,
      is_primary: true,
      evidence: o.evidence ? `LLM (de-identified): "${o.evidence}"` : "LLM (de-identified)",
    };
  } catch {
    // Network / key / parse failure — never block the pipeline.
    return null;
  }
}
