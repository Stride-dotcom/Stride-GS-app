# Supabase Phase 1 Handoff Report — Failure Visibility + Retry

**Status:** COMPLETE ✅
**Deployed:** 2026-04-03
**GitHub commit:** `8dfa31a` (main)

---

## What Was Built

### 1. `supabase-phase1-setup.sql`
SQL to run in Supabase SQL Editor once. Creates:
- `gs_sync_events` table (id, tenant_id, entity_type, entity_id, action_type, sync_status, requested_by, request_id, payload jsonb, error_message, created_at, updated_at, confirmed_at)
- Indexes on `(tenant_id, sync_status)` and `(requested_by, sync_status)`
- `updated_at` auto-trigger
- RLS: users insert/read own rows; admin/staff read all via `user_metadata.role`
- Realtime publication (`ALTER PUBLICATION supabase_realtime ADD TABLE gs_sync_events`)

**Action required (one-time):** Justin must run `supabase-phase1-setup.sql` at:
https://supabase.com/dashboard/project/uqplppugeickmamycpuz/editor

### 2. `stride-gs-app/src/lib/syncEvents.ts`
Supabase write helpers:
- `writeSyncFailed(event)` — fire-and-forget, never throws
- `resolveSyncEvent(id)` — marks resolved (dismiss or retry-success)
- `fetchSyncFailures()` — returns all `sync_failed` rows visible to user (RLS-filtered)

### 3. `stride-gs-app/src/hooks/useFailedOperations.ts`
Single hook owned by AppLayout:
- Fetches on mount, subscribes to `postgres_changes` on `gs_sync_events`
- `retry(event)` — reconstructs API call with fresh `requestId`, resolves on success
- `dismiss(id)` — optimistic remove + `resolveSyncEvent`
- Returns `{ failures, loading, unresolvedCount, refetch, dismiss, retry }`

### 4. `stride-gs-app/src/components/shared/FailedOperationsDrawer.tsx`
Props-driven slide-in panel (420px, right edge):
- Per-row: entity badge, action, entity ID, timestamp, payload summary, error (amber=timeout, red=other)
- Retry button — shows spinner while retrying, shows green "Retry succeeded" or retry error
- Dismiss button — fire-and-forget resolve
- Footer hint for timeout errors ("check the sheet before retrying")
- Empty state: green checkmark "All clear"

### 5. `stride-gs-app/src/components/layout/AppLayout.tsx` (modified)
- Owns single `useFailedOperations()` instance (no duplicate Supabase subscriptions)
- Manages `failuresOpen` state
- Passes `failureCount` + `onOpenFailures` to both Sidebar instances (mobile + desktop)
- Renders `<FailedOperationsDrawer>` with all data/callbacks

### 6. `stride-gs-app/src/components/layout/Sidebar.tsx` (modified)
- New `failureCount` + `onOpenFailures` props
- AlertCircle button in bottom section, always visible
- Red badge with count when `failureCount > 0`
- Red text color on label when failures present; muted when zero

### 7. `stride-gs-app/src/lib/api.ts` (modified)
- `apiPost` now returns `requestId` on all paths (success and failure)
- 90-second AbortController timeout with sentinel `API_TIMEOUT_ERROR` message
- `AbortSignal.any()` merges timeout signal with caller signal
- Timeout errors are distinguishable from user-cancelled aborts

### 8. `stride-gs-app/src/contexts/AuthContext.tsx` (modified)
- After GAS resolves user role, calls `supabase.auth.updateUser({ data: { role, clientSheetId } })`
- Sets `user_metadata.role` so RLS policy grants admin/staff read-all access
- Fire-and-forget — never blocks login

### 9. `writeSyncFailed()` wired to all write error branches

**TaskDetailPanel:**
- `complete_task` (action: `complete_task`)
- `start_task` (action: `start_task`)
- `cancel_task` (action: `cancel_task`)

**RepairDetailPanel:**
- `send_repair_quote` (action: `send_repair_quote`)
- `respond_repair_quote` (action: `respond_repair_quote`)
- `start_repair` (action: `start_repair`)
- `complete_repair` (action: `complete_repair`)
- `cancel_repair` (action: `cancel_repair`)

**WillCallDetailPanel:**
- `cancel_will_call` (action: `cancel_will_call`)
- `process_wc_release` (action: `process_wc_release`)

Each failure record includes: full payload (with clientName, description, itemId, sidemark for context display), the original `requestId`, and the error message.

---

## What Still Needs to Happen

### Supabase SQL (Justin runs once)
```
1. Open: https://supabase.com/dashboard/project/uqplppugeickmamycpuz/editor
2. Paste contents of: supabase-phase1-setup.sql
3. Click Run
```
Until this is done, `writeSyncFailed()` calls will silently fail (fire-and-forget — no user impact), and the drawer will always show "All clear".

### Known Limitation: RLS via user_metadata
Phase 1 uses `auth.jwt()->'user_metadata'->>'role'` in the RLS SELECT policy to grant admin/staff read-all. `user_metadata` is user-modifiable in Supabase (unlike `app_metadata`). This is acceptable for Phase 1 since we control the app and the data is non-sensitive (error logs). Phase 2 plan: use service key to write to `app_metadata` instead.

### Not Yet Built (Phase 2+)
- Apps Script writing confirmed/failed events (currently only React writes `sync_failed`)
- Notification toast when new failure arrives (currently the badge updates silently)
- WriteSyncFailed for all write operations (currently only the 3 core detail panels are covered — missing: Receiving, CreateWillCallModal, CreateTaskModal, Settings write actions)
- Phase 2 confirmed events from Apps Script side

---

## Architecture Decision (No Duplicate Subscriptions)

The `useFailedOperations()` hook is called **exactly once** in `AppLayout`. It is never called inside `FailedOperationsDrawer` or `Sidebar`. Data flows down as props. This prevents duplicate Supabase Realtime subscriptions and duplicate fetches.

---

## File Summary

| File | Change |
|------|--------|
| `supabase-phase1-setup.sql` | **NEW** — run in Supabase SQL Editor |
| `src/lib/syncEvents.ts` | **NEW** |
| `src/hooks/useFailedOperations.ts` | **NEW** |
| `src/components/shared/FailedOperationsDrawer.tsx` | **NEW** |
| `src/lib/api.ts` | Modified — `requestId` return, 90s timeout |
| `src/contexts/AuthContext.tsx` | Modified — `user_metadata` sync |
| `src/components/layout/AppLayout.tsx` | Modified — hook + drawer wiring |
| `src/components/layout/Sidebar.tsx` | Modified — failure badge button |
| `src/components/shared/TaskDetailPanel.tsx` | Modified — writeSyncFailed on 3 errors |
| `src/components/shared/RepairDetailPanel.tsx` | Modified — writeSyncFailed on 5 errors |
| `src/components/shared/WillCallDetailPanel.tsx` | Modified — writeSyncFailed on 2 errors |
| `_backups/supabase-phase1-start/` | Backups of 4 pre-modification files |
