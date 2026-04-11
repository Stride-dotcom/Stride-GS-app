# Marketing Campaign Manager — API Contracts

**Status:** Phase 1 Complete (Discovery + Contracts)
**Date:** 2026-04-03

---

## Campaign Spreadsheet Reference

**Sheet ID:** Stored as `CAMPAIGN_SHEET_ID` in StrideAPI.gs Script Properties
**Spreadsheet ID:** `1p7dmJlqij2KzwAFiXCUBbUTeF5JVvQF7TQlrofp9tcg`

### Tabs & Headers

| Tab | Key Columns |
|-----|-------------|
| Contacts (21 cols) | Date Added, Added By, Source, First Name, Last Name, Email, Company, Status, Existing Client, Campaign Tag, Last Campaign Sent Date, Replied, Converted, Bounced, Unsubscribed, Suppressed, Suppression Reason, Suppression Date, Manual Release Note, Unsub Token, Notes |
| Campaigns (35 cols) | Campaign ID, Campaign Name, Type, Status, Priority, Target Type, Target Value, Enrollment Mode, Initial Template, Follow-Up 1-3 Templates, Max Follow-Ups, Follow-Up Interval Days, Daily Send Limit, Send Window Start/End, Start/End Date, Test Mode, Test Recipient, Created Date, Last Run Date, Validation Status/Notes, Last Error, Total Sent/Replied/Bounced/Unsubscribed/Converted, Notes, Custom 1-3 |
| Campaign Contacts (22 cols) | Campaign ID, Campaign Name, Contact Email, Contact Name, Campaign Type, Status, Current Step, Follow-Up Count, Last Contact Date, Next Follow-Up Date, Last Attempt Date, Replied, Bounced, Unsubscribed, Converted, Suppressed, Suppression Reason, Gmail Thread ID, Gmail Message ID, Date Entered, Date Completed, Completed Reason |
| Campaign Log (12 cols) | Timestamp, Campaign ID, Campaign Name, Email, Contact Name, Company, Template Name, Email Step, Subject, Send Result, Error Message, Test Mode Used |
| Templates (5 cols) | Template Name, Subject Line, Preview Text, HTML Body, Version |
| Settings (2 cols) | Key, Value |
| Dashboard | Computed — not directly read |
| Suppression Log (6 cols) | Timestamp, Email, First Name, Company, Suppression Reason, Triggered By |

---

## Function Audit Summary

### Classification Key
- **A = Engine Wrapper** — Existing function can be called/adapted directly
- **B = CRUD Bridge Helper** — New function needed (current uses UI prompts/active cell)

### Mapping

| Planned Endpoint | Engine Function(s) | Type | Notes |
|---|---|---|---|
| `getMarketingDashboard` | `refreshDashboard()`, `getCampaigns()`, contacts/CC data reads | A | Compute in memory, return JSON (don't write to Dashboard tab) |
| `getMarketingCampaigns` | `getCampaigns()` | A | Direct read, normalize rows to objects |
| `getMarketingCampaignDetail` | `getCampaigns()` + CC tab read | A | Filter CC rows by campaign ID |
| `getMarketingContacts` | Contacts tab read | B | New paginated reader with optional filters |
| `getMarketingContactDetail` | Contacts tab + CC tab reads | B | New — join contact row with CC history |
| `getMarketingTemplates` | `getTemplates()` | A | Direct read |
| `getMarketingLogs` | Campaign Log + Suppression Log reads | B | New — read both tabs, apply filters |
| `getMarketingSettings` | `getSettings()` | A | Direct read |
| `createMarketingCampaign` | `createCampaignFromForm()` | A | Already headless, returns `{success, message}` |
| `updateMarketingCampaign` | — | B | New — patch campaign row fields by Campaign ID |
| `activateCampaign` | `activateCampaign()` core logic + `validateCampaign_()` + `enrollContacts_()` | B | Headless version: accept campaignId param, no getActiveCell |
| `pauseCampaign` | `pauseCampaign()` core logic | B | Headless version: accept campaignId param |
| `completeCampaign` | `completeCampaign()` core logic | B | Headless version: accept campaignId param |
| `runCampaignNow` | `runAllCampaigns()` inner loop | A | Run single campaign by ID (extract from main loop) |
| `deleteCampaign` | — | B | New — delete campaign row + associated CC rows |
| `createMarketingContact` | `addContactFromForm()` | A | Already headless |
| `importMarketingContacts` | `importContacts()` | A | Remove UI alert wrapper |
| `updateMarketingContact` | — | B | New — patch contact row fields by email |
| `suppressContact` | `processUnsubscribes()` | A | Pass reason="Manual" |
| `unsuppressContact` | — | B | New — clear suppression flags + add Manual Release Note |
| `createMarketingTemplate` | `addTemplateFromForm()` | A | Already headless |
| `updateMarketingTemplate` | — | B | New — patch template row fields by name |
| `updateMarketingSettings` | — | B | New — patch Settings tab key/value pairs |
| `sendTestEmail` | `previewCampaignEmail()` core logic + `buildEmail()` | B | Headless version: accept campaignId + optional step |
| `previewTemplate` | `buildEmail()` | A | Render template with sample data, return HTML (no send) |
| `checkMarketingInbox` | `checkInbox()` | A | Direct call, return summary of what was found |

**Summary: 13 Engine Wrappers (A), 13 CRUD Bridge Helpers (B)**

---

## TypeScript Interfaces

### Shared Types

```typescript
// Status enums
type CampaignStatus = 'Draft' | 'Active' | 'Paused' | 'Complete';
type CampaignType = 'Blast' | 'Sequence';
type ContactStatus = 'Pending' | 'Client' | 'Suppressed';
type CampaignContactStatus = 'Pending' | 'Sent' | 'Follow-Up Scheduled' | 'Replied' | 'Bounced' | 'Unsubscribed' | 'Exhausted' | 'Complete';
type TargetType = 'All Active Leads' | 'Existing Clients' | 'Non-Clients' | 'Campaign Tag' | 'Manual List';
type EnrollmentMode = 'Dynamic' | 'Snapshot';
type LogResult = 'Success' | 'Failed' | 'Skipped';

interface MarketingApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### Entity Types

```typescript
interface MarketingCampaign {
  campaignId: string;           // CMP-0001
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  priority: number;
  targetType: TargetType;
  targetValue: string;
  enrollmentMode: EnrollmentMode;
  initialTemplate: string;
  followUp1Template: string;
  followUp2Template: string;
  followUp3Template: string;
  maxFollowUps: number;
  followUpIntervalDays: number;
  dailySendLimit: number;
  sendWindowStart: number;      // 0-23
  sendWindowEnd: number;        // 1-24
  startDate: string | null;     // ISO date
  endDate: string | null;       // ISO date
  testMode: boolean;
  testRecipient: string;
  createdDate: string;          // ISO date
  lastRunDate: string | null;   // ISO date
  validationStatus: string;
  validationNotes: string;
  lastError: string;
  totalSent: number;
  totalReplied: number;
  totalBounced: number;
  totalUnsubscribed: number;
  totalConverted: number;
  notes: string;
  custom1: string;
  custom2: string;
  custom3: string;
}

interface MarketingContact {
  email: string;                // unique key
  firstName: string;
  lastName: string;
  company: string;
  status: ContactStatus;
  existingClient: boolean;
  campaignTag: string;
  dateAdded: string;            // ISO date
  addedBy: string;
  source: string;
  lastCampaignDate: string | null;
  replied: boolean;
  converted: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  suppressed: boolean;
  suppressionReason: string;
  suppressionDate: string | null;
  manualReleaseNote: string;
  notes: string;
}

interface CampaignContact {
  campaignId: string;
  campaignName: string;
  email: string;
  contactName: string;
  campaignType: CampaignType;
  status: CampaignContactStatus;
  currentStep: string;          // Initial, Follow-Up 1/2/3
  followUpCount: number;
  lastContactDate: string | null;
  nextFollowUpDate: string | null;
  lastAttemptDate: string | null;
  replied: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  converted: boolean;
  suppressed: boolean;
  suppressionReason: string;
  dateEntered: string;
  dateCompleted: string | null;
  completedReason: string;
}

interface MarketingTemplate {
  name: string;                 // unique key
  subject: string;
  previewText: string;
  htmlBody: string;
  version: string;
}

interface CampaignLogEntry {
  timestamp: string;            // ISO date
  campaignId: string;
  campaignName: string;
  email: string;
  contactName: string;
  company: string;
  templateName: string;
  emailStep: string;
  subject: string;
  result: LogResult;
  errorMessage: string;
  testModeUsed: boolean;
}

interface SuppressionLogEntry {
  timestamp: string;
  email: string;
  firstName: string;
  company: string;
  reason: string;
  triggeredBy: string;
}

interface MarketingSettings {
  dailyDigestEmail: string;
  bookingUrl: string;
  unsubscribeBaseUrl: string;
  senderName: string;
  senderPhone: string;
  senderEmail: string;
  sendFromEmail: string;
  websiteUrl: string;
}

interface DashboardStats {
  totalContacts: number;
  activeLeads: number;
  existingClients: number;
  suppressed: number;
  activeCampaigns: number;
  gmailQuotaRemaining: number;
  campaigns: DashboardCampaignRow[];
  globalTotals: {
    sent: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    converted: number;
  };
}

interface DashboardCampaignRow {
  campaignId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  priority: number;
  enrolled: number;
  sent: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  converted: number;
  pending: number;
  exhausted: number;
  lastRunDate: string | null;
}
```

---

## Endpoint Specifications

### READ Endpoints

---

#### 1. `getMarketingDashboard`

**Method:** GET
**Parameters:** none
**Wraps:** `refreshDashboard()` logic (compute in memory, NOT write to Dashboard tab) + `getCampaigns()` + Contacts/CC tab reads
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<DashboardStats>
```

**Implementation notes:**
- Read Contacts tab → count total, pending, client, suppressed
- Read Campaigns tab → `getCampaigns()` rows
- Read Campaign Contacts tab → count per-campaign statuses
- Read `MailApp.getRemainingDailyQuota()`
- Return computed stats as JSON — do NOT write to Dashboard tab

---

#### 2. `getMarketingCampaigns`

**Method:** GET
**Parameters:** `status` (optional filter: Draft/Active/Paused/Complete)
**Wraps:** `getCampaigns()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ campaigns: MarketingCampaign[] }>
```

**Implementation notes:**
- Call `getCampaigns()`, normalize each row array into `MarketingCampaign` object
- Optional status filter applied after read

---

#### 3. `getMarketingCampaignDetail`

**Method:** GET
**Parameters:** `campaignId` (required)
**Wraps:** `getCampaigns()` + Campaign Contacts tab read
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{
  campaign: MarketingCampaign;
  contacts: CampaignContact[];
  stats: {
    enrolled: number;
    pending: number;
    sent: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    exhausted: number;
    converted: number;
  };
}>
```

**Implementation notes:**
- Find campaign row by ID from `getCampaigns()`
- Read Campaign Contacts tab, filter rows where `Campaign ID === campaignId`
- Compute stats by counting CC statuses

---

#### 4. `getMarketingContacts`

**Method:** GET
**Parameters:** `status` (optional), `search` (optional, searches email/name/company), `page` (default 1), `pageSize` (default 100)
**Wraps:** Direct Contacts tab read
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{
  contacts: MarketingContact[];
  total: number;
  page: number;
  pageSize: number;
}>
```

**Implementation notes:**
- Read Contacts tab, normalize rows to `MarketingContact` objects
- Apply status filter (Pending/Client/Suppressed) if provided
- Apply search filter (case-insensitive match on email, firstName, lastName, company)
- Paginate results

---

#### 5. `getMarketingContactDetail`

**Method:** GET
**Parameters:** `email` (required)
**Wraps:** Direct Contacts + Campaign Contacts tab reads
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{
  contact: MarketingContact;
  campaignHistory: CampaignContact[];
}>
```

**Implementation notes:**
- Find contact row by email (case-insensitive)
- Read Campaign Contacts tab, filter rows where `Contact Email === email`

---

#### 6. `getMarketingTemplates`

**Method:** GET
**Parameters:** none
**Wraps:** `getTemplates()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ templates: MarketingTemplate[] }>
```

**Implementation notes:**
- Call `getTemplates()`, convert map to array of `MarketingTemplate` objects
- Stop at `--- TOKEN REFERENCE ---` row (already handled by `getTemplates()`)

---

#### 7. `getMarketingLogs`

**Method:** GET
**Parameters:** `logType` (required: "campaign" | "suppression"), `campaignId` (optional), `result` (optional), `startDate` (optional), `endDate` (optional), `page` (default 1), `pageSize` (default 100)
**Wraps:** Direct Campaign Log / Suppression Log tab reads
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
// When logType === "campaign":
MarketingApiResponse<{
  logs: CampaignLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}>

// When logType === "suppression":
MarketingApiResponse<{
  logs: SuppressionLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}>
```

**Implementation notes:**
- Read the appropriate tab based on `logType`
- Apply optional filters (campaignId, result, date range)
- Return newest-first (reverse row order)
- Paginate results

---

#### 8. `getMarketingSettings`

**Method:** GET
**Parameters:** none
**Wraps:** `getSettings()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<MarketingSettings>
```

**Implementation notes:**
- Call `getSettings()`, map keys to camelCase `MarketingSettings` properties

---

### WRITE Endpoints

---

#### 9. `createMarketingCampaign`

**Method:** POST
**Parameters:** `name` (required), `type`, `priority`, `targetType`, `targetValue`, `enrollment`, `tplInitial`, `tplFU1`, `tplFU2`, `tplFU3`, `maxFU`, `interval`, `dailyLimit`, `sendStart`, `sendEnd`, `testMode`, `testRecipient`
**Wraps:** `createCampaignFromForm()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** Yes (LockService — prevent duplicate campaign IDs)

**Response:**
```typescript
MarketingApiResponse<{ campaignId: string; campaign: MarketingCampaign }>
```

**Implementation notes:**
- Call `createCampaignFromForm(data)` — already returns `{success, message}`
- Also return the full normalized campaign object after creation

---

#### 10. `updateMarketingCampaign`

**Method:** POST
**Parameters:** `campaignId` (required), plus any fields from `MarketingCampaign` to patch
**Wraps:** — (new CRUD helper)
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ campaign: MarketingCampaign }>
```

**Implementation notes:**
- Find campaign row by ID via `findCampaignRow_()`
- Only update provided fields (patch semantics)
- Only allow updates when status is Draft or Paused
- Return updated campaign object

---

#### 11. `activateCampaign`

**Method:** POST
**Parameters:** `campaignId` (required)
**Wraps:** `activateCampaign()` core logic + `validateCampaign_()` + `enrollContacts_()`
**Type:** B (CRUD Bridge — headless version needed)
**Admin-only:** Yes
**Locking:** Yes (LockService — prevent concurrent activation)

**Response:**
```typescript
MarketingApiResponse<{
  campaign: MarketingCampaign;
  enrolled: number;
  validationNotes: string;
}>
```

**Implementation notes:**
- Extract activation logic from `activateCampaign()` lines 831-886
- Remove all `SpreadsheetApp.getUi()` / `getActiveCell()` references
- Accept `campaignId` as parameter instead of reading active cell
- Call `validateCampaign_()` → if invalid, return error with validation notes
- Set status to Active, call `enrollContacts_()`

---

#### 12. `pauseCampaign`

**Method:** POST
**Parameters:** `campaignId` (required)
**Wraps:** `pauseCampaign()` core logic
**Type:** B (CRUD Bridge — headless version needed)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ campaign: MarketingCampaign }>
```

---

#### 13. `completeCampaign`

**Method:** POST
**Parameters:** `campaignId` (required)
**Wraps:** `completeCampaign()` core logic
**Type:** B (CRUD Bridge — headless version needed)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ campaign: MarketingCampaign; contactsCompleted: number }>
```

**Implementation notes:**
- Set campaign status to Complete
- Mark all Pending/Sent/Follow-Up Scheduled CC rows as Complete
- Return count of contacts completed

---

#### 14. `runCampaignNow`

**Method:** POST
**Parameters:** `campaignId` (required)
**Wraps:** `runAllCampaigns()` inner loop (lines 962-1220)
**Type:** A (Engine Wrapper — extract single-campaign path)
**Admin-only:** Yes
**Locking:** Yes (LockService — prevent concurrent runs)

**Response:**
```typescript
MarketingApiResponse<{
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}>
```

**Implementation notes:**
- Extract the per-campaign processing loop from `runAllCampaigns()`
- Run for single campaign by ID only
- Skip send window check (manual trigger = override)
- Still respect suppression, 24h rule, quota
- Return send results summary

---

#### 15. `deleteCampaign`

**Method:** POST
**Parameters:** `campaignId` (required)
**Wraps:** — (new CRUD helper)
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** Yes

**Response:**
```typescript
MarketingApiResponse<{ deleted: boolean; contactsRemoved: number }>
```

**Implementation notes:**
- Only allow deletion of Draft campaigns (Active/Paused must be Completed first)
- Delete campaign row from Campaigns tab
- Delete all associated Campaign Contacts rows
- Do NOT delete Campaign Log entries (audit trail)

---

#### 16. `createMarketingContact`

**Method:** POST
**Parameters:** `firstName` (required), `lastName` (required), `email` (required), `company`, `existingClient` (boolean), `campaignTag`, `notes`
**Wraps:** `addContactFromForm()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ contact: MarketingContact }>
```

**Implementation notes:**
- Call `addContactFromForm()` — already headless with dedup check
- Generate unsub token via `generateUnsubToken()`
- Return normalized contact object

---

#### 17. `importMarketingContacts`

**Method:** POST
**Parameters:** `contacts` (required — array of `{firstName, lastName, email, company, existingClient}`)
**Wraps:** Import logic from `importContacts()` adapted for API payload
**Type:** A (Engine Wrapper — adapted)
**Admin-only:** Yes
**Locking:** Yes (LockService — prevent concurrent imports)

**Response:**
```typescript
MarketingApiResponse<{
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  errors: string[];
}>
```

**Implementation notes:**
- NOT the same as `importContacts()` which reads from Architects/Mailing List sheets
- Accepts JSON array of contacts from React file upload / paste
- Dedup against existing contacts by email
- Generate unsub tokens for all new contacts
- Batch write via `setValues()` (not individual `appendRow`)

---

#### 18. `updateMarketingContact`

**Method:** POST
**Parameters:** `email` (required — lookup key), plus any fields from `MarketingContact` to patch
**Wraps:** — (new CRUD helper)
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ contact: MarketingContact }>
```

**Implementation notes:**
- Find contact row by email via `findContactRow_()`
- Patch only provided fields
- Do NOT allow changing email (it's the unique key)

---

#### 19. `suppressContact`

**Method:** POST
**Parameters:** `email` (required), `reason` (optional, default "Manual")
**Wraps:** `processUnsubscribes()` (for "Unsubscribed" reason) or manual suppression logic
**Type:** A (Engine Wrapper) / B (partial)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ contact: MarketingContact }>
```

**Implementation notes:**
- If reason is "Unsubscribed", call `processUnsubscribes(email, "Manual")`
- Otherwise, set Suppressed=true, Suppression Reason, Suppression Date on Contacts tab
- Also update all active Campaign Contacts rows for this email
- Append to Suppression Log

---

#### 20. `unsuppressContact`

**Method:** POST
**Parameters:** `email` (required), `releaseNote` (optional)
**Wraps:** — (new CRUD helper)
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ contact: MarketingContact }>
```

**Implementation notes:**
- Find contact row, clear: Suppressed=false, Suppression Reason="", Suppression Date=""
- Set Manual Release Note to provided note + date
- If bounced, also clear Bounced flag (allows retry after fixing email)
- Status back to original (Pending or Client based on Existing Client flag)

---

#### 21. `createMarketingTemplate`

**Method:** POST
**Parameters:** `name` (required), `subject` (required), `previewText`, `htmlBody` (required), `version`
**Wraps:** `addTemplateFromForm()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ template: MarketingTemplate }>
```

---

#### 22. `updateMarketingTemplate`

**Method:** POST
**Parameters:** `name` (required — lookup key), `subject`, `previewText`, `htmlBody`, `version`
**Wraps:** — (new CRUD helper)
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ template: MarketingTemplate }>
```

**Implementation notes:**
- Find template row by name in Templates tab
- Patch only provided fields
- Do NOT allow renaming (name is the key — create new + delete old instead)

---

#### 23. `updateMarketingSettings`

**Method:** POST
**Parameters:** Key-value pairs matching `MarketingSettings` fields
**Wraps:** — (new CRUD helper)
**Type:** B (CRUD Bridge)
**Admin-only:** Yes
**Locking:** Yes

**Response:**
```typescript
MarketingApiResponse<MarketingSettings>
```

**Implementation notes:**
- Read Settings tab, find matching Key rows, update Value cells
- Only update provided keys (patch semantics)
- Map camelCase params back to Settings tab Key names

---

### GMAIL Endpoints

---

#### 24. `sendTestEmail`

**Method:** POST
**Parameters:** `campaignId` (required), `step` (optional, default "Initial"), `recipientEmail` (optional — overrides campaign test recipient)
**Wraps:** `previewCampaignEmail()` core logic + `buildEmail()`
**Type:** B (CRUD Bridge — headless version needed)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{ sentTo: string; subject: string }>
```

**Implementation notes:**
- Extract logic from `previewCampaignEmail()` lines 1682-1761
- Remove all UI prompts
- Accept campaignId as parameter
- Find first non-suppressed contact for sample data (same as existing)
- Build email via `buildEmail()`, send to test recipient
- Prefix subject with `[TEST]`

---

#### 25. `previewTemplate`

**Method:** POST
**Parameters:** `templateName` (required), `campaignId` (optional — for custom tokens)
**Wraps:** `buildEmail()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** No

**Response:**
```typescript
MarketingApiResponse<{
  subject: string;
  htmlBody: string;
  previewText: string;
}>
```

**Implementation notes:**
- Load template by name
- Build email with sample contact data
- If campaignId provided, use that campaign's custom tokens
- Return rendered HTML — do NOT send email

---

#### 26. `checkMarketingInbox`

**Method:** POST
**Parameters:** none
**Wraps:** `checkInbox()`
**Type:** A (Engine Wrapper)
**Admin-only:** Yes
**Locking:** Yes (prevent concurrent inbox checks)

**Response:**
```typescript
MarketingApiResponse<{
  repliesFound: number;
  bouncesFound: number;
  unsubscribesFound: number;
}>
```

**Implementation notes:**
- Call `checkInbox()` — already has no UI dependencies
- Return summary counts (need to instrument the function to collect counts)
- Currently `checkInbox()` doesn't return anything — add counters

---

## StrideAPI.gs Integration Pattern

All marketing endpoints go in StrideAPI.gs's `doPost()` handler under a `marketing_` prefix pattern:

```javascript
// In doPost() switch:
case 'getMarketingDashboard':     return handleGetMarketingDashboard_(params, callerEmail);
case 'getMarketingCampaigns':     return handleGetMarketingCampaigns_(params, callerEmail);
// ... etc
```

**Campaign spreadsheet access pattern:**
```javascript
function getCampaignSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('CAMPAIGN_SHEET_ID');
  if (!id) throw new Error('CAMPAIGN_SHEET_ID not configured in Script Properties');
  return SpreadsheetApp.openById(id);
}
```

**Admin guard:** All marketing handlers wrapped with `withAdminGuard_(callerEmail)` — same pattern as Stax payments.

**Locking:** Endpoints marked with "Locking: Yes" use `LockService.getScriptLock()` with 10s timeout.

---

## Open Questions for Phase 2

1. **Campaign spreadsheet cross-project access:** StrideAPI.gs is a different Apps Script project than the campaign script. It can still open the spreadsheet by ID (same Google Workspace account), but cannot call campaign script functions directly. All logic must be reimplemented in StrideAPI.gs (reading the same spreadsheet).

2. **Gmail sending from StrideAPI.gs:** StrideAPI.gs runs as the API service account. The `from: SeattleReceiver@stridenw.com` alias must be configured on that account too, or sending must be delegated. Verify Gmail alias setup on the account running StrideAPI.gs.

3. **Import from source sheets:** The existing `importContacts()` reads from Architects and Mailing List spreadsheets. The API endpoint (`importMarketingContacts`) accepts JSON payloads instead. If Justin wants the original import-from-sheets functionality, add a separate `importFromSourceSheets` endpoint.

4. **Token reference:** The 18 merge tokens should be returned by `getMarketingTemplates` or a separate endpoint so the React template editor can show the reference sidebar.
