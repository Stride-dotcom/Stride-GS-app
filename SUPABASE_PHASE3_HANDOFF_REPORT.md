# Supabase Phase 3 — Read Cache (Full Mirror) — Handoff Report
**Date:** 2026-04-03
**Status:** CODE COMPLETE — AWAITING DEPLOYMENT

## What Was Built

### 1. SQL Migration (supabase-phase3-setup.sql)
- 6 Supabase tables: `inventory`, `tasks`, `repairs`, `will_calls`, `shipments`, `billing`
- All tables have `UNIQUE(tenant_id, entity_id)` constraints for upsert support
- Row-Level Security (RLS) enabled on all 6 tables:
  - Staff/admin: read all rows
  - Client users: read only their tenant_id rows
  - Service role: full access (for GAS write-through)
- Indexes on `tenant_id`, `item_id`, and `status` columns
- Auto-updating `updated_at` triggers (reuses Phase 1 function)
- Realtime enabled for all 6 tables

### 2. StrideAPI.gs Write-Through (v36.0.0)
**New helpers:**
- `supabaseUpsert_(table, data)` — single-row upsert via REST API
- `supabaseBatchUpsert_(table, rows)` — batch upsert (chunks of 200)
- `supabaseDelete_(table, filter)` — delete by filter
- `sbInventoryRow_()`, `sbTaskRow_()`, `sbRepairRow_()`, `sbWillCallRow_()`, `sbShipmentRow_()`, `sbBillingRow_()` — row builders
- `syncEntityToSupabase_(entityType, tenantId, data)` — single entity sync
- `resyncEntityToSupabase_(entityType, tenantId, entityId)` — re-read from sheet + sync
- `api_writeThrough_(r, entityType, tenantId, entityId)` — response-aware resync
- `api_fullClientSync_(tenantId, entityTypes)` — full client sync for complex operations

**Write-through wired into all 23 doPost handlers:**
- Simple mutations (completeTask, startTask, cancelTask, updateInventoryItem, etc.) → `resyncEntityToSupabase_` for the specific entity
- Complex mutations (completeShipment, transferItems, processWcRelease, etc.) → `api_fullClientSync_` for all affected entity types
- All write-through is best-effort — never blocks the sheet write or API response

### 3. Bulk Import Endpoint
- `handleBulkSyncToSupabase_(payload)` — admin-only POST endpoint
- Reads all 6 tabs from all active clients (or a specific client via `clientSheetId`)
- Batch upserts to Supabase in chunks of 200 rows
- Returns per-client counts and any errors
- Called via: `postBulkSyncToSupabase(clientSheetId?)` from React

### 4. Reconciliation Endpoint
- `handleReconcileSupabase_(payload)` — admin-only POST endpoint
- Compares row counts per client per table between sheets and Supabase
- If drift detected and `dryRun=false`, does a full re-sync for that client+table
- Returns drift details per client per table
- Called via: `postReconcileSupabase(clientSheetId?, dryRun?)` from React

### 5. React Read Cache Layer (supabaseQueries.ts)
- `isSupabaseCacheAvailable()` — checks if Supabase tables have data (cached for session)
- `fetchInventoryFromSupabase()` — returns `InventoryResponse` shape
- `fetchTasksFromSupabase()` — returns `TasksResponse` shape
- `fetchRepairsFromSupabase()` — returns `RepairsResponse` shape
- `fetchWillCallsFromSupabase()` — returns `WillCallsResponse` shape
- `fetchShipmentsFromSupabase()` — returns `ShipmentsResponse` shape
- `fetchBillingFromSupabase()` — returns `BillingResponse` shape (with summary)
- `fetchDashboardSummaryFromSupabase()` — returns `BatchSummaryResponse` shape

### 6. React Hooks Updated (Supabase-first reads)
All 6 entity hooks + Dashboard summary now:
1. Check BatchDataContext first (client users — unchanged)
2. Try Supabase read cache (50-100ms) if available
3. Fall back to GAS API (3-44s) as last resort

Updated hooks: `useInventory`, `useTasks`, `useRepairs`, `useWillCalls`, `useShipments`, `useBilling`, `useDashboardSummary`

### 7. React API Functions
- `postBulkSyncToSupabase(clientSheetId?)` — trigger bulk sync
- `postReconcileSupabase(clientSheetId?, dryRun?)` — trigger reconciliation

## Files Changed

| File | Version | Change |
|------|---------|--------|
| `supabase-phase3-setup.sql` | NEW | SQL migration for 6 tables + RLS + indexes |
| `AppScripts/stride-api/StrideAPI.gs` | v36.0.0 | Write-through helpers, bulk sync, reconciliation |
| `stride-gs-app/src/lib/supabaseQueries.ts` | NEW | Supabase query layer |
| `stride-gs-app/src/lib/api.ts` | updated | Bulk sync + reconciliation API functions |
| `stride-gs-app/src/hooks/useInventory.ts` | updated | Supabase-first reads |
| `stride-gs-app/src/hooks/useTasks.ts` | updated | Supabase-first reads |
| `stride-gs-app/src/hooks/useRepairs.ts` | updated | Supabase-first reads |
| `stride-gs-app/src/hooks/useWillCalls.ts` | updated | Supabase-first reads |
| `stride-gs-app/src/hooks/useShipments.ts` | updated | Supabase-first reads |
| `stride-gs-app/src/hooks/useBilling.ts` | updated | Supabase-first reads |
| `stride-gs-app/src/hooks/useDashboardSummary.ts` | updated | Supabase-first reads |

## Deployment Steps

### Step 1: Run SQL migration in Supabase (ONE-TIME)
1. Go to https://supabase.com/dashboard/project/uqplppugeickmamycpuz/sql/new
2. Paste the contents of `supabase-phase3-setup.sql`
3. Click "Run"
4. Verify all 6 tables appear in Table Editor with RLS shield icon

### Step 2: Push StrideAPI.gs
```bash
cd "C:\Users\Justin\Dropbox\Apps\GS Inventory\AppScripts\stride-client-inventory"
npm run push-api
npm run deploy-api
```

### Step 3: Run Bulk Import (ONE-TIME)
After StrideAPI is deployed, trigger the bulk import to populate Supabase with existing data.
This can be done from the browser console or via curl — it's an admin-only POST to the API:
```
POST action=bulkSyncToSupabase
```
Or from React Settings page once wired (future).

### Step 4: Build + Deploy React App
```bash
cd "C:\Users\Justin\Dropbox\Apps\GS Inventory\stride-gs-app"
npm run build
cd dist
git add -A
git commit -m "Deploy: Supabase Phase 3 read cache"
git push origin main --force
```

### Step 5: Verify
1. Open https://www.mystridehub.com
2. Login as staff/admin
3. Navigate to Inventory, Tasks, etc. — should load in 50-100ms instead of 3-44s
4. Verify data matches what's in the sheets
5. Make a write operation (e.g., complete a task) and verify the Supabase table updates

## Architecture

```
Read Path (after Phase 3):
  React Hook → Supabase (50ms) → Display
  React Hook → GAS API (3-44s) → Display  [fallback if Supabase empty]

Write Path (unchanged + write-through):
  React → GAS API (POST) → Sheet Write → Supabase Upsert (best-effort)
                                        → Phase 2 Notification (best-effort)
                                        → Cache Invalidation

Bulk Sync (admin, on-demand):
  Admin → bulkSyncToSupabase → Read ALL sheets → Batch upsert to Supabase

Reconciliation (admin, on-demand):
  Admin → reconcileSupabase → Compare counts → Re-sync if drift
```

## Open Risks
- If GAS write succeeds but Supabase write-through fails, data drifts until next reconciliation
- Will Call items (WC_Items tab) are NOT mirrored to Supabase — loaded lazily via GAS API
- Folder URLs may be stale in Supabase cache (populated from sheet at sync time)
- Supabase free tier limits: 500MB database, 2GB bandwidth — sufficient for current 2-3K rows
- Parent user scope filtering via RLS relies on `clientSheetId` in user_metadata being correct
