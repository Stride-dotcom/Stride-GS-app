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

### Phase 1b — React Orders Tab (NEXT)
- New route: `#/orders`
- Gated by `orders_tab_enabled_roles` from `dt_credentials`
- Read-only table: DT order #, client, service date, status badge, contact name/city
- Row click → Order detail panel (same pattern as Task/Repair detail panels)
- Order detail: contact info, time window, items list, history timeline, notes, photos
- Uses Supabase direct read (same pattern as `supabaseQueries.ts`)
- TypeScript types generated from Supabase schema
- **No write operations in Phase 1b** — view only

### Phase 1c — Webhook Ingest
- Supabase Edge Function: `dt-webhook-ingest`
  - Validates webhook HMAC signature against `dt_credentials.webhook_secret`
  - Writes raw event to `dt_webhook_events`
  - Processes: upsert to `dt_orders`, update child tables, quarantine if no tenant match
  - Idempotency: skip if `idempotency_key` already exists
- StrideAPI.gs: no changes needed (Edge Function handles ingest directly)
- Add `SUPABASE_WEBHOOK_SECRET` to `dt_credentials` row once DT account configured

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

## Open Questions (resolve before Phase 1b)

- [ ] DT API base URL and auth token format (needed for `dt_credentials` row)
- [ ] DT webhook endpoint URL format and HMAC header name
- [ ] DT sub-status code list (to seed `dt_substatuses`)
- [ ] Which clients should see the Orders tab first? (sets initial `orders_tab_enabled_roles`)
- [ ] Should order items auto-link to Stride inventory by PO number / sidemark match?

---

## Related Files

| File | Purpose |
|---|---|
| `stride-gs-app/supabase/migrations/20260411120000_dt_phase1a_schema.sql` | The actual migration SQL |
| `supabase-dt-phase1a-setup.sql` | Root copy (same content, for reference) |
| `Docs/Archive/Supabase_Integration_Plan.md` | Phase 1–3 Supabase read cache (separate feature) |
| `Docs/Archive/Architectural_Decisions_Log.md` | Full 53-item decision log |
