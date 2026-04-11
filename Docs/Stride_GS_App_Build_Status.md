# Stride GS App — Build Status & Continuation Guide

**Last updated:** 2026-04-11 (session 59 — Welcome email auto-send on activation + Users page button + build pipeline fix)
**StrideAPI.gs:** v38.43.0 (Web App v232)
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
- **API:** `AppScripts/stride-api/StrideAPI.gs` — standalone project, v38.42.0 (Web App v231)
- **Stax Auto Pay:** `AppScripts/stax-auto-pay/StaxAutoPay.gs` — v4.5.0, bound to Stax spreadsheet
- **Supabase cache:** 6 mirror tables + `gs_sync_events` failure tracking

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

## RECENT CHANGES (2026-04-11 session 59)

### Session 59: Welcome email auto-send on activation + Users page Send button + build pipeline fix

Five interlocking changes to the welcome-email path, plus the discovery of a serious build pipeline regression that had been silently shipping stale bundles since session 58.

**1. Test-send "Unknown templateKey" bug fixed.** `handleTestSendClientTemplates_`'s hardcoded `CLIENT_TEMPLATES` list didn't include `WELCOME_EMAIL` or `ONBOARDING_EMAIL`. The React Template Editor sends test requests for these system-category keys and the endpoint returned `Unknown templateKey: WELCOME_EMAIL`. Added both to the list with appropriate subjects. Also added `{{SPREADSHEET_URL}}` and `{{CLIENT_EMAIL}}` to the mock token set so the rendered preview resolves cleanly.

**2. `handleSyncTemplatesToClients_` header lookup bug fixed.** Line 14908 was searching `cbHeaders.indexOf("SPREADSHEET ID")` but the actual CB Clients header uppercases to `"CLIENT SPREADSHEET ID"`. The React "Sync Email Templates to Clients" button errored with "CB Clients missing required columns" and did nothing. Now uses `"CLIENT SPREADSHEET ID"` first with a legacy fallback.

**3. `handleSendWelcomeEmail_` recipient override.** Previously hardcoded to send to the client's `CLIENT_EMAIL` from Settings. Now accepts optional `payload.recipient` to override — used by user activation + batch resend flows where the target is a specific user email (from CB Users) that may differ from the client's primary email.

**4. NEW `api_sendWelcomeOnce_` helper + auto-send on activation.** Dedups via an auto-created `Welcome Sent At` column on CB Users (appended non-destructively on first call). Only fires for role=client. Never throws. Wired into three activation sites:
- `api_upsertClientUser_` — the onboarding path creates client users with Active=TRUE immediately
- `handleCreateUser_` — manual create with `active: "TRUE"` override (non-default)
- `handleUpdateUser_` — captures `prevActive` before the write and fires on FALSE→TRUE transitions

**5. NEW `sendWelcomeToUsers` batch endpoint + React Send Welcome button.** Admin-only endpoint that accepts a `userEmails` array. For each user: looks up their row in CB Users, fires `handleSendWelcomeEmail_` with `recipient` override set to the user's email and `clientSheetId` set to their first client sheet. BYPASSES the `Welcome Sent At` dedup guard (explicit resend) but still updates the timestamp after successful send. React Settings → Users tab now has a **Send Welcome** button in the actions column next to Login As, admin-only, only visible for client-role users (staff/admin don't need the mystridehub.com walkthrough). Shows an inline success/error banner after the send completes.

**6. Client-bound `Emails.gs` v4.2.0 — `{{APP_URL}}` token parity.** The spreadsheet custom menu "Send Welcome Email" path uses `sendWelcomeEmail_` which loads the template from local `Email_Template_Cache` first, then Master as fallback. The client-side token resolver previously only knew `{{CLIENT_NAME}}`, `{{SPREADSHEET_URL}}`, `{{CLIENT_EMAIL}}` — so if the Master template was updated to use `{{APP_URL}}` for the login CTA (as it should), the spreadsheet-menu path would render `{{APP_URL}}` as literal text. Added `{{APP_URL}}: "https://www.mystridehub.com"` to both the production path and the test-send path.

**7. CRITICAL — React build pipeline regression found and fixed.** The stride-gs-app root `index.html` had been silently broken since commit `8441ff3` (session 58 — Dashboard Created column fix). The `<script>` tag referenced a built asset `/assets/index-5gy4c4OL.js` instead of the source entry `/src/main.tsx`. Vite reads `index.html` as the build entry point, so every `npm run build` since session 58 transformed only 6 modules (the HTML itself + its script tag + its CSS link) and produced a no-op bundle that just echoed the previously-built JS. **This means the release_date fix (session 58), the Dashboard Created column fix, and the DT Phase 1b Orders tab were NEVER actually shipped to mystridehub.com — the production bundle was locked at the pre-session-58 version.** Fix: replaced the bad `<script>` line with `<script type="module" src="/src/main.tsx"></script>` and rebuilt clean. New build transformed 1,875 modules and produced `index-BuGBj9aB.js` (1,449,990 bytes, 15KB larger than the stale echo). **This deploy contains ALL React changes from the past three sessions that were previously stuck in the build cache.**

Deployed: StrideAPI.gs v38.43.0 → Web App v232. Emails.gs v4.2.0 rolled to all 6 clients. React dist commit `5730f7a` → GitHub Pages (bundle `index-BuGBj9aB.js`). TypeScript clean.

**Still required (user action):** Go to Settings → Email Templates → click "Sync to Clients". This pushes the correct Master `WELCOME_EMAIL` template down to each client's local `Email_Template_Cache` tab. The curl path I tried hit a 502 because the sync takes ~30s across 6 clients and intermediate gateways time out — the React page handles the long-running call via the browser fetch so it works there. After the sync runs successfully, the spreadsheet custom menu "Send Welcome Email" will also produce the correct mystridehub.com-linking version.

Previous sessions (58 releaseItems Supabase sync fix, 57 DT Phase 1b Orders tab): See `Docs/Archive/Session_History.md`.

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
