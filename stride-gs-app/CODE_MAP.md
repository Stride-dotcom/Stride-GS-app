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
| Pages | `src/pages/Orders.tsx`, `src/pages/OrderPage.tsx` (entity detail with Details / Items / Completion / Activity tabs), `src/pages/PublicServiceRequest.tsx` (anon public form at `#/public/service-request` — contact info + ad-hoc-only line items + service date/window + accessorials, lands as `tenant_id=NULL, source='public_form', review_status='pending_review'`) |
| Hooks | `src/hooks/useOrders.ts`, `src/hooks/useDeliveryZones.ts`, `src/hooks/useAvailabilityCalendar.ts` |
| Components | `src/components/shared/OrderDetailPanel.tsx`, `src/components/shared/CreateDeliveryOrderModal.tsx` (now supports ad-hoc/free-text line items alongside inventory items, persisted with `inventory_id=NULL` + `extras` jsonb for weight/cuft), `src/components/shared/ReviewQueueTab.tsx`, `src/components/shared/CustomerVerificationPanel.tsx`, `src/components/settings/PublicFormSettings.tsx` (admin UI for public_form_settings — alert recipient list + reply-to email + copyable form link) |
| Edge Functions | `supabase/functions/dt-push-order/index.ts` (push approved orders to DT API), `supabase/functions/dt-webhook-ingest/index.ts` (receive DT webhook events, upsert orders, auto-mark Collected on paid), `supabase/functions/dt-sync-statuses/index.ts` (pull export.xml per active order; mirrors driver/truck/timing/items/history/notes back), `supabase/functions/dt-backfill-orders/index.ts` (bulk historical import), `supabase/functions/notify-new-order/index.ts` (email notification on new order — ORDER_REVIEW_REQUEST template), `supabase/functions/notify-order-revision/index.ts` (email on reject/revision-request — ORDER_REJECTED + ORDER_REVISION_REQUESTED templates, sends to office + submitter), `supabase/functions/notify-public-request/index.ts` (anon-form submission → submitter confirmation + internal alert via PUBLIC_REQUEST_CONFIRMATION + PUBLIC_REQUEST_ALERT templates; reads recipient list from public_form_settings) |
| Migrations | `20260411120000_dt_phase1a_schema.sql` (dt_orders, dt_order_items, dt_order_history, dt_credentials), `20260415000000_dt_phase1c_webhook_prep.sql` (dt_webhook_events, dt_orders_quarantine), `20260415180000_delivery_availability.sql` (delivery_availability calendar), `20260417000000_delivery_pricing_schema.sql` (zone-based pricing), `20260420100000_delivery_zones.sql` (delivery_zones table), `20260420120000_delivery_order_types_and_role_gates.sql` (order types + RLS), `20260420140000_dt_orders_insert_update_rls.sql` (RLS for inserts/updates), `20260424180000_dt_address_book.sql` (address book cache), `20260425000537_service_time_and_billing_review.sql` (service time auto-calc + quote-required accessorials), `20260425230000_dt_sync_back_fields.sql` (driver/truck/timing/COD/signature columns + per-item delivery state + history lat/lng + dt_export note source), `20260427000000_public_service_request.sql` (extends dt_orders source CHECK with 'public_form', adds contact_company column, partial unique index for NULL-tenant identifiers, anon INSERT-only RLS on dt_orders+dt_order_items, public_form_settings singleton table, PUBLIC_REQUEST_CONFIRMATION + PUBLIC_REQUEST_ALERT email templates) |
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
| Apps Script | `AppScripts/stride-client-inventory/src/Billing.gs` (per-client ledger ops, storage billing), `AppScripts/Consolidated Billing Sheet/Code.gs.js` (consolidated ledger, invoice mgmt), `AppScripts/Consolidated Billing Sheet/CB13_Preview_Core.js` (invoice generation preview), `AppScripts/Consolidated Billing Sheet/CB13 Unbilled Reports.js` (unbilled rollup), `AppScripts/Consolidated Billing Sheet/CB13 Config.js`, `AppScripts/Consolidated Billing Sheet/CB13 Schema Migration.js`, `AppScripts/Consolidated Billing Sheet/Invoice Commit.js` (invoice finalization), `AppScripts/Consolidated Billing Sheet/Billing Logs.js`, `AppScripts/Consolidated Billing Sheet/QB_Export.js` (QuickBooks IIF export) |

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
| Migrations | `20260414180000_item_id_ledger.sql` (item ID hash ledger), `20260416180000_add_inventory_url_columns.sql` (item photo/folder URL columns), `20260415200000_locations_and_move_history.sql` (locations + move_history), `20260422010000_inventory_mirror_drift_tier1.sql` (drift detection), `20260422020000_stage_a_mirror_drift.sql` (staging mirror), `20260422000000_entity_notes_item_id.sql` (item notes by item_id) |
| Apps Script | `AppScripts/stride-client-inventory/src/Code.gs` (main inventory CRUD), `AppScripts/stride-client-inventory/src/Import.gs` (item import/sync), `AppScripts/stride-client-inventory/src/AutocompleteDB.gs` (item name autocomplete cache), `AppScripts/QR Scanner/ScannerBackend.updated.gs` (legacy scanner backend) |
| Lib | `src/lib/parseScanPayload.ts`, `src/lib/scanAudioFeedback.ts` |

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

Repair quotes → approve/decline → execute → bill.

| Layer | Files |
|---|---|
| Pages | `src/pages/Repairs.tsx`, `src/pages/RepairPage.tsx`, `src/pages/RepairJobPage.tsx` (legacy) |
| Hooks | `src/hooks/useRepairs.ts`, `src/hooks/useRepairDetail.ts` |
| Components | `src/components/shared/RepairDetailPanel.tsx` |
| Migrations | `20260417020000_add_repair_date_columns.sql` (quote_date, completed_date) |
| Apps Script | `AppScripts/stride-client-inventory/src/Repairs.gs` (quote request, approval, billing) |

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

App settings: API connection, email/doc templates, users, integrations.

| Layer | Files |
|---|---|
| Pages | `src/pages/Settings.tsx` |
| Hooks | `src/hooks/useUsers.ts`, `src/hooks/useEmailTemplates.ts`, `src/hooks/useProfiles.ts`, `src/hooks/useSidebarOrder.ts` |
| Components | `src/components/shared/TemplateEditor.tsx`, `src/components/shared/ChangePasswordModal.tsx`, `src/components/shared/SetNewPassword.tsx` |
| Migrations | `20260415180100_users_cache_table.sql` (user/role cache), `20260419120000_email_templates.sql` (template storage), `20260420040000_doc_quote_template_seed.sql` (doc template seed), `20260420050000_doc_quote_match_invoice_style.sql`, `20260420060000_doc_invoice_line_items_html_token.sql`, `20260420070000_doc_quote_browser_printable_rebuild.sql`, `20260420090000_doc_quote_column_reorder.sql`, `20260422030000_email_templates_remove_photos_add_sidemark.sql` |
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
