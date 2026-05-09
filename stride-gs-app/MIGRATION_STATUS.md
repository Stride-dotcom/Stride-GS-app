# GAS → Supabase Migration — Living Status

> Last updated: 2026-05-09 (P1.2 deployed as Web App v494 at 05:02:05Z. Smoke check deferred to organic Monday-morning traffic — Friday-evening-PST window had zero real `doPost` calls in the 5 minutes after deploy.).
> This file is **authoritative for execution**. The v1.1 docx in `Dropbox\Apps\GS Inventory\` is a stakeholder snapshot.

---

## Start here for new builder sessions

1. Read `CLAUDE.md` (always).
2. Read `BUILD_STATUS.md` "Recent Changes" (always).
3. **Read this file cover to cover** before doing any migration work.
4. Skim `supabase/parity-fixtures/README.md` if touching fixtures.
5. Check **Currently in flight** below — do not collide with another active worktree.
6. Check **Open questions / blockers** — do not start work that's gated on user input.
7. `git log --grep='\[MIGRATION' -n 10` for recent migration PRs.

If you only have time for one section: read **Architectural Decisions** in full. Those choices are append-only and not up for re-litigation without explicit user sign-off.

---

## Currently in flight

| Worktree | Branch | Phase | Scope | Started |
|---|---|---|---|---|

(Empty rows after merge. Add yourself at session start; remove at session end.)

---

## Phase status

| Phase | State | Functions in scope | Notes |
|---|---|---|---|
| **P1 — parity infrastructure** | in_progress | `feature_flags`, `parity_results`, `gas_call_log` tables; `correlation_id` on `entity_audit_log`; GAS-side input capture; `parity_dryrun` schema; reverse writethrough harness; React `FeatureFlagProvider`; Settings → Migration UI; replay harness Edge Function | Sub-phases below. |
| P2 — simple writes | not_started | `updateItem`, `updateTask`, `updateRepair`, `updateShipment` | |
| P3 — status changes | not_started | `startTask`, `startRepair`, `createTask`, `createWillCall`, `releaseItems`, status-only emails (shipment/WC/repair-quote) | |
| P4a — billing core | not_started | `completeTask`, `completeRepair`, `processWcRelease`, `commitStorageCharges`, `createInvoice`, `voidInvoice`, `reissueInvoice` | Per-tenant + SB mirror + `invoice_tracking`. |
| P4b — CB retirement | not_started | CB `Consolidated_Ledger` retire + QBO direct push (replacing IIF) | Prereq: P6's `qboCreateInvoice` ships first. |
| P5 — complex flows | not_started | `receiveShipment`, `transferItems`, `onboardClient` | |
| P6 — payments | not_started | `qboCreateInvoice`, `createStaxInvoices`, `runStaxCharges` | |
| P7 — decommission | not_started | GAS write-handler stubs, per-client GAS v5.0.0 freeze, time-driven trigger migration to pg_cron | |

### Phase 1 sub-tasks

| Sub | State | Owner-session | Deliverable |
|---|---|---|---|
| P1.1 | **done** | 2026-05-09 | Migrations: `feature_flags`, `parity_results`, `gas_call_log`, `correlation_id` column on `entity_audit_log`. 25 `feature_flags` rows seeded at `active_backend='gas'`. Migration file: `supabase/migrations/20260509000001_migration_parity_substrate.sql`. Applied via Supabase MCP. |
| P1.2 | **done (verify deferred)** | 2026-05-09 | GAS-side input capture: `api_logCallInput_` in `doPost`, threads `correlation_id` via `__MIG_CORRELATION_ID__` script-level global into `api_auditLog_`. PII-conscious redaction (1KB cap, whitelist of structural fields). StrideAPI v38.199.0 deployed as Web App v494 at 2026-05-09T05:02:05Z. **Verify pending**: 5-min post-deploy window had zero organic `doPost` traffic (Friday evening PST). Re-check Monday morning: expect non-zero `gas_call_log` rows + non-null `correlation_id` on `entity_audit_log` rows from same requests. |
| P1.3 | not_started | — | `parity_dryrun` Postgres schema mirroring the tables write-handlers touch. |
| P1.4 | not_started | — | Reverse writethrough harness: GAS Web App endpoint accepting row payloads, idempotent on row-id key. |
| P1.5 | not_started | — | React `FeatureFlagProvider` + `useFeatureFlag(key)` hook with per-tenant scope resolution. |
| P1.6 | not_started | — | Settings → Migration tab (admin only): per-function toggle, mismatch-rate widget, master-switch revert button. |
| P1.7 | not_started | — | `replay-shadow` Edge Function (cron'd nightly per function). |

P1 exit: P1.1–P1.7 all merged + one no-op handler wired through the framework end-to-end with parity logging proven.

---

## Per-function migration table

State machine: `not_started → handler_drafted → replay_clean → fixtures_clean → canary_active → fleet_primary → graduated`.

Match-rate column is the rolling 7-day match rate from `parity_results`.

| Function | Backend | Replay corpus | Match rate (7d) | Fixtures | Canary tenant | State | Last touched |
|---|---|---|---|---|---|---|---|
| `updateItem` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `updateTask` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `updateRepair` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `updateShipment` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `startTask` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `startRepair` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `createTask` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `createWillCall` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `releaseItems` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `completeTask` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `completeRepair` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `processWcRelease` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `commitStorageCharges` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `createInvoice` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `voidInvoice` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `reissueInvoice` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `transferItems` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `receiveShipment` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `onboardClient` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `qboCreateInvoice` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `createStaxInvoices` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `runStaxCharges` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `sendShipmentEmail` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `sendWillCallEmails` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `sendRepairEmails` (non-terminal) | gas | 0 | n/a | 0 | n/a | not_started | — |

Already-Done (no migration work): DispatchTrack, Marketing, Intake, Audit log, In-app notifications, Photos, Documents, Notes, Messaging, Service catalog, `invoice_tracking`, `next_invoice_no()`, `calculate_storage_charges`, Insurance auto-billing, `notify-order-revision`, `notify-new-order`, intake reminders, `send-onboarding-email`, claim emails (received/more-info/denial), `ACCOUNT_REFRESH_INVITATION`, `stax-catalog-sync`. See v1.1 docx for citations.

---

## Architectural Decisions

Append-only, numbered. Never edit historical entries. Reference by `MIG-NNN` in PRs and discussion.

### MIG-001 — Dry-run-on-shadow over cloned-app architecture (2026-05-08)

**Decision:** Shadow handlers run inside the same prod Supabase project, writing to a `parity_dryrun` schema (or in always-rollback transactions). Not in a cloned Supabase project.

**Rationale:** A cloned project gives credential-absence guarantees but doubles operational surface area, doesn't exercise real auth/RLS/multi-tenant, and pushes the riskiest test (real prod traffic) to cutover. Same-project dry-run is closer to prod and cheaper to maintain. The credential-absence guarantee is recovered via MIG-008.

### MIG-002 — Synchronous SB→Sheets reverse writethrough (2026-05-08)

**Decision:** When a function flips to `active_backend="supabase"`, every SB write fires a synchronous reverse writethrough to the per-tenant Google Sheet via a GAS Web App endpoint. Best-effort semantics — failures log to `gs_sync_events` but do not block the SB write.

**Rationale:** v1.0 specified an hourly sync, which loses up to 60 minutes on rollback. Synchronous writethrough mirrors today's `api_writeThrough_` pattern in reverse, makes per-tenant rollback lossless, and keeps the legacy sheet readable during the transition window.

### MIG-003 — Master switch is emergency revert only (2026-05-08)

**Decision:** Forward cutover happens per-function and per-tenant via the `feature_flags.tenant_scope` mechanism. The master switch only flips every active_backend back to `"gas"` in one transaction. One-way, audit-logged, behind a confirmation dialog.

**Rationale:** v1.0 used the master switch as both forward cutover and revert, which defeats the per-function-flag rollout. Emergency-only semantics preserve the granular rollout while keeping a fleet-wide kill switch for cross-function regressions.

### MIG-004 — `completeTask` / `completeRepair` / `processWcRelease` cannot split phases (2026-05-08)

**Decision:** These three handlers land entirely in Phase 4. Status change, billing row write, addon row write, and email send all happen under one lock and cannot be separated.

**Rationale:** v1.0 split status-change from billing-charge across Phase 3 and Phase 4. The handlers are single-transaction; splitting would require a deep refactor larger than either phase.

### MIG-005 — Phase 4 splits into 4a (per-tenant + SB mirror) and 4b (CB + QBO direct) (2026-05-08)

**Decision:** Phase 4a migrates handlers to write `public.billing` directly (with reverse writethrough to per-tenant sheet) and to upsert/PATCH/delete `invoice_tracking`. CB Consolidated_Ledger writethrough continues from the SB side, ported from the existing GAS append. Phase 4b retires the CB sheet, replaces IIF auto-import with QBO API direct push (Phase 6's `qboCreateInvoice` ships as prerequisite).

**Rationale:** v1.0 omitted the CB Consolidated_Ledger entirely. Bugs #5 and #7 in the open hardening backlog are exactly this class of CB-symmetry failure. Splitting the phase isolates the CB retirement risk.

### MIG-006 — `entity_audit_log` is the answer key; capture inputs in `gas_call_log` (2026-05-08)

**Decision:** Verification is against GAS's actual historical outputs, not abstract spec compliance. To enable replay, ship `gas_call_log` (raw input payload, redacted) + `correlation_id` column on `entity_audit_log` linking inputs to the resulting state changes.

**Rationale:** Two years of GAS bug-fixes and incidents are encoded in the audit trail. Treating that as the regression suite means any historical input can be replayed against the SB rewrite and divergence flagged automatically. Without input capture the corpus is reconstruction-only — adding `gas_call_log` is cheap (~50 LOC in `doPost_`) and starts the replay-corpus clock immediately.

### MIG-007 — Three-layer verification (2026-05-08)

**Decision:** A function graduates only after passing all three:

1. **Per-call state diff** — every shadowed call writes to `parity_dryrun.*` and a SQL diff against `public.*` lands in `parity_results`.
2. **Historical replay** — last 90 days of GAS calls re-fed through the shadow handler in order, expected to match `entity_audit_log` outcomes.
3. **Canary tenant** — one tenant on SB-primary for 14 days with synchronous reverse writethrough; rest of fleet stays on GAS.

**Rationale:** Per-call diff catches state-corruption bugs against synthetic inputs; replay catches them against real history; canary catches the bugs parity can't (RLS reads, frontend rendering, auth races). Skipping any layer leaves a class of bug uncovered.

### MIG-008 — Stripped-credential shadow Edge Function deployments (2026-05-08)

**Decision:** Each shadowed handler deploys as a *separate* Edge Function (`complete-task-shadow`, etc.) with its own env-var bundle in which `RESEND_API_KEY`, `STAX_API_KEY`, `QBO_CLIENT_SECRET`, DT credentials, etc. are set to literal placeholder values like `"DRY_RUN_NO_KEY"`. Any client constructed from those keys must throw on first network call with a loud error.

**Rationale:** Recovers the credential-absence guarantee from the cloned-app design (MIG-001 alternative) at infra level rather than via per-call-site `if (!dryRun)` checks. Failure mode is a loud crash, not a silent double-charge.

### MIG-009 — MIGRATION_STATUS.md is the project's authoritative living doc (2026-05-08)

**Decision:** This file (in repo) is the canonical state of the migration. Read at session start, updated at session end. The v1.1 docx in Dropbox is a stakeholder snapshot only. BUILD_STATUS.md remains the global change log; this file is the project-specific extension.

**Rationale:** Multi-session, multi-month projects need a project-scoped living doc separate from the global change log. Keeping it in repo means PR diffs show exactly what each session changed.

---

## Open questions / blockers

- [ ] **P1.2 organic-traffic verification** — Web App v494 was deployed at 2026-05-09T05:02:05Z but had zero `doPost` calls in the post-deploy window (Friday evening PST). On the next session start (Monday morning), run the smoke query in `BUILD_STATUS.md` "Recent Changes (2026-05-09, [MIGRATION-P1.2])" → "Pending user action" → smoke query. Expected: non-zero rows in `gas_call_log` since deploy, non-null `correlation_id` on the matching `entity_audit_log` rows. If still zero traffic-derived rows, investigate.
- [ ] **Canary tenant nomination** — needed before any function flips to `canary_active`. Justin to nominate a low-volume tenant (likely a recently-onboarded test tenant or an opt-in active tenant). Not blocking P1.
- [ ] **PDF source migration** — `INSP_EMAIL` and `CLAIM_SETTLEMENT` are blocked on moving the PDF source off Drive (attachments path landed in PR #182). Not blocking P1–P3; will block portions of P4.

---

## Pending user actions

(empty — sync from BUILD_STATUS as P1 sub-tasks ship)

---

## How to update this doc

1. Edit at the **end** of every migration session.
2. **Phase status table:** state changes only (`not_started → in_progress → done`).
3. **Per-function table:** every handler touched. Update `Replay corpus`, `Match rate`, `Fixtures`, `State`, `Last touched`.
4. **Architectural decisions:** append-only, numbered `MIG-NNN`, dated. Never edit historical entries — supersede with a new entry that references the prior `MIG-NNN`.
5. **Currently in flight:** add yourself at session start, remove at session end (after PR merges). Use this to prevent two builders colliding on the same handler.
6. **Open questions / blockers:** add any user-input gates you encounter; remove when resolved.
7. **Last updated** at the very top: bump the date and add a one-line note on what changed.

---

## Cross-references

- **CLAUDE.md** — branching, worktree, deploy, design-system rules. Universal.
- **BUILD_STATUS.md** — global change log. Migration-specific entries here use the `[MIGRATION-Pn]` tag for grep.
- **`_archive/Docs/Archive/Session_History.md`** — one-liner per session, also `[MIGRATION-Pn]` tagged.
- **`supabase/parity-fixtures/`** — incident-derived regression suite. Each fixture self-documents via its JSON shape.
- **`Dropbox\Apps\GS Inventory\GAS_to_Supabase_Migration_Roadmap_v1.1.docx`** — stakeholder snapshot. Do NOT treat as authoritative for execution.
