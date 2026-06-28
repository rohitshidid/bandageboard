// Phase 0 shared contract. Owned by Person 1. Extraction (P2) and Dashboard (P3)
// depend on these shapes. Change here = tell the team.

export type DrainageAmount = "none" | "light" | "moderate" | "heavy";
export type Decision = "auto_accept" | "flag_for_review" | "reject";
export type WoundSource = "assessment" | "note_structured" | "note_llm";

// ---- Raw entities (mirror the PCC API) ----

export interface Patient {
  id: number; // internal id -> /notes, /assessments
  patient_id: string; // PCC id (e.g. FA-001) -> /diagnoses, /coverage
  facility_id: number;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  gender: string | null;
  primary_payer_code: string | null;
  last_modified_at: string | null;
  is_new_admission: boolean;
}

export interface Diagnosis {
  id: number;
  patient_id: string;
  icd10_code: string | null;
  icd10_description: string | null;
  clinical_status: string | null;
  onset_date: string | null;
}

export interface Coverage {
  id: number;
  patient_id: string;
  payer_name: string | null;
  payer_code: string | null;
  payer_type: string | null; // "Medicare B" | "Medicare A" | "Medicaid" | "HMO"
  effective_from: string | null;
  effective_to: string | null; // null => currently active
}

export interface Note {
  id: number;
  patient_id: number; // internal id
  note_type: string | null;
  effective_date: string | null;
  note_text: string | null;
}

export interface Assessment {
  id: number;
  patient_id: number; // internal id
  assessment_type: string | null;
  assessment_date: string | null;
  raw_json: string | null;
}

// ---- The integration interface ----

export interface ExtractedWound {
  patient_id: number;
  wound_type: string | null;
  stage: string | null;
  location: string | null;
  length_cm: number | null;
  width_cm: number | null;
  depth_cm: number | null;
  drainage_amount: DrainageAmount | null;
  source: WoundSource;
  confidence: number; // 0..1, drives routing
  is_primary: boolean;
  evidence?: string | null; // substring the fields came from
}

// One wound + its own claim status (a patient can have several).
export interface WoundClaim {
  wound: ExtractedWound;
  decision: Decision;
  reason: string;
}

// Biller manual override (see manual_override_requirements.md). Additive only —
// never replaces the system's own decision/reason, which stay in
// system_decision/system_reason when an override is present.
export interface DecisionOverride {
  decision: Decision;
  note: string | null;
  overridden_at: string;
}

export interface EligibilityResult {
  patient_id: string;
  display_name: string; // full name (PHI no longer masked)
  facility_id: number;
  has_active_mcb: boolean;
  wound: ExtractedWound | null; // primary (largest)
  wounds: WoundClaim[]; // all wounds, each with its own claim status
  multiple_wounds: boolean;
  decision: Decision; // EFFECTIVE decision: override.decision if present, else the system decision
  reason: string; // EFFECTIVE reason: override.note if present, else the system reason
  /** Present only when a biller has manually overridden the system decision. */
  override?: DecisionOverride;
  /** Present only alongside `override` — what the rules engine originally decided. */
  system_decision?: Decision;
  system_reason?: string;
}
