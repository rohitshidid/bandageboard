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
- [ ] Scaffold Next.js 14 + TS + Tailwind + Drizzle. Commit `package.json`, `.env.example`.
- [ ] Write `/lib/types.ts`: `Patient`, `Diagnosis`, `Coverage`, `Note`, `Assessment`, `ExtractedWound`, `EligibilityResult` (shapes from ARCHITECTURE.md §4).
- [ ] Write `/lib/mocks.ts`: 5–10 fake `EligibilityResult` rows (one per decision type) so Person 3 starts immediately.
- [ ] Agree the HTTP contract: `GET /api/eligibility` returns `EligibilityResult[]`.
- [ ] Push `main` with this skeleton. Everyone branches from here.

---

## Current Task
Bootstrap the 3-person parallel build. Phase 0 contract → 3 independent workstreams → integrate → deploy.

---

## The 3 Parallel Workstreams

### Person 1 — Backend Data & Decision  `/lib/ingest`, `/lib/eligibility`, `/app/api/*`
Owns the DB schema (the contract), ingestion, the routing engine, and the API boundary. The whole server.
**Micro-tasks:**
- [ ] DB schema in Drizzle: `patients, diagnoses, coverage, notes, assessments` + processed `eligibility` table. Raw JSON columns for audit.
- [ ] API client: `Retry-After`-aware retry + exponential backoff for 429; handle 422/500 cleanly.
- [ ] Resolve `patient_id` ↔ `id`; fetch all 5 entity types per patient across facilities 101/102/103.
- [ ] Chunked, idempotent upserts (resumable across cron runs — one slice per invocation, Vercel timeout-safe).
- [ ] Vercel Cron config (`vercel.json`) → `/app/api/sync`. **Bonus:** incremental `since` sync.
- [ ] Eligibility engine: active-MCB check (`payer_type="Medicare B"` AND `effective_to=null`); active-wound check (active diagnosis OR extracted wound).
- [ ] Routing rules (deterministic):
      - `auto_accept` — active MCB + active wound + type + stage(if pressure ulcer) + location + L/W/D + drainage all present + evidence + no conflicts.
      - `flag_for_review` — anything missing / ambiguous / Envive / low confidence / note-vs-assessment conflict.
      - `reject` — no reliable extraction possible.
- [ ] Reason generator (plain English) + evidence snippet per field. Conflict + missing-doc detection.
- [ ] `GET /api/eligibility` (filters: facility / decision / payer). Enforce PHI masking here — emit `display_name_masked` only.
- [ ] Stub `extractWound()` with a trivial passthrough until Person 2 lands, so routing + API are testable solo.
**Provides:** populated DB + `/api/eligibility` serving `EligibilityResult[]`.
**Independent because:** works against the live PCC API + own data immediately; only inbound dep is Person 2's `ExtractedWound` shape (already in contract).

### Person 2 — Extraction & De-identification (PHI core)  `/lib/extract`
The hardest accuracy work. Pure functions over note/assessment JSON — no DB needed early.
**Micro-tasks:**
- [ ] De-id module (reused by Person 1 for LLM summaries): tokenize identifiers → restore. Strip name/DOB/IDs from text.
- [ ] Assessment `raw_json` parser — cleanest source, prefer when present.
- [ ] Structured note parser (regex) for SPN / SOAP / prose shorthand (`Meas 4.2x3.1x1.5cm`).
- [ ] LLM extractor (Vercel AI SDK) for Envive narratives — runs on de-identified text ONLY.
- [ ] Multi-wound → pick primary (`is_primary`). Emit `confidence` (drives routing) + `source`.
- [ ] Evidence snippet: return the substring each field came from.
**Provides:** `extractWound(note | assessment) → ExtractedWound`.
**Independent because:** works against fixture JSON (sample notes/assessments from API.md) with zero DB dependency.

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
