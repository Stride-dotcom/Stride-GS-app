# Stride GS App — Build Status

> Last updated: 2026-05-03 (session 93+ — Stax architectural cleanup). Verified against actual codebase.

---

## Current Versions

| System | Version | Notes |
|---|---|---|
| React app (GitHub Pages) | Latest on `origin/main` | `npm run deploy` from source |
| StrideAPI.gs | **v38.153.0** | **Web App deployment v443** (Stax Customers sheet retired; CB Clients single source of truth; dedup Stax Invoices by docNum; runStaxSheetsCleanup admin entry) |
| Supabase | 60 migrations applied | inventory_live view + transfer_provenance columns + photos_select_tenant row-based fallback shipped this session |
| Client scripts | Rolled out to 49 active clients | Code.gs v4.6.0, Import.gs v4.3.0 |
| StaxAutoPay.gs | v4.6.0 | Supabase write-through wired |

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

- [ ] **Get DT JSON-API X-AUTH-TOKEN** (Settings → Advanced Settings in DT, or email support@dispatchtrack.com) so the next session can wire photo sync via `/api/external/v1/dispatches/:identifier`. Add to a new `dt_credentials.rest_api_token` column.
- [ ] Set `STAX_API_KEY` secret on stax-catalog-sync Edge Function in Supabase dashboard
- [ ] Run `backfillShipmentFolderUrls()` from Apps Script editor (one-time)
- [ ] Run `backfillActivityAllClientsNow()` for historical activity log seeding
- [ ] Run `reconcileAllClientsNow` for mirror column backfill
- [ ] Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Stax Auto Pay project Script Properties
- [ ] Run `seedAllStaxToSupabase()` once from Stride API editor (Payments cache seed)
