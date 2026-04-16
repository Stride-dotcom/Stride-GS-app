# Stride GS App — Build Status & Continuation Guide

**Last updated:** 2026-04-16 (session 68 — Supabase caches for Claims/Users/Marketing + server-side batch endpoints + many bug fixes)
**StrideAPI.gs:** v38.58.0 (Web App v274)
**Import.gs (client):** v4.3.0 (rolled out to all 47 active clients; Reference column now imported)
**Emails.gs (client):** v4.3.0 (rolled out to all 47 active clients — email deep links CTA button)
**Shipments.gs (client):** v4.2.1 (rolled out to all 47 active clients — SHIPMENT_RECEIVED uses standalone /#/shipments/:shipmentNo)
**WillCalls.gs (client):** v4.4.0 (rolled out to all 47 active clients — WC deep links)
**Triggers.gs (client):** v4.5.0 (rolled out to all 47 active clients — repair/inspection deep links)
**RemoteAdmin.gs (client):** v1.5.1 (new `get_script_id` action writes scriptId to CB on self-report)
**Code.gs (client):** v4.6.0 (rolled out to all 47 active clients)
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

## RECENT CHANGES (2026-04-16 session 68)

### Session 68: Supabase caches everywhere + server-side batch endpoints + tab-close safety

**Supabase read-cache expansion (5 new mirror tables):**
- `claims` — all claim fields; RLS admin/staff see all, client sees own via `company_client_name` → clients join. Write-through in `handleCreateClaim_`, `handleUpdateClaim_`, `handleCloseClaim_`, `handleVoidClaim_`, `handleReopenClaim_`, `handleFirstReviewClaim_`, `handleSendClaimDenial_`, `handleGenerateClaimSettlement_`, `handleUploadSignedSettlement_`. Seeded (3 rows).
- `cb_users` — email-keyed; admin/staff RLS only. Write-through in `handleCreateUser_`, `handleUpdateUser_`, `handleDeleteUser_` (DELETE). Seeded (124 rows). Also speeds up auth lookups via `useUsers`.
- `marketing_contacts` — email-keyed; admin/staff RLS; server-side filter + search + pagination (ILIKE multi-field, page/pageSize via `.range()`). Write-through in 5 mutation handlers (create/import/update/suppress/unsuppress). Seeded (1,635 rows).
- `marketing_campaigns` — campaign_id-keyed; write-through in 7 handlers (create/update/activate/pause/complete/runNow/delete). Seeded (1 row).
- `marketing_templates` — name-keyed; write-through in create/update. Seeded (24 rows).
- `marketing_settings` — singleton (id=1); write-through in updateSettings.

**Marketing Dashboard:** now computes stats entirely from Supabase aggregates (contacts counts + rolling campaign totals). Gmail quota still GAS-only (sentinel -1). Drops Marketing page loads from 2-5 min (was bugged by infinite loop — fixed) or 2-5s (GAS baseline) to ~50ms.

**Marketing infinite-loop bugfix:**
- 8 `useApiData` call sites across `Marketing.tsx` were passing new arrow functions per render — React fired and canceled 13,000+ requests per page load. All wrapped in `useCallback` with proper dep arrays. One-line fix, massive impact.

**Claims page + Settings Users:** load via Supabase-first with GAS fallback, matching the 6 existing entity tables.

**Server-side batch endpoints (eliminate tab-close partial completion, v38.58.0):**
- Added 4 new batch handlers following the `handleBatchCancelTasks_` template:
  - `batchVoidStaxInvoices` — Payments Bulk Void
  - `batchDeleteStaxInvoices` — Payments Bulk Delete (invoice + review panel)
  - `batchScheduleWillCalls` — Will Calls Bulk Schedule
  - `batchRequestRepairQuote` — Inventory Bulk Request Repair Quote (both bar + mobile FAB)
- 4 React call sites rewired: one HTTP call instead of N, single result modal.
- 4 heavy-side-effect bulks kept as `runBatchLoop` but upgraded: Payments Bulk Charge (2 Stax API calls + real money), Billing Create Invoices (Drive PDF + email), WillCalls Bulk Release, Repairs Bulk Send Quotes. All now show `<BatchProgress>` overlay with `⚠ Keep this page open` inline warning + `<BulkResultSummary>` modal afterward.
- Payments → Bulk Charge has red-flag confirm dialog emphasizing real money before starting.

**Settings maintenance "keep page open" warnings:**
- Bulk Sync to Supabase, Purge Inactive Clients, and per-client sync banner all now show amber "⚠ Keep this page open" callouts. The full-sync is 15-45 min browser-driven; closing tab mid-flight leaves it partial.
- `BatchProgress` component gained the inline warning too.

**Password reset UX fix:**
- Expired reset link was firing Supabase `SIGNED_OUT` → silent redirect to Login with no explanation. Added `recovery_expired` AuthState variant + SetNewPassword UI branch. User now sees "Link Expired — Request new link" instead.
- Root cause found separately: missing `https://www.mystridehub.com` (with www) in Supabase Auth → URL Configuration → Redirect URLs allowlist. Added — reset flow works end-to-end.

**TRANSFER_RECEIVED email fix (v38.54.1):**
- Bug since shipping: `api_sendTemplateEmail_` was called with `destSS` (Spreadsheet object) as settings arg and `""` as recipient → immediate `"No recipient email address"` error → email never sent. Now passes `destSettings` + merged `CLIENT_EMAIL`/`NOTIFICATION_EMAILS` with explicit skip-reason warnings on the response so future failures are visible.

**Dashboard task type filter (Tasks tab):**
- Small dropdown on Tasks tab button showing all 19 service types by **name** (not code — Receiving, Inspection, Assembly, Repair (Flat), etc.) from Master Price List seed list.
- Multi-select checkboxes + Select All default; persisted per user in localStorage (`stride_dashboard_typeFilter_{email}`).
- Tab badge count reflects filter.

**Client dropdown leak fix:**
- Regression: client-role users on Inventory/Tasks/Repairs/WillCalls/Shipments/Claims pages saw the full client list in the Client dropdown (selecting another client returned empty data, but the names were exposed). Added `dropdownClientNames` memo that filters `clientNames` to `user.accessibleClientNames` when `role === 'client'`.

**Fragile code guard comments:**
- Inventory/Tasks/Repairs/WillCalls/Shipments/Dashboard page components + `FolderButton.tsx` got prominent `⚠ FRAGILE` warning comments after repeated React #300 / folder-button regressions. CLAUDE.md also gained two new must-not-do rules.

**Rollout + deploy for all 47 clients:**
- `syncAutocompleteDb` action failures on Settings maintenance (Unknown action + HTTP 404) resolved by rolling out and redeploying all clients. All 47 at version 6–22+.

**Live artifacts after session 68:**
- StrideAPI.gs v38.58.0 — Web App v274
- React bundles: latest commit on `origin/main` (GitHub Pages dist)
- Source commits on `origin/source`: multiple feature commits this session
- Supabase: 5 new migration files committed under `stride-gs-app/supabase/migrations/` (claims, users, marketing_contacts, marketing_campaigns+templates+settings, locations) + corresponding tables with RLS + seeded data

**Build guardrails held:** `scripts/build.js` continues to refuse stale bundles. All builds passed module-count (1,939 modules) + bundle-size (~1.6 MB) sanity checks.

---

### Session 67 archive: DT Phase 1b/1c (Delivery Availability Calendar + webhook ingest)

**Phase 1b — Delivery page (all roles):**
- `Orders.tsx` now has two tabs: **Orders** (admin-only, DT orders table) + **Availability** (all roles, calendar)
- `AvailabilityCalendar` component (user-built) embedded — click to cycle open/limited/closed, shift+click multi-select, bulk apply
- `/orders` route has no `RoleGuard` — access control is inside the page per tab
- Sidebar: "Delivery" item (Calendar icon) added to ALL three nav arrays (admin, staff, client)
- `useOrders.ts` hook: Supabase-only, no GAS fallback, filters by `tenant_id` via `useClientFilter`
- `OrderDetailPanel.tsx`: resizable right-side drawer with Schedule / Contact / Order Details / Notes sections

**Phase 1c — dt-webhook-ingest Edge Function:**
- **Function:** `supabase/functions/dt-webhook-ingest/index.ts` — deployed ACTIVE (v1)
- **Webhook URL:** `https://uqplppugeickmamycpuz.supabase.co/functions/v1/dt-webhook-ingest?token=<secret>`
- **Auth:** shared-secret token (`?token=`) validated against `dt_credentials.webhook_secret`
- **Idempotency:** SHA-256 of raw POST body as `idempotency_key` — DT retries auto-acked
- **Event types handled:** `Started`, `In_Transit`, `Unable_To_Start`, `Unable_To_Finish`, `Service_Route_Finished`, `Notes` (writes `dt_order_notes`), `Pictures` (writes `dt_order_photos`)
- **Tenant resolution:** Pass 1 — `dt_credentials.account_name_map` JSONB lookup (exact + lowercase); Pass 2 — `inventory.client_name ILIKE %accountName%` fuzzy fallback; quarantine if unresolved
- **Migration `20260415000000_dt_phase1c_webhook_prep`:** added `'dt_webhook'` to `dt_orders.source` CHECK; added `account_name_map JSONB` column to `dt_credentials`
- **`dt_credentials` row seeded:** `api_base_url`, `auth_token_encrypted` (API key), `webhook_secret` (64-char hex), `account_name_map = {}`

**Still needed before first live DT event:**
1. Configure DT Admin → General Settings → Alerts: set Delivery Mechanism = Web Service, POST, paste webhook URL for each alert event
2. Populate `dt_credentials.account_name_map` with `{"DT Account Name": "clientSheetId"}` entries for each client — this is the primary tenant resolver
3. Confirm exact `{{Tag}}` names for customer fields from DT support (email drafted below)

**Live artifacts after session 67:**
- Source commit: `d18fca1` (2 new files: Edge Function + migration)
- React bundle: `index-D4zrXAph.js` (unchanged from session 66, commit `dc201ff`)
- Supabase: migration `20260415000000_dt_phase1c_webhook_prep` applied; Edge Function `dt-webhook-ingest` v1 ACTIVE; `dt_credentials` row seeded

---

### Session 66 archive: ShipmentJobPage + comprehensive deep link overhaul

**Problem fixed:** Shipment email deep links opened the list page with nothing loaded (client filter required). All in-app cross-entity links used `?open=` query params on list pages, which broke when a client wasn't selected.

**`ShipmentJobPage.tsx` (new page):**
- Route: `#/shipments/:shipmentNo` — standalone page, loads shipment from Supabase by `shipment_number` (~50ms, RLS handles access, no client filter needed).
- Uses `fetchShipmentByNoFromSupabase()` (new function in `supabaseQueries.ts`), resolves client name via `useClients()`, maps `ApiShipment` → `ShipmentDetailPanel` shape.
- Same pattern as existing `TaskJobPage`, `RepairJobPage`, `WillCallJobPage`.
- Lazy-loaded chunk: `ShipmentJobPage-BB4kKHNB.js` (3.35 kB).

**`Shipments.gs v4.2.1`:**
- Both SHIPMENT_RECEIVED call sites updated: `{{APP_DEEP_LINK}}` now `https://www.mystridehub.com/#/shipments/<encodeURIComponent(shipmentNo)>` (was `?open=...&client=...`).
- Rolled out 47/47 clients, deployed 47/47.

**`DeepLink.tsx` — standalone route upgrade:**
- Tasks/repairs/will-calls/shipments now link to `#/<entity>/<id>` standalone pages (previously `?open=<id>` on list pages).
- `STANDALONE_KINDS` set: `['task', 'repair', 'willcall', 'shipment']`.
- Inventory still uses `?open=` + `clientSheetId` (no standalone item page).
- All existing `DeepLink` usages app-wide automatically upgraded.

**Missing in-app links added:**
- `RepairDetailPanel.tsx`: `sourceTaskId` is now a clickable `<DeepLink kind="task">` (was plain text — completely unclickable before).
- `ShipmentDetailPanel.tsx`: item ID column now renders `<DeepLink kind="inventory">` (was orange text with `cursor:pointer` but no href — broken link that looked functional).

**All remaining `?open=` links upgraded to standalone routes:**
- `ItemDetailPanel.tsx`: shipment/task/repair/will-call history links (4 inline `<a>` tags)
- `TaskDetailPanel.tsx`: shipment number link
- `CreateTaskModal.tsx`: open-task conflict link
- `CreateWillCallModal.tsx`: open-will-call conflict link

**Verified zero remaining `?open=` links** for task/repair/will-call/shipment in the entire `src/` tree.

**Live artifacts after session 66:**
- React bundle: `index-D4zrXAph.js` (commit `dc201ff`, 1,881 modules)
- `ShipmentJobPage.tsx` + `fetchShipmentByNoFromSupabase` in `supabaseQueries.ts` (new)
- GAS: `Shipments.gs v4.2.1` — rolled out 47/47, deployed 47/47

---

### Session 65 archive: Email deep links + clients Supabase mirror + billing filter mirror + repair quote confirmation

**Email deep links (GAS):** `Emails.gs v4.3.0` injects "View in Stride Hub →" CTA button; `WillCalls.gs v4.4.0` + `Triggers.gs v4.5.0` pass `{{APP_DEEP_LINK}}` to all 8 email types; React 4 pages got `deepLinkPendingTenantRef` pattern. Bundle: `index-CGEBbJ6Y.js` (commit `e0fdcf4`). Supabase `clients_mirror` table + `useClients` Supabase-first prefetch added (`StrideAPI.gs v38.53.0`, Web App v269). Billing Supabase filter mirror merged. Repair quote persistent banner. Auto-inspect race fix.

---

### Session 64 archive: Script-ID template-pollution cleanup — all 47 clients on their own bound scripts

**The big win:** for months, `npm run sync`/`rollout`/`deploy-clients` had been silently pushing code to the MASTER TEMPLATE instead of each individual client, because `CB Clients.SCRIPT ID` was polluted with the template's scriptId (`1Pk2Oc0u7RRg…`) for 44 of 50 rows. Every apparent "47/47 success" deploy was really the same 1 template script receiving 47 near-simultaneous pushes. All 47 clients ran stale code from whenever they were originally onboarded.

**Root cause (forensic):** `handleOnboardClient_` + `handleFinishClientSetup_` used Drive search (`'<sheetId>' in parents and mimeType=script`) to find the bound script after `makeCopy`. Container-bound scripts don't reliably show up as children of their spreadsheet in Drive queries — the search was returning the TEMPLATE's bound script (which has multiple parent links from old onboarding copies), and that template id was then written to every new client's SCRIPT ID column. `sync-clients.mjs` trusted CB's value, pushed `clients.json` with template ids, and downstream everything aimed at the template.

**Fix (code):**
- **StrideAPI.gs v38.52.2–v38.52.4:** explicit guard rejecting `TEMPLATE_SCRIPT_ID` everywhere it could flow into CB (append / update / finish-setup / append-client-row). `api_resolveBoundScriptViaRedirect_` helper uses Google's own redirect (`script.google.com/d/<sheetId>/edit` → `.../home/projects/<SCRIPT_ID>/edit`) to get the authoritative bound scriptId — works immediately after makeCopy, can't return template leakage. Wired as Strategy 0 in both onboarding and Finish Setup.
- **RemoteAdmin.gs v1.5.1:** new `get_script_id` doPost action calls `ScriptApp.getScriptId()` in the client's own context and writes it directly to `CB Clients.SCRIPT ID` via `CONSOLIDATED_BILLING_SPREADSHEET_ID`. Each client self-reports authoritatively — can't lie, can't leak, no Drive search needed.
- **New endpoint `backfillScriptIdsViaWebApp`** iterates CB Clients and calls each client's Web App URL with `{action: "get_script_id"}`. Requires the RemoteAdmin v1.5.1 rollout to be live on each client first.
- **React: new "Rediscover Script IDs" button** on Settings → Clients (wraps `backfillScriptIdsViaWebApp`). Progress banner + per-client `console.table` of results.
- **Finish Setup button** now shows when `scriptId` is missing (not just when Web App URL is missing), so operators can recover individual clients whose scriptId was cleared.
- **`sync-clients.mjs`:** rejects the template scriptId in every priority (CB column / cached / Settings / Drive) and falls through to the next strategy. Added `getScriptIdViaBulkDrive` that enumerates ALL accessible Apps Script projects with their parents and matches client-side (workaround for Drive's unreliable parent-child queries on container-bound scripts).
- **`update-deployments.mjs` v2.2.0:** `deployments.update` now falls back to `deployments.create` when the existing deploymentId doesn't belong to the target scriptId (common case after fixing CB — old URLs were template deployments). New deployment URLs are rewritten to both `clients.json` and `CB Clients.WEB APP URL` automatically. Rate-limited to ≈40/min (1500ms pacing) with 30s/60s/90s quota backoff to stay under Apps Script API's "60 management requests per user per minute" cap.

**Client-side workflow Justin executed (resolved in ~2h):**
1. Manually collected 38 of 50 real scriptIds from each client sheet's Extensions → Apps Script → ⚙️ Project Settings, pasted into CB Clients SCRIPT ID column.
2. `npm run sync` → `clients.json` now has 47 unique scriptIds (2 inactive, 1 template-only).
3. `npm run rollout` → Import.gs v4.3.0 + RemoteAdmin.gs v1.5.1 + WillCalls.gs v4.3.0 + Code.gs v4.6.0 pushed to all 47 real client scripts. First time the rollout ever hit the right targets.
4. `npm run deploy-clients` → 42 fresh Web App deployments created on real client scripts (old URLs were template deployments) + 5 updates. `CB Clients.WEB APP URL` column rewritten with new URLs.
5. 12 of 50 clients that didn't get manual entry still return `webapp error: template id or blank` on Rediscover because their current webAppUrl is still a template deployment. Workflow to recover any future client: open their sheet → Extensions → Apps Script → ⚙️ Project Settings → copy Script ID → paste into CB → click Finish Setup on their card in Settings → Clients.

**Other session 64 changes (smaller):**
- **Import.gs v4.3.0:** `IMPORT_COL_MAP_` now maps legacy REFERENCE / REF / REF# / PO / PO# / PURCHASE ORDER / ORDER / SO# / SALES ORDER / WORKROOM / INVOICE # / JOB / JOB # headers to the Inventory Reference column. Was blank on all imported rows before.
- **WillCalls.gs v4.3.0:** `buildWcItemsEmailTable_` now renders Item ID / Vendor / Description / Reference columns (was Item ID / Description / Class). Vendor + Reference backfilled from Inventory when missing.
- **StrideAPI.gs handleGenerateWcDoc_ v38.51.0:** emits the full DOC_WILL_CALL_RELEASE token set matching the Doc template (DATE / EST_PICKUP_ROW / REQUESTED_BY_ROW / ITEM_COUNT / NOTES_HTML / ITEMS_TABLE_ROWS / TOTAL_ITEMS / TOTAL_FEE / PICKUP_PHONE_HTML). Previously 9-token subset left most placeholders rendering as raw `{{TOKEN}}` text.
- **handleGenerateWcDoc_ v38.51.1:** bug fix — was calling nonexistent `api_readClientSettings_` → Regenerate Pickup Document instantly errored. Fixed to `api_readSettings_`.
- **StrideAPI.gs handleStartRepair_ v38.51.6–v38.51.9:** now generates DOC_REPAIR_WORK_ORDER PDF into canonical `Repairs/<id>` folder (was going to a different path, leaving the Repair Folder button's destination empty). Allows regeneration on Approved / In Progress / Complete statuses. 3-tier fallback for Supabase write-through so Shipment Folder stays populated for legacy repairs with no source task.
- **Receiving Paste from Excel:** new orange modal button (top-right of Items grid) opens a textarea for bulk TSV paste with a configurable "Start column" dropdown. Inline paste into any input cell now spreads tab-separated columns rightward through the field order. Qty parses as int, Class coerces to XS/S/M/L/XL or stays blank, Item ID skipped when Auto-ID is on.
- **Receiving hyperlinks self-heal (v38.51.3):** new `api_hyperlinkReceivedItems_` helper creates per-item Drive folders under PHOTOS_FOLDER_ID and hyperlinks Inventory.Item ID / Inventory.Shipment # / Tasks.Task ID at receive time. Shipment-folder creation pulled out of the email block so disabling notifications no longer breaks folder buttons.
- **Billing WC "Start Will Call" + "Regenerate Pickup Document"** buttons persistent; top-of-panel confirmation banners on Repair Start / WC Regenerate so users see confirmation that doesn't disappear on refetch.
- **Per-client Supabase Sync button** on Settings → Clients cards with Maintenance-style animated progress banner.
- **Deep-link `&client=<sheetId>`** passed from Task/Repair panels so Inventory auto-selects the right client without a Supabase round-trip.

**Known landmines from tonight:**
1. I briefly shipped `cacheSubscribe` pub/sub in `useApiData` to sync AppLayout + Page useClients instances → cascaded into refresh loops on WC / Repairs pages → reverted. A proper `ClientsProvider` Context was also tried in session 63 and reverted (React #300 on client-filter click, cause unclear under minified build). The multi-instance `useClients` race is currently mitigated by the session-62/63 ref pattern in the 6 data hooks + in-memory cache short-circuit — not architecturally fixed. Still on the open list.
2. A new Receiving `useEffect([clientSheetId, apiClients, liveClients, clientAutoInspect])` intended to patch the auto-inspect race triggered React #300 on Inventory / Clients pages. Removed in final bundle `index-XUulEEyK.js` (commit `530c358`). **Fixed in branch `fix/receiving-auto-inspect-race` (commit `2d00973`, session 65)** — pending merge + deploy. New approach uses `useMemo` + `prevAutoInspectRef + useEffect([clientAutoInspect])` which is #300-safe because deps are stable state/memos.
3. `handleBackfillScriptIdsViaWebApp_` was first shipped reading `PropertiesService.getScriptProperties().getProperty("REMOTE_EXEC_TOKEN")` — wrong key, every client returned `unauthorized`. Fixed in v38.52.3 to use `CLIENT_REMOTE_EXEC_TOKEN` with hardcoded fallback matching `handleRemoteAction_`.

**Live artifacts after this session:**
- React bundle: `index-XUulEEyK.js` (commit `530c358`)
- Web Apps: `Stride API v268` (StrideAPI.gs v38.52.4); 47 client Web Apps all on their own bound scripts (v3+)
- Supabase: no new migrations this session

### Session 63 archive (moved): Deep-link blank-page fix + Item ID ledger Phases 1–3

Two independent tracks shipped in one session. Full forensic writeup for each is in `Docs/Archive/Session_History.md` — this section keeps the operational details future builders need.

**Live artifacts after this session:**
- Final React bundle for session 63: `index-BmcdaxbO.js` (commit `573e59b`) — after the Context-refactor revert
- StrideAPI.gs: **v38.52.1** → Web App **v263**
- Supabase migration: `stride-gs-app/supabase/migrations/20260414180000_item_id_ledger.sql` applied
- New table: `public.item_id_ledger` (4,054 rows backfilled)
- New view: `public.item_id_ledger_conflicts` (22 pre-existing legacy collisions — no action needed)
- **No** React context for clients — `ClientsProvider` was tried then reverted; see Fix C below

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

**Fix B — `useBilling` infinite render loop (React error #300 on Inventory page).** Symptom: Inventory page crashed with `Uncaught Error: Minified React error #300` and DevTools Network tab showed dozens of `(canceled)` Supabase inventory requests cascading. Root cause: the session-62 `clientNameMap` ref-stabilization pattern was applied to `useInventory` / `useTasks` / `useRepairs` / `useWillCalls` / `useShipments` but **not** `useBilling`. Inventory page calls `useBilling(apiConfigured && clientFilter.length > 0, billingSheetId)` alongside the other 5, so the same perpetual abort/refetch loop (new `clients` reference every render → new `clientNameMap` → new `fetchFn` → new `doFetch` → useEffect refire → abort → repeat) fired until React's render limit. Fix: mirror `clientNameMap` into a `useRef` in `useBilling`, narrow `fetchFn` deps to `[clientSheetId, hasServerFilters, filtersKey]`, also stabilized the `filters` prop via ref + serialized key. **This is the load-bearing fix** for today's React #300. Commit `91e8b5d`, intermediate bundle `index-KmG1qKHk.js`.

**Fix C — `useClients` Context refactor: ATTEMPTED AND REVERTED.** After Fix B landed, tried to eliminate the root cause entirely (multi-instance divergence — 7 independent `useApiData` instances for the `"clients"` cache key on Inventory page). Built a `ClientsProvider` singleton mounted above the auth gate in `main.tsx` (commit `2e91aa6`). Two regressions surfaced:

1. **Client dropdown empty for 3–5 minutes.** Provider was above the auth gate, so the `getClients` fetch fired pre-login with no token and hung. Moved provider inside `App.tsx` below the `if (!user) return <Login/>` gate (commit `ea74c8b`, bundle `index-BE58wRh8.js`).
2. **React error #300 returned on client-filter click.** Exact cause unclear under minified production build — likely interaction between the conditional `useContext` fallback path and consumer lifecycles when `ClientsProvider` mounts/unmounts across auth transitions.

Reverted to the pre-Context `useClients` with `useMemo` stabilization (commit `573e59b`, bundle `index-BmcdaxbO.js` — live). The Fix-B ref pattern in the 6 data hooks is sufficient in practice: all `useApiData` instances for the `"clients"` cache key short-circuit on the in-memory cache tier after the first fetch, so references stay stable across consumers. A cleaner Context refactor that doesn't trip React #300 is deferred — it's on the open-items list but not urgent, since the ref pattern handles the failure mode.

**Fix D — Receiving description cell supports multi-line with Ctrl+Enter.** `AutocompleteInput` now accepts a `multiline` prop. When true it renders a `<textarea>` (auto-grows to fit content), suppresses plain Enter (no stray newline, no form submit), and inserts a `\n` at the caret on Ctrl+Enter / Cmd+Enter. Enabled on the Receiving page Description cell; placeholder updated to `"Item description... (Ctrl+Enter for new line)"` for discoverability. Vendor / Sidemark / Room still use single-line inputs.

**Net effect across all post-ship fixes:**

| Metric | Before | After |
|---|---|---|
| `useClients` instances on Inventory page | ~7 | ~7 (Context refactor reverted) |
| Cross-instance reference divergence | Yes | Yes, but mitigated by in-memory cache short-circuit + ref pattern |
| Ledger collision error readability | Raw spreadsheet ID | Client name + status, multi-line |
| Inventory page render stability under load | Cascading aborts, React #300 crash | Stable single fetch (via useBilling ref fix) |
| Receiving Description field | Single line only | Multi-line via Ctrl+Enter |

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

### Onboarding / client registry (session 64 carryover)
- **Auto-inspect race on Receiving page** — if the user picks a client before `apiClients` has resolved from the API (cold start), `apiMatch?.autoInspection ?? false` snapshots to false and the item rows' `needsInspection` checkboxes stay un-ticked even after `apiClients` loads. A `useEffect` to patch this was shipped then reverted (caused React #300 on Inventory / Clients pages). Fix needs a cleaner pattern — probably moving the auto-inspect derivation into a `useMemo` over `[clientSheetId, apiClients]` that the `items` initializer reads, or gating the Client select from rendering until `apiClients.length > 0`. Supabase query for post-hoc counting suggests ~63 items received in the last 30 days across 18 tenants are missing INSP tasks — user will backfill manually.
- **12 clients still show template scriptId in CB** — their current Web App URLs are template deployments, so `Rediscover Script IDs` returns the template id (blocked by guard). Recovery: open each sheet → Extensions → Apps Script → ⚙️ Project Settings → copy Script ID → paste into CB Clients SCRIPT ID → click Finish Setup on that client's card (uses the new URL-redirect resolver + `deployments.create` fallback in `update-deployments.mjs`, or just re-run `npm run sync && npm run rollout && npm run deploy-clients` at the terminal).
- **Onboarding still uses Drive search as a fallback** after the URL-redirect resolver; if the redirect fails (unexpected — Google's own redirect should always work for container-bound scripts), Drive search could still return template leakage. Template guard in v38.52.2+ catches that case and skips writing, but the new client's scriptId stays blank and the operator must click Finish Setup manually. Monitor for this.
- **`clients.json` can drift from CB** — `npm run sync` refreshes `clients.json` from CB but only runs on-demand. If someone edits CB directly and forgets to sync, `npm run rollout` will target stale/template scriptIds. Fix: automate sync-before-rollout via a composite npm script, or have rollout read directly from CB via the Sheets API rather than `clients.json`.

### React App
- Autocomplete dropdowns — Room + Sidemark data mixed together
- Receiving page uses hardcoded table (no TanStack Table / no column reorder)
- Transfer Items dialog needs processing animation + disable buttons after complete
- Multi-row selection only picks last row for Will Call creation
- GitHub Pages CDN caching: hard-refresh (Ctrl+Shift+R) after deploy
- **Client dropdown load time** — occasional reports of slow (120s+) initial client list loads after a deploy. Root cause unclear — `useClients` goes through a single `useApiData` via `ClientsProvider` (session 63 refactor) and hits GAS `getClients` (no Supabase mirror for clients). Suspected: cold-cache first fetch plus GAS latency plus some edge where the fetch isn't being fired. localStorage cache makes subsequent loads instant, but the slow-first-load path should be investigated. Option: mirror `clients` to Supabase so first load is <100ms regardless.

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
