// LLM extraction smoke test on a sample Envive narrative.
//   npm run test:llm   (needs ANTHROPIC_API_KEY; no DB)
// Proves: de-identification runs first, and the LLM pulls structured wound
// fields the regex parser would miss. Skips cleanly if no key is set.

import "dotenv/config";
import { extractWoundLLM } from "../lib/extract/llm";
import { deidentify } from "../lib/extract/deid";
import type { Note } from "../lib/types";

const envive: Note = {
  id: 999,
  patient_id: 42,
  note_type: "Envive Care Conference Review",
  effective_date: null,
  note_text:
    "Resident Mary Albright (FB-077) was seen at bedside by RN Carter on 2026-05-12. " +
    "Over the past week the sacral region has developed a deteriorating full-thickness " +
    "wound, now roughly four and a half centimeters in length by three centimeters wide, " +
    "with visible depth around one centimeter. Moderate serosanguineous exudate noted on " +
    "the dressing. Consistent with an unstageable pressure injury.",
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[test:llm] SKIP — set ANTHROPIC_API_KEY to run.");
    process.exit(0);
  }

  // Show the de-identification that happens before the model sees anything.
  const { text, map } = deidentify(envive.note_text ?? "");
  console.log("[test:llm] de-identified text sent to model:\n  " + text + "\n");
  console.log("[test:llm] tokens stripped:", Object.keys(map).join(", "));
  if (/Mary|Albright|FB-077|RN Carter|2026-05-12/.test(text)) {
    throw new Error("PHI leaked into model input!");
  }

  const w = await extractWoundLLM({ kind: "note", data: envive });
  console.log("\n[test:llm] extracted:", JSON.stringify(w, null, 2));
  if (!w) throw new Error("LLM returned null on a clear wound narrative");
  if (!w.length_cm || !w.width_cm) throw new Error("measurements not extracted");
  console.log("\n[test:llm] PASS — PHI stripped, narrative extracted.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[test:llm] FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
