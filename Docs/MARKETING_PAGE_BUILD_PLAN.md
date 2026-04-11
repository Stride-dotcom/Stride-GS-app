# Marketing Page — Build Plan
## Stride GS Inventory App — Email Campaign Manager Integration

**Status:** Planning
**Date:** 2026-04-03

---

## Overview

Integrate the full Email Campaign Manager (stridecampaignv2.5.gs, 3,221 lines) into the React app as a new "Marketing" page. Admin-only. Full campaign management — create, edit, send, track — all from the app UI, no spreadsheet interaction needed.

**Architecture:** React → StrideAPI.gs (proxy) → Campaign Spreadsheet + Gmail
**Sending alias:** SeattleReceiver@stridenw.com
**Campaign spreadsheet:** Separate from client inventory sheets (stored as CAMPAIGN_SHEET_ID in Script Properties)

---

## Feature Catalog

### 1. Dashboard Tab
- Summary cards: Total Contacts, Active Campaigns, Emails Sent (30d), Reply Rate, Bounce Rate, Unsubscribe Rate
- Per-campaign stats table: name, type, status, sent/remaining/replied/bounced/unsubs/conversions
- Global totals row
- Last run timestamp + next scheduled run
- Refresh button

### 2. Campaigns Tab
- Campaign list table: name, type (Blast/Sequence), status (Draft/Active/Paused/Completed), targeting, sent count, reply count, created date
- Status filter chips: All, Draft, Active, Paused, Completed
- **Create Campaign** button → opens campaign creation form
- Click row → Campaign Detail Panel (slide-in)

### 3. Campaign Detail Panel
- Campaign header: name, type, status badge, priority
- Stats cards: sent, replied, bounced, unsubs, conversions, errors
- **Settings section:**
  - Targeting: dropdown (All Leads, Existing Clients, Non-Clients, Tag, Manual List)
  - Enrollment: Dynamic vs Snapshot
  - Daily limit, send window (start/end hour)
  - Start/end dates
  - Priority (lower = higher)
  - Test mode toggle + test recipient email
- **Templates section:**
  - Initial template: dropdown from Templates tab
  - Follow-up 1/2/3 templates (for Sequence campaigns)
  - Follow-up intervals (days)
  - Custom merge values (Custom 1, 2, 3)
  - Preview button → renders template with sample data
- **Actions:**
  - Activate / Pause / Complete campaign
  - Run Now (manual trigger)
  - Delete (with confirmation)
- **Campaign Contacts sub-tab:**
  - Table of enrolled contacts: name, email, status, last sent, follow-up stage
  - Filter: All, Pending, Sent, Replied, Bounced, Exhausted

### 4. Contacts Tab
- Contacts table: name, email, company, status, date added, last campaign, suppression flags
- Status filter chips: All, Pending, Client, Suppressed
- Search bar
- **Add Contact** button → form: first name, last name, email, company
- Click row → Contact Detail Panel
  - Contact info fields (editable)
  - Campaign history (which campaigns, when sent, status)
  - Suppression status + reason
  - Manual suppress/unsuppress action
- **Import Contacts** button → file upload or paste
- **Bulk actions:** Suppress, Tag, Delete

### 5. Templates Tab
- Template list: name, subject, preview text, version, last modified
- **Create Template** button → template editor form
  - Name, subject, preview text
  - HTML body editor (textarea with token reference)
  - Token reference sidebar (list of all 18 merge tokens)
  - Preview button → renders with sample data
- Click row → edit template
- Duplicate button

### 6. Logs Tab
- Sub-tabs:
  - **Campaign Log** — every send attempt: timestamp, campaign, contact, email, status (sent/failed/skipped), error message
  - **Suppression Log** — every suppression event: timestamp, email, reason (bounced/unsubscribed/replied), source campaign
- Filters: date range, campaign, status
- Export CSV

### 7. Settings Tab (Marketing-specific)
- Sender config: Send From email, Sender Name, Reply-To, Phone, Website
- Booking URL (merge token)
- Unsubscribe base URL
- Daily digest recipient email
- Daily digest enable/disable
- Test mode global override

---

## API Endpoints Needed (StrideAPI.gs)

### READ Endpoints (8)
1. `getMarketingDashboard` — aggregated stats
2. `getMarketingCampaigns` — campaigns list
3. `getMarketingCampaignDetail` — single campaign + contacts
4. `getMarketingContacts` — contacts list with pagination
5. `getMarketingContactDetail` — single contact + history
6. `getMarketingTemplates` — templates list
7. `getMarketingLogs` — campaign log + suppression log
8. `getMarketingSettings` — sender config

### WRITE Endpoints (12)
9. `createMarketingCampaign` — create new campaign
10. `updateMarketingCampaign` — edit campaign settings
11. `activateCampaign` / `pauseCampaign` / `completeCampaign` — status changes
12. `runCampaignNow` — manual trigger
13. `deleteCampaign` — delete with confirmation
14. `createMarketingContact` — add single contact
15. `importMarketingContacts` — bulk import
16. `updateMarketingContact` — edit contact
17. `suppressContact` / `unsuppressContact` — manage suppression
18. `createMarketingTemplate` — create template
19. `updateMarketingTemplate` — edit template
20. `updateMarketingSettings` — save sender config

### GMAIL Endpoints (3)
21. `sendTestEmail` — preview send to test address
22. `previewTemplate` — render template with sample data (no send)
23. `checkMarketingInbox` — manual inbox check (replies/bounces)

---

## React Pages/Components

### New Files (~15)
- `src/pages/Marketing.tsx` — main page with tab navigation
- `src/components/marketing/CampaignDetailPanel.tsx`
- `src/components/marketing/ContactDetailPanel.tsx`
- `src/components/marketing/CreateCampaignModal.tsx`
- `src/components/marketing/CreateContactModal.tsx`
- `src/components/marketing/CreateTemplateModal.tsx`
- `src/components/marketing/TemplatePreview.tsx`
- `src/components/marketing/ImportContactsModal.tsx`
- `src/hooks/useMarketingDashboard.ts`
- `src/hooks/useMarketingCampaigns.ts`
- `src/hooks/useMarketingContacts.ts`
- `src/hooks/useMarketingTemplates.ts`
- `src/hooks/useMarketingLogs.ts`
- `src/hooks/useMarketingSettings.ts`

### Existing Files to Update
- `App.tsx` — add /marketing route (admin-only RoleGuard)
- `Sidebar.tsx` — add Marketing nav item (admin-only)
- `api.ts` — add all marketing API functions + types

---

## Build Phases

### Phase 1: Backend (StrideAPI.gs)
- Store CAMPAIGN_SHEET_ID in Script Properties
- Build all 23 endpoints
- Port key functions from stridecampaignv2.5.gs (campaign runner, contact enrollment, suppression, template resolution, Gmail sending)
- Admin-only guards on all endpoints

### Phase 2: React — Read-Only
- Build Marketing.tsx with 7 tabs
- Wire all read endpoints
- Dashboard with computed stats
- Campaign/Contact/Template list views
- Log views with filtering

### Phase 3: React — Write Actions
- Campaign create/edit/activate/pause/complete/delete
- Contact add/import/edit/suppress
- Template create/edit
- Settings save
- Test email send
- Campaign manual run

### Phase 4: Polish
- Template preview renderer
- Responsive/mobile layout
- Loading/error states
- Confirmation dialogs on destructive actions

---

## Locked Decisions
- Admin-only (nav + route + endpoint guards)
- Send from: SeattleReceiver@stridenw.com
- Campaign spreadsheet stays separate (not merged with inventory)
- All Gmail operations through StrideAPI.gs (proxy pattern)
- Scheduled triggers (runAllCampaigns, checkInbox) stay in Apps Script
- React manages campaigns/contacts/templates through the API
- No Supabase caching for marketing data (keep it simple, read from spreadsheet)
