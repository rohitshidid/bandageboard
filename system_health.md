# system_health.md — IHMS Status Board

> Auto-maintained by the Intelligent Health Monitoring System (IHMS).

## Last Sync
- Timestamp: 2026-06-28
- Triggering task: Round 2 — unmask PHI, interactive charts, SYNC pipeline, multi-wound claims. All verified via screenshots.

## Round 2 verification
- `npm run build` green (recharts bundled; First Load 196kB on /). NOTE: after adding a dep, `rm -rf .next` before rebuild (stale vendor chunk → 500 "Cannot find module vendor-chunks/lodash.js").
- `npm run verify` → multi-wound patients: 7/17 (after tightening dedup from 11); full names; shape PASS.
- Screenshots confirmed: full names, "N wounds" tags on the 7 multi-wound patients, decision donut + facility/wound bars (interactive tooltips), SYNC button + "Never synced", per-wound claim drawer (Helen Reyes: diabetic foot ulcer Ready 90% + Unknown Needs-review 55%).
- `db:push`: drizzle-kit 0.28 emits spurious `DROP CONSTRAINT *_not_null` on re-push (42P16 on PK) — schema is correct + applied; fresh DB pushes clean. Cosmetic.

## Structural Integrity — ALL 3 WORKSTREAMS VERIFIED GREEN ✅
- `npm run test:logic` → 22/22 pass (retry + routing + de-id + multi-wound + evidence + healed/resolved).
- `npm run test:llm` → SKIPs cleanly without ANTHROPIC_API_KEY.
- `EXTRACT_USE_LLM=true npm run verify` → async LLM path works; falls back to deterministic (4/6/7, PHI-safe).
- `npm run build` → compiles + typechecks clean. Routes: / (dynamic), /api/eligibility, /api/sync.
- Dashboard rendered live (screenshot): "Live data" badge, cards 17/4/6/7, color-coded table, detail drawer with evidence + 90% confidence + PHI-masked name.
- `npm run test:api` → PASS (live PCC, survived 30% 429s; ID mapping correct).
- `npm run db:push` → tables created on Neon. ✅
- `npm run ingest -- --facility 101 --limit 10 --once` → 10 patients ingested (resumable slice). ✅
- `npm run verify` → 4 auto / 6 flag / 7 reject on real data; PHI leak check PASS.
- `GET /api/eligibility` (next dev) → HTTP 200, exact `EligibilityResult` keys, filters work, no PHI leak. ✅
- Env: secrets live in `.env` (NOT `.env.local`). DATABASE_URL = Neon. PCC_BASE_URL set.
- Not yet: `npm run build` (prod), full 300-patient backfill (only 17 ingested so far).

## Documentation Alignment
- `plan.md` = source of truth; Person 1 micro-tasks checked off. ✅
- `ARCHITECTURE.md` mirrors plan.md. ✅
- `wiki.md` code layout reflects real files. ✅
- `README.md` / `API.md`: source docs, unchanged.

## SYNC pipeline FIXED (was: only 17 patients, button "not syncing")
- Root cause: old `syncIncremental` did ONE giant request loading all 300 (×4 calls ×429 retries) — minutes long; browser fetch gave up, nothing committed, `sync_meta` stayed empty.
- Fix: chunked + resumable + concurrent. `syncNextBatch(20)` advances a facility cursor (101→102→103) via `sync_cursor` + `sync_meta.cursor_facility`; `syncSlice` processes its batch with concurrency 5. UI loops POST `/api/sync` (`?reset=1` first) until `allDone`, refetching `/api/eligibility` each batch (table/charts grow live), retrying the same batch on failure.
- VERIFIED: drove all **300 patients** in (101→120, 102→180, 103→300); dashboard shows 300 (82 ready / 63 review / 155 reject; 145 active MCB), "Last sync" timestamp displayed; POST advances batches, GET returns lastSyncAt.
- Build gotcha: `npm run build` racing a RUNNING dev/start server (both write `.next`) → flaky `PageNotFoundError /_document`. Kill servers + `rm -rf .next` before building. Clean build is deploy-ready.

## Open Risks / Warnings
- Healed/resolved detection (`engine.ts` `HEALED_RE`/`ACTIVE_RE`) is a deterministic regex pass over the single most-recently-dated note/assessment text, not an LLM check — phrasing outside the regex won't be caught (stays `flag`/`auto_accept` as before, never a silent miss toward `reject`, so safe direction but may under-catch). Revisit if Person 2's LLM path should also classify status.
- LLM extraction (`lib/extract/llm.ts`) is wired but UNRUN live — no ANTHROPIC_API_KEY set. Default off (`EXTRACT_USE_LLM` unset) → deterministic path. To enable: set key + flag.
- Per-request LLM (EXTRACT_USE_LLM=true on `/api/eligibility`) would call the model per patient per request — fine for demo at 17 patients, but a batch/persisted enrichment is the right pattern at 300+. Noted for later.
- Only 17 patients ingested (smoke). Run full backfill before demo (see plan.md Deploy & Run).
- Eligibility computed on-the-fly in `compute.ts` (no persisted `eligibility` table) — fine for 300.
- Design call: confirmed non-MCB → `reject`; missing coverage entirely → `flag` (missing≠negative).
- Design call: latest note/assessment says wound healed/resolved → `reject`; healed+active language conflicting in the same latest doc → `flag_for_review` (never reject on ambiguity, per threshold.md safety rule).
- Critical path: Person 1 (done+verified) + Person 2 (extraction) gate the live demo.

## REAL-DATA GOTCHAS (API ≠ API.md docs — confirmed by ingest)
- Medicare Part B identified by `payer_code === "MCB"`, NOT `payer_type` (which is just "Medicare" for both A and B). Engine fixed.
- Assessment `raw_json` is nested `{sections:[{questions:[{question,answer}]}]}` or a free-text "Wound narrative" — NOT the flat shape in API.md. Extractor handles both.
- Narratives often omit depth → those `flag_for_review` (correct).
- Next env precedence: `.env.local` > `.env`. An empty `.env.local` silently shadows `.env`. Keep secrets in `.env`, delete stray `.env.local`.
- `@next/swc-darwin-arm64` must NOT be a hard dependency (breaks Vercel Linux build).

## Recent State Changes
| Timestamp | Task | Files Touched | Result |
|-----------|------|---------------|--------|
| 2026-06-28 | IHMS bootstrap | plan.md, selfcorrection.md, system_health.md, wiki.md | created |
| 2026-06-28 | 3-person plan + sync prompt + deploy steps | plan.md, selfcorrection.md, system_health.md, wiki.md | updated |
| 2026-06-28 | Reconcile ARCHITECTURE.md → 3-person | ARCHITECTURE.md, wiki.md, system_health.md | updated |
| 2026-06-28 | Implement Person 1 backend | 20 new files (lib/*, app/api/*, scripts/*, config) | created |
| 2026-06-28 | Implement Person 2 extraction | lib/extract/{deid,parse,llm,index}.ts, scripts/test-llm.ts; +@anthropic-ai/sdk,zod | created |
| 2026-06-28 | Implement Person 3 dashboard | app/{page,layout,globals.css}, components/*, tailwind/postcss config; +tailwind | created |
| 2026-06-28 | Healed/resolved wound → reject (threshold.md gap fix) | lib/eligibility/engine.ts, lib/eligibility/compute.ts, scripts/test-logic.ts | updated, 22/22 green |
