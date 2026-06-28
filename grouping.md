# LLM Smart Queue Grouping for Flagged Patients

## Goal

After the first rules-based triage, many patients may still have status:

```text
flag_for_review
```

The goal of the LLM is **not** to make the final billing decision.  
The goal is to organize flagged patients into clear work queues so billing people know exactly what to review next.

## Main Idea

```text
Rules Engine decides status.
LLM organizes flagged patients.
Uncertainty stays flagged.
```

The LLM should only help answer:

- Why was this patient flagged?
- What is missing?
- What should the biller check next?
- Which queue should this patient go into?

## Where This Fits in the Architecture

```text
PCC API
  -> Data Fetching + Retry Logic
  -> Patient ID Matching
  -> Structured Extraction
  -> Rules Engine
  -> First Status: auto_accept / reject / flag_for_review
  -> LLM Smart Queue Grouping for flagged patients
  -> Biller Dashboard
```

## LLM Input

The LLM should receive a safe, minimal evidence object for each flagged patient.

Example:

```json
{
  "patient_id": "FA-102",
  "current_status": "flag_for_review",
  "part_b_status": "confirmed_active",
  "wound_evidence": "active sacral pressure ulcer found",
  "missing_fields": ["drainage_amount"],
  "conflicts": [],
  "api_failures": [],
  "latest_note_summary": "Sacral ulcer documented with measurements, but drainage not clearly stated."
}
```

Do not send unnecessary PHI. Use patient ID and minimal snippets only.

## LLM Output

The LLM should return structured JSON.

```json
{
  "patient_id": "FA-102",
  "flag_category": "missing_drainage",
  "queue_name": "Needs Drainage Documentation",
  "plain_reason": "Active Part B and active wound evidence found, but drainage amount is missing.",
  "next_action": "Check the latest wound note or assessment for drainage amount.",
  "priority": "medium",
  "should_change_status": false
}
```

## Queue Categories

| Queue Category | Meaning | Biller Action |
|---|---|---|
| `missing_drainage` | Drainage is missing or vague | Check latest wound note or assessment for drainage amount |
| `missing_measurements` | Length, width, or depth is missing | Verify wound measurement section |
| `coverage_unclear` | Medicare Part B could not be confirmed | Check insurance/coverage manually |
| `conflicting_documentation` | Notes and assessments disagree | Compare latest note and assessment |
| `multi_wound_unclear` | Multiple wounds exist and primary wound is unclear | Confirm the billable primary wound |
| `possible_healed_resolved` | Latest documentation may say wound is healed/resolved | Review before rejecting |
| `data_fetch_issue` | API failed or returned incomplete data | Retry/check source data |
| `low_confidence_extraction` | Parser or LLM could not confidently extract fields | Human review needed |

## Safety Rules

| Rule | Why |
|---|---|
| LLM should not silently reject patients | Prevent unsafe false rejection |
| Missing data is not negative evidence | Missing fields should stay flagged |
| API failure should not become reject | Data unavailable does not prove ineligibility |
| Conflicting documentation should stay flagged | Human review is needed |
| No evidence quote means no confident decision | Keeps decisions traceable |
| Final status changes require deterministic guardrails | LLM assists, rules decide |

## What This Improves

Instead of showing billing people one large list like:

```text
73 flagged patients
```

The dashboard can show:

```text
18 need drainage documentation
14 need measurements
9 have coverage uncertainty
7 have conflicting documentation
6 have multiple wound ambiguity
5 are possible healed/resolved cases
14 have data/API issues
```

## Implementation Difficulty and Impact

| Feature | Implementation | Impact |
|---|---|---|
| Smart queue grouping | Easy / Medium | High |
| Plain-English reason | Easy | High |
| Next action generation | Easy | High |
| Safe reject candidate label | Medium | Very High, but requires guardrails |
| Conflict summary | Medium | High |

## Final Principle

```text
The LLM helps billing people move faster.
The LLM does not replace the rules engine.
The LLM does not make unsafe final rejection decisions.
```
