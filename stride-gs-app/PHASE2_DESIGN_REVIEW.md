# Phase 2 Design Review — Stride GS App Performance Architecture

**Status:** DESIGN CONFIRMED — Ready for implementation
**Date:** 2026-04-02 (updated with confirmed user requirements)
**Scope:** Phase 2A (Single-Client Loading) · Phase 2B (Tabbed Dashboard) · Phase 2C (Optimistic UI — all fields)

---

## Confirmed Design Decisions

All open questions from the original draft have been answered. This section records the final decisions. Do not re-open these.

| # | Question | Confirmed Answer |
|---|----------|-----------------|
| Q1 | Dashboard data source | **All clients always.** Dashboard = task board showing everything open. Requires new `getBatchSummary` GAS endpoint (Option B). |
| Q2 | Staff rollout | **Empty state is fine for entity pages.** Dashboard is the exception — always shows all clients, no ClientSelector on Dashboard. |
| Q3 | Stat cards | **All clients** — dashboard is all-clients by design. Counts aggregate across all accessible clients. |
| Q4 | Polling interval | **10 seconds on dashboard.** Creator sees changes instantly via optimistic update. Other users see changes within one cache TTL cycle (~60s max). This is the compromise within GAS constraints (no WebSocket). |
| Q5 | Tab memory | **sessionStorage during session, default to Tasks tab on new login.** Not localStorage — each login starts fresh on Tasks. |
| Q6 | Optimistic scope | **ALL data changes.** Every field edit, every status change, every create operation updates the UI immediately. Cross-entity updates required (completing a task updates the task AND its linked inventory item's derived state). Full design in Section 5. |

---

## Table of Contents

1. [Root Cause Analysis](#1-root-cause-analysis)
2. [Phase 1 Changes Already Deployed](#2-phase-1-changes-already-deployed)
3. [Phase 2A — Single-Client Page Loading (Entity Pages)](#3-phase-2a--single-client-page-loading-entity-pages)
4. [Phase 2B — Tabbed Dashboard (All Clients)](#4-phase-2b--tabbed-dashboard-all-clients)
5. [Phase 2C — Optimistic UI (All Fields, All Operations)](#5-phase-2c--optimistic-ui-all-fields-all-operations)
6. [Implementation Order](#6-implementation-order)
7. [Risk Register](#7-risk-register)
8. [File Impact Matrix](#8-file-impact-matrix)
9. [What Does NOT Change](#9-what-does-not-change)

---

## 1. Root Cause Analysis

### The Performance Problem

Execution Log confirmed timing for a staff user completing a task:

```
doPost (completeTask)        →   16.6s  — Apps Script writes to sheet
doGet  (silentRefetchBatch)  →   44.4s  — re-opens ALL ~60 client spreadsheets
UI reflects new status       →   ~61s after user clicks
```

**Root cause:** `handleGetBatch_` calls `SpreadsheetApp.openById()` for every client
spreadsheet. ~60 clients = ~60 file opens. GAS CacheService (600s TTL) makes reads
fast when cache is warm, but every write call bypasses the cache via `noCache=1`
(required to avoid showing stale data), forcing a full cold re-open.

**Why `noCache=1` is unavoidable after writes:**
The cache holds the pre-write snapshot. If we read from cache after a write, we show
the old status. Correct behavior requires bypassing the cache after mutations.

**The `batchEnabled` structural problem:**

`BatchDataContext.tsx` line 60:
```ts
const batchEnabled = !!user && isApiConfigured();
// TRUE for EVERY user — staff, admin, client, parent
// For a client with 1 sheet: getBatch = 3-6s ✓
// For a staff member with 60 clients: getBatch = 44s ✗
```

### The Two-Part Fix

**Fix A (Phase 2A/2B):** Disable `batchEnabled` for non-client users. Route staff through
individual `fetchXxx(signal, clientSheetId)` calls for entity pages (3–6s). Build a
new lightweight `getBatchSummary` endpoint for the Dashboard (20–25s cold, 2–4s cached).

**Fix B (Phase 2C):** Apply optimistic patches to local state before the API responds.
UI updates in one render cycle (<16ms). Server write happens in background (6–16s).
Rollback only fires on error. Net user-perceived delay = ~0ms.

---

## 2. Phase 1 Changes Already Deployed

Do not re-implement. These are live.

### Fix 1 — BatchDataContext.tsx (silent mount refresh)

```ts
// BEFORE: showed loading spinner even with cached data
doFetch(true)
// AFTER: silent=true, no spinner during mount background refresh
doFetch(true, false, true)
```

### Fix 2 — ID-Based Selected State (all entity pages)

Applied to Tasks.tsx, Repairs.tsx, WillCalls.tsx, Inventory.tsx:

```ts
// BEFORE: snapshot became stale after silentRefetchBatch
const [selectedTask, setSelectedTask] = useState<Task | null>(null);

// AFTER: auto-updates when tasks[] refreshes
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
const selectedTask = useMemo(
  () => tasks.find(t => t.taskId === selectedTaskId) ?? null,
  [tasks, selectedTaskId]
);
```

Backups in `src/_backups/phase1-bugfix/`.

---

## 3. Phase 2A — Single-Client Page Loading (Entity Pages)

### 3.1 Goal

Entity pages (Tasks, Repairs, WillCalls, Inventory, Shipments) default to empty for
staff/admin/parent users. A ClientSelector dropdown lets them pick one client to load.
Single-client users are unaffected. The Dashboard is the exception — it always shows
all clients (handled in Phase 2B with the summary endpoint).

### 3.2 Current Code State

**`BatchDataContext.tsx` — the root switch:**
```ts
// Line 60 — current
const batchEnabled = !!user && isApiConfigured();
```

When `batchEnabled = true` (all users currently):
- All hooks consume `batchData` (from `handleGetBatch_` — 44s cold)
- `shouldFetchIndividual = !batchEnabled = false` — individual API calls never fire

When `batchEnabled = false` (after Phase 2A, for non-client users):
- All hooks fall through to `fetchXxx(signal, clientSheetId)` via `useApiData`
- Response: 3–6s (opens 1 spreadsheet, reads 1 tab)
- `autoFetch && shouldFetchIndividual` = `autoFetch && true` — fires when autoFetch=true

**`useTasks.ts` — individual fetch path (currently dormant for staff):**
```ts
// Line 67-68
const clientSheetId = clientFilter ?? filterClientSheetId;
// clientFilter = useClientFilter() → returns undefined for staff/admin
// So for staff: clientSheetId = undefined ?? filterClientSheetId = filterClientSheetId
// This works — filterClientSheetId from the page component will be used correctly

const shouldFetchIndividual = !batchEnabled;

const fetchFn = useCallback(
  (signal?: AbortSignal) => fetchTasks(signal, clientSheetId),
  [clientSheetId]
);

// useApiData fires when: autoFetch && shouldFetchIndividual
// After Phase 2A: shouldFetchIndividual=true for staff, autoFetch=!!selectedClientId from page
```

Same pattern in `useRepairs.ts`, `useWillCalls.ts`, `useInventory.ts`, `useShipments.ts`.

**`Tasks.tsx` — route state navigation gap:**
```ts
// Line 139-147 — current
useEffect(() => {
  const state = location.state as { openTaskId?: string } | null;
  if (state?.openTaskId && tasks.length > 0) {
    //                      ^^^^^^^^^^^^^^^^ PROBLEM: after Phase 2A, tasks[] is always
    //                                       empty until client selected → panel never opens
```

**`Dashboard.tsx` — missing clientSheetId in navigate():**
```ts
// Line 278 — current
navigate('/tasks', { state: { openTaskId: row._navId } });
//                                        ^^^^^^^^^^^^^ MISSING clientSheetId
// Entity page won't know which client to auto-select
```

### 3.3 Changes Required

#### Change 1 — `BatchDataContext.tsx` (1 line)

```ts
// BEFORE
const batchEnabled = !!user && isApiConfigured();

// AFTER
const batchEnabled = !!user && isApiConfigured()
  && user.role === 'client'
  && !user.isParent
  && (user.accessibleClientSheetIds?.length ?? 0) <= 1;
```

**Effect:** Only single-account non-parent client users use getBatch. Everyone else
uses individual fetch endpoints. Client users: zero change.

#### Change 2 — New Component: `src/components/ClientSelector.tsx`

```tsx
interface ClientSelectorProps {
  value: string | null;
  onChange: (clientSheetId: string) => void;
  placeholder?: string;
  autoSelectSingle?: boolean; // auto-select if user has only 1 accessible client
}

export function ClientSelector({ value, onChange, placeholder, autoSelectSingle }: ClientSelectorProps) {
  const { clients } = useClients();

  useEffect(() => {
    if (autoSelectSingle && clients.length === 1 && !value) {
      onChange(clients[0].clientSheetId);
    }
  }, [clients, value, autoSelectSingle, onChange]);

  return (
    <select value={value ?? ''} onChange={e => e.target.value && onChange(e.target.value)}>
      <option value="">{placeholder ?? 'Select a client to load data'}</option>
      {clients.map(c => (
        <option key={c.clientSheetId} value={c.clientSheetId}>{c.name}</option>
      ))}
    </select>
  );
}
```

Rendered only when `user.role !== 'client'` or `user.isParent`. Invisible to regular
single-client users. Does NOT appear on Dashboard (Q2 confirmed).

#### Change 3 — Per-Page `selectedClientId` State + Hook Args

Each entity page gets:
```ts
const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
const pendingOpenRef = useRef<string | null>(null);

// Hook calls change from:
const { tasks } = useTasks(apiConfigured);
// To:
const { tasks } = useTasks(
  !!selectedClientId,              // autoFetch: false until client picked
  selectedClientId ?? undefined    // filterClientSheetId: scopes the API call
);
```

**Pages and hook counts:**
- `Tasks.tsx` — 1 hook (useTasks)
- `Repairs.tsx` — 1 hook (useRepairs)
- `WillCalls.tsx` — 1 hook (useWillCalls)
- `Shipments.tsx` — 1 hook (useShipments)
- `Inventory.tsx` — 6 hooks (useInventory, useTasks, useRepairs, useWillCalls, useShipments, useBilling)

The existing client name dropdown in `Inventory.tsx` (filters over already-loaded data)
is **replaced** by `ClientSelector` that drives the fetch. Do not have two separate
client pickers on the same page.

#### Change 4 — Empty State UX

```tsx
// Pattern for all entity pages (staff/admin/parent only)
const { user } = useAuth();
const showClientSelector = user?.role !== 'client' || user?.isParent;

if (showClientSelector && !selectedClientId) {
  return (
    <div>
      <ClientSelector value={null} onChange={setSelectedClientId} />
      <p>Select a client above to load data</p>
    </div>
  );
}
// Normal page content below
```

#### Change 5 — Navigation State Fix (Critical for Phase 2B Integration)

**Problem A — Dashboard doesn't pass clientSheetId (fix in Dashboard.tsx):**
```ts
// WorkRow already has _clientSheetId field — just add it to state:
navigate('/tasks', {
  state: {
    openTaskId: row._navId,
    clientSheetId: row.original._clientSheetId,
  }
});
```

**Problem B — Entity page route handler fails when tasks[] empty (fix in all entity pages):**
```ts
// Effect 1: fires once on mount, reads route state, auto-selects client
useEffect(() => {
  const state = location.state as { openTaskId?: string; clientSheetId?: string } | null;
  if (!state) return;

  if (state.clientSheetId && !selectedClientId) {
    setSelectedClientId(state.clientSheetId);
    if (state.openTaskId) pendingOpenRef.current = state.openTaskId;
    window.history.replaceState({}, '');
  } else if (state.openTaskId && tasks.length > 0) {
    // Legacy: clientSheetId not in state but data already loaded
    const match = tasks.find(t => t.taskId === state.openTaskId);
    if (match) setSelectedTaskId(match.taskId);
    window.history.replaceState({}, '');
  }
}, [location.state]); // intentionally no other deps — runs once on navigation

// Effect 2: fires when tasks[] arrives after client auto-select
useEffect(() => {
  if (pendingOpenRef.current && tasks.length > 0) {
    const match = tasks.find(t => t.taskId === pendingOpenRef.current);
    if (match) setSelectedTaskId(match.taskId);
    pendingOpenRef.current = null;
  }
}, [tasks]);
```

Same pattern for Repairs (`openRepairId`), WillCalls (`openWcId`), Inventory (`openItemId`).

#### Change 6 — Write Actions Refetch Correctly After Phase 2A

All write handler `onSuccess` callbacks currently call `silentRefetchBatch()`.
After Phase 2A, for staff `batchEnabled=false` so that call is a no-op.

```ts
// Pattern change in all write handler onSuccess callbacks
onSuccess: () => {
  if (batchEnabled) {
    silentRefetchBatch(); // client users: 1 sheet, fast
  } else {
    setNextFetchNoCache();
    refetch(); // staff: just the relevant hook for selectedClientId (3-6s)
  }
}
```

Grep targets: all `silentRefetchBatch()` call sites in `src/pages/` and
`src/components/shared/` — wrap each in the conditional above.
`batchEnabled` is exposed by `useBatchData()`, already imported in most files.

### 3.4 Phase 2A Risks

**R-2A-1: Inventory.tsx has 6 hooks — one missed hook breaks data**
After editing, verify each of the 6 hook calls has `!!selectedClientId` as autoFetch
and `selectedClientId ?? undefined` as filterClientSheetId. TypeScript will not catch
a wrong argument value, only wrong type. Manual review required.

**R-2A-2: Write handlers not updated**
If any write handler still calls `silentRefetchBatch()` without the batchEnabled guard,
staff users' UI won't update after writes. Grep all call sites before shipping.

**R-2A-3: pendingOpenRef — entity not found in client**
If the task specified in route state doesn't belong to the auto-selected client, the
panel just won't open. No crash, no error. Acceptable — can only happen if route state
is stale or corrupted.

---

## 4. Phase 2B — Tabbed Dashboard (All Clients)

### 4.1 Goal

The Dashboard is the "task board" — staff see everything open across all clients.
It has three tabs: Tasks | Repairs | Will Calls. Each tab:
- Shows data from ALL accessible clients (no ClientSelector on Dashboard)
- Uses the same TanStack Table UX as entity pages (column drag-reorder, multi-sort, visibility toggle)
- Defaults to open/active statuses only (completed and cancelled hidden by default)
- Lazy-loads tabs 2 and 3 (Repairs, Will Calls don't load until first click)
- Row click navigates to entity page with detail panel pre-opened
- Polls every **10 seconds** for real-time multi-user updates
- Has a manual sync button (same pattern as entity pages)

### 4.2 The `getBatchSummary` GAS Endpoint (New — Required by Q1)

#### Why a New Endpoint

The existing `handleGetBatch_` (used by clients' batch path) reads all entity types
with full field sets, including RichTextValue reads for folder URLs. For ~60 clients,
this takes 44s cold. The Dashboard needs all clients but doesn't need folder URLs, notes,
or billing fields — only the columns displayed in the table.

A new `handleGetBatchSummary_` endpoint reads only the lightweight columns, skipping
RichTextValue operations entirely. Estimated improvement: **44s → 20–25s cold**.
With 60s CacheService TTL, subsequent polls return in **2–4s**.

#### Endpoint Design

**Action:** `getBatchSummary`
**Method:** GET
**Cache TTL:** 60s (shorter than regular endpoints' 600s — Dashboard needs fresher data)
**Cache key:** `summary:{scopeKey}` where scopeKey = caller email hash or role scope

```javascript
// StrideAPI.gs — new handler
function handleGetBatchSummary_(e) {
  var SUMMARY_CACHE_TTL = 60;
  var callerEmail = e.parameter.email || '';
  var noCache = e.parameter.noCache === '1';

  var scope = getAccessibleClientScope_(callerEmail);
  // For staff/admin: all clients
  // For parent: own + children
  // For single client: own sheet only (same as getBatch — fine, rarely hits this endpoint)

  var cacheKey = 'summary:' + getScopeCacheKey_(scope);

  if (!noCache) {
    var cached = getCachedChunked_(cacheKey);
    if (cached) return jsonResponse_({ ok: true, data: cached });
  }

  var result = { tasks: [], repairs: [], willCalls: [], counts: {}, fetchedAt: new Date().toISOString() };

  for (var i = 0; i < scope.length; i++) {
    var client = scope[i];
    try {
      var ss = SpreadsheetApp.openById(client.spreadsheetId);
      var clientName = client.name;
      var clientSheetId = client.spreadsheetId;

      appendLightweightTasks_(ss, clientName, clientSheetId, result.tasks);
      appendLightweightRepairs_(ss, clientName, clientSheetId, result.repairs);
      appendLightweightWillCalls_(ss, clientName, clientSheetId, result.willCalls);
    } catch (err) {
      // Log error but continue — one bad client shouldn't break the dashboard
      Logger.log('Summary error for ' + client.name + ': ' + err.message);
    }
  }

  result.counts = {
    tasks: result.tasks.length,
    repairs: result.repairs.length,
    willCalls: result.willCalls.length,
  };

  setCachedChunked_(cacheKey, result, SUMMARY_CACHE_TTL);
  return jsonResponse_({ ok: true, data: result });
}
```

**Lightweight read functions — columns only (no RichTextValue reads):**

```javascript
// Tasks: only these columns (skip folder URLs, notes, billing)
// Task ID | Status | Svc Code | Item ID | Description | Assigned To
// Client Name | Sidemark | Created | Started At | Completed At | Cancelled At | Result
function appendLightweightTasks_(ss, clientName, clientSheetId, out) {
  var sheet = ss.getSheetByName('Tasks');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var hm = headerMapFromRow_(data[0]);
  // read only needed columns by header name
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var taskId = row[hm['Task ID']] || '';
    if (!taskId) continue;
    out.push({
      taskId: String(taskId),
      status: row[hm['Status']] || '',
      svcCode: row[hm['Svc Code']] || '',
      type: row[hm['Svc Code']] || '',
      itemId: String(row[hm['Item ID']] || ''),
      description: row[hm['Description']] || '',
      assignedTo: row[hm['Assigned To']] || '',
      clientName: clientName,
      clientSheetId: clientSheetId,
      sidemark: row[hm['Sidemark']] || '',
      created: row[hm['Date Created']] ? Utilities.formatDate(new Date(row[hm['Date Created']]), 'UTC', 'yyyy-MM-dd') : '',
      startedAt: row[hm['Start Date']] ? Utilities.formatDate(new Date(row[hm['Start Date']]), 'UTC', 'yyyy-MM-dd') : '',
      completedAt: row[hm['Completion Date']] ? Utilities.formatDate(new Date(row[hm['Completion Date']]), 'UTC', 'yyyy-MM-dd') : '',
      result: row[hm['Result']] || '',
    });
  }
}
// Similar pattern for appendLightweightRepairs_ and appendLightweightWillCalls_
```

**Cache invalidation after writes:**

All write endpoints in StrideAPI.gs that modify Tasks/Repairs/WillCalls must
additionally clear the summary cache key after their normal `invalidateCache_()`:

```javascript
// In handleCompleteTask_, handleStartTask_, handleCompleteRepair_, etc. — add:
var summaryKey = 'summary:' + getScopeCacheKey_(getAccessibleClientScope_(callerEmail));
CacheService.getScriptCache().remove(summaryKey);
// If multiple scope keys exist (staff vs parent users), ideally clear all
// Practical approach: clear 'summary:staff' and 'summary:all' as known keys
// Or: add a lightweight global summary version key that increments on any write
```

**Practical cache invalidation approach — version counter:**

Instead of computing scope keys, use a global version counter:

```javascript
// On any write that affects Tasks/Repairs/WillCalls:
var cache = CacheService.getScriptCache();
var currentVer = parseInt(cache.get('summary_version') || '0');
cache.put('summary_version', String(currentVer + 1), 21600); // 6h TTL

// In handleGetBatchSummary_:
var summaryVer = CacheService.getScriptCache().get('summary_version') || '0';
var cacheKey = 'summary:v' + summaryVer; // version-scoped key
// When version changes, all summary cache entries are effectively invalidated
// (new version key = cache miss for all users)
```

This approach ensures that any write immediately invalidates ALL users' summary caches
regardless of their scope, without needing to enumerate scope keys.

#### React Side — New Hook: `useDashboardSummary`

```ts
// src/hooks/useDashboardSummary.ts
import { useCallback, useMemo, useState } from 'react';
import { fetchBatchSummary } from '../lib/api';
import { useApiData } from './useApiData';
import type { Task, Repair, WillCall } from '../lib/types';

export interface DashboardSummaryResult {
  tasks: Task[];
  repairs: Repair[];
  willCalls: WillCall[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
  // Optimistic operations (Phase 2C)
  applyTaskPatch: (taskId: string, patch: Partial<Task>) => void;
  clearTaskPatch: (taskId: string) => void;
  addOptimisticTask: (task: Task) => void;
  removeOptimisticTask: (taskId: string) => void;
  // Same for repairs, willCalls
}

export function useDashboardSummary(autoFetch = true): DashboardSummaryResult {
  // ...fetches getBatchSummary endpoint
  // ...maps to Task/Repair/WillCall types
  // ...includes optimistic patch state (Phase 2C)
}
```

`fetchBatchSummary` is a new function in `src/lib/api.ts`:
```ts
export async function fetchBatchSummary(signal?: AbortSignal, noCache = false) {
  return apiFetch<BatchSummaryResponse>('getBatchSummary', { noCache: noCache ? '1' : undefined }, signal);
}
```

### 4.3 Tab Architecture

**No ClientSelector on Dashboard.** The Dashboard always loads all accessible clients.
This is the confirmed answer to Q2. The ClientSelector only appears on entity pages.

```ts
// Dashboard.tsx state
type DashTab = 'tasks' | 'repairs' | 'willcalls';

// Active tab — sessionStorage, default 'tasks' on fresh login
// Q5: sessionStorage (not localStorage) so each login starts on Tasks
const [activeTab, setActiveTab] = useState<DashTab>(() => {
  const saved = sessionStorage.getItem('dash_active_tab');
  return (saved as DashTab) || 'tasks';
});

// Track which tabs have been visited for lazy loading
const [tabsLoaded, setTabsLoaded] = useState<Record<DashTab, boolean>>({
  tasks: true,
  repairs: false,
  willcalls: false,
});

const handleTabChange = (tab: DashTab) => {
  setActiveTab(tab);
  setTabsLoaded(prev => ({ ...prev, [tab]: true }));
  sessionStorage.setItem('dash_active_tab', tab);
};
```

**Data source — single hook for all three tabs:**

The `useDashboardSummary` hook fetches all three entity types in one `getBatchSummary`
call. Data is split by the component into the three tab tables:

```ts
const {
  tasks, repairs, willCalls,
  loading, error, refetch, lastFetched,
  applyTaskPatch, clearTaskPatch, addOptimisticTask, removeOptimisticTask,
  // ...etc
} = useDashboardSummary(apiConfigured);

// Tasks tab: filter tasks by status
const tabTasks = useMemo(() =>
  tasks.filter(t => {
    if (activeStatusFilters.tasks.length === 0) return true; // "all" state
    return activeStatusFilters.tasks.includes(t.status);
  }), [tasks, activeStatusFilters.tasks]);
```

Single API call for all three tabs = one spreadsheet-open cycle. Lazy-loading by tab
is for UX (don't show all three at once) not for performance (the data is already fetched).

### 4.4 TanStack Table Per Tab (Same Pattern as Entity Pages)

Each tab is a separate `useReactTable` instance with:
- Own column definitions and `DEFAULT_COL_ORDER`
- Own `useTablePreferences` keyed `'dashboard-tasks'`, `'dashboard-repairs'`, `'dashboard-willcalls'`
- Own `dragColId` / `dragOverColId` state (each tab's drag is independent)
- `enableMultiSort: true` (same as entity pages)
- `useVirtualRows` for scroll performance (cross-client data can be 100+ rows)

**Column drag-to-reorder — identical HTML5 pattern from current Dashboard.tsx:**

The current Dashboard already has this implemented. Carry it forward to each per-tab
table instance without changes to the pattern. Each tab gets its own pair of drag state
variables so dragging in Tasks doesn't affect Repairs.

**Column visibility toggle:** Same Settings2 dropdown pattern per tab.

**Tab-specific default columns:**

Tasks tab — `useTablePreferences('dashboard-tasks', [{id: 'created', desc: true}], {}, [...])`:
```
Task ID | Type | Status | Item | Description | Assigned To | Client | Sidemark | Created
```

Repairs tab — `useTablePreferences('dashboard-repairs', [{id: 'createdDate', desc: true}], {}, [...])`:
```
Repair ID | Status | Item | Description | Repair Vendor | Quote | Client | Created
```

Will Calls tab — `useTablePreferences('dashboard-willcalls', [{id: 'scheduledDate', desc: false}], {}, [...])`:
```
WC # | Status | Contact | Items | Client | Scheduled Date | Sidemark
```

**No key collision with entity pages:** Entity pages use `'tasks'`, `'repairs'`, `'willcalls'`.
Dashboard tabs use `'dashboard-tasks'`, etc. `useTablePreferences` adds the `stride_table_{email}_`
prefix — fully distinct keys.

### 4.5 Default Status Filters (Open Statuses Only)

Each tab defaults to showing only actionable items. Users can clear to see all.
Stored via `useTablePreferences` `statusFilter` field — persisted per user per session.

```ts
// Tasks tab defaults
const DEFAULT_TASK_STATUSES = ['Open', 'In Progress'];

// Repairs tab defaults
const DEFAULT_REPAIR_STATUSES = ['Pending Quote', 'Quote Sent', 'Approved', 'In Progress'];

// Will Calls tab defaults
const DEFAULT_WC_STATUSES = ['Pending', 'Scheduled', 'Partial'];
```

On first visit (no saved preference), these defaults are active. User can click "Clear"
to see Completed/Cancelled. Their preference is remembered for the session.

### 4.6 Row Click → Navigate to Entity Page

```ts
// Tasks tab
const handleTaskRowClick = (task: Task) => {
  navigate('/tasks', {
    state: { openTaskId: task.taskId, clientSheetId: task.clientSheetId }
  });
};

// Repairs tab
const handleRepairRowClick = (repair: Repair) => {
  navigate('/repairs', {
    state: { openRepairId: repair.repairId, clientSheetId: repair.clientSheetId }
  });
};

// Will Calls tab
const handleWcRowClick = (wc: WillCall) => {
  navigate('/will-calls', {
    state: { openWcId: wc.wcNumber, clientSheetId: wc.clientSheetId }
  });
};
```

Entity pages receive `clientSheetId` from route state, auto-select that client via
the Phase 2A navigation fix (`pendingOpenRef`), and open the detail panel once data loads.

### 4.7 Real-Time Multi-User Updates

#### The GAS Constraint

GAS has no WebSocket or push mechanism. The only way other users see changes is polling.
The fastest option given CacheService:

- **Summary endpoint cache TTL: 60s**
- **Poll interval: 10s**
- **Most polls: cache hit → 2–4s response, table updates silently**
- **After a write: cache invalidated via version counter**
- **Next poll after invalidation: cache miss → 20–25s cold fetch (silent)**
- **Other users see changes within: ~10s (poll) + ~25s (cold fetch) = ~35s worst case**

This is the GAS ceiling. Creator sees change instantly via optimistic update (Q6).
Other users see change within ~35s. This is the confirmed compromise (Q4).

#### Polling Implementation

```ts
// In Dashboard.tsx
const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
const POLL_INTERVAL_MS = 10_000; // Q4 confirmed

useEffect(() => {
  if (!apiConfigured) return;

  const poll = setInterval(() => {
    if (document.hidden) return; // don't poll backgrounded tabs
    // Silent refetch — no loading spinner, table updates in-place
    refetch(); // useDashboardSummary.refetch() — does NOT call setNextFetchNoCache()
               // so it hits CacheService if warm, cold-fetches if stale
    setLastSyncedAt(new Date());
  }, POLL_INTERVAL_MS);

  return () => clearInterval(poll);
}, [apiConfigured, refetch]);

// Resume on tab visibility restore
useEffect(() => {
  const handleVisible = () => {
    if (!document.hidden && apiConfigured) {
      refetch();
      setLastSyncedAt(new Date());
    }
  };
  document.addEventListener('visibilitychange', handleVisible);
  return () => document.removeEventListener('visibilitychange', handleVisible);
}, [apiConfigured, refetch]);
```

**Note:** The poll calls the hook's `refetch()` but NOT `setNextFetchNoCache()`.
This means polls hit the server-side CacheService when warm (fast). Only the manual
sync button calls `setNextFetchNoCache()` to force a truly fresh fetch.

#### Manual Sync Button

```tsx
const [syncingNow, setSyncingNow] = useState(false);

const handleManualSync = () => {
  setSyncingNow(true);
  setNextFetchNoCache(); // bypass server cache
  refetch();             // shows loading spinner (not silent)
  setLastSyncedAt(new Date());
  setTimeout(() => setSyncingNow(false), 3_000);
};

// "Last synced N ago" display — updates every 30s
// Position: top-right of toolbar, next to column visibility toggle
// <RefreshCw size={14} style={syncingNow ? { animation: 'spin 1s linear infinite' } : undefined} />
// "Updated 23s ago"
```

#### Conflict Prevention

The existing LockService + conflict detection in `handleStartTask_` is sufficient.
Dashboard shows current status from the last poll. TaskDetailPanel already shows the
"Already assigned to X — reassign?" conflict banner when two users click Start on the
same task between polls.

No additional conflict UI is needed on the Dashboard itself.

### 4.8 Stat Cards

Four stat cards above the tabs, counting across all accessible clients:

```ts
const stats = useMemo(() => ({
  openTasks: tasks.filter(t => t.status === 'Open' || t.status === 'In Progress').length,
  openRepairs: repairs.filter(r =>
    !['Complete', 'Cancelled', 'Declined'].includes(r.status)
  ).length,
  pendingWCs: willCalls.filter(wc =>
    ['Pending', 'Scheduled', 'Partial'].includes(wc.status)
  ).length,
}), [tasks, repairs, willCalls]);
```

"Active Items" stat card is removed or shows "--" — Dashboard does not load inventory
(would require a 4th summary category). Consider replacing with "Shipments This Week"
or leaving as a link to the Inventory page.

### 4.9 Phase 2B Risks

**R-2B-1: Cold fetch on first Dashboard load**
First login (no cache): `getBatchSummary` takes 20–25s. Loading spinner required.
Subsequent visits: cache hit → 2–4s. Users will notice first-load latency.
Mitigation: Show a skeleton loader with placeholder rows (not a full blank spinner).

**R-2B-2: 60s cache TTL vs write invalidation timing**
If a write happens and the cache-invalidation fails (GAS error), the summary cache
holds stale data for up to 60s. Version counter approach mitigates this — version
change is a cache.put() which is low-risk.

**R-2B-3: Three separate `useReactTable` instances in one component**
Each requires its own `dragColId`/`dragOverColId` state, `useTablePreferences` call,
and `useVirtualRows` call. This is valid React (3 unconditional hook calls in fixed order).
Dashboard.tsx will be larger than entity pages — ~500 lines expected. Acceptable.

**R-2B-4: getBatchSummary missing from StrideAPI.gs — deploy required**
Phase 2B frontend cannot ship until the GAS endpoint is live. Implementation order
must deploy the endpoint FIRST, then build the React hook and component.

---

## 5. Phase 2C — Optimistic UI (All Fields, All Operations)

### 5.1 Confirmed Scope (Q6)

Every data change in the UI must update locally and instantly. The server takes
whatever time it needs. Full scope:

1. **Status changes:** start, complete, cancel tasks; approve/decline/complete/cancel repairs; release/cancel will calls
2. **Field edits:** notes, location, room, sidemark, reference, description, vendor, repair vendor, quote amount — all editable fields on all entity types
3. **Create operations:** create task, create repair quote, create will call, add items to will call
4. **Cross-entity propagation:** when a task completes, the linked inventory item's task history list also updates; when a WC releases, the linked inventory items' status also updates

### 5.2 Two Operation Types

The optimistic system handles two fundamentally different operations:

**Type 1 — UPDATE existing entity (field/status change)**
Known entity ID. Apply partial patch immediately. Clear patch after server confirms.

**Type 2 — CREATE new entity**
No real ID yet. Insert a temporary placeholder entity. Replace with real entity on server response. Remove on error.

### 5.3 Updated Hook Architecture

Each entity hook gains two independent layers of local state:

```ts
// Added to useTasks.ts (same pattern for useRepairs, useWillCalls, useInventory)

// Layer 1: Patches for existing entities
const [patches, setPatches] = useState<
  Record<string, { data: Partial<Task>; appliedAt: number }>
>({});

// Layer 2: Optimistically created entities (temp IDs)
const [optimisticCreates, setOptimisticCreates] = useState<Task[]>([]);

// Merged tasks array — Phase 1 already renamed the base as rawTasks conceptually
// Rename inside hook: apiTasks.map(mapToAppTask) → rawTasks (internal only)
const rawTasks = useMemo(() => apiTasks.map(mapToAppTask), [apiTasks]);

const tasks = useMemo(() => {
  const now = Date.now();

  // Apply patches to existing entities (auto-expire after 120s)
  const merged = rawTasks.map(t => {
    const p = patches[t.taskId];
    if (!p || now - p.appliedAt > 120_000) return t;
    return { ...t, ...p.data };
  });

  // Prepend optimistic creates (temp entities show at top of table)
  return [...optimisticCreates, ...merged];
}, [rawTasks, patches, optimisticCreates]);
```

**Exposed functions (added to hook return type):**

```ts
// Update patch for existing entity
const applyTaskPatch = useCallback((taskId: string, patch: Partial<Task>) => {
  setPatches(prev => ({
    ...prev,
    [taskId]: { data: patch, appliedAt: Date.now() },
  }));
}, []);

// Merge additional fields into existing patch (for multi-field edits)
const mergeTaskPatch = useCallback((taskId: string, patch: Partial<Task>) => {
  setPatches(prev => ({
    ...prev,
    [taskId]: {
      data: { ...(prev[taskId]?.data ?? {}), ...patch },
      appliedAt: Date.now(),
    },
  }));
}, []);

// Remove patch (server data takes over)
const clearTaskPatch = useCallback((taskId: string) => {
  setPatches(prev => {
    const next = { ...prev };
    delete next[taskId];
    return next;
  });
}, []);

// Add a full optimistic entity (create operations)
const addOptimisticTask = useCallback((task: Task) => {
  setOptimisticCreates(prev => [...prev, task]);
}, []);

// Remove optimistic entity (on success: server sends real data via refetch; on error: remove temp)
const removeOptimisticTask = useCallback((tempTaskId: string) => {
  setOptimisticCreates(prev => prev.filter(t => t.taskId !== tempTaskId));
}, []);
```

**Why `mergeTaskPatch` in addition to `applyTaskPatch`:**
For multi-field edits in detail panels, the user may blur field A (triggers save),
then immediately blur field B (triggers second save). `applyTaskPatch` would overwrite
the patch, losing field A. `mergeTaskPatch` accumulates all in-flight edits.

### 5.4 Complete Field Coverage by Entity

**Task — all patchable fields:**
```ts
Partial<Task> may include:
  status, assignedTo, result, taskNotes, location,
  startedAt, completedAt, cancelledAt, customPrice,
  // note: taskId, itemId, clientSheetId are identity fields — never patched
```

**Repair — all patchable fields:**
```ts
Partial<Repair> may include:
  status, repairVendor, quoteAmount, approvedAmount,
  notes, internalNotes, quoteSentDate, approvedDate,
  completedDate, assignedTo,
```

**Will Call — all patchable fields:**
```ts
Partial<WillCall> may include:
  status, scheduledDate, actualPickupDate, notes,
  pickupParty, pickupPartyPhone, itemCount,
  // items array updated for add/remove item operations
```

**Inventory Item — all patchable fields:**
```ts
Partial<InventoryItem> may include:
  vendor, description, itemClass, qty, location,
  sidemark, status, notes, itemNotes, reference,
  room, releaseDate,
```

### 5.5 Write Handler Pattern

Same structure for every write operation:

```ts
// Example: Start Task (TaskDetailPanel.tsx)
const handleStartTask = async () => {
  if (!selectedTaskId) return;

  // STEP 1: Apply optimistic patch immediately — UI updates in <16ms
  applyTaskPatch(selectedTaskId, {
    status: 'In Progress',
    assignedTo: user?.name ?? user?.email ?? 'Me',
    startedAt: new Date().toISOString(),
  });

  // STEP 2: Execute server write (button shows spinner, status already correct)
  await executeStartTask(async () => {
    const result = await postStartTask(selectedTaskId, assignedTo);
    if (!result.ok) throw new Error(result.error ?? 'Failed to start task');
    return result;
  });
};

// useAsyncAction options:
const executeStartTask = useAsyncAction(
  // fn defined above
  {
    onSuccess: () => {
      clearTaskPatch(selectedTaskId!);     // server data confirmed — remove patch
      // Refetch to sync server state
      batchEnabled ? silentRefetchBatch() : (() => { setNextFetchNoCache(); refetch(); })();
    },
    onError: () => {
      clearTaskPatch(selectedTaskId!);     // rollback — revert to server state
      // useAsyncAction already sets state='error' — existing error display handles the rest
    },
  }
);
```

**For field edits (blur-triggered saves):**
```ts
// ItemDetailPanel.tsx — Location field blur
const handleLocationBlur = (newValue: string) => {
  mergeTaskPatch(selectedTaskId!, { location: newValue }); // merge, not overwrite
  executeUpdateTask(async () => {
    await postUpdateInventoryItem(selectedItem!.itemId, { location: newValue });
    // Success: patch stays visible until next refetch (optimistic == real value)
    // We don't clear the patch on field edits — the server value matches anyway
  });
};
```

For field edits, the patch is NOT cleared on success (because the patched value IS
the real value — clearing it would briefly show the old value before the refetch).
The patch auto-expires at 120s, by which time the refetch has already loaded fresh data.

### 5.6 Create Operations — Temp ID Pattern

**Create Task:**
```ts
const handleCreateTasks = async (selectedTypes: string[]) => {
  const tempTasks: Task[] = selectedTypes.map((type, i) => ({
    taskId: `TEMP-${Date.now()}-${i}`,
    status: 'Open',
    type: type as ServiceCode,
    svcCode: type as ServiceCode,
    itemId: selectedItem!.itemId,
    description: selectedItem!.description,
    clientName: selectedItem!.clientName,
    clientSheetId: selectedItem!.clientSheetId,
    sidemark: selectedItem!.sidemark,
    location: selectedItem!.location,
    vendor: selectedItem!.vendor,
    created: new Date().toISOString().split('T')[0],
    billed: false,
    // isOptimistic flag for UI (show subtle visual indicator)
  } as Task & { isOptimistic: true }));

  // Show optimistic entities in table immediately
  tempTasks.forEach(t => addOptimisticTask(t));

  try {
    await executeBatchCreateTasks(async () => {
      const result = await postBatchCreateTasks(
        selectedItem!.clientSheetId,
        selectedItem!.itemId,
        selectedTypes
      );
      if (!result.ok) throw new Error(result.error ?? 'Failed to create tasks');
      return result;
    });
    // Success: remove temp entities, fetch real ones
    tempTasks.forEach(t => removeOptimisticTask(t.taskId));
    setNextFetchNoCache();
    refetchTasks(); // loads real Task IDs from server
  } catch {
    // Rollback: remove temp entities
    tempTasks.forEach(t => removeOptimisticTask(t.taskId));
  }
};
```

**Create Repair Quote:**
Same pattern with temp `repairId: 'TEMP-RPR-${Date.now()}'`, status 'Pending Quote'.

**Create Will Call:**
Temp `wcNumber: 'TEMP-WC-${Date.now()}'`, status 'Pending', items from selection.

**Transfer Items:**
No optimistic create. Too complex (affects two client sheets, which may not both be
loaded). Instead: show a processing overlay + disable source items in the table
via patch: `applyItemPatch(itemId, { status: 'Transferred' })` for each item.

### 5.7 Dashboard Optimistic Updates (Q1 Requirement)

"When a task is created from the app, it must appear on the dashboard instantly
for the user who created it."

`useDashboardSummary` has the same patch/create architecture as `useTasks`. The
Dashboard hook and the entity page hooks are **separate instances** — they don't share state.

After a write from an entity page that also affects the Dashboard:
1. The entity page's hook is patched (shows in Tasks table if user navigates there)
2. The Dashboard's `useDashboardSummary` is patched SEPARATELY from the component that made the write

**Cross-component optimistic patch:**
Entity pages and Dashboard are separate routes — they unmount when not active.
The Dashboard cannot be directly patched from the Tasks page.

**Solution:** Use a lightweight write-through cache in `src/lib/optimisticCache.ts`:

```ts
// src/lib/optimisticCache.ts — module-level singleton (not React state)
// Survives component unmounts, shared between all hook instances

type EntityPatch<T> = { data: Partial<T>; appliedAt: number };

const taskPatches = new Map<string, EntityPatch<Task>>();
const repairPatches = new Map<string, EntityPatch<Repair>>();
const wcPatches = new Map<string, EntityPatch<WillCall>>();
const itemPatches = new Map<string, EntityPatch<InventoryItem>>();
const taskCreates: Task[] = [];   // temp entities
// etc.

export function applyGlobalTaskPatch(taskId: string, patch: Partial<Task>) {
  taskPatches.set(taskId, { data: patch, appliedAt: Date.now() });
  emitPatchEvent(); // notify all hook instances to re-render
}

// Each hook subscribes via a React-friendly event:
// useEffect(() => { addEventListener('optimisticPatch', forceUpdate); ... }, []);
```

**Simpler alternative (recommended for Phase 2C):** After a write that creates a task,
the write handler calls `refetch()` on the Dashboard hook — but Dashboard is unmounted
(user is on Tasks page). The Dashboard will fetch fresh data on the next navigation to it.

**Practical approach for Dashboard optimistic creates:**
The Dashboard polls every 10s. When the user navigates to Tasks, creates a task, and
navigates back to Dashboard, the Dashboard will refetch on mount (it re-runs its
`useApiData` effect). By the time navigation completes, the server write may already
be done (6–16s), and the fresh data will show immediately.

If the user creates a task FROM THE DASHBOARD (e.g., via a FAB or modal on Dashboard),
then the optimistic patch IS in the same component tree and works directly:
```ts
addOptimisticTask(tempTask); // in useDashboardSummary
```

For cross-page creates (user creates on Tasks page, Dashboard sees it on next poll):
this is acceptable. The 10s poll ensures it appears within 10s of the write completing.

**Recommendation:** Do NOT build the global optimistic cache in Phase 2C. Implement
in-component optimistic updates only. Cross-page creates will appear on the Dashboard
within 10s via polling (write completes ~6–16s, next poll within 10s after that).
Total max delay for Dashboard: 26s. Document this as expected behavior.

### 5.8 Cross-Entity Update Propagation

#### What Already Works (No Extra Code)

Because `selectedLinkedTasks`, `selectedLinkedRepairs`, `selectedLinkedWillCalls` in
Inventory.tsx are derived from the same hook arrays via `useMemo`:

```ts
// Inventory.tsx (existing)
const selectedLinkedTasks = useMemo(
  () => selectedItem ? tasks.filter(t => t.itemId === selectedItem.itemId) : [],
  [selectedItem, tasks]
);
```

Patching a Task in `useTasks` automatically updates what's shown in ItemDetailPanel's
"Tasks" history section — no extra wiring needed. This is a free benefit of the ID-based
selected state + useMemo derivation from Phase 1.

**What automatically propagates:**
- Task status changes → visible in Tasks table + Inventory item's task history list
- Repair status changes → visible in Repairs table + Inventory item's repair history list
- WC status changes → visible in WillCalls table + Inventory item's WC history list

#### What Needs Explicit Cross-Entity Wiring

**Case 1 — WC Release updates inventory item status to Released**

When releasing a will call, inventory items assigned to it should show "Released":

```ts
// WillCallDetailPanel.tsx handleProcessRelease
// After applying WC patch:
applyWcPatch(wcNumber, { status: 'Released' });

// Also patch each item's status in useInventory:
wc.items.forEach(item => {
  if (item.released) {
    applyItemPatch(item.itemId, { status: 'Released', releaseDate: today });
  }
});
```

**Case 2 — Transfer removes items from source inventory**

```ts
// After postTransferItems:
selectedItems.forEach(item => {
  applyItemPatch(item.itemId, { status: 'Transferred' });
});
// Items with status 'Transferred' are typically filtered out of Active view
// They'll disappear from the Inventory table immediately
```

**Case 3 — Completing a task updates Inventory item's Task Notes**

`taskNotes` on the Inventory row is a server-aggregated field (concatenated summaries
of all completed tasks). We cannot compute this locally without all task history.
**Approach:** Do NOT patch this field. Accept that `taskNotes` on the Inventory row
updates on the next refetch (after `silentRefetch` or next poll). This is acceptable
because the task itself reflects the completion instantly — the inventory item's
aggregated note is a secondary display.

#### Cross-Hook Access

To patch `useInventory` from `WillCallDetailPanel`:
- WillCallDetailPanel already receives `applyItemPatch` from `useInventory`
- Inventory.tsx passes it down as a prop

Pattern:
```tsx
// Inventory.tsx
const { items: liveItems, applyItemPatch, clearItemPatch } = useInventory(
  !!selectedClientId, selectedClientId ?? undefined
);

// Passed to ItemDetailPanel, which passes to sub-panels that need it
<ItemDetailPanel
  ...
  applyItemPatch={applyItemPatch}
  clearItemPatch={clearItemPatch}
/>
```

For WillCallDetailPanel opened from the WillCalls page (not Inventory), `applyItemPatch`
is not available (useInventory is not loaded on WillCalls page). Acceptable: inventory
item status updates on the next Inventory page visit or refetch.

### 5.9 Rollback UX

**For status changes:**
On error: `clearTaskPatch(taskId)` → task reverts to pre-patch server state.
`useAsyncAction` shows the error message. No additional UI needed.

**For field edits:**
On error: `mergeTaskPatch` is NOT cleared (the user's intent was to make that edit).
Instead: show an inline error on the field ("Save failed — retrying...").
Option: clear the patch and show "Edit failed — your change was not saved."
**Recommended:** clear the patch on field-edit errors too. Data integrity > UX.

**For create operations:**
On error: `removeOptimisticTask(tempId)` → temp entity disappears from table.
Error toast: "Failed to create task — please try again."

**For transfers:**
On error: `clearItemPatch(itemId)` for each item → items revert to Active/non-Transferred status.

### 5.10 Optimistic UX Indicators (Optional but Recommended)

Temp entities (TEMP- ID prefix) can show a subtle visual indicator so users know
the server confirmation is pending:

```tsx
// In table cell rendering:
if (row.original.taskId.startsWith('TEMP-')) {
  // Show spinner in Task ID cell, faint opacity on row
  return <span style={{ opacity: 0.7 }}><Loader2 size={12} /> Creating...</span>;
}
```

Patched entities (status change in progress): no visual indicator needed — the status
badge already shows the new value. Users assume it's real. If rollback happens, the
badge reverts — this is clear enough.

### 5.11 Phase 2C Implementation Checklist

**Hooks (add patch architecture):**
- [ ] `useTasks.ts` — add patches, optimisticCreates, applyTaskPatch, mergeTaskPatch, clearTaskPatch, addOptimisticTask, removeOptimisticTask; rename internal derived array to `rawTasks`; update return type interface
- [ ] `useRepairs.ts` — same pattern
- [ ] `useWillCalls.ts` — same pattern
- [ ] `useInventory.ts` — same pattern (applyItemPatch needed for cross-entity WC release)
- [ ] `useDashboardSummary.ts` (new) — include patch architecture (same pattern)

**Status changes (Priority 1):**
- [ ] `TaskDetailPanel.tsx` — Start Task, Complete Task, Cancel Task
- [ ] `RepairDetailPanel.tsx` — Approve Quote, Decline Quote, Start Repair, Complete Repair, Cancel Repair
- [ ] `WillCallDetailPanel.tsx` — Process Release (partial + full), Cancel WC

**Field edits (Priority 2):**
- [ ] `ItemDetailPanel.tsx` — all 10 editable fields (vendor, description, class, qty, location, sidemark, status, notes, reference, room)
- [ ] `TaskDetailPanel.tsx` — location, task notes, custom price
- [ ] `RepairDetailPanel.tsx` — repair vendor, quote amount, notes
- [ ] `WillCallDetailPanel.tsx` — scheduled date, contact, notes

**Create operations (Priority 3):**
- [ ] `CreateTaskModal.tsx` — add optimistic task insert
- [ ] Repair quote request — add optimistic repair insert
- [ ] `CreateWillCallModal.tsx` — add optimistic WC insert

**Cross-entity propagation (Priority 4):**
- [ ] `WillCallDetailPanel.tsx` — on release, patch each inventory item's status
- [ ] Transfer Items — on success, patch each item's status to Transferred
- [ ] Accept that Inventory taskNotes does NOT get instant cross-entity update

**TypeScript:**
- [ ] Update `UseTasksResult`, `UseRepairsResult`, `UseWillCallsResult`, `UseInventoryResult` interfaces
- [ ] `npx tsc --noEmit` must pass clean before deployment

### 5.12 Phase 2C Risks

**R-2C-1: `rawTasks` rename breaks internal useTasks references**
The useMemo that produces `tasks` from `apiTasks.map(mapToAppTask)` must be renamed
internally to `rawTasks` before the patch-merge useMemo is added. Any variable named
`tasks` inside the hook before the rename would shadow the export. TypeScript will
catch most cases but review carefully.

**R-2C-2: `mergeTaskPatch` vs `applyTaskPatch` confusion**
Wrong choice (apply instead of merge on multi-field panels) overwrites prior field.
Document at call sites: use `mergeTaskPatch` for all blur-triggered saves;
use `applyTaskPatch` only for atomic single-operation patches (status changes).

**R-2C-3: Temp entity appears in wrong location**
`optimisticCreates` are prepended to the array (show at top). If the table is sorted
by date, the temp entity sorts by `created: new Date()` which puts it first. This is
actually the correct UX — newly created tasks should appear at top. Acceptable.

**R-2C-4: Patch auto-expiry (120s) fires before write completes**
If a write takes >120s (shouldn't happen — GAS has a 6-minute execution limit and
writes are typically 6–16s), the patch expires and the UI reverts. Next refetch shows
correct state. Acceptable edge case.

**R-2C-5: Cross-entity WillCallDetailPanel on WillCalls page can't patch inventory**
`useInventory` is not loaded when user is on WillCalls page. Releasing a WC won't
instantly update inventory item statuses when viewing from WillCalls. Only affects
the Inventory page view — acceptable. Document as known limitation.

**R-2C-6: Temp ID collisions**
`TEMP-${Date.now()}-${i}` — millisecond precision + index. Two users creating tasks
simultaneously could theoretically generate the same temp ID. Temp IDs are component-local
(useState, not shared) so collision is impossible in practice. Safe.

**R-2C-7: Create operations on Dashboard need same patch hooks**
`useDashboardSummary` must implement the same patch/create architecture as `useTasks`.
If the hook is built without this, Dashboard optimistic creates won't work.
Mitigation: build the hook with patch architecture from the start.

---

## 6. Implementation Order

### Prerequisites

```
Phase 2B backend (GAS) MUST deploy BEFORE Phase 2B frontend
  ↓
Phase 2A MUST deploy BEFORE Phase 2B frontend (nav fix required)
  ↓
Phase 2B frontend MUST deploy and stabilize BEFORE Phase 2C
  ↓
Phase 2C Priority 1 (status changes) BEFORE Priority 2-4
```

### Step-by-Step

#### Stage 1 — GAS Backend (Phase 2B prerequisite)

```
1.  StrideAPI.gs: add handleGetBatchSummary_ handler
2.  StrideAPI.gs: add appendLightweightTasks_, appendLightweightRepairs_,
                  appendLightweightWillCalls_ helpers
3.  StrideAPI.gs: add summary_version cache counter + increment in all write handlers
                  (completeTask, startTask, completeRepair, etc.)
4.  npm run push-api && npm run deploy-api
5.  Test endpoint directly: GET ?action=getBatchSummary&token=xxx&email=xxx
    Verify response shape, timing, and cache TTL behavior
```

#### Stage 2 — Phase 2A (Entity Page Single-Client Loading)

```
6.  BatchDataContext.tsx: batchEnabled logic change (1 line)
7.  ClientSelector.tsx: new component
8.  Tasks.tsx: selectedClientId state + hook args + nav fix (Effects 1+2) + write refetch fix
9.  Repairs.tsx: same
10. WillCalls.tsx: same
11. Shipments.tsx: same
12. Inventory.tsx: same (6 hooks + nav fix)
13. npx tsc --noEmit → must pass clean
14. npm run build && deploy to GitHub Pages
15. TEST: staff user sees ClientSelector → picks client → data loads in 3-6s
16. TEST: client user sees no ClientSelector → batch loads as before
17. TEST: Dashboard row click → entity page auto-selects client → detail panel opens
```

#### Stage 3 — Phase 2B (Tabbed Dashboard)

```
18. src/lib/api.ts: add fetchBatchSummary function
19. src/hooks/useDashboardSummary.ts: new hook (no patch system yet — add in Stage 5)
20. Dashboard.tsx: full rewrite
    - 3-tab layout (Tasks | Repairs | Will Calls)
    - One useDashboardSummary call feeding all three tabs
    - Per-tab TanStack Table (column drag-reorder, multi-sort, col visibility)
    - useTablePreferences per tab (dashboard-tasks, dashboard-repairs, dashboard-willcalls)
    - Default status filters (open statuses only)
    - Polling at 10s + visibility resume + manual sync button
    - "Last synced X ago" display
    - sessionStorage tab memory
    - Row click with clientSheetId in navigate()
    - Stat cards from aggregated data
21. npx tsc --noEmit → must pass clean
22. npm run build && deploy
23. TEST: Dashboard loads all clients' open tasks/repairs/WCs
24. TEST: Each tab has column drag-reorder, multi-sort, status filter chips
25. TEST: Polling — make a write, wait ≤35s, verify Dashboard updates
26. TEST: Row click → entity page + detail panel opens correctly
27. TEST: sessionStorage tab memory (switch tabs, reload, tab stays)
```

#### Stage 4 — Phase 2C Priority 1 (Status Changes)

```
28. useTasks.ts: add patches state, optimisticCreates, patch functions, rawTasks rename, updated return type
29. useRepairs.ts: same
30. useWillCalls.ts: same
31. TaskDetailPanel.tsx: Start Task, Complete Task, Cancel Task — add applyTaskPatch/clearTaskPatch
32. RepairDetailPanel.tsx: Approve Quote, Decline Quote, Start Repair, Complete Repair, Cancel Repair
33. WillCallDetailPanel.tsx: Release WC (full + partial), Cancel WC
    Also: applyItemPatch for inventory items on release (if useInventory accessible)
34. npx tsc --noEmit → must pass clean
35. npm run build && deploy
36. TEST: Start Task → status badge changes to "In Progress" in <1s, before server responds
37. TEST: Simulate error → status reverts immediately
38. TEST: Complete Task → status shows "Completed" instantly, detail panel closes/updates
```

#### Stage 5 — Phase 2C Priority 2 (Field Edits)

```
39. useInventory.ts: add patch architecture
40. useDashboardSummary.ts: add patch architecture
41. ItemDetailPanel.tsx: all 10 editable fields — use mergeTaskPatch on blur
42. TaskDetailPanel.tsx: location, notes, custom price — use mergeTaskPatch
43. RepairDetailPanel.tsx: vendor, quote amount, notes
44. WillCallDetailPanel.tsx: scheduled date, contact, notes
45. npx tsc --noEmit → deploy → test all field edits
```

#### Stage 6 — Phase 2C Priority 3 (Create Operations)

```
46. CreateTaskModal.tsx: add optimistic task insert (addOptimisticTask)
47. Repair quote request: addOptimisticRepair
48. CreateWillCallModal.tsx: addOptimisticWC
49. Deploy → test: create task → appears immediately in table with TEMP- indicator
    → indicator replaced with real ID after refetch
```

#### Stage 7 — Phase 2C Priority 4 (Cross-Entity)

```
50. WillCallDetailPanel.tsx: on release, iterate items and applyItemPatch({ status: 'Released' })
51. TransferItemsModal.tsx: on success, applyItemPatch({ status: 'Transferred' }) for each item
52. Deploy → test: release WC → inventory items show Released in Inventory table
```

---

## 7. Risk Register

| ID | Phase | Risk | Likelihood | Impact | Mitigation |
|----|-------|------|-----------|--------|------------|
| R-2A-1 | 2A | Inventory.tsx misses one of 6 hook arg updates | Low | Medium | After editing, grep for `useInventory\|useTasks\|useRepairs\|useWillCalls\|useShipments\|useBilling` in Inventory.tsx and verify each has updated args |
| R-2A-2 | 2A | Write handlers still call silentRefetchBatch() without batchEnabled guard | Medium | High | Grep `silentRefetchBatch` before deploying; wrap every call site |
| R-2A-3 | 2A | pendingOpenRef: entity not found in auto-selected client | Low | Low | Panel just doesn't open — not a regression vs current |
| R-2A-4 | 2A | Client users accidentally get batchEnabled=false | Very Low | High | batchEnabled check requires role=client AND !isParent AND accessibleIds.length<=1 — very explicit |
| R-2B-1 | 2B | getBatchSummary not deployed before Dashboard frontend | High | Blocking | Deploy GAS first (Stage 1) before any React work |
| R-2B-2 | 2B | Cold fetch on first Dashboard load (20-25s) | Certain | Medium | Show skeleton loader, not blank spinner; acceptable on first load |
| R-2B-3 | 2B | Summary cache invalidation fails, stale data for 60s | Low | Low | 60s TTL means auto-corrects quickly; version counter is a simple low-risk GAS operation |
| R-2B-4 | 2B | Three TanStack Table instances causes performance regression | Low | Low | Each table is small (<200 rows per tab); VirtualRows only if needed |
| R-2C-1 | 2C | rawTasks rename breaks internal useTasks references | Low | Low | TypeScript catches unused variables; review hook file carefully |
| R-2C-2 | 2C | mergeTaskPatch vs applyTaskPatch misuse overwrites fields | Medium | Low | Document at each call site; use mergeTaskPatch for blur-save, applyTaskPatch for status changes |
| R-2C-3 | 2C | Temp entity shows in wrong sort position | Very Low | Low | Temp entity created at now() → sorts to top by date; acceptable |
| R-2C-4 | 2C | Cross-page optimistic (Dashboard doesn't reflect entity page creates) | Certain | Low | 10s polling means visible within ~26s of write; documented expected behavior |
| R-2C-5 | 2C | WC release doesn't patch inventory items when on WillCalls page | Certain | Low | useInventory not loaded on WillCalls page; document as known limitation |
| R-2C-6 | 2C | Field edit error leaves stale patch | Low | Medium | Clear patch on field-edit errors; show "Save failed" inline |

---

## 8. File Impact Matrix

### Phase 2A — Backend (GAS, Stage 1)

| File | Change |
|------|--------|
| `AppScripts/stride-api/StrideAPI.gs` | Add `handleGetBatchSummary_`, lightweight read helpers, version counter, cache invalidation in write handlers |

### Phase 2A — React (Stage 2)

| File | Change Type | Notes |
|------|------------|-------|
| `src/contexts/BatchDataContext.tsx` | Edit | 1 line: batchEnabled logic |
| `src/components/ClientSelector.tsx` | **New** | ~60 lines |
| `src/pages/Tasks.tsx` | Edit | selectedClientId state, hook args, nav fix (2 effects), write refetch fix |
| `src/pages/Repairs.tsx` | Edit | Same |
| `src/pages/WillCalls.tsx` | Edit | Same |
| `src/pages/Shipments.tsx` | Edit | Same (simpler — 1 hook) |
| `src/pages/Inventory.tsx` | Edit | Same + 6 hooks + replace client name dropdown with ClientSelector |
| `src/pages/Dashboard.tsx` | Edit | Pass clientSheetId in navigate() calls only (full rewrite comes in Phase 2B) |

### Phase 2B — React (Stage 3)

| File | Change Type | Notes |
|------|------------|-------|
| `src/lib/api.ts` | Edit | Add `fetchBatchSummary` function |
| `src/hooks/useDashboardSummary.ts` | **New** | ~120 lines; no patch system yet (added Stage 5) |
| `src/pages/Dashboard.tsx` | **Full rewrite** | ~500 lines; 3-tab TanStack Tables, polling, manual sync, sessionStorage tab |

### Phase 2C — React (Stages 4–7)

| File | Change Type | Notes |
|------|------------|-------|
| `src/hooks/useTasks.ts` | Edit | +~80 lines: patches, optimisticCreates, 6 new functions, rawTasks rename, updated return type |
| `src/hooks/useRepairs.ts` | Edit | Same pattern |
| `src/hooks/useWillCalls.ts` | Edit | Same pattern |
| `src/hooks/useInventory.ts` | Edit | Same pattern (for cross-entity WC release) |
| `src/hooks/useDashboardSummary.ts` | Edit | Add patch architecture (after initial build) |
| `src/components/shared/TaskDetailPanel.tsx` | Edit | Start/Complete/Cancel — apply/clear patches |
| `src/components/shared/RepairDetailPanel.tsx` | Edit | Approve/Decline/Start/Complete/Cancel — patches |
| `src/components/shared/WillCallDetailPanel.tsx` | Edit | Release/Cancel — patches + cross-entity item patches |
| `src/components/shared/ItemDetailPanel.tsx` | Edit | All 10 editable fields — mergeItemPatch on blur |
| `src/pages/Tasks.tsx` | Edit | Destructure patch functions from useTasks |
| `src/pages/Repairs.tsx` | Edit | Same |
| `src/pages/WillCalls.tsx` | Edit | Same + applyItemPatch prop for detail panel |
| `src/pages/Inventory.tsx` | Edit | Same + pass applyItemPatch to detail panels |
| `src/components/CreateTaskModal.tsx` | Edit | addOptimisticTask before execute |
| `src/components/CreateWillCallModal.tsx` | Edit | addOptimisticWC before execute |
| `src/components/TransferItemsModal.tsx` | Edit | applyItemPatch({ status: 'Transferred' }) on success |

### No Changes (Confirmed)

| File | Reason |
|------|--------|
| `src/hooks/useAsyncAction.ts` | Optimistic wraps around it, not inside it |
| `src/hooks/useApiData.ts` | Already has silent mode, cache, abort |
| `src/hooks/useTablePreferences.ts` | Already supports all needed fields |
| `src/hooks/useClientFilter.ts` | Returns undefined for staff — correct |
| `src/lib/api.ts` (existing functions) | Already support clientSheetId param |
| `src/contexts/AuthContext.tsx` | Unchanged |
| All non-Dashboard entity pages — UX/layout | Only hook args + write handlers change |
| All detail panel layouts | Only write handlers + field save callbacks change |
| All GAS write endpoints (backend logic) | Unchanged; only add cache key invalidation call |

---

## 9. What Does NOT Change

### For Single-Client Users (role = 'client', non-parent, 1 account)

**Zero behavior change:**
- `batchEnabled = true` continues (Phase 2A condition preserves this)
- `getBatch` fires on login, all 6 entity types in one call
- No ClientSelector ever appears
- Performance identical to current
- All write flows identical

### Architecture Preserved

- All entity pages remain independent route-based pages (not embedded in Dashboard)
- Dashboard navigates to entity pages — does not embed detail panels
- TanStack Table pattern is the same across all 8 table pages + 3 dashboard tabs
- `useTablePreferences` key structure unchanged (dashboard tabs use new `dashboard-` prefix)
- Auth system (Supabase email+password) completely untouched
- All GAS backend endpoint logic unchanged (only adding new endpoint + cache invalidation)

### Already-Built Features That Continue Working

- Phase 1 ID-based selected state (Tasks, Repairs, WillCalls, Inventory)
- Edit/Save mode on ItemDetailPanel and TaskDetailPanel
- Resizable detail panels (`useResizablePanel`)
- Sidemark color highlighting
- Persistent status filters (`useTablePreferences` statusFilter)
- Column drag-to-reorder on all 8 TanStack Table pages
- Role-based access control (admin/staff/client nav + route guards)
- Mobile-responsive layout
- LockService conflict detection on startTask (existing conflict banner)
- Existing RefreshCw manual refresh on all entity pages

---

*End of Phase 2 Design Review*
*All open questions confirmed. Implementation ready to begin with Stage 1 (GAS backend).*
*Stages 1–7 must be completed in order. Do not skip validation steps between stages.*
