# Phase 2B Handoff Report — Dashboard Redesign

---

## A. Phase Completed
**Phase 2B — Dashboard Redesign**
All stages implemented, TypeScript clean, build successful, deployed to GitHub Pages.
Commit: `69d4405` — https://github.com/Stride-dotcom/Stride-GS-app

---

## B. Goal of This Phase
Replace the old Dashboard (which used heavy full-dataset hooks from BatchDataContext) with a lightweight, cross-client job board. The new Dashboard:
- Shows **all clients' open jobs** in a single view (no ClientSelector)
- Uses the already-deployed `getBatchSummary` GAS endpoint (lightweight summaries, 60s CacheService TTL)
- Provides three tabs: **Tasks** (default), **Repairs**, **Will Calls**
- Polls every 10 seconds with a `document.hidden` guard
- Lets users click any row to navigate directly to the entity's detail panel on its page

---

## C. Files Backed Up Before Changes

| Backup File | Original |
|-------------|----------|
| `src/_backups/phase2b-start/Dashboard.backup.phase2b-start.tsx` | `src/pages/Dashboard.tsx` |

---

## D. Files Modified

| File | Change |
|------|--------|
| `src/lib/api.ts` | Added `SummaryTask`, `SummaryRepair`, `SummaryWillCall`, `BatchSummaryResponse` interfaces; added `fetchBatchSummary()` function |
| `src/pages/Dashboard.tsx` | **Full rewrite** — 3-tab TanStack Table dashboard replacing the old stat-card-only view |

---

## E. Files Created

| File | Purpose |
|------|---------|
| `src/hooks/useDashboardSummary.ts` | Hook wrapping `fetchBatchSummary`; manages AbortController, `hasFetched` ref (no spinner on silent polls), `refetch(noCache?)` |

---

## F. Exact Changes Made

### `src/lib/api.ts` — New types and fetch function

```typescript
export interface SummaryTask {
  taskId: string; clientName: string; clientSheetId: string;
  itemId: string; taskType: string; status: string; assignedTo: string;
  created: string; dueDate: string; startedAt: string;
  description: string; sidemark: string; location: string;
}
export interface SummaryRepair {
  repairId: string; clientName: string; clientSheetId: string;
  itemId: string; vendor: string; status: string; createdDate: string;
  quoteAmount: number | null; description: string; sidemark: string; location: string;
}
export interface SummaryWillCall {
  wcNumber: string; clientName: string; clientSheetId: string;
  status: string; pickupParty: string; createdDate: string;
  estPickupDate: string; itemCount: number; notes: string;
}
export interface BatchSummaryResponse {
  tasks: SummaryTask[]; repairs: SummaryRepair[]; willCalls: SummaryWillCall[];
  counts: { tasks: number; repairs: number; willCalls: number };
  summaryVersion: number;
  errors?: { client: string; spreadsheetId: string; error: string }[];
}
export function fetchBatchSummary(signal?: AbortSignal, noCache = false) {
  const extra: Record<string, string> = {};
  if (noCache) extra.noCache = '1';
  return apiFetch<BatchSummaryResponse>('getBatchSummary', extra, { signal });
}
```

### `src/hooks/useDashboardSummary.ts` — New hook

Key behaviors:
- **AbortController** cancels in-flight requests when a new fetch starts or component unmounts
- **`hasFetched` ref** — `setLoading(true)` only on the very first fetch; silent polls show no spinner
- **`refetch(noCache?)`** — if `noCache=true`, calls `setNextFetchNoCache()` before fetching to bypass the server's 60s CacheService
- Auto-fetches on mount (controlled by `autoFetch` param)

### `src/pages/Dashboard.tsx` — Full rewrite

**Architecture:**

```
Dashboard (main)
├── useDashboardSummary() — single hook, all 3 entity types
├── 10s polling (setInterval + document.hidden guard)
├── visibilitychange listener (resumes poll when tab becomes visible)
├── sessionStorage tab memory ('dash_active_tab')
├── Stat cards (3) — click to switch to entity tab
├── Tab bar — Tasks / Repairs / Will Calls with live count badges
└── Tab content (CSS display:none, never unmounts)
    ├── TasksTab — own useTablePreferences, useReactTable, useVirtualRows
    ├── RepairsTab — same pattern, lazy-loaded on first click
    └── WillCallsTab — same pattern, lazy-loaded on first click
```

**Default status filters per tab:**
- Tasks: `['Open', 'In Progress']`
- Repairs: `['Pending Quote', 'Quote Sent', 'Approved', 'In Progress']`
- Will Calls: `['Pending', 'Scheduled', 'Partial']`

**Lazy loading:**
```typescript
const [tabsLoaded, setTabsLoaded] = useState<Record<DashTab, boolean>>({
  tasks: true, repairs: false, willcalls: false,
});
// On tab click:
setTabsLoaded(prev => ({ ...prev, [tab]: true }));
// In render:
<div style={{ display: activeTab === 'tasks' ? 'block' : 'none' }}>
  {tabsLoaded.tasks && <TasksTab ... />}
</div>
```
This renders the sub-component once on first click, then hides/shows without unmounting (preserves scroll position and filter state).

**10s polling with hidden-tab guard:**
```typescript
useEffect(() => {
  if (!apiConfigured) return;
  const poll = setInterval(() => {
    if (document.hidden) return; // skip when tab is hidden
    refetch(false); // hits 60s server cache when warm
  }, POLL_INTERVAL_MS);
  const onVisible = () => { if (!document.hidden) refetch(false); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
}, [apiConfigured, refetch]);
```

**Manual sync button:**
```typescript
const handleManualSync = useCallback(() => {
  setRefreshing(true);
  refetch(true); // noCache=true → bypasses 60s CacheService
  setTimeout(() => setRefreshing(false), 3000);
}, [refetch]);
```

**Row navigation:**
```typescript
// Tasks tab row click:
navigate('/tasks', { state: { openTaskId: task.taskId, clientSheetId: task.clientSheetId } });
// Repairs tab row click:
navigate('/repairs', { state: { openRepairId: repair.repairId, clientSheetId: repair.clientSheetId } });
// Will Calls tab row click:
navigate('/will-calls', { state: { openWcId: wc.wcNumber, clientSheetId: wc.clientSheetId } });
```

**Column sets:**

Tasks: `taskId | taskType | taskStatus | itemId | description | assignedTo | clientName | sidemark | created`
Repairs: `repairId | repairStatus | itemId | description | vendor | quoteAmount | clientName | created`
Will Calls: `wcNumber | wcStatus | pickupParty | itemCount | clientName | estPickupDate | created`

All tabs support:
- Column drag-to-reorder (HTML5 drag, persisted via `useTablePreferences`)
- Column visibility toggle (Settings2 icon button)
- Multi-sort (click column headers)
- Status filter chips (multi-select, Clear button)
- Virtual rows via `useVirtualRows` for scroll performance

**Stat cards:**
- Open Tasks (blue) → click navigates to Tasks tab
- Active Repairs (orange) → click navigates to Repairs tab
- Pending Will Calls (purple) → click navigates to Will Calls tab
- Count is derived from the filtered data already in the hook (tasks/repairs/willCalls arrays are pre-filtered by the GAS endpoint to open statuses)

**Relative time display:**
- `lastFetched` tracked in hook; displayed as "X seconds ago / X minutes ago"
- 30s ticker (`setInterval` in `Dashboard`) updates the relative time string every 30s without re-fetching

---

## G. Build/Deploy Actions Performed

```
npx tsc --noEmit  # Two TS errors found (unused imports: mobileChipsRow, ColHeader) — fixed
npx tsc --noEmit  # Clean
npm run build     # Clean (1,150 KB bundle, gzip 273 KB)
cd dist && git add -A && git commit -m "Phase 2B..." && git push origin main --force
```

Deployed commit: `69d4405`

---

## H. Current Behavior After Changes

**Before Phase 2B:**
- Dashboard was a static stat-card view with counts from BatchDataContext (full dataset hooks)
- No per-entity table — clicking a stat card did nothing actionable
- Counts required all 6 datasets to be loaded

**After Phase 2B:**
- Dashboard is the primary cross-client job board for staff/admin
- Tasks tab loads immediately with Open + In Progress tasks across all clients
- Repairs and Will Calls tabs lazy-load on first click
- Each row is a clickable link to the entity's detail panel on its page
- Data auto-refreshes every 10 seconds (skips when browser tab hidden)
- Manual "Sync" button bypasses server cache for truly fresh data
- Stat cards show live counts from the summary data; clicking switches to the relevant tab
- `getBatchSummary` endpoint is lightweight (summary rows only, not full inventory payload)

---

## I. Testing Performed

TypeScript compilation verified clean after fixes. Build succeeded.

No runtime testing performed this session — app is deployed to https://www.mystridehub.com for manual verification.

**Recommended manual tests:**
1. Dashboard loads — Tasks tab is default, stat cards show correct counts
2. Click "Active Repairs" stat card — switches to Repairs tab
3. Repairs tab: data loads (lazy load fires on first click)
4. Click a task row — navigates to Tasks page with that task's detail panel open
5. Click a repair row — navigates to Repairs page with that repair's detail panel open
6. Click a WC row — navigates to Will Calls page with that WC's detail panel open
7. Wait 10s — data silently refreshes (no spinner)
8. Click "Sync" button — spinner appears, fresh data loads (bypasses server cache)
9. Switch browser tab away, wait 15s, return — data refreshes on tab restore
10. Filter chips — toggle status filters on/off; Clear resets to defaults
11. Column drag-to-reorder — drag a column header to new position, persists on refresh
12. Column visibility toggle (Settings2 icon) — hide/show columns per tab
13. "X seconds ago" display — updates every 30s without re-fetching
14. Mobile view — check responsive layout (single column, scrollable table)

---

## J. Problems / Risks / Warnings

1. **GAS endpoint already deployed.** `getBatchSummary` was deployed in a prior session (StrideAPI.gs v32.2.0+). No GAS changes were needed for Phase 2B. If the endpoint is missing or errors, the Dashboard will show an error state.

2. **Field name differences vs. entity hooks:** GAS summary endpoint uses `taskType` (not `svcCode`), `estPickupDate` (not `scheduledDate`), `createdDate` on repairs/WCs (not `created`). The Dashboard types (`SummaryTask`, `SummaryRepair`, `SummaryWillCall`) match the GAS output exactly — they are NOT the same as the full entity types used on Tasks.tsx, Repairs.tsx, etc.

3. **Cross-client view only on Dashboard.** The Dashboard shows all clients. There is no ClientSelector on the Dashboard. This is intentional — the Dashboard is the staff job board. Clients viewing the Dashboard will see only their own data (server-side scoped by `getAccessibleClientScope_`).

4. **Lazy-load tabs are never unmounted.** After first click, a tab's sub-component stays mounted even when hidden. This is intentional (preserves filter/scroll state) but means all three `useTablePreferences` instances are active once all tabs have been visited.

5. **Poll interval is 10s but server cache TTL is 60s.** Most polls will hit CacheService and return in <200ms. Only the manual Sync button (noCache=true) bypasses the cache. This is correct behavior — frequent polls without cache would hammer the GAS API.

6. **Bundle size warning (1,150 KB):** Vite warns about chunk size. This is a known issue across all pages — TanStack Table + all page components in one chunk. No action needed for Phase 2B (pre-existing).

---

## K. Open Items / Remaining Work

**Phase 2B is complete.** Remaining items:

- [ ] Verify `getBatchSummary` returns correct data shapes in production (test with real clients)
- [ ] Consider adding "Assigned to me" quick filter on Tasks tab (future)
- [ ] Consider showing repair quote amounts as currency formatted (future)
- [ ] Consider adding search/filter by client name across all tabs (future)
- [ ] Phase 3: Column visibility persistence, global search improvements, print-optimized views

---

## L. Documentation Updates

CLAUDE.md Architectural Decision #50 (Edit/Save mode) and the completed work section should be updated to note Phase 2B completion. The `useDashboardSummary` hook uses the same `hasFetched` ref pattern established in Phase 2B — worth noting for future hook authors.

---

## M. Next Recommended Phase

**Phase 3 — Polish & Print:**
- Column visibility defaults per page (admin vs. client presets)
- Global search: include shipments, billing, claims in results
- Print-optimized inventory view (full client list without pagination cap)
- "All rows" page size option when filtered to single client (fixes Known Issue: Inventory page capped at 100 rows)

**OR short-win items from Known Issues:**
- Fix `populateUnbilledReport_()` in Code.gs.js (wrong header names "Billing Status", "Service Date")
- Fix `CB13_addBillingStatusValidation()` looking for "Billing Status" instead of "Status"

---

## N. Reviewer Notes

**Why `useDashboardSummary` instead of reusing `useDashboardSummary` from BatchDataContext:**
The existing `BatchDataContext` fetches 6 full entity datasets (tasks, repairs, WCs, inventory, shipments, billing) — that's the entire warehouse state. The Dashboard only needs summary rows. `getBatchSummary` returns lightweight structs (10-15 fields per entity, no billing rows, no inventory items) for all clients combined. Using BatchDataContext for the Dashboard would load 5× more data than needed and share the poll timer with all other pages.

**Why CSS `display:none` instead of conditional render for tab switching:**
Conditional render (`{activeTab === 'repairs' && <RepairsTab />}`) would unmount and remount the tab component on each switch — losing filter state, scroll position, and triggering a new `useTablePreferences` initialization. The `tabsLoaded` guard + CSS `display:none` ensures: (a) tabs don't render until first visited, and (b) once rendered they stay mounted and just hide/show.

**`hasFetched` ref pattern:**
```typescript
const hasFetched = useRef(false);
// In doFetch:
if (!hasFetched.current) setLoading(true); // only show spinner on FIRST load
// After successful fetch:
hasFetched.current = true;
```
This prevents the loading spinner from flashing on every 10-second poll after the initial load. Users only see the spinner on the first page load or after a hard reset.
