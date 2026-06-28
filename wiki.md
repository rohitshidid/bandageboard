# wiki.md — Project Encyclopedia

> Definitive map of the codebase. Maintained by IHMS.

## Architectural Overview
Internal, biller-facing wound-care billing pipeline. Pulls 300 synthetic patients
from the rate-limited PCC mock API (`https://hackathon.prod.pulsefoundry.ai`),
extracts wound fields from notes + assessments, applies deterministic routing
(`auto_accept` / `flag_for_review` / `reject`), and shows results in a Next.js
dashboard. Stack: Next.js 14 + TS, Vercel Postgres + Drizzle, Tailwind/shadcn,
Vercel AI SDK (Envive only), Vercel Cron. Deploy target: Vercel.

Flow: PCC API → [Ingestion+DB] → [Extraction+De-id] → [Eligibility+API] → [Dashboard].
Built by **3 developers** against a shared contract (`/lib/types.ts`) + mocks.

## File Index
| File | Location | Purpose |
|------|----------|---------|
| `README.md` | `/README.md` | Hackathon challenge brief, data model, what to build |
| `API.md` | `/API.md` | PCC mock API reference (endpoints, rate limits, schemas) |
| `ARCHITECTURE.md` | `/ARCHITECTURE.md` | Design + **3-person** split, mirrors plan.md (plan.md = source of truth) |
| `abi_frameworks_must_haves_and_dangers.md` | `/abi_frameworks_must_haves_and_dangers.md` | Must-have features + top-3 dangers (hard rules) |
| `plan.md` | `/plan.md` | **Active** ops hub: non-negotiables, 3-person plan, sync prompt, deploy steps |
| `selfcorrection.md` | `/selfcorrection.md` | Preference ledger (team=3, plan format) |
| `system_health.md` | `/system_health.md` | Health status board |
| `wiki.md` | `/wiki.md` | This file |

## Code Layout (Person 1 built; ✅ = exists)
| Path | Owner | Purpose |
|------|-------|---------|
| `lib/types.ts` ✅ | All (Phase 0) | Shared contract: entity + `ExtractedWound` + `EligibilityResult` types |
| `lib/mocks.ts` ✅ | All (Phase 0) | 3 fake `EligibilityResult` rows so dashboard starts immediately |
| `lib/db/schema.ts` ✅ | Person 1 | Drizzle tables (5 entities + `sync_cursor`); `raw` jsonb audit column |
| `lib/db/client.ts` ✅ | Person 1 | postgres-js + drizzle connection (pooled, reused) |
| `lib/ingest/client.ts` ✅ | Person 1 | PCC API client: 429 `Retry-After` + backoff retry; pure helpers exported |
| `lib/ingest/sync.ts` ✅ | Person 1 | id↔patient_id resolution, chunked idempotent upserts, resumable `syncSlice` |
| `lib/eligibility/engine.ts` ✅ | Person 1 | Deterministic routing + reason + danger rules (pure, testable) |
| `lib/eligibility/compute.ts` ✅ | Person 1 | DB rows → `EligibilityResult[]`; conflict detect; PHI masking enforced here |
| `lib/extract/index.ts` ✅ | Person 2 | Public surface: `extractWound` (sync), `extractWoundAsync` (LLM fallback), `deidentify`/`reidentify` |
| `lib/extract/deid.ts` ✅ | Person 2 | PHI de-identification: tokenize name/DOB/id/clinician/dates ↔ restore (round-trip) |
| `lib/extract/parse.ts` ✅ | Person 2 | Deterministic parser: structured/narrative/SPN/prose, multi-wound primary (largest area), evidence |
| `lib/extract/llm.ts` ✅ | Person 2 | Anthropic structured-output extractor for Envive; de-identified text only; lazy-loaded; graceful no-key fallback |
| `app/api/eligibility/route.ts` ✅ | Person 1 | `GET` → `{ summary, results }`, filters facility/decision/payer |
| `app/api/sync/route.ts` ✅ | Person 1 | `GET`/`POST` one ingestion slice (cron + manual), optional `SYNC_SECRET` |
| `app/page.tsx`, `app/layout.tsx` ✅ | Person 3 | Renders `<Dashboard/>`; layout imports Tailwind `globals.css` |
| `components/Dashboard.tsx` ✅ | Person 3 | Client orchestrator: fetch `/api/eligibility` (mock fallback), filters, sort, state |
| `components/SummaryCards.tsx` ✅ | Person 3 | Counts per decision + % ready to bill |
| `components/EligibilityTable.tsx` ✅ | Person 3 | Color-coded sortable table; row→drawer |
| `components/DetailDrawer.tsx` ✅ | Person 3 | Wound fields, reason, evidence, confidence, masked id |
| `components/decision.ts` ✅ | Person 3 | Shared decision colors/labels + dims helper |
| `tailwind.config.ts`, `postcss.config.mjs`, `app/globals.css` ✅ | Person 3 | Tailwind setup |
| `scripts/ingest.ts` ✅ | Person 1 | CLI backfill (`npm run ingest`) |
| `scripts/test-logic.ts` ✅ | Person 1 | Pure routing + retry + extraction tests (no DB/net), 15 cases |
| `scripts/test-api.ts` ✅ | Person 1 | Live PCC retry smoke test (network, no DB) |
| `scripts/test-llm.ts` ✅ | Person 2 | LLM extraction + de-id smoke test (`npm run test:llm`, gated on ANTHROPIC_API_KEY) |
| `scripts/verify.ts` ✅ | Person 1 | DB→decisions end-to-end check + PHI leak guard (`npm run verify`) |
| `scripts/inspect.ts` ✅ | Person 1 | Debug: dump raw stored coverage/assessment/note values |
| `.env` ✅ | local only (gitignored) | Secrets: `DATABASE_URL` (Neon), `PCC_BASE_URL`. NOT `.env.local`. |
| `vercel.json` ✅ | Person 1 | Cron → `/api/sync` per facility |
| `/components` | Person 3 | Dashboard components (not yet created) |

## Key Anchors
| Anchor | File:Line | Describes |
|--------|-----------|-----------|
| Routing rules | plan.md "Routing rules (deterministic)" | auto_accept / flag_for_review / reject criteria |
| Shared types | ARCHITECTURE.md:77–108 | Canonical interface shapes for `/lib/types.ts` |
| ID mapping rule | API.md:64–83 | `patient_id` (string) vs integer `id` per endpoint |
| Auto-accept gate | abi_frameworks_must_haves_and_dangers.md:45–55 | All conditions for safe auto_accept |
| Sync prompt | plan.md "CODE-SYNC PROMPT" | Paste to merge the 3 branches |

## Glossary
- **IHMS** — Intelligent Health Monitoring System (this orchestration layer).
- **MCB** — Medicare Part B (`payer_type="Medicare B"`, `effective_to=null` = active). Only eligible payer.
- **Envive** — unstructured narrative note format; hardest to parse → LLM + `flag_for_review`.
- **SPN/SOAP** — structured note formats; regex-parseable.
