# selfcorrection.md — Preference Ledger

> READ before touching any code. Cumulative memory of user feedback,
> coding preferences, stylistic choices, and past corrections.

## Coding Preferences
- **Team = 3 developers**, not 4. ARCHITECTURE.md drafts a 4-person split — collapse to 3 independent workstreams (data+decision / extraction / dashboard+deploy).
- Plans must let the 3 people work **independently** — anchor on a shared contract (`/lib/types.ts`) + mocks (`/lib/mocks.ts`) so nobody is blocked.

## Stylistic Choices
- Plans should END with: (1) a copy-paste **code-sync prompt** to merge the branches, and (2) explicit **deploy + run steps** (local + production).

## Past Corrections
| # | Date | Correction | Applies To |
|---|------|-----------|------------|
| 1 | 2026-06-28 | Re-split the 4-person architecture into a 3-person plan. | plan.md / team structure |
| 2 | 2026-06-28 | Append a sync prompt + deploy/run steps to the plan. | plan.md format |

## Do-Not-Repeat List
- Don't plan around 4 people. It's 3.
- Don't mix `patient_id` (string) and integer `id` across API endpoints (project hard rule).
