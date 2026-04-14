# Stride GS App — Build Status & Continuation Guide

**Last updated:** 2026-04-14 (session 63 — Deep-link blank-page fix + Item ID ledger Phases 1-3 + post-ship fixes: ledger error client names, useBilling loop, useClients context refactor)
**StrideAPI.gs:** v38.52.1 (Web App v263)
**Import.gs (client):** v4.2.1 (rolled out to all 6 clients, web apps v6–v22)
**Emails.gs (client):** v4.2.0 (rolled out to all 6 clients)
**Code.gs (client):** v4.6.0 (rolled out to all 6 clients, web apps deployed)
**StaxAutoPay.gs:** v4.5.0 (pushed to Stax Auto Pay bound script)
**Purpose:** Single living progress document. Updated every session.

> **BUILDERS: Read `CLAUDE.md` first** — it has architecture, rules, deployment table, invariants, and current open work.
> This doc covers: what currently exists in the React app, this session's changes, and the feature parity matrix.
> Historical session summaries moved to `Docs/Archive/Session_History.md`.

---

## BUILDER UPDATE RULES

**Update this file at the end of every session.** Replace — don't accumulate.

| Section | What to Do |
|---------|-----------|
| **Last updated** | Change the date + session number at the top |
| **StrideAPI.gs version** | Update if you changed the backend |
| **Recent Changes** | REPLACE with THIS session's changes only — move the previous session's changes out via `Docs/Archive/Session_History.md` (one line entry) |
| **Feature Parity Matrix** | Flip icons as features change state (✅/🟡/❌/🔲) |
| **Known Issues** | Add new bugs, remove fixed ones |

---

## WHAT EXISTS

### Live App
- **URL:** https://www.mystridehub.com (GitHub Pages, custom domain)
- **Repo:** https://github.com/Stride-dotcom/Stride-GS-app
- **Source:** `stride-gs-app/`
- **Tech:** Vite + React + TypeScript + TanStack Table + Lucide icons + HashRouter
- **Deploy:** `npm run build` → `cd dist && git add -A && git commit && git push origin main --force`

### Backend (Google Sheets + Apps Script)
- **System reference:** `CLAUDE.md` (read first)
- **Client inventory (modular):** `AppScripts/stride-client-inventory/src/` — 13 `.gs` files, `npm run rollout`
- **API:** `AppScripts/stride-api/StrideAPI.gs` — standalone project, v38.52.1 (Web App v263)
- **Stax Auto Pay:** `AppScripts/stax-auto-pay/StaxAutoPay.gs` — v4.5.0, bound to Stax spreadsheet
- **Supabase cache:** 6 mirror tables + `gs_sync_events` failure tracking + **`item_id_ledger`** (authoritative cross-tenant Item ID registry, session 63)

### 14 Pages Built
Login, Dashboard, Inventory, Receiving, Shipments, Tasks, Repairs, Will Calls, Billing, Payments/Stax, Claims, Settings, **Marketing** (admin-only), **Orders** (admin-only, DT integration). QR Scanner + Labels (iframe pages). All wired to live API — all mock data removed.

### Key Components
- Universal Search (⌘K)
- 7 detail panels: Item, Task, Repair, WillCall, Shipment, Claim, Billing
- Create Will Call / Add to WC / Release Items / Transfer Items / Client Onboarding / Create Task modals
- Pre-charge Validation Modal (real data, not mock), Payment/Customer Verification Panels
- LocationPicker, AutocompleteSelect (system-wide), MultiSelectFilter (new), FolderButton, WriteButton, BatchGuard, ProcessingOverlay, FailedOperationsDrawer
- Inline editing: EditableTextField, EditableTextarea, EditableSelect, EditableNumber, EditableLocation, EditableCell (currency prop)
- Floating Action Bars (role-aware)
- Resizable detail panels via `useResizablePanel` hook
- InfoTooltip — click-to-open help tooltips used across Billing, Payments, Marketing, OnboardClientModal

### API Layer (StrideAPI.gs v38.14.0+)

**Read endpoints:** `getClients`, `getPricing`, `getLocations`, `getInventory`, `getTasks`, `getRepairs`, `getWillCalls`, `getShipments`, `getShipmentItems`, `getBilling` (with sidemark resolution + server-side filters v38.13.0), `getClaims`, `getClaimDetail`, `getWcDocUrl`, `getUserByEmail`, `getUsers`, `getBatch`, `getAutoIdSetting`, `getItemMoveHistory`, `listIIFFiles` (reads IIF export folder from Drive), `getStaxInvoices` (returns isTest + autoCharge), `getStaxChargeLog`, `getStaxExceptions`, `getStaxCustomers`, `getStaxRunLog`, `getStaxConfig` (masked API key).

**Write endpoints:** completeShipment, completeTask, sendRepairQuote, respondToRepairQuote, completeRepair, startRepair, createWillCall, processWcRelease, cancelWillCall, updateWillCall, addItemsToWillCall, removeItemsFromWillCall, releaseItems, transferItems, generateStorageCharges (date-range overlap dedup v38.13.0), previewStorageCharges (same dedup), generateUnbilledReport, createInvoice, resendInvoiceEmail, onboardClient, updateClient, syncSettings, batchCreateTasks, startTask, fixMissingFolders, updateInventoryItem, getNextItemId, updateAutoIdSetting, requestRepairQuote, updateTaskCustomPrice, updateTaskNotes, syncAutocompleteDb, sendWelcomeEmail (direct GmailApp, no scripts.run) | Claims: 11 endpoints | Marketing: 15 endpoints | Stax: createTestInvoice, createStaxInvoices (url + due_at format fix), runStaxCharges (testMode + autoCharge gate), chargeSingleInvoice (testMode), voidStaxInvoice, deleteStaxInvoice, resetStaxInvoiceStatus, updateStaxInvoice, toggleAutoCharge, importIIFFromDrive, sendStaxPayLinks, sendStaxPayLink, updateStaxConfig (STAX_API_KEY allowed), saveStaxCustomerMapping, resolveStaxException (QB# primary match).

**Performance:** Server-side CacheService (600s TTL, chunked >100KB), cache invalidation on all writes. Folder URL reads always-on. Supabase-first reads (~50ms) with GAS fallback. `api_fetchWithRetry_` (exponential backoff on Drive 403/429/5xx). Filtered billing queries bypass cache.

### React Hooks
`useClients`, `usePricing`, `useLocations`, `useInventory`, `useTasks`, `useRepairs`, `useWillCalls`, `useShipments`, `useBilling` (accepts BillingFilterParams for report builder), `useClaims`, `useUsers`, `useOrders` (Supabase-only, DT integration), `useFailedOperations`, `useTablePreferences` (reconciles new columns into saved order), `useResizablePanel`, `useSidebarOrder`, `useIsMobile`, `useBatchData`.

---

## RECENT CHANGES (2026-04-14 session 63)

### Session 63: Deep-link blank-page fix + Item ID ledger Phases 1–3

Two independent tracks shipped in one session. Full forensic writeup for each is in `Docs/Archive/Session_History.md` — this section keeps the operational details future builders need.

**Live artifacts after this session:**
- React bundle: `index-BFRgl5Rm.js` (commit `2e91aa6`) — final of 5 deploys this session
- StrideAPI.gs: **v38.52.1** → Web App **v263**
- Supabase migration: `stride-gs-app/supabase/migrations/20260414180000_item_id_ledger.sql` applied
- New table: `public.item_id_ledger` (4,054 rows backfilled)
- New view: `public.item_id_ledger_conflicts` (22 pre-existing legacy collisions — no action needed)
- New React context: `ClientsProvider` at app root — single source of truth for `useClients()`

#### Part 1 — Deep-link blank-page fix (5 React pages + WC panel)

**Problem:** Clicking an Item ID cell from a Task / Repair / WillCall / Shipment detail panel opened a new tab on `/inventory?open=X&client=Y` — and the page rendered **blank for 90s–10 min**. Same for cross-entity deep links on Tasks / Repairs / WillCalls / Shipments.

**Root cause:** each page's mount effect had `refetchX()` hardcoded when the `?open=` param was present. Per session 62's forensics, `refetch()` in `useApiData` explicitly skips the Supabase cache (`skipSupabaseCacheOnce` + `setNextFetchNoCache` + `doFetch(bypass=true)`), which when `clientFilter` is still empty (it doesn't get set until the *next* effect runs, after `apiClients` loads) forces an unscoped full-scan GAS call that hangs the spinner. Bonus bug: `WillCallDetailPanel.tsx:641` used a raw `<a href="#/inventory?open=${itemId}">` with **no `&client=` param**, taking the slower Supabase `tenant_id` lookup fallback.

**Fix:** removed the `refetch()` call from mount effects on `Inventory.tsx`, `Tasks.tsx`, `Repairs.tsx`, `WillCalls.tsx`, and `Shipments.tsx`. The data hooks auto-fetch via `cacheKeyScope` (derived from `clientSheetId`) whenever the clientFilter populates — Supabase-first, ~50ms. Pending-open refs still resolve in Effect 2 when the data arrives. WC panel item-ID link now uses `<DeepLink kind="inventory" id={item.itemId} clientSheetId={clientSheetId} />` matching the Task/Repair pattern.

Intermediate bundle: `index-DiUAvZLS.js` (commit `20e9c1d`). Superseded by Part 2 bundle later the same session.

#### Part 2 — Item ID ledger (cross-tenant uniqueness enforcement)

**Motivation:** the legacy `Import.gs` tool had re-used 22 Item IDs across different clients over time. Without a central registry, nothing prevented this. User wanted to plan a ledger and add a receiving-time guard that blocks cross-client collisions on the React side.

**Phase 1 — Migration + backfill.** New `public.item_id_ledger` table:

```
item_id      text primary key   -- globally unique across all tenants
tenant_id    text not null
created_at   timestamptz default now()
created_by   text               -- user email at allocation
source       text default 'manual'   -- auto|manual|import|reassign|backfill
status       text default 'active'   -- active|released|transferred|voided
voided_at    timestamptz
void_reason  text
updated_at   timestamptz        -- auto-updated via trigger
```

Indexes on `(tenant_id)`, `(status)`, `(created_at)`. Trigger `trg_item_id_ledger_touch` bumps `updated_at` on any PATCH. RLS enabled; `authenticated` role has SELECT, only `service_role` (StrideAPI.gs) writes. Backfill used `INSERT … SELECT DISTINCT ON (item_id) … ORDER BY item_id, created_at ASC NULLS LAST … ON CONFLICT DO NOTHING` — first-seen wins on the 22 historical collisions. Result: **4,054 ledger rows = 4,054 unique inventory IDs**, 22 conflicts surfaced in the companion view `public.item_id_ledger_conflicts` for forensics.

Inspected the 22 dupes — all originated from `IMP-*` shipment numbers (legacy imports), all are transfer leftovers (one side Released or both Released), and **zero have Active status on more than one client**. No cleanup required; ledger's first-seen assignment is correct for every one.

**Phase 2 — StrideAPI.gs write-through + check endpoint.** Added a dedicated helper block after the existing Supabase helpers (search `Supabase Phase 4 — item_id_ledger` in StrideAPI.gs):

- `api_ledgerInsert_(itemId, tenantId, source, status, createdBy)` — single-row upsert via `Prefer: resolution=ignore-duplicates,return=minimal`.
- `api_ledgerBatchInsert_(rows[])` — chunked at 100/request.
- `api_ledgerUpdateStatus_(itemIds[], newStatus, voidReason?)` — PATCH with `item_id=in.(…)`. Sets `voided_at=now()` when status is `voided`.
- `api_ledgerTransferTenant_(itemIds[], newTenantId)` — PATCH `tenant_id` + forces `status='active'` (destination tenant just received it).
- `api_ledgerCheckAvailable_(itemIds[])` — GET with `item_id=in.(…)&select=…`. Returns `{duplicates: [{itemId, tenantId, status, source, createdAt}], degraded}`. `degraded=true` whenever Supabase URL/key missing or HTTP non-2xx.

All five helpers are best-effort, never throw. Write path never blocks on ledger failure — per 2026-04-14 decision: "allow save, log warning, reconcile later."

New endpoint `handleCheckItemIdsAvailable_(payload)` returns the check result enriched with `tenantName` via a single pass over the CB Clients tab (uses `api_getHeaderMap_` for case-tolerant lookup on "Client Name" + "Client Spreadsheet ID").

Router wiring in the POST switch:
- `case "completeShipment"`: pre-check inside `withClientIsolation_` callback. If `pre.degraded` is false, filter duplicates to `tenantId !== effectiveId` (cross-tenant only — same-tenant resubmits are idempotent and pass through). If any cross-tenant dups exist, return `errorResponse_("Item ID already assigned to another client: …", "ITEM_ID_COLLISION")` before the handler runs. On successful response (`json.success && !json.skipped`), call `api_ledgerBatchInsert_` for every `payload.items[i].itemId`.
- `case "releaseItems"`: after success, `api_ledgerUpdateStatus_(releasedIds, 'released', null)`.
- `case "transferItems"`: after success, `api_ledgerTransferTenant_(itemIds, destId)` — updates owning tenant and resets status to active.
- `case "checkItemIdsAvailable"`: `withStaffGuard_` → `handleCheckItemIdsAvailable_(payload)`.

**Phase 3 — React Receiving preflight.** `Receiving.tsx` `handleComplete` now calls `postCheckItemIdsAvailable(ids)` right before `postCompleteShipment`:

1. If `check.data.duplicates` has any rows where `tenantId !== clientSheetId` → build a multi-line error listing up to 8 offending IDs (`• 80123 — already assigned to ClientX (active)`), set `submitError`, abort submit. The error banner now renders with `whiteSpace: 'pre-wrap'` so the list displays readably.
2. If `check.data.degraded` → `console.warn('[Receiving] item_id_ledger check degraded — Supabase unreachable. Proceeding without preflight duplicate detection.')` and fall through to submit. Server-side guard still runs.
3. If the check call itself errors (network/auth) → fall through. Server guard remains the last line of defense.

New API: `postCheckItemIdsAvailable(itemIds, signal?)` → `CheckItemIdsAvailableResponse { ok, duplicates, degraded }`. `CheckItemIdsAvailableDuplicate` type exposes `{itemId, tenantId, tenantName?, status, source, createdAt}`.

**Files modified this session:**
- `stride-gs-app/supabase/migrations/20260414180000_item_id_ledger.sql` — new
- `AppScripts/stride-api/StrideAPI.gs` — version header + helpers block + handler + 4 router cases (completeShipment pre-check + post-success ledger insert, releaseItems post-success status update, transferItems post-success tenant update, new checkItemIdsAvailable case)
- `stride-gs-app/src/lib/api.ts` — `postCheckItemIdsAvailable` + response types
- `stride-gs-app/src/pages/Receiving.tsx` — preflight block in `handleComplete`, `whiteSpace: 'pre-wrap'` on error banner
- `stride-gs-app/src/pages/Inventory.tsx` / `Tasks.tsx` / `Repairs.tsx` / `WillCalls.tsx` / `Shipments.tsx` — removed `refetch()` on deep-link mount
- `stride-gs-app/src/components/shared/WillCallDetailPanel.tsx` — DeepLink import + replaced raw item-ID `<a>` with DeepLink

**Verification:**
- Supabase counts confirmed: `ledger_rows=4054`, `unique_inventory_ids=4054`, `conflict_rows=22`, `ledger_backfill=4054`, `ledger_active=1654`, `ledger_released=2399`, `ledger_transferred=1`.
- The 22 conflicts were manually inspected — all legacy transfer leftovers, zero active-on-active.
- `npm run build` produced a clean 1,880-module bundle (safeguards passed).

**Still open:**
- `Import.gs` bound-script ledger integration — future imports still won't hit the ledger since Import.gs runs inside each client's bound project, not the standalone API. Not urgent (legacy imports are rare and the backfill already captured everything from past imports).
- Maintenance-page ledger viewer + conflict resolver UI.
- Nightly reconciliation job to catch writes that slipped through during Supabase degraded mode.

#### Post-ship fixes (same session, 3 follow-up deploys)

**Fix A — Ledger collision error shows client name, not raw spreadsheet ID** (StrideAPI.gs v38.52.1, Web App v263). User tested the flow and hit the server-side guard which had shown `"Item ID already assigned to another client: 62403 (tenant 17iqtKPu87CWIoiV0HZGgMZ6CtTTqJDY4daK6zpgfnA8, active)"`. The tenant ID is useless to the warehouse. New helper `api_clientNameMap_()` (CacheService-backed, 5-min TTL) reads CB Clients and returns `{spreadsheet_id → "Client Name"}`. Both `handleCheckItemIdsAvailable_` (React preflight) and the `completeShipment` router pre-check now use it. Server error is now multi-line matching the React preflight format:

```
Duplicate Item ID already assigned to another client:
• 62403 — assigned to Brian Paquette Interiors (active)

Edit the Item ID column and try again.
```

**Fix B — `useBilling` infinite render loop (React error #300 on Inventory page).** Symptom: Inventory page crashed with `Uncaught Error: Minified React error #300` and DevTools Network tab showed dozens of `(canceled)` Supabase inventory requests cascading. Root cause: the session-62 `clientNameMap` ref-stabilization pattern was applied to `useInventory` / `useTasks` / `useRepairs` / `useWillCalls` / `useShipments` but **not** `useBilling`. Inventory page calls `useBilling(apiConfigured && clientFilter.length > 0, billingSheetId)` alongside the other 5, so the same perpetual abort/refetch loop (new `clients` reference every render → new `clientNameMap` → new `fetchFn` → new `doFetch` → useEffect refire → abort → repeat) fired until React's render limit. Fix: mirror `clientNameMap` into a `useRef` in `useBilling`, narrow `fetchFn` deps to `[clientSheetId, hasServerFilters, filtersKey]`, also stabilized the `filters` prop via ref + serialized key. Commit `91e8b5d`, bundle `index-KmG1qKHk.js`. Intermediate fix — superseded by Fix C the same session.

**Fix C — Root cause: `useClients` single-source-of-truth via Context.** The ref pattern in 6 data hooks was a band-aid for a real problem — multi-instance divergence of `useClients`. Every consumer (page + 8 data hooks) called `useClients()` independently, each instantiating its own `useApiData` for the `"clients"` cache key. On Inventory that meant ~7 parallel instances, each with independent `data` React state. Values identical, but array **references** diverge across instances — any `setData` on any instance rebuilds that instance's `apiClients`/`clients` memos with a new reference. Anything that closes over `clients` then rebuilds.

Refactor: `ClientsProvider` at the app root owns a **single** `useApiData` instance. `useClients()` is now a thin `useContext()` wrapper. Two context channels (`active` and `all`) so Settings' "include inactive" path doesn't pollute the active-only reads. Keeps a unit-test-safe fallback: if no provider mounted, falls through to the old direct-fetch path.

Renamed `src/hooks/useClients.ts` → `useClients.tsx` (now contains JSX). Provider wrapped between `<AuthProvider>` and `<BatchDataProvider>` in `main.tsx`. The ref pattern in the 6 data hooks (useInventory/useTasks/useRepairs/useWillCalls/useShipments/useBilling) remains as defense-in-depth but is no longer load-bearing — values from context are stable.

Commit `2e91aa6`, bundle `index-BFRgl5Rm.js` (live).

**Net effect across all three post-ship fixes:**

| Metric | Before | After |
|---|---|---|
| `useClients` instances on Inventory page | ~7 | 1 |
| Parallel `getClients` network calls on mount | 1–7 | 1 |
| Cross-instance reference divergence | Yes (root cause) | Impossible |
| Ledger collision error readability | Raw spreadsheet ID | Client name + status, multi-line |
| Inventory page render stability under load | Cascading aborts, React #300 crash possible | Stable single fetch, no loop |

Previous session (62 React data-hook perf fixes for single- and multi-client views): see `Docs/Archive/Session_History.md`.

---

## PRIOR SESSION (2026-04-14 session 62) — MOVED TO ARCHIVE

Full writeup in `Docs/Archive/Session_History.md`. Summary: React-only perf fixes for single- and multi-client data loads on Inventory / Tasks / Repairs / Will Calls / Shipments — previously 90s–10min via unscoped GAS fallback, now Supabase-first and fast. Three commits: Shipments page-level `clientName` safety net (`875b5d6`); `clientNameMap` ref stabilization in 5 hooks to stop the perpetual abort/refetch loop (`b0057cd`); removed forced-GAS `refetch()` on client-filter change from all 5 pages (`aab1a54`). Live bundle `index-lOoM3xSO.js` until session 63 superseded it with deep-link and ledger fixes.

<!-- Session 62 full body removed from hot doc after archive confirmation. See Session_History.md line 143.
### Session 62: React data-hook perf fixes — single- and multi-client views now load from Supabase in seconds (was 90s-10min via GAS fallback)

React-only session. No backend, no Supabase schema changes. Three sequential React deploys fixed a cascading set of regressions that made Inventory / Tasks / Repairs / Will Calls / Shipments extremely slow when a client was selected, and effectively broken on multi-client selection.

**Live bundle after this session:** `index-lOoM3xSO.js` (commit `aab1a54`).

#### Part 1 — Shipments page-level `clientName` safety net (commit `875b5d6`, bundle `index-CEfzpyld.js`)

**Problem:** On Shipments, selecting a client showed empty rows or a partial list even though Supabase had the data. The page filter was `clientFilter.includes(r.clientName)` — but when `useShipments` fetched from Supabase before `useClients` had populated its name map, rows came back with `clientName: ''` and were silently dropped by the filter.

**Fix:** `Shipments.tsx` — added a `shipIdToName` memo (`apiClients.spreadsheetId → name`) and wrapped the filter in a `.map(...)` that resolves empty `clientName` from `r.clientSheetId` / `r.sourceSheetId` via the map before filtering:
```tsx
const shipIdToName = useMemo<Record<string, string>>(() => { const m: Record<string, string> = {}; for (const c of apiClients) { m[c.spreadsheetId] = c.name; } return m; }, [apiClients]);
const data = useMemo(() => {
  if (clientFilter.length === 0) return [];
  const resolved = allData.map(r => r.clientName ? r : { ...r, clientName: shipIdToName[(r as any).clientSheetId || (r as any).sourceSheetId || ''] || '' });
  return resolved.filter(r => clientFilter.includes(r.clientName));
}, [allData, clientFilter, shipIdToName]);
```
This is the same pattern already in Repairs.tsx and WillCalls.tsx — Shipments had been missed. Not a hook-level fix (a previous attempted hook-level version regressed into slowness because adding `clients` to the hook's memo deps caused cascading re-renders from `useClients` returning a referentially-unstable array every render — see Part 2).

#### Part 2 — Stabilize `clientNameMap` via ref in all 5 data hooks (commit `b0057cd`, bundle `index-C12LkL5D.js`)

**Problem:** After Part 1, multi-client selection still showed only the first client's data and the refresh spinner never stopped. Network tab showed the Supabase query firing with the correct `tenant_id=in.(id1,id2)` and returning data, plus many `(canceled)` GAS requests stacked up — classic perpetual abort/refetch cycle.

**Root cause:** All 5 data hooks (`useInventory`, `useTasks`, `useRepairs`, `useWillCalls`, `useShipments`) had `clientNameMap` in the `useCallback` deps of `fetchFn`:
```ts
const clientNameMap = useMemo(() => { /* build map from clients */ }, [clients]);
const fetchFn = useCallback(async (signal) => { /* uses clientNameMap */ }, [cacheKeyScope, clientNameMap]);
```
`clients` from `useClients` is a new array reference on every render → `clientNameMap` gets a new reference → `fetchFn` rebuilds → `useApiData`'s `doFetch` useCallback rebuilds → useEffect fires → aborts in-flight → starts new fetch → repeat forever. Single-client selection masked it because the cache hit short-circuited the effect on re-render; multi-client with no cached entry exposed the full loop.

**Fix:** Move `clientNameMap` out of `fetchFn` deps via a ref that mirrors the latest value. `fetchFn` stays stable (`[cacheKeyScope]` only), and reads the latest map via `clientNameMapRef.current`:
```ts
const clientNameMap = useMemo(...);
const clientNameMapRef = useRef(clientNameMap);
clientNameMapRef.current = clientNameMap;
const fetchFn = useCallback(async (signal) => {
  if (await isSupabaseCacheAvailable()) {
    const sbResult = await fetchXFromSupabase(clientNameMapRef.current, clientSheetId);
    ...
  }
}, [cacheKeyScope]);
```
Applied identically to `useInventory.ts`, `useTasks.ts`, `useRepairs.ts`, `useWillCalls.ts`, `useShipments.ts`. The ref pattern is a workaround for the upstream `useClients` referential-instability bug, not a root-cause fix — see Known Issues.

#### Part 3 — Remove forced-GAS `refetch()` on client-filter change (commit `aab1a54`, bundle `index-lOoM3xSO.js`)

**Problem:** Even after Part 2 the spinner still never stopped for the 2nd client, and no new Supabase request fired. Traced to a `useEffect` on each of 5 list pages:
```tsx
const clientFilterKey = clientFilter.join(',');
useEffect(() => {
  if (clientFilter.length > 0) refetchX();
}, [clientFilterKey]);
```
The manual `refetch()` in `useApiData` is designed for the refresh button — it calls `cacheDelete()` + `setNextFetchNoCache()` + **`skipSupabaseCacheOnce()`** + `doFetch(bypassCache=true)`. So every client-filter change forced GAS to run unscoped → for 2+ clients, `gasClientId` becomes `undefined` → full all-clients GAS scan → 90s-10min hang with no response. The effect was also redundant: `useApiData` already refetches automatically when `cacheKeyScope` (derived from `clientSheetId`) changes, taking the Supabase-first path.

**Fix:** Removed the `useEffect` block from all 5 pages — `Inventory.tsx`, `Tasks.tsx`, `Repairs.tsx`, `WillCalls.tsx`, `Shipments.tsx`. Replaced with a comment explaining why the manual refetch was harmful. The hook-level refetch via `cacheKeyScope` handles every case correctly.

#### Billing: NOT fixed in this batch (intentional)

User asked about applying the same fix to Billing. After reading `Billing.tsx`, confirmed the page uses `useBilling(false)` (auto-fetch off) and routes through `fetchBilling(undefined, undefined, filters)` for its manual "Load Report" flow. Server-side filtering is Apps-Script-only by architecture. The two-line safety-net pattern does not apply. See Known Issues → "Billing slow by design" for the separate-session plan.

---

**Deployed this session:**
- Three React builds:
  - `875b5d6` — Shipments page-level clientName safety net → `index-CEfzpyld.js`
  - `b0057cd` — `clientNameMap` ref stabilization in 5 hooks → `index-C12LkL5D.js`
  - `aab1a54` — Remove forced-GAS refetch on client-filter change (5 pages) → `index-lOoM3xSO.js` **(live)**
- No backend, no Supabase migrations, no Apps Script changes.

**Files modified this session:**
- `stride-gs-app/src/hooks/useInventory.ts` — added `useRef` import, clientNameMap ref pattern
- `stride-gs-app/src/hooks/useTasks.ts` — same
- `stride-gs-app/src/hooks/useRepairs.ts` — same
- `stride-gs-app/src/hooks/useWillCalls.ts` — same
- `stride-gs-app/src/hooks/useShipments.ts` — same
- `stride-gs-app/src/pages/Shipments.tsx` — added `shipIdToName` safety net; removed forced-GAS refetch effect
- `stride-gs-app/src/pages/Inventory.tsx` — removed forced-GAS refetch effect
- `stride-gs-app/src/pages/Tasks.tsx` — removed forced-GAS refetch effect
- `stride-gs-app/src/pages/Repairs.tsx` — removed forced-GAS refetch effect
- `stride-gs-app/src/pages/WillCalls.tsx` — removed forced-GAS refetch effect

**Verification:** User confirmed multi-select on Shipments now loads fast and spinner stops. Single-client load remains fast (Inventory/Tasks/Repairs/WillCalls already verified fast earlier). "Select All" no longer times out.

Previous sessions (61 Import.gs perf + service_role JWT remediation, 60 client isolation cache fix, 59 welcome email + build pipeline regression): see `Docs/Archive/Session_History.md`.

---

## PRIOR SESSION (2026-04-11 session 61) — MOVED TO ARCHIVE

Full writeup in `Docs/Archive/Session_History.md`. Summary: Import.gs v4.2.1 perf fix (17 min → under 30s for a 98-row import, rolled out to all 6 clients) + StrideAPI.gs v38.44.1 service_role JWT leak remediation (GitGuardian alert → user rotated key → `setupSupabaseProperties_` redacted + stale backup removed + `.gitignore` extended → Web App v234 deployed). No React changes that session.

<!-- Session 61 full body removed from hot doc after archive confirmation. See Session_History.md line 143. -->
<!--
#### Part 1 — Import.gs v4.2.1 — Per-row round-trip elimination

**Problem:** A 98-row legacy client inventory import (13 rows from ACTIVE STOCK + 85 rows from RELEASED ITEMS) took 1,016 seconds (~17 min) — visible in Apps Script Executions panel. Two `Logger.log` markers at 2:15:18 PM and 2:31:50 PM revealed a ~16-minute gap between batch inserts, which meant the slowness was inside `importSheetRows_` per-row work, not in `setValues` itself.

**Root-cause analysis** (four independent per-row round-trips inside `importSheetRows_`):

1. **`photoRange.getCell(rt + 1, 1).getNote()` inside the photo URL extraction loop** (line 378). `getCell()` returns a new Range object and `.getNote()` is a server round-trip. On tabs where most rows have no photo note, this fires for every row — **85 round-trips at 1–2s each accounts for the 16-minute gap on the Released tab alone.**
2. **`nextTaskCounter_(taskSh, "ASM", itemId)` called per assembly row** (line 451). That helper in `Tasks.gs` does `getLastRow()` + `getHeaderMap_()` + `getRange(...).getValues()` on the entire Task ID column per call. N assembly rows = 3N round-trips + re-reads of potentially thousands of IDs.
3. **`invSh.getRange(...).setRichTextValue(rt)` inside a loop over photo-tagged rows** (lines 478–488). Each `setRichTextValue` is a separate API call — cannot be batched by per-cell code even though the range is contiguous.
4. **`SpreadsheetApp.flush()` immediately before the bulk `setValues` insert** (line 462). Forces recalc of every ARRAYFORMULA, conditional format, and data validation across the existing Inventory sheet (997 rows) before the insert can proceed — and there were no prior writes in this function to commit, so the flush was both unnecessary and expensive.

**Fix (`AppScripts/stride-client-inventory/src/Import.gs` v4.2.1):**

1. **Batch `photoNotes = photoRange.getNotes()` once** alongside the existing `getRichTextValues()` / `getFormulas()` / `getValues()` reads. Method-4 note check now reads from the in-memory array. Wrapped in try/catch with null fallback so old tabs without notes still work. **85 round-trips → 1.**
2. **Pre-compute `asmCounterByItem` map once per tab call.** Single `taskSh.getRange(2, taskIdCol, taskLr-1, 1).getValues()` read, regex match on each ID for the pattern `^ASM-(.+)-(\d+)$`, build `{itemId → maxN}` map. In the per-row loop, `asmCounterByItem[itemId] = (asmCounterByItem[itemId] || 0) + 1` and use the incremented value directly. Zero additional sheet reads regardless of row count. Skipped entirely for Released tabs (no ASM tasks created). **N × 3 round-trips → 1.**
3. **Batch `setRichTextValues()` for photo-hyperlinked Shipment # cells.** Read the full target range's existing rich text once via `getRichTextValues()`, build a new 2D array where photo rows get a new `RichTextValue` built with the photo URL and non-photo rows keep their existing cell (preserving whatever `setValues` just wrote), and write it back in one `setRichTextValues()` call. **N-photo round-trips → 1.**
4. **Removed `SpreadsheetApp.flush()` before the insert.** Comment added explaining why it was there (defensive "ensure prior writes committed") and why it's unnecessary here (no prior writes exist in the function up to that point; the next call is a pure insert). **Full Inventory-sheet recalc eliminated.**

**Rolled out via:** `npm run rollout` (dry-run clean, 6/6 success) → `npm run deploy-clients` (6/6 success). Targets and resulting Web App versions:
- Master Inventory Template → v22
- Brian Paquette Interiors → v21
- Seva Home → v6
- Demo Company → v20
- Justin Demo Account → v22
- Needs ID Holding Account → v20

**Expected runtime drop:** ~17 min → under 30 seconds for a comparable 98-row import. Smoke test pending on next real client migration.

**Not tested yet:** That the rich-text photo hyperlinks still render correctly and that the ASM task IDs increment cleanly within a single tab pass. Both are preserved by construction (the counter logic still produces the same sequence, and the rich-text batch path reads existing values before overwriting) but should be verified on the first real import.

---

#### Part 2 — StrideAPI.gs v38.44.1 — Service_role JWT leak remediation

**Detection:** GitGuardian email received at 2:32 PM PT reporting a Supabase Service Role JWT exposed in `Stride-dotcom/Stride-GS-app` at commit pushed 14:26:25 UTC (= 14:26 PT). Cross-referenced to local git history → commit `9ee4394` ("session 60: client isolation cache fix + standalone-client dropdown + signOut URL reset") was pushed at 14:26:05 PT — 20 seconds before the alert fired.

**Forensic trace without printing the secret:** Used `git show --stat 9ee4394` to list the 3 changed files, then per-file `grep -c "eyJ[A-Za-z0-9_-]\{20,\}"` to count JWT matches — only `AppScripts/stride-api/StrideAPI.gs` had a hit. `grep -n` with `sed '/eyJ.../<REDACTED>/'` piped output revealed line 556 inside `setupSupabaseProperties_`:
```javascript
props.setProperty("SUPABASE_SERVICE_ROLE_KEY", "<JWT>");
```
The function header comment literally said *"Run this function ONCE from the Apps Script editor to set credentials. Then delete or comment out."* — intended pattern was correct (use Script Properties) but whoever ran the one-time setup committed the file with live values instead of deleting or placeholder-ing.

**Full working-tree audit.** Grepped the entire repo (excluding `node_modules/`, `.git/`, `_backups/`) for the three-segment JWT pattern, then for each hit decoded the middle segment base64 to check `"role": "anon"` vs `"role": "service_role"`:

| File | Role | Severity |
|---|---|---|
| `AppScripts/stride-api/StrideAPI.gs` | `service_role` | 🔴 CRITICAL (the alert's source) |
| `AppScripts/stride-api/StrideAPI.backup.pre-jobdetail-20260408.gs` | `service_role` | 🔴 **Second copy** (backup file) |
| `AppScripts/QR Scanner/index.updated.html` | `anon` | 🟢 safe |
| `AppScripts/QR Scanner/Scanner.fixed.html` | `anon` | 🟢 safe |
| `stride-gs-app/.env` | `anon` | 🟢 safe (not tracked) |
| `stride-gs-app/.env.local` | `anon` | 🟢 safe (not tracked) |
| `stride-gs-app/dist/assets/index-BhnyuN4a.js` | `anon` | 🟢 safe (Vite inlines VITE_SUPABASE_ANON_KEY) |

**Root cause for the second copy:** `.gitignore` only blocked `**/*.backup.pre-jobdetail-*.ts` and `**/*.backup.pre-jobdetail-*.tsx` — the `.gs` extension was missing, so `StrideAPI.backup.pre-jobdetail-20260408.gs` slipped through and was tracked by commit `48041c6` ("chore: add full project source to version control") earlier the same morning.

**Remediation steps (in order):**

1. **User rotated the service_role key in Supabase dashboard** immediately — Supabase pushed the user to the new Publishable/Secret API key model and the user created a new secret key and set it directly in the Stride API Apps Script project's Script Properties UI. **This is the single step that actually contained the risk.** Everything after is cleanup.
2. **Redacted `setupSupabaseProperties_`** in the working tree. Function now throws with guidance pointing to Apps Script editor → Project Settings → Script Properties, a short audit note about the 2026-04-11 incident, and a list of the required property keys. No behavior change for live handlers — they already read via `prop_("SUPABASE_SERVICE_ROLE_KEY")`.
3. **Deleted the stale backup** via `git rm AppScripts/stride-api/StrideAPI.backup.pre-jobdetail-20260408.gs`. Verified no code references it (only markdown docs referenced it by name in handoff reports).
4. **Extended `.gitignore`** to block `**/*.backup.pre-jobdetail-*.gs`, `**/*.backup.*.gs`, `**/*.bak`, `**/*.backup` so the same class of mistake can't recur.
5. **Version bump `v38.44.0 → v38.44.1`** with a changelog entry tagged `SECURITY` so the audit trail shows up in the file header.
6. **Amended local commit** into a single atomic security commit `5c9ac57` with message `security: redact service_role JWT from StrideAPI.gs + remove stale backup`. 135 phantom CRLF modifications on unrelated files were kept OUT of the commit by staging explicit paths only (`git add -- AppScripts/stride-api/StrideAPI.gs .gitignore`). `1d3920b → 5c9ac57`.
7. **Deployed the redacted source** via `npm run push-api` (code blob `990.6 KB`, files pushed: `appsscript` + `Code`) and **bumped the live Web App deployment** via `npm run deploy-api` (v228 → **v234**). Per CLAUDE.md golden rule: push ≠ deploy, must run `deploy-*` after every `push-*` or the live Web App keeps serving the old version.
8. **Pushed to `origin/source`** via normal fast-forward `git push` — no force, no rewrite. `4e5b97f..5c9ac57`.

**History rewrite deliberately skipped.** The leaked JWT is dead (rotated), the working tree is in CRLF churn (135 phantom modifications), and force-pushing a busy branch on top of that is asking for merge chaos. The JWT still exists in commits `48041c6` and `9ee4394` as a dead string — cosmetic, not a live risk. Deployment pipelines audited and confirmed insensitive to the choice: `npm run push-api` uses the Google Apps Script API (not git), the React `dist/` subtree already force-pushes to `origin/main` on every deploy (immune to `source` history), and there are no other Claude agents or CI bots pushing to `source`.

**Bonus forensics on the GitGuardian dashboard.** Opened the full incident list — 9 triggered incidents total. Today's is row 1 (the service_role). The other 8 go back to January and are all marked "From historical scan" with "No checker" validity. Decoded each JWT's role claim:
- **4 are anon keys** (false positives — Vite build artifacts, scaffolded `supabase/client.ts` files, committed `.env`s): `stride-gs-app/assets/index-BmrDbVfq.js` (137 occurrences — minified bundle repetition), `stride-wms-app/src/integrations/supabase/client.ts`, `team-time-keeper/src/integrations/supabase/client.ts`, `stride-schedules-app/.env`. All safe to resolve in bulk as False Positive.
- **4 are "Generic Password" rows** — need investigation. One in `stride-wms-app/supabase/functions/dev-admin-login/index.ts` (committed by Cursor Agent and Claude separately on Feb 23) is in a **live edge function** and should be examined; the other 3 are in `Auth.tsx` pages and are probably demo placeholders.

**User actions still pending:**
- Mark the Apr 11 service_role incident as **Resolved → Revoked** in GitGuardian with a note documenting the rotation + migration to the publishable/secret key model + commit `5c9ac57` + Web App v234.
- Bulk-resolve the 4 anon key incidents as False Positive.
- Investigate the 4 Generic Password incidents (especially `dev-admin-login/index.ts`) before dismissing.
- Enable GitHub's built-in push protection for secrets (Settings → Code security → Secret scanning → Push protection) so the next attempted commit containing a known-pattern secret is rejected at the push boundary instead of detected after the fact.

---

**Deployed this session:**
- `StrideAPI.gs v38.44.1` → Stride API Web App **v234**
- `Import.gs v4.2.1` rolled out to all 6 client script projects → Web Apps **v6–v22**
- `.gitignore` extensions pushed to `origin/source`
- Parent repo commits on `source`: `5c9ac57` (security)

**Not deployed:**
- No React app changes this session — no `stride-gs-app/src/` edits.
- No Supabase migrations this session.

Previous sessions (60 client isolation cache fix, 59 welcome email bundle + build pipeline regression, 58 releaseItems Supabase sync): see `Docs/Archive/Session_History.md`.
-->

---

## HOW KEY WORKFLOWS WORK

### Billing Report Flow
1. Open Billing page → **blank** (no stale data)
2. Set filters: Client, Sidemark, Service, Status (defaults to Unbilled), End Date
3. Click **Load Report** → server-side filtered fetch → table populates
4. Select rows → floating action bar: **Create Invoices**, **Export CSV**, **QB IIF Export**
5. Click row → BillingDetailPanel slide-out

### Storage Charge Flow
1. Billing page → **Storage Charges** tab
2. Set Client, Sidemark, Period Start + End dates
3. Click **Preview Storage Charges** → per-item detail with yellow Preview badges
4. Review: Qty = billable days, Rate = baseRate × cubicVol × discount, Total = Rate × Qty
5. **Rate formula:** `Price_Cache STOR rate × Class_Cache cuFt volume × client discount`
6. **Free storage:** calculated from **arrival date** (Receive Date + FREE_STORAGE_DAYS), NOT from billing period start
7. **Dedup:** Uses date-range overlap detection (v38.13.0+). If Smith was billed 4/1-4/7 (Invoiced) and monthly run is 4/1-4/30, only 4/8-4/30 is charged. Builds `billedRangesByItem` map from finalized STOR rows, subtracts overlapping ranges per item.
8. Click **Commit to Ledger** → rows written to client Billing_Ledgers
9. Switch to Billing Report → Load → see STOR rows. Invoice creation auto-summarizes STOR rows (one line per sidemark on PDF)

### Payments / Stax Auto-Charge Flow
1. **Import:** Upload IIF file OR pick from Google Drive (IIF_EXPORT_FOLDER_ID) → invoices show as "Imported"
2. **Review:** Edit due date, amount, customer → Select rows → **Push to Stax** → status changes to "Ready to Charge"
3. **Set Auto/Manual:** Toggle per invoice in Invoices tab or Charge Queue (optimistic update)
4. **Charge Queue:** Invoices grouped by due date. Column headers: Invoice #, Customer, Amount, Due Date, Status, Auto, Scheduled
5. **Auto-charge trigger** (StaxAutoPay.gs): runs daily at 9 AM Pacific, charges all Ready to Charge + Auto=TRUE + due_date ≤ today
6. **Manual charge:** Select invoices → "Charge N" button in toolbar (batch), or "Charge" per row
7. **Test invoices:** Create Test Invoice ($1 test) → Push to Stax → Charge
8. **Exceptions:** Failed charges appear here. Send Pay Links, Resolve, Reset
9. **Search:** Search bars on Invoices + Charge Log tabs. Charge Log sorted newest-first.

### Stax Configuration
- API key + environment stored in Stax spreadsheet Config tab
- Settings → Integrations → Stax panel reads/writes to Config tab
- `STAX_API_KEY` masked on read (last 6 chars), skip on save if unchanged
- `setupSpreadsheetId()` must be run once from the spreadsheet for time-based triggers to work

---

## WHAT'S NEXT (open work only)

### Immediate (approved, ready to build)
- [x] **Standalone Task Detail Page (Phase 1)** — New route `#/tasks/:taskId` loads one task directly from Supabase (~50ms). Opens in new tab from Dashboard. Full TaskDetailPanel parity: Start Task, complete, notes, location, custom price, repair quote, folder links. Optimistic UI with "Saving..." indicator. Legacy `getTaskById` fallback scans accessible clients.
- [ ] **Standalone Repair Detail Page (Phase 2)** — `#/repairs/:repairId` — same pattern, pending.
- [ ] **Standalone Will Call Detail Page (Phase 3)** — `#/will-calls/:wcNumber` — same pattern, requires WC items parity audit.
- [ ] **Generate Work Order button** — Manual PDF generation button on TaskDetailPanel for started tasks. Backend handler exists (`handleGenerateTaskWorkOrder_`), needs React wiring + router case.

### Queued
- [ ] **Scanner Supabase Direct Lookup** — See `Docs/Archive/QR_Scanner_Next_Phase.md` Feature A.
- [ ] **Auto-Print Labels from Receiving** — See `Docs/Archive/QR_Scanner_Next_Phase.md` Feature B.
- [ ] **Parent Transfer Access** — Allow parent users to transfer between own children.
- [ ] **Global search expansion** — Shipments, billing, claims entities + missing fields.
- [ ] **Autocomplete DB in React** — Sidemark/Vendor/Description per client.
- [ ] **Receiving page TanStack Table** — Currently hardcoded table.
- [ ] **Inline WC field editing UI wiring** — `updateWillCall` endpoint exists; UI not yet wired.

### Future scope (Phase 8, unstarted)
Design polish, photo upload, notifications, offline receiving.

### Cancelled
- ~~Free Receiving / Return Items~~
- ~~Re-Generate Item ID~~

---

## LOCKED DECISIONS

### Architecture
1. Sheets + React app coexist during transition — Sheets is the execution authority
2. Token-based auth for API endpoints
3. Invoice/PDF/Gmail/Drive operations stay server-side in Apps Script
4. React must NEVER calculate billing logic — all billing stays server-side
5. Client isolation enforced at API layer on every request
6. Coexistence mode: existing sheet automations cannot be broken
7. NO payment write endpoints without server-side idempotency
8. Invoice creation ≠ charge execution (separate steps)
9. Storage charges: free days from arrival date, date-range overlap dedup, STOR not in service filter

### Auth (Phase 6 COMPLETE ✅)
- Email + password only (no magic links, no Google OAuth)
- 3-tier role-based nav: admin = full, staff = no Billing/Claims/Payments/Settings, client = own data
- Client portal: Claims dropdown scoped to own client, Failed Ops / Refresh Data hidden

### Payments (v38.14.0+)
- Import from Drive, Review with inline editing, Push to Stax
- Per-invoice Auto/Manual toggle (optimistic UI) + per-client Auto Pay badge from CB Clients
- Charge Selected: batch charge from invoice table toolbar (replaced Run Charges Now + Dry Run)
- Status labels: Imported → Ready to Charge → Paid → Failed → Voided (workflow order, always visible)
- Auto-charge trigger: StaxAutoPay.gs v4.2.0, daily 9 AM Pacific
- Stax config: Settings → Integrations panel reads/writes real Config tab

### Claims (Phase 7C COMPLETE ✅)
- Admin-only access (`withAdminGuard_`)
- All write endpoints built (v22.0.0→v22.1.0)

---

## FEATURE PARITY MATRIX

> Legend: ✅ Built | 🟡 Partial | ❌ Not Built | 🔲 Placeholder

### Inventory
| Feature | Status |
|---|---|
| Inventory table + filters + detail panel | ✅ |
| All action modals (Create Task, Transfer, WC, Release) | ✅ |
| Inline editing (role-gated) + Edit/Save mode | ✅ |
| Auto-Generated Item IDs + Custom Task Pricing | ✅ |
| Sidemark multi-select filter + color highlighting + Print View | ✅ |
| Move History + Fix Missing Folders | ✅ |

### Receiving / Shipments
| Feature | Status |
|---|---|
| Complete Shipment + Drive folders + email + PDF | ✅ |
| Shipments table + lazy-loaded detail panel | ✅ |
| Free Receiving Toggle | ✅ |

### Tasks / Repairs / Will Calls
| Feature | Status |
|---|---|
| All CRUD + status transitions + email notifications | ✅ |
| LockService on concurrent-sensitive writes | ✅ |
| Inline WC field editing | 🟡 — backend ready, UI not wired |

### Billing
| Feature | Status |
|---|---|
| Tabbed report builder (Billing Report + Storage Charges + Invoice Review) | ✅ |
| Server-side filters (Client, Sidemark, Service, Status, End Date) | ✅ |
| Storage preview + commit with date-range overlap dedup | ✅ |
| Create Invoices (STOR auto-summarized per sidemark on PDF) | ✅ |
| CSV Export + QB IIF Export | ✅ |
| Discount range ±100 | ✅ |
| MultiSelectFilter component (reusable) | ✅ |
| Two-table invoice-list view (invoice summary + expandable line-item subtable) | ✅ |
| Merged selection across ledger + invoice summary tables | ✅ |
| Invoice-level date column (earliest child date fallback) | 🟡 — true `invoiceDate` field not yet on backend |
| Invoice summary QBO "Mixed" branch (when child statuses diverge) | ✅ |

### Payments / Stax
| Feature | Status |
|---|---|
| Import from Google Drive + manual upload | ✅ |
| Review tab: inline editing + selective Push to Stax | ✅ |
| Invoices: status filter chips (workflow order) + sortable headers + search + Void/Reset | ✅ |
| Invoices: Charge Selected (batch charge from table) | ✅ |
| Invoices: Auto/Manual toggle per invoice + optimistic update | ✅ |
| Charge Queue: due-date grouping + Auto/Manual toggle + column headers | ✅ |
| Status labels: Imported / Ready to Charge / Paid / Failed / Voided | ✅ |
| Test invoices (Create Test Invoice, $1 test, Is Test flag) | ✅ |
| Auto-charge trigger (StaxAutoPay.gs, daily 9 AM) | ✅ |
| Auto Pay badge (per-client from CB, per-invoice from Stax) | ✅ |
| Stax Config panel (real API, masked key) | ✅ |
| Charge Log + Invoices search bars | ✅ |

### Claims / Marketing
| Feature | Status |
|---|---|
| Claims: full CRUD + settlement PDF + email | ✅ |
| Marketing: 7 tabs, 26 endpoints, template dropdowns, Type+Active columns | ✅ |

### Settings & Admin
| Feature | Status |
|---|---|
| 7-tab Settings (admin-only, Claims merged into Email Templates) | ✅ |
| Email Template Manager: edit, preview, save, sync to clients | ✅ |
| Onboarding: fully automated (Drive folders + script + Web App deploy + triggers) | ✅ |
| CB Clients as client registry (Script ID, Web App URL, Deployment ID) | ✅ |
| Welcome + Onboarding emails (editable templates) | ✅ |
| Admin impersonation + Parent/Child accounts | ✅ |
| Auto Pay / Manual Pay badges on client cards | ✅ |

### Billing
| Feature | Status |
|---|---|
| 2-card layout: Client+Load first, then filters below | ✅ |
| Inline editing on Unbilled rows (Sidemark, Description, Rate, Qty, Notes) | ✅ |
| Auto Pay badge on client column (from CB Clients Auto Charge) | ✅ |
| Service filter shows names (not codes) | ✅ |
| Instant client list from useClients (no 30s fetch) | ✅ |
| Refresh button with loading animation | ✅ |

### UX / Components
| Feature | Status |
|---|---|
| Sidebar: "Stride Logistics" branding, drag-to-reorder, role-scoped | ✅ |
| Column drag-to-reorder (new-column merge in useTablePreferences) | ✅ |
| MultiSelectFilter (reusable multi-select dropdown with search) | ✅ |
| Mobile FAB (FloatingActionMenu) on all list pages | ✅ |
| Bulk action toolbar (desktop) with ConfirmDialog + BulkResultSummary | ✅ |
| Sticky checkbox column on mobile (Tasks, Repairs, WillCalls) | ✅ |
| Status chips wrap on mobile (not hidden) | ✅ |
| LinkifiedText (auto-detects task/repair/WC IDs in notes → deep links) | ✅ |
| TemplateEditor (split-pane code + preview, token insertion) | ✅ |
| Stale data fix: useApiData clears localStorage on refetch, skips Supabase on mount | ✅ |
| PDF retry-with-backoff + GCP project (Drive quota fix) | ✅ |
| PDF [FALLBACK TEMPLATE] indicator when hardcoded backup is used | ✅ |

---

## KNOWN ISSUES

### Backend
- `populateUnbilledReport_()` in CB `Code.gs.js` uses OLD header names ("Billing Status", "Service Date")
- `CB13_addBillingStatusValidation()` looks for "Billing Status" instead of "Status"
- Repair discount behavior — should disable discounts on repairs

### React App
- Autocomplete dropdowns — Room + Sidemark data mixed together
- Receiving page uses hardcoded table (no TanStack Table / no column reorder)
- Transfer Items dialog needs processing animation + disable buttons after complete
- Multi-row selection only picks last row for Will Call creation
- GitHub Pages CDN caching: hard-refresh (Ctrl+Shift+R) after deploy

### React App — Performance (pick up in a new session)

Following the session-62 fixes, these pages remain slow/un-optimized. Each is a self-contained task; group or split as needed.

- **Billing — slow by design.** `Billing.tsx` uses `useBilling(false)` (auto-fetch off) and routes through `fetchBilling(undefined, undefined, filters)` → goes direct to GAS for the server-side filter logic. The session-62 safety-net pattern does NOT apply here because Billing never filters rows by `clientName` at the page level the way list pages do. Two possible fixes, pick one:
  - **(A) Supabase-first for the default / unfiltered view.** When user lands on Billing with no filters applied, load from the `billing` Supabase table (fast). Switch to the GAS `fetchBilling(..., filters)` path only when the user applies filters and clicks "Load Report". Medium effort.
  - **(B) Mirror the filter logic in `supabaseQueries.ts`.** Reimplement the status / svcCode / sidemark / endDate / client filters as Supabase `.eq / .in / .gte` queries so the full Report Builder is Supabase-backed. Larger effort, but makes every Billing view fast. Requires understanding StrideAPI.gs's billing filter semantics (status + svcCode + sidemark + endDate + client) exactly.
  - Scope note: Billing storage-report filter restructure (filter-first UX from an earlier session backlog) is a separate UX change, not required for either (A) or (B).

- **Claims — no Supabase mirror.** Claims live in the single Consolidated Billing spreadsheet (not per-tenant). A full Supabase mirror would require a new `claims` table + write-through in `api_writeClaim_` et al. in `StrideAPI.gs` + `fetchClaimsFromSupabase` in `supabaseQueries.ts` + `useClaims` Supabase-first path. Separate session. Equivalent lift to the original phase-3 mirror work.

- **Payments / Stax — no Supabase mirror.** Lives in the Stax Auto Pay spreadsheet plus CB Clients for the customer map. Same architectural pattern as Claims — needs a dedicated session to design the table shape and write-through.

- **Marketing — no Supabase mirror.** Lives in the Campaign spreadsheet (`CAMPAIGN_SHEET_ID`). Same pattern.

- **`useClients` referential instability (root cause of the ref workaround).** `useClients` currently returns a new `clients` array reference on every render even when the underlying data hasn't changed. This is why session-62 had to stabilize `clientNameMap` via a `useRef` workaround in all 5 data hooks. The right fix is to make `useClients`'s `clients` value referentially stable (e.g., only return a new reference when the underlying response body changes, probably via a content-hash or by caching at the hook level). Once fixed, the ref workaround in `useInventory` / `useTasks` / `useRepairs` / `useWillCalls` / `useShipments` can be removed and `clientNameMap` can go back into the `useCallback` deps. Small isolated change but touches a hook many pages depend on — verify no regression on Dashboard / Settings / Sidebar / Receiving / anywhere that renders client lists.

---

## KEY FILE PATHS

| What | Path |
|---|---|
| Backend reference | `CLAUDE.md` (GS Inventory root) |
| Archive docs | `Docs/Archive/` |
| Payments redesign plan | `Docs/PAYMENTS_REDESIGN_PLAN.md` |
| Future WMS PDF arch | `Docs/Future_WMS_PDF_Architecture.md` |
| App source | `stride-gs-app/` |
| App (live) | https://www.mystridehub.com |
| Client inventory scripts | `AppScripts/stride-client-inventory/src/` |
| API | `AppScripts/stride-api/StrideAPI.gs` |
| Stax Auto Pay | `AppScripts/stax-auto-pay/StaxAutoPay.gs` |
| Stax spreadsheet | ID in CB Settings as `STAX_SPREADSHEET_ID` |
| Parity audit | `Docs/Phase7_Parity_Audit.md` |
| Stax audit | `Docs/Stax_Parity_Audit.md` |
| Marketing contracts | `stride-gs-app/docs/MARKETING_API_CONTRACTS.md` |
| QR Scanner repo | https://github.com/Stride-dotcom/Stride-GS-Scanner |
