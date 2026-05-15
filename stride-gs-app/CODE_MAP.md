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
| Edge Functions | `supabase/functions/dt-push-order/index.ts` (push approved orders to DT API), `supabase/functions/dt-webhook-ingest/index.ts` v18 (receive DT webhook events, upsert orders, auto-mark Collected on paid; fires dt-sync-statuses for ALL Service_Route_Finished events incl. pickups), `supabase/functions/dt-sync-statuses/index.ts` v13 (pull export.xml per active order; mirrors driver/truck/timing/items/history/notes back; end-of-loop fires release-on-dt-finished for delivery orders + stamp-pickup-on-linked-delivery for pickups; fires dt-push-order after PU→Delivery item-sync propagation), `supabase/functions/dt-backfill-orders/index.ts` (bulk historical import), `supabase/functions/notify-new-order/index.ts` (email notification on new order — ORDER_REVIEW_REQUEST template), `supabase/functions/notify-order-revision/index.ts` (email on reject/revision-request — ORDER_REJECTED + ORDER_REVISION_REQUESTED templates), `supabase/functions/notify-public-request/index.ts` (anon `#/public/service-request` confirmation + internal alert), `supabase/functions/notify-pickup-completed/index.ts` v3 (real-time PICKUP_COMPLETED email + invokes stamp-pickup-on-linked-delivery for P+D pickups), `supabase/functions/push-inventory-release-to-sheet/index.ts` (SB→Sheet mirror for DT order release), `supabase/functions/_shared/release-on-dt-finished.ts` (shared auto-release helper for delivery completion), `supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts` (two-tier shared helper for PU→Delivery propagation: Tier A order-level stamps + picked_up_at, Tier B per-item field propagation via parent_pickup_item_id FK match) |
| Migrations | `20260411120000_dt_phase1a_schema.sql` (dt_orders, dt_order_items, dt_order_history, dt_credentials), `20260415000000_dt_phase1c_webhook_prep.sql` (dt_webhook_events, dt_orders_quarantine), `20260415180000_delivery_availability.sql`, `20260417000000_delivery_pricing_schema.sql`, `20260420100000_delivery_zones.sql`, `20260420120000_delivery_order_types_and_role_gates.sql`, `20260420140000_dt_orders_insert_update_rls.sql`, `20260424180000_dt_address_book.sql`, `20260425000537_service_time_and_billing_review.sql`, `20260425230000_dt_sync_back_fields.sql`, `20260426220000_dt_orders_public_form_anon_insert.sql`, `20260512120000_dt_orders_bill_to_columns.sql`, `20260512230000_dt_order_items_inventory_id_backfill.sql` (PR #367 — backfills dt_order_items.inventory_id from (tenant_id, dt_item_code) linkage + self-healing trigger), `20260513120000_dt_pickup_linkage_propagation.sql` (PR #388 — dt_orders.linked_pickup_finished_at + linked_pickup_driver_name + dt_order_items.picked_up_at), `20260513140000_dt_order_items_parent_pickup_fk.sql` (PR #389 — dt_order_items.parent_pickup_item_id self-referential FK + description-match backfill), `20260513140100_dt_order_items_parent_pickup_fk_fungible_backfill.sql` (PR #389 — top-up backfill for fungible-items P+D pairs), `20260513150000_dt_order_items_pickup_audit_columns.sql` (PR #389 — pickup_item_note + pickup_return_codes + pickup_delivered_quantity audit columns) |
| Lib | `src/lib/deepLinks.ts` (DT order deep links for emails), `src/lib/supabaseQueries.ts` (`fetchDtOrderHistory`, `fetchDtOrderNotes` for the OrderPage Completion tab) |

---

## Billing

Billing ledger, service catalog, parity monitoring, activity log, insurance auto-billing. React reads only — all writes go through Apps Script (Consolidated Billing).

| Layer | Files |
|---|---|
| Pages | `src/pages/Billing.tsx`, `src/pages/PriceList.tsx`, `src/pages/PublicRates.tsx`, `src/pages/ParityMonitor.tsx` |
| Hooks | `src/hooks/useBilling.ts`, `src/hooks/useBillingActivity.ts`, `src/hooks/useBillingParityLog.ts`, `src/hooks/useServiceCatalog.ts`, `src/hooks/usePricing.ts`, `src/hooks/useItemClasses.ts`, `src/hooks/usePaymentTerms.ts`, `src/hooks/useParityMonitor.ts`, `src/hooks/useClientInsurance.ts`, `src/hooks/useCoverageOptions.ts`, `src/hooks/usePriceListShares.ts` |
| Components | `src/components/shared/BillingDetailPanel.tsx` |
| Migrations | `20260419064058_service_catalog.sql` (service_catalog table), `20260419120000_billing_reference_column.sql` (ledger refs), `20260419000000_price_list_shares.sql` (shareable price lists), `20260420110000_billing_parity_log.sql` (parity log table), `20260420110000_billing_parity_trigger.sql` (auto-record parity discrepancies), `20260420160000_insurance_auto_billing_phase1.sql` (auto-bill by coverage), `20260420160001_insurance_auto_billing_cron.sql` (scheduled auto-billing), `20260423210000_billing_activity_log.sql` (ledger change audit), `20260424190000_service_catalog_external_ids.sql` (Stax/QBO IDs on service_catalog) |
| Apps Script | `AppScripts/stride-client-inventory/src/Billing.gs` (per-client ledger ops, storage billing), `AppScripts/Consolidated Billing Sheet/Code.gs.js` (consolidated ledger, invoice mgmt), `AppScripts/Consolidated Billing Sheet/CB13_Preview_Core.js` (invoice generation preview), `AppScripts/Consolidated Billing Sheet/CB13 Unbilled Reports.js` (unbilled rollup), `AppScripts/Consolidated Billing Sheet/CB13 Config.js`, `AppScripts/Consolidated Billing Sheet/CB13 Schema Migration.js`, `AppScripts/Consolidated Billing Sheet/Invoice Commit.js` (invoice finalization), `AppScripts/Consolidated Billing Sheet/Billing Logs.js`, `AppScripts/Consolidated Billing Sheet/QB_Export.js` (QuickBooks IIF export), `AppScripts/stride-api/StrideAPI.gs` → `handleVoidInvoice_` + `case 'voidInvoice'` (sets every Billing_Ledger row matching invoiceNo to Void; backs the Invoice Review tab's per-invoice Void button), `AppScripts/stride-api/StrideAPI.gs` → `reconcileCbFromBilling_(invoiceNos)` (v38.222.0 — reads `public.billing` and brings CB Consolidated_Ledger into agreement before reads; auto-called from `handleQboCreateInvoice_` to prevent silent-drop on drifted CB rows; transitional bridge until P4b retires CB) |
| Invoice Review | `src/pages/Billing.tsx` → `InvoiceReviewTab` + `InvoiceReviewLineItems` (Supabase-only read, group by `invoice_no`, search/filter/sort/expand, optimistic Void); `postVoidInvoice` in `src/lib/api.ts` |
| Unified Addons (v38.177.0) | `stride-gs-app/supabase/migrations/20260504170000_unified_addons.sql` (polymorphic `public.addons` table, drops empty `task_addons`); `src/hooks/useEntityAddons.ts` (CRUD + realtime keyed on `parent_type`/`parent_id`); `src/hooks/useTaskAddons.ts` (compat alias); `src/components/shared/AddTaskServiceModal.tsx` (parentType-aware filter + title); `src/components/shared/BillingPreviewCard.tsx` (lifted task-only restrictions, broadened recorded query for repair/wc); `AppScripts/stride-api/StrideAPI.gs` → `api_writeAddonsToLedger_` (one helper used by `handleCompleteTask_` / `handleCompleteRepair_` / `handleProcessWcRelease_`) |

---

## Payments / Stax

Stax payment integration: invoicing, charging, auto-pay, catalog sync. React reads Stax cache; Apps Script writes via Stax API.

| Layer | Files |
|---|---|
| Pages | `src/pages/Payments.tsx` |
| Hooks | `src/hooks/usePaymentTerms.ts`, `src/hooks/useQBO.ts` |
| Components | `src/components/shared/PaymentDetailPanel.tsx`, `src/components/shared/PreChargeValidationModal.tsx` |
| Edge Functions | `supabase/functions/stax-catalog-sync/index.ts` (sync service_catalog → Stax items) |
| Migrations | `20260416120000_stax_invoices_cache_table.sql` (stax_invoices cache), `20260416120001_stax_charges_exceptions_customers_runlog_cache.sql` (charges/exceptions/customers/runlog cache) |
| Apps Script | `AppScripts/stax-auto-pay/StaxAutoPay.gs` (auto-pay charge creation + retry) |

---

## Inventory

Item list with inline editing, full-page item detail, scanner, label printing.

| Layer | Files |
|---|---|
| Pages | `src/pages/Inventory.tsx`, `src/pages/ItemPage.tsx`, `src/pages/Scanner.tsx`, `src/pages/Labels.tsx` |
| Hooks | `src/hooks/useInventory.ts`, `src/hooks/useItemDetail.ts`, `src/hooks/useItemIndicators.ts`, `src/hooks/useItemNotes.ts`, `src/hooks/useItemClasses.ts`, `src/hooks/useLocations.ts` |
| Components | `src/components/shared/ItemDetailPanel.tsx`, `src/components/shared/ItemIdBadges.tsx`, `src/components/shared/InlineEditableCell.tsx` |
| Migrations | `20260414180000_item_id_ledger.sql` (item ID hash ledger), `20260416180000_add_inventory_url_columns.sql` (item photo/folder URL columns), `20260415200000_locations_and_move_history.sql` (locations + move_history), `20260422010000_inventory_mirror_drift_tier1.sql` (drift detection), `20260422020000_stage_a_mirror_drift.sql` (staging mirror), `20260422000000_entity_notes_item_id.sql` (item notes by item_id), `inventory_live_view_and_transfer_provenance` (`inventory_live` view excluding `status='Transferred'` + `transferred_from_tenant_id` + `transferred_at` columns), `photos_storage_rls_via_item_photos_tenant` (storage RLS row-based fallback so transferred photos remain readable to new owner without moving objects), `backfill_transferred_item_aux_tables` (migrated entity_notes / item_photos / provenance for 31 historical transfer pairs) |
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
| Migrations | `20260420000000_tasks_due_date_priority.sql` (due_date + priority columns) |
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
| Edge Functions (multi-item + single-item create) | `supabase/functions/request-repair-quote-sb/index.ts` v5 — SB-authoritative create via RPC + REPAIR_QUOTE_REQUEST email; accepts optional `sourceTaskId` for the single-item path from TaskDetailPanel (PR #418); after RPC fires `op='insert'` reverse-writethrough so the new repair lands on the per-tenant Repairs sheet immediately (PR #432) |
| Edge Functions (P3 cluster — cancelRepair) | `supabase/functions/cancel-repair-shadow/index.ts` v1 (pure parity shadow), `supabase/functions/cancel-repair-sb/index.ts` v1 (SB-primary: status flip + audit + reverse writethrough) |
| Edge Functions (P3 cluster — startRepair) | `supabase/functions/start-repair-shadow/index.ts` v1, `supabase/functions/start-repair-sb/index.ts` v1 (status flip + start_date stamp + Approved/In Progress/Complete re-run rules) |
| Edge Functions (P3 cluster — sendRepairQuote) | `supabase/functions/send-repair-quote-shadow/index.ts` v1, `supabase/functions/send-repair-quote-sb/index.ts` v1 (server-recomputed totals, 11-column update, REPAIR_QUOTE email via Resend, idempotent re-send) |
| Edge Functions (P3 cluster — respondToRepairQuote) | `supabase/functions/respond-repair-quote-shadow/index.ts` v1, `supabase/functions/respond-repair-quote-sb/index.ts` v1 (Approve/Decline branching, REPAIR_APPROVED / REPAIR_DECLINED email) |
| Edge Functions (P3 cluster — requestRepairQuote single-item shadow) | `supabase/functions/request-repair-quote-shadow/index.ts` v1 (PR #418 — pure shadow returning `{summary: "Repair quote requested for items: [...]"}`) |
| Edge Functions (P4a — completeRepair) | `supabase/functions/complete-repair-shadow/index.ts` v1, `supabase/functions/complete-repair-sb/index.ts` v1 (PR #419 — calls `complete_repair_atomic` RPC, fires per-billing-row + repair-row reverse-writethrough, dispatches REPAIR_COMPLETE email) |
| Edge Functions (re-quote) | `supabase/functions/re-quote-repair/index.ts` v2 (PR #420 — explicit `user_metadata.role ∈ {admin,staff}` gate, calls `re_quote_repair` RPC, mirrors parent repair row to per-tenant sheet; per-tenant `Repair_Items` sheet not mirrored — same scope as multi-item create flow) |
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
| Lib | `src/lib/shadowRunner.ts` (background parity check — hashes both backends' results, writes `parity_results`, bumps lifetime counters), `src/lib/apiCall.ts` (`apiCall(key, gasFn, sbFn?, opts?)` routing wrapper — routes by flag, fires shadow when `parity_enabled` + `shadow_backend` are set) |
| Migrations | `20260415180100_users_cache_table.sql` (user/role cache), `20260419120000_email_templates.sql` (template storage), `20260420040000_doc_quote_template_seed.sql` (doc template seed), `20260420050000_doc_quote_match_invoice_style.sql`, `20260420060000_doc_invoice_line_items_html_token.sql`, `20260420070000_doc_quote_browser_printable_rebuild.sql`, `20260420090000_doc_quote_column_reorder.sql`, `20260422030000_email_templates_remove_photos_add_sidemark.sql`, `20260514170000_parity_infra_phase1_extend.sql` (Phase 1 parity infra — adds `total_checks` / `mismatch_count` / GENERATED `match_rate` to `feature_flags`, `input_summary` to `parity_results`, FK between them, authenticated INSERT for parity rows, realtime publication, seeds Justin's canonical 24 function_keys) |
| Apps Script | `AppScripts/stride-client-inventory/src/RemoteAdmin.gs` (user mgmt, settings sync), `AppScripts/stride-client-inventory/src/Triggers.gs` (per-client trigger setup) |

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
| Lib | `src/lib/supabase.ts` (auth session) |

---

## Infrastructure

Cross-cutting plumbing: API client, Supabase client, realtime sync, audit log, optimistic UI, bulk ops, table primitives.

| Layer | Files |
|---|---|
| Hooks | `src/hooks/useApiData.ts` (generic fetch+refetch), `src/hooks/useAsyncAction.ts` (action+loading+error), `src/hooks/useSupabaseRealtime.ts` (postgres_changes subscriptions), `src/hooks/useFailedOperations.ts` (retry queue), `src/hooks/useClientFilter.ts`, `src/hooks/useClientFilterUrlSync.ts`, `src/hooks/useUrlState.ts` (single-key URL search-param state — pushes history entries so back-button navigates between tab/filter/etc visits), `src/hooks/useClientFilterPersisted.ts` (per-page client dropdown that persists across navigation via URL → localStorage → role-default), `src/hooks/useScrollRestoration.ts` (saves scroll container's scrollTop to sessionStorage per page key, restores once data-ready signal flips true so virtualizer has measured), `src/hooks/useTablePreferences.ts`, `src/hooks/useRowSelection.ts`, `src/hooks/useVirtualRows.ts`, `src/hooks/useResizablePanel.ts`, `src/hooks/useIsMobile.ts`, `src/hooks/useDocuments.ts`, `src/hooks/usePhotos.ts`, `src/hooks/useEntityNotes.ts`, `src/hooks/useDashboardSummary.ts`, `src/hooks/useCalendarEvents.ts`, `src/hooks/useClients.ts` |
| Components (cross-cutting) | `src/components/shared/DataTable.tsx`, `src/components/shared/EntityPage.tsx`, `src/components/shared/EntityHistory.tsx`, `src/components/shared/EntityAttachments.tsx`, `src/components/shared/EntitySourceTabs.tsx`, `src/components/shared/DetailPanel.tsx`, `src/components/shared/TabbedDetailPanel.tsx`, `src/components/shared/DetailHeader.tsx`, `src/components/shared/ConfirmDialog.tsx`, `src/components/shared/ProcessingOverlay.tsx`, `src/components/shared/SyncBanner.tsx`, `src/components/shared/FailedOperationsDrawer.tsx`, `src/components/shared/BatchProgress.tsx`, `src/components/shared/BatchGuard.tsx`, `src/components/shared/BulkResultSummary.tsx`, `src/components/shared/BulkScheduleModal.tsx`, `src/components/shared/BulkReassignModal.tsx`, `src/components/shared/StatusChips.tsx`, `src/components/shared/InfoTooltip.tsx`, `src/components/shared/ActionTooltip.tsx`, `src/components/shared/MultiSelectFilter.tsx`, `src/components/shared/AutocompleteInput.tsx`, `src/components/shared/AutocompleteSelect.tsx`, `src/components/shared/LocationPicker.tsx`, `src/components/shared/LoadingScreen.tsx`, `src/components/shared/DriveFoldersList.tsx`, `src/components/shared/FolderButton.tsx`, `src/components/shared/WriteButton.tsx`, `src/components/shared/QuickActions.tsx`, `src/components/shared/FloatingActionMenu.tsx`, `src/components/shared/LinkifiedText.tsx`, `src/components/shared/DeepLink.tsx`, `src/components/shared/panelStyles.ts`, `src/components/ui/Badge.tsx`, `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx` |
| Layout | `src/components/layout/AppLayout.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/TopBar.tsx`, `src/components/layout/FloatingActionBar.tsx` |
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
| Hooks | `src/hooks/useQuoteCatalog.ts`, `src/hooks/useQuoteStore.ts`, `src/hooks/useCoverageOptions.ts` |
| Migrations | `20260419153921_quote_catalog_classes_tax_coverage.sql` (quote item catalog), `20260420100000_quotes_table_supabase_backed.sql` (quotes table), `20260421180000_quotes_admin_read_all.sql` (RLS for admin read), `20260421210000_quotes_realtime_and_replica_identity.sql` (realtime sync) |
| Lib | `src/lib/quoteTypes.ts`, `src/lib/quoteCalc.ts`, `src/lib/quoteDefaults.ts`, `src/lib/quotePdf.ts` |

---

## Special / Other

| Page | Purpose |
|---|---|
| `src/pages/Dashboard.tsx` | Landing page — uses `useDashboardSummary` |
| `src/pages/DetailPanelMockup.tsx` | Design mockup, not in routed nav |
| `src/pages/PublicRates.tsx` | Public-facing rate sheet |
