# Stride GS App — Code Map

> Living index. Feature area → exact file locations. Read this FIRST when debugging or building on existing features so you don't ask "where does X live?"
>
> Conventions:
> - React/Supabase paths are relative to `stride-gs-app/` (e.g. `src/pages/Orders.tsx`).
> - Apps Script paths are relative to the repo root (e.g. `AppScripts/stride-api/StrideAPI.gs`).
> - "Migrations" lists each `supabase/migrations/YYYYMMDDHHMMSS_name.sql` with a one-line note on what it adds.
>
> When adding new files in a session, append them to the matching feature area below before reporting done.

---

## Delivery / DispatchTrack

Delivery order workflow: customer-create → admin review/approve → push to DispatchTrack → webhook ingest of DT events → status sync → mark Collected on payment.

| Layer | Files |
|---|---|
| Pages | `src/pages/Orders.tsx`, `src/pages/OrderPage.tsx` (entity detail with Details / Items / Completion / Activity tabs), `src/pages/PublicServiceRequest.tsx` (anon-only `#/public/service-request` — pricing-parity rebuild of the authenticated modal: coverage, add-ons, bill-to, estimated total) |
| Hooks | `src/hooks/useOrders.ts`, `src/hooks/useDeliveryZones.ts`, `src/hooks/useAvailabilityCalendar.ts` |
| Components | `src/components/shared/OrderDetailPanel.tsx`, `src/components/shared/CreateDeliveryOrderModal.tsx`, `src/components/shared/ReviewQueueTab.tsx`, `src/components/shared/CustomerVerificationPanel.tsx`, `src/components/shared/DtOrderReleasePanel.tsx` (inline release picker — first [MIGRATION-P2] SB-authoritative write path; Supabase-direct inventory.update + edge-function sheet mirror) |
| Edge Functions | `supabase/functions/dt-push-order/index.ts` v45 (push approved orders to DT API; v45 read-before-write merge of the `<description>` block via `_shared/dt-description-merge.ts`), `supabase/functions/dt-webhook-ingest/index.ts` v18 (receive DT webhook events, upsert orders, auto-mark Collected on paid; fires dt-sync-statuses for ALL Service_Route_Finished events incl. pickups), `supabase/functions/dt-sync-statuses/index.ts` v13 (pull export.xml per active order; mirrors driver/truck/timing/items/history/notes back; end-of-loop fires release-on-dt-finished for delivery orders + stamp-pickup-on-linked-delivery for pickups; fires dt-push-order after PU→Delivery item-sync propagation), `supabase/functions/dt-backfill-orders/index.ts` (bulk historical import), `supabase/functions/notify-new-order/index.ts` (email notification on new order — ORDER_REVIEW_REQUEST template), `supabase/functions/notify-order-revision/index.ts` (email on reject/revision-request — ORDER_REJECTED + ORDER_REVISION_REQUESTED templates), `supabase/functions/notify-public-request/index.ts` (anon `#/public/service-request` confirmation + internal alert), `supabase/functions/notify-pickup-completed/index.ts` v3 (real-time PICKUP_COMPLETED email + invokes stamp-pickup-on-linked-delivery for P+D pickups), `supabase/functions/push-inventory-release-to-sheet/index.ts` (SB→Sheet mirror for DT order release), `supabase/functions/_shared/release-on-dt-finished.ts` (shared auto-release helper for delivery completion), `supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts` (two-tier shared helper for PU→Delivery propagation: Tier A order-level stamps + picked_up_at, Tier B per-item field propagation via parent_pickup_item_id FK match; blanket pass skips `inventory_id`-set warehouse items so a P+D pickup-leg completion no longer stamps warehouse inventory as picked up — PR #741), `supabase/functions/_shared/dt-description-merge.ts` (v45 read-before-write merge for the DT `<description>` block: `fetchDtOrderDescription` reads DT's current Order-Details via the export.xml API, `mergeStrideAppSection` replaces only the `--- STRIDE APP (ts) --- … --- END STRIDE APP ---` section + preserves dispatcher text outside it; foundational infra for COD-storage) |
| Migrations | `20260411120000_dt_phase1a_schema.sql` (dt_orders, dt_order_items, dt_order_history, dt_credentials), `20260415000000_dt_phase1c_webhook_prep.sql` (dt_webhook_events, dt_orders_quarantine), `20260415180000_delivery_availability.sql`, `20260417000000_delivery_pricing_schema.sql`, `20260420100000_delivery_zones.sql`, `20260420120000_delivery_order_types_and_role_gates.sql`, `20260420140000_dt_orders_insert_update_rls.sql`, `20260424180000_dt_address_book.sql`, `20260425000537_service_time_and_billing_review.sql`, `20260425230000_dt_sync_back_fields.sql`, `20260426220000_dt_orders_public_form_anon_insert.sql`, `20260512120000_dt_orders_bill_to_columns.sql`, `20260512230000_dt_order_items_inventory_id_backfill.sql` (PR #367 — backfills dt_order_items.inventory_id from (tenant_id, dt_item_code) linkage + self-healing trigger), `20260513120000_dt_pickup_linkage_propagation.sql` (PR #388 — dt_orders.linked_pickup_finished_at + linked_pickup_driver_name + dt_order_items.picked_up_at), `20260513140000_dt_order_items_parent_pickup_fk.sql` (PR #389 — dt_order_items.parent_pickup_item_id self-referential FK + description-match backfill), `20260513140100_dt_order_items_parent_pickup_fk_fungible_backfill.sql` (PR #389 — top-up backfill for fungible-items P+D pairs), `20260513150000_dt_order_items_pickup_audit_columns.sql` (PR #389 — pickup_item_note + pickup_return_codes + pickup_delivered_quantity audit columns), `20260519000000_dt_order_items_dedupe_unique_index.sql` (PR #462 — soft-removes existing non-adhoc dup lines + partial UNIQUE INDEX `dt_order_items_order_code_active_uniq` on (dt_order_id, dt_item_code) WHERE dt_item_code IS NOT NULL AND removed_at IS NULL; structural backstop for the ALL-00097 double-insert), `20260519130000_dt_orders_taxable_subtotal.sql` (fix/billing/do-modal-taxable-services — adds nullable `dt_orders.taxable_subtotal numeric(10,2)`; audit snapshot of the base sales tax was applied to now that the DO modal taxes only `service_catalog.taxable=true` accessorials, not the whole subtotal) |
| Lib | `src/lib/deepLinks.ts` (DT order deep links for emails), `src/lib/supabaseQueries.ts` (`fetchDtOrderHistory`, `fetchDtOrderNotes` for the OrderPage Completion tab) |

---

## COD Storage (end customers pay storage)

Feature-gated to the Justin Demo tenant via the `codStorageBilling` feature flag (UI gate only — resolved against the DATA tenant via `useFeatureFlagRow` + `resolveFlagBackend`). Designer flags items so the end customer pays storage from a start date; the designer's storage report is capped at that date, and the remaining storage is collected on the delivery order.

| Layer | Files |
|---|---|
| Lib | `src/lib/codStorage.ts` (RPC callers `setCodStorage`/`markCodStorageCollected`, calc `computeCodStorageLine`/`recomputeCodLineFromDetails`/`serializeCodDetails`, `CodStorageDetail` type, `COD_STORAGE_DEFAULT_RATE`=0.05, `todayIso`) |
| Components | `src/components/shared/SetCodStorageModal.tsx` (Inventory batch set/remove), `src/components/shared/ItemCodStorageSection.tsx` (Item Detail toggle+date), `src/components/shared/OrderCodStorageCard.tsx` (OrderPage line: **EF-driven** — calls `collect-cod-storage-sb` dry-run for the live per-item breakdown (item·class·cu ft·from·days·amount) + editable cutoff/rate/include checkbox; **appears automatically whenever the order carries COD-flagged items**, regardless of how the order is billed (client-paid deliveries included); "Save" persists the `cod_storage_*` summary to dt_orders for the DT description push, "Collect COD Storage" runs the EF commit = real Unbilled `COD_STOR` billing rows + advance dates + audit + writethrough, then stamps `cod_storage_collected_*`; server-side dedup so the standalone + delivery paths never double-collect a day. Old `mark_cod_storage_collected` RPC path removed — it never created billing rows — `feat/delivery/cod-storage-on-order`), `src/components/shared/CollectCodStorageModal.tsx` (**standalone "Collect COD Storage" invoicing modal** — cutoff/rate/notes + EF dry-run preview breakdown + dedup warning + Create Invoice) |
| Standalone invoicing | **`supabase/functions/collect-cod-storage-sb/index.ts`** (authoritative compute path — service-role; `dryRun` returns the per-item preview, commit inserts Unbilled `svc_code='COD_STOR'` billing rows with deterministic `ledger_row_id` `COD-STOR-<item>-<start>-<end>`, records `storage_billing_items` status `'COD Collected'`, advances `inventory.cod_storage_start_date` to cutoff+1, writes `entity_audit_log`, reverse-writethroughs the billing row to the sheet). Day-set dedup subtracts already-collected ranges; sbi write is select-then-insert/update because `uq_sbi_active_item_period` is a PARTIAL index (not a PostgREST onConflict target). `src/lib/codStorage.ts` adds `previewCodCollection`/`collectCodStorage` (EF callers), `fetchCollectedCodRanges`/`uncollectedInWindow` (delivery add-on dedup), `CodCollectionItem`/`CodCollectionResult`/`CollectedRange` types. Wired into `src/pages/Inventory.tsx` ("Collect COD" batch button, admin/staff + flag-gated). |
| Wired into | `src/pages/Inventory.tsx` (batch "COD" button + modal), `src/components/shared/ItemDetailPanel.tsx` (Details tab section), `src/components/shared/OnboardClientModal.tsx` + `src/pages/Settings.tsx` (client "End customers pay storage" toggle, Supabase-only), `src/components/shared/CreateDeliveryOrderModal.tsx` (auto-seed line on create), `src/pages/OrderPage.tsx` (card), `src/lib/supabaseQueries.ts` (inventory + dt_orders + clients mappings), `src/lib/types.ts` / `src/lib/api.ts` (types). The amber "$" item-ID badge lives in `src/components/shared/ItemIdBadges.tsx` (state 'cod'), fed by `codItems` in `src/hooks/useItemIndicators.ts` (queries `inventory.cod_storage=true`) and wired at every `<ItemIdBadges>` call site (Inventory/Tasks/Repairs/Dashboard/**OrderPage** + Item/Shipment/Repair/Task/WillCall detail panels). **PR #681 (2026-06-09):** `useItemIndicators` is now the SINGLE SOURCE OF TRUTH for all six badge types (I/A/R/W/D/$) — it gained DT delivery (D) logic (`dtOpenItems`/`dtDoneItems`, from `dt_orders`+`dt_statuses`, mirroring `fetchDtOrdersFromSupabase`); Inventory's old parallel derivation was reduced to a thin optimistic overlay unioned into the hook; `OrderPage` `DetailsTab` now renders badges next to each delivery line (`itemId={item.dtItemCode}`) |
| RPCs | `set_cod_storage(tenant, item_ids[], enabled, start_date)` (admin/staff SECURITY DEFINER inventory write — bypasses the missing inventory UPDATE policy; also writes an entity_audit_log row per item, 2026-06-08), `mark_cod_storage_collected(order_id, notes, by)` (Phase 6 collection record), `_compute_storage_charges` (P3 COD cap; #589 dedup + `storage_credits` + transfer-fix restored 2026-06-08 after `20260605170100` had reverted them), `apply_cod_storage_on_receive()` trigger fn |
| Edge Functions | `supabase/functions/dt-push-order/index.ts` v46 (COD STORAGE summary block in the STRIDE APP section) |
| Migrations | `20260605170000_cod_storage_p1_data_model.sql` (inventory/clients cols + parity mirror + flag + receive trigger), `20260605170100_cod_storage_p3_storage_filter.sql` (`_compute_storage_charges` COD cap), `20260605170200_cod_storage_p4_p6_delivery.sql` (dt_orders COD cols + `mark_cod_storage_collected`), `20260605170300_cod_storage_set_rpc.sql` (`set_cod_storage`), `20260608170000_cod_storage_audit_in_set_rpc.sql` (`set_cod_storage` also writes an entity_audit_log row per updated item so COD set/remove shows in the Activity tab — the browser-side INSERT is RLS-blocked), `20260608180000_compute_storage_charges_restore_589_plus_cod.sql` (restored `_compute_storage_charges` #589 dedup + `storage_credits` + cross-tenant transfer-fix that `20260605170100` silently reverted, while keeping the COD cap) |

---

## Billing

Billing ledger, service catalog, activity log, insurance auto-billing. React reads only — all writes go through Apps Script (Consolidated Billing). (The old MPL-vs-Supabase Rate Parity tab was removed 2026-05-17 — superseded by the Migration Dashboard at `#/migration`.)

| Layer | Files |
|---|---|
| Pages | `src/pages/Billing.tsx`, `src/pages/PriceList.tsx`, `src/pages/PublicRates.tsx`, `src/pages/ParityDashboard.tsx` (admin/staff `#/migration` — GAS→Supabase shadow-testing observation surface: per-function rollup from `parity_summary`, expandable last-10 `parity_results`, billing-shadow feed from `parity_billing_shadow`; auto-refresh 30s) |
| Hooks | `src/hooks/useBilling.ts`, `src/hooks/useBillingActivity.ts`, `src/hooks/useServiceCatalog.ts`, `src/hooks/usePricing.ts`, `src/hooks/useItemClasses.ts`, `src/hooks/usePaymentTerms.ts`, `src/hooks/useClientInsurance.ts`, `src/hooks/useCoverageOptions.ts`, `src/hooks/usePriceListShares.ts`, `src/hooks/useDefaultTaxRate.ts` (system default sales-tax rate from `tax_jurisdictions` is_default row; fail-soft 10.4 fallback; consumed by CreateDeliveryOrderModal + PublicServiceRequest) |
| Tax jurisdictions | `src/components/shared/TaxJurisdictionsPanel.tsx` (admin CRUD table — rendered in Settings → Pricing under PriceList), `tax_jurisdictions` query helpers in `src/lib/supabaseQueries.ts` (fetch/fetchDefault/create/update/delete/setDefault + `TaxJurisdiction` type), per-client `tax_rate_pct` override editor in `OnboardClientModal.tsx` `TaxExemptBlock` |
| Components | `src/components/shared/BillingDetailPanel.tsx` |
| Migrations | `20260419064058_service_catalog.sql` (service_catalog table), `20260419120000_billing_reference_column.sql` (ledger refs), `20260419000000_price_list_shares.sql` (shareable price lists), `20260420110000_billing_parity_log.sql` (parity log table), `20260420110000_billing_parity_trigger.sql` (auto-record parity discrepancies), `20260420160000_insurance_auto_billing_phase1.sql` (auto-bill by coverage), `20260420160001_insurance_auto_billing_cron.sql` (scheduled auto-billing), `20260423210000_billing_activity_log.sql` (ledger change audit), `20260424190000_service_catalog_external_ids.sql` (Stax/QBO IDs on service_catalog), `20260516000000_parity_dashboard_views.sql` (`parity_summary` + `parity_billing_shadow` read views — security_invoker, admin/staff-gated, power `ParityDashboard.tsx`), `20260425010000_fix_insurance_cron_skip.sql` (row_count guard — advance next_billing_date only on real insert), `20260501000000_insurance_rate_per_10k.sql` (rate granularity $300/$100K → $30/$10K), `20260604190000_insurance_billing_proration.sql` (**insurance proration** — first-month / cancellation / mid-period coverage-change day-for-day proration in `insurance_bill_due()`; adds `coverage_changes` audit table + `log_coverage_change` trigger + `final_billed_at` col + `_insurance_charge_for_period` helper; switches dedup tag YYYYMM→YYYYMMDD; captures the live index-inference `ON CONFLICT` form as git source of truth) |
| Insurance billing | `src/hooks/useClientInsurance.ts` (CRUD + realtime for one tenant's `client_insurance` row, billing history, **pending coverage_changes**; seed anchors first `next_billing_date` to 1st of next month for first-month proration), `src/lib/insuranceBilling.ts` (`firstBillingAnchor`), `src/components/shared/OnboardClientModal.tsx` → `InsuranceBlock` (declared-value editor, proration disclaimer, pending-change list, billing history). Daily Postgres cron `insurance_bill_due()` (08:00 UTC, pg_cron `insurance-auto-billing`) is the sole writer of `svc_code='INSURANCE'` billing rows. Seed sites that anchor the first bill: `useClientInsurance.seed`, `useIntakeAdmin.seedClientInsuranceFromIntake`, `IntakesPanel.tsx`, EF `supabase/functions/apply-intake-on-submit/index.ts` (inline `firstBillingAnchor` copy — keep in sync). |
| Apps Script | `AppScripts/stride-client-inventory/src/Billing.gs` (per-client ledger ops, storage billing), `AppScripts/Consolidated Billing Sheet/Code.gs.js` (consolidated ledger, invoice mgmt), `AppScripts/Consolidated Billing Sheet/CB13_Preview_Core.js` (invoice generation preview), `AppScripts/Consolidated Billing Sheet/CB13 Unbilled Reports.js` (unbilled rollup), `AppScripts/Consolidated Billing Sheet/CB13 Config.js`, `AppScripts/Consolidated Billing Sheet/CB13 Schema Migration.js`, `AppScripts/Consolidated Billing Sheet/Invoice Commit.js` (invoice finalization), `AppScripts/Consolidated Billing Sheet/Billing Logs.js`, `AppScripts/Consolidated Billing Sheet/QB_Export.js` (QuickBooks IIF export), `AppScripts/stride-api/StrideAPI.gs` → `handleVoidInvoice_` + `case 'voidInvoice'` (sets every Billing_Ledger row matching invoiceNo to Void; backs the Invoice Review tab's per-invoice Void button), `AppScripts/stride-api/StrideAPI.gs` → `reconcileCbFromBilling_(invoiceNos)` (v38.222.0 — reads `public.billing` and brings CB Consolidated_Ledger into agreement before reads; auto-called from `handleQboCreateInvoice_` to prevent silent-drop on drifted CB rows; transitional bridge until P4b retires CB) |
| Invoice Review | `src/pages/Billing.tsx` → `InvoiceReviewTab` + `InvoiceReviewLineItems` (Supabase-only read, group by `invoice_no`, search/filter/sort/expand, optimistic Void); `postVoidInvoice` in `src/lib/api.ts` |
| Client Invoice Portal (2026-06-04) | Client-facing `#/invoices` list of a client's own invoices (RLS-scoped to their tenant(s)). **Pages:** `src/pages/Invoices.tsx` (list — invoice #, date, total, paid/unpaid status; sort by date, filter by status; per-row View/Download that mints an RLS-scoped signed URL from `invoice_tracking.pdf_path`, falling back to the printable `#/invoices/:invoiceNo` route; admin-only "Backfill PDFs" bar). **Hook:** `src/hooks/useInvoices.ts` (reads `invoice_tracking`, local realtime channel). **Lib:** `src/lib/invoicePdf.ts` → `invoiceStoragePath()` + `patchInvoiceTrackingPdf()` (records the archived PDF's storage path on the invoice row; called from `Billing.tsx` post-create); `src/lib/invoiceBackfill.ts` (admin browser-side backfill — regenerates+uploads PDFs for historical invoices missing `pdf_path`, read-only on money). **Nav/route:** client-only "Invoices" item in `Sidebar.tsx` `CLIENT_NAV`; `/invoices` route in `App.tsx` gated `['admin','client']`. **Migration:** `20260604120000_invoice_tracking_pdf_path_and_client_rls.sql` (`invoice_tracking.pdf_path` col + `invoice_tracking_client_select` client RLS via `user_has_tenant_access` + `REPLICA IDENTITY FULL`). PDFs live in the `invoices` bucket (`20260503180000_invoices_bucket.sql`; client read-own-tenant RLS already in `20260504210000`). |
| Storage charges | `src/pages/Billing.tsx` → Storage tab — Unbilled/Invoiced View toggle (2026-06-01): **Unbilled** = live projection via `calculate_storage_charges` RPC; **Invoiced** = read-only itemized view from `storage_billing_items` with per-item **billable days** (`invoicedStorageDays()` derives from amount/rate when the stored value is null) + a dedicated client-proof **`.xlsx`** export (`src/lib/exportExcel.ts` `downloadRowsAsExcel`, SheetJS — the same helper powers the Billing-report + Storage-preview exports; the toolbar "Export xlsx" button emits a real workbook, not CSV). `src/lib/supabaseQueries.ts` → `fetchStoragePreviewFromSupabase` (unbilled), `fetchInvoicedStorageItems` (invoiced itemized), `generateStorageChargesViaSupabase`. SB engine `_compute_storage_charges` (per-item projection; `v_billed` dedup subtracts finalized per-item STOR + `storage_billing_items` + sidemark-matched `STOR-SUMMARY` periods + `storage_credits` + unbilled `STOR-TRANSFER-*` backfill) → wrapped by `calculate_storage_charges` (preview) and `generate_storage_charges` (writes the Unbilled STOR-SUMMARY). GAS commit `handleCommitStorageRows_` collapses per-item → one `STOR-SUMMARY` per sidemark, double-gated against re-bill (lockedSidemarks + `storage_billing_items` sbiAlreadyBilled); persists per-item `billable_days` (preview qty, else round(amount/rate)). Migrations: `20260530160000_storage_billing_items.sql` (per-item billed tracker), `20260601120000_storage_preview_dedup_summary_transfer.sql` (preview sees through the STOR-SUMMARY collapse + transfer-backfill harden), `20260603120000_backfill_storage_billable_days.sql` (backfill billable_days = round(amount/rate)), `20260608238000_generate_storage_charges_sbi_sidemark_parity.sql` (**Part A** — `generate_storage_charges` recompute RPC now writes per-item sbi + sidemark-slug summaries; dormant, no live caller), `20260609000000_commit_storage_rows_sb_native.sql` (**Part B** — `commit_storage_rows(jsonb,date,date,text)`, the SB-native edited-rows commit). **UPDATE 2026-06-09 — SB commit LIVE on the canary:** `commit-storage-charges-sb` COMMIT branch (`rows[]`) rewired off `gasProxy` → `commit_storage_rows` RPC (writes per-item sbi + sidemark-aware summaries, finalized-summary fence #671/#672, STOR-TRANSFER protection, **precise-remainder** — bills the partial remainder GAS's `sbiAlreadyBilled` skip drops) + Billing_Ledger sheet mirror (`writeThroughReverse op=insert`). Flag `commitStorageCharges`=supabase, canary-scoped (Justin Demo); all other tenants still GAS `handleCommitStorageRows_`. The prior "SB path doesn't write sbi" blocker is **RESOLVED**. Fleet rollout pending a reverse-`op=delete` + monitoring. |
| Unified Addons (v38.177.0) | `stride-gs-app/supabase/migrations/20260504170000_unified_addons.sql` (polymorphic `public.addons` table, drops empty `task_addons`); `src/hooks/useEntityAddons.ts` (CRUD + realtime keyed on `parent_type`/`parent_id`); `src/hooks/useTaskAddons.ts` (compat alias); `src/components/shared/AddTaskServiceModal.tsx` (parentType-aware filter + title); `src/components/shared/BillingPreviewCard.tsx` (lifted task-only restrictions, broadened recorded query for repair/wc); `AppScripts/stride-api/StrideAPI.gs` → `api_writeAddonsToLedger_` (one helper used by `handleCompleteTask_` / `handleCompleteRepair_` / `handleProcessWcRelease_`) |

---

## Payments / Stax

Stax payment integration: invoicing, charging, auto-pay, catalog sync. React reads Stax cache; Apps Script writes via Stax API.

| Layer | Files |
|---|---|
| Pages | `src/pages/Payments.tsx` |
| Hooks | `src/hooks/usePaymentTerms.ts`, `src/hooks/useQBO.ts` |
| Components | `src/components/shared/PaymentDetailPanel.tsx`, `src/components/shared/PreChargeValidationModal.tsx` |
| Edge Functions | `supabase/functions/stax-catalog-sync/index.ts` (sync service_catalog → Stax items); `supabase/functions/create-test-stax-invoice/index.ts` (**100% Supabase, no GAS** — test-invoice proving ground: admin/staff gate per MIG-017, resolves/creates the Stax customer id, inserts a `public.stax_invoices` is_test/PENDING row, optionally POSTs to Stax immediately; invoked DIRECTLY from `Payments.tsx` via `supabase.functions.invoke`, NOT through apiPost/feature-flag routing); `supabase/functions/create-stax-invoices-sb/index.ts` (batch push of PENDING rows — still pushes test rows not auto-pushed at creation) |
| Create Stax Charge (SB-direct) | General-purpose one-off Stax charge tool (any client, any amount, user-set due date + notes + auto-charge toggle; `is_test=true` to distinguish from batch IIF invoices). `src/lib/api.ts` → `invokeCreateTestStaxInvoice` + `CreateTestStaxInvoiceResult`; `src/pages/Payments.tsx` → "Create Stax Charge" modal (calls the EF directly; client picker = ALL active clients via `allClientOptions`; Auto Charge + Notes fields; "Push to Stax now" toggle) + `loadData` GAS/noCache path merges SB-only `stax_invoices` rows so a hard refresh never drops them. `createTestInvoice` removed from `apiRouter.ts` `GROUPED_STAX_ACTIONS` + `stax-actions-sb` (GAS `handleCreateTestInvoice_` is now legacy/unused). **Chargeability bridge:** the EF best-effort `gasProxy('staxSheetUpsert', …)` mirrors its row into the GAS Stax "Invoices" sheet (`handleStaxSheetUpsert_`, StrideAPI v38.264.0 — idempotent, header-resolved, token-gated, sheet-only no SB re-mirror; writes explicit `"FALSE"` for manual auto_charge so the daily runner skips it) so the still-GAS charge path (`handleChargeSingleInvoice_`) + the daily auto-pay runner (`StaxAutoPay.gs`) see it (MIG-002; retires when runStaxCharges migrates to SB). |
| Migrations | `20260416120000_stax_invoices_cache_table.sql` (stax_invoices cache), `20260416120001_stax_charges_exceptions_customers_runlog_cache.sql` (charges/exceptions/customers/runlog cache) |
| Apps Script | `AppScripts/stax-auto-pay/StaxAutoPay.gs` (auto-pay charge creation + retry) |

---

## Inventory

Item list with inline editing, full-page item detail, scanner, label printing.

| Layer | Files |
|---|---|
| Pages | `src/pages/Inventory.tsx` (PR #674 — phone-usable table: full-width/taller layout, inline status dropdown, fixed column resize + reorder-via-menu), `src/pages/ItemPage.tsx`, `src/pages/Scanner.tsx`, `src/pages/Labels.tsx` |
| Hooks | `src/hooks/useInventory.ts`, `src/hooks/useItemDetail.ts`, `src/hooks/useItemIndicators.ts`, `src/hooks/useItemNotes.ts`, `src/hooks/useItemClasses.ts`, `src/hooks/useLocations.ts` |
| Components | `src/components/shared/ItemDetailPanel.tsx`, `src/components/shared/ItemIdBadges.tsx`, `src/components/shared/InlineEditableCell.tsx`, `src/components/shared/StorageCreditModal.tsx` (admin: grant a free-storage window on selected items — writes `storage_credits` + `entity_audit_log`), `src/components/shared/StorageCreditsSection.tsx` (item detail Activity tab: lists active credits, admin Remove = soft-delete) |
| Migrations | `20260414180000_item_id_ledger.sql` (item ID hash ledger), `20260416180000_add_inventory_url_columns.sql` (item photo/folder URL columns), `20260415200000_locations_and_move_history.sql` (locations + move_history), `20260422010000_inventory_mirror_drift_tier1.sql` (drift detection), `20260422020000_stage_a_mirror_drift.sql` (staging mirror), `20260422000000_entity_notes_item_id.sql` (item notes by item_id), `inventory_live_view_and_transfer_provenance` (`inventory_live` view excluding `status='Transferred'` + `transferred_from_tenant_id` + `transferred_at` columns), `photos_storage_rls_via_item_photos_tenant` (storage RLS row-based fallback so transferred photos remain readable to new owner without moving objects), `backfill_transferred_item_aux_tables` (migrated entity_notes / item_photos / provenance for 31 historical transfer pairs), `20260517000000_storage_credits_skip_in_charges.sql` (storage_credits table + RLS [read admin/staff, write admin] + `_compute_storage_charges` subtracts active credit ranges so credited days never invoice) |
| Apps Script | `AppScripts/stride-client-inventory/src/Code.gs` (main inventory CRUD), `AppScripts/stride-client-inventory/src/Import.gs` (item import/sync), `AppScripts/stride-client-inventory/src/AutocompleteDB.gs` (item name autocomplete cache), `AppScripts/QR Scanner/ScannerBackend.updated.gs` (legacy scanner backend), `AppScripts/stride-api/StrideAPI.gs` → `api_postTransferSupabaseSideEffects_` (post-transfer migration of entity_notes + item_photos + open will_calls; stamps transfer provenance on dest inventory row) + `supabasePatch_` / `supabaseSelect_` helpers |
| Lib | `src/lib/parseScanPayload.ts`, `src/lib/scanAudioFeedback.ts`, `src/lib/supabaseQueries.ts` → `fetchItemByIdFromSupabase` (reads from `inventory_live` view + optional tenantScope) |

---

## Tasks

Operational tasks (Inspect, Assemble, Move, etc.) per inventory item.

| Layer | Files |
|---|---|
| Pages | `src/pages/Tasks.tsx`, `src/pages/TaskPage.tsx`, `src/pages/TaskJobPage.tsx` (legacy) |
| Hooks | `src/hooks/useTasks.ts`, `src/hooks/useTaskDetail.ts` |
| Components | `src/components/shared/TaskDetailPanel.tsx`, `src/components/shared/CreateTaskModal.tsx` |
| Migrations | `20260420000000_tasks_due_date_priority.sql` (due_date + priority columns), `20260610120100_complete_task_atomic_insp_rush_qty.sql` (per-piece billing — `complete_task_atomic` multiplies `tasks.qty` for INSP **and** RUSH, else 1; extends the INSP-only `20260609160200`), `20260610120000_backfill_rush_task_qty.sql` (seed open RUSH tasks' qty from inventory.qty), `20260610130000_complete_task_atomic_resolve_svc_by_name.sql` (resolve svc by code OR name + gate qty on resolved code, so RUSH/INSP price + multiply whether `tasks.type` is the code or the service name) |
| Apps Script | `AppScripts/stride-client-inventory/src/Tasks.gs` (task CRUD + completion) |

---

## Repairs

Repair quotes → approve/decline → execute → bill. Supports multi-item jobs (PR #397) — one repair can carry N items via `repair_items`, one quote/status/billing event at the parent level. Mid-flight item edits via re-quote (PR #420). **GAS→Supabase migration cluster (P3+P4a) complete**: 6 of 6 handlers SB-primary (PRs #405-#408, #418, #419). Re-quote flow shipped 2026-05-14 (PR #420). See `MIGRATION_STATUS.md` for the per-handler state machine and MIG-013 for the cluster's Path-C decision.

| Layer | Files |
|---|---|
| Pages | `src/pages/Repairs.tsx`, `src/pages/RepairPage.tsx`, `src/pages/RepairJobPage.tsx` (legacy) |
| Hooks | `src/hooks/useRepairs.ts`, `src/hooks/useRepairDetail.ts` (skips GAS enrichment when `items.length > 1` so multi-item description stays correct) |
| Components | `src/components/shared/RepairDetailPanel.tsx` — items table when `items.length > 1`; lifecycle buttons (`Cancel`, `Start`, `Send Quote`, `Approve/Decline`, `Complete`) route GAS vs SB via `useFeatureFlag('cancelRepair' \| 'startRepair' \| 'sendRepairEmails' \| 'completeRepair' \| 'requestRepairQuote')`; new "Edit Items" button (Pending Quote / Quote Sent only) opens `ReQuoteRepairModal` |
| Components | `src/components/shared/ReQuoteRepairModal.tsx` — inventory picker + per-item remove buttons; calls `postReQuoteRepair`; resets status to Pending Quote on success so staff can re-issue the quote |
| BatchWorkItems (shared module, repairs + tasks) | `src/components/shared/BatchWorkItems.tsx` (per-item cards: Start/Pass/Fail + notes + photo strip + "N of M complete" header), `src/hooks/useBatchWorkItems.ts` (repair_items/task_items + inventory overlay + realtime + `update_batch_work_item` RPC writes + photo grouping), `src/hooks/useBatchItemMap.ts` (Repairs/Tasks list "N items" column), migration `20260611120000_batch_work_items.sql` (repair_items status cols + NEW `public.task_items` + RPC + `batchWorkItems` flag seed — UI behavior gate, Justin Demo canary). Wired flag-gated into `RepairDetailPanel.tsx` + `TaskDetailPanel.tsx` (auto-start parent on first item, auto-complete via existing flows on last item, manual Pass/Fail gated until all items resolved). `usePhotos.uploadPhoto` override accepts per-call `itemId` so batch uploads tag photos to both the item and the batch entity. |
| Work Order PDF (`DOC_REPAIR_WORK_ORDER`) ⚠️ | Rendered by **6 paths across 2 template stores — keep in sync when changing the items table.** **Supabase `email_templates`:** `src/lib/docTokens.ts` `buildRepairTokens` (React Print → `docRenderer.ts`); `StrideAPI.gs` `handleStartRepair_` + `handleRespondToRepairQuote_`. **MPL `Email_Templates` sheet:** `AppScripts/stride-client-inventory/src/Triggers.gs` `SH_generateRepairWorkOrderPdf_` (in-sheet onEdit approval) + `Repairs.gs` `generateRepairWorkOrderPdf_`; standalone `AppScripts/task board script.txt` `SH_generateRepairWorkOrderPdf_` (deployed via `npm run push-taskboard`). Plus 3 hardcoded fallbacks (Triggers `SH_getDefaultRepairWorkOrderHtml_`, Emails `getDefaultDocHtml_`, task-board copy). Sheet-template source = `Doc Templates/DOC_REPAIR_WORK_ORDER.txt` (pushed via `push-templates`). **Adding/removing a column = touch all 6 token maps + 3 fallbacks + BOTH template stores; deploy all renderers BEFORE the template change or a literal `{{TOKEN}}` renders.** PR #608 added the Location column this way. **Multi-item (fix/repairs/work-order-all-items, 2026-06-04):** the Supabase template's items table now renders one row per item via a single `{{ITEM_ROWS}}` token (was a hardcoded single `<tr>` → multi-item repairs only printed the primary item). `buildRepairTokens` builds `{{ITEM_ROWS}}` from `repair.items[]` via `repairItemRowHtml()` (legacy single `{{ITEM_*}}` tokens still emitted for deploy-order safety); migration `20260604120000_repair_work_order_multi_item_rows.sql` swaps the row. The two GAS Supabase-template renderers (`handleStartRepair_`/`handleRespondToRepairQuote_`) are commented out (PR #507), so only React was updated; the **MPL sheet store + its 3 renderers/fallbacks remain single-item** (not yet wired for multi-item — separate change if needed). |
| Doc PDF render engine (cross-cutting; auto-archive + download) | `src/lib/docRenderer.ts` `renderHtmlToPdfBlob` → **`supabase/functions/render-doc-pdf/index.ts`** (Cloudflare Browser Rendering `/pdf` = real headless Chrome). PR #686 replaced the blank-prone client-side html2canvas/html2pdf.js path (322 blank auto-archived docs). CF API token in the **service-role-only `public.app_config`** table (migration `20260609170000`; RLS on, no policies). `verify_jwt=true`. The `print` action stays browser-native; `download`/`upload` go through the EF. Applies to ALL doc types (DOC_RECEIVING / DOC_TASK_WORK_ORDER / DOC_REPAIR_WORK_ORDER / DOC_WILL_CALL_RELEASE). |
| Edge Functions (multi-item + single-item create) | `supabase/functions/request-repair-quote-sb/index.ts` v5 — SB-authoritative create via RPC + REPAIR_QUOTE_REQUEST email; accepts optional `sourceTaskId` for the single-item path from TaskDetailPanel (PR #418); after RPC fires `op='insert'` reverse-writethrough so the new repair lands on the per-tenant Repairs sheet immediately (PR #432) |
| Edge Functions (P3 cluster — cancelRepair) | `supabase/functions/cancel-repair-shadow/index.ts` v1 (pure parity shadow), `supabase/functions/cancel-repair-sb/index.ts` v1 (SB-primary: status flip + audit + reverse writethrough) |
| Edge Functions (P3 cluster — startRepair) | `supabase/functions/start-repair-shadow/index.ts` v1, `supabase/functions/start-repair-sb/index.ts` v1 (status flip + start_date stamp + Approved/In Progress/Complete re-run rules) |
| Edge Functions (P3 cluster — sendRepairQuote) | `supabase/functions/send-repair-quote-shadow/index.ts` v1, `supabase/functions/send-repair-quote-sb/index.ts` v1 (server-recomputed totals, 11-column update, REPAIR_QUOTE email via Resend, idempotent re-send) |
| Edge Functions (P3 cluster — respondToRepairQuote) | `supabase/functions/respond-repair-quote-shadow/index.ts` v1, `supabase/functions/respond-repair-quote-sb/index.ts` v1 (Approve/Decline branching, REPAIR_APPROVED / REPAIR_DECLINED email) |
| Edge Functions (P3 cluster — requestRepairQuote single-item shadow) | `supabase/functions/request-repair-quote-shadow/index.ts` v1 (PR #418 — pure shadow returning `{summary: "Repair quote requested for items: [...]"}`) |
| Edge Functions (P4a — completeRepair) | `supabase/functions/complete-repair-shadow/index.ts` v1, `supabase/functions/complete-repair-sb/index.ts` v1 (PR #419 — calls `complete_repair_atomic` RPC, fires per-billing-row + repair-row reverse-writethrough, dispatches REPAIR_COMPLETE email) |
| Edge Functions (re-quote) | `supabase/functions/re-quote-repair/index.ts` v2 (PR #420 — explicit `user_metadata.role ∈ {admin,staff}` gate, calls `re_quote_repair` RPC, mirrors parent repair row to per-tenant sheet; per-tenant `Repair_Items` sheet not mirrored — same scope as multi-item create flow) |
| Email recipients | The four customer-facing repair templates (REPAIR_QUOTE / REPAIR_APPROVED / REPAIR_DECLINED / REPAIR_COMPLETE) carry `recipients = 'info@stridenw.com,{{CLIENT_EMAIL}}'`. The `{{CLIENT_EMAIL}}` recipient token resolves in `supabase/functions/send-email/index.ts` → **`clients.email`** (the app's "Notification Emails" field), comma/semicolon-split (fix/repairs/notification-emails-only, 2026-06-09). It used to read `clients.notification_contacts` first (the broad intake list) — changed so repairs hit only the curated Notification Emails list per Justin. `{{CLIENT_EMAIL}}` is a recipient token for the repair templates only. **Needs `supabase functions deploy send-email`.** |
| Migrations (P3+P4a+re-quote+FK) | `20260417020000_add_repair_date_columns.sql`, `20260513160000_repair_items_table.sql` (PR #397), `20260513170000_create_repair_quote_request_rpc.sql` (PR #397 — `next_repair_id` + `create_repair_quote_request`), `20260513180000_create_repair_quote_request_rpc_fix_ambiguous.sql` (PR #400 — renamed OUT `repair_id` → `new_repair_id` to dodge 42702), `20260513200000_seed_repair_p3_feature_flags.sql` (PR #405), `20260513210000_create_repair_quote_request_rpc_source_task_id.sql` (PR #418 — RPC accepts `p_source_task_id`), `20260514100000_complete_repair_atomic_rpc.sql` (PR #419 — `complete_repair_atomic` RPC + billing inserts + addons flush), `20260514110000_re_quote_repair_rpc.sql` (PR #420 — `re_quote_repair` RPC, OUT params prefixed `new_repair_id`/`result_*` from the start), `20260514120000_repair_items_cascade_fk.sql` (PR #430 — CASCADE FK on `repair_items → repairs` so manual parent deletes auto-remove children; prevents orphan-child class from recurring) |
| Apps Script | `AppScripts/stride-api/StrideAPI.gs` v38.221.0: `__writeThroughReverseRepairs_` writer + `REVERSE_REPAIR_FIELDS_` map (24 columns — status, all quote_*, dates, result, amounts, item_id, approved, **created_date, created_by, item_notes, task_notes, source_task_id** added in v38.221.0 for the insert path). `__writeThroughReverseBilling_` writer + 17-column `FIELD_MAP` (v38.217.0 for completeRepair P4a). Admin function `runBackfillSbOnlyRepairsToSheet(tenantIdArg?)` + Seva convenience wrapper for one-shot recovery. `api_fullClientSync_` no longer calls `supabaseDeleteStaleRows_` on the repairs entity (v38.220) — SB is now authoritative for the repairs lifecycle. Single-item GAS path still serves users where `feature_flags.{handler}.active_backend = 'gas'` (currently: none, all repair flags flipped to SB on 2026-05-14). |

---

## Will Calls

Customer pickup orders. Items can be released fully or partially, transferred, or held with COD.

| Layer | Files |
|---|---|
| Pages | `src/pages/WillCalls.tsx`, `src/pages/WillCallPage.tsx`, `src/pages/WillCallJobPage.tsx` (legacy) |
| Hooks | `src/hooks/useWillCalls.ts`, `src/hooks/useWillCallDetail.ts` |
| Components | `src/components/shared/WillCallDetailPanel.tsx`, `src/components/shared/CreateWillCallModal.tsx`, `src/components/shared/AddToWillCallModal.tsx`, `src/components/shared/ReleaseItemsModal.tsx`, `src/components/shared/TransferItemsModal.tsx` |
| Migrations | `20260413180000_add_cod_to_will_calls.sql` (COD flag), `20260417010000_add_wc_item_ids.sql` (will_call_items table) |
| Apps Script | `AppScripts/stride-client-inventory/src/WillCalls.gs` (WC scheduling, release/transfer), `AppScripts/stride-client-inventory/src/Transfer.gs` (cross-client item transfer) |

---

## Shipments

Inbound shipment receiving + shipment history per item.

| Layer | Files |
|---|---|
| Pages | `src/pages/Shipments.tsx`, `src/pages/ShipmentPage.tsx`, `src/pages/ShipmentJobPage.tsx` (legacy), `src/pages/Receiving.tsx` |
| Hooks | `src/hooks/useShipments.ts`, `src/hooks/useShipmentDetail.ts`, `src/hooks/useExpectedShipments.ts`, `src/hooks/useReceivingAddons.ts` |
| Components | `src/components/shared/ShipmentDetailPanel.tsx` |
| Migrations | `20260416200000_strip_shipment_ik_prefix.sql` (legacy ID cleanup), `20260418000000_expected_shipments.sql` (expected_shipments table) |
| Apps Script | `AppScripts/stride-client-inventory/src/Shipments.gs` (shipment creation, receipt, completion) |

---

## Claims

Damage/loss claims with photo evidence and payout tracking.

| Layer | Files |
|---|---|
| Pages | `src/pages/Claims.tsx` |
| Hooks | `src/hooks/useClaims.ts` |
| Components | `src/components/shared/ClaimDetailPanel.tsx`, `src/components/shared/CreateClaimModal.tsx` |
| Migrations | `20260415180000_claims_cache_table.sql` (claims cache mirror) |
| Apps Script | `AppScripts/Consolidated Billing Sheet/Claims.gs.js` (claim entry, payment tracking) |

---

## Messaging

iMessage-style conversations attached to entities, with email/SMS bridging.

| Layer | Files |
|---|---|
| Hooks | `src/hooks/useMessages.ts`, `src/hooks/useNotifications.ts` |
| Migrations | `20260419200000_media_messaging_infra.sql` (messages, message_recipients, photos), `20260420030000_message_recipients_sender_can_read.sql` (RLS), `20260422040000_conversations_model.sql` (conversations table) |
| Apps Script | `AppScripts/stride-client-inventory/src/Emails.gs` (outbound email composing + notifications) |

---

## Photos / Media

Per-entity photo galleries on every detail panel (item/task/repair/will-call/shipment/claim/dt_order), backed by `public.item_photos` + the private `photos` storage bucket. Cross-entity rollup so a panel shows photos from its graph neighbours.

| Layer | Files |
|---|---|
| Hooks | `src/hooks/usePhotos.ts` (CRUD + signed URLs + client-side thumbnail gen — `THUMB_MAX_EDGE=1000` since PR #664), `src/hooks/useGraphRollup.ts` (`usePhotoGraphRollup` cross-entity read), `src/hooks/usePhotoShares.ts` (anon share links) |
| Components | `src/components/media/PhotoGallery.tsx` (composes the lifecycle; rollup-mode mutations call `rollupHook.refetch()` — PR #606), `src/components/media/PhotoGrid.tsx`, `src/components/media/PhotoLightbox.tsx` (fullscreen viewer with cross-platform Pointer-Events **zoom/pan** — PR #664), `src/components/media/PhotoUploadButton.tsx`, `src/components/media/MultiCapture.tsx`, `src/components/shared/EntityAttachments.tsx` |
| Public | `src/pages/PublicPhotoGallery.tsx` (anon shared gallery) |
| Edge Functions | `supabase/functions/backfill-photo-thumbnails/index.ts` (one-shot 400→1000px thumbnail backfill; resizes via Supabase image-transform `storage.download({transform})`, writes over the same `thumbnail_key`, stamps `thumb_regen_at`; batched/resumable, driven by a self-terminating `backfill-photo-thumbs-drain` pg_cron job — PR #667/#669), `supabase/functions/get-shared-photos/index.ts` (share-gated anon proxy) |
| Migrations | `20260419200000_media_messaging_infra.sql` (item_photos table + RLS), `20260426120000_photo_shares.sql` + `20260426130000_photo_shares_narrow_anon_columns.sql` (share links), `20260608234500_item_photos_thumb_regen_marker.sql` (`thumb_regen_at` backfill progress marker + partial index — PR #667) |

---

## Client Onboarding

Client intake form → admin review → onboarding → T&C signing → first sheet provision.

| Layer | Files |
|---|---|
| Pages | `src/pages/ClientIntake.tsx` (public intake form), `src/pages/Intakes.tsx` (admin review list) |
| Hooks | `src/hooks/useClientIntake.ts`, `src/hooks/useIntakeAdmin.ts`, `src/hooks/useClientTcStatus.ts` |
| Components | `src/components/shared/OnboardClientModal.tsx`, `src/components/shared/IntakeEmailModal.tsx` |
| Migrations | `20260420120000_client_intake_system.sql` (client_intakes schema), `20260420120001_client_intake_storage_policies.sql` (storage RLS), `20260420120002_client_tc_template_seed.sql` (T&C template seed), `20260420130000_documents_client_context.sql` (client context for documents), `20260420140000_client_intakes_stride_coverage.sql` (coverage questionnaire), `20260420150000_coverage_options_anon_read.sql` (anon read for intake form), `20260420160000_client_intake_invite_template.sql` (invite email), `20260421170000_client_intakes_auto_inspect.sql` (auto-validation), `20260421220000_intake_submitted_notifications.sql` (notify on submit), `20260424080000_intake_submit_notification_trigger.sql` (in-app notification trigger), `20260424090000_intake_submitted_staff_emails_recipient.sql` (recipients = `{{STAFF_EMAILS}}`), `20260425200000_intake_notification_trigger_safe.sql` (EXCEPTION wrapper so notification failures never roll back the parent intake) |
| Apps Script | `AppScripts/Consolidated Billing Sheet/Client_Onboarding.js` (client sheet provision, config seed) |
| Lib | `src/lib/intakePdf.ts` (intake PDF generation) |

---

## Settings

App settings: API connection, email/doc templates, users, integrations, GAS→Supabase migration tab.

| Layer | Files |
|---|---|
| Pages | `src/pages/Settings.tsx` |
| Hooks | `src/hooks/useUsers.ts`, `src/hooks/useEmailTemplates.ts`, `src/hooks/useProfiles.ts`, `src/hooks/useSidebarOrder.ts` |
| Components | `src/components/shared/TemplateEditor.tsx`, `src/components/shared/ChangePasswordModal.tsx`, `src/components/shared/SetNewPassword.tsx`, `src/components/shared/MigrationSettingsTab.tsx` (admin-only Migration tab — per-flag backend toggle, parity toggle, tenant-scope editor, match-rate dashboard, master-switch emergency revert) |
| Contexts | `src/contexts/FeatureFlagContext.tsx` (app-level realtime-subscribed `feature_flags` resolver + module-level snapshot accessor for non-hook callers) |
| Lib | `src/lib/shadowRunner.ts` (background parity check — hashes both backends' results, writes `parity_results`, bumps lifetime counters), `src/lib/apiCall.ts` (`apiCall(key, gasFn, sbFn?, opts?)` routing wrapper — routes by flag, fires shadow when `parity_enabled` + `shadow_backend` are set), `src/lib/shadowRegistry.ts` (GAS apiPost action → flag + shadow EF + audit-shape derivation, central registry consulted by apiPost hook), `src/lib/fireShadow.ts` (fire-and-forget wrapper invoked from `apiPost` after every successful GAS call — derives synthesized audit shape, invokes shadow EF, hands both to runShadow) |
| Migrations | `20260415180100_users_cache_table.sql` (user/role cache), `20260419120000_email_templates.sql` (template storage), `20260420040000_doc_quote_template_seed.sql` (doc template seed), `20260420050000_doc_quote_match_invoice_style.sql`, `20260420060000_doc_invoice_line_items_html_token.sql`, `20260420070000_doc_quote_browser_printable_rebuild.sql`, `20260420090000_doc_quote_column_reorder.sql`, `20260422030000_email_templates_remove_photos_add_sidemark.sql`, `20260514170000_parity_infra_phase1_extend.sql` (Phase 1 parity infra — adds `total_checks` / `mismatch_count` / GENERATED `match_rate` to `feature_flags`, `input_summary` to `parity_results`, FK between them, authenticated INSERT for parity rows, realtime publication, seeds Justin's canonical 24 function_keys), `20260604160000_profiles_is_active_default_true.sql` (pins `public.profiles.is_active DEFAULT true` in git + heals NULL rows — companion to the createUser Active=TRUE default fix) |
| Apps Script | `AppScripts/stride-client-inventory/src/RemoteAdmin.gs` (user mgmt, settings sync), `AppScripts/stride-client-inventory/src/Triggers.gs` (per-client trigger setup) |
| Tax Rates (Pricing tab) | `src/components/shared/TaxJurisdictionsPanel.tsx` (admin-only, rendered under `<PriceList embedded />` when `isAdmin`) — see Billing/Pricing § |

---

## Search

Universal ⌘K search across all entities (inventory, tasks, repairs, will calls, shipments, claims).

| Layer | Files |
|---|---|
| Hooks | `src/hooks/useUniversalSearch.ts`, `src/hooks/useAutocomplete.ts` |
| Components | `src/components/shared/UniversalSearch.tsx`, `src/components/ui/SearchDropdown.tsx` |

---

## Auth / Roles

Login, role-based route guards, role-based sidebar nav. Three tiers: admin, staff, client.

| Layer | Files |
|---|---|
| Pages | `src/pages/Login.tsx`, `src/pages/AccessDenied.tsx` |
| Components | `src/components/layout/Sidebar.tsx` (role-filtered nav), `src/App.tsx` (`RoleGuard` route wrapper, defined inline) |
| Hooks | `src/hooks/useUsers.ts` (user/role lookups), `src/hooks/useProfiles.ts` |
| Lib | `src/lib/supabase.ts` (auth session), `src/contexts/AuthContext.tsx` (role/clientSheetId/accessibleClientSheetIds are served into the JWT `user_metadata` claim by the `custom_access_token_hook` from the service-role-only `app_metadata`; the login-time client-side `user_metadata` sync in `handleSession()` was REMOVED 2026-06-08 as the privilege-escalation vector — PR #661 — and GAS now stamps `app_metadata` going forward; admin "Impersonate" / "Exit" performs a real Supabase-session swap via `verifyOtp` → target JWT, then `setSession(adminTokens)` to swap back — its `updateUser({data})` is retained pending separate verification), `src/lib/impersonationSession.ts` (sessionStorage stash helpers + edge-function fetch wrappers for the real-session impersonation flow), `src/lib/userScopedStorage.ts` (`userScopedKey` + `migrateLegacyKey` — used by every list-view localStorage spot so admin/client view state never bleeds across identities on the same browser) |
| Impersonation audit | `supabase/functions/impersonate-mint-session/index.ts` (admin-only edge function — verifies admin role on the bearer JWT, looks up target in `cb_users`, inserts `impersonation_log` row, mints magic-link OTP via `supabase.auth.admin.generateLink`; `'end'` action stamps `ended_at` on the most-recent open row), `impersonation_log` table with admin/staff read-any + target-self read-only RLS (writes restricted to service_role via the edge function) |
| User prefs | `src/hooks/useTablePreferences.ts` (Supabase-backed table view persistence — column vis, sort, column order, status chips — load from `public.user_view_prefs`, fall back to localStorage cache on first paint, debounce 250ms upserts, read-only during impersonation), `src/lib/userViewPrefsClient.ts` (fetch / upsert / debounced scheduler / beforeunload flush) |
| Apps Script | `AppScripts/stride-api/StrideAPI.gs` → auth-user creation cluster (v38.223.0): `createSupabaseAuthUser_` (stamps `user_metadata` on GoTrue admin create + 422 self-heal), `api_buildAuthUserMetadata_` (centralizes the AuthContext metadata contract), `api_backfillAuthUserMetadata_` + `api_findAuthUserByEmail_` (retroactive repair of empty-metadata users). Five create sites: `api_upsertClientUser_`, `handleCreateUser_`, `handleEnsureAuthUser_`, `handleAdminSetUserPassword_`, the helper. RLS field contract: `role` / `clientSheetId` / `accessibleClientSheetIds` (NOT `tenantId`). **Going-forward `app_metadata` sync (v38.265.0, PR #661):** `stampAppMetadata_` (best-effort PostgREST `rpc/set_app_metadata_by_email` with the service-role key) + `syncAppMetadataForUser_` (resolves `accessibleClientSheetIds` the same way `handleGetUserByEmail_` does), called from `handleGetUserByEmail_` (login) / `handleCreateUser_` / `handleUpdateUser_` so the service-role-only `app_metadata` the `custom_access_token_hook` reads stays fresh |
| Migrations | `20260520180000_user_view_prefs.sql` (table + RLS self + admin-read-any + data API grants + updated_at trigger), `20260520200000_impersonation_log.sql` (audit table + admin/staff + target-self read RLS, service_role-only writes, data API grants), `20260520200100_drop_user_view_prefs_admin_read.sql` (drops the admin-read-any policy after real-session impersonation lands — self policy now covers admin too) |

---

## Infrastructure

Cross-cutting plumbing: API client, Supabase client, realtime sync, audit log, optimistic UI, bulk ops, table primitives.

| Layer | Files |
|---|---|
| Hooks | `src/hooks/useApiData.ts` (generic fetch+refetch), `src/hooks/useAsyncAction.ts` (action+loading+error), `src/hooks/useSupabaseRealtime.ts` (postgres_changes subscriptions), `src/hooks/useFailedOperations.ts` (retry queue), `src/hooks/useClientFilter.ts`, `src/hooks/useClientFilterUrlSync.ts`, `src/hooks/useUrlState.ts` (single-key URL search-param state — pushes history entries so back-button navigates between tab/filter/etc visits), `src/hooks/useClientFilterPersisted.ts` (per-page client dropdown that persists across navigation via URL → localStorage → role-default), `src/hooks/useScrollRestoration.ts` (saves scroll container's scrollTop to sessionStorage per page key, restores once data-ready signal flips true so virtualizer has measured), `src/hooks/useTablePreferences.ts`, `src/hooks/useRowSelection.ts`, `src/hooks/useVirtualRows.ts`, `src/hooks/useResizablePanel.ts`, `src/hooks/useIsMobile.ts`, `src/hooks/useDocuments.ts`, `src/hooks/usePhotos.ts`, `src/hooks/useEntityNotes.ts`, `src/hooks/useDashboardSummary.ts`, `src/hooks/useCalendarEvents.ts`, `src/hooks/useClients.ts`, `src/hooks/useVersionCheck.ts` (PR #506 — polls `/version.json` every 5 min + on visibilitychange; bundle-version baked at build time via `__APP_VERSION__` define; reloads on next route nav when server bundle is newer) |
| Components (cross-cutting) | `src/components/shared/DataTable.tsx`, `src/components/shared/EntityPage.tsx`, `src/components/shared/EntityHistory.tsx`, `src/components/shared/EntityAttachments.tsx`, `src/components/shared/EntitySourceTabs.tsx`, `src/components/shared/DetailPanel.tsx`, `src/components/shared/TabbedDetailPanel.tsx`, `src/components/shared/DetailHeader.tsx`, `src/components/shared/ConfirmDialog.tsx`, `src/components/shared/ProcessingOverlay.tsx`, `src/components/shared/SyncBanner.tsx`, `src/components/shared/FailedOperationsDrawer.tsx`, `src/components/shared/BatchProgress.tsx`, `src/components/shared/BatchGuard.tsx`, `src/components/shared/BulkResultSummary.tsx`, `src/components/shared/BulkScheduleModal.tsx`, `src/components/shared/BulkReassignModal.tsx`, `src/components/shared/StatusChips.tsx`, `src/components/shared/InfoTooltip.tsx`, `src/components/shared/ActionTooltip.tsx`, `src/components/shared/MultiSelectFilter.tsx`, `src/components/shared/AutocompleteInput.tsx`, `src/components/shared/AutocompleteSelect.tsx`, `src/components/shared/LocationPicker.tsx`, `src/components/shared/LoadingScreen.tsx`, `src/components/shared/DriveFoldersList.tsx`, `src/components/shared/FolderButton.tsx`, `src/components/shared/WriteButton.tsx`, `src/components/shared/QuickActions.tsx`, `src/components/shared/FloatingActionMenu.tsx`, `src/components/shared/LinkifiedText.tsx`, `src/components/shared/DeepLink.tsx`, `src/components/shared/ColumnManagerMenu.tsx` (PR #682 — shared "Columns" portal popover for every reorderable data table: show/hide + ▲/▼ reorder + optional Reset widths; exports the `moveColumnInOrder` helper that refuses to cross pinned `select`/`actions`. Used by Tasks/Repairs/WillCalls/Shipments/Claims/Billing/Receiving + Dashboard's 3 tab tables — all of which also gained TanStack column **resize** (`table-layout:fixed` + `minWidth: getTotalSize()` + per-`th` 8px handle + local non-persisted `columnSizing`); reorder/visibility persist via `useTablePreferences`), `src/components/shared/panelStyles.ts`, `src/components/ui/Badge.tsx`, `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx` |
| Layout | `src/components/layout/AppLayout.tsx` (wires `useSupabaseRealtime`, `useVersionCheck`, MessagesProvider, BillingBatchToast, QboPushJobsToast), `src/components/layout/Sidebar.tsx`, `src/components/layout/TopBar.tsx`, `src/components/layout/FloatingActionBar.tsx` |
| Build | `vite.config.ts` (PR #506 — `stride-version-json` plugin emits `dist/version.json` on each build; `define` bakes `__APP_VERSION__` git short SHA + `__BUILD_TIME__` ISO into the bundle), `scripts/build.js`, `scripts/deploy.js`, `scripts/verify-entry.js`, `scripts/verify-dist-integrity.js` |
| Lib | `src/lib/api.ts` (apiFetch<T>() typed API client), `src/lib/apiCache.ts` (in-memory cache), `src/lib/supabase.ts` (Supabase client), `src/lib/supabaseQueries.ts` (query helpers), `src/lib/syncEvents.ts` (sync failure tracking), `src/lib/entityEvents.ts` (write-confirmation pub/sub), `src/lib/batchLoop.ts` (batched op engine), `src/lib/optimisticBulk.ts` (optimistic UI for bulk), `src/lib/constants.ts`, `src/lib/types.ts` |
| Migrations | `20260415120000_clients_mirror_table.sql` (clients cache), `20260418010000_create_entity_audit_log.sql` (audit log table), `20260420080000_entity_notes_backfill_from_legacy.sql`, `20260420020337_entity_notes_drop_staff_only.sql`, `20260421210000_gs_sync_events_admin_update.sql` (sync event RLS), `20260424200000_entity_audit_log_insert_policy.sql` (insert policy for audit log) |
| Apps Script | `AppScripts/stride-api/StrideAPI.gs` (central doPost endpoint backing React app), `AppScripts/stride-client-inventory/src/Utils.gs` (sheet ops, lookups, PDF, email) |
| Types | `src/types/clientFields.ts` |

---

## Marketing

Email campaign management: contacts, templates, campaigns, suppression list.

| Layer | Files |
|---|---|
| Pages | `src/pages/Marketing.tsx` |
| Hooks | `src/hooks/useEmailTemplates.ts` (shared with Settings) |
| Migrations | `20260415193000_marketing_contacts_cache_table.sql` (contacts cache), `20260415210000_marketing_campaigns_templates_settings.sql` (campaigns/templates/settings) |
| Apps Script | `AppScripts/Email Campaign App/stridecampaignv2.5.gs` (campaign send engine) |
| Lib | `src/lib/api.ts` (marketing API functions: `fetchMarketingDashboard`, `postCreateMarketingCampaign`, etc.) |

---

## Quote Tool

Standalone quote builder with PDF generation and Supabase-backed storage.

| Layer | Files |
|---|---|
| Pages | `src/pages/QuoteTool.tsx` |
| Components | `src/components/quotes/QuoteBuilder.tsx`, `src/components/quotes/QuoteDocumentsCard.tsx` (document/photo attachments — floor plans, packing lists, POs; reuses the shared documents module via `context_type='quote'`) |
| Hooks | `src/hooks/useQuoteCatalog.ts`, `src/hooks/useQuoteStore.ts`, `src/hooks/useCoverageOptions.ts` |
| Migrations | `20260419153921_quote_catalog_classes_tax_coverage.sql` (quote item catalog), `20260420100000_quotes_table_supabase_backed.sql` (quotes table), `20260421180000_quotes_admin_read_all.sql` (RLS for admin read), `20260421210000_quotes_realtime_and_replica_identity.sql` (realtime sync), `20260609160000_documents_quote_context.sql` (adds `quote` to the documents `context_type` CHECK so the shared documents module can attach files to a quote) |
| Lib | `src/lib/quoteTypes.ts`, `src/lib/quoteCalc.ts`, `src/lib/quoteDefaults.ts`, `src/lib/quotePdf.ts` |

---

## Special / Other

| Page | Purpose |
|---|---|
| `src/pages/Dashboard.tsx` | Landing page — uses `useDashboardSummary` |
| `src/pages/DetailPanelMockup.tsx` | Design mockup, not in routed nav |
| `src/pages/PublicRates.tsx` | Public-facing rate sheet |
| `src/pages/PublicPhotoGallery.tsx` | No-auth shared photo/document gallery (`#/shared/attachments/:shareId`, `#/shared/photos/:shareId`); doc bytes served via the `get-shared-doc` Edge Function (`supabase/functions/get-shared-doc/index.ts` — service-role share-gated proxy, deploy with `--no-verify-jwt`); photo bytes via anon signed URLs |

## Order Numbering (clean SB-generated ids — Justin Demo canary)

| Layer | File |
|---|---|
| Migration | `supabase/migrations/20260609120000_sb_order_numbering.sql` — `order_sequences` table + `next_order_number(tenant,type)` atomic increment + `order_client_prefix` + `order_numbering_enabled` (flag resolver) + `next_order_id` composer; gates `create_repair_quote_request`; seeds `orderNumbering` flag |
| Repairs | clean id minted inside the `create_repair_quote_request` RPC (used by `supabase/functions/request-repair-quote-sb`) |
| Will Calls | `supabase/functions/create-will-call-sb/index.ts` — `mintWcNumber()` calls `next_order_id`, legacy fallback |
| Tasks | `supabase/functions/batch-create-tasks-sb/index.ts` — `orderNumberingOn()` + per-task `next_order_id`, legacy fallback |
| Auto-tasks (PR #704) | `complete-shipment-sb` (INSP/ASM on receive) + `transfer-items-sb` (INSP on transfer, scoped to destId) — `next_order_id` when on, legacy fallback on RPC error |
| Inspection dedup (PR #704) | `transfer-items-sb` + `src/components/shared/TransferItemsModal.tsx` — "already inspected" guard matches `task_id LIKE 'INSP-%' OR type=<inspName>` (the `type` column is inconsistent on legacy rows; clean `PREFIX-TSK-N` ids need the type branch) |
| Delivery | `src/components/shared/CreateDeliveryOrderModal.tsx` — `buildOrderNumberBase()` strips lpad when flag on (keeps global `dt_order_number_seq`) |
| Linkification | `src/components/shared/LinkifiedText.tsx` — recognizes `PREFIX-RPR/WC/TSK-N` (token in middle segment) |
| Flag | `feature_flags.orderNumbering` (UI/behavior gate, NOT apiRouter routing; `tenant_scope=[justinDemo]`) |
