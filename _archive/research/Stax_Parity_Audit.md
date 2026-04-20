# Stax Auto-Pay Parity Audit

**Document Generated:** 2026-03-26
**Audit Scope:** Full Apps Script Analysis
**Target:** Real App Payments UI Parity Assessment

---

## A. Stax Parity Audit Summary

### Script Identity
- **Script Name:** Stax Auto-Pay Tool
- **Version:** Phase 4 v4.1.0
- **Total Lines:** 2,819
- **Language:** Google Apps Script (JavaScript)
- **Architecture:** Spreadsheet-centric; pure serverless; no backend/frontend separation

### Overall Architecture

The script is organized into four sequential phases:

1. **Phase 1 (IIF Import):** File picker → IIF parser → invoice & exception routing
2. **Phase 2 (Customer & Invoice Sync):** CB pull → Stax customer verification → invoice creation
3. **Phase 3 (Charge Execution):** Due-date charge runner (manual + daily trigger) → transaction logging
4. **Phase 4 (Exception Handling):** Exception review → pay link sending → manual resolution marking

The system is **entirely Google Sheets-driven**. All logic is embedded in the script; no separate backend exists. Configuration is stored in the Config tab; data flows through 7 spreadsheet tabs (Import, Invoices, Customers, Charge Log, Exceptions, Config, Run Log).

### External API Used: Stax/Fattmerchant

**Stax API Endpoints Called:**
- `GET /customer/{id}` — Verify customer existence & retrieve details (company name, email)
- `PUT /customer/{id}` — Update customer company name
- `GET /customer?email={email}` — Search customer by email (for sync)
- `GET /customer/{id}/payment-method` — List active payment methods
- `POST /invoice` — Create new invoice
- `GET /invoice?memo={key}` — Duplicate check by memo
- `GET /invoice/{id}` — Pre-charge validation (fetch invoice status)
- `PUT /invoice/{id}/pay` — Execute charge against invoice
- `PUT /invoice/{id}/send/email` — Send pay link email to customer

**Base URL:** `https://apiprod.fattlabs.com` (same for both sandbox and production; API key differentiates environment)

**Rate Limiting:** Script implements client-side throttle (88 req/60s) to stay under Stax's 90 req/min limit.

**Retry Logic:** Exponential backoff (2s, 4s, 8s) for retryable status codes: 429, 500, 502, 503, 504.

### Google APIs Used

1. **Google Drive API:**
   - `DriveApp.getFolderById()` — Locate IIF import folder
   - `DriveApp.searchFiles()` — List IIF/TXT files
   - `DriveApp.getFileById()` — Download IIF file for import
   - `Picker API` (requires client-side setup with Google Picker API key)

2. **Google Sheets API (via SpreadsheetApp):**
   - `getActiveSpreadsheet()` — Access current spreadsheet
   - `getSheetByName()` — Navigation between tabs
   - `getDataRange()` → `getValues()` / `setValues()` — Batch read/write
   - `getRange()` → `setValue()` / `setFontWeight()` — Cell operations
   - `insertSheet()` / `clearContents()` — Sheet management

3. **Google Apps Script Services:**
   - `SpreadsheetApp.getUi()` — UI alerts, prompts, modal dialogs
   - `HtmlService.createHtmlOutput()` — Custom file picker dialog (HTML/JS)
   - `LockService.getScriptLock()` — Concurrency control (5s timeout)
   - `ScriptApp.newTrigger()` → `timeBased()` → `everyDays(1)` → `atHour(8)` — Daily trigger setup
   - `ScriptApp.getProjectTriggers()` / `deleteTrigger()` — Trigger management
   - `UrlFetchApp.fetch()` — HTTP requests to Stax API
   - `Utilities.formatDate()` — Timezone-aware formatting
   - `Session.getScriptTimeZone()` — Get script's configured timezone

### Dependencies on Other Stride Scripts

**Hard Dependency:**
- **Consolidated Billing (CB) Spreadsheet** (via `CB_SPREADSHEET_ID` config)
  - Used by `pullStaxCustomers()` to read active clients from the "Clients" tab
  - Expected columns: CLIENT NAME, QB_CUSTOMER_NAME, STAX CUSTOMER ID, ACTIVE, CLIENT EMAIL, PAYMENT TERMS
  - Not required for manual operation (can sync without CB), but required for `Pull Customers (CB + Stax)` menu item
  - Precedence: CB Stax IDs override local customer mappings in `_lookupStaxCustomerIds()`

**No dependency on other Stride scripts** beyond CB (if configured).

---

## B. Full List of Payment Workflows

### 1. IIF Import Flow

**Trigger:** Menu → "Import IIF File"

**Steps:**
1. Display HTML file picker dialog
2. List `.iif` and `.txt` files from configured Google Drive folder (or root if not set)
3. User selects file; prompt confirmation
4. Download file via Drive API (UTF-8 encoded)
5. Parse IIF format:
   - Split by lines; skip header rows (prefixed with `!`)
   - Identify column positions from `!TRNS` and `!SPL` headers (or use fallback positional parsing)
   - Build transaction objects (TRNS) with nested line items (SPL)
   - Filter to INVOICE type only; reject transactions without invoice number (logged as exception)
6. Write to Import tab (rows 5+) and Invoices tab (rows 2+)
7. Auto-lookup Stax Customer IDs from local Customers tab or CB Clients tab
8. Deduplicate by key: `docNum|normalized_name|amount|date`
9. Return success message with counts

**Side Effects:**
- Import tab rows 5+ are cleared and rewritten
- Invoices tab: new rows appended (status = PENDING, Created At = now)
- Exceptions tab: rows appended for blank invoice # records
- Run Log: entry written

**Idempotency Protection:**
- Duplicate detection key prevents re-importing the same invoice twice
- Only new invoices are appended (no update to existing rows)

**Failure Mode:**
- File too large, decode errors, malformed IIF → return error message to user
- Missing sheets → preflight check blocks execution

---

### 2. Customer Sync Flow (CB → Stax)

**Trigger:** Menu → "Pull Customers (CB + Stax)"

**Steps:**
1. Preflight: verify API key, environment, sheets
2. Lock for concurrency
3. Clear Customers tab rows 2+ (full refresh each time)
4. Read active clients from CB Clients tab:
   - Filter by ACTIVE column = TRUE or YES
   - Extract: QB_CUSTOMER_NAME, STAX CUSTOMER ID, email, payment terms
5. For each client with Stax ID:
   - Call `GET /customer/{id}` to verify ID is valid in Stax
   - Extract: company_name, email, firstname, lastname
   - Log API errors or 404 (NOT_FOUND) as exception
6. For each client without Stax ID:
   - Mark as "⚠ MISSING — Add Stax ID to CB Clients tab"
   - Log as exception
7. Write all rows to Customers tab (7 columns)
8. Log summary and stats to Run Log

**Subsequent Manual Action:** User manually adds missing Stax IDs to CB, then re-runs this flow.

**Side Effects:**
- Customers tab completely rewritten (rows 2+)
- Exceptions tab: rows appended for API errors, 404s, missing IDs
- Run Log: entry written with stats

**Idempotency Protection:**
- Full-refresh logic (clear then rewrite); safe to rerun
- API calls are read-only (GET)

---

### 3. Customer Sync with Stax (Stax Verification)

**Trigger:** Menu → "Sync Customers with Stax"

**Steps:**
1. Preflight: verify API key, environment, sheets
2. Lock for concurrency
3. Read Customers tab (rows 2+)
4. For each row:

   **Branch A: Has Stax ID**
   - Call `GET /customer/{id}` to verify
   - If 404 → log exception (NOT_FOUND), skip
   - If API error → log exception, skip
   - If success:
     - Push local company name to Stax (if local has value and Stax is empty)
     - Call `GET /customer/{id}/payment-method` to check payment methods
     - Extract payment method label (CC, Debit, ACH, None) and update Payment Method column
     - Increment "verified" and "hasPayment" / "noPayment" counters

   **Branch B: No Stax ID, has email**
   - Call `GET /customer?email={email}` to search
   - If 0 matches → log exception (NOT_FOUND), skip
   - If 1 exact match → auto-fill Stax Customer ID, increment "foundByEmail"
   - If 2+ matches → log exception (AMBIGUOUS_MATCH with IDs), skip

   **Branch C: No ID, no email**
   - Log exception (NO_IDENTIFIER), skip

5. Batch write updated Stax IDs and Payment Methods to columns D and F
6. Log summary to Run Log

**Side Effects:**
- Customers tab columns D (Stax ID) and F (Payment Method) updated
- Exceptions tab: rows appended for failures, ambiguous matches, missing identifiers
- Run Log: entry written with stats

**Idempotency Protection:**
- API calls are read-only (except PUT to update company name)
- Duplicate ID updates are safe (idempotent)
- Company name push only updates empty fields (no overwrite)

---

### 4. Auto-Populate Customers (from Invoices)

**Trigger:** Manual call (not in main menu; used by import flow)

**Steps:**
1. Read unique QB Customer Names from Invoices tab (column B)
2. Compare against existing names in Customers tab (normalized)
3. Add only new names (7 empty columns per row)
4. Return count of new names added

**Side Effects:**
- Customers tab: new rows appended
- No Stax ID or email filled in (user must complete manually)

**Idempotency Protection:**
- Normalized name deduplication (case-insensitive, whitespace-trimmed)
- Safe to rerun

---

### 5. Invoice Creation Flow (IIF Data → Stax Invoices)

**Trigger:** Menu → "Create Stax Invoices"

**Steps:**
1. Preflight: verify API key, environment, sheets
2. Lock for concurrency
3. Auto-lookup Stax Customer IDs (fill in blank IDs from Customers tab)
4. Read Invoices tab (rows 2+)
5. For each row with status = PENDING and no Stax Invoice ID:

   a. **Validation:**
      - Must have Stax Customer ID; skip if missing → exception logged
      - Total must be > 0; skip if invalid → exception logged

   b. **Build Payload:**
      - Line items: parse JSON from column G (Line Items JSON)
      - Skip "Accounts Receivable" lines
      - Fallback: single line item with total if JSON is invalid/empty
      - Due date: parse from column E; fallback to invoice date + 30 days
      - Memo: "QB #<docnum> - <name>"
      - Reference key: "QB#<docnum>|<normalized_name>|<total>|<date>" (for dedup)
      - Meta object: { subtotal, tax, memo, reference, lineItems }

   c. **Duplicate Check:**
      - Call `GET /invoice?memo={reference}` to search existing invoices
      - If found with matching meta.reference → link it, mark CREATED, skip creation
      - Otherwise → proceed with creation

   d. **Create Invoice:**
      - Call `POST /invoice` with payload
      - If success → extract invoice ID, mark status CREATED
      - If failure → mark status EXCEPTION, log exception

6. Batch write updates to columns H (Stax Invoice ID), I (Status), K (Notes)
7. Log summary to Run Log

**Duplicate Prevention:** Best-effort via memo search + reference check in meta. Not guaranteed idempotent (if Stax API doesn't support memo filtering, we proceed with creation anyway).

**Side Effects:**
- Invoices tab columns H, I, K updated
- Stax: new invoices created in Stax (POST /invoice)
- Exceptions tab: rows appended for missing customer, invalid total, API errors
- Run Log: entry written with stats

**Idempotency Protection:**
- Status gate (PENDING only)
- Stax Invoice ID gate (only creates if blank)
- Duplicate check (best-effort)

---

### 6. Charge Execution Flow (Due Date Charges)

**Trigger:**
- Manual: Menu → "Run Charges Now"
- Automatic: Daily trigger at 8 AM (if AUTO_CHARGE_ENABLED = TRUE)

**Steps:**
1. Preflight: verify API key, environment, sheets (auto mode checks AUTO_CHARGE_ENABLED)
2. Lock for concurrency
3. Determine "today" in script timezone
4. Read Invoices tab (rows 2+)
5. For each row with status = CREATED, Stax Invoice ID, Stax Customer ID:

   a. **Due Date Gate:** Skip if due date is in the future

   b. **Pre-Charge Validation (SAFEGUARD 1):**
      - Call `GET /invoice/{id}` to check current status in Stax
      - If already PAID in Stax → update local status to PAID, log result, skip
      - If balance_due ≤ 0 → mark PAID, skip
      - If API error → mark CHARGE_FAILED, log exception, skip

   c. **Payment Method (SAFEGUARD 2):**
      - Cache per customer to avoid redundant API calls
      - Call `GET /customer/{id}/payment-method` (cached)
      - Prefer is_default = true; fallback to first active method
      - Skip deleted/purged methods
      - If no active methods → mark CHARGE_FAILED, log exception, skip

   d. **Double-Charge Protection (SAFEGUARD 3):**
      - Write "CHARGE_ATTEMPT|<timestamp>" to Notes column immediately (flush to sheet)
      - This marker prevents re-processing if script is interrupted mid-charge

   e. **Execute Charge:**
      - Call `PUT /invoice/{id}/pay` with payment_method_id and email_receipt: '1'
      - If success:
        - Check balance_due in response
        - If balance_due = 0 and status = PAID → mark PAID, log success
        - If balance_due > 0 → partial payment, mark CHARGE_FAILED, log exception
      - If failure:
        - Detect decline (422/400 + keywords like "decline", "insufficient", "expired", "do not honor")
        - Mark CHARGE_FAILED, log with status (DECLINED vs API_ERROR)

6. Batch write updates to columns I (Status) and K (Notes)
7. Log summary to Run Log

**Status Transitions:**
- CREATED → PAID (success or already paid)
- CREATED → CHARGE_FAILED (no payment method, declined, API error, partial payment)
- CREATED → CHARGE_FAILED (pre-charge check failed)

**Side Effects:**
- Invoices tab columns I (Status), K (Notes) updated
- Stax: payment transaction created (PUT /invoice/{id}/pay)
- Stax: email receipt sent to customer (email_receipt: '1')
- Charge Log tab: row appended with result (timestamp, docnum, Stax IDs, amount, status, txn ID, notes)
- Exceptions tab: rows appended for failures (no payment method, declined, partial, API error)
- Run Log: entry written with stats

**Idempotency Protection:**
- Status gate (CREATED only)
- Pre-charge invoice status check (re-checks Stax to detect already-paid)
- CHARGE_ATTEMPT marker prevents duplicate charges if script is interrupted
- Duplicate charge within same run prevented by status write-back

---

### 7. Exception Handling Flow

**Trigger:** Menu → "Review Exceptions" (shows summary only, no action)

**Steps:**
1. Read Exceptions tab (rows 2+)
2. Count unresolved exceptions (column I / Resolved is blank) by reason category:
   - NO_PAYMENT_METHOD
   - DECLINED
   - API_ERROR
   - PARTIAL (payment)
   - BLANK QB INVOICE
   - Other
3. Also count CHARGE_FAILED invoices in Invoices tab with Stax Invoice ID (eligible for pay link)
4. Display summary dialog with counts and recommendation to send pay links

**Side Effects:**
- None (read-only)

---

### 8. Pay Link Sending Flow

**Trigger A - Bulk:** Menu → "Send Pay Links (Failed Charges)"

**Steps:**
1. Preflight: verify API key, environment, sheets
2. Lock for concurrency
3. Read Invoices tab; find all rows with status = CHARGE_FAILED and Stax Invoice ID
4. Show confirmation dialog with count
5. For each eligible invoice:
   - Call `PUT /invoice/{id}/send/email` to send Stax email with pay link
   - If success → mark status SENT, write "Pay link emailed <timestamp>" to Notes
   - If failure → write error to Notes, log exception
6. Batch write updates
7. Log summary to Run Log

**Trigger B - Single:** Menu → "Send Pay Link (Single Invoice)"

**Steps:**
1. Prompt user for QB Invoice #
2. Try to auto-detect from active cell if on Invoices or Exceptions tab
3. Find invoice row in Invoices tab by QB Invoice #
4. Validate: must have Stax Invoice ID
5. Show confirmation dialog with customer name and Stax ID
6. Call `PUT /invoice/{id}/send/email`
7. If success → mark status SENT, write timestamp to Notes
8. If failure → show error dialog, log exception
9. Log summary to Run Log

**Side Effects:**
- Invoices tab column I (Status) and K (Notes) updated
- Stax: email sent to customer (via Stax SMTP)
- Exceptions tab: rows appended for send failures
- Run Log: entry written

**Idempotency Protection:**
- Status gate (CHARGE_FAILED only for bulk; any status for single)
- Safe to resend pay links (Stax handles duplicate emails)

---

### 9. Exception Resolution Flow

**Trigger:** Menu → "Mark Exception Resolved"

**Steps:**
1. Validate user is on Exceptions tab and has selected a data row
2. Read current Resolved column (I); skip if already resolved
3. Show confirmation dialog with invoice #, customer, and reason
4. Write current timestamp to Resolved column
5. Update UI

**Side Effects:**
- Exceptions tab column I (Resolved) updated

**Idempotency Protection:**
- Check if already resolved; block if true

---

### 10. Trigger Management Flow

**Trigger A - Enable:** Menu → "Enable Daily Auto-Charge"

**Steps:**
1. Check for existing runChargesAuto trigger
2. If exists → alert user to disable first, exit
3. Create new trigger via ScriptApp.newTrigger()
4. Configure: timeBased() → everyDays(1) → atHour(8)
5. Log to Run Log

**Side Effects:**
- ScriptApp: trigger created

**Trigger B - Disable:** Menu → "Disable Daily Auto-Charge"

**Steps:**
1. Iterate through all project triggers
2. Find any with handler function = "runChargesAuto"
3. Delete each via ScriptApp.deleteTrigger()
4. Log to Run Log

**Side Effects:**
- ScriptApp: trigger(s) deleted

---

## C. All Triggers / Menu Actions / Setup Functions / Settings Keys

### Menu Actions (onOpen)

| Menu Item | Function Called | Purpose |
|-----------|-----------------|---------|
| Setup Sheets | `setupSheets()` | Create/repair all required sheets and config |
| Import IIF File | `showFilePicker()` | Open file picker dialog to import QB IIF |
| Pull Customers (CB + Stax) | `pullStaxCustomers()` | Read active clients from CB; enrich with Stax data |
| Sync Customers with Stax | `syncCustomers()` | Verify Stax IDs, search by email, check payment methods |
| Create Stax Invoices | `createStaxInvoices()` | Convert PENDING invoices to Stax invoices |
| Run Charges Now | `runCharges()` | Manual charge runner; shows UI alert with results |
| Review Exceptions | `reviewExceptions()` | Display summary of unresolved exceptions |
| Send Pay Links (Failed Charges) | `sendPayLinks()` | Bulk email pay links for CHARGE_FAILED invoices |
| Send Pay Link (Single Invoice) | `sendSinglePayLink()` | Email pay link for one invoice by QB # |
| Mark Exception Resolved | `markExceptionResolved()` | Write timestamp to Resolved column |
| Enable Daily Auto-Charge | `setupDailyTrigger()` | Create daily time-driven trigger at 8 AM |
| Disable Daily Auto-Charge | `removeDailyTrigger()` | Remove the daily trigger |
| Validate Sheets | `validateSheetsUI()` | Check all sheets have correct headers |
| Reset Operational Sheets... | `resetOperationalSheets()` | Destructive: clear Import, Invoices, Charge Log, Exceptions, Run Log (with confirmation) |

### Triggers

| Trigger Type | Handler Function | Schedule | Enabled By |
|--------------|-----------------|----------|-----------|
| Time-driven | `runChargesAuto()` | Daily, 8 AM script timezone | Menu: "Enable Daily Auto-Charge" |
| onOpen | `onOpen()` | Page load (implicit) | Built-in |

### Setup Functions

| Function | Purpose | Idempotent? |
|----------|---------|-------------|
| `setupSheets()` | Create missing sheets; repair headers on empty sheets; never wipe data | Yes |
| `resetOperationalSheets()` | Destructive: clear all operational sheets except Config/Customers (requires YES confirmation) | N/A (destructive) |
| `_ensureSheetSafe()` | Internal: create or repair sheet headers without deleting data | Yes |
| `_ensureSheet()` | Internal: create or clear sheet and write rows (used only by reset) | N/A (clears) |

### Settings Keys (Config Tab)

| Key | Default | Purpose | Type |
|-----|---------|---------|------|
| STAX_API_KEY | (empty) | Bearer token for Stax API requests | String (required) |
| STAX_INVOICE_PAY_URL | https://app.staxpayments.com/#/bill/ | Base URL for pay link construction | String |
| GOOGLE_PICKER_API_KEY | (empty) | Browser API key for Google Picker (file picker dialog) | String |
| CB_SPREADSHEET_ID | (empty) | Google Sheets ID of Consolidated Billing sheet | String (optional) |
| AUTO_CHARGE_ENABLED | TRUE | Gate for daily auto-charge trigger | Boolean (TRUE/FALSE) |
| NOTIFY_ON_EXCEPTION | TRUE | (Defined but not used in current code) | Boolean |
| ENVIRONMENT | sandbox | Stax environment: sandbox or production | String (required) |
| IIF_FOLDER_ID | (empty) | Google Drive folder ID for IIF file search | String (optional) |

---

## D. All Side Effects and Idempotency Protections

### IIF Import Flow

**Rows Created/Updated:**
- Import tab: rows 5+ (display only, cleared before write)
- Invoices tab: rows 2+ appended (new invoices only)
- Exceptions tab: rows appended (blank invoice # records)
- Run Log: row appended

**External API Calls:**
- None (read-only Google Drive)

**Emails Sent:**
- None

**Prevents Duplicate Execution:**
- Dedup key: `docNum|normalized_name|amount|date`
- LockService (5s timeout): prevents concurrent imports

**LockService Usage:**
- `LockService.getScriptLock().tryLock(5000)` before parsing

**Status Markers:**
- Invoices tab: "PENDING" status (set on import)
- Exceptions tab: empty Resolved field indicates unresolved

---

### Customer Sync (CB → Stax)

**Rows Created/Updated:**
- Customers tab: rows 2+ (full refresh, cleared before write)
- Exceptions tab: rows appended

**External API Calls:**
- `GET /customer/{id}` — per client with Stax ID
- No write-side effects

**Emails Sent:**
- None

**Prevents Duplicate Execution:**
- Full-refresh logic (clear then rewrite); safe to rerun
- LockService (5s timeout)

**LockService Usage:**
- `LockService.getScriptLock().tryLock(5000)` before sync

**Status Markers:**
- Customers tab: "⚠ MISSING" marker if no Stax ID
- Exceptions tab: reason strings (NOT_FOUND, API_ERROR, etc.)

---

### Customer Sync with Stax

**Rows Created/Updated:**
- Customers tab: columns D (Stax Customer ID), F (Payment Method) updated
- Exceptions tab: rows appended

**External API Calls:**
- `GET /customer/{id}` — per row with Stax ID
- `GET /customer?email={email}` — per row with email but no ID
- `GET /customer/{id}/payment-method` — per verified customer
- `PUT /customer/{id}` — company name push (if local has value, Stax is empty)
- All calls are safe to retry (idempotent)

**Emails Sent:**
- None

**Prevents Duplicate Execution:**
- All API calls are read-only or safe (company name update is idempotent)
- LockService (5s timeout)

**LockService Usage:**
- `LockService.getScriptLock().tryLock(5000)` before sync

**Status Markers:**
- Exceptions tab: reason strings (NOT_FOUND, AMBIGUOUS_MATCH, NO_IDENTIFIER, API_ERROR)

---

### Invoice Creation Flow

**Rows Created/Updated:**
- Invoices tab: columns H (Stax Invoice ID), I (Status), K (Notes) updated
- Exceptions tab: rows appended

**External API Calls:**
- `GET /invoice?memo={reference}` — duplicate check (best-effort)
- `POST /invoice` — create invoice (creates row in Stax)
- Calls are not fully idempotent (if duplicate check fails, same invoice may be created twice)

**Emails Sent:**
- None (invoice created but not sent to customer yet)

**Prevents Duplicate Execution:**
- Status gate: only PENDING invoices are processed
- Stax Invoice ID gate: only processes rows with blank ID
- Best-effort duplicate check via memo
- LockService (5s timeout)
- Invoice status "EXCEPTION" marks failed creations (no retry)

**LockService Usage:**
- `LockService.getScriptLock().tryLock(5000)` before creation

**Status Markers:**
- Invoices tab: "CREATED" status on success, "EXCEPTION" on failure, "PENDING" on unchanged
- Exceptions tab: reason includes "NO_CUSTOMER", "INVALID_PAYLOAD", "API_ERROR"

---

### Charge Execution Flow

**Rows Created/Updated:**
- Invoices tab: columns I (Status), K (Notes) updated
- Charge Log tab: rows appended (1 row per eligible invoice processed)
- Exceptions tab: rows appended (on failures)

**External API Calls:**
- `GET /invoice/{id}` — pre-charge validation (read-only)
- `GET /customer/{id}/payment-method` — fetch default method (read-only, cached per customer)
- `PUT /invoice/{id}/pay` — execute charge (creates Stax transaction)
- Stax auto-sends email receipt to customer (email_receipt: '1' in payload)
- Calls are mostly safe; payment charge is not idempotent (same charge may be executed twice if run twice)

**Emails Sent:**
- Yes: Stax sends email receipt to customer when charge succeeds (from Stax SMTP)

**Prevents Duplicate Execution:**
- Status gate: only CREATED invoices are processed
- Due date gate: only invoices with due date on or before today
- Pre-charge status check: detects if already PAID in Stax, marks local as PAID
- Balance check: if balance_due ≤ 0, marks as PAID
- CHARGE_ATTEMPT marker: writes timestamp to Notes before calling pay (safeguard against interrupt)
- LockService (5s timeout)

**LockService Usage:**
- `LockService.getScriptLock().tryLock(5000)` before charge run
- Marker flush: `colKRange.setValues(colKValues)` immediately after writing CHARGE_ATTEMPT (safeguard)

**Status Markers:**
- Invoices tab: "PAID" (success or already paid), "CHARGE_FAILED" (any failure)
- Invoices tab: "CHARGE_ATTEMPT|<timestamp>" in Notes during charge (transient marker)
- Charge Log: status = "SUCCESS", "DECLINED", "API_ERROR", "NO_PAYMENT_METHOD", "ALREADY_PAID", "PARTIAL"
- Exceptions tab: reason includes "NO_PAYMENT_METHOD", "DECLINED", "PARTIAL", "API_ERROR"

---

### Pay Link Sending Flow

**Rows Created/Updated:**
- Invoices tab: column I (Status) updated to "SENT", column K (Notes) updated
- Exceptions tab: rows appended (on send failures)

**External API Calls:**
- `PUT /invoice/{id}/send/email` — send invoice email with pay link
- Stax composes and sends email via Stax SMTP
- Calls are safe to retry (idempotent; resending same email is acceptable)

**Emails Sent:**
- Yes: Stax sends invoice email with pay link to customer

**Prevents Duplicate Execution:**
- Status gate: only CHARGE_FAILED invoices for bulk send
- No explicit idempotency lock for sending (resending is acceptable)
- LockService (5s timeout) in bulk send

**LockService Usage:**
- `LockService.getScriptLock().tryLock(5000)` before bulk send (not for single)

**Status Markers:**
- Invoices tab: "SENT" status on success, "CHARGE_FAILED" unchanged on failure
- Exceptions tab: reason = "SEND_FAILED"

---

### Exception Resolution Flow

**Rows Created/Updated:**
- Exceptions tab: column I (Resolved) updated with timestamp

**External API Calls:**
- None

**Emails Sent:**
- None

**Prevents Duplicate Execution:**
- Check if already resolved; block if true
- No lock (single-row write)

**Status Markers:**
- Exceptions tab: Resolved column populated with timestamp

---

### Trigger Management Flow

**Rows Created/Updated:**
- Run Log: row appended

**External API Calls:**
- None

**Emails Sent:**
- None

**Prevents Duplicate Execution:**
- Enable: checks for existing trigger before creating
- Disable: iterates and removes all matching triggers (safe)

**Status Markers:**
- ScriptApp: trigger created/deleted

---

## E. Gaps Between Current Payments UI and Real Apps Script Behavior

### Features in the Real Script NOT Represented in the React Payments UI

1. **IIF File Import**
   - Full QB IIF parsing pipeline (TRNS/SPL parsing, line item extraction, deduplication)
   - Google Drive file picker with folder navigation
   - Automated exception routing for blank invoice numbers
   - Custom line item JSON format support
   - Not in Payments UI at all

2. **Consolidated Billing Integration**
   - `pullStaxCustomers()` reads active clients from separate CB spreadsheet
   - Auto-enriches with Stax company names and emails
   - Cascades Stax IDs from CB to local Customers tab
   - Not represented in Payments UI

3. **Multi-Layer Customer Sync**
   - Customer lookup by email with ambiguity detection
   - Company name push-back to Stax (if local has value, Stax is empty)
   - Payment method categorization (CC, Debit, ACH, None) with filtering of deleted/purged methods
   - Auto-population from Invoices tab
   - Not represented in Payments UI

4. **Pre-Charge Validation**
   - Real-time invoice status check before charging (detects already-paid)
   - Balance check (balance_due ≤ 0)
   - Payment method caching per customer
   - Not visible in Payments UI

5. **Double-Charge Safeguard**
   - CHARGE_ATTEMPT marker written to Notes before pay call (prevents interrupt-induced duplicates)
   - Not visible in Payments UI

6. **Duplicate Invoice Detection**
   - Best-effort memo search to link duplicate invoices before creation
   - Not visible in Payments UI

7. **Exception Tracking**
   - Dedicated Exceptions tab with structured logging (timestamp, reason category, resolved flag)
   - Exception summary review (reviewExceptions() shows counts by reason)
   - Manual resolution marking
   - Not in Payments UI

8. **Charge Log**
   - Separate log tab for all charge attempts (success, declined, error, already-paid, partial)
   - Stores transaction ID and notes for audit trail
   - Not in Payments UI

9. **Run Log**
   - Every operation (import, sync, create invoices, charge run, etc.) logged with function name, summary, and JSON stats
   - Not in Payments UI

10. **Trigger Management**
    - Daily auto-charge at 8 AM with enable/disable menu items
    - Automatic gate based on AUTO_CHARGE_ENABLED config
    - Not in Payments UI

11. **Timezone Handling**
    - Script uses Session.getScriptTimeZone() for all date formatting and due date comparison
    - Not visible in Payments UI

12. **Rate Limiting & Retry**
    - Client-side throttle (88 req/60s) to stay under Stax's 90 req/min
    - Exponential backoff (2s, 4s, 8s) for retryable errors
    - Not visible in Payments UI

13. **Line Item Parsing**
    - Custom JSON format: `{ invItem, memo, accnt, qty, price, amount }`
    - AR account filtering (skip Accounts Receivable lines)
    - Price fallback (if price missing, calculate from amount/qty)
    - Not in Payments UI

14. **Date Parsing**
    - Robust multi-format date parser (MM/DD/YYYY, YYYY-MM-DD, generic Date parse with timezone safeguard)
    - Due date fallback (invoice date + 30 days)
    - Not in Payments UI

---

### UI Features that DON'T Match Real Script Behavior

**None identified.** The Payments UI in the React app appears to be a simplified, read-only dashboard that doesn't yet surface the full complexity of the script.

---

### Missing Validation/Guardrail Logic NOT in Payments UI

1. **Total Amount Validation**
   - Script checks total > 0 before creating invoice; rejects zero/negative amounts
   - Not validated in Payments UI

2. **Customer ID Requirement**
   - Script requires Stax Customer ID to create invoice; auto-lookup from Customers tab
   - Not enforced in Payments UI

3. **Line Item Deduplication**
   - Script skips zero-value line items and AR accounts
   - Not enforced in Payments UI

4. **Payment Method Filtering**
   - Script filters out deleted/purged methods, prefers is_default = true
   - Not enforced in Payments UI

5. **Email Requirement for Customer Search**
   - Script rejects ambiguous email matches (2+ customers with same email)
   - Not enforced in Payments UI

6. **Due Date Gating**
   - Script only charges invoices with due date on or before today
   - Not enforced in Payments UI

7. **Status Gating**
   - Script gates on specific statuses (PENDING for creation, CREATED for charging, CHARGE_FAILED for pay link)
   - Not visible in Payments UI

8. **Concurrency Control**
   - Script uses LockService to prevent concurrent operations
   - Not visible in Payments UI

---

### Missing Settings/Config NOT in Payments UI

1. **CB_SPREADSHEET_ID**
   - Required to pull customers from Consolidated Billing
   - Not configurable in Payments UI

2. **IIF_FOLDER_ID**
   - Google Drive folder for IIF imports
   - Not configurable in Payments UI

3. **AUTO_CHARGE_ENABLED**
   - Gate for daily auto-charge trigger
   - Not configurable in Payments UI (enable/disable trigger via menu instead)

4. **NOTIFY_ON_EXCEPTION**
   - Defined but not used in current code
   - Not configurable in Payments UI

5. **GOOGLE_PICKER_API_KEY**
   - Required for file picker dialog
   - Not configurable in Payments UI (not needed if moving to pure app)

6. **STAX_INVOICE_PAY_URL**
   - Configurable base URL for pay link construction
   - Not configurable in Payments UI

7. **ENVIRONMENT**
   - Sandbox vs production switch
   - Not visible in Payments UI

---

## F. Recommendation: Spreadsheet-Only vs App

### Summary Table

| Function | Recommendation | Reason |
|----------|-----------------|--------|
| **Setup Sheets** | Keep spreadsheet-only | One-time setup; no recurring UI needed |
| **Import IIF File** | Move to app (expose via API) | Core workflow; needs file picker; should be in app workflow |
| **Pull Customers (CB + Stax)** | Phase 2 (defer) | Dependency on separate CB sheet complicates app parity; consider adding direct Stax customer search first |
| **Sync Customers with Stax** | Move to app (expose via API) | Core workflow; recurring; high value; app should own customer sync |
| **Create Stax Invoices** | Move to app (expose via API) | Core workflow; recurring; central to payment automation; app should own invoice creation |
| **Run Charges Now** (Manual) | Move to app (expose via API) | Manual trigger; user-facing; app should expose as button in dashboard |
| **Run Charges Auto** (Daily Trigger) | Needs redesign for app | Trigger is serverless only; app needs backend job runner or webhook to call API; consider Stax webhooks instead |
| **Review Exceptions** | Move to app (expose via API) | Dashboard feature; app can fetch and display exception summary |
| **Send Pay Links (Bulk)** | Move to app (expose via API) | Manual workflow; user-facing; app should expose as button for failed invoices |
| **Send Pay Link (Single)** | Move to app (expose via API) | Manual workflow; user-facing; app should expose from invoice detail view |
| **Mark Exception Resolved** | Move to app (expose via API) | Manual workflow; user-facing; app should expose from exception detail view |
| **Enable Daily Auto-Charge** | Needs redesign for app | Trigger configuration; replace with backend job runner config in app |
| **Disable Daily Auto-Charge** | Needs redesign for app | Trigger configuration; replace with backend job runner config in app |
| **Validate Sheets** | Keep spreadsheet-only | Debugging tool; not needed in app |
| **Reset Operational Sheets** | Keep spreadsheet-only | Destructive tool; not needed in app (data cleared by archive, not reset) |

---

### Detailed Recommendations by Workflow

#### Phase 1: Core Workflows (Move to App ASAP)

##### 1. Sync Customers with Stax → `POST /api/payments/customers/sync`

**Recommendation:** Move to app

**Why:**
- Highest-value workflow; users care about customer sync
- Recurring operation
- No external dependencies (except Stax API)
- Can be exposed as button in Customers section of app

**Implementation:**
- Backend: Call `syncCustomers()` logic (or rewrite in backend lang)
- Frontend: Button "Sync with Stax" in Customers section
- UI: Show summary (verified count, payment methods checked, email matches, errors)

**Data Sync:**
- App reads from app's customer database (not spreadsheet)
- Writes synced payment method status and verified flag back to app database
- Spreadsheet becomes read-only archive (or deprecated entirely)

---

##### 2. Create Stax Invoices → `POST /api/payments/invoices/create`

**Recommendation:** Move to app

**Why:**
- Core payment automation workflow
- Recurring operation
- No external dependencies (except Stax API)
- Can be exposed as button in Invoices section

**Implementation:**
- Backend: Call `createStaxInvoices()` logic
- Frontend: Button "Create in Stax" in Invoices section
- UI: Show summary (created count, duplicates linked, missing customer errors, API errors)

**Data Sync:**
- App reads from app's invoice database (not spreadsheet)
- Writes Stax Invoice ID and status back to app database
- Spreadsheet becomes read-only archive

---

##### 3. Run Charges Now → `POST /api/payments/invoices/charge`

**Recommendation:** Move to app (manual button)

**Why:**
- User-visible action
- Recurring operation (daily + manual)
- Can be exposed as button in dashboard or per-invoice

**Implementation:**
- Backend: Call `_executeChargeRun()` logic
- Frontend: Button "Run Charges" in dashboard OR per-invoice "Charge Now" button
- UI: Show summary (paid count, declined, no payment method, already paid, partial, API errors)

**Manual Trigger:**
- App exposes button in dashboard
- User clicks to trigger immediate charge run
- Backend executes charge run and returns summary

---

##### 4. Send Pay Links (Bulk) → `POST /api/payments/invoices/send-pay-links`

**Recommendation:** Move to app

**Why:**
- User-visible action
- Recurring operation (bulk send for failed charges)
- Can be exposed as button in dashboard or exception view

**Implementation:**
- Backend: Call `sendPayLinks()` logic
- Frontend: Button "Send Pay Links" next to failed invoices list
- UI: Show confirmation and results (sent count, failed count)

---

##### 5. Send Pay Link (Single) → `POST /api/payments/invoices/{id}/send-pay-link`

**Recommendation:** Move to app

**Why:**
- User-visible action
- Per-invoice action
- Can be exposed from invoice detail view

**Implementation:**
- Backend: Call `_sendInvoiceEmail()` logic
- Frontend: Button "Send Pay Link" in invoice detail
- UI: Show confirmation and result (success or error)

---

#### Phase 2: Supporting Workflows (Move to App, Redesign As Needed)

##### 6. Review Exceptions → `GET /api/payments/exceptions/summary`

**Recommendation:** Move to app

**Why:**
- Dashboard feature
- Read-only; no API calls needed
- App can fetch and display in real-time

**Implementation:**
- Backend: Return exception summary (counts by reason, unresolved vs resolved)
- Frontend: Display in dashboard or dedicated Exceptions section
- UI: Show counts and list of exceptions with actions (send pay link, mark resolved)

---

##### 7. Mark Exception Resolved → `PUT /api/payments/exceptions/{id}/resolve`

**Recommendation:** Move to app

**Why:**
- User-visible action
- Per-exception action
- Can be exposed from exception detail view

**Implementation:**
- Backend: Update exception resolved flag and timestamp
- Frontend: Button "Resolve" in exception detail
- UI: Confirmation and success message

---

#### Phase 3: Integration Workflows (Redesign for App)

##### 8. Import IIF File → `POST /api/payments/invoices/import`

**Recommendation:** Move to app (needs redesign)

**Why:**
- Core workflow; users need to import QB invoices
- File picker should be in app, not spreadsheet UI

**Challenges:**
- File upload handling (needs backend)
- IIF parsing (complex; currently done in script)
- Google Drive integration (currently uses Drive API)

**Implementation Options:**
- Option A: Allow user to upload IIF file directly to app; backend parses and stores invoices
  - Pros: No Drive integration needed; cleaner UX
  - Cons: Need to reimplement IIF parser in backend
- Option B: Keep Google Drive integration; app reads from Drive via backend
  - Pros: Reuses existing Drive integration
  - Cons: More complex backend setup

**Recommendation:** Option A (direct file upload)

---

##### 9. Pull Customers (CB + Stax) → Redesign or Remove

**Recommendation:** Phase 2 (defer)

**Why:**
- Dependency on separate Consolidated Billing spreadsheet complicates app parity
- Consider adding direct Stax customer search to app instead
- If CB integration is critical, defer to Phase 2

**Implementation Options:**
- Option A: Remove CB dependency; add direct Stax customer search UI in app
  - User searches Stax by email or company name
  - App imports matching customers and payment methods
  - Pros: Simpler; decoupled from CB
  - Cons: Requires UI work
- Option B: Keep CB integration; add backend sync job
  - Backend job (scheduled or manual) reads CB sheet and syncs customers
  - Pros: Maintains CB integration
  - Cons: More complex; requires new backend feature

**Recommendation:** Option A (Phase 2)

---

#### Phase 4: Automation Workflows (Needs Backend Job Runner)

##### 10. Daily Auto-Charge → Redesign for Backend Job Runner

**Recommendation:** Needs redesign for app

**Why:**
- Daily trigger is spreadsheet-native; doesn't exist in app
- App needs backend job runner to execute daily charges
- Can use AWS Lambda, Cloud Functions, GitHub Actions, etc.

**Implementation:**
- Backend: Set up job runner (e.g., Cloud Scheduler + Cloud Function)
- Configuration: Stored in app database (not spreadsheet Config tab)
- Execution: Daily at 8 AM (or configurable time)
- Logging: Write to app database (not spreadsheet Run Log)

**Alternative:** Stax Webhooks
- If Stax offers invoice-due webhooks, trigger charge from webhook instead of scheduled job
- More reliable; no scheduled job needed
- Requires Stax API support

**Recommendation:** Start with Cloud Scheduler + Cloud Function; evaluate Stax webhooks in Phase 2

---

##### 11. Enable/Disable Daily Auto-Charge → Move to App Settings

**Recommendation:** Move to app (expose in Settings)

**Why:**
- Configuration; currently a menu item and Config tab entry
- App should expose as toggle in Settings

**Implementation:**
- Backend: Store AUTO_CHARGE_ENABLED in app database
- Frontend: Toggle in Settings section
- Logic: Job runner checks setting before executing

---

#### Phase 5: Archival/Debugging Workflows (Keep Spreadsheet-Only)

##### 12. Validate Sheets → Keep spreadsheet-only

**Recommendation:** Keep spreadsheet-only

**Why:**
- Debugging tool; not user-facing
- Only needed if user is manually managing spreadsheet
- Remove from menu if app becomes primary interface

---

##### 13. Reset Operational Sheets → Keep spreadsheet-only

**Recommendation:** Keep spreadsheet-only

**Why:**
- Destructive tool; dangerous
- Only needed if user wants to clear old data from spreadsheet
- Not needed in app (data stored in app database)
- Remove from menu if app becomes primary interface

---

##### 14. Setup Sheets → Keep spreadsheet-only (or remove if app primary)

**Recommendation:** Keep spreadsheet-only (or remove for app)

**Why:**
- One-time setup
- Only needed if user is using spreadsheet directly
- Remove from menu if app becomes primary interface

---

### Migration Roadmap

#### Phase 1 (Now)
- [ ] Move **Sync Customers with Stax** to app
- [ ] Move **Create Stax Invoices** to app
- [ ] Move **Run Charges Now** to app (manual button + API)
- [ ] Implement **Charge Log** in app database
- [ ] Implement **Exception Log** in app database

#### Phase 2 (Q2)
- [ ] Move **Send Pay Links (Bulk)** to app
- [ ] Move **Send Pay Link (Single)** to app
- [ ] Move **Mark Exception Resolved** to app
- [ ] Set up backend job runner for **Daily Auto-Charge**
- [ ] Remove **Pull Customers (CB + Stax)** OR redesign with direct Stax search

#### Phase 3 (Q3)
- [ ] Move **Import IIF File** to app (with backend parser)
- [ ] Migrate spreadsheet to read-only archive
- [ ] Deprecate spreadsheet triggers and menu items
- [ ] Implement **Configuration UI** in app for STAX_API_KEY, ENVIRONMENT, etc.

#### Phase 4 (Q4)
- [ ] Evaluate Stax webhooks for invoice-due events
- [ ] Replace Cloud Scheduler with webhook-based charging (if available)
- [ ] Archive spreadsheet (keep as backup only)

---

### API Design Notes

#### RESTful API Endpoints (Recommended Structure)

```
POST   /api/payments/customers/sync
       Sync customers with Stax; check payment methods
       Request: { dryRun?: boolean }
       Response: { verified, hasPayment, noPayment, foundByEmail, errors }

POST   /api/payments/invoices/create
       Create pending invoices in Stax
       Request: { dryRun?: boolean }
       Response: { created, duplicatesLinked, missingCustomer, apiErrors }

POST   /api/payments/invoices/charge
       Charge eligible invoices (manual trigger)
       Request: { dryRun?: boolean }
       Response: { eligible, paid, declined, noPaymentMethod, alreadyPaid, partial, apiErrors }

POST   /api/payments/invoices/send-pay-links
       Send pay links for failed invoices
       Request: {}
       Response: { sent, failed }

POST   /api/payments/invoices/{id}/send-pay-link
       Send pay link for single invoice
       Request: {}
       Response: { success, error }

GET    /api/payments/exceptions/summary
       Get exception summary
       Response: { total, resolved, byReason: { noPaymentMethod, declined, apiError, ... } }

PUT    /api/payments/exceptions/{id}/resolve
       Mark exception resolved
       Request: {}
       Response: { success }

POST   /api/payments/invoices/import
       Import QB invoices from IIF file
       Request: { file: File }
       Response: { imported, duplicates, exceptions }

GET    /api/payments/config
       Get current configuration
       Response: { environment, autoChargeEnabled, ... }

PUT    /api/payments/config
       Update configuration
       Request: { environment?, autoChargeEnabled?, staxApiKey?, ... }
       Response: { success }
```

---

### Spreadsheet Deprecation Plan

**Immediate (Phase 1):**
- Keep spreadsheet as data source for non-app users
- App reads from spreadsheet (optional) for backward compatibility

**Phase 2-3:**
- Spreadsheet becomes read-only archive
- App has exclusive write access to data
- Sync script updates spreadsheet from app database for audit trail

**Phase 4:**
- Spreadsheet fully deprecated
- Keep as backup only (no active use)
- All data in app database

---

## Conclusion

The Stax Auto-Pay script is a mature, well-engineered spreadsheet application with comprehensive payment automation, exception handling, and audit logging. It has evolved through four phases from simple IIF import to full daily charge automation.

**For app parity:**
1. **Move high-value workflows to app** (sync, create invoices, charge, pay links) — these are recurring and user-facing
2. **Redesign automation** (daily triggers → backend job runner) — serverless triggers don't translate directly to app
3. **Keep spreadsheet-only tools** (setup, reset, validate) as emergency utilities; deprecate from main menu
4. **Implement comprehensive logging** (exception log, charge log, run log) in app database for audit trail
5. **Test extensively** for duplicate charge prevention; the script has three safeguards (status gate, balance check, pre-charge validation); app must replicate all three

**Migration effort estimate:** 40-60 dev-hours (backend API + frontend UI + job runner setup)

