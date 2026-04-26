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
