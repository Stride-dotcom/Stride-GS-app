# Supabase Phase 2 Handoff Report — Apps Script → Supabase Notifications

**Status:** COMPLETE ✅
**Deployed:** 2026-04-03
**StrideAPI.gs version:** v35.0.0 (Web App v114)
**GitHub commit:** `fdb1b79` (main)

---

## What Was Built

### 1. `StrideAPI.gs` — 4 new functions (v35.0.0)

**`setupSupabaseProperties_()`**
- Sets `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in Script Properties programmatically.
- **Justin must run this once** from the Apps Script editor after push-api deploys v35.

**`notifySupabaseConfirmed_(params)`**
- Best-effort POST to `gs_sync_events` with `sync_status: "confirmed"`.
- `UrlFetchApp.fetch` with `muteHttpExceptions: true` — never throws, never blocks.
- Sets `confirmed_at` and `updated_at` timestamps.
- Reads `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from Script Properties.

**`notifySupabaseFailed_(params)`**
- Best-effort POST with `sync_status: "sync_failed"`.
- NOT auto-wired to doPost handlers — React Phase 1 already writes these from the client side. Wiring GAS too would create duplicate entries in the FailedOperationsDrawer.
- Available for future use: background triggers, scheduled jobs, GAS-internal failures React cannot observe.

**`api_notifySupabase_(response, context)`**
- Called at the `doPost` routing level after each handler + `invalidateClientCache_()`.
- Parses the TextOutput response (`response.getContent()`), checks `json.success && !json.skipped`.
- If successful, calls `notifySupabaseConfirmed_()` with the context params.
- All errors silently logged — never throws, never affects the response returned to React.

### 2. `StrideAPI.gs` doPost — 14 wired cases

All write handlers now call `api_notifySupabase_()` between cache invalidation and `return r`:

| Case | entity_type | entity_id source | action_type |
|------|------------|-----------------|------------|
| `completeTask` | `task` | `payload.taskId` | `complete_task` |
| `startTask` | `task` | `payload.taskId` | `start_task` |
| `cancelTask` | `task` | `payload.taskId` | `cancel_task` |
| `sendRepairQuote` | `repair` | `payload.repairId` | `send_repair_quote` |
| `respondToRepairQuote` | `repair` | `payload.repairId` | `respond_repair_quote` |
| `startRepair` | `repair` | `payload.repairId` | `start_repair` |
| `completeRepair` | `repair` | `payload.repairId` | `complete_repair` |
| `cancelRepair` | `repair` | `payload.repairId` | `cancel_repair` |
| `createWillCall` | `will_call` | `""` (resolved from response json.wcNumber) | `create_will_call` |
| `processWcRelease` | `will_call` | `payload.wcNumber` | `process_wc_release` |
| `cancelWillCall` | `will_call` | `payload.wcNumber` | `cancel_will_call` |
| `addItemsToWillCall` | `will_call` | `payload.wcNumber` | `add_items_to_will_call` |
| `removeItemsFromWillCall` | `will_call` | `payload.wcNumber` | `remove_items_from_will_call` |
| `updateInventoryItem` | `inventory` | `payload.itemId` | `update_inventory_item` |
| `transferItems` | `inventory` | `""` (multiple items) | `transfer_items` |

`tenant_id` = `effectiveId` (the resolved `clientSheetId`), `requested_by` = `callerEmail`, `request_id` = `payload.requestId`.

### 3. `stride-gs-app/src/lib/entityEvents.ts` (NEW)

Tiny pub/sub emitter with zero React dependencies:
- `entityEvents.emit(entityType, entityId)` — called from `useFailedOperations` on confirmed rows
- `entityEvents.subscribe(fn)` → returns unsubscribe function — called from hooks / BatchDataContext
- Uses a `Set<callback>` — O(1) add/remove, safe for concurrent subscribers
- Entity types: `'task' | 'repair' | 'will_call' | 'inventory'`

### 4. `src/hooks/useFailedOperations.ts` (modified)

Extended the Supabase Realtime callback:
- If `payload.new?.sync_status === 'confirmed'`: calls `entityEvents.emit(entity_type, entity_id)` — triggers targeted refetches across all subscribers
- Otherwise (failed/pending): calls `refetch()` to update the failures list (unchanged behavior)

### 5. `src/contexts/BatchDataContext.tsx` (modified)

Added `entityEvents` subscription when `batchEnabled`:
```ts
useEffect(() => {
  if (!batchEnabled) return;
  return entityEvents.subscribe(() => { silentRefetchBatch(); });
}, [batchEnabled, silentRefetchBatch]);
```
- Client users (batch path): any confirmed event triggers a silent background batch refetch
- No loading state shown — data updates behind the scenes
- `batchEnabled` guard prevents double-fetch (individual hooks skip subscription when batchEnabled)

### 6. `src/hooks/useTasks.ts`, `useRepairs.ts`, `useWillCalls.ts`, `useInventory.ts` (modified)

Added entity-specific `entityEvents` subscriptions for the non-batch (staff/admin) path:
```ts
useEffect(() => {
  if (batchEnabled) return; // BatchDataContext handles its own subscription
  return entityEvents.subscribe((type) => {
    if (type === 'task') individualRefetch(); // (repair / will_call / inventory for other hooks)
  });
}, [batchEnabled, individualRefetch]);
```
- Staff/admin (individual fetch path): only refetch when their entity type fires
- `batchEnabled` guard prevents double-fetch with BatchDataContext subscription

---

## Architecture: No Duplicate Subscriptions

```
Supabase Realtime
    └── useFailedOperations (1 subscription, lives in AppLayout)
            ├── confirmed row → entityEvents.emit(type, id)
            └── failed/pending row → refetch failures list

entityEvents (in-memory pub/sub)
    ├── BatchDataContext subscriber (when batchEnabled=true)
    │       └── silentRefetchBatch() — 1 batch call for all client data
    └── useTasks / useRepairs / useWillCalls / useInventory (when batchEnabled=false)
            └── individualRefetch() — only when entity type matches
```

No component other than `AppLayout` subscribes to Supabase Realtime. All downstream reactivity flows through `entityEvents`.

---

## Manual Step Required (Justin)

After `npm run push-api` deploys v35.0.0:

1. Open Apps Script editor: https://script.google.com/home/projects/134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M/edit
2. In the function dropdown, select `setupSupabaseProperties_`
3. Click **Run**
4. Verify in Logger output: `"Supabase Script Properties set successfully."`

Until this runs, `notifySupabaseConfirmed_()` will silently return early (missing URL/key) and no confirmed events will be written to Supabase. The app continues to work normally — Phase 2 is best-effort.

---

## Also Deployed This Session: Auth Bug Fix

**Bug:** Phase 1 added `supabase.auth.updateUser({ data: { role, clientSheetId } })` inside `handleSession()`. Supabase fires `USER_UPDATED` on any `updateUser` call. The `onAuthStateChange` handler was unconditionally processing `USER_UPDATED` as password recovery, calling `handleSession('recovery')` a second time → "Access Denied" for all users.

**Fix:** Added `if (!recoveryRef.current) return;` guard inside the `USER_UPDATED` branch. Metadata-only updates are silently ignored. Only actual password recovery events (where `recoveryRef.current === true`) proceed.

**File:** `src/contexts/AuthContext.tsx`
**Commit:** `d7dd2f7`

---

## File Summary

| File | Change |
|------|--------|
| `AppScripts/stride-api/StrideAPI.gs` | v35.0.0 — 4 new functions + 14 doPost notification calls |
| `stride-gs-app/src/lib/entityEvents.ts` | **NEW** — pub/sub emitter |
| `stride-gs-app/src/hooks/useFailedOperations.ts` | Modified — emit entity events on confirmed rows |
| `stride-gs-app/src/contexts/BatchDataContext.tsx` | Modified — entityEvents subscription |
| `stride-gs-app/src/hooks/useTasks.ts` | Modified — entityEvents subscription (non-batch) |
| `stride-gs-app/src/hooks/useRepairs.ts` | Modified — entityEvents subscription (non-batch) |
| `stride-gs-app/src/hooks/useWillCalls.ts` | Modified — entityEvents subscription (non-batch) |
| `stride-gs-app/src/hooks/useInventory.ts` | Modified — entityEvents subscription (non-batch) |
| `stride-gs-app/src/contexts/AuthContext.tsx` | Modified — USER_UPDATED guard fix (commit d7dd2f7) |
| `_backups/supabase-phase2-start/` | Backups of 7 pre-modification files |

---

## What Still Needs to Happen

### Justin runs `setupSupabaseProperties_()` once
See Manual Step above. Without this, GAS notifications are silently skipped.

### Also: Run `supabase-phase1-setup.sql` if not done yet
The gs_sync_events table must exist in Supabase for both Phase 1 and Phase 2 to work.
Run at: https://supabase.com/dashboard/project/uqplppugeickmamycpuz/editor

### Phase 3 — Supabase Read Cache (Full Mirror)
- Create inventory/tasks/repairs/will_calls/shipments tables in Supabase
- Bulk import script (GAS reads all sheets → inserts to Supabase)
- Write-through: every GAS write also upserts to Supabase
- Switch React reads from GAS endpoints to Supabase queries (50-100ms vs 3-44s)

### Not Yet Built (Phase 2 scope excluded)
- `completeShipment` not wired — shipments are read-only in the React app (no status-change write actions from the UI currently)
- `batchCreateTasks` not wired — creates multiple tasks, entity_id would be a list
- Notification toast when new confirmed event arrives (badge updates silently — intentional for now)
