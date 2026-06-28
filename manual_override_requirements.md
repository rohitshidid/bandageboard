# Manual Decision Override — Requirements

## 1. Purpose

Billers need the final say. The rules engine (`engine.ts`) and Smart Queue Grouping
are decision *support*, not a decision *lock*. A biller who has reviewed a patient
must be able to change the routing — e.g. move a `flag_for_review` patient to
`auto_accept` once they've manually confirmed coverage, or to `reject` once they've
confirmed the wound is healed.

This is a human override of an automated decision, so it must be **visible,
reversible, and auditable** — never silent.

## 2. Scope

- Override applies at the **patient level** (the same `decision` field shown in the
  table/drawer today), not per individual wound claim.
- Any decision can be overridden to any other decision (`auto_accept` ↔
  `flag_for_review` ↔ `reject`). The system does not block a transition — the human
  is explicitly taking responsibility for it.
- An override persists across reloads/re-syncs until cleared or replaced by a new
  override. Re-running ingestion/extraction must NOT silently wipe a biller's override.

## 3. Where it lives in the UI

- Entry point: the patient **detail drawer** (`DetailDrawer.tsx`), opened by clicking
  a row in the table.
- Three actions, always visible: **Mark ready to bill** / **Flag for review** /
  **Reject**. The action matching the *current effective* decision is shown as
  selected/disabled; the other two are clickable.
- An optional short note field for *why* the override was made (e.g. "verified MCB
  by phone with payer 6/28").
- When a row is overridden, the table and drawer show an **"Overridden" badge**
  next to the decision pill, and the drawer shows the original automated decision +
  reason alongside the override (e.g. "System: flag_for_review (missing drainage) →
  Overridden: auto_accept by biller").

## 4. Data model

Each override record stores:

```text
patient_id
overridden_decision   (auto_accept | flag_for_review | reject)
note                   (optional, free text)
overridden_at          (timestamp)
```

The original system decision + reason are NOT deleted or recomputed away — they
stay available so the audit trail shows both what the system said and what the
human decided.

## 5. API contract

```
POST /api/eligibility/override
body: { patient_id: string, decision: "auto_accept"|"flag_for_review"|"reject", note?: string }
-> 200 { patient_id, decision, note, overridden_at }

DELETE /api/eligibility/override?patient_id=FA-001
-> 200 { patient_id, cleared: true }
```

`GET /api/eligibility` merges any stored override on top of the computed result:

```json
{
  "decision": "auto_accept",
  "reason": "Active Medicare Part B. ... (system reason)",
  "override": {
    "decision": "auto_accept",
    "note": "verified MCB by phone with payer 6/28",
    "overridden_at": "2026-06-28T20:14:00.000Z"
  },
  "system_decision": "flag_for_review",
  "system_reason": "Active Medicare Part B, but documentation incomplete: missing drainage."
}
```

- `decision` is always the **effective** decision (override wins if present).
- `system_decision`/`system_reason` are only included when an override exists, so
  existing consumers that only read `decision`/`reason` keep working unmodified.

## 6. Safety / audit rules

1. Never delete or mutate the system's original decision/reason — only add an
   override on top.
2. Every override must be traceable: who isn't tracked yet (no auth in this app),
   but **when** and **what it was before** must always be visible.
3. Clearing an override (`DELETE`) reverts the patient to the system decision —
   it does not require re-running extraction.
4. Overrides must survive a `SYNC` / re-ingestion of the same patient. (Re-ingestion
   only touches the raw PCC tables; the override table is keyed by `patient_id` and
   untouched by ingestion.)
5. This feature does not change `engine.ts`, `queueGrouping.ts`, or any automated
   decision logic — it is strictly an additive layer on top of the computed result.

## 7. Out of scope (for v1)

- Per-user attribution (no auth system exists yet).
- Per-wound-claim overrides (only the patient-level decision is overridable).
- Approval workflows / multi-step sign-off.
- Bulk override (multi-select + override many patients at once).
