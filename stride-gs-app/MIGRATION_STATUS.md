# GAS → Supabase Migration — Living Status

> Last updated: 2026-05-13 (later) — **P3 repair cluster: 4-of-6 handlers shipped via Path-C** (PRs #405 + #406 + #407 + #408). `cancelRepair` (smoke-tested), `startRepair`, `sendRepairQuote` (+ Resend email), `respondToRepairQuote` (+ Resend Approved/Declined email). All deployed at `active_backend='gas'`; flip in Settings → Migration to activate (gas → supabase, `tenant_scope=NULL` for fleet-flip — Justin's plan since repairs are low-volume). Two remaining for the cluster: **`requestRepairQuote` single-item** (~30 min — wire TaskDetailPanel + ItemDetailPanel to existing `request-repair-quote-sb` with `itemIds:[oneItem]`) and **`completeRepair`** (P4a, ~4-5 hrs — new `__writeThroughReverseBilling_` writer for per-tenant Billing_Ledger + new `mirrorBillingToCb` GAS endpoint for the separate CB spreadsheet + REPAIR_COMPLETE email). Architectural call confirmed: SB needs only ONE billing table (`public.billing` with `tenant_id` column), not two — the per-tenant + consolidated split exists in GAS only because Google Sheets can't aggregate across spreadsheets. StrideAPI bumped to v38.216.0 — `__writeThroughReverseRepairs_` covers all 17 repair columns including the 8 quote_* fields. SHADOW_REGISTRY in `replay-shadow` lists 5 entries (updateItem + 4 repair P3). Critical security pattern carried through every handler: JWT signature verified via `supabase.auth.getUser(token)` against anon-keyed client (NOT just `atob` decode — the cancelRepair code review caught the forgeable-token issue and the fix propagated to all subsequent handlers).

> Earlier 2026-05-13 — **P3 kickoff via Path C (hybrid)**. First repair P3 handler shipped: `cancelRepair`. Feature-flag substrate extended with `requestRepairQuote`, `respondRepairQuote`, `cancelRepair`. Third per-table reverse-writethrough writer registered (`__writeThroughReverseRepairs_` in StrideAPI v38.215.0 — replaces stub). Shadow + primary edge functions deployed (`cancel-repair-shadow` v1, `cancel-repair-sb` v1). RepairDetailPanel reads `useFeatureFlag('cancelRepair')` and routes GAS↔SB. SHADOW_REGISTRY extended. Per MIG-007 Path-C variant: skip 90-day replay (corpus only ~4 days old since P1.2), keep shadow + canary gates. Cluster plan: cancelRepair (now) → startRepair → sendRepairQuote → respondRepairQuote → requestRepairQuote (single-item) → completeRepair (P4a). Each future handler: 1 PR mirroring this template.

> Earlier 2026-05-12 — **P1.7 + P2.1 MVP shipped**. Phase 1 now **7/7 done**. End-to-end parity-testing pipeline live; DB layer smoke-verified. Full Edge Function invocation pending operator-run with service_role key (smoke command in MIG-012). Slash command `/sb` documented in "Start here" block — use it on every migration-focused session start.
> This file is **authoritative for execution**. The v1.1 docx in `Dropbox\Apps\GS Inventory\` is a stakeholder snapshot.

---

## Start here for new builder sessions

**Shortcut: run `/sb` in Claude Code.** The user-scoped slash command orchestrates the whole flow below — reads the docs in order, runs the git/gh status commands, surfaces critical invariants, then waits for your direction before proposing work. Lives at `~/.claude/commands/sb.md`. Use it on every migration-focused session start.

The manual checklist behind `/sb`:

1. Read `CLAUDE.md` (always).
2. Read `BUILD_STATUS.md` "Recent Changes" (always — top 2-3 entries).
3. **Read this file cover to cover** before doing any migration work.
4. Open `FUNCTION_INVENTORY.md` when you need to know "what does X do?" or "how many functions are in P4a?" — 1,198 functions across all 8 GAS projects with plain-English descriptions, what-it-affects notes, and migration-phase tags. Don't read cover-to-cover; grep for the function or capability you care about.
5. Skim `supabase/parity-fixtures/README.md` if touching fixtures.
6. Check **Currently in flight** below — do not collide with another active worktree.
7. Check **Open questions / blockers** — do not start work that's gated on user input.
8. `git log --grep='\[MIGRATION' -n 10` for recent migration PRs.
9. `git worktree list` to see active sibling worktrees.
10. `gh pr list --search '[MIGRATION' --state open` for in-flight PRs.

If you only have time for one section: read **Architectural Decisions** in full. Those choices are append-only and not up for re-litigation without explicit user sign-off.

> **For non-Claude-Code builders** (or environments where the slash command doesn't load): the `/sb` source at `~/.claude/commands/sb.md` is a self-contained markdown file you can read as a checklist — same content, no shortcut required.

---

## Currently in flight

| Worktree | Branch | Phase | Scope | Started |
|---|---|---|---|---|

(Empty rows after merge. Add yourself at session start; remove at session end. Repair P3 cluster ongoing per MIG-013 — 4-of-6 handlers shipped + deployed (`cancelRepair` #405, `startRepair` #406, `sendRepairQuote` #407, `respondToRepairQuote` #408). All four at `active_backend='gas'` pending Justin's fleet-flip. Two remaining: `requestRepairQuote` single-item cutover (~30 min) + `completeRepair` P4a (~4-5 hrs, billing-touching, needs new GAS writers). Next session: read this file + BUILD_STATUS.md "Recent Changes (2026-05-13, [MIGRATION-P3]…)" to resume.)

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
| P1.3 | **done** | 2026-05-09 | `parity_dryrun` Postgres schema with 14 mirrors of public.* write-target tables (`inventory`, `tasks`, `repairs`, `shipments`, `will_calls`, `will_call_items`, `billing`, `addons`, `invoice_tracking`, `entity_notes`, `item_photos`, `clients`, `stax_invoices`, `stax_charges`). Built via `LIKE source INCLUDING DEFAULTS`. `parity_dryrun.reset()` truncate helper + `parity_dryrun.row_counts` diagnostics view. service_role-only access. Migration: `supabase/migrations/20260509000002_parity_dryrun_schema.sql`. **Schema-sync convention** (see below) is now load-bearing. |
| P1.4 | **done (framework only)** | 2026-05-09 | GAS endpoint: `doPost case "writeThroughReverse"` → `handleWriteThroughReverse_` dispatches to a per-table registry `REVERSE_WRITETHROUGH_TABLES_` (14 stubs). `api_isKnownTenantId_` validates `tenantId` against `public.clients.spreadsheet_id` before `openById` (fails closed on outage — prevents abuse via leaked API_TOKEN). Failures land in `gs_sync_events` with `action_type='writethrough_reverse'`. SB helper: `supabase/functions/_shared/reverse-writethrough.ts` with strict + best-effort variants. **Idempotency contract** (load-bearing): writers MUST derive sheet PK from SB row contents, never from `lastDataRow + 1` or arrival-order counters. Code review (Opus subagent) folded in: tenant validation, idempotency contract sharpened, retry-cron interaction documented. **StrideAPI v38.200.0 deployed as Web App v495** at 2026-05-09 ~05:18Z. **`GAS_API_URL` + `GAS_API_TOKEN` Edge Function secrets confirmed set** — SB→GAS plumbing is ready end-to-end. Per-table writers still ship in P2/P3/P4 PRs alongside their function migrations. |
| P1.5 | **done** | 2026-05-09 | `src/contexts/FeatureFlagContext.tsx` — `FeatureFlagProvider` fetches all flags on mount + realtime-subscribes for cross-tab sync. Hooks: `useFeatureFlag(key)` (returns `'gas' \| 'supabase'`), `useFeatureFlagRow(key)`, `useAllFeatureFlags()`, `useFeatureFlagLoading()`. Pure resolver `resolveFlagBackend(flag, tenantId)` exported for non-React callers. Per-tenant scope semantics documented inline + in **MIG-010** below. Wired into `main.tsx` between `AuthProvider` and `BatchDataProvider`. tsc + build clean. Bundle: `index-CkUuWxyQ.js`. Code review (Opus 4.7 subagent) flagged + fixed: realtime channel name now per-mount-random (StrictMode-safe), `coerceBackend` whitelist replaces silent passthrough so a malformed DB value can't route to a non-existent backend. |
| P1.6 | **done** | 2026-05-09 | `src/components/shared/MigrationSettingsTab.tsx` — Settings → Migration tab (admin-only via `TABS` filter + per-tab guard). Per-flag controls: toggle `active_backend` (chip), toggle `parity_enabled` (auto-sets opposite `shadow_backend`), edit `tenant_scope` (textarea, dedup'd on save). Master switch (MIG-003 refined) — atomic UPDATE clearing `active_backend → gas` + `tenant_scope → NULL` in one statement; parity stays on. Phase-grouped (P2 / P3 / P4a / P5 / P6 — empty phases skipped). Mismatch counts read from `feature_flags.mismatch_count_7d` (populated by P1.7). Code review (Opus subagent) flagged + fixed: predicate switched from `.neq` to `.gte` (more robust), narrowed master switch to MIG-003 actual semantics, dedup on tenant_scope save, always-enabled emergency button. Bundle: `index-BNJREu5o.js`. tsc + build clean. |
| P1.7 | **done (MVP — cron schedule deferred)** | 2026-05-12 (PR #349) | `replay-shadow` Edge Function (deployed v2) + companion `update-item-shadow` (deployed v2, the first SB shadow handler — pure function returning `payload − {itemId, requestId}` to mirror the audit-log shape). Companion migration `parity_results_rollup_trigger` adds AFTER-INSERT trigger that updates `feature_flags.mismatch_count_7d` + `last_parity_check`. Plus UNIQUE INDEX on `parity_results (function_key, call_id)` for idempotent re-runs. Plus StrideAPI v38.207.0 (Web App v502) expanding the `api_redactPayloadForCorpus_` whitelist so future corpus has complete inputs for location/vendor/description/etc. Smoke-verified at DB layer: synthetic parity_results rows correctly drive `feature_flags.mismatch_count_7d`. **Cron schedule + "Run replay now" button** in Settings UI are explicit follow-ups (see new MIG-012). MVP today is a manually-invoked harness — operator with service_role key POSTs `/functions/v1/replay-shadow` with body `{}` or `{since: "2026-05-01"}` to run. |

P1 exit: P1.1–P1.7 all merged + one shadow handler wired end-to-end with parity logging proven. **Reached 2026-05-12 with PR #349.**

---

## `parity_dryrun` schema-sync convention

The `parity_dryrun.*` mirrors created in P1.3 must stay column-shape-identical to their `public.*` sources. Drift breaks the replay harness silently — a shadow `INSERT` may succeed but produce a state hash that doesn't match prod.

**Rule:** every future migration that ALTERs a `public.*` table in the mirror set MUST also ALTER the corresponding `parity_dryrun.*` mirror in the same migration file.

**Mirror set** (14 tables as of P1.3):
`inventory`, `tasks`, `repairs`, `shipments`, `will_calls`, `will_call_items`, `billing`, `addons`, `invoice_tracking`, `entity_notes`, `item_photos`, `clients`, `stax_invoices`, `stax_charges`.

**PR-review checklist:**
- `ALTER TABLE public.X ADD COLUMN ...` → also `ALTER TABLE parity_dryrun.X ADD COLUMN ...`
- `ALTER TABLE public.X DROP COLUMN ...` → also `ALTER TABLE parity_dryrun.X DROP COLUMN ...`
- `ALTER TABLE public.X RENAME COLUMN ...` → also `ALTER TABLE parity_dryrun.X RENAME COLUMN ...`
- `ALTER TABLE public.X ALTER COLUMN ... TYPE ...` → also `ALTER TABLE parity_dryrun.X ALTER COLUMN ... TYPE ...`
- `DROP TABLE public.X` (mirror member) → also `DROP TABLE parity_dryrun.X` and remove from `parity_dryrun.reset()` and `parity_dryrun.row_counts`
- `CREATE TABLE public.X` (new write-target for a migrating handler) → add `CREATE TABLE parity_dryrun.X (LIKE public.X INCLUDING DEFAULTS)` and update `parity_dryrun.reset()` and `parity_dryrun.row_counts`

**Drift-detection function** — `parity_dryrun.check_drift(p_table text DEFAULT NULL)` (shipped 2026-05-09, migration `20260509000003_parity_dryrun_drift_check.sql`). Returns one row per drift; empty result = no drift. Categories: `missing_in_dryrun`, `missing_in_public`, `type_mismatch`. Mirror set is hardcoded inside the function — keep in sync with the list above when adding new mirror tables. Run manually before any replay run; P1.7 will invoke it automatically. To call: `SELECT * FROM parity_dryrun.check_drift();` (all tables) or `SELECT * FROM parity_dryrun.check_drift('billing');` (single table). service_role-only EXECUTE.

---

## Transitional sync layers (sunset during migration)

During the migration window, multiple sheet ↔ Supabase sync layers exist in parallel — some pre-existing, some added recently to close gaps that surface as the React UI moves toward Supabase-authoritative reads ahead of the actual P4a handler migration. **Each layer has a known sunset trigger.** Future builders should NOT preserve these as permanent infrastructure, AND should NOT delete them prematurely:

| Layer | What it keeps fresh | Read by | Sunset trigger |
|---|---|---|---|
| `propagate_sidemark_to_billing` Postgres trigger | `public.billing.sidemark` on inventory updates | React UI billing list | **P4a** — when the SB-side `createInvoice` / `voidInvoice` / `completeTask` handlers write `public.billing` directly, the trigger becomes redundant (those writes will keep `public.billing.sidemark` current as a primary write, not a mirror update). The trigger is correct as a transitional mirror; remove during P4a's handler-by-handler migration. |
| `api_propagateInvFieldsToBilling_` in StrideAPI (v38.201.1, PR #322) | Per-tenant `Billing_Ledger.Sidemark`/`Reference` (customized clients only — column-presence guarded) + Supabase resync | Invoice PDF generation, IIF export, QBO push, full-client billing sync | **P4b** — when CB Consolidated_Ledger is retired and the per-tenant `Billing_Ledger.Sidemark` cell is no longer read by invoice generation (which moves to reading `public.billing` directly), this fan-out becomes obsolete. Until then it's the authoritative path for keeping the customized-schema clients' invoice PDFs current. |
| `onClientEdit` in Triggers.gs v4.8.0 | Same as above, but for direct sheet edits to `Inventory.Sidemark`/`Reference` | Same as above | **P7** — when per-client GAS scripts are frozen at v5.0.0 (write-handler stubs) and direct sheet edits stop being a supported path, this trigger becomes a no-op. Until then it's the only mechanism that catches admin-direct-edits to Inventory and propagates them to Tasks/Repairs/Billing. |

**Why this section exists:** PR #322 added the second + third layer with explicit "this is a stop-gap" framing. Without this institutional-memory note, a future P4 builder might either preserve them out of caution (dead code in prod) or delete them prematurely (regression on the customized-schema clients during the migration window). The sunset triggers are load-bearing — read them before touching any of these layers.

**General rule for transitional layers added between now and P7:** when adding any sheet ↔ Supabase sync mechanism that closes a gap surfaced by the migration's incremental rollout, capture it in this table with an explicit sunset trigger.

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
| `startRepair` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (shipped PR #406, deployed, unflipped) |
| `requestRepairQuote` (single-item) | gas | 0 | n/a | 0 | n/a | not_started | 2026-05-13 (feature_flags row seeded; cutover wires TaskDetailPanel + ItemDetailPanel to existing `request-repair-quote-sb` with `itemIds:[oneItem]`) |
| `respondRepairQuote` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (shipped PR #408, deployed, unflipped; shares sendRepairEmails flag with sendRepairQuote) |
| `cancelRepair` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (shipped PR #405, smoke-tested end-to-end, deployed, unflipped) |
| `sendRepairQuote` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (shipped PR #407, deployed, unflipped; shares sendRepairEmails flag with respondRepairQuote) |
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
| `sendRepairEmails` (non-terminal) | gas | 0 | n/a | 0 | n/a | **handler_drafted (both halves)** | 2026-05-13 (PRs #407 + #408 shipped) — flipping this single flag activates BOTH send-quote and respond-to-quote in tandem |

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

### MIG-003 — Master switch is emergency revert only (2026-05-08, refined 2026-05-09)

**Decision:** Forward cutover happens per-function and per-tenant via the `feature_flags.tenant_scope` mechanism. The master switch only flips every `active_backend` back to `"gas"` in one atomic UPDATE. One-way, behind a confirmation dialog.

**What the master switch sets** (per the P1.6 implementation in `src/components/shared/MigrationSettingsTab.tsx`):
- `active_backend = 'gas'` — every row.
- `tenant_scope = NULL` — every row. **REQUIRED by MIG-010 semantics**: leaving a non-null `tenant_scope` alongside `active_backend='gas'` would route non-listed tenants to the OPPOSITE backend (`supabase`), the exact thing the operator is trying to back out of. So the master switch must clear scope as part of the same statement.

**What the master switch does NOT touch:**
- `parity_enabled` — stays as-is. The whole reason an operator hits the emergency revert is usually a regression that parity surfaced; keep it on so post-revert data continues to land in `parity_results`.
- `shadow_backend` — stays as-is, paired with `parity_enabled`.

**Rationale:** v1.0 used the master switch as both forward cutover and revert, which defeats the per-function-flag rollout. Emergency-only semantics preserve the granular rollout while keeping a fleet-wide kill switch for cross-function regressions.

**Future tightening:** the React-side implementation issues a single PostgREST PATCH (`UPDATE ... WHERE function_key >= ''`), which is one atomic SQL statement. A `revert_all_feature_flags()` SECURITY DEFINER RPC could replace the React call site for cleaner audit + a single named entry point. Tracked as a P1.6 follow-up; not blocking.

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

### MIG-010 — Per-tenant scope semantics for `feature_flags` (2026-05-09)

**Decision:** `feature_flags.function_key` stays as the primary key (one row per function). The single row carries `active_backend` ('gas' | 'supabase') and `tenant_scope` (text[] | NULL). Resolution for `(flag, callerTenantId)`:

- `tenant_scope IS NULL` → `active_backend` applies fleet-wide.
- `tenant_scope` non-null and `callerTenantId` IN `tenant_scope` → `active_backend`.
- `tenant_scope` non-null and `callerTenantId` NOT IN `tenant_scope` → the OPPOSITE backend.

Workflow this enables:
1. New function ships at `{active_backend:'gas', tenant_scope:null}` — fleet-wide gas.
2. Canary one tenant: `{active_backend:'supabase', tenant_scope:[X]}` — X on SB, rest on GAS (opposite of supabase).
3. Expand: `{active_backend:'supabase', tenant_scope:[X,Y,Z]}` — listed on SB, rest on GAS.
4. Fleet-wide cutover: `{active_backend:'supabase', tenant_scope:null}` — all on SB.

Master switch (MIG-003) emergency revert: every row to `{active_backend:'gas', tenant_scope:null}`.

**Rationale:** v1.1 docx specified "non-listed tenants fall through to a fleet-wide row," which assumed multiple rows per `function_key`. The seeded P1.1 schema uses `function_key` as PK, so that's not possible. Reframing the single-row's meaning as "the canary's backend" + "opposite for non-canary" gives the same expressiveness without a schema change. Implementation: `resolveFlagBackend(flag, tenantId)` in `src/contexts/FeatureFlagContext.tsx`. Documented inline at the top of that file.

**Edge case:** unauthenticated callers / cross-tenant impersonation default to `'gas'` even when scoped flags would otherwise apply. A function under canary should be exercised under the real user's primary tenant, not arbitrary tenants the admin happens to be looking at.

### MIG-011 — `FUNCTION_INVENTORY.md` is the canonical function reference; Settings → Migration tab extends to 1,196 functions (2026-05-11)

**Decision:** `stride-gs-app/FUNCTION_INVENTORY.md` is the authoritative function-level reference for the migration. The Settings → Migration tab today shows the 25-flag substrate; Layer 2 (a `migration_function_inventory` SQL table + extended UI) renders all 1,196 functions with coverage stats per project + per phase. Layer 2 plan is captured in the section below, not in this decision entry.

**Rationale:** the 25-flag table covered only the top-level migration handlers. With the full inventory, builders + Justin get a complete coverage picture and Justin can see "we've migrated X of Y across project Z" without grepping. The inventory doc is plain-English by directive — readable without code knowledge.

**Operational rule:** every PR that adds, renames, or deletes a GAS function MUST also update `FUNCTION_INVENTORY.md` in the same commit. Drift between source and the inventory breaks the dashboard's coverage stats (once Layer 2 ships).

### MIG-013 — Path-C hybrid for the repair P3 cluster (skip 90-day replay) (2026-05-13)

**Decision:** For the six-handler repair cluster (`requestRepairQuote` single-item, `startRepair`, `sendRepairQuote`, `respondRepairQuote`, `cancelRepair`, `completeRepair`), use the full framework — feature flag + shadow handler + parity logging + canary tenant + reverse writethrough — **except** skip the 90-day historical replay step.

**Rationale:** The historical-replay layer (MIG-007 layer 2) requires a populated `gas_call_log` corpus. P1.2 shipped 2026-05-09; today (2026-05-13) the corpus is ~4 days old. Waiting for 90 days of corpus accumulation before migrating repairs delays the work by months for a low-volume entity class where the headline risk (billing) is already handled by P4a's three-storage-layer rules (MIG-005). Repairs are not in the billing-correctness blast radius until `completeRepair` ships (P4a), and that handler will get full canary + reverse-writethrough verification independently.

**What we keep:**
- Per-call state diff via shadow handler → `parity_results` (MIG-007 layer 1)
- Canary tenant (one tenant, 3-day window vs the standard 14-day from MIG-007 — see below)
- Synchronous SB→Sheet reverse writethrough (MIG-002)
- Stripped-credential shadow deployments (MIG-008) — vacuously satisfied since the repair shadows are pure

**What we shorten:**
- 14-day canary → **3-day canary**. Justification: repair workflow is fully exercised in 1-2 days (a repair lifecycle from request-quote through complete is typically <72 hrs). A 14-day canary on a low-traffic entity adds wall-time without adding signal. The 14-day default in MIG-007 was scoped at high-traffic billing handlers (P4a) where edge-case-per-hour rates require the longer window.

**What's deferred / skipped:**
- Historical replay (MIG-007 layer 2). Future builders can run replay against the post-Path-C corpus if needed for retrospective regression analysis.

**Scope:** This decision applies ONLY to the repair P3 cluster. Other P2/P3/P4 handlers still go through the full MIG-007 verification by default. `completeRepair` (P4a) ships with the standard 14-day canary because its billing-write is in the critical path.

**Cluster order** (one PR each, mirroring the cancelRepair template):
1. `cancelRepair` — shipped 2026-05-13 (this PR). Status flip only.
2. `startRepair` — status flip + work-order PDF (already React-side via lib/workOrderPdf.ts).
3. `sendRepairQuote` — status flip + REPAIR_QUOTE email via Resend.
4. `respondRepairQuote` — status flip (Approved/Declined) + REPAIR_APPROVED or REPAIR_DECLINED email via Resend.
5. `requestRepairQuote` (single-item) — status flip + REPAIR_QUOTE_REQUEST email via Resend. Reuses the multi-item `request-repair-quote-sb` infrastructure with `itemIds:[oneItem]`.
6. `completeRepair` — P4a, NOT P3 per MIG-004. Standard 14-day canary. Status flip + billing write + addon flush + REPAIR_COMPLETE email. The slim remaining GAS write per the project intent: append rows to per-tenant `Billing_Ledger` + CB `Consolidated_Ledger` (P4b retires the CB sheet eventually).

### MIG-012 — Replay harness is operator-triggered today; cron + UI button deferred (2026-05-12)

**Decision:** P1.7 ships as a manually-invokable Edge Function (`/functions/v1/replay-shadow`). Cron schedule + a "Run replay now" button on the Settings → Migration tab are explicit follow-ups, not part of the MVP.

**Rationale:** the MVP proves the full pipeline (corpus → shadow → diff → parity_results → rollup trigger → feature_flags → UI surfacing) end-to-end on one function (`updateItem`). Cron is operational sugar; UI button is product polish. Neither changes the architectural shape. Shipping the cron requires `pg_cron` job scheduling + a way for the cron to authenticate to the Edge Function with service_role; that's its own design choice. Shipping the UI button requires a new admin-only PostgREST RPC wrapper (operators don't have service_role in the browser) that proxies the Edge Function call.

**Today's invocation pattern:**
- Operator with the service_role key runs:
  ```bash
  curl -X POST 'https://uqplppugeickmamycpuz.supabase.co/functions/v1/replay-shadow' \
    -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
    -H 'Content-Type: application/json' \
    -d '{}'
  ```
- Defaults: `function_key='updateItem'`, `since=90d ago`, `limit=500`.
- Override either: `{"since": "2026-05-01T00:00:00Z", "limit": 100}`.
- Result lands in `public.parity_results`; trigger updates `public.feature_flags.updateItem.mismatch_count_7d` + `last_parity_check`; Settings → Migration tab surfaces the data.

**Future follow-ups (post-MVP):**
- **pg_cron schedule.** Nightly invocation of replay-shadow at, say, 3 AM PST. Requires pg_cron + a wrapper that holds the service_role JWT (or a separate scheduler approach via Edge Function self-invocation with vault-stored credentials).
- **"Run replay now" button** on the Settings → Migration UI. Admin clicks → React calls a new `public.run_replay_shadow(text)` RPC that proxies the Edge Function call. RPC is SECURITY DEFINER and admin-only via the same JWT user_metadata.role check that gates the Migration tab.
- **`public.parity_dryrun_check_drift()` proxy wrapper** so the harness can invoke `parity_dryrun.check_drift()` via supabase-js. Tracked as a P1.7 follow-up.

**Edge function shape (for future builders adding more shadow handlers):**
1. Add an entry to `SHADOW_REGISTRY` in `replay-shadow/index.ts`: `{ shadow: 'your-handler-shadow', action: 'yourActionName' }`. `function_key` (the registry key) must match a `feature_flags.function_key`; `action` matches `gas_call_log.action`.
2. Author the corresponding `your-handler-shadow` Edge Function. For pure handlers, mirror `update-item-shadow`. For stateful handlers, follow the design in MIG-007 layer 2 (read state from parity_dryrun, write would-be state back).
3. Per MIG-008, deploy with placeholder external-service env vars.
4. Run `POST /functions/v1/replay-shadow` with `{function_key: 'yourFunctionKey'}` to test.

---

## Function inventory (shipped 2026-05-11)

`stride-gs-app/FUNCTION_INVENTORY.md` is now the canonical reference for **every function in every Apps Script project** that the migration touches. **1,196 functions across 30 files in 8 projects**, each with a plain-English description, what-it-affects note, and migration-phase tag (`done` / `P2`–`P7` / `internal-helper` / `retiring` / `out-of-scope`).

### Headline numbers from the inventory

| Project | Files | Functions |
|---|---|---|
| StrideAPI | 1 | 556 |
| Consolidated Billing | 10 | 158 |
| Master Price List | 1 | 18 |
| Client Inventory (per-tenant × 49) | 13 | 240 |
| Stax Auto Pay | 1 | 76 |
| QR Scanner | 2 | 35 |
| Task Board | 1 | 56 |
| Stride Designer Campaign | 1 | 57 |
| **TOTAL** | **30** | **1,196** |

### Findings from the inventory pass worth carrying forward

1. **Two parallel CB invoice flows still wired up** — legacy Phase-2 (`StrideGenerateInvoices` → `StrideApproveOrVoidInvoices`, Invoice_Review approval queue, HTML→Doc PDFs) and modern (`CB13_createAndSendInvoices` → `CB13_commitInvoice`). Operator menu hits the modern one; Phase-2 helpers (~9 functions) tagged `retiring` but still in the codebase. **P4b cleanup target** alongside the CB sheet retirement.
2. **Three parallel IIF export paths** — staging-sheet two-step, combined wrapper, modern direct-from-selection. All tagged P4b/P6; `qboCreateInvoice` direct push will displace them.
3. ~~`getNextShipmentId` is still using the racy Master-RPC `doPost` counter~~ — **Resolved 2026-05-11**: shipped the v38.182-style SEQUENCE migration. `public.shipment_no_seq` + `public.next_shipment_no()` SQL function created; `api_nextShipmentNo_` in StrideAPI v38.206.0 now routes through Supabase. Master-RPC `getNextShipmentId` route still in place for backward compat but no longer called by StrideAPI. Migration file: `supabase/migrations/20260511190000_shipment_no_atomic_counter.sql`.
4. ~~`processRepairDeclinedById_` may be missing from Task Board~~ — **Moot (2026-05-11)**: Task Board is decommissioned (replaced by React app's task views when the React app was created). No operators use it, so the missing function can't break anything. Task Board project tagged `decommissioned` in `FUNCTION_INVENTORY.md`.
5. **Two parallel email-send paths** in Client Inventory — `sendTemplateEmail_` (Emails.gs, full-featured with cache fallback + deep-link self-heal) and `SH_sendTemplateEmail_` (Triggers.gs shared-handler block, lighter). They diverge on cache usage and the self-heal logic. P3's email-handler migrations need to consolidate or explicitly document the divergence.
6. **Dead-code candidates for P7 cleanup** — `StrideRequestInspection` (Utils.gs), `buildWorkOrderHtml_` (Repairs.gs), `generateTaskWorkOrderPdf_` (Tasks.gs as of v4.3.0), `getImportInventoryDialogHtml_` (Import.gs), the 8-function `getEditableRanges_*` family + `clearAllProtections_` (Utils.gs, both gated by commented-out `StrideClientApplyProtections`), `backfillImpShipmentFolderUrls_` (one-shot, already applied). All currently tagged `retiring` in the inventory.
7. ~~Shared-handler parity contract~~ — **No longer a forward concern (2026-05-11)**: Task Board is decommissioned, so the `SH_*` parity contract between Client Inventory `Triggers.gs` and `task board script.txt` is now one-way. Client Inventory IS the canonical SH_* source. Task Board's copy is frozen historical reference. P3/P4a migrations can rewrite the `SH_*` block (or replace it entirely with SB-side Edge Functions) without coordinating with Task Board.
8. ~~Master Price List `ensureEmailTemplatesSheet_` template HTML stripped~~ — **Moot (2026-05-11)**: email templates were moved to Supabase `email_templates` and are no longer called from Master Price List. The whole `ensureEmailTemplatesSheet_` / `exportTemplatesAsMap_` / `exportEmailTemplates` path is dead code. Tagged `retiring` in the inventory.

### Next-step plan: dashboard integration (Layer 2)

The Settings → Migration tab today renders the 25-flag substrate. With the inventory now in place, the next build is to expand the tab to render **all 1,196 functions** with coverage stats per project + per phase.

Plan:

1. **New migration** `migration_function_inventory` — a SQL table with one row per inventoried function:
   ```
   function_key text PRIMARY KEY     -- e.g. "stride-api:handleCompleteTask_"
   project text NOT NULL              -- "stride-api" | "consolidated-billing" | etc.
   file_path text NOT NULL
   category text                       -- e.g. "billing", "helper-format"
   description text                    -- plain-English description from FUNCTION_INVENTORY.md
   affects text                        -- what-it-affects column
   migration_phase text                -- "done" | "P2" .. "P7" | "internal-helper" | "retiring" | "out-of-scope"
   updated_at timestamptz DEFAULT now()
   ```
2. **Seed the table** by parsing `FUNCTION_INVENTORY.md` once via a `seedMigrationInventory.py` admin script. Re-runnable when the doc changes.
3. **Extend Settings → Migration tab** to:
   - Add a "Function coverage" widget at the top showing total / migrated / in-progress / not-started across all 8 projects.
   - Below the existing 25 feature-flag table, add a function-level table grouped by project, paginated/searchable.
   - Filter controls: by project, by category, by phase, by migration status.
4. **Link the two surfaces**: when a function in the new function-level table corresponds to a feature-flag row (the 25 top-level handlers), link them so flipping the flag updates both.

Scope estimate: one session for the migration + seed script (~3 hours); one session for the Settings UI extension (~3 hours). Total ~1 day's work to give Justin the complete coverage view.

### How to keep `FUNCTION_INVENTORY.md` current

Per its own "How to keep this doc current" section: add/update/remove rows as part of the PR that touches the function. Also part of the standard end-of-session doc updates per `CLAUDE.md`. Once Layer 2 ships (the SQL table + UI), every doc update should also issue a small upsert to `migration_function_inventory` so the dashboard reflects reality.

---

## Open questions / blockers

- [ ] **P1.2 organic-traffic verification** — Web App v494 was deployed at 2026-05-09T05:02:05Z but had zero `doPost` calls in the post-deploy window (Friday evening PST). On the next session start (Monday morning), run the smoke query in `BUILD_STATUS.md` "Recent Changes (2026-05-09, [MIGRATION-P1.2])" → "Pending user action" → smoke query. Expected: non-zero rows in `gas_call_log` since deploy, non-null `correlation_id` on the matching `entity_audit_log` rows. If still zero traffic-derived rows, investigate.
- [x] ~~`GAS_API_URL` + `GAS_API_TOKEN` Edge Function secrets~~ — **already set** in Supabase dashboard (confirmed by Justin, 2026-05-09). SB→GAS reverse-writethrough plumbing is ready end-to-end; any P2+ SB-primary handler can call `reverseWritethrough()` without env-var configuration.
- [ ] **Canary tenant nomination** — needed before any function flips to `canary_active`. Justin to nominate a low-volume tenant (likely a recently-onboarded test tenant or an opt-in active tenant). Not blocking P1.
- [ ] **PDF source migration** — `INSP_EMAIL` and `CLAIM_SETTLEMENT` are blocked on moving the PDF source off Drive (attachments path landed in PR #182). Not blocking P1–P3; will block portions of P4.
- [ ] **Direct-sheet-edit → Supabase gap (P2 design decision)** — pre-existing limitation: when an admin edits a per-tenant sheet directly (Inventory, Tasks, Billing_Ledger), the change does NOT push to Supabase. Today's writethrough (`api_writeThrough_`) only fires from `doPost` handler call sites; sheet `onEdit` triggers in client scripts (Triggers.gs v4.8.0 as of PR #322) propagate WITHIN the sheet but do not call StrideAPI. Backstops: PR #322's `propagate_sidemark_to_billing` Postgres trigger catches inventory.sidemark via the React-edit path; full-client sync (`api_fullClientSync_`) catches everything on its next run. **Decision needed before P2.1 (`updateItem`)**: does P2's SB-primary `updateItem` need a sheet→SB writethrough mechanism for admin direct edits, or is "direct sheet edits are admin-only and rare; full-sync backstops them" acceptable for the migration window? If the former, scope a small `onEdit → POST writeThroughForward` endpoint as part of P2.1's design. If the latter, document explicitly so future incident postmortems don't relitigate it.
- [x] ~~`getNextShipmentId` racy counter~~ — **Resolved 2026-05-11**. Shipped: migration `20260511190000_shipment_no_atomic_counter.sql` creates `public.shipment_no_seq` (seeded at 1000, max production shipment_number was 358) + `public.next_shipment_no()` SQL function. StrideAPI v38.206.0 rewrites `api_nextShipmentNo_` as a thin wrapper around `api_nextShipmentNoSupabase_` — mirror of `api_nextInvoiceNo_` / `api_nextInvoiceNoSupabase_` from v38.182.0. Atomic by Postgres design; same dup-number race class closed. The Master-RPC `getNextShipmentId` action is left in place for backward compat (will retire in P7 alongside Master). Verified post-apply: `peek_shipment_no_seq()` → 999, `next_shipment_no()` → "SHP-001000" then "SHP-001001", strictly monotonic.
- [x] ~~Task Board `processRepairDeclinedById_` may be missing~~ — **Moot (2026-05-11)**: Task Board is decommissioned per Justin. The missing function can't break operator workflows because no operator uses Task Board. No follow-up needed.
- [x] ~~Master Price List `ensureEmailTemplatesSheet_` template HTML stripped from source~~ — **Moot (2026-05-11)**: email templates were moved to Supabase `email_templates` and are no longer called from Master Price List per Justin. The `ensureEmailTemplatesSheet_` / `exportTemplatesAsMap_` / `exportEmailTemplates` doGet route are all dead code. Tagged `retiring`. No follow-up needed.

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
- **`FUNCTION_INVENTORY.md`** — every function in every GAS project with plain-English description + what-it-affects + migration phase. 1,196 functions across 30 files. Authoritative function-level reference (MIG-011).
- **BUILD_STATUS.md** — global change log. Migration-specific entries here use the `[MIGRATION-Pn]` tag for grep.
- **`_archive/Docs/Archive/Session_History.md`** — one-liner per session, also `[MIGRATION-Pn]` tagged.
- **`supabase/parity-fixtures/`** — incident-derived regression suite. Each fixture self-documents via its JSON shape.
- **`Dropbox\Apps\GS Inventory\GAS_to_Supabase_Migration_Roadmap_v1.1.docx`** — stakeholder snapshot. Do NOT treat as authoritative for execution.
