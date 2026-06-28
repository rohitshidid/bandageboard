# Manual Decision Override — Requirements

## 1. Purpose

Billers need the final say. The rules engine (`engine.ts`) and Smart Queue Grouping
are decision *support*, not a decision *lock*. A biller who has reviewed a patient
must be able to change the routing — e.g. move a `flag_for_review` wound to
`auto_accept` once they've manually confirmed coverage, or to `reject` once they've
confirmed that wound is healed.

This is a human override of an automated decision, so it must be **visible,
reversible, and auditable** — never silent.

## 2. Scope

- The override control lives at the **wound-claim level**. A patient can have
  multiple wounds (`wounds[]`), and each wound is billed/reviewed/rejected
  independently — so each wound gets its **own** override control, not one
  shared control for the whole patient.
- The patient-level `decision`/`reason` shown in the table and at the top of the
  drawer always **mirrors the primary wound** (`wounds[0]`, post-override). This
  keeps the table/summary view simple while still reflecting reality once the
  primary wound's billing status changes.
- Any decision can be overridden to any other decision (`auto_accept` ↔
  `flag_for_review` ↔ `reject`). The system does not block a transition — the human
  is explicitly taking responsibility for it.
- An override persists across reloads/re-syncs until cleared or replaced by a new
  override. Re-running ingestion/extraction must NOT silently wipe a biller's override.

## 3. Where it lives in the UI

- Entry point: the patient **detail drawer** (`DetailDrawer.tsx`), opened by clicking
  a row in the table. Each **wound claim card** has its own three actions:
  **Mark ready to bill** / **Flag for review** / **Reject**. The action matching
  that wound's *current effective* decision is shown as selected/disabled; the
  other two are clickable.
- An optional short note field per wound for *why* the override was made (e.g.
  "verified MCB by phone with payer 6/28").
- When a wound is overridden, its card shows an **"(overridden)"** tag next to the
  decision badge, and the system's original per-wound reason is shown underneath
  in smaller text for traceability. A "Revert" button clears it.
- The table row shows an **"overridden"** badge next to the decision pill whenever
  the *primary* wound has an active override (since the table only has room for
  one decision per patient).

## 4. Data model

Each override record stores:

```text
patient_id
wound_index            (0-based position in that patient's wounds[] array; 0 = primary)
decision               (auto_accept | flag_for_review | reject)
note                   (optional, free text)
overridden_at          (timestamp)
```

Primary key: `(patient_id, wound_index)`. The original system decision + reason
for that wound are NOT deleted or recomputed away — they stay available so the
audit trail shows both what the system said and what the human decided.

`wound_index` is positional, derived from how `dedupeWounds()` sorts wounds
(largest area first) at compute time. It is stable across reloads as long as the
underlying notes/assessments for that patient don't change; a re-sync that adds/
removes a wound for that patient can shift indices — acceptable for v1, flagged
as a known limitation (see §7).

## 5. API contract

```
POST /api/eligibility/override
body: { patient_id: string, wound_index: number, decision: "auto_accept"|"flag_for_review"|"reject", note?: string }
-> 200 { patient_id, wound_index, decision, note, overridden_at }

DELETE /api/eligibility/override?patient_id=FA-001&wound_index=0
-> 200 { patient_id, wound_index, cleared: true }
```

`GET /api/eligibility` merges any stored per-wound overrides into each entry of
`wounds[]`, and mirrors the primary wound's (`wounds[0]`) effective state onto the
patient-level fields:

```json
{
  "decision": "auto_accept",
  "reason": "Active Medicare Part B. ... (system reason)",
  "override": { "decision": "auto_accept", "note": "verified MCB by phone with payer 6/28", "overridden_at": "2026-06-28T20:14:00.000Z" },
  "system_decision": "flag_for_review",
  "system_reason": "Active Medicare Part B, but documentation incomplete: missing drainage.",
  "wounds": [
    {
      "wound": { "...": "..." },
      "decision": "auto_accept",
      "reason": "verified MCB by phone with payer 6/28",
      "override": { "decision": "auto_accept", "note": "verified MCB by phone with payer 6/28", "overridden_at": "2026-06-28T20:14:00.000Z" },
      "system_decision": "flag_for_review",
      "system_reason": "Active Medicare Part B, but documentation incomplete: missing drainage."
    },
    {
      "wound": { "...": "..." },
      "decision": "flag_for_review",
      "reason": "Active Medicare Part B, but documentation incomplete: missing stage."
    }
  ]
}
```

- Each wound's `decision`/`reason` is always the **effective** value (its own
  override wins if present).
- `override`/`system_decision`/`system_reason` are only included on a wound (or
  on the patient-level result) when that wound actually has an active override,
  so existing consumers that only read `decision`/`reason` keep working unmodified.

## 6. Safety / audit rules

1. Never delete or mutate the system's original per-wound decision/reason — only
   add an override on top.
2. Every override must be traceable: who isn't tracked yet (no auth in this app),
   but **when**, **which wound**, and **what it was before** must always be visible.
3. Clearing an override (`DELETE`) reverts that wound to the system decision — it
   does not require re-running extraction.
4. Overrides must survive a `SYNC` / re-ingestion of the same patient. (Re-ingestion
   only touches the raw PCC tables; the override table is untouched by ingestion.)
5. This feature does not change `engine.ts`, `queueGrouping.ts`, or any automated
   decision logic — it is strictly an additive layer on top of the computed result.

## 7. Out of scope / known limitations (for v1)

- Per-user attribution (no auth system exists yet).
- `wound_index` is positional, not a stable wound identity — if extraction picks
  up a new wound or drops one for the same patient between syncs, existing
  overrides may end up attached to the wrong wound. A future version should key
  overrides by a content hash (type + location + rough size) instead of index.
- Approval workflows / multi-step sign-off.
- Bulk override (multi-select + override many patients/wounds at once).
