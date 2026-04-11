# Phase 7 Repair Checklist

**Date:** 2026-03-30 → 2026-03-31 (sessions 17-20)
**Status:** Complete (all QA fixes deployed, "In Progress" status added, all deployment automated)

---

## Completed Repairs (this session)

### Critical
- [x] **Mock data flash eliminated** — All 6 data pages (Dashboard, Inventory, Tasks, Repairs, WillCalls, Billing) now show loading spinner instead of mock data while API loads
  - Files: Dashboard.tsx, Inventory.tsx, Tasks.tsx, Repairs.tsx, WillCalls.tsx, Billing.tsx
  - Pattern: `if (apiConfigured && loading && liveData.length === 0) return <Spinner />`
- [x] **Shipments loading guard** — Added spinner overlay during API load (prevents potential crash from rendering empty state)
  - File: Shipments.tsx
- [x] **RepairDetailPanel Item card** — Now uses repair object's own fields (itemId, vendor, description, itemClass, sidemark, location) instead of searching mock inventoryItems array
  - File: RepairDetailPanel.tsx
- [x] **RepairDetailPanel mock dependency removed** — Removed import of mock `inventoryItems` and `tasks`; Inspector Notes section uses repair.sourceTaskId directly
  - File: RepairDetailPanel.tsx

### High
- [x] **"Illegal spreadsheet id: JDA" — ROOT CAUSE FIXED** — `useClients.ts` was generating fake abbreviated IDs from client names (e.g., "JDA" from "Johnson Design Associates") and passing them as `clientSheetId` to ALL write API calls. Fixed: `client.id` now maps to `apiClient.spreadsheetId` (the real Google Sheets ID). This fix also resolves the "Demo mode" fallback on Repairs, Tasks, and other write actions that use client selection.
  - File: useClients.ts
- [x] **ALL detail panel writes silently entering Demo mode (session 18)** — Hook mapper functions renamed `api.clientSheetId` → `clientId` but didn't preserve `clientSheetId`. When pages cast back via `as unknown as ApiRepair`, `clientSheetId` was `undefined` → `demoMode=true` → fake success without API call. Fixed by adding `clientSheetId` pass-through in all 3 hooks + type interfaces. **E2E verified**: Send Repair Quote, Complete Task, Release Will Call all confirmed writing to Google Sheets.
  - Files: useRepairs.ts, useTasks.ts, useWillCalls.ts, types.ts, TaskDetailPanel.tsx
- [x] **Single-click detail panels** — Changed from `onDoubleClick` to `onClick` on Tasks, Repairs, WillCalls pages (with checkbox/actions exclusion)
  - Files: Tasks.tsx, Repairs.tsx, WillCalls.tsx

### Medium
- [x] **Dashboard task navigation** — Task row clicks now navigate to `/tasks` with `{ state: { openTaskId } }` and Tasks page auto-opens the matching detail panel
  - Files: Dashboard.tsx, Tasks.tsx
- [x] **All status filter chips visible** — Repairs (7 statuses) and WillCalls (5 statuses) now always show all filter chips, even for statuses with 0 count
  - Files: Repairs.tsx, WillCalls.tsx

### Low
- [x] **Em dash literal text in WillCallDetailPanel (session 18)** — `\u2014` in JSX text content renders literally; changed to `{'\u2014'}` (JS string expression)
  - File: WillCallDetailPanel.tsx:157

---

## Remaining Repairs (next session)

### Server-Side Configuration Required
- [x] ~~**Complete Shipment "Illegal spreadsheet id: JDA"**~~ — **FIXED** in useClients.ts (was passing fake abbreviated ID instead of real spreadsheetId)
- [x] **Start Task "No shipment folder / PHOTOS_FOLDER_ID"** — Fixed in v24.0.0. API now falls back to PHOTOS_FOLDER_ID / DRIVE_PARENT_FOLDER_ID from client Settings. Also fixed StrideAPI OAuth re-auth (scope token was stale).
- [x] **Cancel Will Call** — `handleCancelWillCall_` added to StrideAPI.gs v23.2.0, `postCancelWillCall` in api.ts, WillCallDetailPanel Cancel WC button fully wired with result card
- [x] **Print Release Doc** — `handleGetWcDocUrl_` added to StrideAPI.gs v23.3.0 (reads WC Number RichTextValue for folder URL, finds PDF in Drive folder), `fetchWcDocUrl` in api.ts, WillCallDetailPanel Print Release Doc button opens PDF in new tab with loading state + error display

### New Features (from QA audit)
- [x] **Column reorder + persistence** — Drag-and-drop column headers, saved per user per table in localStorage (`useTablePreferences` hook) ✅
- [x] **Persistent filter views** — Status filters saved per user in localStorage ✅
- [ ] **Autocomplete DB in React** — Save on blur, field-specific (Vendor, Description, Sidemark, Room), tab-to-accept
- [ ] **Billing: combined unbilled report with storage** — Include Storage checkbox + date range picker, inline edit, select rows for invoice/QB export

### Minor/Deferred
- [x] **Shipment detail panel items** — `handleGetShipments_` now reads Inventory tab and groups items by Shipment #. Shipments.tsx uses `apiShipments` directly, detail panel shows live items
- [x] **Settings.tsx Users tab** — Verified: Users tab already uses inline feedback (success/error banners, loading states). The 4 `alert('Coming soon')` are on other tabs (General, Notifications, Pricing) — intentional placeholders for unbuilt features
- [ ] **Global search expansion** — Add shipments, billing, claims entities + missing fields to universal search

---

### Server-Side Config
- [x] **Gmail OAuth scopes on StrideAPI.gs** — Fixed in session 19. `script.external_request` and `mail.google.com` scopes were already in manifest. Issue was stale OAuth token. Fixed by revoking app access at myaccount.google.com/permissions then re-authorizing from Apps Script editor.
- [x] **StrideAPI RPC method mismatch** — `api_nextShipmentNo_` was using GET instead of POST. Fixed in v23.8.0 to match client scripts' POST+JSON pattern.

### Session 19: Mock Data Removal + Email Parity
- [x] **All mock data removed** — Removed mock imports/fallbacks from 10+ files (Dashboard, Inventory, Tasks, Repairs, WillCalls, Claims, Shipments, Receiving, Billing, Settings, UniversalSearch). No `mockData.ts` imports remain in any page or component.
- [x] **UniversalSearch rewritten** — Uses live API hooks instead of mock arrays
- [x] **Billing inline mocks removed** — 13-row mockBillingData + 5-row INVOICE_REVIEW_DATA arrays removed
- [x] **Receiving hardcoded clients removed** — "Allison Lind Design" etc. dropdown fallback removed
- [x] **Password reset flow fixed** — recoveryRef prevents auto-login during password recovery
- [x] **Email parity for all write endpoints (v24.0.0)** — completeShipment, completeTask, respondToRepairQuote (Approve), createWillCall, processWcRelease now send emails with PDF attachments matching client script behavior
- [x] **Drive folder creation in API** — completeShipment creates Shipments/SHP-xxx folder, createWillCall creates WC folder, respondToRepairQuote creates REPAIR-xxx folder

### Session 20: QA Bug Fixes + "In Progress" Status + Deployment Automation
- [x] **Receiving class default** — Item class no longer defaults to "M"; empty `--` option added (Receiving.tsx)
- [x] **Service code → service name** — Tasks, Dashboard, TaskDetailPanel show mapped names using existing `SERVICE_CODES` constant (Tasks.tsx, Dashboard.tsx, TaskDetailPanel.tsx)
- [x] **Remove "+ Create" from autocomplete** — Removed `showCustomOption` / "+ Create" option block; free-text still works via `allowCustom` (AutocompleteInput.tsx)
- [x] **Will Call pre-selected items** — `useEffect` sync + `useRef` guard for `autoClient` state (CreateWillCallModal.tsx)
- [x] **ProcessingOverlay** — New reusable component blocking interaction during async ops (ProcessingOverlay.tsx, TaskDetailPanel, RepairDetailPanel, WillCallDetailPanel, Receiving)
- [x] **Task completion UX** — Panel close disabled during processing; status-based row highlighting (Tasks.tsx, TaskDetailPanel.tsx)
- [x] **"In Progress" task status** — Full multi-system: StrideAPI.gs v24.1.0 (handleStartTask_ sets status), Code.gs v4.1.0 (validation lists), task board script v1.5.0 (default filter), React (types, constants, hooks, Badge, Tasks, TaskDetailPanel)
- [x] **push-taskboard.mjs** — New terminal deployment script for Task Board (no more manual paste)
- [x] **push-stax.mjs** — New terminal deployment script for Stax Auto Pay (no more manual paste)
- [x] **All 6 Apps Script projects now deploy via terminal** — zero manual paste required

## Build Verification
- [x] `npx tsc --noEmit` — passes clean (0 errors)
- [x] `npm run build` — succeeds (`index-BhVhBPiP.js`)
- [x] Deploy to GitHub Pages — deployed session 20 (`598dd3c`)
