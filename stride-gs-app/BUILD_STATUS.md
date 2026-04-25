# Stride GS App — Build Status

> Last updated: 2026-04-24. Verified against actual codebase.

---

## Current Versions

| System | Version | Notes |
|---|---|---|
| React app (GitHub Pages) | Latest on `origin/main` | `npm run deploy` from source |
| StrideAPI.gs | v38.118.0 | Web App deployment v387 |
| Supabase | 57 migrations applied | 6 Edge Functions deployed |
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

## Recent Changes (2026-04-24, this session)

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

- [ ] Set `STAX_API_KEY` secret on stax-catalog-sync Edge Function in Supabase dashboard
- [ ] Run `backfillShipmentFolderUrls()` from Apps Script editor (one-time)
- [ ] Run `backfillActivityAllClientsNow()` for historical activity log seeding
- [ ] Run `reconcileAllClientsNow` for mirror column backfill
- [ ] Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Stax Auto Pay project Script Properties
- [ ] Run `seedAllStaxToSupabase()` once from Stride API editor (Payments cache seed)
