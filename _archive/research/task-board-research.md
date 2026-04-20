# Task Board Research Findings
_Date: 2026-04-03_

Research question: Can the existing Task Board sheet serve as the data source for the Dashboard instead of the current getBatchSummary endpoint that opens all client spreadsheets?

---

## Question 1: References to "task board", "taskboard", "Task_Board", "TaskBoard" across the codebase

### AppScripts/task board script.txt
The Task Board has its own dedicated script file. It's a full Apps Script project (v1.6.0) bound to a separate Google Sheet. It contains all TB_ prefixed functions. Key references found:
- `TB_RefreshNow()` — main sync function, called by time-based trigger every 5 minutes
- `TB_OnBoardEdit()` — onEdit trigger that writes edits back to client sheets
- `TB_readClients_()` — reads the CB Clients tab to get all active client spreadsheet IDs
- `TB_writeMirror_()` — writes aggregated data to the Open_Tasks / Open_Repairs / Open_Will_Calls tabs
- The script has `SHARED_HANDLER_VERSION = "1.0.0"` and SH_ prefixed shared handler functions that mirror functions in the client inventory script (CLAUDE.md architectural decision #10 — both files must be updated together)

### AppScripts/stride-api/StrideAPI.gs
References to Task Board are minimal — StrideAPI.gs does NOT read from the Task Board sheet. It reads client sheets directly. The only Task Board references are in comments about decommissioning (`TB_RefreshNow` timer trigger no longer needed since React app handles operations). No `TASK_BOARD_SPREADSHEET_ID` constant exists in StrideAPI.gs.

### stride-gs-app/src/ (React files)
The React app has NO direct references to the Task Board sheet. The Dashboard uses `getBatchSummary` via the `useDashboardSummary` hook, which polls every 10 seconds. The Task Board sheet is invisible to the React app entirely.

### admin/clients.json and package.json
`push-taskboard.mjs` exists in the admin folder and is wired as `npm run push-taskboard`. The Task Board Apps Script project ID (`1RgsXWnAfZfpU5M58SE19ZFf7cuh0HtC5eUMZ86IxQ2jQwL5Pl5UJZvMg`) appears in the deployment scripts. The Task Board spreadsheet ID itself (the Google Sheet, not the script) is stored in the Task Board's own Settings tab under the key `CONSOLIDATED_BILLING_ID` — it is not in clients.json.

---

## Question 2: What does the Task Board script actually do? What does it read?

The Task Board script is a pull-based aggregator. Here is exactly how it works:

**Step 1 — Get client list from CB:**
`TB_readClients_()` opens the Consolidated Billing spreadsheet (ID stored in Task Board Settings tab as `CONSOLIDATED_BILLING_ID`) and reads the Clients tab. It extracts Client Name, Client Spreadsheet ID, and Active flag for every active client.

**Step 2 — Union headers (first pass):**
It iterates through all active client spreadsheets, opens the Tasks, Repairs, and Will_Calls tabs in each one, and builds a union of all column headers across all clients. This handles schema drift — if one client has a column another doesn't, it still works. Certain deprecated columns are excluded from the union (Inventory Row, TB_Processed, Needs Inspection, etc.).

**Step 3 — Data collection (second pass):**
It opens each client sheet again and reads all rows that match the open-status filter:
- **Tasks:** Excludes rows with Status = "Completed" or "Cancelled"
- **Repairs:** Excludes "Complete", "Completed", "Cancelled", "Declined"
- **Will Calls:** Includes ONLY "Pending", "Scheduled", "Partial"

For each row collected, it prepends Client Name and Sidemark, then appends system metadata columns: `__Client Spreadsheet ID`, `__Source Sheet`, `__Last Sync`, `__Sync Token`, `__Sync Status`.

**Step 4 — Write to mirror tabs:**
`TB_writeMirror_()` writes the aggregated data to Open_Tasks, Open_Repairs, and Open_Will_Calls. It preserves the user's existing column order (non-destructive), applies data validations (Result dropdown: Pass/Fail, Approved dropdown: Approved/Declined, Billed as checkbox, etc.), and hides system columns except `__Sync Status`.

**Step 5 — Two-way edit sync:**
The `TB_OnBoardEdit` trigger fires when a staff member edits a cell on the Task Board. For editable fields, it writes the change back to the source client sheet using the stored `__Client Spreadsheet ID` and source row metadata.

Editable fields that flow back:
- **Tasks:** Result, Task Notes, Item Notes, Assigned To, Location, Start Task
- **Repairs:** Quote Amount, Approved, Parts Cost, Labor Hours, Repair Vendor, Item Notes, Final Amount, Repair Result, Location, Repair Notes, Task Notes, Scheduled Date, Start Date
- **Will Calls:** Estimated Pickup Date, Pickup Party, Pickup Phone, Requested By, Notes, COD, COD Amount

**Sync schedule:** Every 5 minutes via a time-based trigger (`TB_RefreshNow`). Also triggerable manually via menu.

**Important cost note:** The Task Board opens every active client spreadsheet on every refresh cycle. At 5 clients the CLAUDE.md notes ~44 seconds for a `getBatchSummary` cache miss — the Task Board does the same N-sheet-open work, but on its own schedule rather than on the user's request.

### Open_Tasks tab columns
Client Name, Sidemark, Status, Task ID, Type, Item ID, Vendor, Description, Location, Created, Task Notes, Result, Assigned To, Completed At, Cancelled At, Item Notes, Shipment #, Svc Code, Billed, Start Task, Started At — plus system columns: `__Client Spreadsheet ID`, `__Source Sheet`, `__Last Sync`, `__Sync Token`, `__Sync Status`

### Open_Repairs tab columns
Client Name, Sidemark, Status, Repair ID, Source Task ID, Item ID, Vendor, Description, Location, Class, Quote Amount, Approved, Repair Result, Repair Vendor, Scheduled Date, Start Date, Item Notes, Created By, Created Date, Quote Sent Date, Completed Date, Invoice ID, Parts Cost, Labor Hours, Final Amount, Task Notes, Repair Notes, Billed — plus system columns

### Open_Will_Calls tab columns
Client Name, WC Number, Status, Created Date, Pickup Party, Pickup Phone, Requested By, Estimated Pickup Date, Actual Pickup Date, Notes, COD, COD Amount, Items Count, Total WC Fee — plus system columns

### Sync_Log tab
Columns: At, Level, Message, Client, Sheet, Details — audit trail of all refresh operations

---

## Question 3: What does StrideAPI.gs do with getBatchSummary? What CB tabs does it read?

### getBatchSummary endpoint

`handleGetBatchSummary_()` is a lightweight endpoint designed specifically for the Dashboard. It:

- Determines scope via `getAccessibleClientScope_()`: staff/admin = all clients, parent = own + children, client = own sheet only
- Has a 60-second CacheService TTL (vs 600s for the full batch endpoint)
- Uses version-based cache keys via `api_getSummaryCacheKey_()` — when any write happens, `api_bumpSummaryVersion_()` is called and the cache busts for all users
- `api_bumpSummaryVersion_()` is called by: completeTask, sendRepairQuote, respondToRepairQuote, startTask, createWillCall, processWcRelease, and all other write endpoints that touch Tasks/Repairs/Will_Calls

**What it opens:** For each client in scope, it opens that client's Google Sheet and reads the Tasks, Repairs, and Will_Calls tabs. It does NOT read Inventory, Shipments, or Billing. It deliberately skips RichTextValue reads (no folder URLs) and skips notes/billing columns to stay lightweight.

**What it returns:**
```json
{
  "tasks": [{ "taskId": "", "taskType": "", "status": "", "itemId": "", "description": "", "assignedTo": "", "clientName": "", "sidemark": "", "created": "" }],
  "repairs": [{ "repairId": "", "status": "", "itemId": "", "description": "", "vendor": "", "quoteAmount": "", "clientName": "", "createdDate": "" }],
  "willCalls": [{ "wcNumber": "", "status": "", "pickupParty": "", "itemCount": "", "clientName": "", "estPickupDate": "", "createdDate": "" }],
  "counts": {
    "tasksByStatus": { "Open": 0, "In Progress": 0 },
    "repairsByStatus": {},
    "wcsByStatus": {}
  },
  "fetchedAt": ""
}
```

### What CB tabs does StrideAPI.gs read?

StrideAPI.gs reads the CB spreadsheet (via `CB_SPREADSHEET_ID` script property) for:
- **Clients tab** — to get the list of all active client spreadsheet IDs (drives client scope on every endpoint)
- **Locations tab** — for the `getLocations` endpoint
- **Users tab** — for user management endpoints
- **Settings tab** — for CB-level settings like `NEXT_ITEM_ID`

StrideAPI.gs does NOT read Unbilled_Report, Consolidated_Ledger, or Invoice_Review from CB — those are used by the CB-bound script, not the API.

### Full CB workbook tab list
As found in AppScripts/Consolidated Billing Sheet/Code.gs.js (v2.1.0):

1. **Settings** — OWNER_EMAIL, IIF_EXPORT_FOLDER_ID, MASTER_RPC_URL, MASTER_RPC_TOKEN, MASTER_ACCOUNTING_FOLDER_ID, MASTER_SPREADSHEET_ID
2. **Clients** — Client Name, Client Spreadsheet ID, Active, Notes (+ PARENT_CLIENT, staxCustomerId, contactName, phone, and all feature flag columns)
3. **Locations** — Centralized warehouse locations list (v2.1.0)
4. **Users** — Authentication user management (v2.1.0)
5. **Unbilled_Report** — Point-in-time snapshot of unbilled billing rows pulled from all client Billing_Ledgers (generated on demand, not continuous)
6. **Consolidated_Ledger** — Invoice processing; headers: Status, Invoice #, Client, Client Sheet ID, Ledger Row ID, Source Row, Date, Svc Code, Svc Name, Item ID, Description, Class, Qty, Rate, Total, Task ID, Repair ID, Shipment #, Item Notes, Email Status, Invoice URL, Date Added
7. **Invoice_Review** — Approval queue for invoices; headers: Action (Approve/Void), INV #, Client, Svc Code, Svc Name, Item ID, Description, Class, Qty, Rate, Total, Task ID, Repair ID, Shipment #, Item Notes, Ledger Row ID, Client Sheet ID, Source Row

**No CB tab aggregates open tasks, repairs, or will calls.** The CB workbook is billing/invoicing focused. The only cross-client task/repair/WC aggregation lives in the Task Board.

---

## Question 4: Are there any triggers or functions that sync/aggregate data from client sheets into a central location?

**Yes — two exist:**

### 1. Task Board TB_RefreshNow (time-based trigger, every 5 min)
This is the main aggregation trigger described in Question 2. It is a time-based trigger installed on the Task Board Apps Script project. It opens all N active client sheets and writes aggregated open tasks/repairs/will calls to the Open_* tabs. The CLAUDE.md notes this trigger is a candidate for decommissioning since the React app now handles all task/repair/WC operations, but it has not been removed.

### 2. CB Unbilled_Report generation (on-demand, not continuous)
The CB script has `populateUnbilledReport_()` which opens all client sheets and reads each client's Billing_Ledger tab to build the Unbilled_Report tab on CB. This is triggered manually via the CB menu — it is not a continuous sync, just a point-in-time snapshot for billing purposes.

**No other continuous sync exists.** There is no push-based mechanism where client sheets write to a central aggregation sheet when data changes. The only continuous real-time aggregation is the Task Board's 5-minute pull cycle.

---

## Question 5: Could any existing sheet serve as a pre-built index for the Dashboard?

**Yes — the Task Board's Open_* tabs are a ready-made index.**

### What a Task Board-backed endpoint would look like

A new `getBatchSummaryFromTaskBoard` handler in StrideAPI.gs would:
1. Open ONE sheet — the Task Board spreadsheet (needs `TASK_BOARD_SPREADSHEET_ID` script property added)
2. Read 3 tabs: Open_Tasks, Open_Repairs, Open_Will_Calls
3. Filter by the same status sets the Dashboard already uses
4. Map columns to the same response shape as the current `getBatchSummary`
5. Return — effectively instant, one spreadsheet open, contiguous row reads

Response time on a cold cache: effectively instant. No N-sheet opens. No 44-second delays.

### The Task Board sheet ID situation

The Task Board spreadsheet ID is NOT stored anywhere in StrideAPI.gs or clients.json today. It lives only in the Task Board's own Settings tab as `CONSOLIDATED_BILLING_ID` (that's the CB ID it reads from, not its own ID). To implement this, Justin would need to find the Task Board spreadsheet ID from the URL when the sheet is open, then add it as a script property `TASK_BOARD_SPREADSHEET_ID` in the StrideAPI.gs project.

### Tradeoff analysis

| Concern | getBatchSummary (current) | Task Board as index (proposed) |
|---|---|---|
| Opens client sheets? | YES — on every cache miss | NO — reads one pre-aggregated sheet |
| Cold cache response time | ~44s at 5 clients | ~1-2s |
| Data freshness | Fresh-on-write (cache busts on any write) | At most 5 minutes stale |
| Cache invalidation | Write-triggered via `api_bumpSummaryVersion_()` | Not needed — always reads current TB state |
| Background cost | None — cost is on the user's request | TB_RefreshNow opens all N sheets every 5 min regardless |
| Failure mode | Slow but correct | If TB trigger fails, Dashboard goes stale with no error signal |
| Dependency | None (self-contained) | Depends on TB_RefreshNow trigger staying healthy |
| Implementation effort | Already deployed | New script property + new handler in StrideAPI.gs |
| Scope filtering (parent/child) | Built in via `getAccessibleClientScope_()` | Would need to filter by Client Name against the client scope list |

### Staleness risk

The 5-minute lag is the main tradeoff. Currently if a task is completed, the Dashboard cache busts immediately and the next poll (10s) sees fresh data. With the Task Board as source, the completed task would still appear in the Dashboard for up to 5 minutes. Whether that's acceptable depends on operational expectations.

One mitigation: keep `api_bumpSummaryVersion_()` calls on all write endpoints, but have the Task Board-backed endpoint also check the version and trigger an early TB refresh (via a URL fetch to the Task Board's web app) when the version is newer than what was last read. This is complex and probably not worth it.

### The CB workbook as an index

The CB workbook does NOT serve this purpose. It has no tab that aggregates open tasks, repairs, or will calls across clients. Unbilled_Report aggregates billing rows (not tasks/repairs/WCs) and only on demand. There is nothing in CB that could replace the Task Board for Dashboard purposes.

---

## Conclusion

The Task Board sheet is architecturally the right pre-built index for eliminating the `getBatchSummary` N-sheet-open cost. It already does the aggregation work — the 5-minute pull cycle opens all client sheets on its own schedule, so the sheet-open cost is paid in the background rather than on the user's request path. The Dashboard would always respond in ~1-2 seconds instead of up to 44 seconds on a cold cache.

The main risks are:
1. **5-minute staleness** — writes are no longer immediately reflected in the Dashboard
2. **Trigger health dependency** — if `TB_RefreshNow` fails or gets disabled, the Dashboard silently goes stale
3. **Task Board decommissioning conflict** — CLAUDE.md already notes TB_RefreshNow as a decommission candidate; if the trigger is removed, this approach breaks

If the Task Board is going to be kept running (Justin still uses it for editing tasks directly), using it as the Dashboard data source is a low-effort, high-payoff change. If the plan is to eventually decommission the Task Board entirely, this creates a new dependency that conflicts with that plan.

Implementation would require:
1. Finding the Task Board spreadsheet ID from the Google Sheets URL
2. Adding it as a script property `TASK_BOARD_SPREADSHEET_ID` in StrideAPI.gs
3. Writing a new `handleGetBatchSummaryFromTaskBoard_()` handler that reads the 3 Open_* tabs
4. Optionally: switching the `getBatchSummary` action name to route to the new handler (transparent to the React app)
