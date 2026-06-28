# plan.md — Operations Hub

> Active state + trajectory for the Wound-Care Billing Pipeline.
> Maintained by IHMS. Updated after every interaction.
> **Team size: 3 developers, working in parallel against a shared contract.**

---

## Non-Negotiables (hard rules — verify before any merge)

**Tech stack (Vercel-native):**
- Next.js 14 (App Router) + TypeScript — one repo, API routes + frontend.
- Vercel Postgres (Neon) for storage. Drizzle ORM (schema = shared contract).
- Tailwind + shadcn/ui for the dashboard.
- Vercel AI SDK (Anthropic) — ONLY for hard Envive narratives.
- Vercel Cron → serverless route for ingestion.

**Correctness boundaries (from must-haves + top-3 dangers):**
- **ID mapping is sacred.** `patient_id` (string `FA-001`) → `/diagnoses`, `/coverage`. integer `id` → `/notes`, `/assessments`. Never mix. Uncertain identity → `flag_for_review`.
- **Retry-safe ingestion.** 30% of calls return 429. Honor `Retry-After` + backoff. Never silently drop patient data.
- **Never guess.** `auto_accept` ONLY when everything documented (see routing rules §Eligibility). Anything missing/ambiguous/conflicting → `flag_for_review`. Reliable extraction impossible → `reject`.
- **Missing ≠ negative.** Missing coverage ≠ no MCB. Missing measurement ≠ no measurement. Failed extraction ≠ negative finding. → `flag_for_review`.
- **Rule-based routing only.** Deterministic rules decide. LLM assists extraction/summaries, never the final decision.
- **Every decision carries a plain-English reason + evidence snippet** (where each field came from).
- **Raw + processed storage.** Keep raw API JSON for audit; processed tables for querying.

**PHI rules (synthetic data, treated as real — everyone follows):**
- De-identify note text before ANY LLM call; re-attach identifiers locally.
- Mask identifiers in UI (last name + patient_id default; reveal toggle).
- No PHI in logs (no full notes / names / DOB to console or error traces).
- API masks at the boundary — only `display_name_masked` leaves the server.

---

## Active Rules
- READ `selfcorrection.md`, `system_health.md`, `wiki.md` before any code change.
- Build the **shared contract first** (Phase 0). Nobody splits off until `/lib/types.ts` + `/lib/mocks.ts` are committed.
- Each person works on their own branch against the contract/mocks. Integrate in dependency order (see Integration & Sync).
- UPDATE all state files after every task.

---

## Phase 0 — Shared Contract (DO TOGETHER FIRST, ~30 min) — UNBLOCKS EVERYONE
- [x] Scaffold Next.js 14 + TS + Drizzle. `package.json`, `tsconfig`, `.env.example`. (Tailwind = Person 3.)
- [x] Write `/lib/types.ts`: `Patient`, `Diagnosis`, `Coverage`, `Note`, `Assessment`, `ExtractedWound`, `EligibilityResult`.
- [x] Write `/lib/mocks.ts`: 3 fake `EligibilityResult` rows (one per decision type) so Person 3 starts immediately.
- [x] HTTP contract: `GET /api/eligibility` returns `{ summary, results: EligibilityResult[] }`.
- [ ] Push `main` with this skeleton. Everyone branches from here.

---

## Current Task
Person 1 (backend) + Person 2 (extraction) complete & verified. Next: Person 3 builds the dashboard; then integrate per CODE-SYNC PROMPT. To use LLM extraction: set `ANTHROPIC_API_KEY` + `EXTRACT_USE_LLM=true`.

---

## The 3 Parallel Workstreams

### Person 1 — Backend Data & Decision  `/lib/ingest`, `/lib/eligibility`, `/app/api/*`  ✅ DONE
Owns the DB schema (the contract), ingestion, the routing engine, and the API boundary. The whole server.
**Micro-tasks:**
- [x] DB schema in Drizzle (`lib/db/schema.ts`): `patients, diagnoses, coverage, notes, assessments` + `sync_cursor`. `raw` jsonb audit column on every table.
- [x] API client (`lib/ingest/client.ts`): `Retry-After`-aware retry + exponential backoff for 429; retry 5xx; 422 fails loud. Pure helpers exported for tests.
- [x] Resolve `patient_id` ↔ `id`; fetch all 5 entity types per patient across facilities 101/102/103 (`lib/ingest/sync.ts`).
- [x] Chunked, idempotent upserts (resumable via `sync_cursor`; `syncSlice` is timeout-safe, `onConflictDoUpdate` everywhere).
- [x] Vercel Cron config (`vercel.json`) → `/app/api/sync`. Incremental `since` sync supported (bonus).
- [x] Eligibility engine (`lib/eligibility/engine.ts`): active-MCB + active-wound checks.
- [x] Routing rules (deterministic) — auto_accept / flag_for_review / reject, encoding the top-3 dangers (missing≠negative).
- [x] Reason generator (plain English) + evidence snippet + conflict + missing-doc detection.
- [x] `GET /api/eligibility` (filters: facility / decision / payer). PHI masked in `compute.ts` — only `display_name_masked` leaves.
- [x] Stub `extractWound()` (`lib/extract/index.ts`) — assessment JSON + SPN regex; Envive → null. **Person 2 replaces.**
- [x] Tests: `scripts/test-logic.ts` (no DB/net), `scripts/test-api.ts` (live retry), `scripts/ingest.ts` (CLI backfill).
**Provides:** populated DB + `/api/eligibility` serving `{ summary, results }`.
**Seam for Person 2:** swap the stub `extractWound()` — signature `extractWound(source) → ExtractedWound | null` is fixed.

### Person 2 — Extraction & De-identification (PHI core)  `/lib/extract`  ✅ DONE
The hardest accuracy work. Pure functions over note/assessment JSON — no DB needed early.
**Micro-tasks:**
- [x] De-id module (`lib/extract/deid.ts`): tokenize name/DOB/IDs/clinician/dates → restore. Round-trip tested. Reusable by Person 1.
- [x] Assessment `raw_json` parser (`lib/extract/parse.ts`): nested `sections`, "Wound narrative", flat shape.
- [x] Structured note parser (regex): SPN labels + prose (`Measures A x B cm`, `5.9x4.5cm, depth 1.8cm`).
- [x] LLM extractor (`lib/extract/llm.ts`): **official Anthropic SDK** structured output (`messages.parse` + zod), model `claude-opus-4-8`. Runs on de-identified text ONLY. Lazy-loaded; graceful no-key fallback.
- [x] Multi-wound → pick primary by largest area (`is_primary`); emit `confidence` + `source`.
- [x] Evidence snippet: returns the substring each field came from.
- [x] Tests: de-id + multi-wound + evidence in `test:logic` (19/19); `test:llm` (gated on key).
**Provides:** `extractWound(source)` (sync), `extractWoundAsync(source)` (LLM fallback), `deidentify`/`reidentify`.
**Integration:** replaced Person 1's stub. LLM opt-in via `EXTRACT_USE_LLM=true` (default off keeps API hot path deterministic/free).

### Person 3 — Biller Dashboard & Deploy  `/app`, `/components`, `vercel.json`
The presentation layer (heavily judged) + ships the deploy.
**Micro-tasks:**
- [ ] Table: color-coded by decision (green/amber/red), sortable, filter by facility / decision / payer.
- [ ] Summary cards: counts per decision, % auto-accepted, payer mix.
- [ ] Patient detail drawer: wound fields, reason, evidence snippets, masked identifiers + reveal toggle.
- [ ] Empty / loading / error states.
- [ ] Wire to `GET /api/eligibility`; mocks first, swap to live when Person 1 is up.
- [ ] Vercel project setup, env vars, production deploy.
**Provides:** the deployed biller dashboard.
**Independent because:** renders `/lib/mocks.ts` from minute one; never touches backend internals, only the HTTP contract.

---

## Integration & Sync

### Order (dependency-driven)
1. Person 1 ingestion → DB populated (live data flows).
2. Person 2 `extractWound()` → swap Person 1's stub for the real extractor.
3. Person 1 eligibility runs on real extractions → `/api/eligibility` returns real rows.
4. Person 3 dashboard swaps mocks → live `/api/eligibility`.
5. Pick 3–4 demo patients (one per decision type). Rehearse 10-min biller walkthrough.

**Critical path:** Person 1 + Person 2 gate the live demo (integrate first). Person 3 stays productive on mocks throughout — slow ingest never blocks the UI.

### >>> CODE-SYNC PROMPT (paste into IHMS / Claude when merging the 3 branches) <<<

```
You are the IHMS integration orchestrator. Three developers built in parallel on
branches: `feat/p1-backend-data` (ingestion + DB + eligibility + /api/eligibility),
`feat/p2-extraction` (lib/extract: extractWound + de-id), `feat/p3-dashboard`
(app + components + vercel deploy). All share /lib/types.ts (the contract) and
/lib/mocks.ts.

Goal: merge all three into `main`, wire the real seams (replace stubs/mocks), and
get the app running locally end-to-end so we can see the initial dashboard with
real data, then deploy.

Do this in order, stopping to report at each step:
1. Read plan.md, selfcorrection.md, system_health.md, wiki.md for context + rules.
2. Merge branches into main in dependency order: p1 → p2 → p3. Resolve conflicts;
   /lib/types.ts is the source of truth — if a branch diverged from it, conform the
   branch to the contract, not the reverse.
3. Verify the contract holds: every `EligibilityResult` field the dashboard reads
   is produced by the eligibility engine. List any mismatches before fixing.
4. Replace seams: swap Person 1's stub `extractWound()` for Person 2's real one;
   swap Person 3's `/lib/mocks.ts` import for a live fetch to `GET /api/eligibility`.
5. Reconcile env vars into one `.env.example` (DB url, PCC base URL, ANTHROPIC_API_KEY).
6. `npm install`, run `drizzle-kit push` against the dev DB, run ingestion once,
   then `npm run dev`. Confirm the dashboard renders real rows at http://localhost:3000.
7. Run the must-have + top-3-danger checklist from plan.md against the live output:
   ID mapping correct? 429 retry working? no false auto-accepts? missing≠negative?
   PHI masked at the boundary? Report pass/fail per item with evidence.
8. Update plan.md, system_health.md, wiki.md to reflect the integrated state.

Do NOT change routing logic or extraction behavior during merge — only wire seams
and resolve conflicts. Flag any logic disagreement for human review instead.
```

---

## Deploy & Run Steps

### Local (first end-to-end run)
```bash
# 1. Install
npm install

# 2. Env — copy template and fill in
cp .env.example .env.local
#   DATABASE_URL=postgres://...        (Vercel Postgres / Neon dev branch)
#   PCC_BASE_URL=https://hackathon.prod.pulsefoundry.ai
#   ANTHROPIC_API_KEY=sk-...           (for Envive LLM extraction)

# 3. Create the schema
npx drizzle-kit push

# 4. Pull data once (chunked ingestion; safe to re-run — idempotent upserts)
curl -X POST http://localhost:3000/api/sync          # or: npm run ingest
#   (start dev server first if hitting the route)

# 5. Run the app
npm run dev
#   open http://localhost:3000 — biller dashboard with real routing decisions
```

### Production (Vercel)
```bash
# Person 3 owns this.
# 1. Push main to GitHub; import repo at vercel.com/new
# 2. Add a Vercel Postgres store (auto-injects DATABASE_URL)
# 3. Set env vars in Vercel project settings: PCC_BASE_URL, ANTHROPIC_API_KEY
# 4. Deploy (auto on push to main), or:
npx vercel --prod
# 5. Schema on prod DB:  npx drizzle-kit push   (against prod DATABASE_URL)
# 6. Cron in vercel.json triggers /api/sync on schedule (initial backfill may
#    need several runs — ingestion is chunked + resumable).
# 7. Verify the production URL renders the dashboard with data.
```

---

## Upcoming Goals
- Incremental `since` sync (bonus) once full backfill is stable.
- Per-patient LLM summary narrative (de-identified) in the detail drawer.
- Demo script: 3–4 example patients, one per decision type.

---

## Done
- [x] IHMS state files initialized (`plan.md`, `selfcorrection.md`, `system_health.md`, `wiki.md`).
- [x] Read all project docs; re-planned 4-person ARCHITECTURE split into 3 independent workstreams.
- [x] ARCHITECTURE.md reconciled to the 3-person plan (plan.md = source of truth).
- [x] **Person 1 implemented + VERIFIED** on real Neon DB + live API: 15/15 logic tests, live 429-retry, db:push, ingest, `npm run verify` (4 auto/6 flag/7 reject, PHI-safe), `GET /api/eligibility` HTTP 200 with exact contract. Fixed real-data gotchas (MCB via `payer_code`; nested assessment shapes; `.env` precedence).
- [x] **Person 2 implemented + VERIFIED**: de-id module, multi-wound parser, evidence, Anthropic LLM extractor (de-identified text only). 19/19 logic tests; async LLM path falls back cleanly (verified against DB). (Awaiting Person 3 + integration.)
- [ ] **Before demo:** full 300-patient backfill — `npm run ingest` (only 17 ingested so far; resumable, ~85s/10 patients due to 429s).
