# Stride Logistics — Email Campaign App

## What This Is

A complete email marketing and CRM system for Stride Logistics, built on Gmail + Google Apps Script + Google Sheets. It sends branded HTML emails to interior designers and architects in the Seattle metro area, manages follow-up sequences, tracks replies/bounces/conversions, and handles unsubscribes automatically.

## Owner

Justin Tong — justin@stridenw.com
Stride Logistics (Express Installation Services Inc. DBA Stride Logistics)
(206) 550-1848 | stridenw.com

## Key Links

- **Google Sheet:** https://docs.google.com/spreadsheets/d/1p7dmJlqij2KzwAFiXCUBbUTeF5JVvQF7TQlrofp9tcg/edit
- **Operations Guide:** https://docs.google.com/document/d/1KbcMITGdvRzgMCbwoeabqOYnWcUS-xYh3h2oeivOqFQ/edit
- **Apps Script:** Standalone project (access via script.google.com under justin@stridenw.com / Email@stridenw.com)
- **Script File:** `stridecampaignv2.5.gs` in this folder
- **Stride Website:** https://www.stridenw.com
- **Booking Page:** https://www.stridenw.com/booking-availability?ref=email
- **Stride Logo:** https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png

## Source Contact Spreadsheets

- **Architects & Interior Designers List:** `12cPe6-rI1knUwRJ1dxkGPH2Getiaiix4TQg0qcaO3aw`
  - First tab only. Headers row 3. Cols: A=Company, B=Website, C=Address, D=City, E=State, G=First Name, H=Last Name, I=Title, J=Email (index 9), K=Existing Account Y/N (index 10)
- **Client Email Mailing List:** `1jahMRsoCPaAwTXp5OQNoxtmcXQSb-z69Z8-kjdHw7Bk`
  - Col A=Potential Client Email (import as prospect), Col B=Existing Client Email (import as client), Col C=Non Working Emails (EXCLUDED)

## Architecture

### Current Version: v2.5 (~3,200 lines)

The system is a single `.gs` file deployed as a standalone Apps Script project. It creates and manages a Google Sheet with 8 tabs. All email templates are stored in the sheet (not hardcoded in the script). The script reads templates at runtime.

### 8 Tabs

| Tab | Purpose |
|-----|---------|
| **Contacts** | Master contact list. Every person who might receive an email. Fields: name, email, company, status, existing client flag, campaign tag, suppression fields, unsub token. |
| **Campaigns** | One row per campaign. Defines type (Blast/Sequence), targeting, templates, daily limits, follow-up rules, test mode, stats. |
| **Campaign Contacts** | One row per contact per campaign. Tracks enrollment, send history, follow-up progression, replies, bounces, conversions. This is the operational history table. |
| **Campaign Log** | Permanent log of every send attempt (success/fail/skip). One row per attempt. Never delete rows. |
| **Templates** | Email templates with name, subject, preview text, HTML body, version. Script reads by template name. Token reference section included. |
| **Settings** | Global settings: digest email, booking URL, unsubscribe base URL, sender info. Campaign-specific settings are in the Campaigns tab. |
| **Dashboard** | High-level stats per campaign and global totals. Refreshed via menu. |
| **Suppression Log** | Audit trail of every suppression event (bounces, unsubs, replies). Never delete rows. |

### Campaign Types

- **Blast** — single email, no follow-ups. Good for announcements, promotions.
- **Sequence** — initial email + up to 3 follow-ups spaced N days apart. Good for prospecting.

### Targeting Options

- All Active Leads (Status = Pending, not existing client)
- Existing Clients (Existing Client = TRUE)
- Non-Clients (Existing Client = FALSE)
- Campaign Tag (match contacts by Campaign Tag column value)
- Manual List (same as Campaign Tag, different label)

### Enrollment Modes

- **Dynamic** — checks for new matching contacts on every run, keeps enrolling
- **Snapshot** — enrolls matching contacts once at activation, list is frozen

### Custom Menu (Stride Campaign)

The Google Sheet has a custom menu with these options:
- Add New Contact (HTML form dialog)
- Create New Campaign (HTML form dialog with template dropdowns)
- Add New Template (HTML form dialog with token reference)
- Activate / Pause / Complete Campaign
- Preview Campaign Email
- Run All Campaigns
- Check Inbox
- Import Contacts / Refresh Dashboard / Send Daily Digest

### Automated Triggers

- `checkInbox()` — 7:30 AM Pacific daily (detects replies, bounces, unsub keywords)
- `runAllCampaigns()` — 8:30 AM Pacific daily (processes all active campaigns)
- `onOpen()` — installable trigger, creates the custom menu
- `onEditTrigger()` — auto-fills Date Added and Status on new contact rows

### Token System (18 tokens)

Templates support these merge tokens, replaced at send time:

**Contact:** `{{First Name}}`, `{{Last Name}}`, `{{Full Name}}`, `{{Company}}`, `{{Email}}`
**Links:** `{{BookingURL}}`, `{{EMAIL_HASH}}`, `{{UNSUB_URL}}`
**Campaign:** `{{Campaign Name}}`
**Sender:** `{{Sender Name}}`, `{{Sender Phone}}`, `{{Sender Email}}`, `{{Website URL}}`
**Date:** `{{Current Year}}`, `{{Current Month}}`, `{{Send Date}}`
**Custom:** `{{Custom 1}}`, `{{Custom 2}}`, `{{Custom 3}}` (set per campaign)

### Unsubscribe Web App

Deployed as a Google Apps Script web app (same project). `doGet(e)` handles one-click unsubscribes via unique token per contact. Shows branded Stride confirmation page, redirects to stridenw.com after 3 seconds.

## Hard Rules (enforced in code)

1. One active sequence per contact at a time
2. No contact receives more than one campaign email in 24 hours
3. Blasts do not bypass suppression
4. Bounces/unsubscribes = global suppression (blocked from ALL campaigns)
5. Replies = global suppression in v1 (may change in future versions)
6. Exhausted is campaign-specific only (in Campaign Contacts, not global)
7. All sends create both a Campaign Contacts row AND a Campaign Log row (blasts included)
8. Campaign Contacts row created at enrollment, not just after send success
9. Quota checked via `MailApp.getRemainingDailyQuota()` before each run
10. Campaign activation validates: templates exist, follow-up count matches, limits valid, dates valid, targeting valid

### Run Processing Order

1. Validate all Active campaigns
2. Sort by Priority (lower number = higher priority)
3. For each campaign: enroll new contacts (if Dynamic), get eligible Campaign Contacts
4. Apply global suppression check
5. Apply one-sequence-per-contact rule
6. Apply 24-hour rule
7. Apply quota limits
8. Send, log, update

## Thread Tracking

Each outgoing email embeds a unique tracking marker (`SID-HASH`) as 1px invisible text. After sending, the script searches Gmail for this marker to capture the Thread ID and Message ID. These are used for reply detection in `checkInbox()`.

The marker is generated per-send using `generateTrackingMarker_(campaignId, email, step)` — an MD5 hash of campaign + email + step + timestamp.

## Daily Digest

Sent once per day (guarded by Script Properties `LAST_DIGEST_DATE`). Includes per-campaign breakdown: sent today, total sent, replies, bounces, unsubs, conversions, errors, remaining quota.

## Contact Lifecycle

**Contacts tab (global):** Pending → Client or Suppressed
**Campaign Contacts tab (per campaign):** Pending → Sent → Follow-Up Scheduled → Sent → ... → Exhausted/Replied/Bounced/Unsubscribed/Converted/Complete

## Email Templates

Templates are NOT stored in the script. They live only in the Templates tab of the Google Sheet. Justin pastes HTML directly into the sheet (or uses the Add New Template form).

### Initial Campaign Template (v8)

The current initial prospecting email is a "pain-point" design:
- Hero: "the wrong receiver can quietly derail an otherwise beautiful project"
- Pain points section: "Sound Familiar?" with 5 orange-bar bullet items
- Trust section: "Why Designers Trust Stride" with 4 checkmark items
- Offer: Free first month storage + free delivery, King County
- Soft close + footer with unsubscribe

The HTML source was originally created in Claude and shared via artifact. The v8 version replaced the earlier v7 "services showcase" design.

### Follow-Up Templates

Shorter, warmer versions. Follow-Up 1 = gentle reminder, Follow-Up 2 = more direct, Follow-Up 3 = warm closing / offer expiring.

## Known Limitations / Future Improvements

- **No open tracking** — Gmail + Apps Script doesn't support native open rate tracking
- **No click tracking** — would require a redirect service
- **Reply suppression is global in v1** — may want to make it campaign-specific later so replied contacts can receive future campaigns
- **Performance at scale** — repeated full-sheet reads will slow down as data grows. Caching was added for some operations but could be improved further.
- **Template versioning** — just a text field for now. No automated snapshots.
- **No A/B testing** — future feature
- **No segment builder UI** — targeting is limited to 5 predefined types

## Build History

- **v1** — single campaign, hardcoded templates, Settings tab controlled everything
- **v2** — multi-campaign architecture, Campaign Contacts history table, campaign-level config
- **v2.4** — bug fixes: thread tracking marker (SID hash), daily digest guard, reply idempotency, bounce performance, boolean normalizer
- **v2.5** — added HTML form dialogs: Add New Contact, Create New Campaign, Add New Template. Updated custom menu.

## Email Sending Configuration

- **Send From:** SeattleReceiver@stridenw.com (Gmail alias on Email@stridenw.com account)
- **Sender Name:** Stride Logistics (from Settings tab)
- **Reply-To:** info@stridenw.com (from Settings tab, "Sender Email")
- **Send From Email** setting in Settings tab controls the `from` parameter in `GmailApp.sendEmail()`
- The alias was configured in Google Workspace Admin Console and Gmail "Send mail as" settings

## Apps Script Project

- **Project Name:** "stride campaign manager app" at script.google.com
- **Type:** Standalone (NOT bound to the spreadsheet)
- **Account:** Email@stridenw.com
- **Script File in this folder:** `stridecampaignv2.5.gs`

## Important Notes for Future Development

- The script is standalone (not bound to the spreadsheet). This means `SpreadsheetApp.getUi()` only works when triggered from the spreadsheet context (menu clicks, onOpen). All functions that use `getUi()` must have try/catch wrappers for when they're called from the Apps Script editor or triggers.
- For menu functions that detect the active sheet/cell (activateCampaign, pauseCampaign, completeCampaign), use `SpreadsheetApp.getActiveSpreadsheet()` NOT `ss.getActiveSheet()`. The `ss` variable from `getCampaignSheet_()` opens the spreadsheet by ID and does not have the active context.
- Column indexes are defined as constants at the top of the file (e.g., `CON_EMAIL = 5`, `CMP_STATUS = 3`). Always use these constants, never hardcode column numbers.
- The sheet ID is stored in Script Properties as `CAMPAIGN_SHEET_ID`. The `getCampaignSheet_()` helper retrieves it.
- `setupCampaign()` is idempotent — safe to re-run. It won't duplicate tabs, labels, or triggers.
- All settings come from the Settings tab — zero hardcoded values in the script (except source spreadsheet IDs).
- Email templates are NOT in the script. They live only in the Templates tab. The script reads them at runtime via `getTemplates()`.
- Google Workspace account: Email@stridenw.com / justin@stridenw.com

## Files in This Folder

- `CLAUDE.md` — this file (project context for Claude sessions)
- `stridecampaignv2.5.gs` — the complete Apps Script code (paste into script.google.com)
- `Stride-Campaign-Manager-Guide.docx` — operations guide for Justin

## Current Campaign Status

- **CMP-0002 "Designer Prospecting Q1"** — Draft, Sequence, targeting Non-Clients, Dynamic enrollment, Priority 1, templates: Initial / Follow-Up 1 / Follow-Up 2 / Follow-Up 3, Test Mode ON, daily limit 30, send window 8-17 Pacific
- 1634 total contacts imported (1553 pending leads, 81 existing clients)
- Unsubscribe web app deployed
- Needs: activate campaign, test with Preview, then set Test Mode to FALSE to go live
