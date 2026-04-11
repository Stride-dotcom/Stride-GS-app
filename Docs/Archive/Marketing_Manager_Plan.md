# Marketing Campaign Manager — Full System Plan (Archived)

> **Status as of 2026-04-04:** ALL 5 PHASES COMPLETE. System is live. This doc preserves the build plan and decision log for reference.

---

## Overview

Integrate the Email Campaign Manager (`stridecampaignv2.5.gs`, 3,221 lines) into the React app as a new "Marketing" page. Admin-only. Full campaign management — create, edit, send, track — from the app UI, no spreadsheet interaction needed.

## Architecture

- React → StrideAPI.gs (proxy) → Campaign Spreadsheet + Gmail
- Sending alias: `SeattleReceiver@stridenw.com`
- Campaign spreadsheet: separate from client inventory sheets
- `CAMPAIGN_SHEET_ID` stored in StrideAPI.gs Script Properties
- Scheduled triggers (`runAllCampaigns`, `checkInbox`) stay in Apps Script standalone project
- No Supabase caching for marketing data (reads from spreadsheet directly)
- Campaign spreadsheet ID: `1p7dmJlqij2KzwAFiXCUBbUTeF5JVvQF7TQlrofp9tcg`

## Campaign spreadsheet tabs (8)

`Contacts, Campaigns, Campaign Contacts, Campaign Log, Templates, Settings, Dashboard, Suppression Log`

## Feature catalog

1. **Dashboard** — summary cards (contacts, campaigns, sent/reply/bounce/unsub rates), per-campaign stats table
2. **Campaigns** — list, status filters, create campaign, click → detail panel
3. **Campaign Detail Panel** — settings, templates, stats, actions (activate/pause/complete/run now/delete), campaign contacts sub-tab
4. **Contacts** — list, search, add/import/edit/suppress contacts, click → detail panel with campaign history
5. **Templates** — list, create/edit/duplicate templates, HTML body editor with token reference, preview
6. **Logs** — Campaign Log + Suppression Log sub-tabs, date/campaign/status filters, CSV export
7. **Settings** — sender config, booking URL, unsubscribe URL, daily digest settings

## API endpoints (26 total)

**READ (8):** `getMarketingDashboard`, `getMarketingCampaigns`, `getMarketingCampaignDetail`, `getMarketingContacts`, `getMarketingContactDetail`, `getMarketingTemplates`, `getMarketingLogs`, `getMarketingSettings`

**WRITE (15):** `createMarketingCampaign`, `updateMarketingCampaign`, `activateCampaign`, `pauseCampaign`, `completeCampaign`, `runCampaignNow`, `deleteCampaign`, `createMarketingContact`, `importMarketingContacts`, `updateMarketingContact`, `suppressContact`, `unsuppressContact`, `createMarketingTemplate`, `updateMarketingTemplate`, `updateMarketingSettings`

**GMAIL (3):** `sendTestEmail`, `previewTemplate`, `checkMarketingInbox`

## Locked decisions

1. Admin-only (nav + route + endpoint guards via `withAdminGuard_`)
2. Send from: `SeattleReceiver@stridenw.com`
3. Campaign spreadsheet stays separate (not merged with inventory)
4. All Gmail operations through StrideAPI.gs (proxy pattern)
5. Scheduled triggers stay in Apps Script standalone project
6. React manages campaigns/contacts/templates through the API
7. No Supabase caching for marketing data
8. DO NOT rebuild sending/suppression/trigger/scheduler logic — reimplement in StrideAPI.gs reading the same spreadsheet
9. All updates use header-mapped, patch-safe operations
10. No UI prompts or `SpreadsheetApp.getUi()` in API code paths

---

## Build phases

### Phase 1 — API Contract + Discovery ✅ COMPLETE (2026-04-03)

- Audited all 38 functions in `stridecampaignv2.5.gs` (3,221 lines)
- Classified: 13 Engine Wrappers (A), 13 CRUD Bridge Helpers (B)
- Defined TypeScript interfaces for all 10 entity types + response shapes
- Created `stride-gs-app/docs/MARKETING_API_CONTRACTS.md` (26 endpoint specs)
- Key finding: StrideAPI.gs cannot call campaign script functions directly (separate project) — all logic must be reimplemented in StrideAPI.gs reading the same spreadsheet
- Gmail alias must be verified on StrideAPI.gs account

### Phase 2 — Backend (StrideAPI.gs endpoints) ✅ COMPLETE (2026-04-04)

- `CAMPAIGN_SHEET_ID` stored in Script Properties (`setupCampaignSheetId_()` one-time setup)
- All 26 endpoints built in StrideAPI.gs v38.0.0 (Web App v127)
- ~1,930 lines added
- 8 GET + 12 POST + 3 GMAIL + 3 helpers
- Admin-only guards (`withAdminGuard_`) on all endpoints
- LockService on: campaign create/activate/runNow/delete, contact import, settings update, inbox check
- Full email send cycle in `runCampaignNow`: suppression, 24h rule, quota check, template build, tracking marker, Gmail labels, follow-up scheduling, daily limit, campaign stats
- Inbox check: reply detection (thread lookup), bounce detection (mailer-daemon), unsub keywords

**Manual step:** Justin must run `setupCampaignSheetId_()` once from Apps Script editor.

### Phase 3 — React Read-Only UI ✅ COMPLETE (2026-04-04)

- `Marketing.tsx` page with 7 tabs wired to all 8 read endpoints
- Dashboard (6 stat cards, per-campaign table, Gmail quota)
- Campaigns (status chips, search, detail panel)
- Contacts (status chips, search, pagination, detail panel)
- Templates (search, merge token reference)
- Logs (Campaign/Suppression sub-tabs, CSV export, pagination)
- Settings (read-only sender/digest/unsub)
- Admin-only route guard + Mail icon in sidebar
- TypeScript interfaces + fetch functions for all marketing types
- Deployed (commit eb09a69)

### Phase 4 — React Write Actions ✅ COMPLETE (2026-04-04)

- All 18 POST functions in `api.ts` (campaign CRUD, contact CRUD, template CRUD, settings, Gmail)
- Marketing.tsx: Create/Edit/Delete campaigns, Activate/Pause/Complete/Run Now with confirm dialogs
- Create/Edit/Import contacts, Suppress/Unsuppress with confirm dialogs
- Create/Edit templates with merge token insertion buttons
- Settings edit/save mode, Check Inbox, Send Test Email, Preview Template (rendered HTML iframe)
- Result banners, disabled-during-execution buttons, auto-refresh after writes
- Deployed (commit 68d5c15)

### Phase 5 — Polish ✅ COMPLETE (2026-04-04)

- Mobile responsive layout across all 7 tabs, 9 modals, detail panels, confirm dialogs (`useIsMobile` hook)
- ProcessingOverlay on all write-action modals and confirm dialogs
- Tables horizontally scrollable on mobile with min-width constraints
- Form grids stack to single column on mobile
- Dashboard stat cards 2-column on mobile, campaign detail stats 3-column grid
- Modal bottom-sheet presentation on mobile (slides up from bottom, 90dvh max height)
- Tabs horizontally scrollable with reduced padding on mobile
- Deployed (commit 5c7b6d0)

---

## Reference docs

- `Docs/MARKETING_PAGE_BUILD_PLAN.md` — full feature catalog and React component plan
- `stride-gs-app/docs/MARKETING_API_CONTRACTS.md` — endpoint specifications (Phase 1 output)
- `AppScripts/Email Campaign App/stridecampaignv2.5.gs` — campaign engine source (3,221 lines)
- `AppScripts/Email Campaign App/CLAUDE.md` — campaign system architecture reference
