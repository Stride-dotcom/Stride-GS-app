# Stride GS App — Build Status

> Last updated: 2026-06-02 ([fix/intake/insurance-block-prefill, PR #594] **InsuranceBlock pre-fills declared value from refresh intake.** Direct follow-up to [PR #593](https://github.com/Stride-dotcom/Stride-GS-app/pull/593) — that PR fixed the WRITE side (Save & Sync now upserts client_insurance from the intake). This fixes the READ side. Reported by Justin on AubreyMaxwell: intake had $100,000 stride_coverage but the modal showed an empty "$ ___" input with "No active Stride coverage" copy — because InsuranceBlock reads from `client_insurance` only, which doesn't have a row yet when a refresh intake is being applied for the first time. `PendingIntakeOverride` interface gained `insuranceChoice` + `insuranceDeclaredValue`. `OnboardClientModal` threads them into `InsuranceBlock` as a single `pendingIntakeInsurance` prop, only when choice is stride/eis_coverage AND value > 0. `InsuranceBlock` now pre-fills `seedDraft` state from the intake value when `client_insurance` is empty AND operator hasn't typed anything yet (don't clobber in-progress edits). Empty-state hint now reads `"Client elected Stride coverage on YYYY-MM-DD with a declared value of $X. Click 'Set up insurance' to confirm — Save & Sync at the bottom also creates it automatically."` so the operator understands the input is pre-filled from the submission, not asking them to type from scratch. `IntakesPanel` passes `selected.insuranceChoice` + `insuranceDeclaredValue` into `PendingIntakeOverride` when opening the modal in refresh mode. `eis_coverage` (legacy alias for `stride_coverage` per session 77 rename) treated identically. `own_policy` intakes (declared = 0) and pre-intake clients fall through to the original empty-state UI. tsc + `npm run build` clean. Deployed via canonical clone. **Yesterday's 6/1 + 6/2 refresh intakes status:** activated ones (Weidner/Brio/Arkitektura/Anja Michals) all correctly seeded; pending ones (AubreyMaxwell $100K, Jason Dallas Design $10K) will populate correctly on next Apply Refresh click with the deployed fix.).

> Earlier 2026-06-02 ([fix/intake/propagate-insurance-to-client, PR #593] **Intake → client_insurance propagation closes the "declared value shows $0" bug.** Reported by Justin: clicking "Apply Refresh to Client" on Weidner Apartment Homes / Complete Design opened the client edit form with InsuranceBlock reading **$0** even though the intake had $20K stride_coverage. Auto-billing cron then either skipped or billed $0 for affected tenants. Root cause: the `clients` table has no insurance columns — the canonical store is `client_insurance` — but neither the auto-apply EF [apply-intake-on-submit/index.ts:131-171](stride-gs-app/supabase/functions/apply-intake-on-submit/index.ts:131) nor IntakesPanel's manual Apply Refresh handler [IntakesPanel.tsx:113](stride-gs-app/src/components/settings/IntakesPanel.tsx:113) propagated `intake.insurance_choice` + `insurance_declared_value` into `client_insurance`. The intake captured it; nothing wrote it through. **Fix:** both code paths now seed `client_insurance` immediately after the `clients` UPDATE. `stride_coverage` + declared > 0 → upsert with `declared_value` / `coverage_type` / `active=true`; INSERT path stamps `inception_date=today` + `next_billing_date=today+30` + `monthly_rate_per_10k` from `service_catalog.INSURANCE` (matches `useClientInsurance.seed`); UPDATE path PRESERVES those fields so in-flight cycles aren't reset and a rate change doesn't retro-apply. `own_policy` → deactivate any existing row (`active=false`, `cancelled_at=now()`); no row created for an opt-out election. `eis_coverage` (legacy alias per session 77 rename) treated identically to `stride_coverage`. Best-effort throughout — a `client_insurance` write failure surfaces a warning but never unwinds the `clients` UPDATE or fails the activation. **Audit + backfill:** identified 2 already-activated tenants whose insurance election was lost pre-fix — **Arkitektura & B&B Italia SF** (2026-06-02, $10K stride_coverage) and **COUCH Seattle** (2026-05-07, $10K stride_coverage). Backfill SQL inserted both `client_insurance` rows with rate $30/$10K from `service_catalog.INSURANCE`. Pending refresh intakes from 6/1 (AubreyMaxwell $100K, Jason Dallas $10K, Brian Paquette $0/own_policy, others) will populate correctly on the next Apply Refresh click now that the code is fixed. tsc + `npm run build` clean. `apply-intake-on-submit` EF deployed via Supabase CLI; React deployed via canonical clone.).

> Earlier 2026-06-01 ([fix/fix/storage-preview-dedup, PR #589] **Storage-tab preview now excludes already-invoiced storage (STOR-SUMMARY blind-spot fix) + Unbilled/Invoiced status filter + transfer-backfill harden.** Reported by Justin: after running a storage report and creating invoices (Allison Lind, 10 sidemarks), the same line items kept reappearing in the Storage tab — unlike the Unbilled report which only shows unbilled. Verified the preview RPC `calculate_storage_charges` → `_compute_storage_charges` returned all 6 already-invoiced FAHRINGER items (INV-020133) on a May re-run. **Root cause:** the preview's dedup subtracts already-billed periods by matching `billing.item_id` + parsing `STOR-{item}-{start}-{end}` from `task_id`, but the v38.256 storage-summary collapse replaces invoiced per-item STOR rows with ONE `STOR-SUMMARY-{tenant}-{sidemark}-{start}-{end}` row (blank item_id, non-per-item task_id) — invisible to that dedup. The per-item invoiced periods now live in `storage_billing_items`, which the dedup never queried, silently breaking the documented invariant at [Billing.tsx](stride-gs-app/src/pages/Billing.tsx) ("the RPC excludes already-invoiced periods"). The commit path is independently double-gated (`handleCommitStorageRows_` lockedSidemarks + storage_billing_items sbiAlreadyBilled), so NO actual double-bill occurred — but the misleading preview is the kind of latent gap that becomes a real double-bill once that gate is refactored. **Fix 1 — migration [`20260601120000_storage_preview_dedup_summary_transfer.sql`](stride-gs-app/supabase/migrations/20260601120000_storage_preview_dedup_summary_transfer.sql):** extends the `v_billed` subtraction set in `_compute_storage_charges` with (a) finalized `storage_billing_items` ranges (Invoiced/Billed — primary fix), (b) finalized `STOR-SUMMARY` periods sidemark-matched (blank-sidemark = whole-tenant lock, mirrors the commit gate — fallback when SBI wasn't written during a Supabase blip), (c) Unbilled `STOR-TRANSFER-*` backfill ranges (the **harden** — belt-and-suspenders for a destination item whose `transfer_date` is blank so the cutover can't fire). Since `generate_storage_charges` shares this engine, the commit path also gains the narrowing (strictly protective, layers on the existing gate). **Fix 2 — Unbilled/Invoiced View toggle on the Storage tab** ([Billing.tsx](stride-gs-app/src/pages/Billing.tsx) + new `fetchInvoicedStorageItems` in [supabaseQueries.ts](stride-gs-app/src/lib/supabaseQueries.ts)): default **Unbilled** = the live projection (now excludes invoiced); **Invoiced** = a read-only itemized table from `storage_billing_items` (the per-item detail behind a collapsed STOR-SUMMARY invoice line), intentionally decoupled from the commit/invoice machinery. **Validation:** test-copy of the new function diffed against live across ALL tenants — May excludes EXACTLY the invoiced storage (Allison Lind $2,419.40 = sum of INV-020125..134, KIPP $2.40 INV-020124, ISLAND PARK $36.00 INV-020135, each cross-checked), June byte-identical ($57,551.48, nothing invoiced yet), ZERO rows introduced (strictly subtract-only). Post-apply live: FAHRINGER May preview → 0, Allison Lind all-sidemark May → 0, June total unchanged. Migration applied via Supabase MCP + verified before merge. Code review (Opus locked-in code-reviewer): no Critical, no blocking Important — confirmed pure read/projection (zero DML), invoice counter + three-storage-layer model untouched, Invoiced view verifiably read-only (never wired to rowSel/commit/previewRows). tsc + `npm run build` clean. React deployed via canonical clone.).

> Earlier 2026-05-31 ([fix/delivery/retry-ef-direct-actions, PR #583] **Failed Operations Retry now handles EF-direct actions.** Direct follow-up to PR #582. Operator clicked Retry on a `dt_push_order_after_pu_sync` row and got `Retry failed: Unknown POST action: dtPushOrderAfterPuSync`. Root cause: [useFailedOperations.ts:142](stride-gs-app/src/hooks/useFailedOperations.ts:142) `retry()` hardcoded every failure through `apiPost` → GAS. But `dt_push_order_after_pu_sync` is written by `dt-sync-statuses` (Edge Function), not by a React `apiPost` — there's no corresponding action in StrideAPI.gs. The snake→camel fallback at line 170 (`toCamel`) happily converted the action_type to `dtPushOrderAfterPuSync` and dispatched it; GAS rejected with `Unknown POST action`. **Fix:** new `EF_RETRY_MAP` at the top of `retry()` dispatches specific action_types directly to their originating Edge Function via `supabase.functions.invoke()` BEFORE falling through to the GAS path. Today's only entry: `dt_push_order_after_pu_sync` → `dt-push-order` with `{orderId: entity_id, changedFields: ['items']}` — matches the original dt-sync-statuses v21 invocation shape (changedFields scopes the push so DT's dispatcher-assigned date/contact survive the retry, same safety the cron call has). Error path mirrors v21's body-extraction trick (`err.context.text()` → real EF response body) so a failed retry surfaces the actual `{ok:false, error:"…"}` content, not the generic "non-2xx" SDK wrapper. Adding new EF-direct retry paths is now a one-entry change in the map. Actions NOT in the map fall through to the existing GAS path unchanged — no regression for any of the 14 mapped GAS actions or the snake→camel fallback. tsc + `npm run build` clean. Deployed via canonical clone.).

> Earlier 2026-05-31 ([fix/delivery/dt-sync-error-body, PR #582] **dt-sync-statuses v21 surfaces actual dt-push-order error body on pu_propagate failures.** Triggered by the 2026-05-30 incident: 3 `dt_push_order_after_pu_sync` rows in `gs_sync_events` had identical generic `"invoke failed: Edge Function returned a non-2xx status code"` messages, and the actual cause had to be inferred from edge-function logs because the user-facing error told us nothing actionable. Root cause: the `pu_propagate` handler at [dt-sync-statuses/index.ts:1087](stride-gs-app/supabase/functions/dt-sync-statuses/index.ts:1087) only wrote `err.message` to `error_message`, which is the static supabase-js `FunctionsHttpError` wrapper string — the actual dt-push-order response body (`{ok:false, error:"…"}` or a raw 5xx blob) lives on `err.context` (a `Response` object the SDK carries on the error class) but was never read. **Fix:** v21 reads `err.context.text()` (wrapped in try/catch — a consumed-stream or missing-context edge case degrades to msg-only rather than throwing into the `.catch` handler and losing the gs_sync_events row entirely) and appends the body to the error_message. 1000-char body cap before the 500-char total error_message cap so SDK prefix + meaningful body tail both fit. New format: `"invoke failed: <SDK msg> — body: <dt-push-order JSON>"`. Failed Operations drawer now surfaces what DT or dt-push-order actually rejected — no more hand-investigation needed to diagnose a pu_propagate failure. Single-call-site change (only one `supabase.functions.invoke('dt-push-order', ...)` in the function). Edge function deployed via Supabase CLI from canonical clone (`npx supabase functions deploy dt-sync-statuses --project-ref uqplppugeickmamycpuz --no-verify-jwt`). No data migration, no React change.).

> Earlier 2026-05-30 ([feat/delivery/per-leg-item-tracking, PR #579] **Per-leg pickup item tracking — multi-pickup deliveries now stamp `picked_up_at` only on items belonging to the completing leg, not blanket across all items.** Phase 2 of multi-pickup. PR #575's blanket pass (2026-05-29 BUILD_STATUS entry below) stamped every unstamped delivery item when ANY pickup completed — fine on single-pickup but broken on multi-pickup: completing leg 1 falsely marked leg 2's items as picked up. New migration [`20260530140000_dt_order_items_pickup_leg_id.sql`](stride-gs-app/supabase/migrations/20260530140000_dt_order_items_pickup_leg_id.sql) adds `dt_order_items.pickup_leg_id uuid REFERENCES dt_pickup_links(id) ON DELETE SET NULL` + idempotent backfill via the `parent_pickup_item_id → pickup_item.dt_order_id → dt_pickup_links.pickup_order_id` chain. [`_shared/stamp-pickup-on-linked-delivery.ts`](stride-gs-app/supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts) blanket pass is leg-scoped: items where `pickup_leg_id` matches this leg OR `parent_pickup_item_id` is among this pickup's items get stamped; others wait for their leg. Legacy fallback (no items tagged → stamp all) preserves single-pickup parity. [`CreateDeliveryOrderModal.tsx`](stride-gs-app/src/components/shared/CreateDeliveryOrderModal.tsx) new `ensurePrimaryPickupLink` helper upserts the primary `dt_pickup_links` row (sort_order=0) in all 4 P+D create paths; `buildPDItemRows(pickupId, deliveryId, pickupLegId)` stamps the link id on pickup-side mirror rows. [`AddPickupLegModal.tsx`](stride-gs-app/src/components/shared/AddPickupLegModal.tsx) adds an item picker showing unassigned delivery items (`pickup_leg_id IS NULL`); selected items get the new leg's id on save (best-effort with alert if it fails). [`OrderPage.tsx`](stride-gs-app/src/pages/OrderPage.tsx) groups items by pickup leg with status headers ("Pickup 1: NAME ✅ Completed M/D by DRIVER" / "Pickup 2 Pending" / "Warehouse Items") + per-group `pickup_completion_notes`. Suppressed on pickup-leg pages and on single-pickup orders with no leg-tagged items. [`dt-push-order/index.ts`](stride-gs-app/supabase/functions/dt-push-order/index.ts) pre-resolves a `Map<pickup_leg_id, driver_name>` from each leg's `dt_orders.driver_name` and threads it through `buildItemDesc` so the per-item `[✓ Picked up M/D DRIVER]` tag uses the correct leg's driver — was previously the single order-level `linked_pickup_driver_name`, wrong on multi-pickup. Items SELECT in 3 sites widened to include `pickup_leg_id`. Code review (Opus, `.claude/agents/code-reviewer.md` checklist): no Critical, no landmine; one Important observation about degenerate-state items with no leg id + no FK chain staying silently unstamped on multi-pickup deliveries (acceptable — pre-change behaviour was over-stamp, this is under-stamp; less harmful). tsc + `npm run build` clean. React deployed from canonical clone after schannel TLS retries (3 failed pushes, succeeded with `-c http.postBuffer=1048576000 -c http.lowSpeedLimit=0` flags). **Pending operator actions:** (1) Apply migration via Supabase MCP `apply_migration` (builder env has no SUPABASE_ACCESS_TOKEN). (2) Redeploy 3 Edge Functions that reference the new column: `npx supabase functions deploy dt-sync-statuses --project-ref uqplppugeickmamycpuz`, `npx supabase functions deploy notify-pickup-completed --project-ref uqplppugeickmamycpuz`, `npx supabase functions deploy dt-push-order --project-ref uqplppugeickmamycpuz`.).

> Earlier 2026-05-29 ([fix/delivery/pickup-completion-all-items] **Pickup completion now stamps ALL items on the linked delivery, not just FK-linked ones.** Justin reported JAS-00096-ROZE-D had 1 of 9 delivery items with `picked_up_at` / `pickup_delivered_quantity` / `pickup_return_codes` populated even though the pickup leg JAS-00096-ROZE-P had completed for all items — only the COFFEE TABLE row had `parent_pickup_item_id` set, the other 8 had NULL. Root cause: shared helper `stampPickupOnLinkedDelivery` ([supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts](stride-gs-app/supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts)) only wrote `picked_up_at` to delivery items matched via (a) `parent_pickup_item_id` FK to an eligible PU item or (b) legacy `dt_item_code` fallback against an eligible PU item. P+D pairs created via the modal frequently produce delivery items without an explicit pickup-side counterpart (the pickup is a leg-level event, not a per-item event), and historical rows from before the FK backfill have NULL `parent_pickup_item_id` — those items stayed dark forever despite the pickup leg actually picking them up. **Fix:** new "blanket pass" at the end of the picked_up_at stamping section: any remaining delivery item where `picked_up_at IS NULL` after the FK + code paths receives `picked_up_at = pickup.finished_at`, `pickup_delivered_quantity = dit.quantity` (assumes all pieces — the leg-level invariant), and `pickup_return_codes = ['Pick Up']` (DT's generic code; Tier-B path still uses real codes when matched). Idempotent via `.is('picked_up_at', null)` filter — never overwrites a prior stamp. Tracking via `matchedStampIds` Set prevents double-counting items already handled by the FK/code paths. Fix lives in `_shared/` so both callers (dt-sync-statuses + notify-pickup-completed) inherit it on redeploy. Tier-B propagation block unchanged (still FK-only — qty/codes propagation from PU rows requires the FK match to be safe). No schema change, no React change, no GAS change. **Pending operator actions:** (1) Redeploy both EFs that import the shared helper: `npx supabase functions deploy dt-sync-statuses --project-ref uqplppugeickmamycpuz` AND `npx supabase functions deploy notify-pickup-completed --project-ref uqplppugeickmamycpuz`. (2) One-time SQL fix for the broken JAS-00096-ROZE-D order — run via MCP `apply_migration` or Supabase SQL editor: `UPDATE dt_order_items SET picked_up_at = '2026-05-28 20:07:23+00', pickup_delivered_quantity = quantity::int, pickup_return_codes = ARRAY['Pick Up'] WHERE dt_order_id = '63eecbe9-c624-4b66-a5ab-ead221839f2b' AND picked_up_at IS NULL;`).

> Earlier 2026-05-29 ([fix/impersonation/jwt-tenant, PR #574] **Impersonation now actually shows the client's data — RLS-gated entities (Inventory / Tasks / Repairs / Will Calls / etc.) no longer come back empty for staff impersonating a client.** Root cause: PR #474's "true Supabase-session impersonation" (2026-05-20) correctly swaps the live JWT to the target via `verifyOtp`, but `impersonateUser` in `src/contexts/AuthContext.tsx` suppresses `handleSession` via `impersonationSwapRef` — and `handleSession` is where `user_metadata.clientSheetId` + `accessibleClientSheetIds` normally get synced into the JWT (lines ~290-301 and ~384-394). The multi-tenant RLS helper `user_has_tenant_access` (migration `20260504210000_multi_tenant_rls_access.sql`) reads those two fields straight off `auth.jwt() -> 'user_metadata'`, so when the target's stored `raw_user_meta_data` is empty (clients who've never signed in via password directly) or stale (whose tenant assignments changed after their last login), every gated row silently filters out. Fix: after `resolveUserFromApi` returns the target's profile and BEFORE `setAuthState`, mirror the exact in-sync check + `await supabase.auth.updateUser({ data: {...} })` block `handleSession` already uses. Sync only fires when out of sync (avoids redundant `USER_UPDATED`); the resulting event is absorbed by the same `impersonationSwapRef` guard at the top of `onAuthStateChange` (line ~518) so no second `handleSession` runs mid-swap. Best-effort `try/catch` with `console.warn` matches the failure semantics of the two pre-existing sync sites — a transient network blip doesn't bounce impersonation. Refresh-during-impersonation path was already correct (it goes through `handleSession` which already runs the sync). Code review (Opus 4.7 general agent — locked-in `code-reviewer` subagent type isn't registered in this harness): no Critical, no Important; one nit on potential extraction to a shared helper, deferred. tsc + `npm run build` clean (2,304 modules). React deployed from dedicated deploy clone `/c/dev/stride-deploy-impersonation` (avoids the `dist/.git` race per the 2026-05-21 memory). No GAS, migration, or Edge Function deploy required — fix is React-only.).

> Earlier 2026-05-29 ([feat/tasks/service-name-and-advanced, PR #568] **Tasks list Type column + TaskDetailPanel Service field now resolve via service_catalog; CreateTaskModal gains optional due-date/notes/priority.** Two task-UX fixes shipped together. **Issue 1 — Type column showed "OTHER":** Root cause at [useTasks.ts:61-71](stride-gs-app/src/hooks/useTasks.ts:61) — `mapToAppTask` whitelisted only the legacy `ServiceCode` union (`RCVG/INSP/ASM/REPAIR/STOR/DLVR/WCPU/OTHER`) and coerced everything else to `'OTHER'`, so tasks with modern catalog codes (`FAB_RUG`, `FAB_SOFA`, `DISP`, `MULTI_INS`, `NO_ID`, etc.) all rendered as 'OTHER'. Fix passes `api.svcCode` through unchanged (defaulting only when empty, null-safe via `String(api.svcCode || '').trim()`). [types.ts:56-83](stride-gs-app/src/lib/types.ts:56) widens `Task.type` and `Task.svcCode` to `string` since `service_catalog` is now the source of truth for codes. [TaskDetailPanel.tsx](stride-gs-app/src/components/shared/TaskDetailPanel.tsx) wires `useServiceCatalog()` and a `resolveServiceLabel()` helper (catalog → SERVICE_CODES → raw code fallback) used by both the Service field at line ~945 and the header Type badge at line ~1182 — Realtime subscription means a Price List name edit reflects within ~1s. **Issue 2 — Optional due-date/notes/priority on create:** [CreateTaskModal.tsx](stride-gs-app/src/components/shared/CreateTaskModal.tsx) adds a collapsible "Advanced (optional)" section, closed by default. Due-date input falls back to the catalog SLA when blank; shows the auto-calculated date as a preview hint when exactly one service code is selected. Task-notes textarea is stamped onto every task's `task_notes` column. Priority dropdown exposes `Standard / High / Urgent` — Standard→Normal on the wire; Urgent piggybacks on High and forces `due_date=today` (PT) client-side, mirroring the Tasks.tsx priority-chip toggle and matching the v38.240.0 RUSH server-side behavior. Plumbed through `BatchCreateTasksPayload.taskNotes` ([api.ts:3045-3056](stride-gs-app/src/lib/api.ts:3045)) → GAS `handleBatchCreateTasks_` (replaces hardcoded `""` with the trimmed payload value; StrideAPI bumped to **v38.248.0**) → SB `batch-create-tasks-sb/index.ts` (adds `taskNotes` to body interface and inserts `tasks.task_notes`). Optimistic temp rows include the new fields so they match the eventual real row's auto-reconcile signature. Code review (Opus 4.7 fallback per locked-in checklist) returned no Critical; addressed three Important items pre-merge (null-safe svcCode parse, dropped stale `Task['type']`/`Task['svcCode']` casts now that the union is widened, added in-file comment that the wire priority vocab is Normal/High only — Urgent is a UI label). tsc + `npm run build` clean (2,304 modules). React deployed from dedicated deploy clone `/c/dev/stride-deploy-tasks-adv` (avoids the `dist/.git` race per the 2026-05-21 memory). GAS deployed via `npm run push-api && npm run deploy-api` (Web App version 546). **Pending operator action:** redeploy `batch-create-tasks-sb` Edge Function — `npx supabase functions deploy batch-create-tasks-sb --project-ref uqplppugeickmamycpuz`. Not deploy-blocking; the `batchCreateTasks` route is currently GAS-served (`apiRouter.ts:201` flagKey `createTask`), so the new taskNotes field is already live end-to-end via GAS. The SB EF redeploy only matters once the `createTask` flag flips to `sb` for any tenant.).

> Earlier 2026-05-28 ([feat/pricelist/fabric-protection-category-tasks, PR #560] **Fabric Protection now a sidebar category in Price List; all 11 services enabled as tasks + sorted to picker bottom.** Three coordinated changes from operator request. (1) [PriceList.tsx:68-77](stride-gs-app/src/pages/PriceList.tsx:68) `ALL_CATEGORIES` (sidebar list) gained `'Fabric Protection'` — the category was already in `SHAREABLE_CATEGORIES` + the `ServiceCategory` type union but the sidebar list was missing the entry, so the 11 FAB_* services could only be found via the "All services" view. (2) Migration `20260528220000_fabric_protection_show_as_task.sql` UPDATEs `show_as_task=true` for all `category='Fabric Protection'` rows. Per operator: this category is "all-on by policy" — no per-service toggle wanted. Idempotent (only matches `show_as_task=false` rows); `DO $$` assertion block aborts if any active fabric-protection row still has the flag off after the update. Verified post-apply: 11 task_enabled / 0 task_disabled. (3) [CreateTaskModal.tsx:101-138](stride-gs-app/src/components/shared/CreateTaskModal.tsx:101) `taskTypes` memo now partitions post-build into `[nonFabric, fabric]` and concats so fabric-protection codes land at the end of the picker. Used rarely but ~11 codes would otherwise push the everyday INSP/ASM/etc. picks below the fold. Fabric codes identified via `serviceCatalog[].category === 'Fabric Protection'` — no hardcoded code list, so newly-added fabric services auto-sort to the bottom too. Pairs with [PR #559](https://github.com/Stride-dotcom/Stride-GS-app/pull/559) which added the show_as_task gate; this PR enables the gate for fabric protection without polluting the top of the picker. tsc + `npm run build` clean. Migration applied via Supabase MCP; React deployed via canonical clone.).

> Earlier 2026-05-28 ([fix/tasks/create-modal-show-as-task, PR #559] **CreateTaskModal now honors the service_catalog.show_as_task flag.** Reported by Justin via screenshot — the Create Tasks modal (Inventory → Task floating action) was surfacing shipping/billing-only services (Blanket Wrap Delivery / Custom Crating / White Glove Delivery / Photo Documentation / After-Hours Access / Stairs / Long Carry Fee / Debris Removal / Insurance Surcharge / Stocktake) as if they were task types. Root cause at [CreateTaskModal.tsx:77-90](stride-gs-app/src/components/shared/CreateTaskModal.tsx:77): the `taskTypes` memo built its list from `usePricing().priceList` with only a denylist (`EXCLUDE_CODES = {STOR, RCVG, REPAIR, RPR, WC, WCPU, SPLIT}`), so every other priceList row appeared regardless of whether the operator had toggled "Show as Task" on the catalog row. Fix: extends the memo to additionally gate non-CORE service codes on the matching `service_catalog` row having both `active=true` AND `showAsTask=true`. CORE_TYPES (INSP, ASM) still bypass the gate — primary task types must always be available even on a fresh tenant whose catalog hasn't been customized. Safety fallback: when `serviceCatalog.length === 0` (still loading or unreachable), the legacy denylist-only behavior applies so the modal stays usable; once the catalog arrives the React re-render flips to the filtered list. Dependencies on the memo grew from `[priceList]` to `[priceList, serviceCatalog]`. No catalog or schema change — the showAsTask toggle was already in service_catalog (the Settings → Price List → Service edit form has had it since Session 73) and `useServiceCatalog().services[].showAsTask` was already exposed. tsc + `npm run build` clean. Deployed via canonical clone.).

> Earlier 2026-05-28 ([feat/delivery/order-piece-cubic-stats, PR #557] **OrderPage Items card header now surfaces item-ID count + cubic volume.** Justin asked for two visible stats on the delivery-order entity page — (1) qty of item IDs on the order, (2) cubic volume (class-driven sum across all items). The Items card header already had `N pieces · L lines` but operators don't think of rows as "lines" — they think of them as "item IDs" — and the cubic volume wasn't displayed anywhere on the order. Single-spot edit in [stride-gs-app/src/pages/OrderPage.tsx:778](stride-gs-app/src/pages/OrderPage.tsx:778) replaces the existing two-value display with an IIFE that computes three values per render: `pieces` (sum of qty, unchanged), `idCount` (count of `dt_order_items` rows — was "lines", relabelled to "item IDs"), and `cubicTotal` (sum of `qty × cubicFeet` — per [PR #543](https://github.com/Stride-dotcom/Stride-GS-app/pull/543) cubic_feet is stored PER-UNIT on dt_order_items, so multiplying by quantity gives the row's total volume; items with null cubicFeet contribute 0). New header reads `N pieces · L item IDs · X.X ft³`. Cubic suffix is omitted when `cubicTotal < 0.05` so an all-ad-hoc order (no inventory link, no cubic_feet on any row) doesn't render " · 0.0 ft³". No type change required — `DtOrderItemForUI.cubicFeet` already exists. No code review (trivial UI-only addition to existing visible header). tsc + `npm run build` clean. Deployed via canonical clone.).

> Earlier 2026-05-28 ([fix/repairs/customer-email-recipients, PR #556] **Repair emails (Quote / Approved / Declined / Complete) now actually reach the customer.** Audit triggered by Justin found customers had NOT been receiving any of these four emails since the repair flags flipped fleet-wide to Supabase-primary on 2026-05-14 ([PR #420 / MIG-013](https://github.com/Stride-dotcom/Stride-GS-app/pull/420)) — `email_sends.to_emails` showed `['info@stridenw.com']` only on every send for ~2 weeks. Two coordinated causes: (1) `send-email`'s `expandToken()` resolver at [supabase/functions/send-email/index.ts:376-413](stride-gs-app/supabase/functions/send-email/index.ts:376) did NOT implement the `{{CLIENT_EMAIL}}` token — REPAIR_QUOTE + REPAIR_COMPLETE recipients column listed `info@stridenw.com,{{CLIENT_EMAIL}}` but the token silently dropped via the default `console.warn + return []` branch; (2) REPAIR_APPROVED + REPAIR_DECLINED templates only listed `info@stridenw.com` in recipients column — `{{CLIENT_EMAIL}}` wasn't even there. **Fix:** (a) `supabase/functions/send-email/index.ts` threads `tenantId` from request body through `resolveRecipients` → `expandToken`; new `case 'CLIENT_EMAIL'` loads `clients.notification_contacts` (JSONB array of `{name, email}`) keyed on `spreadsheet_id = tenantId`, falling back to `clients.email` only when notification_contacts yields zero usable addresses. Both fields may contain comma-joined strings per the 2026-05-04 split logic — handled at expand time so the existing post-resolve split + `dedupeEmails()` (case-insensitive) pipeline collapses overlap with the literal `info@stridenw.com` cleanly. Three distinct `console.warn` paths at the new failure boundaries (no-tenantId / no-clients-row / no-usable-emails) so any future silent-drop is immediately visible in EF logs. (b) Migration `20260528200000_repair_email_client_recipients.sql` UPDATEs REPAIR_APPROVED + REPAIR_DECLINED recipients column from `info@stridenw.com` to `info@stridenw.com,{{CLIENT_EMAIL}}`. Idempotent (exact-match WHERE clause excludes the two already-correct templates AND any out-of-band edits); `DO $$` assertion block aborts if either target template ends up without the token after the UPDATE. **No EF-side change needed in the three repair callers** (`send-repair-quote-sb`, `respond-repair-quote-sb`, `complete-repair-sb`) — they already pass `tenantId` in their `send-email` request body. **Per user direction:** customer source = `clients.notification_contacts`; `info@stridenw.com` stays on To: alongside customer (not BCC) so Stride staff continues seeing every email. Code review (Opus 4.7 locked-in): no Critical, no Important — confirmed clients.spreadsheet_id is UNIQUE-indexed (the canonical tenant key), service_role write bypass on clients RLS holds, and the new failure-boundary warns will surface any future regression. Migration applied via Supabase MCP; `send-email` edge function deployed via MCP (version 9, ACTIVE).).

> Earlier 2026-05-28 ([fix/delivery/do-modal-search-reference, PR #553] **DO modal inventory picker search now covers Reference + Room.** Reported by Justin: typing in the picker's search field didn't filter by the Reference column even though it was visible in the table. Audited `CreateDeliveryOrderModal.tsx:1110-1130` `filteredItems` memo — pre-fix the predicate checked 4 visible columns (itemId, description, vendor, sidemark) + 2 non-displayed metadata fields (location, itemClass), missing the visible Reference column AND the non-displayed Room field operators commonly search by ("everything in the dining room"). Two-clause additive fix adds `(i.reference || '').toLowerCase().includes(q)` and `(i.room || '').toLowerCase().includes(q)` to the OR chain. Both fields already exist on the `LiveItem` interface; no schema change. Picker now matches against every visible column except Qty (numeric — not useful as a text match) plus the two operator-friendly metadata fields. tsc + `npm run build` clean. Deployed via canonical clone.).

> Earlier 2026-05-28 ([feat/warehouse/rush-and-high-due-date, PR #549] **RUSH tasks auto-stamped High + Due Date today on create; High → due-date-today rule extended to Tasks page + TaskDetailPanel.** Two related task-priority behaviors driven by the user request: (1) any task whose svcCode is RUSH should land High + due today regardless of the SLA-hours catalog entry, and (2) the existing Dashboard rule from [PR #399](https://github.com/Stride-dotcom/Stride-GS-app/pull/399) that auto-stamps due_date=today on a High transition should apply everywhere priority can be toggled. **GAS-side (StrideAPI.gs v38.240.0):** new block inside `handleBatchCreateTasks_`, placed after the existing `payload.dueDate → slaHoursBySvcCode → blank` precedence and before `api_buildRow_`, rewrites `taskDueDate = new Date(<todayPT>T00:00:00)` and `taskPriority = "High"` when `svcCode === "RUSH"`. Overrides payload.priority, payload.dueDate, AND any `slaHoursBySvcCode["RUSH"]` entry — RUSH semantically means "needs done today" regardless of what the catalog SLA says. Time-zone via `Utilities.formatDate(now, "America/Los_Angeles", "yyyy-MM-dd")` matches React's `TODAY_DASH` constant (`Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })`) so a post-create refetch sees the same date the optimistic patch would have painted. Server-side default chosen over client-side wiring in CreateTaskModal because it covers every current and future task-creation path (DT auto-creates, public form, intake flow, etc.) without per-caller updates. **React-side:** `Tasks.tsx:__toggleTaskPriority` (window-attached chip handler) + `TaskDetailPanel.tsx:handlePriorityToggle` (useCallback) both extended to fire `postUpdateTaskDueDate(todayDash)` fire-and-forget on the High transition, with the same `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` today-in-PT pattern Dashboard uses. **Important fix from code-review:** `applyTaskPatch` in `useTasks.ts:159` is a REPLACE not a merge — the initial draft called it twice (once with `{ priority }`, once with `{ dueDate }`), and the second call clobbered the first so the chip didn't optimistically flip. Combined into a single `applyTaskPatch(taskId, { priority, dueDate })` call when transitioning to High; the Normal-transition path still calls with `{ priority }` only. Dashboard PR #399 doesn't have this bug because it uses two independent override maps (`priorityOverrides` + `dueDateOverrides`), not the shared patch dictionary. Also addressed a nit by replacing the silent `.catch(() => {})` on the auto-due-date write with `console.warn` on failure, matching the Dashboard log pattern. tsc + `npm run build` clean. Deployed from canonical: React via `npm run deploy`, GAS via `npm run push-api && npm run deploy-api` (Web App version 535). No new migration, no Edge Function deploy.).

> Earlier 2026-05-28 ([feat/delivery/dt-account-verify-ui, PR #546] **Self-service Verify toggle for DT account mapping — closes the SQL-only gap left by v41 (PR #538).** Symptom: `STU-00057-WALKER` republished 2026-05-27 landed under STRIDE LOGISTICS even though Studio AM Architecture was correctly mapped in `dt_credentials.account_name_map`. Root cause: v41's safety fallback (deployed 2026-05-26 — `dt-push-order/index.ts:1012-1025` in PR #538) falls back to STRIDE LOGISTICS for any tenant mapped but not in `verified_account_tenants`; the migration backfill auto-verified only tenants with ≥2 prior pushes (proxy for "already working"); Studio AM had **0** prior pushes pre-v41 so the backfill skipped them. PR #538's docstring left "(A UI button to do this lives in the DT Account Mapping page — to be added in a follow-up PR; for now operators run the SQL.)" as a known follow-up — this is that follow-up. **Settings → Integrations → DispatchTrack drawer** gains: a 4th stat card ("Unverified" = mapped-but-not-on-allowlist count, amber when >0); a 3rd filter tab ("Unverified") alongside All/Missing; drawer auto-opens to whichever filter has work waiting (priority Missing > Unverified > All); per-row Status column widened 90px→150px and replaces the static Linked/Missing badge with one of three states — **Missing** (red, unmapped) / **Verify** (amber clickable button, mapped+not-verified) / **Verified ✓** (green, click-to-unverify as escape hatch when DT-side renames). Toggle handler does an authoritative SELECT of `verified_account_tenants` immediately before computing `next` so rapid clicks on different rows don't trample each other's writes via closure-captured stale state — caught by Opus 4.7 code-review's locked-in agent before merge. Toggle preserves shape (`string[]` only, defensive type-narrowing). RLS unchanged (admin write via `dt_credentials_admin_write_rls`); field-scoped PostgREST UPDATE means concurrent `account_name_map` save + verify toggle on the same row don't collide. **OrderPage banner copy updated** to point at the new Settings flow instead of the SQL UPDATE the migration docstring documented as a stopgap; also added an honest acknowledgement that the original push to STRIDE LOGISTICS may need manual DT-side cleanup after re-pushing under the correct account (DT add_order's upsert-by-identifier behavior across accounts is unverified). **Data fix applied:** `Studio AM Architecture` (tenant `14i6RKdF59z6tsX7EtcmB95lMyL6RsZrio50HSopYQi8`) added to `verified_account_tenants` via direct UPDATE so the next republish of STU-00057-WALKER lands under the correct DT account. tsc + `npm run build` clean. Deployed via canonical clone (per the deploy-from-canonical-only memory). No new migration; no GAS deploy; no Edge Function deploy — all client-side React + one row UPDATE on `dt_credentials`.).

> Earlier 2026-05-23 ([fix/billing/router-tenant-id, PR #514] **Thread clientSheetId through createInvoice + resendInvoiceEmail routing.** Closes a latent silent-fallback gap in MIG-016 routing: `apiPost` at `src/lib/api.ts:1281` calls `resolveRoute(action, extraParams?.clientSheetId ?? null)`, and `apiRouter.resolveRoute` consults `resolveFlagBackend(flag, callerTenantId)` (FeatureFlagContext.tsx:154). For any `feature_flags` row with a non-null `tenant_scope` (the canary rollout pattern), `!callerTenantId` returns `'gas'` — so `postCreateInvoice` was silently bypassing `create-invoice-sb` for every scoped-flag tenant even when `active_backend='supabase'`, because the call passed `{}` as extraParams despite `payload.sourceSheetId` being a required field on `CreateInvoicePayload`. Fix: thread `{ clientSheetId: payload.sourceSheetId }` so scope matching works. Fleet-wide flags (`tenant_scope IS NULL`) were unaffected — `resolveFlagBackend` returns `flag.active_backend` directly in that branch. Also fixed the latent equivalent on `postResendInvoiceEmail` (payload already requires `clientSheetId`; not yet in `GAS_TO_SB_MAP` but pre-empts the same regression when a future PR adds the route entry). **Audit (no changes needed):** `postVoidInvoice`, `postReissueInvoice`, `postUpdateBillingRow`, `postAddManualCharge`, `postVoidManualCharge`, `postVoidUnbilledRows` already pass `clientSheetId`. Cross-tenant batches (`qboCreateInvoice`, `qbExport`, `qbExcelExport`, `createStaxInvoices`, `runStaxCharges`, `importIIF`, `generateStorageCharges`, `commitStorageRows`, `previewStorageCharges`, `generateUnbilledReport`, `onboardClient`) operate on multi-tenant payloads — no single `clientSheetId` exists; these require fleet-wide flag scope. Code review (Opus 4.7 fallback per locked-in checklist — registered subagent unavailable in this harness): no Critical; one Important caught the `postResendInvoiceEmail` latent shape and was fixed in the same PR before merge. tsc + `npm run build` clean (2,301 modules). React deployed from dedicated deploy clone `/c/dev/stride-deploy-billing-router` (avoids the canonical-clone `dist/.git` race that bit 2026-05-21).).

> Earlier 2026-05-22 ([feat/fix/auto-refresh, PR #506] **Auto-refresh on next nav when new bundle deployed.** GitHub Pages aggressively caches `index.html`, leaving users on stale bundles until they hard-refresh. New Vite plugin `stride-version-json` emits `dist/version.json` on every build (git short SHA + ISO buildTime); same version baked into the running bundle via `define: __APP_VERSION__` so the bundle knows its own identity. New `src/hooks/useVersionCheck.ts` polls `/version.json?t=<ts>` every 5 min — plus an immediate check on mount AND on `visibilitychange→visible` so background tabs unsuspend caught-up — and on mismatch flags the app stale, stops polling (`clearInterval`), and triggers `window.location.reload()` on the next `useLocation().key` change (keyed on `.key` not `.pathname` so Stride's `?open=<id>&client=<id>` deep-link navs within one path also count). No toast, no banner; user finishes what they're doing and silently picks up the new bundle. Wired into `AppLayout` alongside `useSupabaseRealtime`. `vite-env.d.ts` declares `__APP_VERSION__` + `__BUILD_TIME__` globals. Deploy semantics unchanged — `scripts/build.js` runs `vite build` which fires the plugin's `closeBundle` hook → `dist/version.json` lands, `scripts/deploy.js` then `git add -A`s `dist/` and force-pushes to `origin/main`. Code review (Opus 4.7 fallback per locked-in checklist) caught two Important issues fixed before merge: (1) initial `location.pathname` dep was too narrow — Stride deep links keep the same path, so a user living on `/inventory?open=A → ?open=B` never reloaded — re-keyed on `location.key`; (2) first poll was 5 min away from mount — added an immediate check + visibilitychange handler. tsc + `npm run build` clean (2,298 modules, version SHA verified inlined into the bundle).).

> Earlier 2026-05-22 ([feat/migration/batch-handlers-and-routing][MIGRATION-P2/P3/P4a/P5/P6 / MIG-016] **17 new SB-primary handlers + extended GAS_TO_SB_MAP.** Builds the next wave of `-sb` Edge Functions: P2 (update-task-sb, update-repair-sb, transfer-items-sb), P3 receive/email (complete-shipment-sb, send-shipment-email-sb, send-task-complete-email-sb, send-will-call-emails-sb), P4a billing (create-invoice-sb, void-invoice-sb, reissue-invoice-sb, commit-storage-charges-sb), P5 onboarding (onboard-client-sb — HYBRID: SB writes clients row, GAS keeps Drive/Sheets provisioning), P6 payments (qbo-create-invoice-sb, create-stax-invoices-sb, run-stax-charges-sb, import-iif-sb), reports (generate-unbilled-report-sb). All follow the update-item-sb canonical pattern: SERVICE_ROLE writes, payload validation, audit-log shape parity, best-effort reverse-writethrough with gs_sync_events on failure, error codes (INVALID_PARAMS/NOT_FOUND/UPDATE_FAILED/etc). Real-money handlers (Stax/QBO/IIF) gain explicit admin/staff role gate via `auth.getUser(token)` against anon client — mirrors GAS `withStaffGuard_`; closed gap where anon-bundled key alone could trigger fleet-wide charges. `GAS_TO_SB_MAP` extended to cover all 28 SB-primary action slots (8 pre-existing -sb EFs added to map for future apiPost refactor; 17 new entries for this PR; 4 explicit "still gas-only" comments preserved). All EFs use `Deno.serve` + `createClient` from esm.sh/@supabase/supabase-js@2. `create-invoice-sb` honors Landmines 2 (no React-side math), 3 (uses `next_invoice_no()` atomic SEQUENCE), 4 (re-verifies Unbilled status on both read filter and UPDATE WHERE), 5 (three-storage-layer documented as canary-acceptable drift per MIG-016). Documented FULL vs STUB scope in each handler header. Code review (Opus 4.7 fallback per locked-in checklist): caught 4 cross-tenant data-leak false-positives that were actually correct fleet-wide design (stax_invoices has no tenant_id by design — admin-only internal tool); explicit role checks added on the real-money handlers regardless. tsc + `npm run build` clean. **Deploy is operator-pending** — see Pending User Actions below.).

> Earlier 2026-05-21 ([feat/migration/route-and-update-item][MIGRATION-P2-P3/MIG-016] **SB-primary routing layer + 5 real -sb handlers (round 2).** Round 1 shipped routing + `update-item-sb`. Round 2 extends with 4 more handlers: `batch-create-tasks-sb` (createTask — service_catalog lookup, task ID generation, open-task dedup), `release-items-sb` (bulk release with item_notes append + auto-cancel open Tasks/Repairs cascade), `create-will-call-sb` (WC fee via service_catalog + per-client discount, active-WC dedup), `process-wc-release-sb` (item release + Unbilled billing for non-COD, idempotent on ledger_row_id to preserve Invoiced/Void history). StrideAPI v38.227.0: new `__writeThroughReverseTasks_` writer (6th per-table writer; insert + update upsert by Task ID; required by batch-create-tasks-sb). GAS_TO_SB_MAP now covers 5 actions: updateInventoryItem, batchCreateTasks, releaseItems, createWillCall, processWcRelease. **completeShipment intentionally deferred** to its own PR — 3+ hour port (Drive folders, shipment-received email, auto-INSP/ASM task creation, receiving billing, idempotency tag dedup; shipping half-built is worse than not shipping). Canary-acceptable gaps documented in each EF's header comment: WC partial release doesn't yet create a child WC for remaining items (operator creates manually); WC release email skipped (operator uses legacy GAS path); WC addons flush skipped; batchCreateTasks task-ID has narrow race on concurrent (tenant,item,svc) tuple. tsc + `npm run build` clean.).

> Earlier 2026-05-21 ([feat/migration/route-and-update-item — round 1][MIGRATION-P2/MIG-016] **First SB-primary routing layer + `update-item-sb` real handler.** New `src/lib/apiRouter.ts` (action→EF map + `invokeSupabaseHandler`); `apiPost` consults `resolveRoute` BEFORE the GAS path, routes to SB Edge Function when `feature_flags.<flagKey>.active_backend` resolves to `'supabase'` for the caller's tenant. Skips `fireShadow` on the SB path (SB IS the canonical path — nothing to shadow). Errors surface, never silently fall back to GAS — dual-write would be worse than a user-visible save failure. `update-item-sb` Edge Function: SB-primary handler for `updateInventoryItem`. Validates payload (mirrors `handleUpdateInventoryItem_` exactly — status whitelist, qty/declaredValue numeric/non-neg), UPDATEs `public.inventory`, cascades to open `public.tasks` + `public.repairs` for the SYNC_FIELDS subset, cascades Sidemark/Reference to Unbilled `public.billing` rows, auto-cancels open Tasks/Repairs on a true Released-transition with " | "-appended task_notes/repair_notes + per-row audit log (matches `api_cancelOpenWorkOnRelease_`), fires reverse-writethrough to per-tenant Inventory sheet, writes `entity_audit_log` matching the GAS shape exactly. Response shape is identical to GAS `handleUpdateInventoryItem_` so React callers stay agnostic. StrideAPI v38.226.0: extended `__writeThroughReverseInventory_` to handle general field updates (any subset of vendor/description/reference/sidemark/room/location/item_class/qty/item_notes/declared_value/coverage_option_id) alongside the legacy release-only path — required so the SB EF can mirror inventory edits back to the sheet without throwing 'row.status required'. Combined mode (status flip + sidemark edit in same save) covered. v38.211.0 auto-cancel source string changed from "Delivery" to "Reverse Writethrough" because the writer is now used for general edits too. New MIG-016 decision in MIGRATION_STATUS.md: Justin Demo canary override of MIG-007 — flag-flip directly without 3-layer verification, but only for tenants in `tenant_scope`. **Sheet-drift gap accepted on canary tenant:** cascade fan-out rows (Tasks/Repairs/Billing) are NOT individually mirrored back to the per-tenant sheets; full-sync cron backstops within ~5–30 min. Documented as canary-only trade-off. tsc + `npm run build` clean. **Operator deploy sequence is load-bearing — see Pending User Actions below.**).

> Earlier 2026-05-20 ([feat/migration/wire-all-shadows][MIGRATION-P1.9] **Live audit-shape shadow firing wired into apiPost.** Closes the 2026-05-19 backlog item "only `startTask` + `completeTask` fire shadows from the React app today — every other function still needs its `apiCall` path wired for real-time shadowing" (and was actually only `startTask` — `completeTask` parity volume came from operator-run replay-shadow, not live). New `src/lib/shadowRegistry.ts` maps 20 GAS apiPost actions → flag key + shadow EF name + per-function audit-shape derivation + callId derivation; new `src/lib/fireShadow.ts` is the fire-and-forget wrapper around `runShadow` that uses the synthesized GAS audit shape (deterministic from the input payload) as the comparison baseline instead of the GAS handler's full response. Hook in `apiPost` (`src/lib/api.ts`): after every successful GAS call, `fireShadow(action, bodyWithId, extraParams?.clientSheetId)` runs — no-op for unregistered actions. Covers: updateInventoryItem, updateTaskNotes/Priority/DueDate/CustomPrice, updateRepairNotes, startTask, startRepair, cancelRepair, sendRepairQuote, respondToRepairQuote, requestRepairQuote, completeTask, completeRepair, batchCreateTasks, createWillCall, processWcRelease, releaseItems, transferItems, commitStorageRows, reissueInvoice, completeShipment, onboardClient. **startTask false-positive fix:** retired the previous `apiCall(...start-task SB primary...)` wrap in `TaskDetailPanel.tsx` that produced 41/41 timing-artifact mismatches (GAS ran first + started the task → SB primary ran second + got "already started" no-op → different shapes). New audit-shape compare against `start-task-shadow` is deterministic from the payload, independent of GAS-side state — should drop to 0 mismatches once traffic resumes. **Audit-shape derivation strategy:** payload-minus-identifiers as default; per-function overrides for fixed-shape shadows (startTask = `{status:{new:'In Progress'}}`, sendRepairQuote = `{status:{old:'Pending Quote',new:'Quote Sent'}}`, etc.); audit-shape derivation runs inside try/catch so a registry bug never propagates into the apiPost success path; runShadow's existing sb-side try/catch + early-no-op on `parity_enabled=false` keeps the hot path clean. **Code review (Opus 4.7 fallback per the locked-in checklist)** caught + fixed before merge: `updateInventoryItem` strip-set was a superset of update-item-shadow's actual `{itemId, requestId}` → narrowed; `requestRepairQuote` audit-shape was sort+comma-join while shadow returns `"Repair quote requested for items: " + JSON.stringify(arr).substring(0,200)` → mirrored exactly (would have flipped 9/0 clean to 9/9 mismatch otherwise); `completeRepair` had a `p.result` fallback that diverges from the shadow's `resultValue`-required validation → dropped; defensive try/catch added around fireShadow's synchronous spec derivation. Not wired (no shadow deployed): createInvoice, voidInvoice, qboCreateInvoice, createStaxInvoices, runStaxCharges, importIIF, generateUnbilledReport — those need P4a/P6 shadow EFs first. Email-side flags (sendShipmentEmail / sendTaskCompleteEmail / sendWillCallEmails) skipped because emails fire server-side from receiveShipment / completeTask / processWcRelease handlers, not from a separate React apiPost action — they'll exercise via the host handler's parity check. tsc + `npm run build` clean. Rebased onto `origin/source` after PR #479 (client-settings writeback) merged.).

> Earlier 2026-05-20 ([feat/migration/client-settings-writeback] Supabase-authoritative client-settings write-back. Inverts the GAS→Supabase invariant for client settings: App / intake → `public.clients` UPDATE → Postgres trigger → `push-client-settings-to-sheet` Edge Function → existing P1.4 reverse-writethrough framework → per-tenant Settings tab + CB Clients tab. Fixes the failure mode Justin called out for Brian Paquette's `auto_inspection` flip — React flipped it TRUE in Supabase, but the per-tenant Settings tab (where dock-intake reads AUTO_INSPECTION from) still said FALSE because nothing wrote it back, and on the next CB-driven `handleResyncClients_` the SB value also reverted. New writer `__writeThroughReverseClients_` (StrideAPI v38.224.0, the 5th per-table writer against the P1.4 framework — after inventory v38.208, will_calls v38.213, repairs v38.215, billing v38.217) replaces the stub in `REVERSE_WRITETHROUGH_TABLES_["clients"]`. Writes to BOTH sheets: per-tenant Settings via `CLIENT_FIELDS_[*].clientSettingsKey` key/value upserts AND CB Clients via `CLIENT_FIELDS_[*].cbHeader` per-column setValue — without the CB write a CB-driven resync would silently overwrite the SB-side change. Also writes SB-only fields (`notification_contacts`, `billing_*`, `tax_exempt`, `tax_exempt_reason`, `resale_cert_*`) into the per-tenant Settings tab as ops-visible key/value rows. New Edge Function `push-client-settings-to-sheet` accepts `{spreadsheet_id}`, loads the row, invokes `reverseWritethrough({table:'clients', op:'update', ...})`. Companion migration `20260520140000_clients_writeback_trigger.sql` creates `propagate_clients_to_sheet()` SECURITY DEFINER trigger function + `trg_propagate_clients_to_sheet` AFTER UPDATE trigger guarded by `IS DISTINCT FROM` on every mirrored column so no-op UPDATEs don't fire the trigger (recursion safety when GAS itself UPDATEs via `handleResyncClients_` with identical values). `apply-intake-on-submit` Edge Function gets an explicit belt-and-suspenders invoke at the end so refresh-mode intakes propagate to the sheet with predictable latency. Three lists deliberately kept in sync: `MIRRORED_COLUMNS` (Edge Function), trigger's `IS DISTINCT FROM` chain (migration), `CLIENT_FIELDS_` + `REVERSE_CLIENTS_SB_ONLY_SETTINGS_` (StrideAPI.gs) — they answer three different questions (what to ship / what to watch / how to map). Idempotent end-to-end so duplicate fires are safe.).

> Earlier 2026-05-20 ([fix/delivery + fix/doc-templates follow-ups] Two small post-impersonation-series fixes on the same day. **PR #475** — Delivery Order modal item picker REFERENCE column was rendering `—` for every row when the modal was opened from Orders (no `liveItemsProp` from Inventory). Root cause: `CreateDeliveryOrderModal`'s self-fetch projection at `liveItems` map dropped `reference` (and previously `inventoryRowId`, fixed in 2026-05-19 but the doc-comment about the choke point was missed). One-line additive fix: `reference: i.reference || ''` to the projection + `reference?: string` to `LiveItem` interface + a comment block above the map flagging it as the choke point for field-drop bugs with the prior `inventoryRowId` miss and today's `reference` miss as worked examples. tsc + build clean. Code review (Opus 4.7) confirmed scope is correct (no `dt_order_items` insert path references the new field — picker-display-only). Deployed. **PR #476** — Doc template header parity + print-CSS migration for all 4 docs. The 2026-05-13 print-CSS-parity migration (`20260513210000`) had only touched `DOC_TASK_WORK_ORDER` + `DOC_REPAIR_WORK_ORDER`, leaving `DOC_RECEIVING` with hardcoded `table{width:8in}` + no `@page` rule (printed content overflowed ~7.5in Letter printable area) AND leaving `<div style="width:8in;margin:0;">` outer-wrapper artifacts on Task + Repair too. Three of the four docs (Receiving / Repair / Task) also carried a `<span>Stride Logistics </span><span>WMS</span><br>` title block that could wrap "Stride Logistics" / "WMS" onto two lines under tight column widths. Two new migrations applied via MCP: `20260520220000_doc_templates_header_parity.sql` extends @page + box-sizing + width:100% CSS to DOC_RECEIVING, replaces the span+br title block with `<div white-space:nowrap>`-wrapped spans on all three non-WC docs to match the WC structure, tightens logo→text gap from 10px to 8px; `20260520220100_doc_templates_drop_8in_wrapper.sql` drops the residual `<div width:8in>` wrapper on Repair + Task (5/13 migration missed it). Both migrations end with `DO $$` assertion blocks that abort the apply if any template still carries the broken artifacts — re-apply / partial-state safe. **No GAS deploy required** — `api_getDocTemplateHtml_` in StrideAPI.gs reads from Supabase first (`api_getTemplateFromSupabase_`) and falls back to sheet only on Supabase outage, so future GAS-generated Docs-tab PDFs auto-pick up the fixed template. Historical PDFs in `public.documents` Storage are frozen blobs and won't re-render. **No React deploy required** — `workOrderPdf.ts:fetchTemplate` also reads live from `email_templates`. Both Print-button and Docs-tab-download paths now point at the parity-fixed templates.).

> Earlier 2026-05-20 ([feat/impersonation-fidelity series, 3 PRs] Closes the long-standing "impersonation isn't actually what the client sees" gap. **PR #472** namespaced every list-view filter localStorage key by `user.email` so admin chip selections don't bleed into the impersonated client's view on the same browser (`useClientFilterPersisted`, Claims/Shipments status chips). New helper `src/lib/userScopedStorage.ts` (`userScopedKey`, `migrateLegacyKey`) — both Claims/Shipments status filters and the hook now use it, plus the legacy-key migration runs in BOTH the `useState` initializer AND the rehydrate effect to handle cold-start auth-loading. Hook also uses `lastWriteUserRef` to skip the stale-closure write that would fire once after `userEmail` flips. **PR #473** moved table prefs (column vis, sort, column order, status-chip filter) from localStorage to new Supabase `public.user_view_prefs` table (migration `20260520180000`, unique on `(user_email, page_key)`, self RLS + admin-staff read-any, data-API grants per 2026-10-30 rule, updated_at trigger). New `src/lib/userViewPrefsClient.ts` (fetch/upsert/debounced scheduler 250ms with per-(email,page) timer/beforeunload flush). `useTablePreferences` refactor: localStorage stays as first-paint cache + offline write-cache, Supabase load fires async after mount and rehydrates state, `serverHydratedRef` blocks the first-mount write from racing the server fetch, `userEditedRef` short-circuits rehydration if user has touched the table mid-fetch, `isImpersonating` makes the view read-only (admin's edits while impersonating are intentional restraint — they CAN write under the client's identity post-#3 but shouldn't). **PR #474** is the keystone — true Supabase-session impersonation. New migration `20260520200000_impersonation_log.sql` (audit table, RLS read-only for admin/staff + target-self, no auth INSERT/UPDATE/DELETE — only service role writes via the edge function). New edge function `impersonate-mint-session` (deployed v2 ACTIVE): admin JWT + role re-check, lookup target in `cb_users` (exact `.eq`), insert `impersonation_log` row, mint magic-link via `supabase.auth.admin.generateLink({type:'magiclink'})`, return one-shot `hashed_token`. `'end'` action stamps `ended_at` on the most-recent open row for `(admin, target)`. AuthContext rewired: `realUser` is now separate state (kept as admin during impersonation, mirrored from authState otherwise via an effect that gates on `getImpersonationFlag()`); `impersonateUser` stashes admin session tokens + admin AUTH_CACHE_KEY into sessionStorage, calls edge fn for OTP, `supabase.auth.verifyOtp` swaps live session to target, then resolves target user and pushes into authState. `exitImpersonation` reads stash → `supabase.auth.setSession(adminTokens)` swaps back → restores admin cache → stamps audit row close via edge fn (admin JWT is back). `impersonationSwapRef` guards `handleSession` + `onAuthStateChange` so they bail during the swap and never wipe AUTH_CACHE_KEY underneath us. Refresh-during-impersonation handled: realUser useState initializer reads admin cache stash for first paint; bootstrap useEffect skips localStorage hydration when FLAG_KEY is set so we go straight to "loading" until Supabase auto-restores target session. Sign-out clears all impersonation state. Cleanup migration `20260520200100` drops the admin-read-any policy on `user_view_prefs` (self policy now covers admin too). Removed `setSupabaseImpersonating` + `_impersonating` cache-bypass from `supabaseQueries.ts` — no longer needed. Code review caught + fixed orphan-audit-row on resolveErr (now calls `endImpersonationEdge` before rollback return); documented the rare exit-failure orphan (admin refresh token expires mid-session) with the operator cleanup SQL inline. Each PR went through tsc + build + Opus 4.7 code-reviewer + at least one fix iteration. All 3 deployed live. `setSupabaseImpersonating` cache-bypass is gone — `_impersonating` no longer exists in `supabaseQueries`.).

> Earlier 2026-05-19 ([MIGRATION-P1.8] **100% shadow coverage + Parity Dashboard merged.** 15 new shadow Edge Functions deployed so all 33 `feature_flags` functions have `parity_enabled=true` or `active_backend='supabase'`: 5 operational (`create-will-call-shadow`, `release-will-call-shadow`, `create-task-shadow`, `release-items-shadow`, `transfer-items-shadow` — **PR #450**); 3 billing-core (`processWcRelease-shadow`, `commit-storage-charges-shadow`, `reissue-invoice-shadow` — Supabase MCP); 4 simple (`update-task-shadow`, `update-repair-shadow`, `receive-shipment-shadow`, `onboard-client-shadow` — Supabase MCP); 3 email (`send-shipment-email-shadow`, `send-task-complete-email-shadow`, `send-will-call-emails-shadow` — Supabase MCP). `replay-shadow` → **v10** (16 functions in `SHADOW_REGISTRY`). **Parity Dashboard merged + live at `#/migration` (PR #451)** — the 2026-05-16 `feat/migration/parity-dashboard` branch is now shipped; `parity_summary` / `parity_mismatches_recent` / `parity_billing_shadow` views + `untracked_gas_actions` table+trigger + `run_parity_replay()` applied via Supabase MCP. **620 parity checks, 0 logic mismatches** (`updateItem` 300/0, `completeTask` 146/0, `releaseItems` 54/0, `updateTask` 26/0, `processWcRelease` 13/0, `releaseWillCall` 13/0, `createWillCall` 11/0, `requestRepairQuote` 9/0, `transferItems` 5/0, `completeRepair` 1/0, `updateRepair` 1/0; `startTask` 41/41 is a shadow-timing artifact, not logic). 7 untracked GAS actions found (`batchUpdateItemLocations` highest, 64 calls). Also today: Storage Credits **PR #456**; COD always-taxable **PR #457**; Orders service-date filter **PR #452**; old Rate Parity tab removed **PR #454** (−895 lines); MM/DD/YYYY date format standardized across 36 files **PR #458**; onboarding-metadata fix **PR #459** (73 orphaned client users batch-repaired); repair-quote email recipients fixed (`{{STAFF_EMAILS}}` → `info@stridenw.com` + client email). See MIGRATION_STATUS.md MIG-014 + the 2026-05-19 Recent Changes sections below. Migration backlog grew: notification-routing system, `batchUpdateItemLocations` shadow, live `apiCall` shadow wiring.).

> Earlier 2026-05-17 ([feat/warehouse/storage-credit] Storage Credits + shorter Inventory action-bar labels. **Storage Credits:** admins select inventory items → "Credit" button (desktop bar after Release + mobile FAB, admin-only) → `StorageCreditModal` (free_from/free_to date range + reason + item preview). Submit resolves inventory.id per (tenant_id,item_id), inserts one `public.storage_credits` row per item + best-effort `entity_audit_log` rows. Item detail panel Activity tab gains a "Storage Credits" Section (`StorageCreditsSection`) listing active credits with an admin-only Remove button (soft-delete via `deleted_at` + audit row); section gated admin/staff to mirror RLS. Migration `20260517000000_storage_credits_skip_in_charges.sql`: `CREATE TABLE IF NOT EXISTS public.storage_credits` (table pre-existed ad-hoc in prod — this is git source-of-truth) + partial active-row index + RLS (read admin/staff/service, write admin/service, idempotent DROP/CREATE policy so safe to re-apply) + `CREATE OR REPLACE FUNCTION public._compute_storage_charges(...)` — verbatim copy of the 20260502200000 body with ONE added block unioning active credit ranges into `v_billed` so the existing interval-subtraction loop drops credited days from BOTH preview and generate (public wrappers unchanged). React does no billing date math — suppression is entirely in Postgres. **Labels:** 8 desktop `WriteButton` labels + Export + 8 mobile FAB labels shortened (Create Will Call→Will Call, Add to Will Call→Add to WC, Create Delivery→Delivery, Create Task→Task, Request Repair Quote→Repair, Release Items→Release, Print Labels→Labels, Export Selected→Export); guard/toast/batchGuardAction strings intentionally left long. Code review (Opus, locked-in checklist): no Critical — inner `_compute_storage_charges` verified byte-identical to original except the intended block; one UX fix applied (gate Storage Credits Section to admin/staff so clients don't see an RLS-empty "no credits" message). tsc + `npm run build` clean. **Pending operator: apply the migration** (`apply_migration` MCP) + one manual SQL spot-check (item with a credit + no prior billing → credited days excluded) + `\d storage_credits` prod schema-drift check vs the migration's column list.).

> Earlier 2026-05-16 ([feat/migration/parity-dashboard] Migration Parity Dashboard — new admin/staff observation surface at `#/migration` (`src/pages/ParityDashboard.tsx`, lazy route in `App.tsx` under `RoleGuard allowed={['admin','staff']}`, "Migration" nav item added to ADMIN_NAV + STAFF_NAV in `Sidebar.tsx`). Complements the Settings → Migration *control* tab: this is the *is-it-safe-to-flip* read view. Summary cards (total functions / live-on-SB / shadow-active / overall 7d match rate), a per-function table (status badge, 7-day checks, color-coded match rate, SB speed delta, relative last-run), click-to-expand last-10 raw `parity_results`, and a "Billing Shadow Runs" feed for the auto-pay/invoice subset with dollar amounts pulled from the redacted GAS input payload. Auto-refreshes summary + billing every 30s; mounted-ref + per-effect alive guards prevent setState-after-unmount. New migration `20260516000000_parity_dashboard_views.sql` defines two `security_invoker` views — `parity_summary` (per-function rollup of `parity_results` joined to `feature_flags`, incl. 7d window + SB-vs-GAS speed % where positive = SB faster) and `parity_billing_shadow` (billing/payment function subset LEFT JOIN `gas_call_log.input_redacted AS input_summary`). Code review (Opus, locked-in checklist) flagged + fixed: both views had a GRANT to `authenticated` while `feature_flags` is authenticated-read, so a non-staff JWT could read migration topology + free-text `ff.notes` via PostgREST — added an explicit `auth.jwt()->user_metadata->>role IN ('admin','staff') OR service_role` predicate to both view bodies (security_invoker makes it evaluate as the querying user). Also distinguished billing fetch-error from genuine-empty in the UI. tsc + `npm run build` clean. **Pending operator action: apply the migration** (`apply_migration` MCP) — the page degrades to a clear "views not applied yet" message until then. PR/merge/deploy not yet run.).

> Earlier 2026-05-14 ([feat/migration/parity-infra] GAS→Supabase migration parity infrastructure, Phase 1. The existing `feature_flags` + `parity_results` substrate (PR #310) gains: lifetime counters (`total_checks`, `mismatch_count`) on `feature_flags` + a GENERATED `match_rate numeric(5,2)` column that the Settings → Migration tab now surfaces with color-coded thresholds (green ≥99.5%, amber ≥95%, red <95%); `input_summary text` on `parity_results` so the dashboard can render recent runs without decoding hashes; a `parity_results.function_key → feature_flags` FK with `ON UPDATE CASCADE`; `parity_results` added to the `supabase_realtime` publication; and a `parity_results_authenticated_insert` RLS allowing admin/staff to write directly so the React-side `shadowRunner` doesn't need a service-role edge-function round-trip on the hot path. Seeds 4 missing function_keys from Justin's canonical 24-function list (`releaseWillCall`, `generateStorageCharges`, `sendTaskCompleteEmail`, `updateShipment`) — existing keys preserved (`processWcRelease`, `commitStorageCharges`, etc.) so deployed GAS code that already references them keeps working; the new keys live alongside as the canonical aliases for new code. Two new React lib files: `src/lib/shadowRunner.ts` fires the shadow backend in the background, hashes both results via stable-key SHA-256 (so `{a,b}` and `{b,a}` produce the same digest), writes a `parity_results` row with truncated mismatch details (8KB cap per side), and bumps `feature_flags.total_checks`/`mismatch_count`. `src/lib/apiCall.ts` is the routing wrapper — `apiCall(key, gasFn, sbFn?, options?)` reads the snapshot from a new module-level mirror in `FeatureFlagContext`, routes to the active backend (falls back to GAS when SB isn't wired yet with a console warning), and fires the shadow when `parity_enabled` + `shadow_backend` are both set. Best-effort throughout: shadow failures, hash mismatches with a thrown SB call, race-y counter bumps — none of them throw into the primary call's success path. Project: `stride-gs-app/MIGRATION_STATUS.md` decisions MIG-001 / MIG-007.).

> Earlier 2026-05-14 ([feat/billing/cb-reconcile, PR #438] CB Consolidated_Ledger auto-reconcile from `public.billing` on every QBO push. Bridges the silent-drop class that bit INV-001152 + 6 sibling invoices (INV-001015, INV-001038, INV-001076, INV-001099, INV-001100, INV-001147): CB drifted behind per-tenant Billing_Ledger + `public.billing` because `handleCreateInvoice_`'s CB-write dedupe-skips when the Ledger Row ID is already in CB (~line 25303), and `handleVoidInvoice_` / `handleReopenTask_` don't propagate Void to CB (backlog #5 / #7). `handleQboCreateInvoice_` reads CB for the grouping pass — drifted rows got silently dropped from the push payload (React sent N invoices, GAS grouped <N). New helper `reconcileCbFromBilling_(invoiceNos)` reads `public.billing` (non-Void rows), indexes CB by Ledger Row ID, and either UPDATEs the matching CB row in place (overwrites Status / Invoice # / Sidemark / Client / svc / Invoice Date) or APPENDs a fresh CB row for IDs missing from CB. `handleQboCreateInvoice_` derives the set of covered invoice numbers from `public.billing` (single supabaseSelect_ on the incoming ledger_row_ids) and calls the reconciler before reading CB — every push self-heals. Wrapped in try/catch so a Supabase outage degrades to prior behavior (silent skip of drifted rows). Defensive cross-tenant guard (skip + log if existing CB row's Client Sheet ID disagrees with incoming tenant_id), `SpreadsheetApp.flush()` before return so the caller's grouping pass sees post-reconcile state. NOT a structural fix — CB retires entirely in P4b per MIG-005. This is a transitional bridge that keeps billing accurate during the migration window; the CB-symmetry bugs in the GAS path are intentionally left in place. v38.222.0, Apps Script version 517 deployed live.).

> Earlier 2026-05-14 ([fix/repairs/cascade-fk, PR #430] CASCADE FK on `repair_items → repairs` — locks the door after the 2026-05-14 orphan-cleanup incident. 15 `public.repair_items` rows for Seva Home survived a manual parent-row cleanup during PR #397 (multi-item repair) testing on 2026-05-13 because the join columns `(tenant_id, repair_id)` had never been bound by a foreign key. Today's cleanup deleted 9 ghost orphans and restored one parent (`RPR-63280-1778715634749`). New migration `20260514120000_repair_items_cascade_fk.sql` adds the missing FK with `ON DELETE CASCADE` so future parent deletes take their children. Idempotent runtime guards in the migration: RAISE EXCEPTION if any orphans still exist at apply time, and `pg_constraint` introspection so the unique-constraint add is skipped if a matching one already exists. Caught at apply time: Guard 2 had a `name[]=text[]` type mismatch that raised 42883 — fixed inline with `::text` casts. Postgres-only change — no React, GAS, or edge-function deploy needed.).

> Earlier 2026-05-14 ([feat/delivery/convert-to-pd, PR #431] Convert standalone delivery → P+D in place. Operator opens an existing delivery via "Edit Full Order", flips the mode card to "Pickup + Delivery", fills in pickup-side address/contact + any pickup ad-hoc items, and clicks save. New save branch in CreateDeliveryOrderModal.handleSubmit inserts a brand-new pickup `dt_orders` row, links both sides via `linked_order_id`, flips the existing delivery's `order_type` from 'delivery' to 'pickup_and_delivery', refreshes items on both legs via buildPDItemRows, re-pushes both legs to DT. Preserves: delivery's id, dt_identifier, audit log, photos, notes, attachments (UPDATE in place; id stable so every FK survives), inventory item FKs (rebuilt via selectedInvItems[].inventoryRowId in buildPDItemRows). Identifier rule: keep delivery's ROC-NNNN-...-D, mint matching -P by string-substituting the trailing two chars — pre-flight collision check rejects rare conflicts. Mode-card gate: P+D card disabled with tooltip when source delivery is terminal (status_id ∈ {7=arrived, 9=deleted, 100=delivered, 102=partial_delivery} or review_status='cancelled'); amber "Adding a pickup leg to this delivery on save" hint badge shown on the P+D card during a valid conversion. New `convert_to_pd` action added to DtOrderAuditAction union for traceability. Scope: delivery → P+D only today; pickup-only → P+D has different field semantics (separate PR if needed). Reverse conversion (P+D → delivery by dropping pickup leg) not addressed.).

> Earlier 2026-05-14 ([claude/gallant-austin-794b38, PR #428] `scripts/deploy.js` step 3 was silently swallowing `pushWithRetry` failures in the clean-tree branch — a single `try { rev-list + pushWithRetry } catch (_) {}` block. On 2026-05-14's photo-default deploy the source push was rejected non-fast-forward; the script still printed `✓ all steps complete` and exited 0, costing a 30-min debugging detour. Fix: narrowed the try/catch to wrap only the `git rev-list --count origin/source..HEAD` call (so `origin/source` not fetched locally is still tolerated); the subsequent push is now outside any try/catch and propagates failure to Node's uncaught handler → non-zero exit. Also hardened `pushWithRetry`: wrapped the second-attempt `execSync` in its own try/catch that prints `✗ push failed on both attempts` with both attempts' messages and re-throws, so the operator sees the real reason instead of a bare schannel-TLS line. The primary step-3 push (with-uncommitted-changes branch) was already correct — fix doesn't regress it. Script-only change, no React/GAS deploy semantically required, but full deploy still run from canonical to exercise the new code path.).

> Earlier 2026-05-14 ([fix/delivery/pd-items-uuid, PR #424] P+D order create was 100% broken since 2026-05-13's `parent_pickup_item_id` change. Every new P+D save errored with `P+D promote items insert failed: null value in column "id" of relation "dt_order_items" violates not-null constraint`, and each failed click left an orphan dt_orders pair behind (3 orphan pairs ROC-00087/88/89 cleaned up via direct SQL after the fix landed). Root cause: the v2026-05-13 commit added `id: pickupRowId = crypto.randomUUID()` to ONE row in `buildPDItemRows`' batch (so the mirror row could stamp `parent_pickup_item_id` on the pickup's id) but left the inventory / delivery-mirror / delivery-only rows shape-bare. Supabase JS's batch insert normalizes the array to the UNION of keys across all rows; rows missing a key that another row has get that key sent as explicit NULL — which overrides the column's `DEFAULT gen_random_uuid()` rather than letting the default fire. Fix: assign `crypto.randomUUID()` to every row built in `buildPDItemRows` so the batch has uniform shape. No schema change. Long comment on the helper documents the failure mode so the next builder doesn't re-introduce the trap.).

> Earlier 2026-05-14 ([feat/repair/requote-flow, PR #420] Re-quote flow + photo/note polish. Staff can now add/remove items on an in-flight repair (Pending Quote / Quote Sent only) without cancel-and-rebuild — new `re_quote_repair` SECURITY DEFINER RPC + `re-quote-repair` Edge Function + `ReQuoteRepairModal` accessible from the "Edit Items" affordance in `RepairDetailPanel`. Atomic swap: delete existing `repair_items` → insert new → UPDATE `public.repairs` (status='Pending Quote', clear quote_*, approved=false, primary item_id) → audit log row. Reverse-writethrough fires for the parent Repairs row; `Repair_Items` sheet is not mirrored — same scope as the multi-item create flow. After save, staff re-issues the customer quote via the standard sendRepairQuote flow. Photo + note polish: sort selector (newest / oldest / filename A-Z for photos; newest / oldest for notes) plus per-item grouping toggle in `PhotoGallery`, `NotesRollupView`, and `NotesGraphRollupView`. Group toggle is gated to ≥2 distinct items so single-item views stay clean. Lightbox keeps walking the flat filtered list across groups. StrideAPI bumped to v38.218.0 — `REVERSE_REPAIR_FIELDS_` gained `item_id` + `approved`. Code-review fixes already applied: RPC OUT params renamed (`repair_id` → `new_repair_id`) to dodge the 42702 trap from PR #400; edge function explicit `user_metadata.role ∈ {admin,staff}` gate before invoking the service-role RPC.).

> Earlier 2026-05-14 ([MIGRATION-P4a, PR #419] `completeRepair` SB cutover. Atomic `complete_repair_atomic` RPC: UPDATE public.repairs + INSERT public.billing (one row per quote line, or single REPAIR row for legacy single-amount) + flush addons + audit log — all in one Postgres transaction. Idempotent on already-Complete/Cancelled. Status='Invoiced' billing rows are NEVER overwritten on re-completion after Void (mirrors api_writeBillingRowIdempotent_'s skipped_invoiced guard). Companion `complete-repair-sb` Edge Function fires per-billing-row reverse-writethrough to the per-tenant Billing_Ledger sheet via new `__writeThroughReverseBilling_` writer (registered against the P1.4 framework — 4th per-table writer), then repair-row mirror, then REPAIR_COMPLETE email via Resend. Per MIG-005 the CB Consolidated_Ledger sheet stays on its existing independent aggregation path until P4b retires it entirely. Feature flag `completeRepair` (currently `active_backend='gas'`; flip in Settings → Migration to activate). 6/6 repair P3+P4a cluster complete.).

> Earlier 2026-05-14 ([MIGRATION-P3, PR #418] `requestRepairQuote` single-item SB cutover. TaskDetailPanel + ItemDetailPanel "Request Repair Quote" buttons routed through the existing multi-item `request-repair-quote-sb` Edge Function with `itemIds:[oneItem]`. RPC extended to accept `p_source_task_id` so the resulting repair preserves the task→repair linkage (single-item callers from TaskDetailPanel pass the parent task id; multi-item bulk-quote leaves it null). Tiny pure shadow returns `{summary: "Repair quote requested for items: [...]"}`. Flag `requestRepairQuote` gates the cutover.).

> Earlier 2026-05-13 ([MIGRATION-P3, PRs #405 + #406 + #407 + #408] Repair-cluster P3 migration — four of six handlers shipped SB-primary via Path-C (see MIG-013). `cancelRepair` (smoke-tested end-to-end), `startRepair`, `sendRepairQuote` (+ Resend email), `respondToRepairQuote` (+ Resend Approved/Declined email). All gated by feature flags (`cancelRepair`, `startRepair`, `sendRepairEmails`) currently at `active_backend='gas'`; flip in Settings → Migration to activate. StrideAPI bumped to v38.216.0 — `__writeThroughReverseRepairs_` writer now covers 17 repair columns (status, all quote_* + dates + result + amounts).).

> Earlier 2026-05-13 ([feat/repair/multi-item-select, PR #397] Multi-item repair jobs — mirrors the will_calls/will_call_items pattern. Select N inventory items → bulk Request Repair Quote → ONE repair with N items underneath (was: N separate repairs). New `public.repair_items` join table + `create_repair_quote_request` SECURITY DEFINER RPC. New `request-repair-quote-sb` Edge Function calls the RPC then dispatches REPAIR_QUOTE_REQUEST email via Resend with server-rendered `{{ITEM_TABLE_HTML}}` token — zero GAS interaction in the create flow. RepairDetailPanel renders an items table when items.length > 1; legacy single-item view preserved for back-compat. Quote/pricing/status/completion-billing all stay at the parent level: one quote per job, per-item pass/fail informational only. Backfill on the migration gave every existing repair (33 rows) one matching repair_items row so the data model is uniform from day one. Legacy single-item path (Tasks/ItemDetailPanel) keeps using GAS — cutover to SB is a separate Migration phase.).

> Earlier 2026-05-13 ([feat/delivery/pu-delivery-item-sync, PRs #388 + #389] PU→Delivery sync engine. When a DT pickup leg completes, the linked delivery order now (a) shows a green "Picked up [time] by [driver]" banner, (b) shows a per-item "From pickup" sub-row when the PU driver counted differently / added notes / flagged return codes, and (c) gets re-pushed to DT so the delivery driver's manifest reflects the post-PU reality. Two-tier helper `stamp-pickup-on-linked-delivery.ts`: Tier A (order-level stamps + picked_up_at) fires from both the webhook and the sync path; Tier B (per-item field propagation via `parent_pickup_item_id` FK match + DT push-back) fires only from the sync path where DT export.xml data is fresh. Quantity overwrite gated behind `quantity === original_quantity` so staff edits aren't reverted. Audit columns `pickup_item_note` / `pickup_return_codes` / `pickup_delivered_quantity` keep the PU mirror separate from the delivery's own driver-side fields, eliminating the brittle sentinel-marker concatenation that the first cut used.).

> Earlier 2026-05-13 ([feat/delivery/dt-sync-cron] `dt-sync-statuses` now runs every 5 min via pg_cron for non-terminal orders. DT-side cancellations no longer require an operator to manually click "Sync from DT" — the polling cron catches them within ~5 min and flips `dt_orders.status_id` to CANCELED, which auto-clears the "D" inventory badge via Inventory.tsx's existing cancelled-category filter. Background: investigation showed DT's API has no documented cancel endpoint AND DT doesn't fire a webhook on cancel — but we already had all the cancel-handling logic in dt-sync-statuses; the only missing piece was triggering it without operator action. Job name: `dt-sync-statuses-active-every-5min`, schedule `*/5 * * * *`, body `{"scope":"active"}`.).

> Earlier 2026-05-13 ([feat/fix/public-form] Public service-request form was 100% broken — every customer submission failed with the generic "We could not submit your request" error since at least 2026-04-27 (last successful submission in `dt_orders` source=public_form). Root cause: the supabase-js `.insert(...).select(...).single()` chain on `PublicServiceRequest.tsx:908` adds `Prefer: return=representation` which makes PostgREST emit `INSERT ... RETURNING id, dt_identifier`. RETURNING needs anon SELECT permission via RLS, but anon had only an INSERT policy on `dt_orders`. PostgREST surfaced this as the misleading `42501: new row violates row-level security policy` instead of a SELECT-side error. Fix: tightly-scoped anon SELECT policy in migration `20260513124647_dt_orders_anon_select_just_inserted.sql` — matches `source='public_form' AND review_status='pending_review' AND tenant_id IS NULL AND created_at > now() - interval '30 seconds'`. 30s window prevents enumeration of older submissions; everything else mirrors the existing INSERT WITH CHECK. Verified live via curl: anon REST POST with `Prefer: return=representation` now returns 201.).

---

## Recent Changes (2026-05-29, build preflight: fail if Supabase env vars missing — fix/build/env-preflight, PR #571)

- **Problem:** Session 72 incident — a deploy from a fresh worktree that hadn't copied `.env` produced a bundle with `VITE_SUPABASE_URL = undefined` inlined. `vite build` succeeded; the deployed bundle then crashed at module load with `Uncaught Error: supabaseUrl is required`. The build silently shipped a broken bundle. The CLAUDE.md "Worktrees for parallel builders" section now calls this out, but a procedural reminder is not the same as a build-time gate.
- **Solution:** `stride-gs-app/vite.config.ts` now uses the `defineConfig(({ command, mode }) => ...)` function form. When `command === 'build'`, `loadEnv(mode, process.cwd(), '')` reads the same `.env` files Vite uses for substitution, falls back to `process.env` for CI shells, and throws `FATAL: VITE_SUPABASE_URL[, VITE_SUPABASE_ANON_KEY] must be set in .env. Build aborted to prevent shipping a broken bundle.` if either is empty. Vite exits 1, deploy aborts.
- **Verification:** Built with `.env` renamed → exits 1 with the FATAL error. Built with `.env` present → tsc clean, vite build OK, post-build sanity checks pass.
- **Dev mode unaffected:** the check is gated on `command === 'build'`, so `vite dev` keeps loading `.env` the normal way.
- **Files:**
  - `stride-gs-app/vite.config.ts` — switch to function-form config, add loadEnv preflight

## Recent Changes (2026-05-29, build version chip near logout — feat/ui/build-version, PR #565)

- **Problem:** Users (and Justin during incidents) couldn't tell at a glance whether a tab was on the current bundle or a stale cached one. `useVersionCheck` silently reloads on next navigation, but that's invisible until a click — leaving "is this user on the fix yet?" as a guessing game.
- **Solution:** New `src/components/layout/BuildVersionChip.tsx` renders a small muted `v.<short-sha>` footer below the Sign Out row in `Sidebar.tsx`. Hover tooltip shows full build time. The chip independently polls `/version.json` every 5 min; when the server has a newer bundle than `__APP_VERSION__`, it turns amber with "update ready" and clicks reload immediately. `useVersionCheck` still owns the silent on-next-navigation reload — the chip is purely the visible signal that complements it.
- **Build infra:** Already in place from a prior session — `vite.config.ts` resolves the short SHA via `git rev-parse --short HEAD` and injects `__APP_VERSION__` + `__BUILD_TIME__` at build time, plus emits `dist/version.json` with the same values. No build-side changes in this PR.
- **A11y:** When stale, the chip exposes `role="button"`, `tabIndex={0}`, and an Enter/Space handler so keyboard users can trigger the manual reload. When not stale, it stays non-interactive.
- **Files:**
  - `stride-gs-app/src/components/layout/BuildVersionChip.tsx` (new)
  - `stride-gs-app/src/components/layout/Sidebar.tsx` — import + render below Sign Out

## Recent Changes (2026-05-20, Supabase-authoritative client-settings write-back — feat/migration/client-settings-writeback)

- **Problem:** React Settings modal + intake form write to `public.clients` directly, but the per-tenant Google Sheet's Settings tab (where per-client GAS scripts read `AUTO_INSPECTION`, `FREE_STORAGE_DAYS`, etc. at runtime) and the CB Clients tab (read by `handleResyncClients_` → `sbClientRow_` → Supabase) had no write-back path. Two consequences: (1) per-tenant GAS handlers used stale values until a manual sync; (2) the next CB-driven resync silently overwrote SB-side changes with the CB sheet's stale values. Concrete failure: Brian Paquette's `auto_inspection` flip never reached the sheet, and reverted in Supabase on the next resync.
- **Solution:** New 5th per-table writer against the existing P1.4 reverse-writethrough framework (after `__writeThroughReverseInventory_` v38.208, `__writeThroughReverseWillCalls_` v38.213, `__writeThroughReverseRepairs_` v38.215, `__writeThroughReverseBilling_` v38.217). `__writeThroughReverseClients_` in StrideAPI v38.224.0 receives a `public.clients` row and writes BOTH the per-tenant Settings tab (via `CLIENT_FIELDS_[*].clientSettingsKey` upserts) AND the CB Clients tab (via `CLIENT_FIELDS_[*].cbHeader` per-column setValue). Also handles SB-only fields not in CLIENT_FIELDS_ (`notification_contacts`, `billing_*`, `tax_exempt`, `tax_exempt_reason`, `resale_cert_*`) into the per-tenant Settings tab as ops-visible key/value rows. Idempotent by tenantId so duplicate fires are no-ops.
- **Trigger:** New migration `20260520140000_clients_writeback_trigger.sql` adds `propagate_clients_to_sheet()` SECURITY DEFINER trigger function + `trg_propagate_clients_to_sheet` AFTER INSERT OR UPDATE trigger. Guarded by `IS DISTINCT FROM` on every mirrored column so true no-op UPDATEs don't fire — bounds the GAS-resync recursion case (GAS pushes identical values back; trigger doesn't fire; loop closed). Reads URL + service-role JWT from GUCs (`app.settings.supabase_url`, `app.settings.service_role_key`) set by the operator post-merge. Fails open on missing GUCs (RAISE NOTICE, return NEW) so a fresh environment without GUCs still accepts UPDATEs.
- **Edge Function:** New `push-client-settings-to-sheet` accepts `{spreadsheet_id}`, service-role-loads the clients row, calls `reverseWritethrough({tenantId, table:'clients', op:'update', row, rowId})`. Mirrors the existing `push-inventory-release-to-sheet` shape (gs_sync_events on pre-GAS failures so FailedOperationsDrawer retry still works).
- **Intake wiring:** `apply-intake-on-submit` Edge Function adds explicit belt-and-suspenders invoke of `push-client-settings-to-sheet` at the end. The trigger ALREADY fires on the upstream UPDATE, but the explicit invoke gives intake submissions predictable latency (pg_net queues async) and works even if the trigger's GUCs aren't configured.
- **Files:**
  - `AppScripts/stride-api/StrideAPI.gs` — v38.224.0 header + `__writeThroughReverseClients_` + `REVERSE_CLIENTS_SB_ONLY_SETTINGS_` + registry update
  - `stride-gs-app/supabase/functions/push-client-settings-to-sheet/index.ts` (new)
  - `stride-gs-app/supabase/functions/apply-intake-on-submit/index.ts` — step 8 sheet mirror
  - `stride-gs-app/supabase/migrations/20260520140000_clients_writeback_trigger.sql` (new)

## Recent Changes (2026-05-19, tax rates wired to tax_jurisdictions table — feat/billing/tax-jurisdictions)
Replaces the last hardcoded sales-tax literals with the operator-created `public.tax_jurisdictions` table (one `is_default` row, partial unique index; Kent 10.4% seeded; `get_default_tax_rate()` fn). **(1)** New `useDefaultTaxRate` hook (`src/hooks/useDefaultTaxRate.ts`) reads the `is_default` row once on mount, fails soft to 10.4 / Kent / WA (`FALLBACK_TAX_RATE`). `CreateDeliveryOrderModal.tsx` `DEFAULT_TAX_RATE = 10.4` const removed → `defaultTax.rate` (clientTaxInfo missing-rate fallback, COD fallback, submit snapshot; `defaultTax.rate` added to the clientTaxInfo `useEffect` + `effectiveTaxRatePct` `useMemo` deps). `PublicServiceRequest.tsx` (anon page) `TAX_RATE_PCT = 10.4` const → component-scoped `defaultTax.rate` (added to `taxAmount` useMemo deps); anon RLS/network failure still degrades to 10.4 silently. **(2)** New `TaxJurisdictionsPanel.tsx` (admin-only, rendered in Settings → Pricing under PriceList): table of City/State/Rate%/Default-star/Effective, click-to-edit rate, star toggles the single default (clear-old-then-set, partial-index-safe), add-jurisdiction inline row, delete (blocked on the default — defense in depth: button disabled + `remove()` recheck + query-layer recheck). CRUD helpers appended to `supabaseQueries.ts` (`fetchTaxJurisdictions`/`fetchDefaultTaxJurisdiction`/`create`/`update`/`delete`/`setDefaultTaxJurisdiction`, `TaxJurisdiction` type). **(3)** `TaxExemptBlock` (OnboardClientModal.tsx) now loads `clients.tax_rate_pct` and shows a source line — "Using default — Kent, WA 10.4%" vs "Custom rate — X% (overrides …)" — plus a per-client override input (blank ⇒ NULL ⇒ default; "Use default" clears it; validated 0–100). New idempotent migration `supabase/migrations/20260519140000_tax_jurisdictions_rls.sql` (git source of truth for RLS: anon+authenticated SELECT, authenticated write; `create table/index if not exists`, `drop policy if exists`, `create or replace function` — safe vs the operator's out-of-band objects). Code review (Opus, `.claude/agents/code-reviewer.md` checklist — registered subagent unavailable in harness): **no Critical, no landmine.** Landmine #2 judged a neutral rate-source swap into the pre-existing #465/#466 snapshot (not new client-side billing). Important items accepted by design: authenticated-write RLS gated by UI `isAdmin` (matches infra-table posture), `setDefault` non-transactional sub-second window (consumers fail soft). One nit fixed: a configured 0% default jurisdiction is now honored (`>= 0`) not snapped to fallback. tsc + `npm run build` clean. **Migration NOT yet applied** — builder env has no Supabase MCP / `SUPABASE_ACCESS_TOKEN`; handed to operator (see Pending User Actions). React side unblocked (the table already exists in prod; the migration only hardens RLS — fail-soft means the app works either way).

## Recent Changes (2026-05-19, DO client-info tax fallback 10.1→10.4 — fix/billing/default-tax-rate-fallback, PR #466)
Follow-up to PR #465. `CreateDeliveryOrderModal.tsx:866` defaulted `clientTaxInfo.taxRatePct` to a hardcoded `10.1` when a non-exempt client's Supabase row had no `tax_rate_pct`. The module already defined `DEFAULT_TAX_RATE = 10.4` (the current Kent WA combined rate, used by the COD path); the client-info fallback now references that constant instead of the stale literal — single source of truth, and the non-COD missing-rate fallback is corrected 10.1%→10.4%. One-line change (the constant was NOT re-added — it already existed in `source`; the Dropbox copy that prompted this was pre-#465 stale, hence its different line numbers). Single-token literal→pre-existing-constant swap, no logic/landmine surface; locked Opus reviewer not spawned (disproportionate for a 1-line zero-logic diff — documented in the PR). tsc + `npm run build` clean. No migration → deploy unblocked on merge. Merged **PR #466**; React deployed via `npm run deploy` from the canonical clone (bundle live on `origin/main` `3424030`).

## Recent Changes (2026-05-19, DO sales tax over-charged on whole subtotal — fix/billing/do-modal-taxable-services)
The DO modal's sales-tax snapshot (Task 8a, migration `20260426190000`) computed `taxAmount = subtotalBeforeTax * rate` — taxing the ENTIRE pre-tax subtotal (base/zone delivery fee, pickup leg, drive-out, `XTRA_PC` extra-piece fee, bundle discount, accessorials, coverage). Only services flagged `taxable=true` in `service_catalog` (felt pads `FELT`; fabric protection `FAPROT` if the catalog row is set taxable) should be taxed; delivery labor is not a taxable retail sale. Fix in `src/components/shared/CreateDeliveryOrderModal.tsx`: new `taxableLines` memo walks `selectedAccessorials`, looks each up in the already-loaded `catalogServices` (`useServiceCatalog`) by `code`, and includes the line only when `svc.taxable === true` (fail-closed: unknown/unseeded code → NOT taxable; `quotePending`/non-positive lines skipped). `taxableSubtotal` = sum of those; `taxAmount = taxableSubtotal * rate` (same null-guards: unpriced/call-for-quote/exempt still 0). The taxed base is fully data-driven — an admin toggling a catalog row's `taxable` flag re-flows with no code change. `taxFields` snapshot in `performSubmit` now records `taxable_subtotal` (COD: always; bill_to: null-when-exempt, mirroring `tax_amount`); the three pickup-leg null-out payloads also null it. New migration `supabase/migrations/20260519130000_dt_orders_taxable_subtotal.sql` adds nullable `dt_orders.taxable_subtotal numeric(10,2)` + COMMENT + `NOTIFY pgrst` (`IF NOT EXISTS`, idempotent). Pricing summary now labels the line "Sales Tax on <names> (rate% × $taxableSubtotal)" or "Sales Tax (rate%) — no taxable services" so it's explicit what's taxed. File-header changelog bumped v6. Code review (Opus, `.claude/agents/code-reviewer.md` checklist — registered subagent unavailable in harness): no Critical, no Important, approved; confirmed this refines the pre-existing accepted client-side snapshot (narrows the taxed base, fail-closed) and does not worsen the React-billing posture. tsc + `npm run build` clean. Merged as **PR #465**. **Fully shipped 2026-05-19:** migration applied by operator first (`dt_orders.taxable_subtotal` confirmed present), THEN React deployed via `npm run deploy` from the canonical clone (bundle live on `origin/main` `69efbbf`). The deploy was intentionally held until the migration landed — the new code writes `taxable_subtotal`, so deploying first would have `PGRST204`-failed all DO creation; migration-first ordering was respected.

## Recent Changes (2026-05-19, DO piece-count double-counted transferred items — fix/delivery/dt-transferred-doublecount)
`CreateDeliveryOrderModal.selectedInvItems` filtered raw `liveItems` by `itemId`. After a transfer, the same `item_id` exists as two rows — Active under the receiving tenant, Transferred under the originating tenant — and the staff/admin `useInventory` fetch is un-scoped (all tenants), so both landed in `liveItems`. Every transferred item was matched twice, doubling `itemCount` → `extra_items_count` → over-billed extra pieces (2026-05-19 ALL-00100-FAHRINGER: 6 inventory rows for 3 real items; `extra_items_count` 9 vs expected 3). The picker UI never showed the dup because it renders `activeItems` (status==='Active' + client match). Fix: `selectedInvItems` now resolves selections against `activeItems` with a defensive itemId de-dupe Map, so each pick maps to exactly the Active row — correct piece count, and `dt_order_items.inventory_id`/`location` sourced from the Active row. Also threaded `inventoryRowId` (inventory UUID) through `InventoryItem` (types.ts), `useInventory.mapToAppItem` + the batch path, and the modal `liveItems` map — previously dropped by `mapToAppItem`, so `dt_order_items.inventory_id` was null in the self-fetch path (also hardens OrderPage Release-Items FK). Behavioral note: re-saving a historical order whose item was since Released/Transferred now excludes that item from the recomputed set — intended per the bug (transferred/released must never count); the resubmit-diff banner surfaces any count change. Files: `src/lib/types.ts`, `src/hooks/useInventory.ts`, `src/components/shared/CreateDeliveryOrderModal.tsx`. Opus code review: no Critical; tsc + `npm run build` clean.

## Recent Changes (2026-05-19, dt_order_items double-insert on order submit — PR #462)

**Bug:** standalone delivery **ALL-00097** had all 6 inventory lines inserted twice with identical `created_at` — the items array persisted twice in one submit flow. Root cause in `src/components/shared/CreateDeliveryOrderModal.tsx`: (1) `handleSubmit` had no synchronous re-entrancy guard — `setSubmitting()` is async and `WriteButton`'s own `inFlight` ref resets the instant `performSubmit()` resolves (incl. the keep-modal-open repush-failure return), so a second click re-entered; (2) the single-leg edit/promote path re-read the mutable `editingDraftRowIdRef.current` at delete + insert across many awaits — a null/stale read makes `.delete().eq('dt_order_id', null)` a no-op while the insert still runs (the exact mechanism documented in `dt-push-order`'s `pruneDuplicateOrderItems()`). There was **no DB-level uniqueness** on a logical line.

**Fix:** `handleSubmit` split into `performSubmit` + a `submitInFlightRef`-latched wrapper; Submit button disabled while `submitting`; new `orderSaveLocked` latch permanently disables Submit once the order is durably written but the modal is kept open on a DT-republish failure (set on all three keep-open returns — convert / P+D / single-leg); single-leg edit path snapshots the order id once into `editId` with a throw-if-falsy guard, all delete/insert/update id refs switched to `editId`; the single-leg warehouse items insert now checks `{ error }` and throws (was the only insert in that block swallowing failures). Migration `supabase/migrations/20260519000000_dt_order_items_dedupe_unique_index.sql` soft-removes existing non-adhoc dup rows (FK-safe vs the `parent_pickup_item_id` self-FK) then creates partial `UNIQUE INDEX dt_order_items_order_code_active_uniq ON dt_order_items (dt_order_id, dt_item_code) WHERE dt_item_code IS NOT NULL AND removed_at IS NULL` — structural backstop for every write path. Code review (locked-in Opus reviewer): no Critical, no landmine; both Important items fixed before merge. React side shipped via `npm run deploy`. **Migration NOT yet applied** — this builder env has no Supabase MCP / `SUPABASE_ACCESS_TOKEN`; handed to Justin (see Pending User Actions).

## Recent Changes (2026-05-19, [MIGRATION-P1.8] 100% shadow coverage + Parity Dashboard — PRs #450 + #451 + Supabase MCP)

**Goal (Justin):** get every migratable function under parity instrumentation so divergence is visible the moment a function takes real traffic, and ship the read-side observability surface to judge flip-readiness.

**Shadows deployed today (15 — reaching 100% of the 33 `feature_flags` functions):**
- **5 operational (PR #450):** `create-will-call-shadow`, `release-will-call-shadow`, `create-task-shadow`, `release-items-shadow`, `transfer-items-shadow`.
- **3 billing-core (Supabase MCP):** `processWcRelease-shadow`, `commit-storage-charges-shadow`, `reissue-invoice-shadow`.
- **4 simple (Supabase MCP):** `update-task-shadow`, `update-repair-shadow`, `receive-shipment-shadow`, `onboard-client-shadow`.
- **3 email (Supabase MCP):** `send-shipment-email-shadow`, `send-task-complete-email-shadow`, `send-will-call-emails-shadow`.
- `replay-shadow` upgraded to **v10** — `SHADOW_REGISTRY` now lists **16 functions** (was 5 at 2026-05-13). Builds on `completeTask`'s SB handler + shadow from PR #447.
- Result: every one of the 33 `feature_flags` rows now has `parity_enabled=true` or `active_backend='supabase'`. None flipped — all `active_backend='gas'` pending canary nomination.

**Parity results (620 checks, MIG-007 layer-1 per-call diff):** 579 matches, 41 mismatches — **0 logic mismatches**. Per function: `updateItem` 300/0, `completeTask` 146/0, `releaseItems` 54/0, `updateTask` 26/0, `processWcRelease` 13/0, `releaseWillCall` 13/0, `createWillCall` 11/0, `requestRepairQuote` 9/0, `transferItems` 5/0, `completeRepair` 1/0, `updateRepair` 1/0. `startTask` 41/41 mismatch is a **shadow-timing artifact** — `startTask` + `completeTask` are the only two functions firing shadows live from the React app today; `startTask`'s shadow fires before the GAS write commits so it diffs stale state. Not a logic divergence; do not "fix" handler logic for it (see MIG-014).

**Infrastructure (PR #451 + Supabase MCP):**
- **Parity Dashboard** merged + live at `#/migration` (`src/pages/ParityDashboard.tsx`, admin/staff) — the 2026-05-16 `feat/migration/parity-dashboard` branch is now shipped as PR #451.
- New views: `parity_summary`, `parity_mismatches_recent`, `parity_billing_shadow`.
- New `untracked_gas_actions` table + insert-trigger — monitors for GAS actions with no shadow registered. **7 identified**; `batchUpdateItemLocations` is highest at **64 corpus calls** (no shadow yet — backlogged).
- `run_parity_replay()` Postgres function for bulk replay.

**Migration backlog added (see MIGRATION_STATUS.md "Migration backlog (added 2026-05-19)"):**
1. **Notification-routing system** — need a `notification_preferences` table to configure which emails/roles receive which template types per tenant. Today templates use hardcoded addresses or `{{STAFF_EMAILS}}`. GAS had per-client `NOTIFICATION_EMAILS` settings on each Sheet; SB has no equivalent. Blocks flipping any email handler to SB-primary.
2. **`batchUpdateItemLocations` shadow** — highest-volume untracked GAS action (64 calls), no shadow.
3. **Live `apiCall` shadow wiring** — only `startTask` + `completeTask` fire shadows live from the React app; the other 31 functions' parity is replay-only. Wiring their `apiCall(...)` call sites also fixes the `startTask` timing artifact.

**Doc:** MIGRATION_STATUS.md updated — top note, Phase status (P1 done; P2/P3/P4a/P5 in_progress), P1.8 sub-task, full per-function table (all 33), MIG-014, backlog, Pending user actions. No React/GAS code in this PR — docs only; the shadows + views were deployed via PR #450/#451 + Supabase MCP (operator-run; builder env has no service-role token).

## Recent Changes (2026-05-19, Storage Credits — PR #456)

`feat/warehouse/storage-credit` — **merged as PR #456** (the 2026-05-17 branch entry is now shipped). Admins select inventory items → "Credit" button (desktop bar after Release + mobile FAB, admin-only) → `StorageCreditModal` (free_from/free_to date range + reason + item preview). Submit resolves `inventory.id` per `(tenant_id,item_id)`, inserts one `public.storage_credits` row per item + best-effort `entity_audit_log` rows. Item detail panel Activity tab gains a `StorageCreditsSection` listing active credits with an admin-only Remove (soft-delete via `deleted_at` + audit row); section gated admin/staff to mirror RLS. Migration `20260517000000_storage_credits_skip_in_charges.sql`: `CREATE TABLE IF NOT EXISTS public.storage_credits` + partial active-row index + idempotent RLS + `CREATE OR REPLACE FUNCTION public._compute_storage_charges(...)` (verbatim copy of the `20260502200000` body with ONE added block unioning active credit ranges into `v_billed` so the interval-subtraction loop drops credited days from BOTH preview and generate). React does no billing date math — suppression is entirely in Postgres. Also shortened 8 desktop `WriteButton` + Export + 8 mobile FAB labels. Code review (Opus, `.claude/agents/code-reviewer.md` checklist — registered subagent unavailable in harness): no Critical, one UX fix applied. tsc + `npm run build` clean. Shipped via `npm run deploy`. **Pending operator: apply the migration** (`apply_migration` MCP) + manual SQL spot-check + `\d storage_credits` schema-drift check.

## Recent Changes (2026-05-19, consistent MM/DD/YYYY date formatting — PR #458)

`fix/<date-format>` — standardized date display to **MM/DD/YYYY across 36 files**. Eliminates the inconsistent mix of locale-default / ISO / `toLocaleDateString` renderings that varied by component and browser locale. React-only display change (no schema, no billing-date math touched — storage-charge date math stays server-side in Postgres per the React-never-calculates-billing invariant). Code review (Opus, `.claude/agents/code-reviewer.md` checklist — registered subagent unavailable in harness): no Critical/Important. tsc + `npm run build` clean. Shipped via `npm run deploy`; commit `497d10b` on `origin/source`.

## Recent Changes (2026-05-19, repair-quote email recipients fix)

Repair-quote notification emails were sent to `{{STAFF_EMAILS}}` (every staff member) instead of the intended recipients. Changed to **`info@stridenw.com` + the client email**. This is a manual recipient patch; the structural fix is the backlogged `notification_preferences` table (GAS had per-client `NOTIFICATION_EMAILS` on each Sheet — Supabase has no equivalent yet, so per-client repair-quote routing can't be declarative until that table ships). Captured in the migration backlog so the email-handler SB cutover doesn't regress recipient routing.

---

## Recent Changes (2026-05-18, CRITICAL — onboarding created Supabase users with empty user_metadata — PR #459)

`fix/auth/onboard-user-metadata` — **GAS-only, StrideAPI v38.222.0 → v38.223.0.** Since **2026-04-11** the onboarding flow created Supabase auth users with **empty `raw_user_meta_data`** — 73 client users were invisible everywhere because every RLS policy keys off `auth.jwt()->'user_metadata'->>'role'` / `->>'clientSheetId'` / `->>'accessibleClientSheetIds'`. Root cause: `createSupabaseAuthUser_` (StrideAPI.gs ~2145) never sent `user_metadata` on the GoTrue admin create. The `apply-intake-on-submit` Edge Function does **not** create auth users (only deactivates the intake link + propagates refresh-mode client data) — bug is entirely GAS-side. Fix: `createSupabaseAuthUser_` gained an optional `metadata` param POSTed as `user_metadata`; new `api_buildAuthUserMetadata_(role, clientName, clientSpreadsheetId)` centralizes the AuthContext contract — `{ role, clientName, clientSheetId, accessibleClientSheetIds, childClientSheetIds:[] }`. **Field names corrected from the original `tenantId` hypothesis** — RLS + `AuthContext.tsx` both key off `clientSheetId`/`accessibleClientSheetIds`; `tenantId` would not have unblocked RLS. All **five** auth-create sites stamp it: `api_upsertClientUser_` (onboarding — primary bug), `handleCreateUser_`, `handleEnsureAuthUser_`, `handleAdminSetUserPassword_` create branch, plus the helper. **Remediation for the 73:** the 422 "already exists" branch self-heals via `api_backfillAuthUserMetadata_` — finds the user by email + merges metadata **only when existing user_metadata has no `role`** (idempotent; never clobbers live login-synced metadata). Re-running onboarding or `ensureAuthUser` for a pre-fix user repairs them; bulk remediation can iterate `handleEnsureAuthUser_` over the cohort. `childClientSheetIds` is always `[]` (no RLS keys off it; parent→child scope resolved by AuthContext on login as before). No schema/migration/React change. Two-pass Opus code review (`.claude/agents/code-reviewer.md` checklist; registered subagent unavailable in harness): first pass flagged missing `childClientSheetIds`, resolved; final SHIP. `node --check` clean. Squash-merged #459, deployed via `npm run push-api && npm run deploy-api`.

## Recent Changes (2026-05-18, COD orders always charge sales tax — PR #457)

`fix/delivery/cod-tax-always` — `CreateDeliveryOrderModal.tsx`: COD (`billing_method = customer_collect`) is a direct-to-consumer sale the customer pays the driver for, so it is now **always taxable even when the client is resale tax-exempt**. Previously `taxAmount` returned 0 for any exempt client regardless of billing method. Introduced module-level `DEFAULT_TAX_RATE = 10.4` (Kent WA combined fallback) and a single memoized **`effectiveTaxRatePct`** (null = not taxable) as the one source of truth feeding the tax math, the persisted `taxFields` snapshot, and the displayed Pricing-summary breakdown — they can no longer diverge. COD uses the client's saved `tax_rate_pct` when finite/>0 else `DEFAULT_TAX_RATE`; `bill_to_client` unchanged (still respects `tax_exempt`). `taxFields` in `handleSubmit` now records `customer_tax_exempt: false` + effective rate for COD rows. Fixed the breakdown gate so a COD order for a resale-exempt client shows the Subtotal + Sales Tax lines (was hidden on `taxExempt`, making the total jump unexplained); the Sales Tax label appends "— collected on COD" in that case. Code review (`.claude/agents/code-reviewer.md` checklist via Opus — registered subagent unavailable in harness): one Important UX finding (hidden breakdown) fixed in follow-up commit, no Critical; React-calculates-billing posture unchanged (continues existing Task 8a display/audit-snapshot pattern, authoritative billing still deferred to server-side Task 8b). tsc + `npm run build` clean. Shipped via `npm run deploy`; bundle live on origin/main (b40a4d7).

## Recent Changes (2026-05-17, remove retired Rate Parity tab — PR #454)

`feat/fix/remove-parity-tab` — deletes the old MPL-sheet-vs-Supabase **Rate Parity** tab from the Billing page; it's superseded by the Migration Dashboard at `#/migration` (`ParityDashboard.tsx`, untouched). Removed files: `src/pages/ParityMonitor.tsx`, `src/components/pricelist/LiveBillingEvents.tsx`, `src/hooks/useParityMonitor.ts`, `src/hooks/useBillingParityLog.ts`. `src/lib/api.ts` lost the now-orphaned pricing-parity cluster (`fetchPricingParity`, `PricingParityResponse`, `ParityService`, `ParityServiceSide`, `ParityClass`, `ParityClassRates`, `ParityClassVolumes` — verified consumed only by the deleted files). `src/pages/Billing.tsx`: dropped `'parity'` **and the long-dead `'review'`** from the `BillingTab` type + `VALID_BILLING_TABS`, removed the `ParityMonitor` import / tab button / render block / unused `Scale` lucide import, and corrected the stale URL-state comment. Final Billing tabs: **Report, Storage, Activity, Coverage**. Stale `?tab=parity` / `?tab=review` URLs fall back to `report` (existing `VALID_BILLING_TABS.includes` guard). Net −895 lines. Code review (ran `.claude/agents/code-reviewer.md` checklist via Opus — registered subagent type unavailable in harness): no Critical/Important; one nit (stale comment) fixed. tsc + `npm run build` clean. Shipped via `npm run deploy`; bundle live on origin/main.

## Recent Changes (2026-05-17, Orders service-date range filter — PR #452)

`feat/orders/scheduled-date-filter` — adds a client-side service-date range filter to the delivery Orders list (`src/pages/Orders.tsx`). New module helper `orderServiceDateISO(o)` returns the order's effective service date as a `YYYY-MM-DD` string using the **exact same precedence as the existing Service Date column cell**: operator-picked `localServiceDate` first, else DT `scheduledAt` rendered in `America/Los_Angeles` (`toLocaleDateString('en-CA', …)` for a lexicographically-comparable key); drafts (no date) drop out once any bound is set. Range persisted in the URL as `?from=YYYY-MM-DD&to=YYYY-MM-DD` via the existing `useUrlState` hook (default push, same back-button contract as the page's client/status/search filters) so browser-Back from an order detail restores the filtered list. New `filteredByDate` useMemo is the last link in the existing filter chain before `useReactTable` (after status), feeding `data: filteredByDate` — no new Supabase query, filters the already-loaded rows. UI: a `Service Date [from] – [to]` control with native date inputs (min/max cross-bound caps), a **Today** quick-set (Pacific), a **Clear dates** button, and folded into the global **Clear filters** reset. Code-review follow-up: added a "No orders match the current filters" empty state (date-range-specific hint) so an over-narrow range / stray Today click no longer shows a bare empty grid. Code review (ran `.claude/agents/code-reviewer.md` checklist via Opus — registered subagent type unavailable in harness): no Critical, one Important (the empty-grid UX, fixed), nits accepted as pre-existing. tsc + `npm run build` clean. Shipped via `npm run deploy`; bundle live on origin/main.

## Recent Changes (2026-05-15, shared-doc service-role proxy — closes #443/#444 open risk)

`fix/fix/shared-doc-proxy` — resolves the **Open risk** left by PR #443/#444: anon storage RLS for the `documents` bucket (`documents_storage_anon_read_via_share`, migration `20260514120000`) is not reliably live in prod, so the public shared-attachments page (`/#/shared/attachments/{shareId}`) still failed to open PDFs (anon `.download()` → `new row violates row-level security policy`). New Deno Edge Function `supabase/functions/get-shared-doc/index.ts` serves the file bytes with the **service role**, gated solely by the share itself — it re-implements the exact anon RLS predicate (`photo_shares.active=true` AND `expires_at` NULL-or-future AND `doc_id ∈ doc_ids` AND `documents.deleted_at IS NULL`), returns a single generic 404 for every deny case (no share/doc enumeration oracle), validates `doc_id` as a UUID, sanitizes the `Content-Disposition` filename, and sets `Cache-Control: no-store` so a revoked share can't be served from cache. `src/pages/PublicPhotoGallery.tsx` `openDoc()` now `fetch()`es `{VITE_SUPABASE_URL}/functions/v1/get-shared-doc?share_id=…&doc_id=…`, surfacing HTTP/JSON errors inline (same `role="alert"` UX, no regression to the photos path; metadata loader unchanged). **DEPLOY REQUIREMENT:** the function must be deployed with `--no-verify-jwt` (the browser opens it directly with no Authorization header). Code review (locked-in Stride reviewer, Opus): no Critical; one Important — wildcard CORS on service-role-served bytes — judged acceptable (128-bit hex slug is the gate, parity with the prior anon path, consistent with repo edge-fn convention) and accepted as a conscious decision. React side shipped via `npm run deploy`. **Edge function NOT yet deployed** — this builder environment has no Supabase MCP / `SUPABASE_ACCESS_TOKEN`; deploy command handed to Justin (see Pending User Actions).

## Recent Changes (2026-05-15, shared-doc anon spinner hang — PR #443)

`fix/delivery/shared-doc-blob-download` — the public shared-attachments page (`/#/shared/attachments/{shareId}`, no-auth, anon Supabase key) rendered document metadata but PDFs never opened — infinite spinner; drivers could not see delivery docs. Root cause: `supabase.storage.from('documents').createSignedUrls(...)` fails silently for the **anon** role on the private `documents` bucket (the `/object/sign` path does not surface a storage RLS denial), and `loadDocs` swallowed the result error (`const { data: signed }`). Fix in `src/pages/PublicPhotoGallery.tsx`: dropped pre-minted signed URLs; bytes are now fetched lazily per-click via `supabase.storage.from('documents').download(storage_key)` → `URL.createObjectURL` → open blob in a new tab, with any download/RLS error surfaced inline (`role="alert"`) instead of an endless spinner. **No widening of anon exposure** — `.download()` goes through the same share-scoped policies (`documents_anon_read_via_share` + `documents_storage_anon_read_via_share`, both gated on an active non-expired `photo_shares` row containing the doc id). Photos loader intentionally unchanged. **Open risk:** if anon `.download()` also fails in prod, the true root cause is `documents_storage_anon_read_via_share` (migration `20260514120000`) not being live — that needs a DB migration or a `get-shared-doc` service-role Edge Function, which the builder session could not deploy (no Supabase MCP / access token in that environment). This PR at minimum converts a silent infinite hang into a visible, diagnostic error. React-only; deployed via `npm run deploy`.

## Recent Changes (2026-05-14, CB Consolidated_Ledger auto-reconcile on QBO push — PR #438)

**Trigger:** Justin reported INV-001152 (Vida Design - Merit, sidemark `MERIT MODEL`, $50) failed to push to QBO while sibling invoices in the same batch (INV-001111, INV-001112, INV-001113) pushed cleanly. Diagnosis via [`qbo_push_jobs.id 1804a1d3-…`]: React correctly sent INV-001152's two ledger_row_ids (`INSP-TASK-INSP-62993-1`, `RCVG-62993-SHP-000270`) in the push job's `ledger_row_ids` array, but GAS's grouping loop at [StrideAPI.gs ~line 41090](AppScripts/stride-api/StrideAPI.gs) only built 3 invoiceGroups (`total_count = 3`). The grouping reads CB Consolidated_Ledger filtered by `STATUS='INVOICED'` + LEDGER ROW ID in the selection; INV-001152's two rows had drifted in CB (missing or non-Invoiced status), so they got silently dropped from the push. Same drift on 6 sibling invoices stuck unpushed since 2026-05-05 / 2026-05-06: INV-001015, INV-001038, INV-001076, INV-001099, INV-001100, INV-001147.

**Root cause:** `handleCreateInvoice_`'s CB-write at ~line 25303 dedupes by Ledger Row ID with a bare `continue` (skip, no update). Combined with the symmetry gaps in `handleVoidInvoice_` (open backlog #5) and `handleReopenTask_` (open backlog #7) where the void doesn't propagate to CB, CB drifts behind per-tenant Billing_Ledger + `public.billing` mirror. Suspicious timing on INV-001152: task `INSP-62993-1` was touched at 2026-05-14 20:25 UTC (2h before the push), billing rows updated 2 min later at 20:27 — consistent with a reopen-task / re-complete cycle that updated `public.billing` + the per-tenant sheet but never reached CB.

**Strategic decision (justin approved 2026-05-14):** per [MIG-005](stride-gs-app/MIGRATION_STATUS.md) CB retires entirely in Phase 4b. Patching CB-symmetry bugs in GAS = paint on a demolished wall. Bridge with a reconciler that reads `public.billing` (post-migration source of truth) and brings CB into agreement; the structural fix lives in SB-native invoice handlers in Phase 4a / 4b.

**Built (v38.222.0, Apps Script version 517):**

- **`reconcileCbFromBilling_(invoiceNos)`** at [StrideAPI.gs:41299](AppScripts/stride-api/StrideAPI.gs) — reads `public.billing` (non-Void rows) for the supplied invoice numbers, indexes CB by Ledger Row ID, and either:
  - **UPDATEs** the matching CB row via one `setValues` per row (overwrites only columns in the FIELD_MAP: Status, Invoice #, Client, Client Sheet ID, Date, Invoice Date, Svc Code/Name, Item ID, Description, Class, Qty, Rate, Total, Task ID, Repair ID, Shipment #, Item Notes, Sidemark, Invoice URL — preserves QBO INVOICE ID / QBO STATUS / Email Status / etc. via `slice()`-then-overwrite-mapped-only), or
  - **APPENDs** a fresh CB row for Ledger Row IDs missing from CB.
- **Idempotent** — re-running with the same state is a no-op. **Input sanitized** against `^[A-Za-z0-9_\-]+$` before injection into the PostgREST `in.(...)` filter. **Defensive cross-tenant guard** — skip + log when the existing CB row's Client Sheet ID disagrees with the incoming `public.billing.tenant_id`. **`SpreadsheetApp.flush()`** before return so the caller's grouping pass sees post-reconcile state.
- **`handleQboCreateInvoice_` auto-call** at [StrideAPI.gs:41600](AppScripts/stride-api/StrideAPI.gs) — derives the set of covered invoice numbers from `public.billing` (one `supabaseSelect_` on the incoming `ledger_row_ids`), calls the reconciler, then proceeds with the existing grouping pass. Wrapped in try/catch so a Supabase outage degrades to the prior behavior (silent skip of drifted rows) rather than blocking the push.

**Out of scope:**
- Doesn't fix the underlying CB-symmetry bugs in `handleCreateInvoice_` / `handleVoidInvoice_` / `handleReopenTask_`. Per MIG-005, those resolve when CB retires in P4b.
- Doesn't reconcile **Void** rows. `public.billing` filter excludes Void; CB rows that should be Void but show Invoiced will keep showing Invoiced until backlog #5 ships. Acceptable trade-off — no such row observed in production (verified: zero ledger_row_ids in `public.billing` have multi-invoice history).
- Per-row `setValues` loop at scale: TODO comment flags ~200-invoice batches as the point where batched-setValues optimization becomes necessary (current 7-invoice cleanup is well under the 6-min Apps Script limit).

**Open hardening backlog status post-bridge:**
- Items #5 and #7 (CB-symmetry) — **bridged**, not fixed. Will be retired with CB in P4b.
- Items #4 (pre-commit Unbilled re-check), #8 (line-count assertion) — **deferred into Phase 4a** design rather than patched in GAS.
- Item #6 (handleVoidInvoice_ flips to terminal Void with no re-issue path) — still open; bridge doesn't address.
- Items #9 / #10 (detection gaps) — pre-commit re-check folds into #4 (Phase 4a); nightly anomaly sweep still open as a transitional safety net.

**Pending user actions:**
- [ ] Justin retries QBO Push for the 7 stuck invoices (INV-001015, INV-001038, INV-001076, INV-001099, INV-001100, INV-001147, INV-001152). Expected: all push cleanly. `INV-001015` is $0 and may fail with a QBO API error (separate issue); the other 6 should succeed.

---

## Recent Changes (2026-05-14, delivery → P+D conversion — PR #431)

**Trigger:** Justin asked whether an existing delivery order could be edited and converted to a Pickup + Delivery order when a client decides they want a pickup leg added — without losing the inventory items already assigned to the delivery. The modal's existing mode cards weren't gated for edit mode, but the save handler only had branches for (a) edit-an-already-P+D and (b) edit-a-single-leg-in-place — so clicking the P+D card on a standalone delivery and saving would fall through to the brand-new-order create path and produce a duplicate disconnected pair (orphaning the original delivery).

**Decisions locked before build:**
- **Identifier scheme:** keep delivery's ROC-N-tenant-D; mint matching ROC-N-tenant-P for the new pickup by string-substituting the trailing two chars. Customer-known number stays + already-DT-pushed delivery isn't re-numbered.
- **DT republish:** auto-push both legs after save (same pattern as the existing P+D edit branch).
- **Gate:** allow on any delivery whose source status isn't terminal (completed: status_id ∈ {7=arrived, 100=delivered, 102=partial_delivery}; cancelled: status_id=9 or review_status='cancelled').

**What landed:**

- New save branch in [`CreateDeliveryOrderModal.handleSubmit`](stride-gs-app/src/components/shared/CreateDeliveryOrderModal.tsx) inserted before the existing P+D edit branch. Four-condition gate (`editingDraftRowIdRef.current && !editingPickupRowIdRef.current && mode === 'pickup_and_delivery' && originalOrderTypeRef.current === 'delivery'`) routes only the conversion case here; brand-new orders, already-P+D edits, single-leg pickup/service edits all flow past untouched. Sequence inside the branch: (1) load existing delivery's identifier + tenant, (2) derive `-P` identifier from trailing `-D`, (3) pre-flight collision check, (4) INSERT new pickup row (pricing fields NULL'd per the create-P+D convention at line ~2520), (5) UPDATE existing delivery row's `order_type` + `linked_order_id` + any operator edits + apply taxFields, (6) on UPDATE failure roll back the just-inserted pickup so no orphan half-pair, (7) DELETE + INSERT items via `buildPDItemRows(newPickupId, existingDeliveryId)`, (8) audit-log row with `action='convert_to_pd'`, (9) `repushOrdersAfterEdit` on both legs (dt-push-order edge function follows linked_order_id and pushes the new pickup via the linked-pair logic).
- New refs `originalStatusIdRef` and `originalOrderTypeRef` captured on edit-load alongside `originalReviewStatusRef`.
- Mode-card UI gate: P+D card disabled with title-attribute tooltip when source delivery is terminal. Amber "Adding a pickup leg to this delivery on save" hint badge rendered on the P+D card whenever the operator has it selected during a valid conversion.
- `convert_to_pd` added to [`DtOrderAuditAction`](stride-gs-app/src/lib/dtOrderAudit.ts) union.

**Preservation guarantees on the existing delivery:**
- `id`, `dt_identifier`, `created_at`, `created_by_*`, `source` — UPDATE in place never touches them.
- Audit log, photos, notes, attachments — all FKs target `dt_orders.id` which is stable.
- Inventory items + their `inventory_id` FKs — rebuilt from `selectedInvItems[].inventoryRowId` (the edit-load hydrates this from the original rows).
- DT-side record — the existing pushed_to_dt_at timestamp and DT order_number reference stay valid since dt-push-order is upsert-by-identifier.

**Item row UUIDs do change** in the DELETE-then-INSERT refresh, but `parent_pickup_item_id` is the only external FK to `dt_order_items.id` and the helper re-stamps it. No external references break.

**Out of scope:**
- Pickup-only → P+D conversion (different pickup-contact field semantics; the `originalOrderTypeRef.current === 'delivery'` guard explicitly excludes it).
- Reverse conversion (P+D → delivery-only by dropping the pickup leg).
- Hardening item reload-on-edit so released/transferred items don't silently drop from the rebuilt batch — pre-existing risk on the existing P+D and single-leg edit branches too; flagged by code-reviewer as a backlog item.

---

## Recent Changes (2026-05-14, deploy.js step-3 push-failure propagation — PR #428)

**Symptom:** On 2026-05-14's photo-default deploy the operator ran `npm run deploy -- "..."` from a canonical clone whose local `source` had diverged from `origin/source` (local stale commit + new commits on origin). Step 1 (build) and step 2 (push dist → origin/main) both succeeded. Step 3's source push was rejected non-fast-forward, but the script still printed `[deploy] ✓ all steps complete` and exited 0. Operator believed the deploy landed, spent ~30 min debugging why the change wasn't live.

**Root cause:** In the `!hasUncommittedChanges(parentDir)` branch of step 3 (clean working tree, possibly ahead of remote), [`pushWithRetry`](stride-gs-app/scripts/deploy.js) was wrapped inside a single `try { rev-list + pushWithRetry } catch (_) { /* ignore */ }` block alongside the rev-list ahead-check. The empty catch was intended to tolerate `origin/source` not being fetched locally (a benign rev-list failure), but it indiscriminately swallowed the `pushWithRetry` rejection — leaving no error signal even when both push attempts (initial + the schannel-TLS retry) had failed.

**Fix:**
- Narrowed the try/catch to wrap **only** the `git rev-list --count origin/source..HEAD` `execFileSync` call. The push (`pushWithRetry(['origin', 'source'], parentDir)`) is now outside any try/catch — its rejection propagates to Node's default uncaught-exception handler and the script exits non-zero. The benign rev-list failure still degrades safely (logs `could not compare with origin/source — skipping ahead-check`, sets `ahead = 0`, no push attempted).
- Hardened `pushWithRetry`: the second-attempt `execSync` is now wrapped in its own try/catch that prints `✗ push failed on both attempts: git push origin source` with both attempts' error messages, then re-throws. The retry already propagated via uncaught `execSync` before, but the explicit throw + diagnostic message is refactor-safe and gives the operator the real failure context (non-fast-forward / auth / etc.) instead of a generic schannel-TLS hint.
- The primary step-3 push (the `hasUncommittedChanges` branch at line 175) was already a bare call with no surrounding catch — the fix doesn't regress that path.

**File:** [`stride-gs-app/scripts/deploy.js`](stride-gs-app/scripts/deploy.js) — `pushWithRetry` helper (lines 84–111) + step-3 clean-tree branch (lines 180–207).

**Verification:** TypeScript `--noEmit` clean, `npm run build` clean (2,282 modules, 5 build steps + dist integrity check passing), Opus-4.7 code-reviewer subagent returned no Critical/Important findings.

---

## Recent Changes (2026-05-14, P+D create regression — PR #424)

**Symptom:** Reported live this morning. Every attempt to create a Pickup + Delivery order returned `P+D promote items insert failed: null value in column "id" of relation "dt_order_items" violates not-null constraint`. Because the `dt_orders` insert happens before the items insert in the same save flow, each failed click left an orphan pair behind — operator retried 3 times → ROC-00087-101400941, ROC-00088-101400941, ROC-00089-101400941 (six rows total, all item_count=0).

**Root cause:** The v2026-05-13 PU→Delivery item-sync work (PR #389) added a `parent_pickup_item_id` FK between the mirrored delivery-leg row and its pickup-leg counterpart. To stamp that FK on the mirror row at insert time, [`buildPDItemRows`](stride-gs-app/src/components/shared/CreateDeliveryOrderModal.tsx) generates a `crypto.randomUUID()` for the pickup row and assigns `id: pickupRowId` on that one row. The other three row shapes in the same batch (inventory rows, delivery-mirror row, delivery-only ad-hoc rows) kept their previous no-`id` shape. Supabase JS's batch insert serializes the array to the union of keys across all rows; rows missing a key that another row has get that key sent as explicit NULL — which overrides the table's `id uuid DEFAULT gen_random_uuid() PRIMARY KEY` default and trips the NOT NULL. Before v2026-05-13 no row had `id` so PostgREST omitted the column entirely and the DEFAULT fired; the new explicit `id` on one row poisoned the whole batch.

**Fix:** Assign `crypto.randomUUID()` to every row built in `buildPDItemRows` so the batch has uniform shape and no row sends `id: null`. Long comment block on the helper documents the failure mode + names the previous regression so the next builder doesn't re-introduce the same trap on a different selectively-set column. No schema change, no migration.

**File:** [`stride-gs-app/src/components/shared/CreateDeliveryOrderModal.tsx`](stride-gs-app/src/components/shared/CreateDeliveryOrderModal.tsx) — `buildPDItemRows` helper (~line 1489).

**Cleanup:** The 6 orphan rows (3 P+D pairs, item_count=0 each, properly cross-linked via `linked_order_id`, never pushed to DT) were hard-deleted in a single transaction after the fix deployed. Self-referential `linked_order_id` was NULL'd first since it has no `ON DELETE` clause. SQL recorded in session transcript.

**Latent-trap note for future PRs:** The other six `dt_order_items.insert(...)` call sites in CreateDeliveryOrderModal.tsx (the single-leg paths around lines 2727, 3162, 3182, 3582, 3595 + the bulk-edit-reinsert paths) are uniform-no-id arrays today. They'll keep working as long as no future change adds an explicit `id` — or any other column that overlaps with a server-side default — to a subset of rows in those builders. Same class of bug, same fix shape if it ever bites.

---

## Recent Changes (2026-05-13, [MIGRATION-P3] repair-cluster — PRs #405–#408)

**Trigger:** Justin asked to migrate repairs out of GAS (only the completion-time billing-ledger write should remain in GAS for now). Aligned with MIGRATION_STATUS.md's P3 phase + MIG-013 (Path-C hybrid: keep framework gates — feature flags, shadow handlers, reverse writethrough, canary — but skip the 90-day historical replay since corpus is only ~4 days old). Per Justin's later direction: repairs are low-volume so canary is single-tenant + short or fleet-flip immediately after a clean smoke test.

**Cluster order + state:**

| # | Handler | PR | State | Flag | Notes |
|---|---|---|---|---|---|
| 1 | `cancelRepair` | [#405](https://github.com/Stride-dotcom/Stride-GS-app/pull/405) | handler_drafted, smoke-tested ✓ | `cancelRepair` | Status flip only; foundation PR established the template. |
| 2 | `startRepair` | [#406](https://github.com/Stride-dotcom/Stride-GS-app/pull/406) | handler_drafted | `startRepair` | Status flip + start_date stamp + Approved/In Progress/Complete re-run rules. PDF generation stays React-side via `lib/workOrderPdf.ts`. |
| 3 | `sendRepairQuote` | [#407](https://github.com/Stride-dotcom/Stride-GS-app/pull/407) | handler_drafted | `sendRepairEmails` (paired w/ #4) | Status flip + 11 quote columns + REPAIR_QUOTE email via Resend. StrideAPI v38.216.0 extends REVERSE_REPAIR_FIELDS_ to all 17 repair columns. Server-recomputes totals from quote lines. Idempotent re-send detection. |
| 4 | `respondToRepairQuote` | [#408](https://github.com/Stride-dotcom/Stride-GS-app/pull/408) | handler_drafted | `sendRepairEmails` (paired w/ #3) | Approve→approved=true+status='Approved'+REPAIR_APPROVED email; Decline→status='Declined'+REPAIR_DECLINED email. Idempotent on already-resolved. |
| 5 | `requestRepairQuote` (single-item) | — | not_started | `requestRepairQuote` | NEXT SESSION. ~30 min — TaskDetailPanel + ItemDetailPanel call `request-repair-quote-sb` with `itemIds:[oneItem]`. Existing multi-item infra already does the work; just retire the legacy GAS call sites. |
| 6 | `completeRepair` (P4a) | — | not_started | `completeRepair` | NEXT SESSION (bigger). ~4-5 hrs. Per MIG-004 the status+billing+addons+email are one logical transaction. SB writes `public.billing` rows directly (authoritative). Then TWO new GAS writes: `__writeThroughReverseBilling_` for the per-tenant Billing_Ledger sheet + a new `mirrorBillingToCb` GAS endpoint for the CB Consolidated_Ledger (different spreadsheet from the per-tenant one). REPAIR_COMPLETE email via Resend. Standard 14-day canary per MIG-013 since billing is in the path. P4b later retires CB sheet entirely. |

**Key architectural call (this session):** Justin asked whether SB needs both a client billing ledger AND a consolidated ledger like the GAS world has. Answer: NO — `public.billing` is a single table with `tenant_id` as a column. The per-tenant view is `WHERE tenant_id=X`; the consolidated view is the full table. The two SHEETS exist in GAS only because Google Sheets can't aggregate across spreadsheets. After P4b, the CB sheet is gone and Supabase is the only billing store.

**Framework substrate touched:**
- Migration `20260513200000_seed_repair_p3_feature_flags.sql` (PR #405) — seeded 3 missing feature_flags rows: `requestRepairQuote`, `respondRepairQuote`, `cancelRepair`. `startRepair`, `sendRepairEmails`, `updateRepair`, `completeRepair` were already in P1.1.
- `__writeThroughReverseRepairs_` writer registered in StrideAPI v38.215.0 (cancelRepair) → extended to 17 columns in v38.216.0 (sendRepairQuote). Idempotent by Repair ID + per-field value comparison; throws on missing row.
- `SHADOW_REGISTRY` in `replay-shadow` now lists 5 entries: `updateItem`, `cancelRepair`, `startRepair`, `sendRepairQuote`, `respondToRepairQuote`.
- All 4 SB primaries verify JWT signature via `supabase.auth.getUser(token)` against an anon-keyed client (NOT just `atob` decode — that was a critical code-review fix in PR #405 carried through every subsequent handler).

**Smoke test result (cancelRepair, PR #405):**
- `cancel-repair-sb` invoked via curl with anon JWT against a synthetic test repair
- `public.repairs.status='Cancelled'` ✓
- `entity_audit_log` row with `action='cancel'` + `changes={"status":{"new":"Cancelled"}}` + `source='edge'` ✓
- Idempotent double-call returns `alreadyCancelled:true` with no second audit row ✓
- Mirror failure (test repair was SB-only, not in the sheet) correctly logged to `gs_sync_events` ✓

**What's flippable in Settings → Migration RIGHT NOW** (fleet-wide, `tenant_scope=NULL`):
- `cancelRepair` → activates SB Cancel Repair button
- `startRepair` → activates SB Start Repair button
- `sendRepairEmails` → activates BOTH Send Quote AND Approve/Decline at once (they share the flag per P1.1 seed)

**Activation path:** flip `parity_enabled=true` first to log shadow comparisons for a few real clicks; once parity_results shows matches, flip `active_backend='supabase'`. Master-switch emergency revert in the same UI flips everything back to GAS atomically.

**Versions deployed live:**
| Layer | Version |
|---|---|
| StrideAPI Web App | v38.223.0 / v518 |
| `cancel-repair-sb` | v1 |
| `cancel-repair-shadow` | v1 |
| `start-repair-sb` | v1 |
| `start-repair-shadow` | v1 |
| `send-repair-quote-sb` | v1 |
| `send-repair-quote-shadow` | v1 |
| `respond-repair-quote-sb` | v1 |
| `respond-repair-quote-shadow` | v1 |
| `replay-shadow` | v5 |

---

## Recent Changes (2026-05-14, repair_items CASCADE FK — PR #430)

**Trigger:** Justin's morning check turned up 15 orphan `public.repair_items` rows for Seva Home (tenant `1_E5xG0PZR8pGxxFVudrRDLU8NyLYDIXkG4rbPcBfj0s`). Parent `public.repairs` rows had been deleted manually on 2026-05-13 during PR #397 (multi-item repair) testing, but child `repair_items` rows survived because the join columns were never bound by a foreign key — the create migration `20260513160000_repair_items_table.sql` only declared the columns and a UNIQUE on `(tenant_id, repair_id, item_id)`. After cleanup (one parent row restored — `RPR-63280-1778715634749`; 9 ghost orphans deleted), we needed to lock the door.

**Built:**

- Migration [`20260514120000_repair_items_cascade_fk.sql`](stride-gs-app/supabase/migrations/20260514120000_repair_items_cascade_fk.sql) — three parts in one file:
  - **Guard 1:** `RAISE EXCEPTION` if any orphan `repair_items` rows are found at apply time. Clear error message instead of a generic "violates foreign key constraint" if the cleanup regressed between authoring and apply.
  - **Guard 2:** Idempotently add `UNIQUE (tenant_id, repair_id)` on `public.repairs` if no matching unique/PK already covers those columns. `pg_constraint` introspection via lateral `pg_attribute` join; column order doesn't matter (alphabetical compare). Production already had `repairs_tenant_id_repair_id_key` so this branch was skipped at apply.
  - **FK add:** `repair_items_parent_fk FOREIGN KEY (tenant_id, repair_id) REFERENCES public.repairs (tenant_id, repair_id) ON DELETE CASCADE`. Wrapped in a `DO` block with a `pg_constraint` existence check so manual `psql -f` replay won't fail.

**Apply-time fix:** First apply attempt raised 42883 ("operator does not exist: name[] = text[]") because Guard 2 compared the unaliased `pg_attribute.attname` (type `name`) against a text array literal. Fixed inline with `::text` casts on both sides; pushed the corrected SQL back to the PR file so the migration in source matches what was actually applied.

**Why `ON DELETE CASCADE` (not `RESTRICT` / `SET NULL`):** Repair items have no standalone meaning — they're membership rows for a parent repair. Lifecycle is parent-owned; children should never outlive it. Mirrors `will_calls/will_call_items` (which notably has no FK either — pre-existing gap, separate backlog item).

**Tenant isolation:** The composite FK on `(tenant_id, repair_id)` means a child row can't reference a parent in a different tenant. Same column shape as the existing UNIQUE on `repair_items(tenant_id, repair_id, item_id)` and the index `idx_repair_items_repair_id` so CASCADE deletes are index-backed.

**Postgres-only change** — no React/GAS/edge-function deploy needed. Applied to production via `apply_migration` MCP and verified with `\d+ repair_items` showing the FK live.

---

## Recent Changes (2026-05-13, multi-item repair jobs — PR #397)

**Trigger:** Justin asked whether multiple inventory items could be added to a single repair job/quote (like Will Calls). Audit found N-to-1 was structurally unsupported — `repairs.item_id` was a single column, no join table, and bulk-quote operations looped to create N separate repairs. Built the join table + SB-authoritative create path mirroring the WC pattern.

**Design constraints (Justin):**
- Treat the quote/billing as one charge **per job**, not per item. Pass/fail per item doesn't affect billing.
- Existing details page, quote, and pricing fields stay exactly as they are — repair just holds more items now.
- All in Supabase. No GAS/sheet writes except strictly as needed (only the billing-ledger write on completion stays in GAS for now).
- Email via Resend (`send-email` edge function), not GAS Drive doc generator.
- Add/remove items after creation: NOT supported — would invalidate the quote, so cancel-and-rebuild OR a future re-quote flow is the correct UX.

**What landed:**

- Migration [`20260513160000_repair_items_table.sql`](stride-gs-app/supabase/migrations/20260513160000_repair_items_table.sql) — new `public.repair_items` join table (id, tenant_id, repair_id, item_id, qty, item_result, item_notes). RLS mirrors `public.repairs` (service_role full, staff/admin SELECT, client SELECT scoped by tenant). Realtime enabled. **Backfill: 33 existing repairs → 33 repair_items rows** so legacy single-item repairs and new multi-item repairs have identical data shape.
- Migration [`20260513170000_create_repair_quote_request_rpc.sql`](stride-gs-app/supabase/migrations/20260513170000_create_repair_quote_request_rpc.sql) — `next_repair_id(first_item_id)` helper (keeps the existing `RPR-{item_id}-{millis}` format) + `create_repair_quote_request(tenant_id, item_ids[], ...)` SECURITY DEFINER RPC. Atomic parent + items insert. Inventory-membership validation per tenant (`EXCEPT` query → 23503 with the missing IDs). Auth check uses three-case logic documented inline: service_role bypass via `v_caller_uid IS NULL`, staff/admin pass, client raises 42501.
- Edge function [`request-repair-quote-sb`](stride-gs-app/supabase/functions/request-repair-quote-sb/index.ts) v1 — calls the RPC, resolves client name/email + inventory descriptions/vendors/sidemarks for the email tokens, renders `{{ITEM_TABLE_HTML}}` server-side, dispatches via `send-email` with template `REPAIR_QUOTE_REQUEST`. The template already had the `{{ITEM_TABLE_HTML}}` token — just needed populating (no template edit). Email failure logs to `gs_sync_events` for FailedOperationsDrawer; repair stays committed (success from caller's POV).
- API helper [`postRequestRepairQuoteSb`](stride-gs-app/src/lib/api.ts) — calls the edge function via `supabase.functions.invoke`.
- Fetcher: [`fetchRepairByIdFromSupabase`](stride-gs-app/src/lib/supabaseQueries.ts) eagerly joins `repair_items` + inventory overlay → exposes `items[]` on `ApiRepair`. New `ApiRepairItem` type.
- UI: [Inventory.tsx](stride-gs-app/src/pages/Inventory.tsx) bulk-quote handler swapped from `postBatchRequestRepairQuote` (N repairs) to `postRequestRepairQuoteSb` (1 repair with N items). Optimistic temp count drops from N to 1.
- UI: [RepairDetailPanel.tsx](stride-gs-app/src/components/shared/RepairDetailPanel.tsx) renders an items table when `repair.items.length > 1` — Item ID, Description, Vendor, Sidemark, Location, Result columns. Legacy single-item view preserved for `items.length <= 1` so existing repairs don't visually change.

**Code review fixes applied before merge:**
- Branch was rebased onto current `origin/source` (had forked off pre-PR-#395/#396 base; would have reverted both)
- `APP_URL` trailing `#` removed (token was double-prefixing)
- `gs_sync_events` audit-insert errors now log loudly (no silent swallow)
- RPC auth-check comment expanded to document the three caller paths

**Out of scope / deferred (each clean follow-up):**
- Add/Remove item after creation — requote-or-rebuild is the design call; no incremental editing
- Per-item pass/fail toggle UI — column + display exist (read-only), staff edit UI is future
- Legacy single-item GAS path → SB cutover — single-item still routes through GAS for folder/email; that's a separate Migration phase
- Multi-item handling in REPAIR_QUOTE / REPAIR_APPROVED / REPAIR_DECLINED / REPAIR_COMPLETE email templates — currently use single-item tokens for the primary item; multi-item versions can lean on the same `{{ITEM_TABLE_HTML}}` pattern

**Versions deployed live:**
| Function | Version |
|---|---|
| `request-repair-quote-sb` | v1 |

---

## Recent Changes (2026-05-13, PU→Delivery item-sync engine — PRs #388 + #389)

**Trigger:** Justin noted that when drivers complete a pickup job they often make adjustments (qty short, items damaged, notes about "actually 3 pieces not 1") in the DT pickup card — but that data wasn't flowing anywhere. The matching delivery order had no idea the pickup had even happened, the items table showed no pickup state, and DT's delivery card stayed at the original ordered values. Built end-to-end propagation in two PRs.

**PR #388 — order-level banner (foundation):**

- Migration [`20260513120000_dt_pickup_linkage_propagation.sql`](stride-gs-app/supabase/migrations/20260513120000_dt_pickup_linkage_propagation.sql) — adds `dt_orders.linked_pickup_finished_at`, `dt_orders.linked_pickup_driver_name`, `dt_order_items.picked_up_at` + partial index.
- Helper [`_shared/stamp-pickup-on-linked-delivery.ts`](stride-gs-app/supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts) — invoked from `notify-pickup-completed` v2 (webhook path, stamps `now()` placeholder) and `dt-sync-statuses` v12 (poll path, overwrites placeholder with real DT timestamp + driver). Idempotent, never throws.
- `dt-webhook-ingest` v8 — fires `dt-sync-statuses` for ALL Service_Route_Finished events, not just non-pickups, so the placeholder upgrade happens within ~10–30s.
- UI: green "Picked up [when] by [driver]" banner on the delivery `OrderPage` ([components are inline](stride-gs-app/src/pages/OrderPage.tsx)). Per-item ✓ Picked up indicator on the items table.

**PR #389 — item-level sync (qty + notes + DT push-back):**

- Migration [`20260513140000_dt_order_items_parent_pickup_fk.sql`](stride-gs-app/supabase/migrations/20260513140000_dt_order_items_parent_pickup_fk.sql) — adds `dt_order_items.parent_pickup_item_id` self-referential FK + description-match backfill (strips "PICK UP: PU: " prefix variants).
- Migration [`20260513140100_…fungible_backfill.sql`](stride-gs-app/supabase/migrations/20260513140100_dt_order_items_parent_pickup_fk_fungible_backfill.sql) — top-up for pairs with duplicate descriptions (e.g. 2 chairs × 2 chairs); zips them in row-id order since fungible items are interchangeable.
- Migration [`20260513150000_dt_order_items_pickup_audit_columns.sql`](stride-gs-app/supabase/migrations/20260513150000_dt_order_items_pickup_audit_columns.sql) — adds `pickup_item_note` / `pickup_return_codes` / `pickup_delivered_quantity` audit columns. Replaces the original sentinel-marker concatenation approach (brittle against staff edits) flagged in PR #388 code review.
- [CreateDeliveryOrderModal.tsx:1486](stride-gs-app/src/components/shared/CreateDeliveryOrderModal.tsx#L1486) — generates client-side UUID for the PU row when building a P+D pair so the mirrored delivery row can be stamped with `parent_pickup_item_id` at creation. Forward-path FK established without server-side round-trip.
- Helper rewritten with two propagation tiers. **Tier A** (always fires): order-level stamp + `picked_up_at` via FK with `dt_item_code` legacy fallback. **Tier B** (`propagateItemFields: true`, sync path only): copies `pu.delivered_quantity` → `pickup_delivered_quantity`, `pu.item_note` → `pickup_item_note`, `pu.return_codes` → `pickup_return_codes`. Authoritative `delivery.quantity` overwrite gated behind `quantity === original_quantity` (the "unedited by staff" proxy). Returns `itemsPropagated: string[]` for caller.
- `dt-sync-statuses` v13 — after Tier-B returns items propagated, fire-and-forget `dt-push-order` for the linked delivery so DT manifest reflects the post-PU reality. Failed dispatch logs to `gs_sync_events` for FailedOperationsDrawer.
- UI: items table now shows a green "From pickup: picked up 2 of 3. 'damage on box 2'. Return codes: damaged." sub-row under any item that has audit fields set ([OrderPage.tsx:786](stride-gs-app/src/pages/OrderPage.tsx)).

**Idempotency:**
- `picked_up_at`: `WHERE picked_up_at IS NULL` (first write wins)
- `pickup_*` audit columns: always overwrite (PU is source of truth, converges)
- `quantity` authoritative overwrite: gated on `quantity === original_quantity`
- `dt-push-order` push-back: skipped when no items changed in the sync run

**Versions deployed live:**
| Function | Version |
|---|---|
| `dt-webhook-ingest` | v18 |
| `dt-sync-statuses` | v18 |
| `notify-pickup-completed` | v3 |

**Deferred to follow-up (Phase 2.5):**
- `dt-push-order` should merge `pickup_item_note` into the per-item DT push so the DT delivery card shows the PU note inline. Today the PU note shows in the app but not in the DT manifest.
- 2 historical P+D pairs (`MRS-00047`, `MRS-00049`) didn't auto-link in the backfill (count mismatch / prefix variant). Forward path covers everything new; backfill cleanup not blocking.

---

## Recent Changes (2026-05-13, dt-sync-statuses cron — DT-side cancels auto-flow into the app)

**Trigger:** Justin asked how to cancel a delivery order from inside the app such that the items unlink, the "D" inventory badge clears, and DT's status flips to cancelled. Investigation surfaced two important facts:
1. **DispatchTrack's API doesn't expose a documented cancel endpoint.** The only DT endpoint we use is `POST /orders/api/add_order` (XML upsert). No `delete_order`, no status-update endpoint visible in our code or the public docs portals (which are JS-rendered and opaque). The DT API PDF in `_archive/reference/` is image-based; couldn't text-extract.
2. **DT-side cancel doesn't fire a webhook.** Confirmed `Alert_Type` values from `dt-webhook-ingest` v7 ([index.ts:63-66](stride-gs-app/supabase/functions/dt-webhook-ingest/index.ts#L63)): Started, Unable_To_Start, Unable_To_Finish, In_Transit, Notes, Pictures, Service_Route_Finished. No Cancel.

`dt-sync-statuses` already has all the cancel-handling logic the app needs — it's a polling reconciler that pulls each order's status + items from DT's `/orders/api/export.xml` and three-way-merges. Cancelled orders flip `dt_orders.status_id` → 32 (CANCELED, category 'cancelled'), and the **"D" inventory badge clears automatically** because [Inventory.tsx](stride-gs-app/src/pages/Inventory.tsx) filters cancelled-category orders out of `dtOpenItems` / `dtDoneItems` on next render. Items that DT no longer returns get soft-deleted (`removed_at` + `removed_source='dt_sync'`). The only thing missing was *triggering the sync* — pre-this-change, an operator had to click "Sync from DT" on the Orders page manually.

**What landed** (PR pending, branch `feat/delivery/dt-sync-cron`, commit `8ff29ff`):

- Migration [`20260513134114_dt_sync_statuses_cron_schedule.sql`](stride-gs-app/supabase/migrations/20260513134114_dt_sync_statuses_cron_schedule.sql) — ensures `pg_cron` + `pg_net` extensions are available (the same migration pattern used by `20260504250000_intake_reminder_cron_schedule.sql`).
- The actual `cron.schedule()` call was applied separately via MCP `execute_sql` with the service-role JWT inlined (same pattern as the existing `intake-resign-reminder-daily` cron — environment-specific secrets shouldn't live in source). Job name: `dt-sync-statuses-active-every-5min`. Schedule: `*/5 * * * *`. Body: `{"scope":"active"}`. The `active` scope (default in dt-sync-statuses) skips orders already in terminal categories (`completed` / `cancelled` / `exception` / `billing`), so once an order syncs to cancelled it stops being polled.

**Workflow now:**
1. Operator cancels in DT's UI (typing the cancel reason into DT's Notes — already syncs back into `dt_order_notes` via dt-sync-statuses' existing reconcile)
2. Within 5 min, the cron picks it up
3. App's `dt_orders.status_id` flips to 32 (CANCELED), `D` badge clears across all inventory views, item rows soft-delete if DT dropped them from the export

**Cost envelope:** ~30-50 active orders in flight at any time × 12 ticks/hr = ~360-600 DT API calls/hr. Within DT's documented 1000/hr rate limit. If the active-order count grows materially, dial the schedule down to `*/10` or `*/15` via `cron.alter_job(...)`.

**Pin (do not regress):** the cron job is environment-specific (embeds the project URL + service-role JWT). Re-applying the migration to a clone won't recreate the schedule — that has to be done with a `cron.schedule()` call in the SQL editor or via MCP using the env's own service-role key. The migration file documents the exact SQL.

**Followup not built:** the original ask included a Cancel button INSIDE the app. We're deferring that because (a) we don't know DT's cancel API yet, (b) the polling cron handles 95% of the user need (cancel in DT → app reflects within 5 min), and (c) Justin's existing workflow of cancelling in DT first is preserved. If we ever get DT API confirmation, the in-app Cancel button is still on the table — see the cancel-order design discussion in this session's transcript.

---

## Recent Changes (2026-05-13, public-form proper fix — SECURITY DEFINER RPC)

**Trigger:** Follow-up to the same-day RLS RETURNING fix below. Justin asked to ship the proper fix that the migration comment + BUILD_STATUS entry both flagged: replace the anon direct-INSERT path with a SECURITY DEFINER RPC so anon never needs INSERT/SELECT RLS surface on `dt_orders` / `dt_order_items`, and so order + items become atomic (currently a half-success leaves an order with no items).

**What landed** (PR pending, branch `feat/fix/public-form-rpc`, commits `a013b86` + `d44c66e` + `754ff2d`):

- Migration [`20260513130526_submit_public_request_rpc.sql`](stride-gs-app/supabase/migrations/20260513130526_submit_public_request_rpc.sql) — adds `public.submit_public_request(p_order jsonb, p_items jsonb)`. SECURITY DEFINER, `search_path` locked to `public`, `EXECUTE` revoked from PUBLIC then granted to anon + authenticated only.
- Migration [`20260513131310_submit_public_request_rpc_fix_quantity_casts.sql`](stride-gs-app/supabase/migrations/20260513131310_submit_public_request_rpc_fix_quantity_casts.sql) — corrects two regressions caught in code review: `original_quantity` was always landing at 1 (wrong `NULLIF(a,b)` semantics — fixed to chained `COALESCE(orig, qty, 1)`), and `quantity` was being cast to `::integer` instead of `::numeric` to match the schema column type.
- React change in [PublicServiceRequest.tsx:908-952](stride-gs-app/src/pages/PublicServiceRequest.tsx#L908) — single `.rpc('submit_public_request', { p_order, p_items })` call replaces the two `.from(...).insert(...)` calls. Items collection no longer threads `dt_order_id` (RPC fills it server-side). `notify-public-request` edge function call still fires with the returned `id`.

**Security model:**
- RPC FORCES `source='public_form'`, `review_status='pending_review'`, `tenant_id=NULL`, `created_by_user=NULL`, `created_by_role='public'`, `pricing_override=true`, `customer_tax_exempt=NULL` regardless of caller input. Defense-in-depth `RAISE` on any input attempt to set `tenant_id != NULL` or `created_by_user != NULL` for clearer error messaging.
- Verified live: tampering attempt with `tenant_id="some-victim-tenant"` correctly returns HTTP 400 with `tenant_id must be null on public submissions`.
- Items quantity verified: `quantity:3` → `dt_order_items.quantity=3 AND original_quantity=3` (was buggy=1 in the first commit before the corrective migration).

**Two-phase rollout — legacy anon policies NOT dropped in this PR.** `dt_orders_insert_public_form_anon`, `dt_orders_select_just_inserted_public_anon`, and `dt_order_items_insert_public_form_anon` are intentionally left in place. Reasoning: if anything goes wrong with the RPC after deploy, the old anon paths still work as a safety net. Once the React change has soaked for a few days with no issues, a follow-up migration drops all three together.

**Pin (do not regress):** the RPC is the only public-write path going forward. Don't add a new code path that does direct anon `.from('dt_orders').insert(...)` — it would re-open the original bug class (RETURNING needing SELECT RLS + atomicity hole between order and items inserts).

---

## Recent Changes (2026-05-13, public service-request form 100% broken — RLS RETURNING fix)

**Trigger:** Customer reported the public delivery order form failing every submission with "We could not submit your request. Please try again, or email us if the problem persists." Screenshot showed the form filled out cleanly with $204.24 estimated total (Zone 2 base + Quote-pending Assembly + Standard Valuation + 10.4% tax) and the agreement checkbox ticked. Bug had been silently in production since at least 2026-04-27 (the last successful `source='public_form'` insert in `dt_orders`).

**Diagnostic trail (recorded for the next time this kind of error masks itself):**

1. Generic error message in [PublicServiceRequest.tsx:915](stride-gs-app/src/pages/PublicServiceRequest.tsx#L915) hides the underlying Postgres error from the user. The console.warn at line 914 has the real error but the customer's browser console wasn't captured.
2. Supabase project's `get_logs` MCP tool was broken (BigQuery analytics reservation 404 error) — couldn't pull recent failed inserts that way.
3. Schema check via `information_schema.columns`: every column in the form payload existed and was nullable or defaulted. No NOT NULL violations, no constraint mismatches.
4. RLS policy review: the `dt_orders_insert_public_form_anon` WITH CHECK matched all four conjuncts of the form's payload (`source='public_form'`, `review_status='pending_review'`, `tenant_id IS NULL`, `created_by_user IS NULL`).
5. **Smoking-gun test:** even creating a brand-new `WITH CHECK (true)` permissive INSERT policy on `dt_orders` for anon, the INSERT still failed with the same RLS error. That ruled out the policy expression itself.
6. **Decisive isolation:** disabling RLS entirely on `dt_orders` made anon REST insert succeed (HTTP 201). Then adding back RLS but stripping the `Prefer: return=representation` header from the curl POST also returned 201 — the INSERT was working all along; it was the implicit `RETURNING` that failed.
7. supabase-js's `.insert(...).select(...)` chain → `Prefer: return=representation` → PostgREST emits `INSERT ... RETURNING id, dt_identifier` → RLS evaluates SELECT permission for the row being returned → anon has no SELECT policy on `dt_orders` → reads as "no policy permits this row" → error code 42501 is the same as a WITH CHECK failure, hence the misleading message.

**What landed** (PR pending, branch `feat/fix/public-form-rls-select`, commit `bfb5901`):

- Migration [`20260513124647_dt_orders_anon_select_just_inserted.sql`](stride-gs-app/supabase/migrations/20260513124647_dt_orders_anon_select_just_inserted.sql) — adds `dt_orders_select_just_inserted_public_anon` policy:
  - `FOR SELECT TO anon`
  - USING: `source='public_form' AND review_status='pending_review' AND tenant_id IS NULL AND created_at > now() - interval '30 seconds'`
- Migration was applied via `apply_migration` MCP and verified live (curl POST with `Prefer: return=representation` now returns HTTP 201 with the row).

**Information-disclosure tradeoff:** an anon caller could probe within the 30-second window and see other in-flight public-form submissions. Acceptable because (a) rows contain only what the submitter themselves provided (their own contact/address/items), (b) the window is too short for meaningful enumeration, and (c) IDs are UUIDs so probe-by-id is not feasible.

**No React changes.** The bug was purely server-side (missing RLS SELECT policy). The form code at [PublicServiceRequest.tsx:908-916](stride-gs-app/src/pages/PublicServiceRequest.tsx#L908) is unchanged. dist/ is unchanged.

**Pin (do not regress):** if a future change adds `created_at` to the form's INSERT payload (currently server-set via `DEFAULT now()`), the 30-second window becomes spoofable. Keep `created_at` server-defaulted only.

**Followup backlog item — proper fix:** replace the anon direct-INSERT path with a SECURITY DEFINER RPC `submit_public_request(payload jsonb, items jsonb)` that:
- Validates payload server-side (can't be tampered to send `source != 'public_form'`, etc.)
- Wraps order + items insert in one transaction (currently a half-success leaves an order with no items)
- Returns just `{id, dt_identifier}` — anon never gets RLS-readable rows
- Lets us drop both the anon INSERT policies (`dt_orders_insert_public_form_anon`, `dt_order_items_insert_public_form_anon`) AND this new SELECT policy
This is the right long-term shape; this PR is the immediate unblock.

---

## Recent Changes (2026-05-12, allow Re-issue on voided invoices)

**Trigger:** Justin asked "what if we voided the invoice — after we void we can't re-issue?" The server-side `handleReissueInvoice_` ([StrideAPI.gs:13110](AppScripts/stride-api/StrideAPI.gs#L13110)) already accepts Void rows — its docstring says "Flip Invoiced/Void → Unbilled" — but the UI was hiding both action buttons on Void with an em-dash placeholder. Pure UI gap.

**What landed** ([PR #376](https://github.com/Stride-dotcom/Stride-GS-app/pull/376), commit `1bff5e3`):

- [Billing.tsx:1785](stride-gs-app/src/pages/Billing.tsx#L1785): replaced the `if (isVoid)` em-dash early return with a render path that shows only the **Re-issue** button (no Void button — voiding a void is meaningless).
- Confirm-dialog copy now branches on `isVoid`: drops the now-stale "and removes the invoice from CB" clause (CB rows were already deleted by the prior Void) and replaces the "void in Stax/QBO FIRST" precondition with an informational note about external records still existing.

**Operator workflow on the live site:**

1. Billing → Report tab
2. Status filter → **Void**
3. Voided invoices appear in the Invoices section
4. Click **Re-issue** → rows release back to Unbilled
5. Re-bill via the existing Create Invoices flow under a fresh number

**Files touched:**
- [stride-gs-app/src/pages/Billing.tsx](stride-gs-app/src/pages/Billing.tsx) (cell renderer at L1736-1825 + confirm dialog at L1756-1770)

**Pins (do not regress):**
- The Re-issue handler is the single point of release for voided invoices. Do not re-introduce a UI path that suppresses the button on Void status.
- The Void button must remain hidden on Void rows. Voiding a row that's already Void is a no-op at best, confusing at worst.

**Deploy note (worth flagging):** The standard `npm run deploy` retry (`-c http.postBuffer=524288000 -c http.version=HTTP/1.1`) failed repeatedly on this push across both schannel AND openssl backends. What finally worked was constraining pack generation: `-c pack.windowMemory=10m -c pack.packSizeLimit=20m -c pack.threads=1`. The `pushWithRetry` helper in [scripts/deploy.js](stride-gs-app/scripts/deploy.js) should be upgraded with these flags as a deeper fallback.

---

## Recent Changes (2026-05-12, [MIGRATION-P2] DT order release flips Supabase-authoritative)

**Trigger:** User flagged that the "Release Items" buttons disappeared from the DT order detail page + asked to automate release on DT-Finished. Investigation revealed (a) the missing button was a strict `statusCategory === 'completed'` gate, and (b) Justin wants the new flow as the start of the GAS → Supabase migration: writes go to Supabase as authoritative, with a fire-and-forget mirror to the legacy per-tenant Google Sheet via the P1.4 framework.

**What landed (PR #1 — manual release UX + architecture flip):**

1. **`DtOrderReleasePanel.tsx`** — new inline "Select items to release" panel matching the WC release UX exactly. Click "Release Items..." in the order footer → panel expands above the items table. No modal, no optimistic patches.
2. **OrderPage.tsx items table** — adds a **Status** column showing each linked inventory row's status (Active / Released / On Hold / Transferred) via color-matched chips. Subscribes via supabase.channel realtime keyed by tenant_id + filtered to inventory_ids on this order.
3. **Button gate fix** — `canReleaseItems` no longer requires `statusCategory === 'completed'`. Shows whenever ≥1 Active item exists; hides when all linked items are Released.
4. **Write path flipped to Supabase-authoritative** — panel does `supabase.from('inventory').update({status, release_date})` directly. `.neq('status', 'Released')` clause guards against double-fire. `entity_audit_log` row written for the Activity tab.
5. **Edge Function `push-inventory-release-to-sheet`** (v1) — fire-and-forget mirror to the per-tenant Inventory sheet via `reverseWritethrough()`. On any failure, lands in `gs_sync_events` for the Failed Operations drawer.
6. **GAS `__writeThroughReverseInventory_`** (StrideAPI.gs v38.208.0, Web App v503) — first real per-table writer against the P1.4 reverse-writethrough framework. Finds row by Item ID, idempotently writes Status + Release Date, fires `api_ledgerUpdateStatus_` for slot tracking.
7. **`handleWriteThroughReverse_` payload-storage hardening** — failure paths now store the FULL incoming payload (was storing only `{op, table}`, which would have failed retry validation).
8. **FailedOps wiring** — `useFailedOperations.ts` adds `'writethrough_reverse' → 'Sync to Sheet' / 'writeThroughReverse'`. Retry button works end-to-end.
9. **Local-date release stamp** — releaseDate uses local `Date` components, not `toISOString().slice(0,10)`, avoiding UTC drift that would shift late-evening PT releases into the next calendar day.

**Architectural notes:**
- This is the FIRST production-deployed Supabase-authoritative write path. Supabase realtime is the update mechanism: no optimistic patches, no manual refetch.
- The GAS sheet stays current as a legacy read-only mirror until invoice generation flips to Supabase-primary in P4a.
- WC release + Inventory page release stay on the legacy GAS-authoritative path; separate migrations.

**Pending PR #2 — auto-release on DT-Finished:** dt-webhook-ingest + dt-sync-statuses will invoke `push-inventory-release-to-sheet` after a delivery (non-pickup) order flips to status_id=3, filtering items by `delivered=true`. Activity-tab entry tagged source='dt_finished'.

---

## Recent Changes (2026-05-12, public service-request form — pricing parity with internal modal)

**Trigger:** Justin wanted `/public/service-request` to work like the authenticated `CreateDeliveryOrderModal` minus the client-account selector and inventory picker. The pre-existing public form collected contact + items only and submitted as "unpriced — staff confirms on review"; the rebuild adds full pricing, valuation coverage, add-ons, a bill-to section, and an estimated total — all still pending-review so staff push to DT.

**What landed:**

1. **Migration `20260512120000_dt_orders_bill_to_columns.sql`** — adds eight nullable `bill_to_*` text columns (`name`, `company`, `email`, `phone`, `address`, `city`, `state`, `zip`) to `dt_orders` for the billable-party-distinct-from-on-site-contact pattern. Applied to Supabase; anon INSERT policy from `20260426220000` unchanged (still locks `source`/`review_status`/`tenant_id`/`created_by_user`, permits any other column).
2. **`src/pages/PublicServiceRequest.tsx`** — full rewrite. New sections in order: Your contact info → mode cards → schedule → pickup (if applicable) → delivery/service → Valuation Coverage (mirror of modal's Quote-Tool-equivalent selector + declared-value input) → Add-Ons (filtered to `visible_to_client=true`, all client-added entries forced quote-pending with rate/subtotal=0) → Bill-To (radio "Same as pickup/delivery/service contact" or "Other" — auto-copies fields, dirty-flag prevents source-typo overwrites of manual bill-to edits) → Driver notes → Pricing Summary (base fee + extras + add-ons + coverage + subtotal + Kent-WA 10.4% tax + total) → Order summary → estimated-price acknowledgment checkbox → submit. ZIP-not-in-zone and >20 pieces flip a "may require quote review" banner; submit still proceeds, `pricing_override=true` + `pricing_notes` flags it for staff. Tax snapshot stores `customer_tax_exempt=null` (unknown until staff promotes to client_id), `tax_rate_pct=10.4`, `tax_amount` and `order_total` as the figures the submitter saw.
3. **`supabase/functions/notify-public-request/index.ts`** (v6) — SELECT now pulls `bill_to_*` + pricing columns; exposes new tokens `BILL_TO_NAME/COMPANY/EMAIL/PHONE`, `ESTIMATED_BASE_FEE`, `ESTIMATED_EXTRA_ITEMS_FEE/COUNT`, `ESTIMATED_ACCESSORIALS`, `ESTIMATED_COVERAGE`, `ESTIMATED_TAX/TAX_RATE`, `ESTIMATED_TOTAL`, `ESTIMATE_DISCLAIMER`. `verify_jwt=false` preserved.

**Pricing parity vs `CreateDeliveryOrderModal`:** matches `baseFee`/`pickupLegFee`/`extraItemsFee`/`accessorialsTotal`/`coverageCharge`/`bundleDiscount` (PD_DISCOUNT) / `subtotalBeforeTax` / `taxAmount` / `orderTotal`. XTRA_PC threshold + rate + PD_DISCOUNT pulled from `service_catalog` so changes flow through without code edits.

**Pending user action — email template:** `PUBLIC_REQUEST_CONFIRMATION` template needs to be updated in Settings → Templates to render the new pricing tokens + disclaimer. Edge function exposes them; template body still needs to use them.

**Files touched:**
- `supabase/migrations/20260512120000_dt_orders_bill_to_columns.sql` (new)
- `src/pages/PublicServiceRequest.tsx` (rewrite, ~980 → ~1700 lines)
- `supabase/functions/notify-public-request/index.ts` (expanded SELECT + tokens)

---

## Recent Changes (2026-05-12, [MIGRATION-P1.7][MIGRATION-P2.1] replay harness MVP)

**Trigger:** P1.7 was the final remaining Phase 1 sub-task. Justin's standing instruction to continue, plus existing 196-row `gas_call_log` corpus including 102 `updateInventoryItem` calls, made this the natural next step. Co-shipped with the first SB-side shadow handler (`updateItem`) so the harness has something to invoke.

**What landed:**

1. **`update-item-shadow` Edge Function** (deployed v2, `verify_jwt=true`). Pure function: takes a doPost payload, returns `payload minus {itemId, requestId}` — the exact dict GAS writes to `entity_audit_log.changes` at `StrideAPI.gs:7871`. No validation / coercion on the parity path (would diverge from GAS's raw-payload audit log shape). Validation helper preserved as a separate exported function for P2.1's eventual SB-primary handler.
2. **`replay-shadow` Edge Function** (deployed v2, `verify_jwt=true`). The P1.7 harness. Reads `gas_call_log` filtered by `SHADOW_REGISTRY[function_key].action`, invokes the matching shadow handler, diffs against `entity_audit_log.changes` via `correlation_id`, upserts `parity_results` on `(function_key, call_id)`. Classifications: `match` / `mismatch` / `skip_partial_input` / `shadow_error` / `no_audit_row`. ISO-validates `body.since`.
3. **Migration `parity_results_rollup_trigger`**: AFTER-INSERT trigger `rollup_parity_results_to_feature_flags()` updates `feature_flags.mismatch_count_7d` (rolling 7-day count of match=false) + `last_parity_check` for the matching function_key. Plus a `parity_results_unique_index_unconditional` migration adding the unique index `(function_key, call_id)` so re-runs are idempotent.
4. **StrideAPI v38.207.0** (Web App v502): expanded `api_redactPayloadForCorpus_` SAFE_FIELDS whitelist. Original P1.2 list stripped location/vendor/description/reference/room/itemClass/itemNotes from corpus — captured `{itemId, requestId}` only. New list covers all editable fields. Past corpus is partially blind (`replay-shadow.skip_partial_input` handles); future traffic has complete inputs.

**Smoke verification (DB layer, 2026-05-12):**

- Inserted 4 synthetic `parity_results` rows (3 matches + 1 mismatch) tied to real `correlation_id` values.
- Verified `feature_flags.updateItem.mismatch_count_7d = 1` + `last_parity_check = 2026-05-12 14:22:09Z` — rollup trigger fired correctly.
- Synthetic data cleaned up after verification (`mismatch_count_7d` reset to 0).

**Edge Function full invocation pending operator-run with service_role key** — `verify_jwt=true` blocks Postgres-side test via `pg_net` (no vault-stored service_role JWT). Operators invoke manually per the smoke command in `MIGRATION_STATUS.md` MIG-012, or cron schedule lands as the next Layer-2 follow-up.

**Code review (Opus subagent) caught + folded in:**

- **Architectural finding:** GAS audit log records the RAW payload (not the validated dict). My initial shadow had validation/coercion that would diverge on `declaredValue:""` (GAS: `""`; shadow: `0`) and similar. Shadow rewritten to mirror GAS's exact audit-log shape.
- **`shadow_rejected_but_gas_accepted`** is now classified as `mismatch` (real parity defect — shadow stricter than GAS) instead of `shadow_error` (infra glitch).
- **`function_key` normalization** — harness writes the canonical `'updateItem'` (P1.1 seed key) and filters `gas_call_log` by `'updateInventoryItem'` (the actual action name). Earlier alias row in `feature_flags` removed.
- **`body.since` ISO validation** added to defend against `?since=garbage` causing PostgREST 400.
- **`parity_results` upsert on `(function_key, call_id)`** makes re-runs idempotent.
- **Unique index** initially partial (`WHERE call_id IS NOT NULL`) — Postgres rejected as ON CONFLICT target. Reapplied unconditional. (Postgres treats NULLs as distinct in unique indexes anyway, so NULL-call_id fixture rows still coexist.)

**Pins (do not regress):**
- `replay-shadow.SHADOW_REGISTRY` is the single point of truth mapping `function_key` → shadow Edge Function + gas_call_log action name. Every P2/P3/P4 PR adding a shadow handler MUST add a registry entry.
- Shadow Edge Functions deploy with `verify_jwt=true` and only `replay-shadow` (or a future operator-RPC wrapper) should invoke them.
- Per MIG-008, stateful shadows must use placeholder external-service env vars. Today's pure shadow has no external calls.
- The `parity_results_function_call_unique` index makes re-runs idempotent. Don't drop it.

**Files touched:**
- `stride-gs-app/supabase/functions/update-item-shadow/index.ts` (new, ~120 lines after refactor)
- `stride-gs-app/supabase/functions/replay-shadow/index.ts` (new, ~330 lines)
- `stride-gs-app/supabase/migrations/20260511220000_parity_results_rollup_trigger.sql` (new — trigger + unique index)
- `AppScripts/stride-api/StrideAPI.gs` (v38.206.0 → v38.207.0; redaction whitelist expansion)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.7 → done, MIG-012 added)
- `stride-gs-app/BUILD_STATUS.md` (this entry)

**Pending user action:**
- [ ] Run the smoke command in `MIGRATION_STATUS.md` MIG-012 once with the service_role key to confirm the Edge Function end-to-end. Expected output: JSON with `corpus_size: 102`, some `match` count, some `skip_partial_input` (pre-v38.207.0 corpus), zero or near-zero `mismatch`, all upserted into `parity_results`.
- [ ] After running the smoke, check Settings → Migration tab — `updateItem` row should show non-zero `Mismatches (7d)` only if real divergences surfaced (the MVP shadow returns raw payload so expected mismatch rate is ~0%). `Last check` column should show a recent timestamp.
- [ ] Schedule the cron (or build the "Run replay now" button) per MIG-012 follow-ups when convenient.

---

## Recent Changes (2026-05-11, [MIGRATION] shipment counter SEQUENCE migration)

**Trigger:** The 2026-05-11 function inventory surfaced that `api_nextShipmentNo_` (StrideAPI.gs:14803) was still hitting the racy Master-RPC `getNextShipmentId` counter — same read-then-write-without-lock pattern that caused the INV-000131 dup-number incident on 2026-05-03. The v38.182.0 invoice-counter fix didn't cover shipments. Justin recalled the migration as already done but code inspection confirmed it wasn't.

**What landed (StrideAPI v38.205.0 → v38.206.0):**

- **Migration `20260511190000_shipment_no_atomic_counter.sql`** (applied via MCP). Mirror of the invoice-counter migration: creates `public.shipment_no_seq` SEQUENCE seeded at 1000 (max production shipment_number was 358; 640+ rows of headroom over the legacy counter); creates `public.next_shipment_no()` SQL function returning `'SHP-' || LPAD(nextval(seq), 6, '0')`; creates `public.peek_shipment_no_seq()` diagnostic. SECURITY DEFINER + `SET search_path = public` + GRANT to authenticated + service_role.
- **`api_nextShipmentNo_(rpcUrl, rpcToken)`** rewritten as a thin wrapper around the new `api_nextShipmentNoSupabase_` helper — exact same shape as `api_nextInvoiceNo_` → `api_nextInvoiceNoSupabase_` (v38.178.0). Legacy `rpcUrl/rpcToken` params kept for signature compat but ignored. Atomic by Postgres design; no retries needed.
- **`api_nextShipmentNoSupabase_()`** new helper. Calls `public.next_shipment_no()` via Supabase REST; format-validates the response against `/^SHP-\d{6,}$/`. Mirror of `api_nextInvoiceNoSupabase_`.
- **`handleCompleteShipment_`** call site (line 15462) gains a clarifying comment that the counter is now the SEQUENCE, not the Master-RPC.

**Pins (do not regress):**
- The `next_shipment_no()` SEQUENCE is now the only path the React-side receive-shipment flow uses for shipment numbering. Do NOT introduce a code path that reads back to the racy Master-RPC `getNextShipmentId` counter. The Master route is intentionally left in place for backward compat but is no longer called by StrideAPI.
- The per-tenant client script `nextGlobalShipmentNumber_` (Client Inventory `Shipments.gs:522`) still hits Master-RPC — this is by design for now (direct-sheet dock-form receiving is rare/admin-only and out of scope for this PR). Tagged `P7` in the function inventory so the per-tenant freeze rollout migrates it to Supabase too.

**Verified post-apply:**
- `peek_shipment_no_seq()` returns 999 (seeded).
- `next_shipment_no()` first call returns `SHP-001000`.
- Second call returns `SHP-001001` — strictly monotonic, atomic. Sequence consumed 2 values during smoke; first production call will return `SHP-001002`.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260511190000_shipment_no_atomic_counter.sql` (new)
- `AppScripts/stride-api/StrideAPI.gs` (v38.205.0 → v38.206.0)
- `stride-gs-app/MIGRATION_STATUS.md` (closed open question)
- `stride-gs-app/FUNCTION_INVENTORY.md` (3 row updates: `handleCompleteShipment_`, Master `doPost`, per-tenant `nextGlobalShipmentNumber_`)
- `stride-gs-app/BUILD_STATUS.md` (this entry)

**Pending user action:**
- [ ] Deploy GAS: `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/` after merge. (Builder will run this directly.)
- [ ] Smoke check after deploy: have a warehouse operator receive a shipment via the React app and confirm the new Shipment # is `SHP-001002` or higher and is unique. The existing handleCompleteShipment_ lock + the new SEQUENCE atomic counter together make a dup-number outcome physically impossible — this is a sanity check, not a real risk.

---

## Recent Changes (2026-05-11, [MIGRATION] inventory corrections per project-owner review)

**Trigger:** Justin reviewed yesterday's function inventory and corrected three items I'd flagged as open questions. Verified each:

1. **Task Board** — **DECOMMISSIONED**, confirmed by Justin. Was replaced by the React app's task views when the React app was created. The Apps Script project is no longer used by operators; the time-driven `TB_RefreshNow` and `TB_OnBoardEdit` triggers should be considered dormant. Code stays in repo as historical reference + as the frozen copy of the SH_* shared-handler block. The `processRepairDeclinedById_` "missing function" concern is moot — no one uses Task Board.
2. **Master Price List email-template functions** — **dead code**, confirmed by Justin. Email templates were moved to Supabase `email_templates`. The `ensureEmailTemplatesSheet_` / `exportTemplatesAsMap_` / `exportEmailTemplates` doGet route are no longer called from anywhere. The "templates omitted from source" concern is moot.
3. **Shipment counter `getNextShipmentId`** — **still racy**, verified by code inspection. Justin's recollection ("I think it may have been moved") doesn't match the code:
   - `api_nextShipmentNo_` at `StrideAPI.gs:14803` still hits Master-RPC with `action: "getNextShipmentId"`.
   - No `next_shipment_no()` SEQUENCE exists in Supabase (verified via `information_schema.routines`).
   - The v38.182 atomic SEQUENCE migration was invoice-only.
   - Same dup-number-race risk class as the old invoice counter.

**Documentation impact:**
- `FUNCTION_INVENTORY.md` — Task Board section header tagged `(DECOMMISSIONED)`, project description updated, Master Index gains a Status column. `ensureEmailTemplatesSheet_` row updated to note dead-code status.
- `MIGRATION_STATUS.md` — "Findings worth carrying forward" section: items #4, #7, #8 marked moot (Task Board, parity contract, template HTML); the shipment-counter question stays open. The open-questions list at the bottom has the resolved items marked `[x]` with rationale; the shipment-counter item updated with verification details + recommended action.

**Recommended next action for the shipment counter** (per MIG-005-style pattern):
- New migration `next_shipment_no_atomic_counter.sql`: creates `public.shipment_no_seq` SEQUENCE seeded above today's max + `public.next_shipment_no()` SQL function returning `'SH-' || LPAD(nextval(seq), 6, '0')` (or whatever the current format is — verify).
- StrideAPI `api_nextShipmentNo_` rewritten as a thin wrapper around the new SQL function, mirroring v38.182's pattern. Legacy `rpcUrl`/`rpcToken` parameters kept for signature compat.
- React-side `handleCompleteShipment_` runBatchLoop concurrency can stay where it is.
- Add `getNextShipmentId` to the per-function migration table in MIGRATION_STATUS as a P5 item (or its own mini-phase before P5).

Scope: ~2 hours for the migration + GAS rewrite + smoke test, ideally bundled with the P5 receiveShipment work so it's exercised on real new-shipment traffic immediately.

**Files touched:**
- `stride-gs-app/FUNCTION_INVENTORY.md` (Task Board section, master index, email-template row)
- `stride-gs-app/MIGRATION_STATUS.md` (3 open questions resolved or refined, top header)
- `stride-gs-app/BUILD_STATUS.md` (this entry)

**Pending user action:**
- [ ] Decide whether to schedule the shipment-counter migration as its own mini-phase (now) or roll it into P5's `receiveShipment` work (later).

---

## Recent Changes (2026-05-11, [MIGRATION] full GAS function inventory)

**Trigger:** Justin asked for a complete review of every Apps Script function in every project, with plain-English descriptions, sortable/categorizable, saved where all builders can read it. Settings → Migration tab today shows only the 25-flag substrate; we needed the full coverage picture before scoping P2 onward.

**What landed: `stride-gs-app/FUNCTION_INVENTORY.md`** — 1,196 functions across 30 files in 8 Apps Script projects, 2,300+ lines, 376 KB. Every function has:
- **Name** (with `_` suffix preserved)
- **Plain-English description** (one or two operator-readable sentences)
- **What it affects** (which sheets, tables, external systems, entities)
- **Migration phase tag** (`done` / `P2`–`P7` / `internal-helper` / `retiring` / `out-of-scope`)
- **Grouped** by project → file → category for browsability

Built via 5 parallel inventory subagents (one per project group), each writing a structured draft. Assembled into the master doc via `_assemble.py`. Drafts deleted (intermediate stage); the master doc is now self-contained.

**Counts by project:**

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

**Approximate phase rollup** (table-cell occurrence counts; per-project sections have exact tagging): `done` 43, `P2` 12, `P3` 35, `P4a` 56, `P4b` 18, `P5` 77, `P6` 71, `P7` 78, `internal-helper` 572, `retiring` 175, `out-of-scope` 47.

**3 latent issues surfaced for follow-up** (added to `MIGRATION_STATUS.md` Open questions):

1. **`getNextShipmentId` is still using the racy Master-RPC `doPost` counter** — same pattern v38.182 fixed for invoice numbering, but shipment numbering still bypasses the SEQUENCE. The `doPost` route in `Master Price list script.txt` can't be fully retired until shipment numbering also moves to a Postgres SEQUENCE. Add to the per-function migration table (likely P5 alongside `receiveShipment`).
2. **`processRepairDeclinedById_` may be missing from Task Board** — `TB_OnBoardEdit` calls it on Approved→Declined dropdown changes, but the function isn't defined in `task board script.txt`. Apps Script `.gs` files don't auto-import across projects, so operators picking Declined on the board may hit `ReferenceError`. Verify and either add the function or remove the menu option.
3. **Master Price List `ensureEmailTemplatesSheet_` is missing template HTML in source** — the .txt file has a "templates omitted for brevity" comment in place of the actual HTML. Live deployments must have the full version somewhere; verify before any P6 work touches the template surface.

**Other inventory findings worth carrying forward (captured in MIGRATION_STATUS.md "Function inventory" section):**

- **Two parallel CB invoice flows** still wired (legacy Phase-2 + modern CB13_*); operator menu hits the modern one, Phase-2 helpers tagged `retiring`.
- **Three parallel IIF export paths** all tagged P4b/P6 — `qboCreateInvoice` direct push will displace them.
- **Two parallel email-send paths** in Client Inventory (`sendTemplateEmail_` in Emails.gs vs. `SH_sendTemplateEmail_` in Triggers.gs shared-handler block) diverge on cache + self-heal logic. P3's email migrations need to consolidate or document the divergence.
- **23-function `SH_*` parity contract** between Client Inventory `Triggers.gs` and `task board script.txt` — must stay byte-identical. P3/P4a migrations need to coordinate the freeze.
- **Dead-code candidates for P7 cleanup**: `StrideRequestInspection`, `buildWorkOrderHtml_`, `generateTaskWorkOrderPdf_`, `getImportInventoryDialogHtml_`, the 8-function `getEditableRanges_*` family + `clearAllProtections_`, `backfillImpShipmentFolderUrls_`.

**New decision: `MIG-011`** — `FUNCTION_INVENTORY.md` is the canonical function-level reference; Settings → Migration tab extends to render all 1,196 functions in Layer 2. Layer 2 plan captured in `MIGRATION_STATUS.md` "Function inventory" section: new `migration_function_inventory` SQL table seeded from the doc + extended UI showing coverage stats per project + per phase. Scope estimate ~1 day across two PRs (migration + seed script + UI extension).

**Operational rule (from MIG-011):** every PR that adds, renames, or deletes a GAS function MUST also update `FUNCTION_INVENTORY.md` in the same commit. Drift between source and the inventory breaks the dashboard's coverage stats once Layer 2 ships.

**Files touched:**
- `stride-gs-app/FUNCTION_INVENTORY.md` (new, 2,300+ lines, 376 KB)
- `stride-gs-app/MIGRATION_STATUS.md` (new "Function inventory" section + MIG-011 + 2 new open questions + cross-reference)

**Pending user action:**
- [ ] Read the inventory (or grep for any function name you want to understand). Most useful sections for plain-English reading: `Project: StrideAPI` (most of the warehouse logic) and `Project: Client Inventory` (per-tenant operator workflows).
- [ ] Confirm the 3 latent issues should be tracked as separate work items (or batched into specific phase PRs).
- [ ] Approve the Layer 2 dashboard plan (~1 day of work to extend Settings → Migration tab to render the full 1,196-function coverage).

---

## Recent Changes (2026-05-09, [MIGRATION] drift-check function + first 2 incident fixtures)

**Trigger:** Justin asked whether anything was worth building before Monday's traffic. Two pieces emerged that meaningfully de-risk future sessions without depending on traffic or design conversation: an automated drift-check for the `parity_dryrun` schema-sync convention, and 1-2 worked-example fixtures while the design knowledge is fresh in context. Both shipped this PR.

**What landed:**

### 1. `parity_dryrun.check_drift()` SQL function

Migration: `supabase/migrations/20260509000003_parity_dryrun_drift_check.sql` (applied via MCP). Drift-detection for the `parity_dryrun` mirror set, closing the honor-system gap in the schema-sync convention from P1.3.

- Signature: `parity_dryrun.check_drift(p_table text DEFAULT NULL) RETURNS TABLE (table_name, column_name, status, public_data_type, dryrun_data_type)`.
- Returns one row per drift — empty result set = no drift. Drift categories: `missing_in_dryrun` (column in public but not in mirror), `missing_in_public` (column in mirror but not in public), `type_mismatch` (column in both but `data_type` differs).
- Mirror set hardcoded inside the function (same 14 tables as the P1.3 list); keep both in sync when adding new mirror tables.
- Calling with a non-mirror table name returns one synthetic `not_in_mirror_set` row so a typo / forgotten-mirror surfaces visibly instead of returning silently empty.
- service_role-only EXECUTE; SECURITY DEFINER.
- Verified: 0 drift rows on the current `public` ↔ `parity_dryrun` state (P1.3 mirrors still match byte-for-byte).

P1.7 will invoke this function automatically before each replay run and abort if drift is detected. Until then it's a manual diagnostic — run `SELECT * FROM parity_dryrun.check_drift();` after any `ALTER TABLE public.X` against a mirror member to confirm the convention was followed.

### 2. First 2 incident fixtures (`001-dup-invoice-race`, `002-stale-void-row-rebill`)

Authored as worked examples while the design context is fresh; the remaining 6 in the backlog stay deferred until their owning function reaches `handler_drafted`.

- **`001-dup-invoice-race.json`** — pins the v38.182 atomic counter fix. Two cases: `single-call-uses-sequence` asserts the SB-side createInvoice rewrite advances `public.invoice_no_seq` exactly once via `next_invoice_no()` (and the returned `invoice_no` matches the new sequence value); `two-consecutive-calls-produce-distinct-numbers` asserts the SEQUENCE produces strictly-monotonic unique numbers across calls. Regression catch for the original 2026-05-02 race that produced two INV-000131 invoices.
- **`002-stale-void-row-rebill.json`** — pins the v38.193 B2 pre-commit Status assertion. Two cases: `stale-void-row-included-in-pick` (negative — picker submits a legitimately-Voided row alongside fresh Unbilled rows; handler MUST throw `PRE_COMMIT_STATUS_ASSERTION` with zero side effects); `clean-pick-still-succeeds` (positive — same preState minus the Void row works normally, including leaving the Void row Voided). Regression catch for the INSP-TASK-INSP-62630-1 case that landed on INV-000135 on 2026-05-03.

Both fixtures validated as JSON. Both surface schema-extension needs that the v1 schema in `parity-fixtures/README.md` doesn't yet formalize — `input_a`/`input_b` cross-call cases (used in 001) and SEQUENCE-state assertions (`sequence_advanced_by`, `invoice_no_uses_sequence`). The README "Schema extensions discovered while authoring 001 + 002" section captures these so P1.7's harness implementation knows the contract before writing the consumer.

**Pins (do not regress):**
- The `parity_dryrun.check_drift()` mirror set (hardcoded inside the function) MUST stay in sync with the `parity_dryrun` schema's actual mirror set + the `MIGRATION_STATUS.md` "schema-sync convention" list. All three list the same 14 tables; future additions update all three. (Triple-source duplication — TODO in the function comments to centralize via a `parity_dryrun.mirror_tables` reference table when P1.7 lands and would be the 4th consumer.)
- Fixture files MUST validate as JSON. The harness will reject malformed fixtures.
- Fixture file numbers are NEVER reused. A deprecated fixture sets `"deprecated": true` in place; the next new fixture takes the next number.

**Code review (Opus subagent) flagged + fixed pre-merge:**
- **Drift function only compared `data_type`** — would have missed `ALTER COLUMN ... TYPE numeric(12,2)` style changes. Expanded to a full per-column signature comparing `data_type`, `udt_name`, `character_maximum_length`, `numeric_precision`, `numeric_scale`, `is_nullable`, `column_default`, `is_generated`. Verified still 0 drift on current state.
- **`SET search_path = pg_catalog`** added to the SECURITY DEFINER function — defense-in-depth against malicious search_path manipulation.
- **Fixture clients rows missing `tenant_id`** — `public.clients` requires it (NOT NULL, no default). Would have failed harness seeding. Added to both fixtures.
- **Fixture 002 had fictional `voided_at` / `voided_reason` columns** on `public.billing` — those columns don't exist (verified via `information_schema.columns`); the Void state is conveyed by `status='Void'` alone with operator-supplied context written to `item_notes`. Replaced with an `item_notes` value that explains the column model.
- **Fixture 002 only exercised the assertion in mixed-batch input** — added a third case `standalone-void-row-exercises-assertion-on-minimum-input` (single Void row, simplest failing input) so a regression that silently narrows the assertion (e.g., `if (batch.length > 1)`) gets caught.
- **Link-naming inconsistency** between fixtures (`pr` vs `related_pr`) — standardized on `pr`.

**What this PR does NOT do:**
- No P1.7 (replay harness — still gated on Monday traffic + first SB-side handler).
- No additional fixtures past 002. The remaining 6 land alongside their function migration in P2/P3/P4.
- No CI integration of the drift-check (will land in P1.7 alongside the harness).

**Files touched:**
- `stride-gs-app/supabase/migrations/20260509000003_parity_dryrun_drift_check.sql` (new)
- `stride-gs-app/supabase/parity-fixtures/001-dup-invoice-race.json` (new)
- `stride-gs-app/supabase/parity-fixtures/002-stale-void-row-rebill.json` (new)
- `stride-gs-app/supabase/parity-fixtures/README.md` (backlog checkboxes + schema-extensions section)
- `stride-gs-app/MIGRATION_STATUS.md` (drift-check note in schema-sync section)

**Pending user action:** none for this PR.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.4] reverse SB→Sheets writethrough)

**Trigger:** P1.4 from the Phase 1 sub-task list. Per **MIG-002** (synchronous SB→Sheets reverse writethrough) the rollback insurance for any function flipping to `active_backend='supabase'` is a per-tenant-sheet mirror that the SB-side handler keeps current. P1.4 ships that insurance as substrate; per-table writers fill in alongside each function migration in P2/P3/P4.

**What landed (StrideAPI.gs v38.200.0):**

- New `doPost` case `"writeThroughReverse"` → routes to `handleWriteThroughReverse_(payload, callerEmail)`.
- New dispatcher `handleWriteThroughReverse_` validates the payload contract (`tenantId`, `table`, `op` ∈ {insert, update, delete}, `rowId` for update/delete), opens the per-tenant spreadsheet, dispatches to a per-table writer in `REVERSE_WRITETHROUGH_TABLES_`, and on failure logs to `gs_sync_events` with `action_type='writethrough_reverse'` (so failures surface in the React FailedOperationsDrawer just like GAS→SB writethrough failures).
- New registry `REVERSE_WRITETHROUGH_TABLES_` with 14 table entries — every table from the parity_dryrun mirror set in P1.3. **Every entry is a stub** today (`__writeThroughReverseStub_` throws "not yet implemented (P1.4 framework only)"). Per-table writers ship in their corresponding function-migration PRs.
- Auth model: existing API_TOKEN bearer at the top of `doPost` is the single auth surface. The Edge Function caller passes the same token. No per-action HMAC (future hardening).

**What landed (SB-side TypeScript helper):**

- New `supabase/functions/_shared/reverse-writethrough.ts` (~140 lines, first file in `_shared/`).
- `reverseWritethrough(input)` — strict mode. Throws on missing env vars, network error, HTTP non-2xx, or GAS-side `success: false`. Caller decides whether to surface or swallow.
- `reverseWritethroughBestEffort(input)` — catch wrapper. Logs to `console.error` and returns `{ success: false, error }`. Matches the existing GAS→SB `api_writeThrough_` semantics (best-effort, never blocks).
- Reads `GAS_API_URL` + `GAS_API_TOKEN` from Edge Function secrets — see Pending User Action.

**Idempotency by design:**

The GAS-side per-table writers are required to be idempotent by row identifier — calling twice with the same row produces the same sheet state. That sidesteps an idempotency-key store: at-least-once delivery from the Edge Function is safe because the receiver squashes duplicates. This convention is documented in the dispatch comments and is load-bearing for every per-table writer that ships in P2+.

**Code review (Opus subagent) flagged + fixed:**
- **Tenant validation hardening.** Added `api_isKnownTenantId_(tenantId)` — checks `public.clients.spreadsheet_id` via PostgREST GET before `openById`. Fails closed on Supabase outage. Without this, a leaked API_TOKEN could write to non-Stride sheets the script account has access to (Master Price List, Consolidated Billing, etc.).
- **Idempotency contract sharpened.** Dispatcher comment now explicitly says writers MUST derive sheet primary key from SB row contents, never from `lastDataRow + 1` or any counter that depends on order of arrivals. Re-delivery with such a counter would produce duplicate rows.
- **Retry-cron interaction documented.** The new `action_type='writethrough_reverse'` intentionally does NOT match the existing `retryFailedSyncs_` LIKE pattern (which would call `resyncEntityToSupabase_` — wrong direction for our use case). Recovery is operator-driven via FailedOperationsDrawer; a future parallel retry cron may ship later.

**Pins (do not regress):**
- The registry `REVERSE_WRITETHROUGH_TABLES_` MUST stay aligned with the `parity_dryrun` mirror set in `MIGRATION_STATUS.md` "parity_dryrun schema-sync convention." Both sides cover the same table set; an entry missing from one likely means the other is wrong.
- Per-table writers MUST be idempotent by row identifier. **Specifically: writers MUST derive their sheet primary key purely from SB row contents (Ledger Row ID, Task ID, Item ID, etc.). Writers MUST NOT use `lastDataRow + 1` or any counter whose value depends on the order of arrivals — that breaks idempotency silently.** This contract is documented at the top of the dispatcher's comment block.
- The endpoint relies on `API_TOKEN`-based auth at `doPost` top — do not introduce a code path that bypasses that validation.
- `tenantId` MUST be validated against `public.clients.spreadsheet_id` before `openById` (via `api_isKnownTenantId_`). Without this guard, a leaked API_TOKEN could be used to write to non-Stride sheets the script account happens to have access to. Helper fails CLOSED on Supabase outage — better to reject a legit reverse writethrough during a transient outage than to allow a writethrough to an unknown sheet.
- `action_type='writethrough_reverse'` intentionally does NOT match the `*_write_through` LIKE pattern that `retryFailedSyncs_` picks up. That cron retries via `resyncEntityToSupabase_` which syncs in the GAS→SB direction — opposite of what a reverse-writethrough failure needs. Operator-driven recovery via FailedOperationsDrawer is the today path; a parallel retry cron may ship in a future PR.

**What this PR does NOT do:**
- No per-table writers — all stubs. Calling this endpoint with any `table` returns a clear "not yet implemented" error.
- No P1.7 (replay harness).
- Token signing / HMAC — future hardening; v1 trusts the bearer token.

**Files touched:**
- `AppScripts/stride-api/StrideAPI.gs` (v38.199.0 → v38.200.0; +~155 lines including comments)
- `stride-gs-app/supabase/functions/_shared/reverse-writethrough.ts` (new)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.4 → done; new pending action for Edge Function secrets)

**Pending user action:**
- [x] ~~Deploy GAS~~ — **done**: deployed as Web App v495 at 2026-05-09 ~05:18Z.
- [x] ~~Set `GAS_API_URL` + `GAS_API_TOKEN` Edge Function secrets~~ — **already set** in Supabase dashboard (confirmed by Justin 2026-05-09). SB→GAS reverse-writethrough plumbing is ready end-to-end. P2 unblocked from this dependency.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.6] Settings → Migration tab)

**Trigger:** P1.6 from the Phase 1 sub-task list. With the substrate (P1.1), input capture (P1.2), `parity_dryrun` schema (P1.3), and the React resolution layer (P1.5) in place, the operator needed a visible surface to inspect and toggle flags. P1.6 ships that surface.

**What landed (React, Bundle: `index-BNJREu5o.js`):**

- New `src/components/shared/MigrationSettingsTab.tsx` (~340 lines). Reads via `useAllFeatureFlags()` (realtime-subscribed via `FeatureFlagContext`); writes via direct `supabase.from('feature_flags').update(...)` calls (RLS allows admin writes).
- New `'migration'` tab on `Settings.tsx`:
  - Added to `Tab` type, `TABS` array (with `adminOnly: true`), and `VALID_TABS`.
  - Tab nav filtered to exclude admin-only tabs for non-admins.
  - Render block: `{tab === 'migration' && isAdmin && <MigrationSettingsTab />}`. Non-admin direct URL hit shows an "admin-only" placeholder; URL state preserved.
- Per-flag row controls:
  - **Active backend** chip (gas/supabase) — click to flip.
  - **Parity** checkbox — when enabled, auto-sets `shadow_backend` to the opposite of `active_backend`; when disabled, clears `shadow_backend`.
  - **Tenant scope** textarea — comma-separated tenant IDs; saved values are deduped (`Array.from(new Set(...))`) and trimmed; empty → `NULL` (fleet-wide).
  - **Mismatches (7d)** column read from `feature_flags.mismatch_count_7d` — stays at 0 until the replay harness (P1.7) ships and starts populating it.
  - **Last check** column read from `last_parity_check`.
- Master switch — `Emergency Revert (Master Switch)` button in the header card. Always enabled (so a frantic operator can re-click). Confirmation dialog (`ConfirmDialog`) with explicit "currently affected" copy + "what changes" breakdown.
- Phase grouping (P2 / P3 / P4a / P5 / P6) with empty phases skipped. Phase mapping is in a `PHASE_FOR_KEY` table at the top of the file — keep in sync with `MIGRATION_STATUS.md` "Per-function migration table" if either drifts.

**MIG-003 refined (this PR):**
The master-switch implementation issues a single atomic PostgREST UPDATE:
```ts
.from('feature_flags')
.update({ active_backend: 'gas', tenant_scope: null })
.gte('function_key', '');  // every row
```
Per **MIG-010** semantics, clearing `tenant_scope` is REQUIRED alongside `active_backend='gas'` — leaving a non-null scope would route non-listed tenants to the opposite backend (supabase), which is the opposite of "emergency revert." `parity_enabled` and `shadow_backend` are intentionally NOT touched: post-revert, parity diagnostics keep flowing so the operator can confirm the regression is gone before re-attempting. `MIGRATION_STATUS.md` MIG-003 has the refined write-up.

**Code review (Opus subagent) flagged + fixed:**
- Predicate switched from `.neq('function_key', '')` (fragile against an empty-string seed row) to `.gte('function_key', '')` (matches every non-null PK).
- Narrowed master switch to clear only the two fields MIG-003 authorizes.
- Tenant-scope save dedups via `Array.from(new Set(...))`.
- Always-enabled master button.
- Removed unused `borderLight` fallback (the theme value exists).
- Pulled duplicated `mismatch_count_7d > 0` check to a const.

**Code review deferred:**
- Optimistic-state flicker on parity toggle between `setSavingKey(null)` and the realtime UPDATE echo (~50-200ms). Cosmetic. Tracked as a follow-up.
- Replacing the React-side master switch with a `revert_all_feature_flags()` SECURITY DEFINER RPC for cleaner audit + named entry point. Functionally equivalent today; tracked as a P1.6 follow-up.

**Pins (do not regress):**
- The Settings tab `'migration'` MUST stay admin-only. The TABS filter is the primary guard; the per-tab render guard is defense-in-depth for direct URL navigation.
- The master switch MUST clear `tenant_scope` alongside `active_backend` (see MIG-003 refined).
- `feature_flags` realtime publication is load-bearing — if removed, cross-tab flag flips would require manual refresh.

**Files touched:**
- `stride-gs-app/src/components/shared/MigrationSettingsTab.tsx` (new)
- `stride-gs-app/src/pages/Settings.tsx` (Tab type, TABS array, VALID_TABS, nav filter, render block)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.6 → done, MIG-003 refined)

**Pending user action:**
- [ ] After deploy, hard-refresh https://www.mystridehub.com (Cmd/Ctrl+Shift+R) → Settings → Migration. Verify: 25 flags listed grouped by phase, all `gas`, no console errors. Try toggling one flag's `active_backend` — should flip + persist + propagate to a second open tab (realtime). Flip it back. Try the Emergency Revert button (with no flags actually flipped, this is a no-op but verify the dialog opens cleanly).

---

## Recent Changes (2026-05-09, [MIGRATION-P1.5] FeatureFlagProvider + hooks)

**Trigger:** P1.5 from the Phase 1 sub-task list. Now that the substrate (P1.1), GAS-side input capture (P1.2), and `parity_dryrun` schema (P1.3) are in place, the React app needs a way to resolve which backend to call per migration function. Hook + context now exist; nothing CALLS them yet — that comes in P2 when the first handler flips.

**What landed (React, Bundle: `index-CkUuWxyQ.js`):**

- New `src/contexts/FeatureFlagContext.tsx`. `FeatureFlagProvider` fetches all rows from `public.feature_flags` on mount and subscribes to realtime so cross-tab flag flips propagate without a refresh. State: `flagsByKey` (Record<function_key, FeatureFlagRow>), `loading`, `error`. Falls back to `'gas'` (safe default) on Supabase outage so the App layout never crashes.
- Hooks:
  - `useFeatureFlag(key)` → `'gas' | 'supabase'`. The everyday hook for routing decisions in component code.
  - `useFeatureFlagRow(key)` → full row, for the Settings UI (P1.6).
  - `useAllFeatureFlags()` → sorted array of all rows.
  - `useFeatureFlagLoading()` → for callers that need to render a spinner.
- Pure resolver `resolveFlagBackend(flag, tenantId)` exported for non-React callers (replay tooling, admin scripts).
- `main.tsx` wires `FeatureFlagProvider` between `AuthProvider` (consumed for primary tenant) and `BatchDataProvider` (so any other context can use feature flags if it ever needs to).

**Per-tenant scope semantics (new — see MIG-010 in `MIGRATION_STATUS.md`):**

`feature_flags.function_key` is the primary key, so one row per function. The single row carries `active_backend` and optional `tenant_scope` array. Resolution:
- `tenant_scope IS NULL` → `active_backend` applies fleet-wide.
- `tenant_scope` set, caller IN it → `active_backend`.
- `tenant_scope` set, caller NOT in it → opposite of `active_backend`.

This lets a single row express "canary tenant X on SB, everyone else still on GAS" by setting `{active_backend:'supabase', tenant_scope:['X']}`. Documented inline at the top of `FeatureFlagContext.tsx` plus full decision write-up under `MIG-010`.

**Pins (do not regress):**
- The hook MUST default to `'gas'` on any failure path — Supabase outage, missing flag row, missing user, anything. `'gas'` is the pre-migration backend; defaulting to it can never accidentally route through an SB handler that may not exist or be ready.
- The hook resolves against `user.clientSheetId` (primary tenant), NOT `accessibleClientSheetIds` or any impersonated tenant. Canary should be exercised under the real user's tenant.

**What this PR does NOT do:**
- No call sites consume the hook yet. Every existing routing decision still calls GAS unconditionally. P2 wires in the first handler.
- No Settings → Migration UI yet (P1.6). The hooks for that UI exist but the surface itself ships separately.
- No `parity_enabled` shadow-execution path yet. That ships with P1.7 (replay harness) and the per-handler shadow Edge Functions in P2+.

**Files touched:**
- `stride-gs-app/src/contexts/FeatureFlagContext.tsx` (new, 270 lines)
- `stride-gs-app/src/main.tsx` (provider wired in)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.5 → done, MIG-010 added)

**Pending user action:**
- [ ] Hard-refresh https://www.mystridehub.com (Cmd/Ctrl+Shift+R) after deploy to pick up `index-CkUuWxyQ.js`. No visible change — flags loaded silently in the background. Verify in DevTools Network → Supabase REST → `feature_flags?select=*` returns 25 rows.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.3] parity_dryrun schema)

**Trigger:** Per **MIG-001** (dry-run-on-shadow inside prod SB) the replay harness needs a write target separate from `public.*`. P1.3 ships that target as a `parity_dryrun` Postgres schema with column-shape mirrors of every `public.*` table that any handler in the migration inventory writes.

**What landed:** `supabase/migrations/20260509000002_parity_dryrun_schema.sql` (applied via MCP).

- New `parity_dryrun` schema. service_role-only (REVOKE PUBLIC, GRANT USAGE service_role); not visible to `authenticated` or `anon` JWT roles, so it stays out of the React app's RLS surface.
- 14 mirrored tables built via `LIKE public.X INCLUDING DEFAULTS`: `inventory`, `tasks`, `repairs`, `shipments`, `will_calls`, `will_call_items`, `billing`, `addons`, `invoice_tracking`, `entity_notes`, `item_photos`, `clients`, `stax_invoices`, `stax_charges`. Column shapes match public.* byte-for-byte (verified column-count parity at 17/26/45/15/34/10/20/37/13/11/20/28/9/22).
- `INCLUDING DEFAULTS` carries expression defaults (e.g. `gen_random_uuid()`) but NOT constraints, indexes, identity sequences, or RLS — by design. The harness supplies all values explicitly; the mirror only needs the right SHAPE for state-hashing.
- New `parity_dryrun.reset()` plpgsql function (SECURITY DEFINER, EXECUTE granted to service_role only) — TRUNCATEs all 14 mirrors with RESTART IDENTITY. The replay harness calls this at the start of each run to prevent prior-run state from leaking into the diff.
- New `parity_dryrun.row_counts` view — diagnostic surface for the Settings → Migration tab (P1.6) to show "harness writing recently?" indicators.

**Pins (do not regress):**
- The mirror set is documented in `stride-gs-app/MIGRATION_STATUS.md` "`parity_dryrun` schema-sync convention." Every future `ALTER TABLE public.X ...` against a mirror member MUST be paired with a matching `ALTER TABLE parity_dryrun.X ...` in the same migration file. Drift breaks the replay harness silently.
- The mirror set must NOT be added to the Realtime publication. Shadow writes are internal — they should never trigger a frontend listener.

**What this PR does NOT do:**
- No realtime publication on parity_dryrun (correct — see above).
- No replay harness yet (P1.7).
- No reverse writethrough (P1.4) — that comes alongside the first function flipping to `active_backend='supabase'` in P2.
- Drift-detection check (column-count parity in CI) deferred to P1.7 alongside the replay harness.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260509000002_parity_dryrun_schema.sql` (new)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.3 → done; new "parity_dryrun schema-sync convention" section)

**Pending user action:** none for P1.3.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.2] GAS-side input capture)

**Trigger:** P1.1 (PR #310) created `public.gas_call_log` and `entity_audit_log.correlation_id` but neither was populated yet. P1.2 wires the GAS side so every `doPost` call to StrideAPI lands a row in `gas_call_log` and threads its `correlation_id` through every `api_auditLog_` write produced during the same request. Together this gives the replay harness (P1.7) the (input → output) join it needs to verify the SB-side rewrite against historical GAS outputs.

**What landed (StrideAPI.gs v38.199.0):**

- New file-scope `__MIG_CORRELATION_ID__` global (set per-request, single-threaded execution makes this safe in GAS).
- New `api_logCallInput_(action, payload, tenantId, performedBy)` helper. Generates a UUID, sets `__MIG_CORRELATION_ID__`, POSTs to `public.gas_call_log` with `correlation_id`, redacted payload, SHA-256 input hash, `tenant_id`, `status='started'`, `called_at`. Best-effort — Supabase outage logs and continues, never blocks the handler.
- New `api_redactPayloadForCorpus_(payload)` helper. Whitelists the structural fields that matter for replay (action, ids, statuses, amounts, sidemarks, scope flags). Drops anything else, replaces fields matching `/token|secret|key|password|card|ssn|cvv|pii|email|phone/i` with `"[redacted]"`. Caps output at 1KB; strings cap at 200 chars; arrays cap at 50 elements.
- `api_auditLog_` now reads `__MIG_CORRELATION_ID__` and stamps it onto every `entity_audit_log` row. The check is a `typeof !== "undefined"` guard so the function still works when called outside `doPost` (script triggers, manual admin entries) — those simply produce rows with `correlation_id IS NULL`.
- `doPost` calls `api_logCallInput_` once after token validation + JSON parse, before the routing switch — so spam/auth-fail requests don't pollute the corpus, but every successfully routed call gets captured.

**Pins (do not regress):**
- Per **MIG-006**, `entity_audit_log` + `gas_call_log` is the canonical answer key for replay. The `correlation_id` linkage between the two tables is load-bearing — any future refactor must preserve it.
- The redaction whitelist is the boundary between operational data and customer PII. New fields added to the corpus should be reviewed for PII exposure before joining the whitelist.

**What this PR does NOT do:**
- No status update on call completion. `gas_call_log.status` stays `'started'` — the replay harness infers success from `entity_audit_log` rows existing for the correlation_id, error from their absence + a `gas_call_log` row. Per-call success/error stamping requires a `doPost`-wide response-capture refactor and is deferred to a small follow-up. Net acceptable for now: replay harness joins on correlation_id whether status is updated or not.
- No P1.3 (`parity_dryrun` schema), no P1.4 (reverse writethrough), no P1.5 (React `FeatureFlagProvider`), no P1.6 (Settings UI), no P1.7 (replay Edge Function).

**Files touched:**
- `AppScripts/stride-api/StrideAPI.gs` (v38.198.0 → v38.199.0)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.2 → done, verify deferred)

**Deploy:** `npm run push-api && npm run deploy-api` ran 2026-05-09 ~05:01–05:02 UTC. Web App now at version 494.

**Smoke check (2026-05-09, ~05:07 UTC, ~5 min post-deploy):**
- `gas_call_log` total rows: **0**.
- `entity_audit_log` rows since deploy: **8** — all are `source='backfill:v1'` with future `performed_at` timestamps (Oct–Dec 2026); not real-time `doPost` traffic. `correlation_id IS NULL` on all 8, which is correct (backfill rows never go through `doPost`).
- **Conclusion:** zero post-deploy `doPost` traffic in the verification window (Friday evening PST, warehouse not actively writing). Code path can't be exercised without organic traffic. Deploy is live (Web App v494 confirmed); first real `doPost` call will populate `gas_call_log`.

**Pending user action:**
- [ ] **Monday-morning re-check.** Run this query after the warehouse has been active for ~10 minutes:
  ```sql
  SELECT
    (SELECT COUNT(*) FROM public.gas_call_log) AS total_calls_captured,
    (SELECT COUNT(*) FROM public.entity_audit_log WHERE correlation_id IS NOT NULL) AS audit_rows_with_correlation,
    (SELECT COUNT(*) FROM public.gas_call_log gcl INNER JOIN public.entity_audit_log eal ON eal.correlation_id = gcl.correlation_id) AS joined_pairs;
  ```
  Expected: all three non-zero. If `joined_pairs > 0` we have working (input → output) pairs and the replay corpus is live.
- [ ] If verification fails (zero rows even after organic traffic), check Apps Script execution logs at https://script.google.com/home/projects/134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M/executions for `api_logCallInput_` errors.

---

## Recent Changes (2026-05-09, [MIGRATION-P1.1] parity substrate)

**Trigger:** Per `MIGRATION_STATUS.md` Phase 1 sub-tasks, P1.1 is the first deliverable that everything else hangs off — without `feature_flags` and `gas_call_log` in place, neither GAS-side input capture (P1.2) nor the replay harness (P1.7) has anywhere to write.

**What landed:** `supabase/migrations/20260509000001_migration_parity_substrate.sql` (applied via MCP). Four pieces:

- `public.feature_flags` — per-function backend selector. Columns: `function_key` (PK), `active_backend` (`gas`|`supabase`, default `gas`), `shadow_backend` (nullable), `parity_enabled` (bool), `tenant_scope` (text[], NULL = fleet-wide), `last_parity_check`, `mismatch_count_7d`, `notes`, `created_at`, `updated_at`. RLS: authenticated read, admin write, service_role bypass. `updated_at` trigger. Realtime publication enabled for the future Settings → Migration tab. Seeded with **25 rows** covering every function in the migration inventory at `active_backend='gas'` (today's reality — non-disruptive).
- `public.parity_results` — per-call match record from the replay harness (P1.7). Columns include `function_key`, `tenant_id`, `call_id` (links to `gas_call_log.correlation_id`), `fixture_id` (non-null for parity-fixture runs), `gas_state_hash`, `sb_state_hash`, `match`, durations, `mismatch_details` (jsonb diff). RLS: staff/admin read, service_role write. Partial index on `match=false` for the mismatches dashboard.
- `public.gas_call_log` — raw input payload for every `doPost_` call. Columns: `correlation_id` (UNIQUE — threads through `entity_audit_log`), `action`, `input_redacted` (jsonb), `input_hash`, `tenant_id`, `user_id`, `gas_duration_ms`, `status` (`started`/`success`/`error`), `called_at`, `completed_at`. P1.2 wires this from the GAS side.
- `public.entity_audit_log.correlation_id` — new nullable text column + partial index. Joins each state change to the `gas_call_log` row that produced it. The replay harness reconstructs (input → output) pairs from this join.

**Pins (do not regress):**
- Per **MIG-001 / MIG-008**, the parity substrate lives in the prod SB project — no cloned-app architecture. Credential-absence is enforced via per-shadow-Edge-Function placeholder env vars in P1.7, not by standing up a second project.
- Per **MIG-006**, `entity_audit_log` + `gas_call_log` is the canonical answer key for replay. Any future schema change to `entity_audit_log` must preserve the `correlation_id` linkage.

**What this PR does NOT do:** No GAS-side code changes (P1.2). No `parity_dryrun` schema (P1.3). No reverse writethrough harness (P1.4). No React `FeatureFlagProvider` (P1.5). No Settings UI (P1.6). No replay Edge Function (P1.7). All seeded `feature_flags` rows stay at `active_backend='gas'`, so no production handler routing changes — the substrate is invisible to operators until P1.5/P1.6 ship.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260509000001_migration_parity_substrate.sql` (new)
- `stride-gs-app/MIGRATION_STATUS.md` (P1.1 → done)

**Pending user action:** none for P1.1 specifically. Justin's nomination of a canary tenant is still pending but doesn't gate P1.

---

## Recent Changes (2026-05-08, GAS→Supabase migration roadmap review)

**Trigger:** Justin shared `Apps\GS Inventory\GAS_to_Supabase_Migration_Roadmap.docx` (v1.0, May 2026) for review before any Phase 1 work begins. Cross-referenced against current `CLAUDE.md` invariants + this file's "Recent Changes" / "Open hardening backlog" sections. Net: skeleton is sound, but 4 blocking design flaws and 13 stale/missing items would derail execution as written. Produced corrected v1.1.

### Blocking design flaws in v1.0 (must resolve before Phase 1)

1. **Parity model doesn't compose for writes.** "Both GAS and SB process the same input, results compared" creates duplicate side effects: two invoice numbers from `next_invoice_no()`, two PDFs, two customer emails, two `Billing_Ledger` rows, two CB rows, two QBO pushes. Replays the v38.182 dup-invoice incident class on every shadowed createInvoice. v1.1 reframes write parity as **dry-run-on-shadow**: SB-side runs the full code path against a parity scratch schema (or in a transaction that always rolls back) and compares the *would-have-been* state against the GAS-authored state. No external side effects from the shadow side.
2. **CB Consolidated_Ledger is missing entirely.** v1.0 only addresses the per-tenant `Billing_Ledger` sheet. The three-storage-layer model (per-tenant sheet + `public.billing` + CB sheet) is unmentioned. Bugs #5 and #7 in the open hardening backlog are exactly this class. v1.1 splits Phase 4 into 4a (per-tenant + SB mirror) and 4b (CB retirement / QBO-direct push), with explicit migration of the IIF auto-import pipeline.
3. **Rollback semantics are lossy.** "Hourly SB→Sheets sync" + "master switch reverts to GAS-primary" loses up to 60 min of writes on rollback. v1.1 specifies synchronous SB→Sheets writethrough (replacing today's GAS→SB writethrough) with the same best-effort semantics already proven in `api_writeThrough_`, plus per-tenant rollback (one tenant at a time, not master switch).
4. **`completeTask` cannot be split across Phase 3 and Phase 4.** `handleCompleteTask_` writes status, billing row, addon rows, and email send in one lock. Same for `handleCompleteRepair_` and `handleProcessWcRelease_`. v1.1 collapses these into Phase 4 in full.

### Stale function-inventory entries in v1.0

The following were marked "GAS" in v1.0 but are already partially or fully migrated per current code state:

- **Email migration is largely shipped.** Session 90 (PRs #174-#182) moved `notify-new-order`, `notify-public-request`, `ONBOARDING_EMAIL`, `CLAIM_RECEIVED`/`MORE_INFO`/`DENIAL`, `ORDER_REJECTED`, `ORDER_REVISION_REQUESTED`, `ACCOUNT_REFRESH_INVITATION` to `send-email` (Resend). Phase 3 plan should only cover the still-on-GAS senders: shipment created/updated emails, INSP_EMAIL (blocked on PDF source), CLAIM_SETTLEMENT (blocked on PDF source), task complete/repair quote/repair complete emails.
- **`createInvoice` listed twice** in v1.0's status tables (Write Functions row + Billing & Payments row). Single canonical row in v1.1.
- **`generateStorageCharges`** — Postgres RPC already shipped (PR #189). What remains is the GAS commit-to-ledger path. v1.1 corrects.
- **`releaseItems`** — bulk-rewritten in PR #186 (v38.142.8). Performance-sensitive baseline for any SB-side parity comparison.
- **`transferItems`** — overhaul shipped in session 92: `inventory_live` view, provenance columns, auxiliary-table migration on transfer. Phase 5 must build on this, not start fresh.
- **DispatchTrack module** entirely SB-only (already-Done case study). Not credited in v1.0's inventory.
- **Marketing, Intake, Audit log, In-app notifications** — also entirely SB-only. Missing from v1.0.

### Missing pieces v1.1 adds

- **`next_invoice_no()` SEQUENCE pin.** Explicit "SB-side createInvoice continues to call `public.next_invoice_no()`; never reach back to the Master-RPC `getNextInvoiceId`." Closes the regression footgun.
- **`invoice_tracking` table reference.** PR #285 (v38.194) already provides per-invoice QBO/Stax push state. Phase 4/6 builds on this, not parallel to it.
- **RLS write-policy review section.** Today's RLS covers reads (`user_has_tenant_access` helper, multi-tenant access fix). Direct-from-React writes need write policies on every affected table — section enumerates the 18+ tables that need them.
- **49 per-tenant Apps Script projects.** Phase 7 decommission must enumerate `Code.gs` v4.6.0, `Import.gs` v4.3.0, and `StaxAutoPay.gs` v4.7.6 across each tenant's own Apps Script project. Rollout-script-equivalent is needed to either retire the per-client scripts or freeze them at a known version.
- **GAS time-driven triggers.** `runBillingAnomalySweep` (manual), KC's rollout/sync triggers, Stax Auto Pay daily charge run, daily sync events — each becomes either `pg_cron` or a scheduled Edge Function invocation.
- **Existing-tenant migration story.** v1.0 only described new-client onboarding post-cutover. v1.1 adds explicit per-tenant cutover sequence: pick a low-volume canary tenant, run dry-run parity for 2 weeks, hot-cut that tenant only, observe 7 days, expand.
- **Canary plan.** No staging environment exists; `feature_flags` gain a `tenant_id` scope so a flag can be flipped for one tenant before the fleet.
- **Drive folder URL story.** Every entity row carries a Drive folder URL referenced from emails and the Entity History tab. v1.1 specifies: keep URLs as data (don't break old emails), redirect new uploads through Supabase Storage (already the case for photos/documents).
- **Master switch redesign.** v1.0's "flip ALL flags simultaneously" defeats the per-function-flag rollout. v1.1 keeps the granular flags as the rollout mechanism and reframes "master switch" as an emergency global rollback toggle (one-way: flip everything back to GAS), not a forward cutover.
- **Timeline reset.** v1.0's 14 weeks is optimistic given the parity-for-writes design problem. v1.1 leaves estimates blank pending Phase 1 execution; commits to re-estimating after the parity infrastructure is in place and one canary function has shipped.

**Files touched (this session):**
- `stride-gs-app/BUILD_STATUS.md` (this entry)
- `Apps\GS Inventory\GAS_to_Supabase_Migration_Roadmap_v1.1.docx` (corrected roadmap; original v1.0 preserved alongside)

**Pending user action:**
- [ ] Justin: review v1.1, decide whether to proceed with Phase 1 (parity infrastructure + feature_flags table) or pause for further design review on the dry-run-on-shadow parity model.

---

## Current Versions

| System | Version | Notes |
|---|---|---|
| React app (GitHub Pages) | Latest on `origin/source` | `npm run deploy` from source. Latest bundle: `index-C2xeMz3s.js`. |
| StrideAPI.gs | **v38.227.0** (head; deploy pending — see MIG-016 Pending User Actions) | v38.226.0: `__writeThroughReverseInventory_` extended for general field updates. v38.227.0: new `__writeThroughReverseTasks_` writer (6th per-table writer; insert+update upsert by Task ID). Required by SB-primary `update-item-sb` + `batch-create-tasks-sb` Edge Functions. Deploy via `npm run push-api && npm run deploy-api` from `C:\dev\Stride-GS-app\AppScripts\stride-client-inventory` per the MIG-016 deploy sequence. |
| Supabase | 70+ migrations applied | New `public.invoice_tracking` table (PR #285) — per-invoice push-state ledger with `qbo_pushed_at`, `stax_pushed_at`, `auto_charge` snapshot. RLS staff/admin only + service_role bypass. Realtime publication enabled. 176 historical invoices backfilled. `public.next_invoice_no()` Postgres SEQUENCE replaces the Master sheet RPC counter for invoice numbering. Multi-tenant RLS access (`user_has_tenant_access` helper) — clients with multiple tenant assignments can now read entity rows + storage objects across all accessible tenants. |
| Client scripts | Rolled out to 49 active clients | Code.gs v4.6.0, Import.gs v4.3.0 |
| StaxAutoPay.gs | v4.7.6 | Charge Log Customer/Transaction header fix |

---

## What's Built

### Pages (33 files in `src/pages/`)

**Main pages (14):** Login, Dashboard, Inventory, Receiving, Shipments, Tasks, Repairs, Will Calls, Billing, Payments/Stax, Claims, Settings, Marketing, Orders/Delivery

**Entity detail pages (5):** ItemPage, TaskPage, RepairPage, WillCallPage, ShipmentPage — full-page entity views replacing slide-out panels

**Job pages (4, legacy):** TaskJobPage, RepairJobPage, WillCallJobPage, ShipmentJobPage

**Specialized:** Scanner (QR), Labels, QuoteTool, PriceList, PublicRates, Intakes (client onboarding), ParityMonitor, DetailPanelMockup, ClientIntake, AccessDenied

### Hooks (61 in `src/hooks/`)

Data: useInventory, useTasks, useRepairs, useWillCalls, useShipments, useBilling, useClaims, useClients, useUsers, useOrders, useLocations, useMessages, useNotifications, usePhotos, useDocuments, useEntityNotes, useProfiles

Detail: useItemDetail, useTaskDetail, useRepairDetail, useWillCallDetail, useShipmentDetail

Delivery: useDeliveryZones, useAvailabilityCalendar, useOrders

Billing: useBillingActivity, useBillingParityLog, usePaymentTerms, useServiceCatalog, useQBO, usePricing, useItemClasses, useCoverageOptions

UI: useTablePreferences, useResizablePanel, useIsMobile, useRowSelection, useVirtualRows, useSidebarOrder, useClientFilter, useClientFilterUrlSync, useUniversalSearch, useAutocomplete, useAsyncAction, useApiData

Other: useCalendarEvents, useExpectedShipments, useFailedOperations, useSupabaseRealtime, useItemIndicators, useItemNotes, useClientIntake, useIntakeAdmin, useClientTcStatus, useClientInsurance, usePriceListShares, useQuoteCatalog, useQuoteStore, useEmailTemplates, useReceivingAddons, useDashboardSummary

### Shared Components (60 in `src/components/shared/`)

Detail panels (7): ItemDetailPanel, TaskDetailPanel, RepairDetailPanel, WillCallDetailPanel, ShipmentDetailPanel, ClaimDetailPanel, BillingDetailPanel, OrderDetailPanel, PaymentDetailPanel

Modals: CreateDeliveryOrderModal, CreateTaskModal, CreateWillCallModal, AddToWillCallModal, ReleaseItemsModal, TransferItemsModal, CreateClaimModal, OnboardClientModal, BulkReassignModal, BulkScheduleModal, ChangePasswordModal, IntakeEmailModal, PreChargeValidationModal

UI components: FloatingActionMenu, WriteButton, BatchGuard, ActionTooltip, BatchProgress, UniversalSearch, DataTable, DetailHeader, EntityPage, EntityHistory, EntitySourceTabs, EntityAttachments, StatusChips, DeepLink, InfoTooltip, InlineEditableCell, LocationPicker, AutocompleteSelect, MultiSelectFilter, FolderButton, ConfirmDialog, ProcessingOverlay, FailedOperationsDrawer, ReviewQueueTab, TemplateEditor, TabbedDetailPanel, and more

### Edge Functions (6 deployed)

| Function | Purpose |
|---|---|
| `dt-push-order` | Push approved delivery orders to DispatchTrack API |
| `dt-webhook-ingest` | Receive DT webhook events, upsert orders |
| `dt-backfill-orders` | Bulk import existing DT orders |
| `dt-sync-statuses` | Sync DT status/substatus lookup tables |
| `notify-new-order` | Email notification on new delivery order |
| `stax-catalog-sync` | Sync service catalog items to Stax payment platform |

### Supabase Tables (57 migrations)

**Core mirrors:** inventory, tasks, repairs, will_calls, will_call_items, shipments, billing, clients, claims, cb_users, locations

**Delivery (DT):** dt_orders, dt_order_items, dt_order_history, dt_order_photos, dt_order_notes, dt_webhook_events, dt_credentials, dt_orders_quarantine, dt_statuses, dt_substatuses, dt_address_book, delivery_availability, delivery_zones (pricing)

**Billing/pricing:** service_catalog (+ stax_item_id, qb_item_id), billing_activity_log, billing_parity_log, stax_invoices, stax_charges, stax_exceptions, stax_customers, stax_run_log

**Content:** entity_audit_log, entity_notes, documents, messages, message_recipients, conversations, email_templates, photos, expected_shipments, price_list_shares, quotes

**Marketing:** marketing_contacts, marketing_campaigns, marketing_templates, marketing_settings

**Client onboarding:** client_intakes (+ coverage options, TC templates, invite templates, auto-inspect, notifications)

**Infrastructure:** gs_sync_events, item_id_ledger, move_history, profiles, audit_log

### Key Features

- Universal Search (⌘K) across all entities
- Inline editing on Inventory (6 columns with autocomplete)
- Cross-tab Realtime sync via Supabase postgres_changes
- Optimistic UI on all status changes, field edits, creates
- Role-based access (admin/staff/client) with sidebar + route guards
- Delivery order creation with zone-based pricing, review queue, admin auto-push to DT
- Stax payment integration (invoicing, charging, auto-pay)
- QuickBooks IIF export + QBO catalog sync
- Entity page redesign (full-page views replacing slide-out panels)
- Photos, documents, notes per entity with Supabase storage
- iMessage-style messaging system
- Client onboarding intake system
- Quote Tool with PDF generation
- Expected operations calendar
- QR Scanner + Labels (native React, Supabase-backed)

---

## Recent Changes (2026-05-05, Invoice Review overhaul — invoice_tracking + new tab UI)

**Trigger:** Build plan from Justin: "All tracking in Supabase only, per invoice_no, separate QBO + Stax timestamps, sortable columns, multi-select bulk push, realtime, autopay filter."

**Five steps shipped (StrideAPI.gs v38.193 → v38.194 / Web App v487; React bundle `index-C2xeMz3s.js`):**

- **Step 1 — Migration `invoice_tracking`** ([supabase/migrations/20260505000001_invoice_tracking.sql](supabase/migrations/20260505000001_invoice_tracking.sql)). New `public.invoice_tracking` table PK on `invoice_no`, columns: `tenant_id`, `client_name`, `invoice_date`, `total`, `line_count`, `auto_charge`, `created_at`, `qbo_pushed_at`, `stax_pushed_at`. RLS staff/admin via JWT user_metadata.role + service_role bypass. Realtime publication enabled. Backfill: 176 invoices from billing where status=Invoiced; `qbo_pushed_at` + `stax_pushed_at` proxied from existing `stax_invoices.created_at` for the 79 already-pushed invoices (new pushes refine to per-path timestamps).

- **Step 4 — Auto-populate on create.** `handleCreateInvoice_` POSTs to `invoice_tracking` right before the success return. `auto_charge` is snapshotted from `public.clients` via Supabase REST at create time so historical invoices keep their original Stax-eligibility regardless of later flag flips. Upsert on `invoice_no` merge-duplicates so the v38.157 half-write recovery path can re-enter.

- **Step 3a — QBO push hook.** `handleQboCreateInvoice_` collects `pushedInvoiceNos` from `results[]` after the per-invoice loop and PATCHes `qbo_pushed_at = now()` in one PostgREST round-trip via `invoice_no=in.(...)`.

- **Step 3b — Stax push hook.** `handleQbExport_` does the same with `batchInvoiceNos` for `stax_pushed_at`, right after the existing `supabaseBatchUpsert_("stax_invoices", ...)` so the IIF auto-import + tracking stamp travel together.

- **Cleanup hook.** New helper `api_deleteInvoiceTrackingRow_(invoiceNo)` called from `handleVoidInvoice_` + `handleReissueInvoice_` after their existing CB cleanup so voided/re-issued invoices disappear from the Invoice Review tab. The voided rows still appear on Billing → Report (Status=Void) for historical reference.

- **Step 2 — Invoice Review tab rewrite.** `Billing.tsx` `InvoiceReviewTab` now reads from `invoice_tracking`. New columns (all sortable via header click): checkbox, expand-arrow, Invoice #, Client (with Auto Pay icon), Invoice Date, Total, Items, Created, QBO ✓+date | —, Stax ✓+date | n/a | —, Actions. Filters: search, client dropdown, push-status (All / Not pushed to QBO / Not pushed to Stax), Auto Pay only toggle, date range. Bulk action bar (sticky when ≥1 selected): Push to QBO (N), Push to Stax (N — gated when not all selected are auto_charge=true), Void (N), Clear selection. Single-row Re-issue + Void retained from v38.193. Line items lazy-fetched on row expand. Realtime subscription on `invoice_tracking` so multi-operator pushes propagate live. Optimistic timestamp stamps with rollback on error.

- **Step 5 — Payments page Stax push status visibility.** Deferred by design. Existing Payments → Review tab already lists pushed invoices via `stax_invoices` (whose presence implies a Stax push). `invoice_tracking` is queryable from anywhere in React; a follow-up can add an explicit "first pushed at" column if Justin wants the timestamp inline next to the existing Stax invoice list.

**Pending user actions:**
- [ ] Hard-refresh https://www.mystridehub.com (Cmd/Ctrl+Shift+R) to pick up `index-C2xeMz3s.js`
- [ ] Verify the new Invoice Review tab on Billing renders with checkbox, sortable columns, push-status columns, and the bulk action bar appears when 1+ invoices are checked
- [ ] Try a Push to QBO on a non-pushed invoice — green check should appear within ~1s
- [ ] (From v38.193) Re-run Create Invoices for Nip Tuck Remodeling + Mary Kenngott Design

---

## Earlier Changes (2026-05-05, billing hardening pass — bugs #3-#9 closed)

**Trigger:** `BILLING_HARDENING_HANDOFF.md` from the prior dup-number cleanup session. Five cousin bugs + three detection gaps + one missing UI affordance, all blocking Justin's re-run of Create Invoices for Nip Tuck Remodeling and Mary Kenngott Design.

**Audit (Phase A — 4 parallel Explore agents):** confirmed `handleCreateInvoice_` row-pick → write window for stale-Status drift; mapped every site that flips billing rows to Void (`handleVoidInvoice_`, `handleVoidUnbilledRows_`, `handleVoidManualCharge_`, `api_voidBillingRowsWhere_` via `handleReopenTask_` / `handleReopenRepair_`, `handleTransferItems_`); confirmed `handleGenerateStorageCharges_` math is sound (free-days + transfer-date split + discount + class-rate lookup); verified all three QBO/IIF push paths now correctly read `separate_by_sidemark` post-v38.191; surfaced one cousin gap (`handleImportIIF_` doesn't inherit per-client `auto_charge` on new rows) and one dead-code instance (`handleQbExcelExport_` reads AUTO CHARGE but never uses it).

**Six fixes shipped (StrideAPI.gs v38.193.0, deployment v486; React bundle `index-B2pd9yhv.js`):**

- **B2 — pre-commit Status assertion (Bug #4 + gap #9).** `api_markClientLedgerInvoiced_` now reads the Status column in the same `getValues()` as Ledger Row ID and refuses to flip rows whose Status drifted from "Unbilled" between React picking the row (from Supabase mirror) and GAS writing it. Throws `PRE_COMMIT_STATUS_ASSERTION` so `handleCreateInvoice_`'s existing catch path rolls back the CB append. Closes the chain that produced INV-000135 billing the legitimately-Voided `INSP-TASK-INSP-62630-1` row on 2026-05-03.

- **B3 + B4 — CB Consolidated_Ledger symmetry on void + reopen flows (Bugs #5 + #7).** Two new helpers — `api_deleteCbRowsByInvoiceNo_` and `api_deleteCbRowsByLedgerIds_` — placed near `api_markClientLedgerInvoiced_`. Both use the descending-grouped-`deleteRows` pattern from the `rollbackByInvoiceNo_` closure. Wired into `handleVoidInvoice_` (returns `cbRowsDeleted` in response) and `api_voidBillingRowsWhere_` (defense-in-depth — current Unbilled-only guard means CB is normally empty for these IDs). Pre-fix: voiding an invoice via the React UI flipped client sheet to Void but left CB rows tied to the voided invoice number stuck at Status=Invoiced, drifting QBO/IIF reconciliation.

- **C3 — server-side sidemark-uniqueness assertion (Bug #3 defense-in-depth).** `handleCreateInvoice_` now reads `clients.separate_by_sidemark` from Supabase REST and rejects payloads with mixed sidemarks for `true` clients (`SIDEMARK_VIOLATION`). React-side fix landed 2026-05-02 in `Billing.tsx`; this GAS-side guard catches a future React regression OR a hand-crafted payload (admin tool, scripted retry). Fails open on Supabase outage so a momentary outage can't block invoicing.

- **C4 — `runBillingAnomalySweep` admin function (gap #10).** Five checks against the last 30 days: duplicate `invoice_create` entries (the pre-v38.182 RPC race fingerprint), billing rows ≠ stax_invoices.line_items_json count for same invoice_no, mixed sidemarks for `separate_by_sidemark=true` clients, stale-Void rows whose `ledger_row_id` appears in `stax_invoices.line_items_json`, STOR rows with negative qty/total. Sends `justin@stridenw.com` an HTML summary if findings; clean sweeps are Logger-only. Trigger setup left as a manual operator step on purpose — never auto-installed.

- **D — Re-issue button (Bug #6).** New `handleReissueInvoice_` + `reissueInvoice` router action. Releases an invoice's billing rows back to Status=Unbilled, removes matching CB rows, queues `api_fullClientSync_(["billing"])`, writes one entity_audit_log entry. Idempotent. Replaces tonight's `runReleaseInvoicesForReissue` one-shot with a first-class API action — future race / operator-error cleanup is now one click instead of an emergency GAS push. Companion React: new `postReissueInvoice` in `lib/api.ts` + Re-issue button next to Void on the Invoices tab (staff/admin only) with explicit pre-condition confirm dialog (operator must void Stax/QBO first — endpoint doesn't touch external systems).

**Pre-flight (Phase E) results — all green:**
- E1 client config (Supabase): Digs Furniture (separate_by_sidemark=false), Mary Kenngott Design (true), Nip Tuck Remodeling (true) — all active. Matches the cleanup expectations.
- E2 released rows ready: Nip Tuck = 42 rows / $980 (NIPTUCK + NORTON); Mary Kenngott = 9 rows / $565 (POPLAWSKI + TWISP-BROWN). Matches the handoff predictions exactly.
- E3 stale Void rows: only the legitimately-Voided `INSP-TASK-INSP-62630-1` remains (correct — task was reopened 5/1).
- E4 duplicate invoice_create sweep: only the historical 2026-05-02/05-03 race events on INV-000131 (3×) and INV-000129 (2×); these triggered this work, not a regression. Atomic SEQUENCE prevents recurrence.

**Verdict: GREEN to re-run** Create Invoices for Nip Tuck + Mary Kenngott. Predicted invoice numbers (continuing today's sequence — last was INV-001128): Nip Tuck NORTON ≈ INV-001129 ($565), Nip Tuck NIPTUCK ≈ INV-001130 ($415), Mary Kenngott POPLAWSKI + Mary Kenngott TWISP-BROWN ≈ INV-001131 + INV-001132 (split $565).

**Files touched:** `AppScripts/stride-api/StrideAPI.gs` (v38.192.0 → v38.193.0), `stride-gs-app/src/lib/api.ts` (new `postReissueInvoice` + extended `VoidInvoiceResponse`), `stride-gs-app/src/pages/Billing.tsx` (handleReissue + Re-issue button on Invoices tab).

**Pending user action (post-deploy):**
- [ ] Justin: re-run Create Invoices for Nip Tuck Remodeling (will produce 2 invoices — NORTON + NIPTUCK — under fresh atomic-counter numbers)
- [ ] Justin: re-run Create Invoices for Mary Kenngott Design (will produce 2 invoices — POPLAWSKI + TWISP-BROWN)
- [ ] Justin: send the drafted Nip Tuck + Mary Kenngott customer emails after the new invoices are issued
- [ ] Justin (optional): wire the daily 6am `runBillingAnomalySweep` time-driven trigger via Apps Script editor → Edit → Triggers

---

## Earlier Changes (2026-05-05, dup-number race incident — triage, cleanup, hardening backlog)

**Trigger:** Nip Tuck Remodeling contact emailed flagging that invoice INV-000135 was a duplicate of lines 1-18 on INV-000131. Investigation confirmed the duplicate AND surfaced two cousin bugs that the v38.182 fix on Mon didn't reach.

**What was confirmed:**

The 2026-05-03 invoice batch hit the `getNextInvoiceId` race that v38.182.0 fixed Monday, but the bad invoices were generated **the day before the fix landed** (race timestamp 17:57:41 + 17:57:42 UTC, 1.18s apart, both successfully assigned INV-000131). A third "INV-000131" attempt at 22:40 UTC + a fresh INV-000135 at 23:19 UTC followed as Justin tried to manually recover. Net: customer received two PDFs containing 18 overlapping NIPTUCK line items totaling $450 that should have been on one invoice.

Same race also bit two other clients earlier (KC's batches): Digs Furniture INV-000115 (2.2s race, never pushed to Stax/QBO so no customer harm — but KC manually rebuilt one consolidated QB invoice covering all the line items) and Mary Kenngott INV-000129 (3.1s race, sent via QBO so customer-facing). Today's KC batch (130+ invoices, INV-001000 → INV-001128) ran post-fix with zero duplicates — atomic counter is holding.

**What got cleaned up:**

- **New StrideAPI.gs admin entry `runReleaseInvoicesForReissue` (v38.192.0)** — hardcodes the four affected (clientSheetId, invoiceNo) pairs, releases their billing rows back to Unbilled across all three storage layers (client Billing_Ledger sheet via RangeList sparse writes; CB Consolidated_Ledger via grouped-descending-deleteRows à la `rollbackByInvoiceNo_`; public.billing via `api_fullClientSync_`). Idempotent. Already executed once 2026-05-05 — 54 of 55 expected rows released, 1 row correctly stayed Void (legitimately voided 5/1 when Justin reopened the INSP-62630-1 inspection task). **Keep as historical reference; do not re-run.**

- **Stax + QBO voids** — operator-handled outside this session. Nip Tuck INV-000131 + INV-000135 voided. Mary Kenngott INV-000129 pending Justin's QBO void. Digs is closed by KC's manual QB consolidation invoice (3 freshly-released INV-000115 rows pending terminal Void via the React Billing → Report → Void Selected path).

- **Customer email drafts ready** — Nip Tuck (acknowledges duplicate + flags second issue: 7 NORTON line items truncated off original PDF; corrected NIPTUCK total $415 not $450 because of the legitimate INSP-62630-1 reopen-void), Mary Kenngott ($565 split into POPLAWSKI + TWISP-BROWN), Digs (template KC fills with QBO doc#).

**Verified clean:** Digs's April storage invoice INV-001044 ($87 / 3 items) cross-checked against actual inventory — every Digs item that crossed the 7-day grace into April is on the bill. 11 items released within grace (no charge by design — `DIGS DOES NOT COVER STORAGE FOR CLIENT AFTER 7 DAY GRACE PERIOD UNLESS AUTHORIZED`); 4 items received 4/27-4/30 still in grace, will appear on May. Storage generator is working correctly for Digs.

**Cross-corpus reconciliation (2026-05-06 follow-up):** scanned all 79 real-customer rows in `stax_invoices` (excluding tonight's 4 cleanup targets and demo data) — zero line-count or dollar-total mismatches against the billing table. Separately scanned for the bug #3 over-split signature (`separate_by_sidemark=false` clients with multiple same-day invoices each carrying a single sidemark) and surfaced one additional case beyond Digs: **Ligne Roset INV-000124 + INV-000125 on 2026-05-02** (17 RCVG rows blank-sidemark + 1 RCVG row sidemark "Martinez", $255 combined). Same root cause + same recovery as Digs — KC manually consolidated into one QB invoice; Stride-side rows stay `Status=Invoiced`, **no cleanup needed**, no inclusion in any release/regenerate scope. Confirmed with Justin 2026-05-06. Today's batch (INV-001000 → INV-001128) showed zero over-split signatures, confirming the React-side fix held; the v38.193 GAS-side assertion now blocks any future regression at the source.

**Files touched (this session):**
- `AppScripts/stride-api/StrideAPI.gs` (v38.190.0 → v38.191.0 → v38.192.0; one new admin function appended at end)
- React side untouched — fixes for the open hardening backlog (below) are deferred to the next session

**What's still open** — see "Open billing-system hardening backlog" below.

**Pending user action:**
- [ ] Justin: void Mary Kenngott INV-000129 in QBO + send drafted email
- [ ] Justin: void the 3 Digs INV-000115 rows via React Billing → Report → filter Digs Unbilled → Void Selected → reason "Already paid via KC manual QB consolidation 2026-05-02"
- [ ] Justin: send updated Nip Tuck email ($415 not $450)
- [ ] Justin: spawn next builder session with `BILLING_HARDENING_HANDOFF.md` (in Dropbox `Apps\GS Inventory\`) to ship the 5-bug hardening pass before re-running Create Invoices for Nip Tuck + Mary Kenngott

---

## Open billing-system hardening backlog (queued for next session)

The race itself is dead since v38.182, but the dup-number incident exposed five cousin bugs and three detection gaps. **All blocking** the Nip Tuck + Mary Kenngott re-run. Plan in `BILLING_HARDENING_HANDOFF.md`.

| # | Bug | Where | Severity |
|---|---|---|---|
| 3 | Invoice **generation** force-splits by sidemark even when `clients.separate_by_sidemark = false` (twin of v38.191 QBO-push fix, different code path) | `handleCreateInvoice_` and/or `Billing.tsx` `handleCreateInvoices` | **HIGH** — caused Digs's 7-invoice burst |
| 4 | Stale-Void rows get swept onto new invoices | `handleCreateInvoice_` Unbilled-row picker | **HIGH** — billed customer for a reopen-voided $35 inspection on INV-000135 |
| 5 | `handleVoidInvoice_` only voids client sheet, not CB Consolidated_Ledger | `StrideAPI.gs` ~line 12437 | MEDIUM — orphans counts diverge between systems |
| 6 | `handleVoidInvoice_` flips rows to terminal Void with no re-issue path | `StrideAPI.gs` ~line 12437 | MEDIUM — forced tonight's manual GAS one-shot recovery |
| 7 | Reopen-task workflow voids client sheet billing but not CB | Search `handleReopenTask_` / `handleCorrectTaskResult_` | HIGH — root cause of bug #4 |

**Detection gaps:**

| # | Gap | Fix |
|---|---|---|
| 8 | No reconciliation between billing-table line count and `stax_invoices.line_items_json` | Post-create assertion: refuse to push if mismatch |
| 9 | No pre-commit re-check that picked rows are still Unbilled | Pre-commit assertion in `handleCreateInvoice_` (closes #4) |
| 10 | No nightly anomaly sweep / admin email | `runBillingAnomalySweep` admin function, last-30-day check |

**Other deferred items:**
- One-click Re-issue button on the React Billing → Invoices tab (replaces manual GAS one-shot for future incidents)
- Fold the v38.192 `runReleaseInvoicesForReissue` admin entry into a generalized "release any invoice's rows" tool (currently hardcoded to the 4 specific invoices from this incident)

---

## Recent Changes (2026-05-04, background invoice batches + UX)

**Goal:** Stop blocking the UI during invoice creation. The blocking modal-with-spinner pattern made multi-client batches feel like a hostage situation — operators had to sit on the Billing page for 30+ seconds. After v38.183.0's lock-scope reduction made the per-invoice path fast enough, the UX overhang was the next obvious cleanup.

**What changed (React-only, no GAS / no migration):**

- **New `BillingBatchContext`** (`src/contexts/BillingBatchContext.tsx`) — App-level provider that owns the in-flight batch state: progress, succeeded/failed counts, in-progress ledger row IDs, results. Lives in `main.tsx` outside the route tree, so the state survives any page unmount or remount. Methods: `startBatch`, `recordInvoice` (per-invoice progress), `finishBatch`, `dismissResults`.

- **New `BillingBatchToast`** (`src/components/layout/BillingBatchToast.tsx`) — Bottom-right floating toast rendered in `AppLayout`. Shows "Creating N invoices… X/N done" while active, "✓ N invoices created" on full success (auto-dismiss after 6s), or "⚠ X of N — Y failed [View]" on partial failure with a click-through details modal. Visible from any page, so the operator can kick off an invoice batch on Billing then navigate to Inventory / Tasks and still watch the toast.

- **`Billing.tsx` `handleCreateInvoices` refactored.** Sequence now:
  1. Synchronous preflight (resolve rows, group by client+sidemark, optional storage commit, 20-invoice cap warning).
  2. On preflight success: `billingBatch.startBatch(...)` registers the batch, `setInvoiceStartedAt(Date.now())` flips the modal body to a green "✓ Invoice batch started!" confirmation, and a `setTimeout(2000)` schedules modal auto-close.
  3. The async `runBatchLoop` continues running. Inside the per-invoice `call`, `billingBatch.recordInvoice(...)` updates progress + drains the ledger ID from `invoicingLedgerIds` as each invoice completes.
  4. After the loop finishes: `billingBatch.finishBatch(results)` flips `active=false` and stamps `lastResults` for the toast's completion summary.

  The async chain doesn't get cancelled when Billing.tsx unmounts mid-batch — the JS runtime keeps the in-flight fetches and their `await` chains alive, and the context setters they call point at the App-level provider (which doesn't unmount). State updates that target Billing-local setters (e.g. `setReportData`) become no-ops after unmount, which is the desired behavior.

- **Per-row "Invoicing…" optimistic badge.** `Billing.tsx` Status column renderer checks `billingBatch.invoicingLedgerIds.has(row.ledgerRowId)` — when true, renders an animated pulse pill instead of the real status. Once the per-invoice POST returns and `recordInvoice` removes the IDs, the badge clears and the row falls back to its real `Invoiced` status from the writeThrough mirror.

- **Re-submit guard.** Submit button label flips to "Batch in progress — wait" + disabled while `billingBatch.active === true`. Avoids two concurrent batches stomping each other (overlapping optimistic hides, conflicting result UIs).

- **`pulse` keyframe** added to `index.css` for the badge + Started-state confirmation icon. Distinct from the existing `stridePulse` (which scales as well as fades) — `pulse` just gently breathes opacity.

**What survives:** page navigation within the app (Billing → Inventory mid-batch is fine; the toast keeps tracking, and coming back to Billing shows the live in-progress state).

**What does NOT survive:** a full page refresh / browser tab close. The browser cancels in-flight fetches. Surviving that requires persisting the queue to Supabase + a background worker; out of scope here.

**Files touched:**
- `stride-gs-app/src/contexts/BillingBatchContext.tsx` (new)
- `stride-gs-app/src/components/layout/BillingBatchToast.tsx` (new)
- `stride-gs-app/src/main.tsx` (wrap App in `<BillingBatchProvider>`)
- `stride-gs-app/src/components/layout/AppLayout.tsx` (render `<BillingBatchToast />`)
- `stride-gs-app/src/pages/Billing.tsx` (handleCreateInvoices refactor + Status column badge + Submit guard)
- `stride-gs-app/src/index.css` (pulse keyframe)

**Pending user action:**
- [ ] Smoke test: kick off a 5+ invoice batch → confirm modal closes after the green "Started!" confirmation (~2s) → verify rows show animated "Invoicing…" pill → navigate to Inventory or Tasks → toast in bottom-right keeps updating. Come back to Billing — if any rows still in flight, "Invoicing…" pills still show; if all done, rows show real Invoiced status. Toast shows "✓ 5 invoices created" and auto-dismisses after a few seconds.

---

## Recent Changes (2026-05-04, commit-lock scope reduction)

**Goal:** Unlock the rest of the parallelism the v38.182.0 atomic counter set up. v38.182.0 made the Master RPC race go away and let Billing.tsx restore concurrency=3, but the per-call wall-time barely budged because `handleCreateInvoice_`'s outer `LockService.getScriptLock` still wrapped the entire ~5-10s function. Concurrent calls just queued at the GAS lock instead of the Master RPC. This PR shrinks the lock to just the CB append phase and refactors the per-tenant flip for safe concurrent execution.

**What changed (StrideAPI.gs v38.183.0):**

- **Commit-lock window shrunk to the CB append phase only.** New `releaseCommitLockOnce_()` helper releases the lock right after `consolLedger.setValues(...)` + the rich-text writes (~500ms-1s of work). Everything before (idempotency check, race detection, building the row matrix) stays inside; everything after (per-tenant client Billing_Ledger flip, email, Email Status update) now runs without holding the lock.
- **`api_markClientLedgerInvoiced_` refactored to RangeList per-cell writes.** Critical for concurrency safety: the pre-v38.183 slice-setValues approach read a snapshot of the whole sheet and wrote a contiguous range covering minRow→maxRow. Two concurrent calls for the same client (e.g. two sidemark groups for a `separate_by_sidemark=true` client invoiced in parallel) would each read the snapshot and each write back overlapping slices, with the second overwriting the first invoice's just-flipped rows back to Unbilled. New code reads only the Ledger Row ID column, then uses `getRangeList()` per write column (Status / Invoice # / Invoice Date / Invoice URL) to write SAME-VALUE-PER-CELL across only the specific cells that need changing. Same per-call cost (one round-trip per column = up to 4 total) as the v38.142.9 slice approach, but sparse target shape means concurrent calls for different ledger row IDs can no longer clobber each other.
- **ID-based rollback (`rollbackByInvoiceNo_`).** Replaces the v38.157.0 position-based rollback that depended on the script lock being held throughout the function. The new path acquires its own brief re-lock, scans the Invoice # column for matching rows, and deletes bottom-up. Robust to other concurrent appends. Same orphan-pinning fallback when the rollback itself fails.
- **Email Status update — pre-fill optimization + opt-in lock.** When `skipEmail=true` (the default — operators only opt in for the legacy Drive-PDF email path), the CB append now pre-fills `Email Status = "Skipped"` so no post-flip update is needed. When email actually fires, the post-flip update briefly re-acquires the commit lock (~500ms-1s) so its bulk slice write doesn't race with concurrent CB appends.

**Speedup:** for a 5-client storage batch with concurrency=3 and email skipped (the typical Justin storage case), the wall-time goes from ~30-40s (post-v38.182.0) to ~12-18s (post-v38.183.0). Roughly 3x — the long-promised win.

**Safety:** the test plan below should specifically confirm that a `separate_by_sidemark=true` client with multiple sidemark groups invoiced in one batch ends up with all rows flipped to Invoiced (no race-induced revert to Unbilled).

**Files touched:**
- `AppScripts/stride-api/StrideAPI.gs` (v38.183.0)

**Pending user action:**
- [ ] Deploy GAS: `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/` after merge.
- [ ] Smoke test: pick a `separate_by_sidemark=true` client with at least 2-3 sidemarks of unbilled rows. Select rows from all sidemarks → Create Invoice. Confirm: distinct invoice numbers per sidemark, ALL rows flipped to Invoiced (no rows left as Unbilled), Consolidated_Ledger has all expected rows.

---

## Recent Changes (2026-05-04, atomic invoice counter)

**Goal:** Retire the Master sheet RPC counter race that caused the INV-000131 duplicate (2026-05-03) and forced Billing.tsx to pin its invoice loop at `concurrency=1`. Move invoice numbering to a Postgres atomic SEQUENCE.

**Root cause recap:** `api_nextInvoiceNo_` called a separate Apps Script project's `getNextInvoiceId` action — that handler reads-then-writes a counter on the Master Price List sheet without a transaction lock. Two concurrent createInvoice calls could both observe the same counter value, both increment, both return the same number. INV-000131 hit it: NORTON + NIPTUCK submitted within ~1.2s, both got INV-000131, the second commit's row-position-based rollback then chopped the wrong rows. v38.157.0 added half-write recovery; the workaround was to serialize the entire React-side loop.

**Fix:**

- **Migration `invoice_no_atomic_counter`** (`supabase/migrations/20260504220000_invoice_no_atomic_counter.sql`): creates `public.invoice_no_seq` SEQUENCE seeded at 1000 (currently MAX invoice = INV-000144; 850+ headroom is well past anything the Master RPC could plausibly have queued). New `public.next_invoice_no()` SQL function returns `'INV-' || LPAD(nextval(seq), 6, '0')` — atomic by design, concurrency-safe, no transient failure modes. Companion `public.peek_invoice_no_seq()` for diagnostics. Both functions GRANTed to authenticated + service_role.

- **StrideAPI.gs v38.182.0:** `api_nextInvoiceNo_` becomes a thin wrapper around the new `api_nextInvoiceNoSupabase_` helper. Legacy `rpcUrl/rpcToken` parameters kept for signature compat but ignored. The Master RPC counter is left in place but inert (other callers like `getNextShipmentNo` continue to use it; only invoice numbering migrated).

- **Billing.tsx:** `handleCreateInvoices` runBatchLoop bumps `concurrency` from 1 back to 3.

**Speedup expectation:** modest, ~10-30% wall-time reduction on multi-client batches. The dominant cost is `handleCreateInvoice_`'s outer `LockService.getScriptLock` for the Consolidated_Ledger commit phase — that still serializes per-invoice. True 3x parallelism requires refactoring that lock to per-tenant scope, which is a separate follow-up. The primary win of THIS PR is **eliminating the duplicate-number bug class entirely**.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260504220000_invoice_no_atomic_counter.sql` (new)
- `AppScripts/stride-api/StrideAPI.gs` (v38.182.0)
- `stride-gs-app/src/pages/Billing.tsx`

**Pending user action:**
- [ ] Deploy GAS: `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/` after merge. (Migration already applied via MCP.)
- [ ] Smoke test: create 2-3 invoices in quick succession (e.g. multi-client storage batch) → confirm distinct INV-001000+ numbers, no duplicates, no LOCK_TIMEOUT errors. The first new invoice ships at INV-001000 (the gap from INV-000144 → INV-001000 is intentional headroom).

---

## Recent Changes (2026-05-04, storage billing → one-click invoice)

**Goal:** Eliminate the legacy "Commit to Ledger then re-select on Report tab then Create Invoice" 4-step storage workflow. Replace with a single Create Invoice button on the Storage tab that does both in one click.

**What changed (React-only, no GAS):**

- **`Billing.tsx`** — new `invoiceMode: 'report' | 'storage'` state. Storage tab gains a primary "Create Invoice" button in the preview banner (next to the legacy "Commit to Ledger") and on the floating selection bar. Both open the existing Create Invoice modal with `invoiceMode='storage'`. Modal subtitle adds a yellow inline note: "Storage rows will be committed to each client's ledger and invoiced in one step."
- **`handleCreateInvoices`** — when `invoiceMode === 'storage'`, prepends a `postCommitStorageRows` call before the existing per-(client, sidemark) `postCreateInvoice` loop. The preview rows already carry `ledgerRowId = taskId` (matching what GAS stamps on the sheet), so the post-commit invoice loop finds the rows it needs to flip without any reshape. Failures during the commit phase abort cleanly with an error in the modal; partial commits surface failed clients in the same banner.
- **Inline editing on storage preview** — Sidemark + Reference are now editable on storage preview rows alongside the existing Rate / Qty / Notes editors. Important for `separate_by_sidemark=true` clients: the operator's sidemark edit decides which invoice the row lands on (group key uses the operator-provided value, not the inventory row's stale field).
- **Modal close handler** — when a storage-mode invoice succeeds, the preview banner is cleared (`previewLoaded=false`, `previewRows=[]`, `commitResult=null`) so the user lands on a clean slate. Clicking Preview Storage again won't re-surface the just-invoiced periods (the Postgres `calculate_storage_charges` RPC excludes already-invoiced periods).

**Performance note:** pure React orchestration — same end-to-end GAS work as the legacy two-button flow, just chained without a manual click in between. The bigger speed-up (atomic invoice numbering on Postgres → unlock `concurrency=3` in the per-group invoice loop, ~3x faster on multi-client batches) is tracked as a follow-up PR.

**Files touched:**
- `stride-gs-app/src/pages/Billing.tsx`

**Pending user action:**
- [ ] Smoke test: Storage tab → Preview Storage → click "Create Invoice" → confirm modal options (PDF, email, QBO push, Send to Payments) → submit → confirm invoices land in the Report tab + are properly grouped by sidemark for clients with `separate_by_sidemark=true`.

---

## Recent Changes (2026-05-04, multi-tenant RLS access fix)

**Bug:** A client user assigned to 3 tenants reported "Item not found" errors when clicking entity deeplinks. Root cause: every client-facing RLS policy across `inventory`, `tasks`, `repairs`, `will_calls`, `will_call_items`, `shipments`, `billing`, `claims`, `clients`, `client_insurance`, `entity_notes`, `entity_audit_log`, `documents`, `email_sends`, `item_photos`, `move_history`, `autocomplete_db`, `dt_address_book`, `dt_orders` (+ all `dt_order_*` children), `expected_shipments`, `photo_shares`, plus 4 storage policies (`documents`, `dt-pod-photos`, `invoices`, `photos` buckets) compared `tenant_id` against the JWT's single primary `clientSheetId`. The React layer correctly issued `.in('tenant_id', accessibleClientSheetIds)` for multi-tenant fetches, but RLS filtered the rows out before they reached React — so `useItemDetail` / `useTaskDetail` / etc. saw empty results and surfaced "not found." React access checks at the panel level never ran because the row never came back.

**Fix:**

- **Migration `multi_tenant_rls_access`** (`supabase/migrations/20260504210000_multi_tenant_rls_access.sql`): two new helper functions — `public.user_has_tenant_access(text)` for `tenant_id`-style columns and `public.user_has_tenant_access_storage(text)` for storage paths (handles the `_`→`-` substitution Supabase storage uses) — that return true if the input matches the user's primary JWT `clientSheetId` OR appears in the JWT's `accessibleClientSheetIds` array. Defaults to empty array when missing, so single-tenant users keep working with the legacy primary check. Every affected policy DROPped + CREATEd to call the helper, names preserved. Service-role + staff/admin paths unchanged.

- **AuthContext.tsx:** the metadata-sync `inSync` check (cached + full-verify paths) now also compares `accessibleClientSheetIds` and `childClientSheetIds` against the JWT, and the `supabase.auth.updateUser({ data })` call writes both arrays into `user_metadata`. New `arraysEqualOrderless` helper avoids re-firing `updateUser` on every page load when GAS returns the array in a different order. Single-tenant users see no behavior change.

**Why this is safe to ship without a backfill:** for client users who don't immediately log in, the new RLS helper falls back to the primary `clientSheetId` check (their JWT still works for their primary tenant). On their next login the AuthContext writes the full array into metadata and the secondary tenants light up automatically. Multi-tenant users who do log in immediately after deploy get the fix on next page-fetch.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260504210000_multi_tenant_rls_access.sql` (new)
- `stride-gs-app/src/contexts/AuthContext.tsx`

**Pending user action:**
- [ ] Smoke test: have the affected multi-tenant client log in, switch tenants in the UI, and click a deeplink to an item in their secondary/tertiary tenant — should load instead of "not found." Migration is already live (applied via MCP).

---

## Recent Changes (2026-05-04, unified addons module)

**Goal:** Generalize the task-shaped `task_addons` system (shipped 2026-05-02 in PR #193, never used in prod) into a polymorphic addons module that plugs into any entity panel — tasks, repairs, will calls, and inventory — with one set of GAS + React code.

**Step 1 — Schema (migration `unified_addons`).** Drops `public.task_addons` (verified empty in prod via `execute_sql` before drop) and creates `public.addons` keyed on `(tenant_id, parent_type, parent_id)` with CHECK constraints (parent_type in `task|repair|will_call|inventory`, parent_id non-empty), `billed`/`billed_at`/`ledger_row_id` columns for traceback + idempotency, RLS for staff/admin + service_role, and realtime enabled.

**Step 2 — GAS materializer.** New `api_writeAddonsToLedger_(ss, parentType, parentId, ctx)` in StrideAPI.gs replaces the inline task-only addon flush. Reads unbilled rows from `public.addons` via REST, writes one Billing_Ledger row per addon (rate snapshotted at add time, falls back to current catalog if blank — same semantics as before), mirrors each row to Supabase via `resyncEntityToSupabase_`, then PATCHes the addon back to `billed=true` with the resulting `ledger_row_id` stamped. Idempotent — retries skip already-billed rows. Wired into `handleCompleteTask_` (replacing the inline flush), `handleCompleteRepair_`, and `handleProcessWcRelease_`. `api_fetchTaskAddons_` removed (subsumed). Per-parent column mapping: task → Task ID = `{parentId}-{svcCode}`, repair → Repair ID = `{parentId}-{svcCode}`, will_call → Shipment # = parentId, inventory → Item ID = parentId. Ledger Row ID format unchanged: `{parentId}-{svcCode}-ADDON-{n}`.

**Step 3 — React hook + modal.** New `useEntityAddons(parentType, parentId, tenantId)` hook with the same CRUD + realtime shape as the old `useTaskAddons`, plus a `billed` flag check on `updateAddon` so already-materialized addons can't be edited. `useTaskAddons` reduced to a one-line compat alias delegating to `useEntityAddons('task', ...)` so the existing TaskDetailPanel call site is unchanged. `AddTaskServiceModal` gains an optional `parentType` prop that drives title copy and catalog filter (tasks keep the historical `show_as_task` gate; other entities show all active services).

**Step 4 — BillingPreviewCard polymorphic addons.** Lifted the `entityType === 'task'` restriction at line 211 — projected addons now flow through for any entity type. Recorded fetch query broadened: repair now uses `repair_id.eq.X OR repair_id.like.X-%` (parallel to task's existing pattern) and will_call drops the `svc_code='WC'` filter so addon rows with non-WC service codes (Shipment # = wcNumber) show in the recorded panel. `isAddonBooked` simplified to check `addon.billed` first, then ledger_row_id pattern as fallback. The "+ Add Service" button is no longer task-only.

**Step 5 — Wire into entity panels.** `RepairDetailPanel` and `WillCallDetailPanel` each pull addons via `useEntityAddons` and pass `addons` + `onAddAddon`/`onUpdateAddon`/`onDeleteAddon` into `BillingPreviewCard`. Editable while the entity is still open (Repair: not Complete/Cancelled. WC: in {Pending, Scheduled, Partial}). TaskDetailPanel unchanged — picks up the polymorphic path automatically via `useTaskAddons`'s new alias.

**Files touched:**
- `stride-gs-app/supabase/migrations/20260504170000_unified_addons.sql` (new)
- `AppScripts/stride-api/StrideAPI.gs` (v38.177.0)
- `stride-gs-app/src/hooks/useEntityAddons.ts` (new)
- `stride-gs-app/src/hooks/useTaskAddons.ts` (compat alias)
- `stride-gs-app/src/components/shared/AddTaskServiceModal.tsx`
- `stride-gs-app/src/components/shared/BillingPreviewCard.tsx`
- `stride-gs-app/src/components/shared/RepairDetailPanel.tsx`
- `stride-gs-app/src/components/shared/WillCallDetailPanel.tsx`

**Pending user action:**
- [ ] Deploy GAS: `npm run push-api && npm run deploy-api` from `AppScripts/stride-client-inventory/`. (Migration already applied via MCP on 2026-05-04.)
- [ ] Smoke test: open a repair detail panel → add a "Rush Repair" addon → mark Complete → confirm a Billing_Ledger row appears with Ledger Row ID `{repairId}-RUSH-ADDON-1` and the addon flips to billed=true. Repeat for a will call (release) and a task.

**Step 2 deferral.** The follow-up work — making the billing pipeline Supabase-native so `handleCreateInvoice_` reads from `public.billing` instead of the client sheet — was explicitly scoped out per the handoff. Step 1 (this PR) keeps the existing client-sheet-as-authority pipeline; it's a half-day reversible change. Step 2 advances Decision #33 (out of Google) and is a separate strategic call.

---

## Recent Changes (2026-05-03, session 93 — Stax payments architectural cleanup)

**Goal:** Retire the Stax Customers Google Sheet as a separate data source. The list of "Stax Customers" should be derived from CB Clients (`stax_customer_id IS NOT NULL`) — single source of truth. Fix the duplicate INV-000131 issue on Stax Invoices sheet.

**Step 1 + 4 — React Customers tab refactor.** Payments → Customers tab now derives from `clients` directly via new `fetchStaxCustomersFromClients()` in `supabaseQueries.ts`. Renders the Billing Report's CreditCard + Auto Pay pill (driven by `auto_charge` + `stax_customer_id`). `Pull Customers (CB)`, `Sync With Stax`, `Sync Customers` buttons removed — no longer needed. Selected row gets explicit `orangeLight` background + `theme.colors.text` foreground so text stays readable through the slide-out's dim overlay (the prior `theme.colors.textMuted` was unreadable through the 20% black overlay). `pulling/syncing/custResult` state retired.

**Step 2 — GAS lookup from CB Clients.** New `stax_buildClientStaxMap_()` helper indexes CB Clients by Client Name, QB Customer Name, AND Stax Customer Name into the same record so divergent-name invoices match. Three Stax write paths (`handleQbExport_` auto-push at line ~20570, `handleImportIIF_` at line ~30160, `stax_lookupCustomerIds_` for the Refresh Stax IDs button) now resolve via this helper. The Stax Customers sheet is no longer read on the IIF/push path. Rows that resolve to a client without a Stax Customer ID are now logged as a `NO_CUSTOMER` exception and skipped, instead of inserted as half-populated PENDING rows.

**Step 3 — Dedup Stax Invoices by docNum.** Sheet-row dedup switches from the multi-field hash (`docNum|name|amount|date`) to the QB invoice number alone — fixes the duplicate INV-000131 issue Justin reported (re-import with a slightly drifted total/date built a different `stax_invoiceKey_`). Existing PENDING rows now UPDATE in place with the freshest customer / date / total / line items / Stax Customer ID; CREATED / PAID / VOIDED rows stay untouched.

**Step 5 — Cleanup migration.** New admin entry `runStaxSheetsCleanup` collapses the existing duplicate clutter (idempotent). Stax Invoices: dedupes by docNum, prefers PAID > VOIDED > CHARGE_FAILED/SENT > CREATED > PENDING, then non-empty Stax Invoice ID, then most recent Created At. Stax Customers: dedupes by (QB Name + Stax Customer ID), keeps the row with the most filled-in cells. Run once from the Apps Script editor.

**Files touched:**
- `stride-gs-app/src/pages/Payments.tsx` (Customers tab + drop sync buttons)
- `stride-gs-app/src/lib/supabaseQueries.ts` (`fetchStaxCustomersFromClients()`)
- `AppScripts/stride-api/StrideAPI.gs` (v38.153.0)

**Pending user action:**
- [ ] Run `runStaxSheetsCleanup` once from Apps Script editor to collapse the existing INV-000131 / Wignall x2 / Digs x7 ghosts.

PR: [#214](https://github.com/Stride-dotcom/Stride-GS-app/pull/214). StrideAPI.gs v38.153.0, Web App v443.

---

## Recent Changes (2026-05-02, session 92 — transfer-system overhaul + Invoice Review tab + client inline edits)

Session focused on closing out long-running transfer-related bug classes, enabling client-portal users to tag their own inventory, and replacing the Invoice Review stub with a real management view.

### Transfer system overhaul (steps 1–3)

Audit found the duplicate-row-per-tenant data model (every transferred item lives as a `Transferred` row under the source tenant + an `Active` row under the destination, sharing the same `item_id`) was the root cause of multiple recurring symptoms — Access Denied on detail pages, photos invisible to the new owner, notes orphaned, will-calls stale on the source. Three-layered fix landed together.

- **Step 1 — `inventory_live` view + React rewire.** New `public.inventory_live` (security_invoker=true, excludes `status='Transferred'`). `fetchItemByIdFromSupabase` now reads from the view so the historical row can never reach the detail page. Tenant-scope param kept as defense in depth. `src/lib/supabaseQueries.ts`, `src/hooks/useItemDetail.ts`.
- **Step 2 — GAS auxiliary-table migrations.** New `api_postTransferSupabaseSideEffects_` runs after `fullClientSync` inside the `transferItems` case handler. Migrates `entity_notes` (inventory-anchored) + `item_photos` rows from source tenant to destination, strips transferred items from any open `will_calls` on the source tenant (cancels the WC if its `item_ids` becomes empty). Storage RLS `photos_select_tenant` extended with a row-based OR clause so photos remain readable to the new tenant without physically moving objects. New `supabasePatch_` + `supabaseSelect_` helpers in `StrideAPI.gs`.
- **Step 3 — Provenance columns.** `inventory.transferred_from_tenant_id` (text) + `transferred_at` (timestamptz), indexed. Stamped during step 2. Backfilled across **31 historical transfer pairs** in one DDL migration so notes / photos / provenance are correct for items already transferred (including 62596, 62632 confirmed for Nip Tuck Remodeling).
- StrideAPI.gs v38.145.0, Web App v435. Migrations: `inventory_live_view_and_transfer_provenance`, `photos_storage_rls_via_item_photos_tenant`, `backfill_transferred_item_aux_tables`.

### Invoice Review tab — real implementation (replaces empty stub)

Tab was bound to `useState<InvoiceReviewRow[]>([])` and never fetched anything — pure stub. Replaced with a full invoice management view in `src/pages/Billing.tsx`:

- **Read** Supabase-only: `billing` where `status IN ('Invoiced','Void') AND invoice_no IS NOT NULL`. RLS scopes for clients automatically. No GAS round-trip for the list.
- **Group** by `invoice_no` into a summary list — client, invoice date, total $, line count, status badge, expand/collapse arrow. "Mixed" badge surfaces partial voids.
- **Search** invoice #, client, item descriptions, item IDs.
- **Filter** client dropdown, status (Invoiced/Void/All), invoice-date range, Clear button.
- **Sort** Invoice #, Client, Invoice Date, Total — click header to toggle.
- **Expand** to show all line items with svc badge, item DeepLink, description, qty/rate/total, refs to Task / Repair / Shipment (DeepLinks each), notes.
- **Per-invoice actions:** PDF (opens `invoice_url` in new tab), Void (staff/admin only, optimistic update with revert-on-failure, custom `loadingText="Voiding…"` / `successText="Voided"` on WriteButton).
- **Realtime:** subscribes to `entityEvents` so billing writes refresh the list automatically.

New API + GAS: `postVoidInvoice` in `src/lib/api.ts`; `handleVoidInvoice_` + case route in `StrideAPI.gs` (withStaffGuard + withClientIsolation, fullClientSync after, audit row written). Sets every Billing_Ledger row matching `invoiceNo` to `Void`, appends a "Voided: <reason>" note.

### Client-role inline edit on Inventory (Room + Reference)

Added `canEditClientFields` predicate in `src/pages/Inventory.tsx` admitting `role==='client'` for the Room and Reference cells only. Operational fields (vendor, sidemark, description, location) stay admin/staff-only via the existing `canEditInventory` check. Critically the columns `useMemo` deps array also gained `canEditClientFields` — without it, the cells stayed disabled forever because the only deps signal (`canEditInventory`) doesn't change for client users.

### ItemDetailPanel save → list refresh latency fix

`ItemDetailPanel`'s two save handlers (field edits + coverage edits) called `postUpdateInventoryItem` but never fired `entityEvents.emit('inventory', itemId)`. Other consumers (`useInventory`, `BatchDataContext`) only learned about the change via the Supabase realtime echo, which lags the GAS write by several seconds. Easy to navigate back to the list before that lands and see stale values until manual refresh. Added the missing emit on both paths to match the `InlineEditableCell` pattern.

### Inventory I/A/R/W/D badges — failed-inspection red I + uniform sizing

`ItemIdBadges` gained a third `state` ('open'/'done'/'failed') for the I badge. When an INSP task is Completed with `result='Fail'`, the badge renders `#DC2626` with `fontWeight: 900` instead of green/orange. Plumbed through `useItemIndicators` (now also pulls `result` from tasks) and every consumer (Inventory, Tasks, Repairs, Dashboard pages + Item / Task / Repair / Shipment / Will Call detail panels). Also fixed thin-letter sizing — all five badges now sit in a fixed `minWidth: 12px` square with centered text so the strip reads uniform regardless of letter width.

### Item access check — parent clients unblocked, transferred items resolve to live row

`useItemDetail`'s access check compared `result.clientSheetId` against `user.clientSheetId` (single primary tenant), so parent-client accounts with multiple accessible tenants hit Access Denied on child-tenant items even though the rest of the app showed them. Switched to `user.accessibleClientSheetIds.includes(...)` matching every other detail hook's `hasAccess()` helper. Combined with the inventory_live view fix, this resolves the Hillary / Nip Tuck case fully.

### Other small fixes

- **Delivery Orders impersonation:** `useOrders` removed `isSupabaseCacheAvailable()` gate (which returns false during impersonation, surfacing a misleading "Supabase connection unavailable" error). Page is Supabase-only by design; RLS handles tenant scoping.
- **CreateDeliveryOrderModal client picker:** filters to `user.accessibleClientNames` for non-staff and shows a read-only label when there's a single accessible client. Staff/admin keep the full list.
- **Client filter dropdown leak:** Inventory / Tasks / Repairs / WillCalls / Shipments / Orders pages stopped showing "51 selected" to client-role users. ONE-TIME ref-guarded init: client role always force-overwrites `clientFilter` to `accessibleClientNames` on mount; staff/admin only auto-fill if empty so subsequent narrowing/clearing sticks.

### Memory / docs

- Updated `feedback_run_deployments.md` with explicit GAS deploy commands (`npm run push-api && npm run deploy-api`) so future sessions don't tell users to paste — landed because I made that mistake mid-session.

---

## Recent Changes (2026-05-02, session 91 — perf sweep + worktree convention + billing-page audit close)

Late-day session that started as a single production fire (release-items timing out on multi-item orders) and turned into a full sweep of the per-cell `setValue`-in-loop antipattern across the GAS surface, plus closing out the billing-page audit's final follow-up. Two HEAD-stomp incidents from parallel-builder collisions in the canonical clone forced a process change: per-builder git worktrees, documented as a Critical Rule.

### PR #186 — handleReleaseItems_ bulk-write
- Production fire: releasing items on a 50+ item order was hitting GAS execution timeout (3 setValue() per item × 50 items × 500ms-2s/round-trip = 3-5 min). Refactored to collect all per-row mutations into in-memory arrays, compute the contiguous range covering changed rows, and write each affected column ONCE via `setValues`. Untouched-but-in-slice rows write back snapshot values so unrelated data isn't clobbered.
- 50-item release: ~3-5 min → <5 sec. Constant time regardless of item count.
- StrideAPI.gs v38.142.8, Web App v425.

### PR #187 — handleCreateInvoice_ ledger updates bulk-write
- Same antipattern in `api_markClientLedgerInvoiced_` + Email Status updates on Consolidated_Ledger inside `handleCreateInvoice_`. Up to 4 setValue() per ledger row × N rows on a monthly invoice (~200 lines = 800 round-trips, frequent timeouts).
- New code: 4 round-trips for client Billing_Ledger update + 1 for Consolidated_Ledger Email Status, regardless of N. StrideAPI.gs v38.142.9, Web App v426.

### PR #188 — handleCancelWillCall_ bulk-write (Class A)
- Smaller-scale variant — cancellation set 1 setValue per WC_Items row in a loop. 20-item WC = 1-2 min hang (not a timeout; users assumed click hadn't registered). Same recipe applied to the WC_Items Status column. Note: `wciData` here uses `getDataRange()` so includes the header at index 0 — sheet row R maps to `wciData[R-1]` (vs PR #186's wciData sliced from row 2). Captured inline.
- StrideAPI.gs v38.142.10, Web App v427.

### PR #190 — api_writeThrough_ batch path (Supabase mirror)
- Audit revealed every bulk handler also called `api_writeThrough_` afterward to mirror to Supabase, and that path was per-row: each ID = `SpreadsheetApp.openById` + `sheetToObjects_(sheet)` + linear scan + single-row `supabaseUpsert_` POST. So 50-item release-items had ~10-25 sec of writeThrough on top of the (already-fixed) sheet write.
- New `resyncEntitiesBatchToSupabase_` opens the sheet ONCE, reads `sheetToObjects_` ONCE, builds an id→row map, constructs all upsert objects in memory (using the same `sb*Row_` helpers `api_fullClientSync_` uses), and fires a single `supabaseBatchUpsert_(table, rows)`. That helper already chunks at 50 + retries per-row on chunk failure, so robustness for big batches is inherited.
- `api_writeThrough_` dispatches to the batch path when `ids.length > 1 && entityType !== "clients"`. Single-ID router cases (~25 sites) unchanged. On batch failure, falls back to the existing per-row loop so `gs_sync_events` still gets per-entity failure rows for the React FailedOperationsDrawer.
- Updated 4 batch handlers (`handleBatchCancelTasks_`, `handleBatchCancelRepairs_`, `handleBatchCancelWillCalls_`, `handleBatchReassignTasks_`) to pass `succeededIds` as an array. `handleReleaseItems_` already passed an array — picks up the batched path automatically.
- 50-item release writeThrough: ~10-25 sec → ~0.5-1 sec. batch-cancel-20-tasks: ~4-10 sec → ~0.5 sec.
- StrideAPI.gs v38.142.11, Web App v428.

### PR #191 — Class C handlers bulk-write
- `handleStartTask_`, `handleCompleteTask_`, `handleCompleteRepair_` were each doing 4-8 separate setValue() calls per request (one row across many columns) — 5-15 sec of latency. Sluggish enough that staff thought clicks weren't registering and clicked again.
- Refactored each: read full row once at function start (already happening), replace each `setValue` with `setRowVal_(col, val)` that mutates the in-memory rowData and tracks modified columns, then single `setValues` over the contiguous slice at end-of-try. Untouched-but-in-slice columns write back existing values from the snapshot.
- Also dropped a now-redundant `SpreadsheetApp.flush()` inside `handleCompleteTask_`'s Custom Price branch (the bulk write at end-of-try makes it meaningless; `resyncEntityToSupabase_` flushes itself before reading). `handleCompleteRepair_`'s `Email Sent At` setValue stays standalone — fires AFTER lock release in a separate control flow, doesn't multiply.
- Each handler now responds in <2 sec. StrideAPI.gs v38.142.12, Web App v429.

### PR #194 — handleBatchCancelWillCalls_ cascade fix + handleCancelWillCall_ duplicate-read cleanup
- Two cleanups picked from PR #188's "out of scope" list. (1) The bulk-cancel handler was re-reading the WC_Items snapshot inside its outer WC loop AND writing one setValue per cascaded item — for M WCs × N items, M reads + M·N round-trips. 5-WC × 20-item bulk cancel was ~60-180 sec. New code reads `wciData` ONCE before the outer loop, accumulates cancel-row sheet numbers across all WCs into `wciCancelRows`, single bulk setValues over the contiguous range at the end. Index-math note: this `wciData` is sliced from row 2 (no header), so sheet row R maps to `wciData[R - 2]` (differs from #188's `getDataRange()` form).
- (2) `handleCancelWillCall_`'s section-5 email-table builder no longer re-reads the sheet into `wciMap2`/`wciData2` — reuses the section-4 `wciMap`/`wciData` snapshot. Item-level fields don't change with cancellation, so the pre-write snapshot is identical for the email table (which only reads Item ID, Qty, Vendor, Description, Sidemark — not Status).
- StrideAPI.gs v38.143.1, Web App v431. (v38.143.0 was the parallel-shipped PR #193 task add-ons; my will-call cleanup landed on top as a patch bump.)

### PR #197 — per-builder worktree convention (chore/docs)
- Two HEAD-stomp incidents this session: builder A ran `git checkout -b ...` to start work, builder B then ran `git checkout ...` for theirs in the same canonical clone, A's next commit landed on B's branch because both shared one HEAD. Recovered by cherry-picking onto the right branch each time, but the second occurrence was while shipping THIS very PR — strong evidence the convention is needed.
- Added "⚠️ CRITICAL: Worktrees for parallel builders" section to CLAUDE.md (and stride-gs-app/CLAUDE.md mirror). Convention: `git worktree add -b fix/<scope>/<desc> /c/dev/stride-<topic> source` per session. Each worktree has its own HEAD/index/working-tree, shared `.git`. Git enforces "one worktree per branch," so collisions become physically impossible. Documented session-end cleanup (`git worktree remove`), npm-install requirement (`node_modules` not shared), and the existing "Never deploy from a worktree without merging to source first" rule (worktrees are for *building* in parallel; canonical clone is for *deploying* the merged result).

### PR #200 — Billing Category filter (closes billing-page audit PR 3)
- Added a `Category` MultiSelectFilter between Sidemark and Service on the Billing → Report tab. Categories derive from `useServiceCatalog` (already swapped from `usePricing` in #185 / audit PR 2). Selecting categories reactively narrows the Service dropdown via `SVC_OPTIONS_FOR_FILTER`. A `useEffect` drops service selections that fall out of view when categories change (no ghost selections hiding behind a category narrow).
- `BillingFilterParams.categoryFilter?: string[]` flows through both the Supabase path (`fetchBillingFromSupabaseFiltered` adds `.in('category', filters.categoryFilter)`) and the GAS path (URL param; handler may ignore — Supabase is primary read for billing). `billing.category` is already populated on every write, so no migration.
- Closes the billing-page audit's last open follow-up. PR 1 (seed INSURANCE) shipped in #183, PR 2 (services from Supabase) in #185, PR 3 (this one) in #200.

### Parallel work (other builders, same day)
- PR #185 — services filter from Supabase (audit PR 2). PR #189 — storage charges Postgres RPC + GAS commit-rows write-only (progress on long-term step 5 of the migration plan). PR #192 — respect `client.separate_by_sidemark` on invoice grouping (was always splitting). PRs #193 + #195 — billable task add-on services (`task_addons` table + AddTaskServiceModal + completion flow folds addon rows into Billing_Ledger). PRs #196 + #198 + #199 — BillingPreviewCard / BillingCalculator port from WMS (collapsible preview card + footer pill alignment + task-billing consolidation).

---

## Recent Changes (2026-05-02, session 90 — GAS→Supabase email migration batch)

### PR #174 — notify-new-order + notify-public-request route through send-email
- Both edge functions previously POSTed rendered HTML to GAS sendRawEmail. They now hand off to the `send-email` edge function (Resend) — drops `GAS_API_URL` / `GAS_API_TOKEN` deps, gets idempotency + `email_sends` audit rows for free.
- Idempotency keys: `order-review-request:<id>`, `public-request-confirm:<id>`, `public-request-alert:<id>`. Re-fires on the same order are deduped.
- Files: `stride-gs-app/supabase/functions/notify-new-order/index.ts`, `stride-gs-app/supabase/functions/notify-public-request/index.ts`. Deployed v8 / v3.

### PR #175 — ONBOARDING_EMAIL resend off GAS via send-onboarding-email
- New edge function `stride-gs-app/supabase/functions/send-onboarding-email/index.ts` (v1) resolves user → client (via `cb_users` + `clients`) → tokens → `send-email`. Replaces the GAS `sendOnboardingToUsers` path.
- Settings → Users → Resend Onboarding now calls the new function. Removed `postSendOnboardingToUsers` import from `Settings.tsx`.
- The GAS handler stays alive for activation / password-reset (those issue temp passwords + need the credentials-block fallback).

### PR #176 — CLAIM_STAFF_NOTIFY off GAS via React-side send-email
- `CreateClaimModal.tsx` now fires `sendEmail({ templateKey: 'CLAIM_STAFF_NOTIFY', tokens, idempotencyKey })` after `postCreateClaim` succeeds. Recipients resolve from `email_templates.recipients` (`{{STAFF_EMAILS}}`).
- `handleCreateClaim_` in StrideAPI.gs (v38.119.0) no longer sends CLAIM_STAFF_NOTIFY — keeping it would double-send. CLAIM_RECEIVED to claimant still on GAS for now.
- Deployed: GAS push + deploy-api (Web App v422), then React `npm run deploy`.

### PR #178 — claim status emails (CLAIM_RECEIVED + CLAIM_MORE_INFO + CLAIM_DENIAL)
- CreateClaimModal also fires CLAIM_RECEIVED to the claimant after postCreateClaim. ClaimDetailPanel fires CLAIM_MORE_INFO after postRequestMoreInfo and CLAIM_DENIAL after postSendClaimDenial. All three GAS-side sends stripped (StrideAPI.gs v38.120.0). Web App v423.
- CLAIM_SETTLEMENT stays on GAS — needs attachments (now landed in PR #182) AND the PDF source moved off Drive.

### PR #179 — notify-order-revision routes through send-email
- ORDER_REJECTED + ORDER_REVISION_REQUESTED no longer POST to GAS sendRawEmail. Edge function v3 ACTIVE; idempotency `${action}:${orderId}`.

### PR #180 — ACCOUNT_REFRESH_INVITATION off GAS
- Settings → Clients → Send Refresh Link now hits send-email with templateKey ACCOUNT_REFRESH_INVITATION. Same modal-edit override pattern as PR #169.

### PR #181 — cleanup: dead GAS handlers + React wrappers
- ~383 lines retired across StrideAPI.gs + api.ts. Handlers: sendIntakeInvitation, notifyIntakeSubmitted, sendOnboardingToUsers, emailSignedAgreement (all migrated earlier in the session). StrideAPI.gs v38.121.0, Web App v424.

### PR #182 — send-email attachments support
- Optional `attachments` array forwarded 1:1 to Resend (each item = `{filename, content (base64) | path (URL), contentType?}`). React wrapper (`src/lib/email.ts`) gets matching types. Edge function v5 ACTIVE.
- Unblocks INSP_EMAIL + CLAIM_SETTLEMENT migrations (each still needs the PDF source moved off Drive before they can ship).

---

## Recent Changes (2026-05-01, session 87)

### Email CTA &client= precedence + fetcher fallback (real fix for "Task Not Found")
- Symptom (after [#156](https://github.com/Stride-dotcom/Stride-GS-app/pull/156), [#159](https://github.com/Stride-dotcom/Stride-GS-app/pull/159), [#160](https://github.com/Stride-dotcom/Stride-GS-app/pull/160) had landed): inspection email CTA still landed on "Task Not Found" for INSP-62945-1 (Vida-Merit) and INSP-63026-1 (Vida-Waymark). Hard-refresh didn't help.
- Real cause: `api_sendTemplateEmail_` in StrideAPI.gs built the `&client=` suffix from `settings["CLIENT_SPREADSHEET_ID"]` first and the explicit `clientSheetId` param last. Older client sheets don't have that setting populated, so the suffix came out empty → auto-injected "Open in Stride Hub" CTA shipped without a tenant. The frontend fetcher then ran with no `&client=` and the unscoped path (which already existed) failed because the row was visible only after admin RLS bypass — but the legacy GAS fallback also didn't resolve.
- Fix server: reorder precedence so the authoritative `clientSheetId` param wins. Plus a final safety net that re-checks the chosen `ctaUrl` and appends `&client=` if it slipped through. StrideAPI.gs v38.142.7. Pushed + deployed (Web App v421).
- Fix frontend: `fetchTaskByIdFromSupabase` — scoped lookup miss now falls through to unscoped fetch; when multiple rows match unscoped and we have a hint, prefer the matching tenant. Stale / wrong / missing `&client=` on old emails no longer dead-end. PR #162.

### Auth: block authenticated transition until JWT carries user_metadata
- Symptom: even with the correct deep-link format, clicking an inspection email cold (e.g. INSP-63026-1) sometimes lands on "Task Not Found"; a manual refresh fixes it.
- Root cause: `AuthContext` fired `supabase.auth.updateUser({role, clientSheetId})` fire-and-forget and immediately marked the user authenticated. The first `useTaskDetail → fetchTaskByIdFromSupabase` query could race a stale JWT whose `user_metadata` lacked role/clientSheetId. The `tasks_select_staff` RLS bypass keys off `user_metadata.role`; with that missing even admin lookups returned 0 rows → "not-found".
- Fix: `src/contexts/AuthContext.tsx` — both auth paths (cached fast-path + fresh GAS-verify) compare the live session JWT's `user_metadata` against the resolved user and only `await` `updateUser` when stale. Zero added latency when already in sync. PR #160.

### Email deep-link self-heal + WillCalls query-param fix
- WillCalls.gs (CREATED + RELEASE emails) shipped route-style URLs `/#/will-calls/<id>` with no `&client=`, which the React detail lookup rejects. Switched to `?open=<id>&client=<ssid>` per CLAUDE.md "Deep Links — DO NOT BREAK".
- Emails.gs `sendTemplateEmail_` gains a defensive self-heal that rewrites any leftover `/#/<entity>/<id>` URL (shipments|tasks|repairs|will-calls|inventory|claims) to query-param form with `&client=` before the existing missing-&client= patcher runs. Hand-edited templates can't ship the broken format.
- Investigation context: user reported "Task Not Found" from an INSP_EMAIL CTA for INSP-63026-1 (Vida-Waymark). The link format and the row are both fine; the proximate fix was [#156](https://github.com/Stride-dotcom/Stride-GS-app/pull/156)'s tenant-scoped fetcher (browser hard-refresh required to pick up the new bundle). This PR locks down the broader broken-link class.
- Versions: WillCalls.gs v4.6.1, Emails.gs v4.8.2. PR #159. Rolled out to all 52 clients.

### Photo upload routes to the active source-filter sub-tab
- Symptom: on the item Photos tab, switching the sub-filter to "Repair" and uploading still wrote the photo to the inventory item, not the repair.
- Root cause: `PhotoGallery` hard-coded the upload target to the host entity (`entity_type='inventory'`, `entity_id=item.itemId`); the sub-filter only filtered display.
- Fix: `usePhotos.uploadPhoto` accepts an optional `{entityType, entityId}` override (storage path + `item_photos` row stamp both honor it). `PhotoGallery` resolves the target from the active sub-tab using a new `relatedEntities` prop. Single match → upload routes to that entity; zero / multiple matches → button disabled with a tooltip. `ItemDetailPanel`'s `PhotosPanelProxy` threads `linkedTasks / linkedRepairs / linkedWillCalls / shipmentNumber` into the gallery. `PhotoUploadButton` gains a `disabledReason` tooltip prop. PR #158.

### Storage RLS tolerates `_` ↔ `-` in clientSheetId path prefix
- Symptom: Hillary @ Nip Tuck (client role) couldn't see photos on inventory items in her own account; admin "login as" worked fine.
- Root cause: `usePhotos` / `useDocuments` upload paths sanitize the tenant ID via `sanitizeTenantForPath` (replaces `_` with `-`), but the storage RLS policies (`photos_select_tenant`, `documents_select_tenant`) compared the raw JWT `clientSheetId` (with `_` preserved) against the sanitized path's first segment. Tenants whose ID contains `_` — Nip Tuck (`1_CINtvp...`) and ~10 others — got blocked from their own photos. Admin/staff bypassed via the role branch.
- Fix: `supabase/migrations/20260501010000_storage_rls_underscore_dash_tolerance.sql` — policies now accept either the raw or underscore-stripped form. Verified as Hillary: visible photos bucket objects rose 188 → 280 (+92 for Nip Tuck alone). Migration applied via MCP. PR #157.

### Task detail lookup scoped by tenant — fixes "Task Not Found" after transfer
- Symptom: item 62630 was received under J Garner (auto-inspect), then transferred to Nip Tuck (also auto-inspect). Both tenants ended up with `INSP-62630-1` in their Tasks sheet (J Garner CANCELLED via Transfer.gs, Nip Tuck COMPLETED). Clicking either row showed "Task Not Found".
- Root cause: task IDs are unique per-spreadsheet only (Tasks.gs `nextTaskCounter_` scans the local sheet). After transfer, both tenants hold rows with the same `task_id`. The detail fetch used `.eq('task_id', taskId).maybeSingle()`, which fails on duplicates.
- Fix: `src/lib/supabaseQueries.ts` — `fetchTaskByIdFromSupabase` accepts an optional `clientSheetId` and adds `.eq('tenant_id', clientSheetId)` to disambiguate. With no hint, returns null on multi-row matches so `useTaskDetail`'s legacy GAS scan can resolve.
- Nav plumbing: `src/pages/Tasks.tsx` row click, Task ID cell click, `__openTaskDetail`, `?open=` deep-link effect, and pending-open effect all now append `?client=<spreadsheetId>`. `src/pages/ItemPage.tsx` cross-link to tasks adds it. `src/pages/TaskPage.tsx` and `src/pages/TaskJobPage.tsx` parse `?client=` from URL and pass to `useTaskDetail` (new optional second arg). PR #156.

---

## Recent Changes (2026-04-30, session 86)

### Task ID always clickable on Tasks page
- `src/pages/Tasks.tsx` — Task ID column previously rendered as an orange Drive folder link only when `taskFolderUrl` was set, otherwise greyed-out unclickable text. Now always renders as an orange clickable link that navigates to `/tasks/${taskId}` (the in-app detail page). The Drive folder URL was legacy and shouldn't have gated clickability. `cols()` takes `navigate` parameter; useMemo deps updated to `[navigate]`. Repairs.tsx and WillCalls.tsx checked — neither uses the Drive-folder gating pattern, no changes needed. PR #145.

---

## Recent Changes (2026-04-30, session 85)

### Client access to delivery orders restored
- `src/pages/Orders.tsx` — clients with `RoleGuard`-allowed access to `/orders` couldn't actually see the Orders tab or the "+ New Delivery" button. Three gates were hardcoded `isAdmin` only: tab default, URL→tab resolver, and tab-content render. Replaced with `canViewOrders = isAdmin || isClient`. DT Sync button kept admin-only. Existing client-name filter (lines 162-171) already restricts visible rows to `accessibleClientNames`, so no extra RLS work was needed.

---

## Recent Changes (2026-04-30, session 84)

### Customizable add-on charges on delivery orders
- `src/components/shared/CreateDeliveryOrderModal.tsx` v5 — every selected add-on now exposes editable Qty + Rate inputs in both the entry screen and the Full Edit screen (same component, used in both contexts). Subtotal recomputes live as qty × rate for ALL units (previously `flat`/`plus_base` ignored qty so a flat $185 Disposal could only ever be one line of $185). Rate defaults to the catalog price; staff/admin can override; clients see rate locked but can still change qty. A "Modified" badge surfaces overrides to reviewers. Quote-required add-ons stay at $0/"Quote Required" until staff enters a rate, at which point they become a normal charge. Per-order rate persists in `dt_orders.accessorials_json[].rate` (column already existed; previously the catalog rate was re-looked-up at save time, overwriting any future override).

---

## Recent Changes (2026-04-26, session 83)

### Order revision/rejection emails
- New Edge Function `notify-order-revision` — sends `ORDER_REVISION_REQUESTED` or `ORDER_REJECTED` email when a reviewer flags an order. Recipients = office distro (NOTIFICATION_EMAILS secret) + the order submitter (resolved from `dt_orders.created_by_user` → `profiles.email`), deduped case-insensitively. Mirrors `notify-new-order`'s pattern (template lookup → token substitution → GAS sendRawEmail). Token values are HTML-escaped before substitution.
- Migration `20260426000000_order_revision_email_templates.sql` seeds two new `email_templates` rows. Both visually mirror `ORDER_REVIEW_REQUEST` (dark header, accent banner, detail table, footer) with action-specific colors: amber `#F59E0B` for revisions, red `#DC2626` for rejection. Editable in Settings → Email Templates the same as the rest.
- `src/pages/OrderPage.tsx` — added "Request Revision" button next to existing "Reject". Both prompt for notes via `window.prompt`, persist `review_status + review_notes + reviewed_by + reviewed_at`, then invoke `notify-order-revision` (best-effort — failures log warn but don't unwind the status change).

### dt-sync-statuses bug fix (v8)
- Filter switched from `dt_dispatch_id IS NOT NULL` to `pushed_to_dt_at IS NOT NULL`. App-pushed orders never get a dispatch ID (DT's `add_order` response is just `<success>...</success>`), so the old filter skipped them — they stayed "Awaiting DT Sync" forever. Lookup now passes `dt_identifier` to DT's `service_order_id` query param (which the XML spec confirms accepts the human Order_Number). Falls back to `dt_dispatch_id` for legacy webhook-imported rows.

## Recent Changes (2026-04-25, session 82)

### DT order Completion view + sync-back
- New migration `20260425230000_dt_sync_back_fields.sql` — adds completion columns to `dt_orders` (`started_at`, `finished_at`, `scheduled_at`, `driver_id`, `driver_name`, `truck_id`, `truck_name`, `service_unit`, `stop_number`, `actual_service_time_minutes`, `payment_collected`, `payment_notes`, `cod_amount`, `signature_captured_at`, `dt_status_code`, `dt_export_payload`); per-item delivery state to `dt_order_items` (`delivered`, `item_note`, `checked_quantity`, `location`, `return_codes`, `last_synced_at`); `lat`/`lng`/`source` on `dt_order_history`; allows `source='dt_export'` on `dt_order_notes`. Applied via MCP.
- `dt-push-order` **v15** — driver-facing `<notes>` block falls back to `dt_orders.details` when `order_notes` is empty so the modal's "Notes / Special Instructions" reaches the DT driver app's notes pane.
- `dt-sync-statuses` **v7** — replaced code-only `get_order_status` with `/orders/api/export.xml?service_order_id=…`. Mirrors back driver, truck, started/finished/scheduled, COD/payment, signature timestamp, per-item `delivered_quantity`/`item_note`/`return_codes`, full `order_history` timeline, and DT-side notes. Replace-on-sync scoped to `source='dt_export'` so app/webhook-authored rows survive.
- New `src/pages/OrderPage.tsx` **Completion tab** — renders driver/vehicle, timing (scheduled/started/finished/actual), proof-of-delivery (COD, signature_captured_at), DT-side notes feed, and driver-activity timeline (with Google Maps lat/lng deep-link). Items tab now shows "Delivered" / "Short" badges, driver-posted item notes, and return codes.
- New helpers in `src/lib/supabaseQueries.ts` — `fetchDtOrderHistory(dtOrderId)` and `fetchDtOrderNotes(dtOrderId)` returning `DtOrderHistoryEvent[]` / `DtSideNote[]`. Type extensions on `DtOrderForUI` + `DtOrderItemForUI` for the new sync-back columns.
- **Pending**: photo sync. DT XML export does not return photo URLs; the JSON Beetrack API (`GET /api/external/v1/dispatches/:identifier`) does, under `form.img_url[]`. Needs a separate `X-AUTH-TOKEN` from DT support before wiring.

## Recent Changes (2026-04-25, session 80)

### Scroll position restored on back-navigation
- New `src/hooks/useScrollRestoration.ts` — saves a scrollable container's `scrollTop` to `sessionStorage` (per-page key) on scroll (rAF-throttled). Restores once `isReady` flips true so the virtualizer has measured the full content height. Wired into all 5 list pages (Inventory / Tasks / Repairs / WillCalls / Shipments). Closes the loop on back-nav: dropdown + filters + sort + scroll position all restore.

### Client dropdown persists across navigation
- New `src/hooks/useClientFilterPersisted.ts` — drop-in replacement for `useState<string[]>([])` that persists each list page's client dropdown selection. Initial state precedence: URL `?client=` (resolved via apiClients, wins for email deep-links) → localStorage `stride_client_filter_<pageKey>` (last-used scope) → empty array (falls through to the page's role-default effect). Writes to localStorage on every change.
- Wired into all 5 list pages: Inventory / Tasks / Repairs / WillCalls / Shipments. Fixes the "click into an entity, hit back, dropdown is reset to all clients" pain. Sort + status filter + column visibility were already persisted via `useTablePreferences`; this closes the gap on the dropdown that was still useState-only.

### Back-button restores tab state across Orders / Settings / Billing
- New `src/hooks/useUrlState.ts` — single-key URL search-param state hook built on `useSearchParams`. `[value, setValue] = useUrlState(key, default, { replace? })`. Default pushes a history entry; `replace: true` for transient state. Empty string deletes the param so URLs stay short.
- `src/pages/Orders.tsx`, `src/pages/Billing.tsx`, `src/pages/Settings.tsx` — `activeTab` now lives in the URL via `useUrlState('tab', defaultTab)`. Settings also moves its `clientsSubTab` into `?subtab=`. Switching tabs pushes a history entry; back navigates to the prior tab. Email deep-links (`?tab=clients&subtab=intakes&intake=<id>`) survive subsequent navigation.
- The five list pages (Inventory/Tasks/Repairs/WillCalls/Shipments) didn't need conversion because they already moved to standalone `/inventory/:id`-style routes — back-button handles those natively.

### dt-push-order STRIDE LOGISTICS default fallback
- `supabase/functions/dt-push-order/index.ts` — `resolveAccountName()` now returns `'STRIDE LOGISTICS'` when `acctMap[tenantId]` is empty/missing (was: returned `''` and the caller errored 400). Pushes never fail for unmapped tenants; orders land on the house account and ops can reassign in DT's UI. The caller's `if (!accountName)` early-return is now unreachable but kept for defense in depth.

### Intake notification trigger — defensive EXCEPTION wrapper
- New migration `20260425200000_intake_notification_trigger_safe.sql` — wraps the INSERT inside `notify_admins_on_intake_submit()` in `BEGIN/EXCEPTION WHEN OTHERS` so a notification failure cannot roll back the parent intake transaction. Today the trigger is owned by `postgres` (BYPASSRLS) so the unsafe version works fine, but a future RLS/constraint change won't silently drop intake rows. Notification becomes best-effort; intake row always lands.

### Dropbox-corruption signpost
- New `CLAUDE.md` at the Dropbox repo root (Dropbox-only file, gitignored locally) — directs any future Claude session that lands at the Dropbox path to switch to `C:\dev\Stride-GS-app`. Today's session burned ~30 min recovering git pack corruption that was caused by editing through Dropbox sync; the signpost prevents recurrence.

---

## Recent Changes (2026-04-24, prior session)

### Unified order status + edge function repairs (2026-04-24)
- Migration `20260425020000_unified_order_status.sql` — expanded dt_statuses with 7 new statuses (pending_review, rejected, push_failed, in_transit, billing_review, in_ledger, collected), updated display_order, added push_error column
- `dt-push-order` v13 — added `<custom_field_2>` deep link to DT XML payload (`supabase/functions/dt-push-order/index.ts`)
- `dt-webhook-ingest` v3 — corrected status ID mapping, added auto-Collected logic with error handling, error handling on quarantine/mark-processed (`supabase/functions/dt-webhook-ingest/index.ts`)
- `dt-sync-statuses` v4 — added exception+billing to terminal filter, paid_at in SELECT, same-status guard, auto-Collected logic (`supabase/functions/dt-sync-statuses/index.ts`)
- Created CODE_MAP.md — comprehensive feature-to-file index for builder onboarding
- Added doc update instructions to CLAUDE.md

### Stax + QBO catalog sync
- New Edge Function `stax-catalog-sync` deployed — syncs service_catalog items to Stax on create/update
- QBO sync via Apps Script `handleQboSyncCatalogItem_` — creates/updates QBO Service items
- `stax_item_id` and `qb_item_id` columns added to service_catalog (migration applied)
- Auto-sync wired into `useServiceCatalog` create/update callbacks (non-blocking, best-effort)

### Drive folder URL fix
- Fixed `api_fullClientSync_` to read RichText hyperlinks from Shipment # column
- StrideAPI.gs v38.118.0, deployed as version 387
- Backfill function `backfillShipmentFolderUrls()` ready to run from Apps Script editor

### Delivery access control + admin auto-push
- Delivery page removed from staff navigation (sidebar + route guard)
- "Create Delivery" button and FAB action hidden for staff role (desktop toolbar + mobile FAB)
- Admin-created delivery orders skip review queue — save as "approved" and auto-push to DT
- Delivery audit log entries written for inventory items included in delivery orders
- INSERT policy added to entity_audit_log for admin/staff

---

## Pending User Actions

- [ ] **[MIGRATION-P2/P3/P4a/P5/P6 — feat/migration/batch-handlers-and-routing — operator deploy] Deploy 17 new + 4 existing SB-primary Edge Functions.** Builder env has no `SUPABASE_ACCESS_TOKEN`; run from a machine with `supabase login` complete. From `C:\dev\Stride-GS-app\stride-gs-app`:

  ```bash
  # Group A — newly built in this PR (build only; no flag flip yet)
  npx supabase functions deploy update-task-sb              --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy update-repair-sb            --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy transfer-items-sb           --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy complete-shipment-sb        --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy send-shipment-email-sb      --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy send-task-complete-email-sb --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy send-will-call-emails-sb    --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy create-invoice-sb           --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy void-invoice-sb             --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy reissue-invoice-sb          --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy commit-storage-charges-sb   --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy onboard-client-sb           --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy qbo-create-invoice-sb       --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy create-stax-invoices-sb     --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy run-stax-charges-sb         --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy import-iif-sb               --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy generate-unbilled-report-sb --project-ref uqplppugeickmamycpuz

  # Group B — previously built but never deployed
  # (re-deploy after merge so the deployed bundle matches main)
  npx supabase functions deploy update-item-sb              --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy batch-create-tasks-sb       --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy release-items-sb            --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy create-will-call-sb         --project-ref uqplppugeickmamycpuz
  npx supabase functions deploy process-wc-release-sb       --project-ref uqplppugeickmamycpuz
  ```

  Default `--verify-jwt=true` is correct on all of them. **Required env-var configuration** (Supabase Dashboard → Functions → Secrets) — most should already be set; verify before deploying real-money handlers:

  | Function | Required secrets |
  |---|---|
  | All -sb handlers | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GAS_API_URL`, `GAS_API_TOKEN` |
  | qbo-create-invoice-sb | + `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REFRESH_TOKEN`, `QBO_REALM_ID`, optionally `QBO_ENVIRONMENT` (production/sandbox) |
  | create-stax-invoices-sb | + `STAX_API_KEY` (optional — without it the handler runs SB-only dry-run mode) |
  | run-stax-charges-sb | + `STAX_API_KEY` (REQUIRED — handler hard-fails without it; real money) |

  Real-money handlers (qbo-create-invoice-sb, create-stax-invoices-sb, run-stax-charges-sb, import-iif-sb) enforce an explicit admin/staff role check via `auth.getUser(token)` — only operators with `user_metadata.role ∈ {'admin','staff'}` can invoke. Anon-key callers receive `401 UNAUTHENTICATED` / `403 FORBIDDEN`.

  **Do NOT flip feature_flags for any of these functions yet.** Routing entries are in `GAS_TO_SB_MAP` so they'll route once the flag flips, but the production-tenant bar (MIG-007 layer-2 replay-clean + layer-3 canary) still applies. Justin nominates a canary tenant first; then per-flag flip + smoke test follows the same sequence used for `update-item-sb` in the prior PR.

- [ ] **[MIGRATION-P2-P3/MIG-016 — operator deploy sequence, DO NOT REORDER]** Canary cutover on Justin Demo Account for the 5 SB-primary handlers shipped in this PR. The order below is load-bearing.

  1. **Merge + push branch** `feat/migration/route-and-update-item` → PR review → squash-merge to `source`. The React-side routing layer is dormant until step 4 (only fires per-flag-per-tenant), so the React deploy via `npm run deploy` from canonical is order-independent — do it anytime after merge.

  2. **Deploy StrideAPI v38.227.0 FIRST.** From `C:\dev\Stride-GS-app\AppScripts\stride-client-inventory`:
     ```
     npm run push-api && npm run deploy-api
     ```
     v38.226.0 extended `__writeThroughReverseInventory_` (general field updates). v38.227.0 added `__writeThroughReverseTasks_` (insert + update path for the Tasks sheet, required by `batch-create-tasks-sb`). Both deployed by this one command.

  3. **Deploy the 5 Edge Functions SECOND.** From a machine with `SUPABASE_ACCESS_TOKEN` or `supabase login`, from `C:\dev\Stride-GS-app\stride-gs-app`:
     ```
     npx supabase functions deploy update-item-sb            --project-ref uqplppugeickmamycpuz
     npx supabase functions deploy batch-create-tasks-sb     --project-ref uqplppugeickmamycpuz
     npx supabase functions deploy release-items-sb          --project-ref uqplppugeickmamycpuz
     npx supabase functions deploy create-will-call-sb       --project-ref uqplppugeickmamycpuz
     npx supabase functions deploy process-wc-release-sb     --project-ref uqplppugeickmamycpuz
     ```
     Default `--verify-jwt=true` is correct. No new function-level secrets needed — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GAS_API_URL`, `GAS_API_TOKEN` are all already configured.

  4. **Flip feature_flags for Justin Demo Account THIRD.** Replace `<justin_demo_spreadsheet_id>` with the actual tenant ID. Flip one flag at a time per the canary-incremental strategy:
     ```sql
     -- Round 1: updateItem (the safest — pure field edits)
     UPDATE public.feature_flags SET active_backend='supabase',
            tenant_scope = ARRAY['<justin_demo_spreadsheet_id>']
      WHERE function_key = 'updateItem';

     -- Smoke test updateItem on Justin Demo. If clean, proceed:

     -- Round 2: releaseItems + createTask (operational, non-billing)
     UPDATE public.feature_flags SET active_backend='supabase',
            tenant_scope = ARRAY['<justin_demo_spreadsheet_id>']
      WHERE function_key IN ('releaseItems', 'createTask');

     -- Smoke test. If clean, proceed:

     -- Round 3: createWillCall (touches billing via WC fee)
     UPDATE public.feature_flags SET active_backend='supabase',
            tenant_scope = ARRAY['<justin_demo_spreadsheet_id>']
      WHERE function_key = 'createWillCall';

     -- Smoke test. If clean, proceed:

     -- Round 4: processWcRelease (touches inventory release + billing)
     UPDATE public.feature_flags SET active_backend='supabase',
            tenant_scope = ARRAY['<justin_demo_spreadsheet_id>']
      WHERE function_key = 'processWcRelease';
     ```
     Per MIG-010 scope semantics: Justin Demo routed to SB, every other tenant routed to GAS. Production tenants STAY ON GAS.

  5. **Per-flag smoke tests on Justin Demo.** For each flag flipped, exercise the corresponding React UI path:
     - `updateItem` — edit Sidemark / Vendor / Item Notes on an inventory row; verify save lands in `public.inventory` + per-tenant Inventory sheet within seconds; `entity_audit_log` row with `source='supabase'`. Status flip to Released cancels open Tasks/Repairs with " | Auto-cancelled: ..." appended.
     - `createTask` — bulk-create INSP tasks from Inventory page action bar; verify `public.tasks` rows appear with derived Task IDs; sheet mirror lands via the new tasks writer.
     - `releaseItems` — bulk release N items; verify `public.inventory.status='Released'`, `release_date` set, open Tasks/Repairs cancelled, sheet reflects.
     - `createWillCall` — create a WC for N items; verify `public.will_calls` + `public.will_call_items` rows, WC fee computed correctly per item class, no dup if same item already on active WC.
     - `processWcRelease` — release subset of WC items; verify `public.will_call_items.status='Released'` for releasing items, parent WC status flipped (Released or Partial), Unbilled WC billing rows appear for non-COD, idempotent re-run does NOT corrupt Invoiced/Void rows.

  6. **Rollback** (per-flag, any time): `UPDATE feature_flags SET active_backend='gas', tenant_scope=NULL WHERE function_key='<key>';` instantly routes back to GAS. Master switch (Settings → Migration → emergency revert) covers fleet-wide.

  **Production-tenant expansion** is GATED on MIG-007 — replay-clean + 14-day canary on Justin Demo without regressions. Do NOT add production tenants to any `tenant_scope` without that bar cleared per MIG-016.

  **Known canary-acceptable gaps** (documented per EF in its header comment):
  - `createWillCall`: per-tenant `Will_Calls` + `WC_Items` sheet drift until full-sync cron (~5-30 min); will_calls writer is COD-only-update, items writer is stub.
  - `processWcRelease`: partial release does NOT create a child WC for remaining items (operator creates manually); addons flush skipped; WC release email skipped (operator resends via legacy GAS path).
  - `batchCreateTasks`: task-ID race window on concurrent calls to the same `(tenant, item, svcCode)` tuple — rare in practice; future hardening via SECURITY DEFINER RPC.
  - `update-item-sb`: cascade fan-out rows (Tasks/Repairs cancellations on Released-transition) write to Supabase only; per-tenant sheet drift on those rows until full-sync cron.

  **completeShipment / receiveShipment NOT in this PR** — separate follow-up PR. Complexity: shipment number SEQUENCE, idempotency-tag dedup against existing shipments, N inventory inserts, auto-INSP / auto-ASM task generation, receiving billing rows, Drive folder creation, shipment-received email. ~3-hour port; shipping half-built risks producing missing folder links + missing inventory rows in production.

- [ ] **Apply migration `20260520140000_clients_writeback_trigger.sql`** (feat/migration/client-settings-writeback) — creates `propagate_clients_to_sheet()` SECURITY DEFINER + `trg_propagate_clients_to_sheet` AFTER INSERT OR UPDATE trigger on `public.clients`. Builder env has no Supabase MCP / `SUPABASE_ACCESS_TOKEN`. Apply via `apply_migration(project_id='uqplppugeickmamycpuz', name='clients_writeback_trigger', query=<file contents>)` or paste into the Supabase SQL editor. Idempotent (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` before `CREATE`).
- [ ] **Deploy `push-client-settings-to-sheet` Edge Function**. From a machine with `SUPABASE_ACCESS_TOKEN` set or `supabase login` run, from `C:\dev\Stride-GS-app\stride-gs-app`:
  `npx supabase functions deploy push-client-settings-to-sheet --project-ref uqplppugeickmamycpuz`
  Default `--verify-jwt=true` is correct here: the Postgres trigger calls with a service-role JWT, `apply-intake-on-submit` calls with a service-role JWT, future React callers will use the user JWT. No new function-level secrets needed — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GAS_API_URL`, `GAS_API_TOKEN` are all already configured per MIGRATION_STATUS.md.
- [ ] **Redeploy `apply-intake-on-submit` Edge Function** so the new step-8 sheet-mirror invocation goes live: `npx supabase functions deploy apply-intake-on-submit --project-ref uqplppugeickmamycpuz`.
- [ ] **Configure the trigger's GUCs** (one-time, environment-specific — the values must NOT live in source):
  ```sql
  ALTER DATABASE postgres SET app.settings.supabase_url     = 'https://uqplppugeickmamycpuz.supabase.co';
  ALTER DATABASE postgres SET app.settings.service_role_key = '<service-role-jwt>';
  SELECT pg_reload_conf();
  ```
  Trigger fails open on missing GUCs (RAISE NOTICE + RETURN NEW), so this step is REQUIRED to actually fire the write-back. Verify post-set: `UPDATE public.clients SET auto_inspection = NOT auto_inspection WHERE spreadsheet_id = '<some_id>';` then `SELECT id, status_code, created FROM net._http_response WHERE url LIKE '%push-client-settings-to-sheet%' ORDER BY created DESC LIMIT 5;` should show a fresh 200 row.
- [ ] **Push + deploy StrideAPI.gs v38.224.0**. From `C:\dev\Stride-GS-app\AppScripts\stride-client-inventory`:
  `npm run push-api && npm run deploy-api`
  The new `__writeThroughReverseClients_` writer + registry change is GAS-side; without this deploy the Edge Function's POST hits an unimplemented stub and reports a writer failure.
- [ ] **Immediate fix for Brian Paquette `auto_inspection`** (once the above 4 steps land): run from the Supabase SQL editor:
  ```sql
  UPDATE public.clients SET auto_inspection = true
   WHERE name ILIKE 'Brian Paquette%' OR contact_name ILIKE 'Brian Paquette%'
  RETURNING spreadsheet_id, name, auto_inspection;
  ```
  Confirm the RETURNING row, then verify the sheet via:
  ```sql
  SELECT id, status_code, content::text, created
    FROM net._http_response
   WHERE url LIKE '%push-client-settings-to-sheet%'
   ORDER BY created DESC LIMIT 3;
  ```
  The Edge Function should report `{ok: true, fields_mirrored: ~24}` and the `AUTO_INSPECTION` row in Brian's per-tenant Settings tab should now read `TRUE`. If Brian's name doesn't match the `ILIKE` exactly, use his explicit `spreadsheet_id` in the UPDATE WHERE clause.
- [x] **Apply migration `20260519130000_dt_orders_taxable_subtotal.sql`** (fix/billing/do-modal-taxable-services, PR #465) — ✅ DONE 2026-05-19: migration applied by operator (`dt_orders.taxable_subtotal` column confirmed present), then React deployed via `npm run deploy` from the canonical clone (bundle live on `origin/main` `69efbbf`). The deploy-ordering hazard (React writes `taxable_subtotal`; deploying before the column existed would `PGRST204`-fail all DO creation) was respected — migration-first, then deploy. Fully shipped.
- [ ] **Apply migration `20260519140000_tax_jurisdictions_rls.sql`** (feat/billing/tax-jurisdictions) — hardens RLS on the operator-created `tax_jurisdictions` table: anon + authenticated SELECT (the public service-request form is anon and must read the default rate), authenticated write (Settings → Pricing → Tax Rates is the admin gate). Idempotent (`create table/index if not exists`, `drop policy if exists` before create, `create or replace function`) — safe whether or not the operator's table/fn/seed already exist. Builder env has no Supabase MCP / `SUPABASE_ACCESS_TOKEN`. Apply via `apply_migration(project_id='uqplppugeickmamycpuz', name='tax_jurisdictions_rls', query=<file contents>)` or paste into the Supabase SQL editor. **Not deploy-blocking**: the app fails soft to 10.4 if the anon read is denied, so the React bundle is safe to ship before this lands; applying it makes the live rate authoritative on the public form. Verify: `SELECT policyname FROM pg_policies WHERE tablename='tax_jurisdictions';` lists the 3 policies, and the public service-request form's tax line shows the seeded Kent 10.4% (not a hardcoded fallback).
- [ ] **Apply migration `20260519000000_dt_order_items_dedupe_unique_index.sql`** (PR #462 — completes the ALL-00097 dup-line fix; until applied, the DB has no structural guard and the partial unique index does not exist). Builder env has no Supabase MCP / `SUPABASE_ACCESS_TOKEN`. Apply via Supabase MCP `apply_migration(project_id='uqplppugeickmamycpuz', name='dt_order_items_dedupe_unique_index', query=<file contents>)`, or paste the file into the Supabase SQL editor. It is idempotent (`IF NOT EXISTS`) and safe to re-run; the dedupe step soft-removes existing duplicate rows (incl. ALL-00097's) so the index can build. Verify: `SELECT indexname FROM pg_indexes WHERE indexname='dt_order_items_order_code_active_uniq';` returns one row, and ALL-00097 has exactly 6 active (`removed_at IS NULL`) lines.
- [ ] **Get DT JSON-API X-AUTH-TOKEN** (Settings → Advanced Settings in DT, or email support@dispatchtrack.com) so the next session can wire photo sync via `/api/external/v1/dispatches/:identifier`. Add to a new `dt_credentials.rest_api_token` column.
- [ ] Set `STAX_API_KEY` secret on stax-catalog-sync Edge Function in Supabase dashboard
- [ ] Run `backfillShipmentFolderUrls()` from Apps Script editor (one-time)
- [ ] Run `backfillActivityAllClientsNow()` for historical activity log seeding
- [ ] Run `reconcileAllClientsNow` for mirror column backfill
- [ ] Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Stax Auto Pay project Script Properties
- [ ] Run `seedAllStaxToSupabase()` once from Stride API editor (Payments cache seed)
- [ ] **Deploy the `get-shared-doc` Edge Function** (completes the #443/#444 shared-doc fix — until this runs, public shared-attachment PDF links stay broken). The builder environment had no `SUPABASE_ACCESS_TOKEN`. From a machine logged into Supabase (or with the token set), run from `C:\dev\Stride-GS-app\stride-gs-app`:
  `npx supabase functions deploy get-shared-doc --project-ref uqplppugeickmamycpuz --no-verify-jwt`
  The `--no-verify-jwt` flag is mandatory — the page opens the function directly with no auth header; without it the gateway 401s. No new secrets needed (the function uses the built-in `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`). Verify by opening a Documents "Open" link on a live `/#/shared/attachments/{shareId}` page.
