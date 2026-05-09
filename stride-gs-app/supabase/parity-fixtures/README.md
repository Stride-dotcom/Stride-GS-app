# Parity Fixtures

Incident-derived regression suite for the GAS → Supabase migration. Each fixture is a self-contained JSON file that pins a specific historical bug or edge case so the SB-side rewrite cannot regress it.

> **First read:** `stride-gs-app/MIGRATION_STATUS.md` for project-wide context.
> **Adjacent reading:** `BUILD_STATUS.md` for the original incident write-ups.

---

## Why this directory exists

Two years of GAS bug-fixes are encoded as production data and audit-log entries. Treating each past bug as a permanent test means the SB rewrite gets a real-world regression suite from day one — long before forward replay (MIG-006) has accumulated meaningful coverage.

Per **MIG-007** (three-layer verification), every function must pass `fixtures_clean` before it can move to canary. Fixtures are run by the replay harness on every PR touching a migration function.

## File layout

```
parity-fixtures/
├── README.md              ← this file
├── 001-<slug>.json        ← numbered, three-digit, kebab-case slug
├── 002-<slug>.json
└── ...
```

- **Numbered sequentially.** Never reuse a number, even if a fixture is deleted (mark as `"deprecated": true` instead).
- **One incident per file.** Two related symptoms of the same root cause go in one file with multiple `cases[]` entries.
- **Slug describes the bug, not the function.** `002-stale-void-row-rebill.json`, not `002-create-invoice-bug.json`.

## Fixture schema

```json
{
  "id": "002",
  "name": "stale-void-row-rebill",
  "incident_date": "2026-05-03",
  "regression_for": "v38.193 B2 — pre-commit Status assertion in api_markClientLedgerInvoiced_",
  "function": "createInvoice",
  "deprecated": false,
  "summary": "If a Billing_Ledger row was Voided after React loaded the picker but before GAS committed the invoice, the row was billed anyway. Fix added a pre-commit Status re-read with PRE_COMMIT_STATUS_ASSERTION on drift.",
  "preState": {
    "billing": [
      {
        "ledger_row_id": "INSP-TASK-INSP-62630-1",
        "tenant_id": "1NipTuck...",
        "status": "Void",
        "voided_at": "2026-05-01T17:14:00Z",
        "voided_reason": "Task reopened"
      },
      {
        "ledger_row_id": "INSP-TASK-INSP-62631-1",
        "tenant_id": "1NipTuck...",
        "status": "Unbilled",
        "total": 35.00
      }
    ],
    "tasks": [],
    "clients": [
      { "client_sheet_id": "1NipTuck...", "separate_by_sidemark": true }
    ]
  },
  "cases": [
    {
      "name": "stale-void-row-included-in-pick",
      "input": {
        "action": "createInvoice",
        "clientSheetId": "1NipTuck...",
        "ledgerRowIds": [
          "INSP-TASK-INSP-62630-1",
          "INSP-TASK-INSP-62631-1"
        ],
        "sidemark": "NIPTUCK"
      },
      "expectedOutcome": {
        "throws": "PRE_COMMIT_STATUS_ASSERTION",
        "billing_state_unchanged": true,
        "no_invoice_created": true,
        "no_cb_row_created": true,
        "no_invoice_tracking_row_created": true,
        "no_email_sent": true
      }
    },
    {
      "name": "clean-pick-still-succeeds",
      "input": {
        "action": "createInvoice",
        "clientSheetId": "1NipTuck...",
        "ledgerRowIds": ["INSP-TASK-INSP-62631-1"],
        "sidemark": "NIPTUCK"
      },
      "expectedOutcome": {
        "throws": null,
        "billing_rows_flipped": [
          { "ledger_row_id": "INSP-TASK-INSP-62631-1", "status": "Invoiced" }
        ],
        "invoice_tracking_row_created": true,
        "cb_row_created": true,
        "email_send_attempted": true
      }
    }
  ],
  "links": {
    "build_status_section": "Earlier Changes (2026-05-05, billing hardening pass — bugs #3-#9 closed)",
    "pr": "https://github.com/Stride-dotcom/Stride-GS-app/pull/289"
  }
}
```

### Field reference

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Three-digit sequence, matches filename. |
| `name` | yes | Kebab-case, matches filename slug. |
| `incident_date` | yes | ISO date (`YYYY-MM-DD`) of the original incident. |
| `regression_for` | yes | The fix this fixture pins. Reference version + bug ID where possible. |
| `function` | yes | Migration function name, exact match against `feature_flags.function_key`. |
| `deprecated` | yes | `true` if superseded — keep the file, don't reuse the number. |
| `summary` | yes | One paragraph. What broke, what fix landed, what this fixture asserts. |
| `preState` | yes | Map of table-name → array of row objects. Seeds `parity_dryrun.*` before each case runs. Use stable tenant IDs (`1NipTuck...`) for readability; the harness rewrites them to test-tenant IDs. |
| `cases` | yes | Array of one or more test cases (input + expected outcome). Common when one root cause produces multiple symptoms. |
| `cases[].input` | yes | Exact handler input as it would arrive at the SB Edge Function. |
| `cases[].expectedOutcome` | yes | What MUST be true after the handler runs. See "Expected outcome assertions" below. |
| `links` | no | Cross-refs: BUILD_STATUS section, PR URL, related fixtures. Aids future spelunking. |

### Expected outcome assertions

Use only the assertion fields the harness understands. Adding an assertion type requires updating the replay-shadow Edge Function.

| Assertion | Meaning |
|---|---|
| `throws` | Exception name expected, or `null` for clean execution. |
| `billing_state_unchanged` | After error, `parity_dryrun.billing` matches `preState.billing` byte-for-byte. |
| `no_invoice_created` / `no_cb_row_created` / `no_invoice_tracking_row_created` | No row appeared in the named table. |
| `no_email_sent` | Mock `send-email` client was never invoked. |
| `billing_rows_flipped` | Array of `{ledger_row_id, status, …}` — listed rows must end in the listed state; unlisted rows must be unchanged. |
| `invoice_tracking_row_created` | Single row appeared with sensible non-null fields. Specific value pinning uses `invoice_tracking_row_match` instead. |
| `cb_row_created` | At least one row appeared in CB Consolidated_Ledger. |
| `email_send_attempted` | Mock `send-email` client was invoked at least once. |
| `state_diff` | Free-form `{added: [], removed: [], modified: []}` snapshot. Last resort — prefer the higher-level assertions when they fit. |

## Authoring checklist

When you add a fixture from a fresh incident:

- [ ] Number is the next sequence (check `ls parity-fixtures/`).
- [ ] Filename matches `id` and `name` exactly.
- [ ] `preState` is the **minimum** state required to reproduce — don't dump the entire production schema.
- [ ] At least one negative case (the bug as it manifested) AND one positive case (clean input still works). Two-case minimum prevents the fix from being a sledgehammer that breaks the happy path.
- [ ] `summary` reads coherently to a future builder who has no memory of the incident.
- [ ] Linked from the corresponding `BUILD_STATUS.md` "Recent Changes" section back to the fixture file.

## Running fixtures locally

```bash
# Run all fixtures for a given function
cd stride-gs-app
npm run replay -- <functionKey> --fixtures

# Run one fixture by id
npm run replay -- createInvoice --fixture 002

# Combined with historical replay (MIG-007 layer 2)
npm run replay -- <functionKey> --last 90d --fixtures
```

(The harness itself is built in P1.7 — see `MIGRATION_STATUS.md` Phase 1 sub-tasks. Until then, this directory is documentation; fixtures land starting in P2.)

## Initial fixture backlog

These come from the open `BUILD_STATUS.md` hardening backlog and recent incidents. Authored as their owning function reaches `handler_drafted` state — except 001 + 002 which were authored ahead of P2 as worked examples (the design knowledge was fresh and these two are the most-load-bearing in the billing pipeline).

- [x] `001-dup-invoice-race` — **authored 2026-05-09**. v38.182 atomic counter fix (function: `createInvoice`). Two cases: `single-call-uses-sequence` + `two-consecutive-calls-produce-distinct-numbers`.
- [x] `002-stale-void-row-rebill` — **authored 2026-05-09**. v38.193 B2 pre-commit assertion (function: `createInvoice`). Two cases: `stale-void-row-included-in-pick` (negative) + `clean-pick-still-succeeds` (positive).
- [ ] `003-cb-symmetry-on-void` — v38.193 B3+B4 (function: `voidInvoice`).
- [ ] `004-cb-symmetry-on-reopen-task` — v38.193 B3+B4 cousin (function: `completeTask` reopen path / `voidInvoice`).
- [ ] `005-sidemark-force-split-digs` — v38.191 / v38.193 C3 (function: `createInvoice`).
- [ ] `006-transfer-orphans-aux-tables` — session 92 transfer overhaul (function: `transferItems`).
- [ ] `007-multi-tenant-billing-charge` — recent fix for tenant-mismatch on billing rows (function: `completeTask`).
- [ ] `008-storage-grace-period-honored` — Digs 7-day grace correctness (function: `commitStorageCharges`).

### Schema extensions discovered while authoring 001 + 002

While authoring the first two fixtures, two needs surfaced that the v1 schema doesn't yet formalize. The fixtures encode them in `harness_implementation_notes` blocks; P1.7 should consider folding them into the formal schema when the harness lands:

1. **Cross-call cases.** Fixture 001 case `two-consecutive-calls-produce-distinct-numbers` needs `input_a` + `input_b` rather than a single `input` field. The harness invokes both calls in sequence and the assertion compares outputs across calls.
2. **Sequence-state assertions.** `sequence_advanced_by`, `sequence_advanced_total`, and `invoice_no_uses_sequence` express "this call advanced `public.invoice_no_seq` by exactly N" — not naturally expressed in row-state terms. These are implemented by peeking the SEQUENCE before/after via `public.peek_invoice_no_seq()`.

New assertion vocabulary introduced by these fixtures (will be added to the assertion table above when the harness ships):

| Assertion | Meaning |
|---|---|
| `invoice_no_format` | Returned `invoice_no` matches the given regex. |
| `invoice_no_uses_sequence` | The numeric portion of `invoice_no` equals the post-call value of `public.peek_invoice_no_seq()`. |
| `sequence_advanced_by` / `sequence_advanced_total` | The delta of `public.peek_invoice_no_seq()` across the call(s) equals the given integer. |
| `billing_rows_unchanged` | Listed rows MUST end in the listed state — used alongside `billing_rows_flipped` to assert specific rows STAY unchanged in a successful invocation. |
| `email_send_attempted` (negative form `false`) | Inverse of the existing `email_send_attempted: true` — used to assert no email was attempted on an error path. |
| `invoice_nos_distinct` / `invoice_nos_strictly_increasing` | Cross-call assertions on `invoice_no` outputs. |
| `both_throws` | Cross-call shorthand for "both calls in this case threw the listed exception (or `null` for both succeeded)." |
