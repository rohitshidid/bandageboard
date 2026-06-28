// Deterministic routing engine. Rules decide — never an LLM. Encodes the
// must-haves + top-3 dangers:
//   - auto_accept ONLY when everything is documented and unconflicted
//   - missing / failed / conflicting data => flag_for_review (never a negative)
//   - confirmed-ineligible (no MCB, or no wound at all) => reject
// Pure: feed it raw rows, get an EligibilityResult. No DB, no network.

import type {
  Coverage,
  Diagnosis,
  Patient,
  ExtractedWound,
  EligibilityResult,
  Decision,
} from "../types";

const CONFIDENCE_MIN = 0.75; // below this -> review

// threshold.md: "Latest documentation clearly says the wound is healed or
// resolved" -> reject. Conflicting healed+active language -> flag, never reject.
const HEALED_RE =
  /\b(wound (?:is |has |was )?(?:fully )?heal(?:ed)?|wound resolved|resolution of (?:the )?wound|wound (?:site )?closed|no longer (?:has an? )?open wound)\b/i;
const ACTIVE_RE =
  /\b(open wound|wound (?:remains|is still) (?:open|present|active)|unhealed|not heal(?:ed|ing))\b/i;

export function isActiveMcb(coverage: Coverage[]): boolean {
  // Real API: payer_code distinguishes MCB/MCA/MCD/HMO; payer_type is just
  // "Medicare" for both Part A and B. So key off the code. (Docs showed
  // payer_type "Medicare B" — accept that too, belt and suspenders.)
  return coverage.some(
    (c) =>
      (c.payer_code === "MCB" || c.payer_type === "Medicare B") &&
      c.effective_to === null
  );
}

export function isActiveWoundDiagnosis(d: Diagnosis): boolean {
  if (d.clinical_status && d.clinical_status !== "active") return false;
  const desc = (d.icd10_description ?? "").toLowerCase();
  const code = (d.icd10_code ?? "").toUpperCase();
  const woundish = /(ulcer|wound|burn|abscess|surgical site|gangrene)/.test(desc);
  const woundCode = /^(L89|L97|L98\.4|E1[01]\.621|I83\.[02]|I70\.2|T81\.4|L02|T2[0-9]|T3[0-2])/.test(code);
  return woundish || woundCode;
}

/** Which wound fields are required and present? Stage only required for pressure ulcers. */
function missingFields(w: ExtractedWound): string[] {
  const missing: string[] = [];
  if (!w.wound_type) missing.push("wound type");
  if ((w.wound_type ?? "").toLowerCase().includes("pressure") && !w.stage)
    missing.push("stage");
  if (!w.location) missing.push("location");
  if (w.length_cm == null) missing.push("length");
  if (w.width_cm == null) missing.push("width");
  if (w.depth_cm == null) missing.push("depth");
  if (!w.drainage_amount) missing.push("drainage");
  return missing;
}

export interface EligibilityInput {
  patient: Patient;
  coverage: Coverage[];
  diagnoses: Diagnosis[];
  /** Best extracted wound (assessment preferred), or null. */
  wound: ExtractedWound | null;
  /** Did the patient have ANY note/assessment to extract from? */
  hadClinicalSource: boolean;
  /** True if note and assessment extractions disagree. */
  conflict?: boolean;
  /** Free text of the most recent note/assessment, used to catch healed/resolved language. */
  latestWoundText?: string | null;
}

export function maskName(p: Patient): string {
  const last = p.last_name ?? "Unknown";
  return `${last} (${p.patient_id})`;
}

export function decide(input: EligibilityInput): { decision: Decision; reason: string } {
  const { coverage, diagnoses, wound, hadClinicalSource, conflict } = input;

  // 1. Coverage. Missing data is NOT a negative -> review.
  if (coverage.length === 0) {
    return {
      decision: "flag_for_review",
      reason: "Coverage data unavailable — verify active Medicare Part B before billing.",
    };
  }
  if (!isActiveMcb(coverage)) {
    const payers = [...new Set(coverage.map((c) => c.payer_type ?? "unknown"))].join(", ");
    return {
      decision: "reject",
      reason: `No active Medicare Part B coverage (on file: ${payers}). Not eligible for MCB wound-care billing.`,
    };
  }

  // 2. Active MCB confirmed. Does the latest documentation say it healed?
  if (input.latestWoundText) {
    const healed = HEALED_RE.test(input.latestWoundText);
    const active = ACTIVE_RE.test(input.latestWoundText);
    if (healed && active) {
      return {
        decision: "flag_for_review",
        reason: "Latest documentation has conflicting healed/active language for the wound. Reconcile before billing.",
      };
    }
    if (healed) {
      return {
        decision: "reject",
        reason: "Latest documentation says the wound is healed/resolved. No active wound to bill.",
      };
    }
  }

  // 3. Is there a wound at all?
  const activeWoundDx = diagnoses.some(isActiveWoundDiagnosis);
  if (!wound) {
    if (!hadClinicalSource && !activeWoundDx) {
      return {
        decision: "reject",
        reason: "Active Medicare Part B, but no wound documented (no notes, assessments, or active wound diagnosis).",
      };
    }
    // Source existed but extraction failed -> never treat as negative.
    return {
      decision: "flag_for_review",
      reason: "Active Medicare Part B and clinical notes exist, but wound details could not be extracted (likely Envive narrative). Needs review.",
    };
  }

  // 4. Wound extracted. Conflicts and gaps -> review.
  if (conflict) {
    return {
      decision: "flag_for_review",
      reason: "Note and assessment disagree on the wound. Reconcile before billing.",
    };
  }
  if (wound.confidence < CONFIDENCE_MIN) {
    return {
      decision: "flag_for_review",
      reason: `Low extraction confidence (${wound.confidence.toFixed(2)}). Needs review.`,
    };
  }
  const missing = missingFields(wound);
  if (missing.length > 0) {
    return {
      decision: "flag_for_review",
      reason: `Active Medicare Part B, but documentation incomplete: missing ${missing.join(", ")}.`,
    };
  }

  // 5. Everything documented, confident, unconflicted -> safe to bill.
  const stagePart = wound.stage ? `, stage ${wound.stage}` : "";
  return {
    decision: "auto_accept",
    reason: `Active Medicare Part B. ${wound.wound_type}${stagePart} fully documented (location, L/W/D, drainage). Evidence: ${wound.evidence ?? wound.source}.`,
  };
}

export function buildResult(input: EligibilityInput): EligibilityResult {
  const { decision, reason } = decide(input);
  return {
    patient_id: input.patient.patient_id,
    display_name_masked: maskName(input.patient),
    facility_id: input.patient.facility_id,
    has_active_mcb: isActiveMcb(input.coverage),
    wound: input.wound,
    decision,
    reason,
  };
}
