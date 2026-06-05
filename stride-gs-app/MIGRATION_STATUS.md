# GAS → Supabase Migration — Living Status

> Last updated: 2026-06-05 — **[MIGRATION-P6 / payments] Stax "test invoice" is now 100% Supabase — first Stax write fully off GAS.** Branch `feat/payments/test-stax-invoice-sb`. New native EF `create-test-stax-invoice` (NOT a `-sb` proxy, NOT a shadow): MIG-017 admin/staff gate → resolve/create Stax customer id (caller-supplied → `public.clients` lookup → `POST /customer` + persist back) → insert `public.stax_invoices` (`is_test=true`, PENDING, row shape == legacy GAS `handleCreateTestInvoice_`) → optional immediate `POST /invoice` to Stax (`pushToStax`, default true) stamping `stax_id`+CREATED. Fail-closed on push failure (PENDING row survives + `success:false`, the #632 guard) so the batch `create-stax-invoices-sb` can still push it. **Routing is deliberately bypassed:** React `Payments.tsx` invokes the EF via `supabase.functions.invoke` directly (NOT apiPost/`GAS_TO_SB_MAP`/feature-flag) — `createTestInvoice` removed from `GROUPED_STAX_ACTIONS` + `stax-actions-sb`. This is the **Stax-migration proving ground**: validating the Stax API integration works through SB de-risks migrating `createStaxInvoices`/`runStaxCharges` off GAS. `STAX_API_KEY`+`SUPABASE_ANON_KEY` already in EF secrets; deployed `verify_jwt=true`. No feature flag, no schema change, no billing-counter touch. Legacy GAS `handleCreateTestInvoice_` left intact (unused; P7 cleanup). — Earlier 2026-06-04 — **[MIGRATION-P6 / payments] `qboReconcileInvoices` migrated to a native SB Edge Function — `qbo-reconcile-payments` (NO GAS).** Branch `feat/payments/qbo-reconcile-ef`. v38.242.0 shipped the QBO payment-status reconcile as a GAS handler (`handleQboReconcileInvoices_`) + the `invoice_tracking` payment columns (`20260528160000`) + the React "Reconcile with QBO" button. This PR completes the migration of that action: a native Deno EF queries QBO for every pushed invoice (Phase 1 per-id `GET /invoice/{id}` for rows with `qbo_invoice_id`; Phase 2 bulk Query API `SELECT … FROM Invoice WHERE TxnDate >= … MAXRESULTS 1000 STARTPOSITION n` for historical/pre-fix rows, matched by DocNumber→invoice_no then `Stride INV# X` in PrivateNote), writes `qbo_balance`/`qbo_paid`/`qbo_doc_number`/`qbo_invoice_id`/`qbo_last_verified_at` back onto `invoice_tracking`, and logs "pushed-per-Stride but missing in QBO" rows to `billing_activity_log` (action=`qbo_push_failed`). OAuth refresh + token handling cloned from `qbo-create-invoice-sb`. **Auth:** admin-user JWT (React button, role=`admin`) OR service-role bearer (the daily pg_cron sweep bypasses the user-role check). **Routing:** new `GAS_TO_SB_MAP.qboReconcileInvoices → { ef: 'qbo-reconcile-payments', flagKey: 'qboReconcile' }`; migration `20260604120000_qbo_reconcile_payments_route.sql` seeds the flag at `active_backend='gas'`. **🚩 FLIP HELD — QBO secrets not in Supabase.** The QBO OAuth creds (`QBO_CLIENT_ID/SECRET/REFRESH_TOKEN/REALM_ID`) live ONLY in GAS Script Properties (set at runtime by the OAuth callback), not in Supabase EF secrets — confirmed by invoking the deployed EF (returns `CONFIG_ERROR` with the 4 missing names) and by `GET /v1/projects/.../secrets` (QBO_* absent). Same gap applies to the sibling `qbo-create-invoice-sb`, which has never been flag-flipped either. So the EF is deployed + verified-functional (auth path runs; service-role cron path validated) but cannot reach QBO until an operator mirrors those 4 secrets. Flipping React to the EF before then would `CONFIG_ERROR` the admin button in prod while the GAS handler still works — so the flag is held on `gas` (verification-column-only writes mean no MIG-016 writethrough gate; the gate here is purely the credential mirror). **Go-live (operator, 2 steps): (1) `npx supabase secrets set QBO_CLIENT_ID=… QBO_CLIENT_SECRET=… QBO_REFRESH_TOKEN=… QBO_REALM_ID=… --project-ref uqplppugeickmamycpuz` (copy from GAS Script Properties or re-run QBO OAuth); (2) `UPDATE feature_flags SET active_backend='supabase' WHERE function_key='qboReconcile'` + schedule the cron.** **UI:** the existing Invoices-header button is now admin-only, relabeled "Sync Payment Status", and sweeps ALL pushed-but-unverified invoices (empty scope, server-capped 500/run — covers the ~229-invoice backlog in one pass); the realtime `invoice_tracking` subscription refreshes the Paid/Unpaid badges automatically. **Cron:** `20260604130000_qbo_reconcile_cron.sql` installs pg_cron + pg_net; the env-specific `cron.schedule('qbo-reconcile-payments-daily', '17 9 * * *', …)` is applied out-of-band (embeds the service-role JWT — same pattern as `dt-sync-statuses`). Revert: flip `qboReconcile` flag → `gas` (GAS handler still present).

> Earlier 2026-05-30 — **[BILLING / P4a-adjacent] New `public.storage_billing_items` per-item storage billed-tracking table** (migration `20260530160000_storage_billing_items.sql`, branch `feat/billing/storage-item-tracking`). Storage invoices stay ONE summary line per sidemark (StrideAPI v38.250.0); this table is the durable per-item record (status Unbilled→Invoiced→Void, linked by `summary_ledger_row_id`) so storage is never double-billed or missed. Written by GAS — `handleCommitStorageRows_` (per-item overlap dedup + working-set replace + insert), `handleCreateInvoice_` (stamp Invoiced by summary id), `handleVoidInvoice_` (→Void), `handleReissueInvoice_` (→Unbilled) — all best-effort/fail-safe; billing stays GAS-authoritative. **15th `parity_dryrun` mirror member** (mirror + `reset()`/`row_counts`/`check_drift()` updated in the same migration per the schema-sync convention). Forward-compatible substrate the future P4a SB-primary `createInvoice` will read directly. **Not yet applied to prod; GAS not yet deployed (operator-gated).**

> Earlier 2026-05-22 — **[MIGRATION-P2/P3/P4a/P5/P6 / MIG-016 / MIG-017] Round 3: 17 new SB-primary handlers + admin-role gate on real-money EFs.** Branch `feat/migration/batch-handlers-and-routing` extends `GAS_TO_SB_MAP` to cover **28 actions** (was 5) — every previously-shadow-only flag now has a real `-sb` Edge Function in source. New handlers: P2 (`update-task-sb`, `update-repair-sb`, `transfer-items-sb`), P3 receive/email (`complete-shipment-sb`, `send-shipment-email-sb`, `send-task-complete-email-sb`, `send-will-call-emails-sb`), P4a billing-core (`create-invoice-sb`, `void-invoice-sb`, `reissue-invoice-sb`, `commit-storage-charges-sb`), P5 onboarding (`onboard-client-sb` — HYBRID, GAS retains Drive/Sheets provisioning), P6 payments (`qbo-create-invoice-sb`, `create-stax-invoices-sb`, `run-stax-charges-sb`, `import-iif-sb`), reports (`generate-unbilled-report-sb`). All follow the `update-item-sb` canonical pattern. Real-money handlers (Stax/QBO/IIF) gain new **MIG-017** explicit admin/staff role gate — closes the anon-key-bundled-in-browser-build vector. None of the 17 are flag-flipped yet (`active_backend='gas'`); each remains gated on MIG-007 layer-2 replay + layer-3 canary before any production tenant joins `tenant_scope`. Per-function table NOT updated this session — operator deploy + canary nomination drive the next state transitions. Phase status: P6 moves `not_started → in_progress` (P6 handlers now exist; not yet shadowed against `gas_call_log` corpus). Deploy is operator-pending per BUILD_STATUS.md "Pending User Actions" (builder env has no SUPABASE_ACCESS_TOKEN; 22 deploys queued).

> Earlier 2026-05-21 (round 2) — **[MIGRATION-P2-P3 / MIG-016] Round 2 adds 4 more real -sb handlers + tasks reverse-writethrough writer.** Routing layer + `update-item-sb` (round 1) + now `batch-create-tasks-sb` (createTask), `release-items-sb` (releaseItems), `create-will-call-sb` (createWillCall), `process-wc-release-sb` (processWcRelease). StrideAPI v38.227.0 introduces `__writeThroughReverseTasks_` — 6th per-table writer against the P1.4 framework. GAS_TO_SB_MAP now covers 5 actions. completeShipment intentionally deferred (3hr port; needs its own PR for Drive folders + email + auto-task creation). Per-function table updated below. Deployment is operator-pending per BUILD_STATUS.md Pending User Actions.

> Earlier 2026-05-21 (round 1) — **[MIGRATION-P2 / MIG-016] First SB-primary routing layer + `update-item-sb` real handler shipped (worktree, pending merge + deploy).** Branch `feat/migration/route-and-update-item` introduces `src/lib/apiRouter.ts` with `GAS_TO_SB_MAP` (action → EF slug + flag key) + `invokeSupabaseHandler`; `apiPost` consults `resolveRoute` BEFORE the GAS path. When `feature_flags.<flagKey>.active_backend` resolves to `'supabase'` for the caller's tenant, the call lands on the SB Edge Function instead of GAS. `update-item-sb` is the first real -sb handler (not a shadow): validates payload, UPDATEs `public.inventory`, cascades to open `public.tasks` + `public.repairs` for syncable fields, cascades Sidemark/Reference to Unbilled `public.billing` rows, auto-cancels open tasks/repairs on a true Released-transition (with " | <note>"-append matching GAS), fires reverse-writethrough to the per-tenant Inventory sheet, writes `entity_audit_log` matching the GAS shape exactly. StrideAPI v38.226.0 extends `__writeThroughReverseInventory_` to support general field updates (vendor / description / reference / sidemark / room / location / item_class / qty / item_notes / declared_value / coverage_option_id) alongside the legacy release-only path — required so the SB EF can mirror inventory edits back to the per-tenant sheet without throwing 'row.status required'. **New decision MIG-015 below** — Justin Demo Account canary override of MIG-007. Per-function table updated (`updateItem` moves to `handler_drafted`). **Deployment is operator-pending**: deploy GAS v38.226.0 FIRST, then deploy the EF, then flip the flag for Justin Demo only.

> Earlier 2026-05-20 — **[MIGRATION-P1.9] Live audit-shape shadow firing wired into apiPost for 20 GAS actions.** New `src/lib/shadowRegistry.ts` + `src/lib/fireShadow.ts` + a one-line hook in `src/lib/api.ts` after every successful apiPost: the matching shadow EF fires fire-and-forget, compared against a synthesized GAS audit shape (deterministic from payload, not the GAS handler's full response — avoids timing-artifact false positives). Covers updateInventoryItem, updateTask* (4 variants), updateRepairNotes, startTask, startRepair, cancelRepair, sendRepairQuote, respondToRepairQuote, requestRepairQuote, completeTask, completeRepair, batchCreateTasks, createWillCall, processWcRelease, releaseItems, transferItems, commitStorageRows, reissueInvoice, completeShipment, onboardClient. **startTask `41/41` artifact fix:** retired the `apiCall(...start-task SB primary...)` wrap in TaskDetailPanel that ran the SB primary as the shadow second (GAS already started the task), producing different response shapes. The new audit-shape comparator against `start-task-shadow` is deterministic from the payload (`{status:{new:'In Progress'}}`) and independent of GAS-side state — should drop the 41/41 to 0 once traffic resumes. New decision **MIG-015**. Per-function table updated below. Not wired (no shadow EF deployed yet): `createInvoice`, `voidInvoice`, `qboCreateInvoice`, `createStaxInvoices`, `runStaxCharges`, `importIIF`, `generateUnbilledReport` — P4a/P6 prereqs. Email flags (`sendShipmentEmail`, `sendTaskCompleteEmail`, `sendWillCallEmails`) intentionally skipped — emails fire as server-side side-effects from host handlers (receiveShipment / completeTask / processWcRelease), not as standalone React apiPost actions.

> Earlier 2026-05-20 — **Fifth per-table reverse-writethrough writer shipped: `clients`.** `__writeThroughReverseClients_` (StrideAPI v38.224.0) replaces the stub for the `clients` table in `REVERSE_WRITETHROUGH_TABLES_` — writes both the per-tenant Settings tab (key/value via `CLIENT_FIELDS_[*].clientSettingsKey`) and the CB Clients tab (per-column via `CLIENT_FIELDS_[*].cbHeader`) so SB-authoritative client-settings changes flow App → Supabase → GAS Sheet without the CB-driven `handleResyncClients_` silently overwriting them on the next pass. New Edge Function `push-client-settings-to-sheet` is the SB-side caller; new migration `20260520140000_clients_writeback_trigger.sql` adds an AFTER INSERT OR UPDATE trigger on `public.clients` (guarded by `IS DISTINCT FROM` on every mirrored column to avoid recursion when GAS resyncs identical values). `apply-intake-on-submit` Edge Function gets an explicit belt-and-suspenders invoke so refresh-mode intakes propagate with predictable latency. The five writers now in production: inventory (v38.208), will_calls (v38.213), repairs (v38.215), billing (v38.217), clients (v38.224). Remaining stubs: tasks, shipments, will_call_items, addons, invoice_tracking, entity_notes, item_photos, stax_invoices, stax_charges — each ships in its corresponding P2/P3/P4 PR when that handler migrates.

> Earlier 2026-05-19 — **100% shadow coverage across all 33 `feature_flags` functions.** 15 new shadows deployed today: 5 operational (`create-will-call-shadow`, `release-will-call-shadow`, `create-task-shadow`, `release-items-shadow`, `transfer-items-shadow` — PR #450), 3 billing-core (`processWcRelease-shadow`, `commit-storage-charges-shadow`, `reissue-invoice-shadow` — via Supabase MCP), 4 simple (`update-task-shadow`, `update-repair-shadow`, `receive-shipment-shadow`, `onboard-client-shadow` — via Supabase MCP), 3 email (`send-shipment-email-shadow`, `send-task-complete-email-shadow`, `send-will-call-emails-shadow` — via Supabase MCP). `replay-shadow` upgraded to **v10** (16 functions registered). Every one of the 33 `feature_flags` rows now has `parity_enabled=true` or `active_backend='supabase'`. **620 parity checks run, 0 logic mismatches** — `updateItem` 300/0, `completeTask` 146/0, `releaseItems` 54/0, `updateTask` 26/0, `processWcRelease` 13/0, `releaseWillCall` 13/0, `createWillCall` 11/0, `requestRepairQuote` 9/0, `transferItems` 5/0, `completeRepair` 1/0, `updateRepair` 1/0; `startTask` 41/41 is a known timing artifact (shadow fires before the GAS write lands), NOT a logic divergence. Infra: **Parity Dashboard merged + live at `#/migration` (PR #451)**; new views `parity_summary`, `parity_mismatches_recent`, `parity_billing_shadow`; new `untracked_gas_actions` table + trigger (monitors GAS actions with no shadow coverage — 7 identified, `batchUpdateItemLocations` highest at 64 corpus calls); `run_parity_replay()` Postgres bulk-replay function. New decision **MIG-014**. Per-function table + Phase status updated below. Backlog grew: notification-routing system, `batchUpdateItemLocations` shadow, live `apiCall` shadow wiring (only `startTask` + `completeTask` fire shadows from the React app today — every other function still needs its `apiCall` path wired for real-time shadowing).

> Earlier 2026-05-13 (later) — **P3 repair cluster: 4-of-6 handlers shipped via Path-C** (PRs #405 + #406 + #407 + #408). `cancelRepair` (smoke-tested), `startRepair`, `sendRepairQuote` (+ Resend email), `respondToRepairQuote` (+ Resend Approved/Declined email). All deployed at `active_backend='gas'`; flip in Settings → Migration to activate (gas → supabase, `tenant_scope=NULL` for fleet-flip — Justin's plan since repairs are low-volume). Two remaining for the cluster: **`requestRepairQuote` single-item** (~30 min — wire TaskDetailPanel + ItemDetailPanel to existing `request-repair-quote-sb` with `itemIds:[oneItem]`) and **`completeRepair`** (P4a, ~4-5 hrs — new `__writeThroughReverseBilling_` writer for per-tenant Billing_Ledger + new `mirrorBillingToCb` GAS endpoint for the separate CB spreadsheet + REPAIR_COMPLETE email). Architectural call confirmed: SB needs only ONE billing table (`public.billing` with `tenant_id` column), not two — the per-tenant + consolidated split exists in GAS only because Google Sheets can't aggregate across spreadsheets. StrideAPI bumped to v38.216.0 — `__writeThroughReverseRepairs_` covers all 17 repair columns including the 8 quote_* fields. SHADOW_REGISTRY in `replay-shadow` lists 5 entries (updateItem + 4 repair P3). Critical security pattern carried through every handler: JWT signature verified via `supabase.auth.getUser(token)` against anon-keyed client (NOT just `atob` decode — the cancelRepair code review caught the forgeable-token issue and the fix propagated to all subsequent handlers).

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
| **P1 — parity infrastructure** | **done** | `feature_flags`, `parity_results`, `gas_call_log` tables; `correlation_id` on `entity_audit_log`; GAS-side input capture; `parity_dryrun` schema; reverse writethrough harness; React `FeatureFlagProvider`; Settings → Migration UI; replay harness Edge Function; **Parity Dashboard (#/migration, PR #451)**; `parity_summary` / `parity_mismatches_recent` / `parity_billing_shadow` views; `untracked_gas_actions` table+trigger; `run_parity_replay()` | Sub-phases below; P1.8 added 2026-05-19. 100% shadow coverage reached. |
| P2 — simple writes | **in_progress** | `updateItem`, `updateTask`, `updateRepair`, `updateShipment` | Shadows live + parity-clean: `updateItem` 300/0, `updateTask` 26/0, `updateRepair` 1/0. Not yet flipped (`active_backend='gas'`). |
| P3 — status changes | **in_progress** | `startTask`, `startRepair`, `createTask`, `createWillCall`, `releaseItems`, `transferItems`, `releaseWillCall`, status-only emails (shipment/WC/repair-quote/task-complete) | All shadows deployed + parity logging. `createWillCall` 11/0, `releaseItems` 54/0, `transferItems` 5/0, `releaseWillCall` 13/0; `startTask` 41/41 timing-artifact (not logic). Email shadows deployed (no parity volume yet). |
| P4a — billing core | **in_progress** | `completeTask`, `completeRepair`, `processWcRelease`, `commitStorageCharges`, `createInvoice`, `voidInvoice`, `reissueInvoice` | Per-tenant + SB mirror + `invoice_tracking`. Shadows live + parity-clean: `completeTask` 146/0, `completeRepair` 1/0, `processWcRelease` 13/0; `commit-storage-charges-shadow` + `reissue-invoice-shadow` deployed. |
| P4b — CB retirement | not_started | CB `Consolidated_Ledger` retire + QBO direct push (replacing IIF) | Prereq: P6's `qboCreateInvoice` ships first. |
| P5 — complex flows | **in_progress** | `receiveShipment`, `transferItems`, `onboardClient` | `receive-shipment-shadow`, `transfer-items-shadow`, `onboard-client-shadow` deployed. `transferItems` 5/0; receive/onboard no parity volume yet. |
| P6 — payments | **in_progress** | `qboCreateInvoice`, `createStaxInvoices`, `runStaxCharges`, `importIIF` | Real-money handlers built (PR `batch-handlers-and-routing`); admin/staff role gate per MIG-017; deploy operator-pending. `stax_invoices` table is fleet-wide by design (no tenant_id) — the role gate is the security boundary, not tenant isolation. |
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

| P1.8 | **done** | 2026-05-19 (PRs #450 + #451 + Supabase MCP) | **100% shadow coverage + observability surface.** 15 new shadow Edge Functions deployed so all 33 `feature_flags` functions have `parity_enabled=true` or `active_backend='supabase'` (5 operational PR #450; 3 billing-core + 4 simple + 3 email via Supabase MCP). `replay-shadow` → **v10** (16 functions in `SHADOW_REGISTRY`). **Parity Dashboard** merged + live at `#/migration` (PR #451) with views `parity_summary`, `parity_mismatches_recent`, `parity_billing_shadow`. `untracked_gas_actions` table + insert-trigger detects GAS actions with no shadow registered (7 found; `batchUpdateItemLocations` 64 corpus calls = highest). `run_parity_replay()` Postgres function for bulk replay. 620 parity checks executed, 0 logic mismatches (see top note + per-function table). |

P1 exit: P1.1–P1.7 all merged + one shadow handler wired end-to-end with parity logging proven. **Reached 2026-05-12 with PR #349.** P1.8 (2026-05-19) extended to 100% shadow coverage + the Parity Dashboard observability surface — Phase 1 now **done**.

---

## `parity_dryrun` schema-sync convention

The `parity_dryrun.*` mirrors created in P1.3 must stay column-shape-identical to their `public.*` sources. Drift breaks the replay harness silently — a shadow `INSERT` may succeed but produce a state hash that doesn't match prod.

**Rule:** every future migration that ALTERs a `public.*` table in the mirror set MUST also ALTER the corresponding `parity_dryrun.*` mirror in the same migration file.

**Mirror set** (15 tables — 14 from P1.3 + `storage_billing_items` added 2026-05-30):
`inventory`, `tasks`, `repairs`, `shipments`, `will_calls`, `will_call_items`, `billing`, `addons`, `invoice_tracking`, `entity_notes`, `item_photos`, `clients`, `stax_invoices`, `stax_charges`, `storage_billing_items`.

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

Match-rate column is the rolling 7-day match rate from `parity_results`. **Parity here = MIG-007 layer-1 (per-call state diff); historical 90-day replay (layer 2) is still deferred per MIG-013.** "Replay corpus" column now doubles as the 2026-05-19 parity-check count where a shadow has logged comparisons. All 33 rows carry a shadow as of 2026-05-19 (100% coverage); none are flipped (`active_backend='gas'`, pending canary nomination).

| Function | Backend | Parity checks (5/19) | Match rate | Fixtures | Canary tenant | State | Last touched |
|---|---|---|---|---|---|---|---|
| `updateItem` | gas | 300 | **100%** (300/0) | 0 | Justin Demo (pending operator flag-flip — MIG-016) | **handler_drafted** (SB-primary EF built, routing layer merged, awaiting deploy) | 2026-05-21 |
| `updateTask` | gas | 26 | **100%** (26/0) | 0 | n/a | **handler_drafted** (`update-task-shadow` deployed 5/19) | 2026-05-19 |
| `updateRepair` | gas | 1 | **100%** (1/0) | 0 | n/a | **handler_drafted** (`update-repair-shadow` deployed 5/19) | 2026-05-19 |
| `updateShipment` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (shadow live, no parity volume yet) | 2026-05-19 |
| `startTask` | gas | 41 | ⚠ 0% (0/41) — **timing artifact, not logic**: shadow fires before the GAS write lands; one of only two functions wired to fire shadows live from the React app | 0 | n/a | **handler_drafted** (needs shadow-timing fix, not a logic divergence) | 2026-05-19 |
| `startRepair` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (PR #406, deployed, unflipped; shadow in `replay-shadow` registry) |
| `requestRepairQuote` (single-item) | gas | 9 | **100%** (9/0) | 0 | n/a | **handler_drafted** | 2026-05-19 (shipped PR #418; parity-clean) |
| `respondRepairQuote` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (PR #408, deployed, unflipped; shares `sendRepairEmails` flag) |
| `cancelRepair` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (PR #405, smoke-tested, deployed, unflipped) |
| `sendRepairQuote` | gas | 0 | n/a | 0 | n/a | **handler_drafted** | 2026-05-13 (PR #407, deployed, unflipped; shares `sendRepairEmails` flag) |
| `createTask` | gas | 0 | n/a | 0 | Justin Demo (pending operator flag-flip — MIG-016) | **handler_drafted** (`batch-create-tasks-sb` real handler built, awaiting deploy) | 2026-05-21 |
| `createWillCall` | gas | 11 | **100%** (11/0) | 0 | Justin Demo (pending operator flag-flip — MIG-016) | **handler_drafted** (`create-will-call-sb` real handler built, awaiting deploy) | 2026-05-21 |
| `releaseWillCall` | gas | 13 | **100%** (13/0) | 0 | n/a | **handler_drafted** (`release-will-call-shadow` deployed 5/19, PR #450) | 2026-05-19 |
| `releaseItems` | gas | 54 | **100%** (54/0) | 0 | Justin Demo (pending operator flag-flip — MIG-016) | **handler_drafted** (`release-items-sb` real handler built, awaiting deploy) | 2026-05-21 |
| `completeTask` | gas | 146 | **100%** (146/0) | 0 | n/a | **handler_drafted** (shadow live PR #447; one of only two functions firing shadows live from the React app) | 2026-05-19 |
| `completeRepair` | gas | 1 | **100%** (1/0) | 0 | n/a | **handler_drafted** | 2026-05-19 (shipped PR #419; parity-clean) |
| `processWcRelease` | gas | 13 | **100%** (13/0) | 0 | Justin Demo (pending operator flag-flip — MIG-016) | **handler_drafted** (`process-wc-release-sb` real handler built, awaiting deploy; partial-release child-WC creation deferred) | 2026-05-21 |
| `commitStorageCharges` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (`commit-storage-charges-shadow` deployed 5/19). ⚠️ **CUTOVER BLOCKER (2026-06-03):** the SB path (`commit-storage-charges-sb` → `generate_storage_charges` RPC) writes only `public.billing` — it does NOT write `public.storage_billing_items` at all. Flipping this flag to `supabase` would (a) lose the per-item billed-tracking that powers the Storage-tab Invoiced view + double-bill dedup, and (b) reintroduce the NULL `billable_days` regression just fixed for the GAS path (v38.259.0). Port the `storage_billing_items` write — including `billable_days` (= preview qty, else round(amount/rate)) — into the EF BEFORE the flag-flip. | 2026-05-19 |
| `generateStorageCharges` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (canonical alias of `commitStorageCharges`; shadow live) | 2026-05-19 |
| `createInvoice` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `voidInvoice` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `reissueInvoice` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (`reissue-invoice-shadow` deployed 5/19) | 2026-05-19 |
| `transferItems` | gas | 5 | **100%** (5/0) | 0 | n/a | **handler_drafted** (`transfer-items-shadow` deployed 5/19, PR #450) | 2026-05-19 |
| `receiveShipment` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (`receive-shipment-shadow` deployed 5/19) | 2026-05-19 |
| `onboardClient` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (`onboard-client-shadow` deployed 5/19) | 2026-05-19 |
| `qboCreateInvoice` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `createStaxInvoices` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `runStaxCharges` | gas | 0 | n/a | 0 | n/a | not_started | — |
| `sendShipmentEmail` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (`send-shipment-email-shadow` deployed 5/19) | 2026-05-19 |
| `sendWillCallEmails` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (`send-will-call-emails-shadow` deployed 5/19) | 2026-05-19 |
| `sendTaskCompleteEmail` | gas | 0 | n/a | 0 | n/a | **handler_drafted** (`send-task-complete-email-shadow` deployed 5/19) | 2026-05-19 |
| `sendRepairEmails` (non-terminal) | gas | 0 | n/a | 0 | n/a | **handler_drafted (both halves)** | 2026-05-13 (PRs #407 + #408) — flipping this flag activates BOTH send-quote and respond-to-quote |

**Parity summary (620 checks total, 2026-05-19):** 579 matches, 41 mismatches — and all 41 are `startTask`'s shadow-timing artifact (shadow runs before the GAS write commits, so the diff sees stale state). **Zero logic mismatches across every function.** `startTask` + `completeTask` are the only two functions whose `apiCall` paths fire shadows in real time from the React app today; every other function's parity volume comes from `replay-shadow` over the corpus. Wiring the remaining functions' live `apiCall` shadow paths is on the backlog (see Open questions / blockers).

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

### MIG-014 — 100% shadow coverage before any fleet flip; parity = layer-1 only; live `apiCall` shadowing is the remaining gap (2026-05-19)

**Decision:** Every one of the 33 `feature_flags` functions gets a deployed shadow Edge Function + `parity_enabled=true` (or is already `active_backend='supabase'`) **before** any function flips to a canary or fleet-primary backend. Coverage is breadth-first (all functions shadowed) rather than depth-first (one function driven to graduation at a time).

**Rationale:** The risk that bit prior incidents is a function silently diverging with no parity instrumentation watching it. Broad shadow coverage means the moment a function gets enough real traffic, divergence is visible in `parity_results` / the Parity Dashboard without further deploys. It also surfaces *coverage gaps* (GAS actions with no shadow at all) early — hence the `untracked_gas_actions` table + trigger, which found 7 unshadowed actions on day one (`batchUpdateItemLocations` highest at 64 corpus calls).

**What "parity-clean" means here (scope-limited):** the 2026-05-19 run is **MIG-007 layer-1 only** — per-call state diff against `parity_dryrun`. It is NOT historical 90-day replay (layer 2, still deferred per MIG-013) and NOT canary (layer 3, blocked on tenant nomination). 579/620 matches with 0 logic mismatches is strong evidence the rewrites are correct *on the inputs seen*, not a graduation signal. No function graduates on layer-1 alone.

**`startTask` 41/41 mismatch is explicitly not a logic bug.** `startTask` (and `completeTask`) are the only two functions whose React `apiCall` path fires the shadow in real time today. `startTask`'s shadow fires before the GAS write commits, so the diff compares against pre-write state and reports a mismatch every time. This is a **shadow-timing harness artifact**; the SB handler logic is not implicated. Do not "fix" it by changing handler logic. The real fix is sequencing the live shadow fire after the primary write resolves (tracked in the live-`apiCall`-wiring backlog item).

**The remaining gap — live `apiCall` shadow wiring.** Only `startTask` + `completeTask` fire shadows from the React app in real time. Every other function's parity volume is `replay-shadow` over the corpus. Real-time per-click parity for the other 31 requires wiring each function's `apiCall(...)` call site to fire its shadow (the `src/lib/apiCall.ts` substrate from PR #440 supports it; the call sites just aren't passing the SB shadow fn yet). This is the next structural push, not optional polish — replay-only coverage misses input shapes that only occur in live traffic.

**Scope:** This decision governs the verification *posture* (breadth-first shadowing, layer-1-is-not-graduation). It does not change MIG-007's three-layer graduation bar or MIG-013's repair-cluster replay skip.

### MIG-015 — Live shadow firing is hooked at `apiPost`, not per call site; audit-shape comparison, not full-response (2026-05-20)

**Decision:** The MIG-014 "live `apiCall` shadow wiring" gap closes via a single hook in `apiPost` (`src/lib/api.ts`) consulting a central `shadowRegistry` (`src/lib/shadowRegistry.ts`) — NOT by retrofitting `apiCall(...)` at every call site. The hook fires the registered shadow Edge Function fire-and-forget after every successful GAS call, with no caller awareness required. Comparison is between (a) the GAS audit-log shape synthesized deterministically from the input payload and (b) the shadow EF's `.changes` return — NOT between the GAS handler's full response and the shadow's full response.

**Rationale:**

The per-call-site `apiCall(...)` retrofit (the MIG-014 plan) would have required editing 20+ React files and would only have covered functions whose call sites had been migrated. A single `apiPost` hook covers every present and future React→GAS call automatically — opt-in is via the registry, opt-out by omission. New functions get shadow coverage by adding one registry entry, with zero call-site changes.

**Full-response comparison is unsound for live traffic.** The original `apiCall` design (PR #440) used the SB-primary handler as the shadow and compared full responses. That worked when the SB primary was a no-op or pure function. It broke for stateful operations: the GAS primary runs first and mutates state; the SB-primary-as-shadow runs second and sees the mutation, producing a different response. That is the root cause of `startTask`'s `41/41` mismatch under MIG-014 — a timing artifact misclassified as a logic bug.

**Audit-shape comparison sidesteps timing entirely.** The synthetic GAS audit shape is derived from the payload alone (e.g. `{status:{new:'In Progress'}}` for startTask) — independent of GAS-side state. The shadow EF derives the same shape from the same payload. If they match, both sides agree on what should change. If they diverge, the shadow's view of the operation diverges from what the GAS router logs. Either case is meaningful; neither false-positives on the second-call-saw-different-state pattern.

**Implementation rules:**

- The registry's `toAuditShape` MUST mirror the shadow EF's `.changes` shape exactly for the given payload — verified against the shadow's source where it lives in-repo (in-source shadows: update-item-shadow, complete-task-shadow, etc.) or by inspection where the shadow was MCP-deployed (the 15 from MIG-014). Drift produces 100% false-positive mismatches.
- Default `toAuditShape` (payload minus a common identifier set) covers the simple-update case. Per-function overrides for fixed-shape shadows, complex-shape shadows, and shadows where the strip set differs from the default.
- `fireShadow`'s synchronous spec derivation runs inside `try/catch` so a buggy `toAuditShape` never propagates into the apiPost success return.
- `runShadow`'s existing sb-side `try/catch` + early-no-op on `parity_enabled=false` keeps the hot path clean for unregistered actions and disabled parity.

**Scope:** Applies to functions whose React-side entry point is `apiPost(...)`. Functions that fire as server-side side-effects from a host handler (e.g. `sendShipmentEmail` from inside `receiveShipment`) are NOT wired here — their parity exercises via the host handler's parity check. Functions with no shadow EF deployed yet (`createInvoice`, `voidInvoice`, P6 payments, `importIIF`, `generateUnbilledReport`) are not registered and will not fire — adding the shadow + adding the registry entry happens in the same PR.

### MIG-017 — Real-money handlers (Stax/QBO/IIF) enforce explicit admin/staff role check (2026-05-22)

**Decision:** The four real-money Edge Functions — `qbo-create-invoice-sb`, `create-stax-invoices-sb`, `run-stax-charges-sb`, `import-iif-sb` — MUST validate the caller's JWT against `supabase.auth.getUser(token)` (anon-keyed client) and reject any caller whose `user_metadata.role` is not `'admin'` or `'staff'`. This check runs BEFORE any read of `public.stax_invoices` and BEFORE any external API call.

**Rationale:**

1. **The anon key is publicly bundled.** Every browser build ships `VITE_SUPABASE_ANON_KEY` so authenticated clients can call read-cache queries. `verify_jwt=true` at the gateway accepts any signed JWT — including JWTs minted by sign-up flows the public app supports. Without an explicit role check, a non-admin authenticated user could invoke the real-money handlers via direct `supabase.functions.invoke(...)` calls and trigger Stax charges or QBO pushes across the fleet.

2. **`public.stax_invoices` has no `tenant_id` column.** Per migration `20260416120000_stax_invoices_cache_table.sql`, the table is explicitly an "admin-only internal tool" mirroring the global Stax Auto Pay spreadsheet. There is no tenant-isolation boundary — the security boundary IS the role check. A `.eq('tenant_id', ...)` filter on stax_invoices would not just be redundant, it would break fleet-wide semantics (the table has no such column).

3. **GAS parity.** The GAS handlers (`handleRunStaxCharges_`, `handleCreateStaxInvoices_`, `handleImportIIF_`, `handleQboCreateInvoice_`) are all wrapped in `withStaffGuard_(callerEmail, ...)` which enforces the same admin/staff predicate by reading the user's CB Clients role. The SB-side handlers MUST mirror that behavior — silent divergence would be a regression of the legacy access control.

**Implementation:** every real-money handler starts with this gate:

```typescript
const authHeader = req.headers.get('Authorization') || '';
const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
if (!callerToken) {
  return jsonResponse({ error: 'Authorization header required', code: 'UNAUTHENTICATED' }, 401);
}
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const authClient = createClient(supabaseUrl, anonKey);
const { data: userData, error: authErr } = await authClient.auth.getUser(callerToken);
if (authErr || !userData?.user) {
  return jsonResponse({ error: 'Invalid token', code: 'UNAUTHENTICATED' }, 401);
}
const callerRole = String((userData.user.user_metadata as { role?: string })?.role ?? '').toLowerCase();
if (callerRole !== 'admin' && callerRole !== 'staff') {
  return jsonResponse({ error: 'admin/staff role required', code: 'FORBIDDEN' }, 403);
}
```

**Scope:** This decision applies to handlers that (a) write to fleet-wide tables (no `tenant_id`) AND (b) perform external API side effects with financial impact. It does NOT replace MIG-007's three-layer verification for tenant-scoped handlers — those still rely on per-tenant `tenant_id` filters as the primary boundary. The role check is additive to, not a substitute for, tenant scoping where tenant scoping exists.

**Future extensions:** the same gate pattern can be applied to other admin-only EFs as they're built — `markBillingActivityResolved`, `qbExport`, `getStaxInvoiceBatches`, `regenerateIifForBatch`, `qbExcelExport` are all candidates per the StrideAPI.gs `withStaffGuard_` audit. Each new admin-only EF should add an entry referencing MIG-017 in its file header.

### MIG-016 — Justin Demo Account canary override of MIG-007; SB-primary routing via apiPost (2026-05-21)

**Decision:** For the Justin Demo Account tenant only (and any tenant Justin explicitly nominates later), flip a function's `feature_flags.<key>.active_backend` to `'supabase'` directly, without waiting for MIG-007's three-layer verification (per-call diff + 90-day replay + canary). For ALL other tenants — every production client — `active_backend` stays at `'gas'` and `tenant_scope=[<justinDemoId>]` (per MIG-010's per-tenant scope semantics: tenant in scope → `supabase`, tenant not in scope → opposite = `gas`). This narrows the canary blast radius to one tenant Justin owns and observes directly.

The routing mechanism is **`apiPost`-driven**: `src/lib/apiRouter.ts` exports `GAS_TO_SB_MAP` (action → EF slug + flag key) + `invokeSupabaseHandler`; `apiPost` consults `resolveRoute` BEFORE the GAS path. Same module-level `FeatureFlagContext` snapshot the live-shadow firing (MIG-013/MIG-015) reads. SB-path errors surface to the caller — we do NOT silently fall back to GAS, because dual-write semantics from a broken SB handler would be worse than failing the user-visible save (the operator reverts the flag if the handler is broken).

**Rationale:**

1. **MIG-007's three-layer bar is right for production but blocks any forward progress on the canary tenant.** Layer 2 (90-day replay) requires substantial input-corpus collection and a stable shadow contract per stateful handler — multi-week effort per function. Layer 3 (14-day canary) requires a nominated tenant volunteer. Both gate the team from learning anything about SB-primary handler behavior under real-world editing patterns. Justin owns the demo tenant, has full visibility into the data, and can roll back at any time via the master switch (MIG-003).
2. **Per-tenant scope (MIG-010) makes the override safe.** Production tenants stay on GAS until they're explicitly added to `tenant_scope`. There is no scenario in which a regression in `update-item-sb` affects a production tenant's data because production tenants never hit the SB path.
3. **The full MIG-007 bar still applies before any production tenant flips.** This decision opens canary on Justin Demo; it does NOT lower the bar for fleet expansion. Each function still needs replay-clean + 14-day-canary-clean before its first production tenant joins `tenant_scope`.

**Implementation pattern (load-bearing — each future handler follows this same pattern):**

1. Build the real `<func>-sb` Edge Function (NOT a shadow). Validates payload, writes to the authoritative Supabase tables, fires reverse-writethrough(s) for the per-tenant sheet, cascades to dependent tables, writes `entity_audit_log` matching the GAS shape exactly. Response shape MUST match the GAS handler's so React callers are agnostic.
2. Extend the corresponding GAS reverse-writethrough writer if its current scope doesn't cover the new field set. The first such extension is `__writeThroughReverseInventory_` (v38.226.0) — handles general field updates, not just release.
3. Add an entry to `GAS_TO_SB_MAP` in `src/lib/apiRouter.ts`. The presence of an entry is the routing contract — backend resolution against `feature_flags.<flagKey>` determines whether the call goes SB or GAS at runtime.
4. Update the per-function table below with state `handler_drafted` (post-merge) or `canary_active` (post-deploy + flag flip).
5. Operator-deploy order: (a) GAS push-api/deploy-api so the reverse-writethrough writer extension is live, (b) Supabase EF deploy, (c) feature_flag flip via SQL (or Settings → Migration UI). Skipping (a) before (b)+(c) is a known landmine — the SB EF's row payload (which omits status on general edits) will throw the legacy "row.status required" error from the un-extended writer and the canary fails-closed on every save.

**Sheet-drift gap accepted on canary tenant:** the `update-item-sb` cascade fan-out (Tasks/Repairs/Billing) writes to Supabase tables but does NOT individually reverse-writethrough each cascade row to the per-tenant sheet. The Tasks/Repairs/Billing sheets drift on the canary tenant until the next `api_fullClientSync_` cron pass (~5–30 min). For production tenants this would be unacceptable; on Justin Demo it's an explicit canary-period trade-off — the alternative is shipping per-table reverse-writethrough writers for tasks + repairs + billing in the same PR, which triples the surface area for one canary function. Per-table writers ship in their own future PRs (tasks: stub today, ships with `updateTask`-sb; repairs: writer exists from v38.215 but doesn't cover field cascade; billing: writer exists from v38.217 but Sidemark/Reference fan-out via Postgres trigger covers the immediate need).

**Scope:** This decision opens the SB-primary path for canary tenants only. Every other architectural rule still holds — MIG-002 (synchronous reverse writethrough), MIG-003 (master switch is emergency revert only), MIG-006 (audit-log is the answer key), MIG-008 (stripped credentials on shadow EFs only — does NOT apply to SB-primary EFs, which need real credentials to do their job), MIG-010 (per-tenant scope semantics). The 13 stateful handlers still locked out of live shadow firing by MIG-013 stay locked out — `updateItem` was never in that 13.

**Pin (do not regress):** Do NOT add a silent fall-back-to-GAS on SB-path error in `apiPost`. The current behavior (surface the EF error to the caller) is intentional. Falling back masks handler bugs and produces dual-write paths where some operations land on GAS and others on SB depending on whether the SB handler errored. If a production tenant gets added to `tenant_scope` later, the same no-fallback rule applies — a regression in the SB handler should surface as user-visible save failures (which prompt operator investigation) rather than silently dual-writing through GAS.

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

### Migration backlog (added 2026-05-19)

- [ ] **Notification-routing system (blocks full migration of email handlers).** Email templates currently send to hardcoded addresses or `{{STAFF_EMAILS}}` (all staff). GAS had **per-client `NOTIFICATION_EMAILS` settings on each Sheet** — Supabase has no equivalent. Need a `notification_preferences` table configuring which emails/roles receive which template types, per tenant. Until this exists, the email shadows (`send-shipment-email-shadow`, `send-task-complete-email-shadow`, `send-will-call-emails-shadow`, repair-quote emails) can shadow-verify *content* but cannot be flipped to SB-primary without regressing per-client recipient routing. Example surfaced 2026-05-19: repair-quote email recipients were wrongly `{{STAFF_EMAILS}}` (all staff) and were corrected to `info@stridenw.com` + the client email — a manual patch that a `notification_preferences` table would make declarative. **Scope before flipping any email handler.**
- [ ] **`batchUpdateItemLocations` has no shadow (highest-volume untracked GAS action).** The `untracked_gas_actions` trigger flagged 7 GAS actions with no shadow registered; `batchUpdateItemLocations` is the highest at **64 corpus calls**. Needs a shadow + `replay-shadow` registry entry + `feature_flags` row before it can be parity-verified. The other 6 untracked actions are lower-volume — triage from `SELECT * FROM untracked_gas_actions ORDER BY call_count DESC`.
- [ ] **Live `apiCall` shadow wiring for the other 31 functions.** Only `startTask` + `completeTask` fire shadows in real time from the React app (`src/lib/apiCall.ts`). Every other function's parity comes from `replay-shadow` over the corpus, which misses input shapes that only occur in live traffic. Wire each function's `apiCall(...)` call site to pass its SB shadow fn so per-click parity logs in real time. Also fixes the `startTask` 41/41 timing artifact (sequence the live shadow fire *after* the primary write resolves). See **MIG-014**.

---

## Pending user actions

- [ ] **GO-LIVE for `qbo-reconcile-payments` (2026-06-04).** EF deployed + verified, migrations + React live, flag HELD on `gas`. Two steps to switch payment-status reconcile to the SB EF: (1) `npx supabase secrets set QBO_CLIENT_ID=… QBO_CLIENT_SECRET=… QBO_REFRESH_TOKEN=… QBO_REALM_ID=… --project-ref uqplppugeickmamycpuz` (values from GAS Script Properties), then (2) `UPDATE feature_flags SET active_backend='supabase' WHERE function_key='qboReconcile'` + schedule the cron from `20260604130000_qbo_reconcile_cron.sql`. The first EF call backfills all ~229 pushed invoices. See BUILD_STATUS.md Pending User Actions for the full command set + verify step. Blocker: QBO OAuth secrets live only in GAS Script Properties, not Supabase.
- [x] ~~Apply migration `20260516000000_parity_dashboard_views.sql`~~ — **Done 2026-05-19.** Dashboard merged as **PR #451** and deployed; `parity_summary`, `parity_mismatches_recent`, `parity_billing_shadow` views + `untracked_gas_actions` table/trigger + `run_parity_replay()` applied via Supabase MCP (operator-run — builder env has no service-role/MCP token). Dashboard live at `#/migration` and rendering data.
- [ ] **Nominate a canary tenant** (still the gating blocker for any flip). 100% shadow coverage + 0 logic mismatches on layer-1 parity is reached; the next step for any function is MIG-007 layer-3 canary, which needs Justin to nominate a low-volume tenant. No function can move past `handler_drafted` until this lands.
- [ ] **Triage the 7 untracked GAS actions.** `SELECT action, call_count FROM untracked_gas_actions ORDER BY call_count DESC` — `batchUpdateItemLocations` (64 calls) needs a shadow first. See Migration backlog above.

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
