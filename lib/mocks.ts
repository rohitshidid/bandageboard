// Phase 0 mocks so the dashboard renders before the API is live.
// Shape MUST match EligibilityResult (full name, per-wound claims, multi-wound).

import type { EligibilityResult, ExtractedWound } from "./types";

const woundA: ExtractedWound = {
  patient_id: 1, wound_type: "pressure_ulcer", stage: "2", location: "Sacrum",
  length_cm: 3.2, width_cm: 2.1, depth_cm: 0.4, drainage_amount: "moderate",
  source: "assessment", confidence: 0.95, is_primary: true, evidence: "assessment#20001 structured",
};
const woundB: ExtractedWound = {
  patient_id: 1, wound_type: "diabetic_foot_ulcer", stage: null, location: "Left heel",
  length_cm: 2.4, width_cm: 1.6, depth_cm: null, drainage_amount: "light",
  source: "note_structured", confidence: 0.6, is_primary: false, evidence: "note#10044: depth not stated",
};

export const mockEligibility: EligibilityResult[] = [
  {
    patient_id: "FA-001",
    display_name: "Agnes Dunbar (FA-001)",
    facility_id: 101,
    has_active_mcb: true,
    wound: woundA,
    wounds: [
      { wound: woundA, decision: "auto_accept", reason: "Pressure ulcer fully documented." },
      { wound: woundB, decision: "flag_for_review", reason: "Diabetic foot ulcer: missing depth." },
    ],
    multiple_wounds: true,
    decision: "auto_accept",
    reason:
      "Active Medicare Part B. pressure_ulcer, stage 2 fully documented (location, L/W/D, drainage).",
  },
  {
    patient_id: "FB-014",
    display_name: "Tunde Okafor (FB-014)",
    facility_id: 102,
    has_active_mcb: true,
    wound: woundB,
    wounds: [{ wound: woundB, decision: "flag_for_review", reason: "Missing depth and drainage." }],
    multiple_wounds: false,
    decision: "flag_for_review",
    reason: "Active Medicare Part B, but documentation incomplete: missing depth and drainage.",
  },
  {
    patient_id: "FC-007",
    display_name: "Maria Reyes (FC-007)",
    facility_id: 103,
    has_active_mcb: false,
    wound: null,
    wounds: [],
    multiple_wounds: false,
    decision: "reject",
    reason: "No active Medicare Part B coverage (HMO only).",
  },
];

export default mockEligibility;
