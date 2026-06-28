// Pure-logic tests for Person 1. No DB, no network.
//   npm run test:logic
// Covers: retry client helpers, the extraction stub, and the routing engine
// (every decision branch + the top-3 danger rules).

import assert from "node:assert";
import { classify, parseRetryAfter, backoffMs } from "../lib/ingest/client";
import { extractWound, deidentify, reidentify } from "../lib/extract";
import { decide, isActiveMcb } from "../lib/eligibility/engine";
import type {
  Assessment,
  Coverage,
  Diagnosis,
  Note,
  Patient,
} from "../lib/types";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.error(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}

const patient: Patient = {
  id: 1,
  patient_id: "FA-001",
  facility_id: 101,
  first_name: "Agnes",
  last_name: "Dunbar",
  birth_date: "1942-05-04",
  gender: "Female",
  primary_payer_code: "MCB",
  last_modified_at: null,
  is_new_admission: false,
};
const mcb: Coverage[] = [
  { id: 1, patient_id: "FA-001", payer_name: "Medicare Part B", payer_code: "MCB", payer_type: "Medicare B", effective_from: "2020-01-01", effective_to: null },
];
const hmo: Coverage[] = [
  { id: 2, patient_id: "FA-001", payer_name: "HMO", payer_code: "HMO", payer_type: "HMO", effective_from: "2020-01-01", effective_to: null },
];
const fullWound = {
  patient_id: 1, wound_type: "pressure_ulcer", stage: "2", location: "Sacrum",
  length_cm: 3.2, width_cm: 2.1, depth_cm: 0.4, drainage_amount: "moderate" as const,
  source: "assessment" as const, confidence: 0.95, is_primary: true, evidence: "assessment#1",
};

console.log("\n— retry client helpers —");
test("classify maps status -> class", () => {
  assert.equal(classify(200), "ok");
  assert.equal(classify(429), "retry");
  assert.equal(classify(503), "retry");
  assert.equal(classify(422), "fatal");
});
test("parseRetryAfter parses, clamps, rejects junk", () => {
  assert.equal(parseRetryAfter("3"), 3000);
  assert.equal(parseRetryAfter("100"), 30000); // clamp to 30s
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter("abc"), null);
});
test("backoff grows with attempt", () => {
  assert.ok(backoffMs(0) < backoffMs(3));
});

console.log("\n— extraction stub —");
test("assessment raw_json parses to wound", () => {
  const a: Assessment = {
    id: 20001, patient_id: 1, assessment_type: "Weekly Wound Information Sheet", assessment_date: "2026-05-10",
    raw_json: JSON.stringify({ wound_type: "pressure_ulcer", stage: 2, location: "Sacrum", length_cm: 3.2, width_cm: 2.1, depth_cm: 0.4, drainage_amount: "moderate" }),
  };
  const w = extractWound({ kind: "assessment", data: a });
  assert.ok(w);
  assert.equal(w!.wound_type, "pressure_ulcer");
  assert.equal(w!.depth_cm, 0.4);
  assert.equal(w!.drainage_amount, "moderate");
});
test("SPN labeled note parses", () => {
  const n: Note = {
    id: 1, patient_id: 1, note_type: "Wound (SPN)", effective_date: null,
    note_text: "Location: Sacrum\nWound Type: Pressure Ulcer, Stage 2\nLength: 3.2 cm  Width: 2.1 cm  Depth: 0.4 cm\nDrainage: Moderate serosanguineous",
  };
  const w = extractWound({ kind: "note", data: n });
  assert.ok(w);
  assert.equal(w!.stage, "2");
  assert.equal(w!.length_cm, 3.2);
});
test("Envive narrative note -> null (defers to Person 2)", () => {
  const n: Note = {
    id: 2, patient_id: 1, note_type: "Envive", effective_date: null,
    note_text: "Patient seen at bedside; the sacral area shows a deteriorating ulcer roughly three centimeters across with moderate exudate noted on the dressing.",
  };
  assert.equal(extractWound({ kind: "note", data: n }), null);
});

console.log("\n— eligibility engine (danger rules) —");
test("isActiveMcb true only for active Medicare B", () => {
  assert.equal(isActiveMcb(mcb), true);
  assert.equal(isActiveMcb(hmo), false);
});
test("AUTO_ACCEPT: MCB + fully documented wound", () => {
  const r = decide({ patient, coverage: mcb, diagnoses: [], wound: fullWound, hadClinicalSource: true });
  assert.equal(r.decision, "auto_accept");
});
test("FLAG: missing depth (incomplete docs)", () => {
  const r = decide({ patient, coverage: mcb, diagnoses: [], wound: { ...fullWound, depth_cm: null }, hadClinicalSource: true });
  assert.equal(r.decision, "flag_for_review");
  assert.match(r.reason, /depth/);
});
test("FLAG: missing coverage is NOT a negative", () => {
  const r = decide({ patient, coverage: [], diagnoses: [], wound: fullWound, hadClinicalSource: true });
  assert.equal(r.decision, "flag_for_review");
});
test("REJECT: confirmed non-MCB coverage", () => {
  const r = decide({ patient, coverage: hmo, diagnoses: [], wound: null, hadClinicalSource: true });
  assert.equal(r.decision, "reject");
});
test("REJECT: MCB but genuinely no wound anywhere", () => {
  const r = decide({ patient, coverage: mcb, diagnoses: [], wound: null, hadClinicalSource: false });
  assert.equal(r.decision, "reject");
});
test("FLAG: MCB + notes exist but extraction failed (missing != negative)", () => {
  const r = decide({ patient, coverage: mcb, diagnoses: [], wound: null, hadClinicalSource: true });
  assert.equal(r.decision, "flag_for_review");
});
test("FLAG: note vs assessment conflict", () => {
  const r = decide({ patient, coverage: mcb, diagnoses: [], wound: fullWound, hadClinicalSource: true, conflict: true });
  assert.equal(r.decision, "flag_for_review");
});
test("FLAG: low confidence", () => {
  const r = decide({ patient, coverage: mcb, diagnoses: [], wound: { ...fullWound, confidence: 0.5 }, hadClinicalSource: true });
  assert.equal(r.decision, "flag_for_review");
});

console.log("\n— de-identification (PHI core) —");
test("strips name / id / DOB / clinician / dates", () => {
  const txt = "Agnes Dunbar (FA-001), DOB 1942-05-04, seen by RN Smith on 2026-05-10. Sacral pressure ulcer.";
  const { text, map } = deidentify(txt, { first_name: "Agnes", last_name: "Dunbar", patient_id: "FA-001", birth_date: "1942-05-04" });
  assert.ok(!/Agnes|Dunbar|FA-001|1942-05-04|RN Smith/.test(text), `leaked PHI: ${text}`);
  assert.ok(/pressure ulcer/i.test(text), "clinical content must survive");
  assert.ok(Object.keys(map).length >= 4);
});
test("reidentify restores exactly (round-trip)", () => {
  const txt = "Agnes Dunbar FA-001 sacral ulcer";
  const { text, map } = deidentify(txt, { first_name: "Agnes", last_name: "Dunbar", patient_id: "FA-001" });
  assert.equal(reidentify(text, map), txt);
});

console.log("\n— multi-wound primary + evidence —");
test("picks the larger wound as primary", () => {
  const n: Note = {
    id: 9, patient_id: 2, note_type: "HP Skin & Wound Note", effective_date: null,
    note_text: "Pressure Ulcer Left buttock measures 5.9 x 4.5cm, depth 1.8cm. Heel wound also eval - L heel 3.5x2.7, 0.9cm deep.",
  };
  const w = extractWound({ kind: "note", data: n });
  assert.ok(w);
  assert.equal(w!.length_cm, 5.9); // buttock (26.6cm²) beats heel (9.45cm²)
  assert.equal(w!.depth_cm, 1.8);
  assert.match(w!.evidence ?? "", /multi-wound/);
});
test("evidence snippet present on single wound", () => {
  const n: Note = {
    id: 10, patient_id: 1, note_type: "Wound (SPN)", effective_date: null,
    note_text: "Location: Sacrum\nWound Type: Pressure Ulcer, Stage 2\nLength: 3.2 cm Width: 2.1 cm Depth: 0.4 cm\nDrainage: Moderate",
  };
  const w = extractWound({ kind: "note", data: n });
  assert.ok(w?.evidence && w.evidence.length > 0);
});

console.log("\n— healed/resolved wound (threshold.md) —");
test("REJECT: latest documentation says wound healed", () => {
  const r = decide({
    patient, coverage: mcb, diagnoses: [], wound: fullWound, hadClinicalSource: true,
    latestWoundText: "Sacral wound has healed; site closed, no further treatment needed.",
  });
  assert.equal(r.decision, "reject");
});
test("FLAG: latest documentation has conflicting healed/active language", () => {
  const r = decide({
    patient, coverage: mcb, diagnoses: [], wound: fullWound, hadClinicalSource: true,
    latestWoundText: "Sacral wound resolved per prior note, but wound remains open on exam today.",
  });
  assert.equal(r.decision, "flag_for_review");
});
test("AUTO_ACCEPT unaffected when latest text has no healed language", () => {
  const r = decide({
    patient, coverage: mcb, diagnoses: [], wound: fullWound, hadClinicalSource: true,
    latestWoundText: "Sacral pressure ulcer remains open, dressing changed.",
  });
  assert.equal(r.decision, "auto_accept");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
