# selfcorrection.md — Preference Ledger

> READ before touching any code. Cumulative memory of user feedback,
> coding preferences, stylistic choices, and past corrections.

## Coding Preferences
- **Team = 3 developers**, not 4. ARCHITECTURE.md drafts a 4-person split — collapse to 3 independent workstreams (data+decision / extraction / dashboard+deploy).
- Plans must let the 3 people work **independently** — anchor on a shared contract (`/lib/types.ts`) + mocks (`/lib/mocks.ts`) so nobody is blocked.

## Stylistic Choices
- Plans should END with: (1) a copy-paste **code-sync prompt** to merge the branches, and (2) explicit **deploy + run steps** (local + production).

## LLM / Anthropic Decisions (Person 2)
- Use the **official `@anthropic-ai/sdk`** with structured outputs (`messages.parse` + `zodOutputFormat`), NOT the Vercel AI SDK that ARCHITECTURE.md first named. (Per claude-api skill: official SDK is the default for Anthropic code.)
- Default extraction model: **`claude-opus-4-8`** (override via `EXTRACT_MODEL`). Don't downgrade to Haiku unless the user asks.
- **De-identify BEFORE any LLM call** — `deidentify()` strips PHI, model sees `[PLACEHOLDER]` tokens only. Hard rule.
- Lazy-load the Anthropic SDK (dynamic `import()` inside the call) so the deterministic path + pure tests don't depend on it at module load.
- LLM is **opt-in** (`EXTRACT_USE_LLM=true`) and degrades to deterministic when no key — never block the pipeline on the model.

## Past Corrections
| # | Date | Correction | Applies To |
|---|------|-----------|------------|
| 1 | 2026-06-28 | Re-split the 4-person architecture into a 3-person plan. | plan.md / team structure |
| 2 | 2026-06-28 | Append a sync prompt + deploy/run steps to the plan. | plan.md format |

## Real-Data Facts (verified by ingesting the live API — trust over API.md)
- Active Medicare Part B = `coverage.payer_code === "MCB"` AND `effective_to === null`. `payer_type` is "Medicare" for both Part A and B — useless as discriminator.
- Assessment `raw_json` shape is nested `{sections:[{questions:[{question,answer}]}]}` or a single free-text "Wound narrative" answer. NOT the flat `{wound_type, length_cm,...}` from the docs.
- Notes are prose ("Measures 5.9 x 4.5cm, depth 1.8cm") or Envive narratives, rarely clean SPN labels.

## Do-Not-Repeat List
- Don't plan around 4 people. It's 3.
- Don't mix `patient_id` (string) and integer `id` across API endpoints (project hard rule).
- Don't trust API.md field shapes/values — verify against ingested data first.
- Don't put secrets only in `.env.local` if tsx/drizzle scripts need them — those read `.env` via dotenv. Conversely an empty `.env.local` shadows `.env` in Next. Keep one source: `.env`.
- Don't pin `@next/swc-*` platform binaries as hard deps — breaks cross-platform (Vercel) installs.
- `--limit` in `ingest` = slice size, not a total cap. Use `--once` for a true single-slice smoke test.
