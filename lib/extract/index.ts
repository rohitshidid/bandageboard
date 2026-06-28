// Person 2 — Extraction & De-identification (PHI core). Public surface.
//
//   extractWound(source)       -> sync, deterministic regex/structured parse.
//                                 Used by the API hot path (fast, no cost).
//   extractWoundAsync(source)  -> deterministic first; falls back to the LLM
//                                 (on de-identified text) for Envive narratives
//                                 the parser can't handle or is unsure about.
//   deidentify / reidentify    -> PHI tokenization (reused by Person 1 summaries).
//
// The sync signature is unchanged from Person 1's stub, so compute.ts keeps
// working. Enable the LLM path with EXTRACT_USE_LLM=true (see compute.ts).

import { extractWound, type Source } from "./parse";
import { extractWoundLLM } from "./llm";

const CONFIDENCE_OK = 0.75;

export { extractWound, extractWounds } from "./parse";
export type { Source } from "./parse";
export { deidentify, reidentify } from "./deid";

/**
 * Best-effort extraction: trust a confident deterministic parse; otherwise ask
 * the LLM (de-identified). Falls back to whatever deterministic produced.
 */
export async function extractWoundAsync(source: Source) {
  const det = extractWound(source);
  if (det && det.confidence >= CONFIDENCE_OK) return det;
  const llm = await extractWoundLLM(source);
  return llm ?? det;
}
