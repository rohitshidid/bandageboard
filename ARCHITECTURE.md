# Wound-Care Billing Pipeline — Architecture & Task Split

**Team:** 3 developers · **Deploy target:** Vercel · **Duration:** Hackathon session

> **Source of truth:** [plan.md](./plan.md). This file mirrors it. If they ever
> diverge, plan.md wins.

---

## 1. What we're building

An **internal, biller-facing** tool. The end user is a non-technical billing/revenue-cycle staffer who reviews a table of patients and decides which Medicare Part B wound-care claims to submit. Patients never see this.

Output: one row per patient with extracted wound fields, an active-MCB flag, and a routing decision (`auto_accept` / `flag_for_review` / `reject`) plus a plain-English reason and evidence snippets — shown in a dashboard.

**PHI is treated as if real**, even though the hackathon data is synthetic. This is a cross-cutting requirement, not one person's job (see §5).

---

## 2. Tech stack (Vercel-native)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 14 (App Router) + TypeScript** | First-class Vercel support; API routes + frontend in one repo |
| Storage | **Vercel Postgres** (Neon) | Queryable, serverless, zero-config on Vercel |
| ORM | **Drizzle** | Type-safe schema = our shared contract |
| Ingestion trigger | **Vercel Cron** → serverless route | Scheduled + incremental sync via `since` |
| LLM | **Vercel AI SDK** (Anthropic) | Only for hard-to-parse Envive narratives |
| UI | **Tailwind + shadcn/ui** | Fast, clean biller dashboard |
| Auth (stub) | Assume authenticated/authorized biller | PHI access control placeholder |

> **Vercel timeout note:** ingesting 300 patients × 5 endpoints with a 30% 429 rate is too much for one serverless invocation (10–60s limits). Ingestion must run **chunked** (per-facility or per-patient batches) with **idempotent upserts**, so a cron run can do a slice and the next run continues. Person 1 owns this.

---

## 3. Architecture

```
                          PCC Mock API (rate-limited, 30% 429)
                                      │
              ┌───────────────────────┼───────────────────────┐
              │              [1] INGESTION LAYER               │  Person 1
              │  API client w/ retry+backoff · id↔patient_id   │
              │  resolution · chunked upserts · `since` sync   │
              └───────────────────────┬───────────────────────┘
                                      ▼
                          ┌───────────────────────┐
                          │   Vercel Postgres      │  ← schema = shared contract
                          │  patients, diagnoses,  │     (Person 1 owns schema)
                          │  coverage, notes,      │
                          │  assessments, eligibility
                          └───────────┬───────────┘
                                      ▼
              ┌───────────────────────┴───────────────────────┐
              │           [2] EXTRACTION + DE-ID               │  Person 2
              │  de-identify → parse (regex) / LLM (Envive) →  │
              │  normalized ExtractedWound + confidence        │
              └───────────────────────┬───────────────────────┘
                                      ▼
              ┌───────────────────────┴───────────────────────┐
              │        [3] ELIGIBILITY ENGINE + API            │  Person 1
              │  active MCB? · active wound? · measurements    │
              │  complete? → routing + reason · Next API routes│
              │  PHI masking enforced at API boundary          │
              └───────────────────────┬───────────────────────┘
                                      ▼
              ┌───────────────────────┴───────────────────────┐
              │           [4] BILLER DASHBOARD                 │  Person 3
              │  color-coded table · filters · detail drawer · │
              │  masked identifiers + reveal · summary stats   │
              └────────────────────────────────────────────────┘
```

**Ownership maps 4 architectural layers onto 3 people:** Person 1 owns the whole
backend server (ingestion + DB + eligibility + API), Person 2 owns extraction,
Person 3 owns the dashboard + deploy.

---

## 4. The shared contract (BUILD THIS FIRST, together — Phase 0, ~30 min)

Before splitting, the whole team agrees on the DB schema + TypeScript types. This is the seam that lets all 3 work in parallel against mocks. Define these interfaces in `/lib/types.ts`:

```ts
// Raw entities (mirror the API)
Patient { id:number; patient_id:string; facility_id:number;
          first_name; last_name; birth_date; gender; primary_payer_code;
          last_modified_at; is_new_admission }
Diagnosis { patient_id:string; icd10_code; icd10_description;
            clinical_status; onset_date }
Coverage { patient_id:string; payer_code; payer_type;
           effective_from; effective_to }
Note { id; patient_id:number; note_type; effective_date; note_text }
Assessment { id; patient_id:number; assessment_type;
             assessment_date; raw_json }

// THE integration interface — extraction & routing & UI all depend on this
ExtractedWound {
  patient_id:number;
  wound_type; stage; location;
  length_cm; width_cm; depth_cm;
  drainage_amount: 'none'|'light'|'moderate'|'heavy';
  source: 'assessment'|'note_structured'|'note_llm';
  confidence: number;        // drives routing
  is_primary: boolean;       // for multi-wound notes
}

EligibilityResult {
  patient_id:string; display_name_masked:string; facility_id:number;
  has_active_mcb:boolean;
  wound: ExtractedWound | null;
  decision: 'auto_accept'|'flag_for_review'|'reject';
  reason:string;
}
```

Also commit a `/lib/mocks.ts` with 5–10 fake `EligibilityResult` rows so **Person 3 can start immediately** without waiting on real data. Agree the HTTP contract: `GET /api/eligibility` returns `EligibilityResult[]`.

---

## 5. PHI rules (everyone follows these)

- **De-identify before any LLM call** — strip name/DOB/patient IDs from note text, run extraction on clinical text only, re-attach identifiers locally. (Person 2 builds the module; Person 1 reuses it for summaries.)
- **Mask in the UI** — show last name + patient ID by default; reveal toggle for authorized use. (Person 3)
- **Minimize storage** — keep only fields needed for the decision; don't duplicate full notes downstream. (Person 1 & 2)
- **No PHI in logs** — never log full note text, names, or DOB to console/error traces. (Everyone)
- **API masks at the boundary** — `display_name_masked` is what leaves the server. (Person 1)

---

## 6. The 3 parallel workstreams

### Person 1 — Backend Data & Decision  `/lib/ingest`, `/lib/eligibility`, `/app/api/*`
Owns the DB schema (the contract), ingestion, the routing engine, and the API boundary — the whole server. Deliverables:
- DB schema (Drizzle): `patients, diagnoses, coverage, notes, assessments` + processed `eligibility` table. Raw JSON columns for audit.
- API client: `Retry-After`-aware retry/backoff for 429; handle 422/500 cleanly.
- Resolve `patient_id` (string) ↔ `id` (int); fetch all 5 entity types per patient across facilities 101/102/103.
- Chunked, idempotent upserts into Postgres (resumable across cron runs).
- Vercel Cron config; **bonus:** incremental `since` sync.
- Eligibility engine: active **MCB** check (`payer_type="Medicare B"` AND `effective_to=null`); active-wound check (active diagnosis OR extracted wound).
- Routing rules → `auto_accept` / `flag_for_review` / `reject` (see §7) + plain-English reason + evidence snippet. Conflict + missing-doc detection.
- Next.js API: `GET /api/eligibility` (filters: facility / decision / payer); enforce PHI masking here.
- Stub `extractWound()` with a trivial passthrough until Person 2 lands, so routing + API are testable solo.
- Provides: populated DB + `/api/eligibility` serving `EligibilityResult[]`.

### Person 2 — Extraction & De-identification (PHI core)  `/lib/extract`
The hardest accuracy work. Pure functions over note/assessment JSON — no DB needed early. Deliverables:
- **De-id module** (also reused by Person 1): tokenize identifiers ↔ restore.
- Assessment `raw_json` parser (cleanest source — prefer it when present).
- Structured parser (regex) for SOAP / SPN / prose shorthand (`Meas 4.2x3.1x1.5cm`).
- **LLM extractor** for Envive narratives on de-identified text only.
- Multi-wound → pick primary (`is_primary`); emit `confidence` + `source`.
- Evidence snippet: return the substring each field came from.
- Provides: `extractWound(note|assessment) → ExtractedWound`.

### Person 3 — Biller Dashboard & Deploy  `/app`, `/components`, `vercel.json`
The presentation + visual output (judged) + ships the deploy. Deliverables:
- Table: color-coded by decision, sortable, filter by facility / decision / payer.
- Summary cards: counts per decision, % auto-accepted, payer mix.
- Patient detail drawer: wound fields, reason, evidence snippets, masked identifiers + reveal toggle.
- Empty/loading/error states.
- Works against `/lib/mocks.ts` from minute one; swaps to live `GET /api/eligibility` when ready.
- Vercel project setup, env vars, production deploy.

---

## 7. Routing rules (deterministic — rules decide, LLM never decides)

- `auto_accept` — ALL true: active MCB + active wound + wound type + stage (if pressure ulcer) + location + length + width + depth + drainage all documented + evidence exists + no unresolved conflicts.
- `flag_for_review` — anything missing / ambiguous / Envive / low confidence / note-vs-assessment conflict. **Missing ≠ negative.**
- `reject` — reliable extraction is not possible.

**Top-3 dangers (hard rules):** (1) never mix `patient_id` string vs integer `id` → uncertain identity = `flag_for_review`; (2) no false auto-accepts; (3) missing/failed/conflicting data is never treated as a negative finding.

---

## 8. Integration plan

1. **Phase 0 (together):** agree schema + types + commit mocks. ← unblocks everyone.
2. **Phase 1 (parallel):** each person builds against the contract / mocks on their own branch.
3. **Phase 2 (integrate):** Person 1 ingestion → DB; Person 2 `extractWound()` replaces Person 1's stub; eligibility runs on real extractions; Person 3 swaps mocks for live `/api/eligibility`. Use the **CODE-SYNC PROMPT in [plan.md](./plan.md)** to merge the 3 branches in dependency order.
4. **Phase 3 (demo prep):** pick 3–4 example patients (one per decision type), rehearse the 10-min biller walkthrough.

**Critical path:** Person 1 (data) + Person 2 (extraction) gate the live demo, so they integrate first. Person 3 stays productive on mocks throughout, so a slow ingest never blocks the UI.

**Deploy & run steps:** see [plan.md](./plan.md) — local (`npm install` → env → `drizzle-kit push` → ingest → `npm run dev`) and production Vercel (Postgres store + env vars + cron backfill).
