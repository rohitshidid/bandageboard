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

## Planned Code Layout (Phase 0 onward — not yet created)
| Path | Owner | Purpose |
|------|-------|---------|
| `/lib/types.ts` | All (Phase 0) | Shared contract: entity + `ExtractedWound` + `EligibilityResult` types |
| `/lib/mocks.ts` | All (Phase 0) | Fake `EligibilityResult[]` so dashboard starts immediately |
| `/lib/ingest`, `/app/api/sync` | Person 1 | PCC client, retry/backoff, id mapping, chunked upserts, cron |
| `/lib/eligibility`, `/app/api/*` | Person 1 | Routing rules, reason gen, `GET /api/eligibility`, PHI masking |
| `/lib/extract` | Person 2 | `extractWound()`, de-id, regex + LLM parsers, confidence |
| `/app`, `/components` | Person 3 | Biller dashboard table, cards, detail drawer, deploy |

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
