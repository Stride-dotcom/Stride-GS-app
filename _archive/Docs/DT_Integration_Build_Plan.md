# DispatchTrack Integration — Full Build Plan

> **Created:** 2026-04-11
> **Status:** Phase 1a COMPLETE ✅ | Phase 1b COMPLETE ✅ | Phase 1c READY TO BUILD
> **Owner:** Justin — Stride Logistics, Kent WA
> **Related migration:** `stride-gs-app/supabase/migrations/20260411120000_dt_phase1a_schema.sql`

---

## What is DispatchTrack?

DispatchTrack is a last-mile delivery management platform. Stride uses it to schedule and track client furniture deliveries. This integration surfaces DT delivery status, POD photos, and driver notes inside the Stride client portal (mystridehub.com) so clients can see where their items are without calling the warehouse.

---

## Integration Architecture

```
DispatchTrack API / Webhooks
         │
         ▼
  dt_webhook_events (Supabase)   ← raw inbound events, 90-day retention
         │ (Edge Function processes)
         ▼
  dt_orders + child tables       ← structured mirror, RLS-protected
         │
         ▼
  React Orders tab               ← read-only view per client
  (mystridehub.com/#/orders)
```

**Authority:** DispatchTrack is the execution authority for delivery data. Supabase is a read cache only — same pattern as GAS→Supabase for inventory/tasks/etc.

**Tenant scoping:** `tenant_id = clientSheetId` everywhere, consistent with existing Phase 3 tables. Orders may arrive unmapped (tenant_id NULL) and get mapped via quarantine review.

---

## Supabase Tables Created (Phase 1a)

| Table | Purpose |
|---|---|
| `dt_statuses` | Reference: DT status codes + delivery outcome categories (seeded) |
| `dt_substatuses` | Reference: DT sub-status codes (seed once API codes confirmed) |
| `dt_orders` | Core order mirror — contact info, time window, status, search_vector |
| `dt_order_items` | Line items; nullable FK to `public.inventory` |
| `dt_order_history` | Append-only event log per order |
| `dt_order_photos` | POD/signature photos; staged to `dt-pod-photos` bucket |
| `dt_order_notes` | Driver/dispatcher notes; public notes update `latest_note_preview` |
| `dt_webhook_events` | Raw inbound webhooks, idempotency_key UNIQUE, 90-day retention |
| `dt_credentials` | Singleton config: API token (encrypted), feature flag `orders_tab_enabled_roles` |
| `dt_orders_quarantine` | Unmappable webhook payloads for operator review |
| `audit_log` | General admin-visible mutation audit trail |

**Storage bucket:** `dt-pod-photos` (private, 10MB/file limit, JPEG/PNG/WebP)

---

## Locked Decisions

1. **No `raw_payload` on `dt_orders`** — raw payloads only on `dt_webhook_events` with 90-day retention. Keeps order table lean.
2. **Canonical time window:** `local_service_date date` + `window_start_local time` + `window_end_local time` + `timezone text`. No `tstzrange`, no duplicate date columns.
3. **Status id namespaces:** ids 0–11 = operational statuses, ids 100+ = delivery outcome categories. Both in one table so FK works uniformly.
4. **Tenant_id nullable on `dt_orders`** — webhook events arrive before client mapping. Quarantine flow handles unmapped orders.
5. **Feature flag in `dt_credentials`** — `orders_tab_enabled_roles text[] default '{admin}'`. No Supabase settings table exists; this singleton is the right home. StrideAPI.gs reads it and includes it in the config response for React to gate the tab.
6. **`dt_order_items.inventory_id`** FK → `public.inventory.id` (nullable). Wired when a DT order maps to a Stride inventory item.
7. **Child-table RLS uses EXISTS subquery** for client path (no `tenant_id` column on child tables). If child tables ever get a `tenant_id` column, simplify to direct column check.
8. **`dt-pod-photos` storage bucket** path convention: `{tenant_id}/{dt_order_id}/{photo_id}.{ext}`. First segment = tenant_id for storage RLS.
9. **Phase scope:** Phase 1a = schema only (view-ready). No React code, no Edge Functions, no GAS changes in Phase 1a.

---

## Build Phases

### Phase 1a — Schema (COMPLETE ✅)
- 11 Supabase tables, indexes, triggers, RLS policies
- `dt-pod-photos` storage bucket
- `dt_statuses` seeded with 15 codes
- Migration: `20260411120000_dt_phase1a_schema`
- **No React, no Edge Functions, no GAS changes**

### Phase 1b — React Orders Tab (COMPLETE ✅)
- Route: `#/orders` (admin-only, gated by RoleGuard)
- TanStack Table with category filter pills, global search, CSV export, virtual rows
- Row click → OrderDetailPanel (resizable drawer, read-only)
- Supabase-backed: `fetchDtOrdersFromSupabase` + `fetchDtStatusesFromSupabase`
- Build: `63207c2` deployed to mystridehub.com — shows empty state until Phase 1c

### Phase 1c — Webhook Ingest (READY TO BUILD)
**Prerequisites now resolved:**
- DT instance URL: `expressinstallation.dispatchtrack.com` ✅
- Business-level API key: obtained 2026-04-15 ✅ (stored as `DT_API_KEY` Edge Function secret)
- Webhook mechanism: Admin → Alerts → Web Service, POST, `{{...}}` tag payload ✅
- No per-client credentials needed ✅

**Build tasks:**
- Supabase Edge Function: `dt-webhook-ingest`
  - Validates shared secret token (URL param `?token=<secret>` — no HMAC from DT v8.1)
  - Parses `{{Alert_Type}}`, `{{Account}}`, `{{Service_Order_Number}}`, etc. from POST body
  - Writes raw event to `dt_webhook_events` (idempotency on `idempotency_key`)
  - Upserts to `dt_orders`: maps `{{Account}}` → `tenant_id` via client name lookup
  - Quarantines if no tenant match
  - Updates `latest_note_preview` on Note events
  - Queues photo rows on Pictures events
- DT Admin config: enable relevant alert events (Started, Unable To Start, Unable To Finish, In Transit, Notes, Pictures, Service Route Finished), set Delivery Mechanism = Web Service, POST to Edge Function URL
- Store Edge Function URL in `dt_credentials.webhook_url`

### Phase 2 — Bi-directional Sync
- Background reconciliation: poll DT API for open orders, compare with Supabase, fill gaps
- Write through: when Apps Script marks inventory "Released", check for linked DT order and update status
- Rate limiting: `dt_credentials.rate_limit_daily` / `rate_limit_used_today` enforced in Edge Function
- Sub-status seed: once DT API sub-status codes confirmed, populate `dt_substatuses`

### Phase 3 — POD Photo Ingestion
- Edge Function: `dt-photo-ingest`
  - Reads `dt_order_photos` rows where `storage_path IS NULL` and `fetch_attempts < 3`
  - Fetches from `dt_url`, stores in `dt-pod-photos` bucket
  - Updates `storage_path`, `fetched_at`, `content_type`, `size_bytes`
  - On failure: increment `fetch_attempts`, write `fetch_error`
- React photo viewer: signed URL from bucket (not direct DT CDN)
- Clients only see `visible_in_portal = true` photos (enforced by RLS)

---

## RLS Summary

| Table | Staff/Admin | Client | Service Role |
|---|---|---|---|
| `dt_statuses` / `dt_substatuses` | SELECT all | SELECT all | ALL |
| `dt_orders` | SELECT all | SELECT where tenant_id matches | ALL |
| Child tables (items/history/photos/notes) | SELECT all | SELECT via EXISTS join to `dt_orders` | ALL |
| `dt_webhook_events` | SELECT all | ❌ no access | ALL |
| `dt_credentials` | Admin-only SELECT | ❌ no access | ALL |
| `dt_orders_quarantine` | SELECT all | ❌ no access | ALL |
| `audit_log` | SELECT all | ❌ no access | ALL |
| `dt-pod-photos` bucket | Read all | Read own tenant_id path | ALL |

---

## Deployment Commands

**Supabase migrations** (via MCP tool in Claude — no manual SQL editor needed):
- MCP tool ID: `mcp__94cd3688-d1f9-4417-a61a-6e38b1d2b097`
- Project ID: `uqplppugeickmamycpuz`
- Apply: `apply_migration(project_id, name, query)`
- List applied: `list_migrations(project_id)`
- List tables: `list_tables(project_id, schemas)`

**React app** (from `stride-gs-app/`):
```bash
npx tsc --noEmit && npm run build
cd dist && git add -A && git commit -m "Deploy: ..." && git push origin main --force
```

**Edge Functions** (Phase 1c+, from `stride-gs-app/`):
```bash
# Will be added when Edge Functions are created
```

---

## Credentials & Configuration (Phase 1c)

### DT Instance
- **URL:** `https://expressinstallation.dispatchtrack.com`
- **Account count:** 60 active accounts (all Stride clients)

### API Authentication
- **Type:** Business-level API key — one key covers all 60 accounts. No per-client keys needed.
- **Key storage:** Store in Supabase `dt_credentials` table (`api_key` column) via MCP tool, and as a Supabase Edge Function secret. **Never commit to git.**
- Key name for Edge Function secret: `DT_API_KEY`
- Key obtained: 2026-04-15 from Ashok at DispatchTrack support

### Webhook Configuration (Admin → General Settings → Alerts)
- **Delivery Mechanism:** Web Service
- **Method:** POST
- **URL:** Supabase Edge Function URL (to be deployed in Phase 1c)
- **Auth strategy:** No HMAC signing documented — use a shared secret token in URL params or custom header. Add a `?token=<random-secret>` param to the Edge Function URL and validate it on ingest.
- **Relevant alert events to wire up:**
  - `Started` — order is in progress → status: in_progress
  - `Unable To Start` — failed to start → status: exception
  - `Unable To Finish` — delivery failed → status: exception
  - `In Transit` — en route → status: in_progress
  - `Notes` — driver note added → update `latest_note_preview` + `dt_order_notes`
  - `Pictures` / `Pictures/Notes` — POD photo added → queue to `dt_order_photos`
  - `Pre Call Confirm Status` — pre-call sent
  - `Service Route Finished` — route complete

### Available Webhook Tags (DT `{{...}}` template syntax)
Tags confirmed visible in Admin → Alerts → Edit → Web Service → Available Tags:
- `{{Alert_Type}}` — event name (e.g. "Started", "Unable To Finish")
- `{{Account}}` — account name → maps to client (tenant lookup)
- `{{Account_Alert_Email}}` — account email
- `{{Service_Order_Number}}` — order identifier → `dt_identifier`
- `{{Customer_Name}}`, `{{Customer_Address}}`, `{{Customer_Primary_Phone}}`, `{{Customer_Secondary_Phone}}`, `{{Customer_Email}}`
- `{{Note}}` — driver/dispatcher note text
- `{{ItemsInfo::Description|SKU_Number|Quantity|Delivered|Status|Return_Code|Driver_Return_Note}}` — line items
- Custom fields: `{{cf_Contact_Notes}}`, `{{cf_Fabric_Protection_Added}}` (account-specific)
- Additional account fields: `{{af_-}}` (account custom fields, names TBD per account config)

### Polling API (Phase 2 reconciliation)
- **Endpoint:** `https://expressinstallation.dispatchtrack.com/orders/api/export.xml`
- **Auth:** `code=expressinstallation&api_key=<DT_API_KEY>`
- **Method:** POST with `date=YYYY-MM-DD` parameter
- **Returns:** XML with all order activity for that date across all accounts

---

## Open Questions (remaining)

- [ ] DT webhook HMAC/signature: no HMAC documented in v8.1 API. Confirm with Ashok whether a signature header is sent on webhook POST, or use shared-secret-in-URL approach.
- [ ] DT sub-status code list: to seed `dt_substatuses` table (DT API only returns 6 top-level statuses in export XML)
- [ ] Which clients should see the Orders tab first? Currently admin-only via `orders_tab_enabled_roles`
- [ ] Timezone field: DT export XML does not include timezone. Confirm if orders always use America/Los_Angeles or if it varies.
- [ ] Should order items auto-link to Stride inventory by PO number / sidemark match?

---

## Related Files

| File | Purpose |
|---|---|
| `stride-gs-app/supabase/migrations/20260411120000_dt_phase1a_schema.sql` | The actual migration SQL |
| `supabase-dt-phase1a-setup.sql` | Root copy (same content, for reference) |
| `Docs/Archive/Supabase_Integration_Plan.md` | Phase 1–3 Supabase read cache (separate feature) |
| `Docs/Archive/Architectural_Decisions_Log.md` | Full 53-item decision log |
