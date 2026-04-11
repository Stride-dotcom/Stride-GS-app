# Phase 7D — Executable Test Matrix (v2.0 — Tightened)

**Date:** 2026-03-30
**Source:** Code inspection of StrideAPI.gs v24.1.0, 13 client scripts, 11 CB scripts, Task Board v1.5.0, React app
**Purpose:** Concrete, executable test cases with sheet-level verification steps.

---

## PASS/FAIL Evidence Rule

**DO NOT mark any test case PASS without documented evidence.**

For every test case:
- Screenshot or observation of the UI result
- For write tests: open the target Google Sheet tab, find the specific row by ID (Task ID, Repair ID, WC Number, Shipment #, Claim ID, Ledger Row ID), and verify each listed column has the expected value
- For side-effect tests: verify Drive folder exists, email exists in Gmail Sent, PDF is openable
- For idempotency tests: verify row count did NOT increase and no duplicate rows exist
- If any column value does not match expected, the test is FAIL even if the UI showed success

---

## Data Restrictions

**ONLY use these test accounts:**
- **Demo Company** — Spreadsheet ID: `1bG4Sd7uEkBcTJF513C2GgESskXDyvZomctfmaBVmpZs`
- **Justin Demo Company** — Spreadsheet ID: `1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A`

**DO NOT use Brian Paquette Interiors — that is a LIVE CLIENT.**

## Deployment Verification Note

Before running any tests, verify the deployed React bundle matches source. GitHub Pages CDN can serve stale JS bundles for several minutes after `git push`. Always hard-refresh (Ctrl+Shift+R) and compare the `index-*.js` filename in DevTools Network tab against `dist/assets/` folder.

---

## Canonical Status Values Reference

All test cases use these EXACT values. They match Code.gs validation lists, StrideAPI.gs write operations, and React types.ts/constants.ts.

| Entity | Valid Statuses (exact strings, case-sensitive) |
|--------|------------------------------------------------|
| **Inventory** | `Active`, `Released`, `On Hold`, `Transferred` |
| **Task Status** | `Open`, `In Progress`, `Completed`, `Cancelled` |
| **Task Result** | `Pass`, `Fail` |
| **Repair Status** | `Pending Quote`, `Quote Sent`, `Approved`, `Declined`, `In Progress`, `Complete`, `Cancelled` |
| **Repair Approved** | `Approved`, `Declined` |
| **Repair Result** | `Pass`, `Fail` |
| **Will Call Status** | `Pending`, `Scheduled`, `Released`, `Partial`, `Cancelled` |
| **WC_Items Status** | `Pending`, `Scheduled`, `Released`, `Partial`, `Cancelled` |
| **Billing Status** | `Unbilled`, `Invoiced`, `Paid`, `Void` |
| **Claim Status** | `Under Review`, `Waiting on Info`, `Settlement Sent`, `Approved`, `Closed`, `Void` |
| **Claim Type** | `Item Claim`, `Property Claim` |

---

## Test Category Legend

| Category | Code | Description |
|----------|------|-------------|
| E2E Browser | `E2E` | Full browser test: UI action → API → Sheet verification |
| Concurrency | `CONC` | Same action from multiple sessions or rapid repeated clicks |
| Failure/Stress | `FAIL` | Missing data, invalid state, navigation during write, timeout |
| Idempotency | `IDEMP` | Re-running same action — must not create duplicates |
| Auth Boundary | `AUTH` | Role isolation, expired sessions, invalid credentials |
| Side Effect | `FX` | Email, PDF, Drive folder verification |
| Export | `EXP` | File download verification (CSV, PDF) |
| Code Parity | `PARITY` | Code-review comparison (NOT runtime browser QA) |

---

# SECTION A: E2E BROWSER TESTS

## TC-001: Complete Shipment — Happy Path

| Field | Value |
|-------|-------|
| **Workflow** | WF-03: Receiving |
| **Category** | `E2E` |
| **Action** | 1. Navigate to `#/receiving` 2. Select "Demo Company" from client dropdown 3. Fill carrier="UPS", tracking="TEST-001" 4. Add 2 item rows: (a) Item ID=TEST-ITEM-A, Desc="Test Sofa", Class=L, Qty=1, Location=A-01-01 (b) Item ID=TEST-ITEM-B, Desc="Test Chair", Class=S, Qty=1, Location=A-01-02 5. Check "Needs Inspection" on item A 6. Click "Complete Shipment" |
| **Page** | `#/receiving` |
| **Test Account** | Demo Company (`1bG4Sd7uEkBcTJF513C2GgESskXDyvZomctfmaBVmpZs`) |
| **Preconditions** | API configured. No existing Active items with IDs TEST-ITEM-A or TEST-ITEM-B. |
| **Expected UI Result** | ProcessingOverlay shown during submission. Success card: shipmentNo (SHP-XXXXXX), itemCount=2, tasksCreated≥1, billingRows count. |
| **Expected API Response** | `{ ok: true, shipmentNo: "SHP-XXXXXX", itemCount: 2, tasksCreated: 1 }` |
| **Row Verification** | Open Demo Company spreadsheet: |
| | **Inventory tab:** Find rows by Item ID = "TEST-ITEM-A" and "TEST-ITEM-B". Verify: Status=`Active`, Description matches, Class=L/S, Qty=1, Location=A-01-01/A-01-02, Shipment # cell is hyperlinked to Drive folder URL. |
| | **Shipments tab:** Find row by Shipment # (from API response). Verify: Carrier="UPS", Tracking #="TEST-001", Receive Date set. |
| | **Tasks tab:** Find row by Task ID matching pattern INSP-TESTITEMA-*. Verify: Type contains "Inspection", Item ID="TEST-ITEM-A", Status=`Open`. Confirm NO task row for TEST-ITEM-B (inspection not checked). |
| | **Billing_Ledger tab:** If ENABLE_RECEIVING_BILLING=TRUE in Settings, find rows by Shipment #. Verify: Svc Code="RCVG", Status=`Unbilled`, one row per item. |
| **Side Effects** | Drive folder (click Shipment # hyperlink to confirm). Email: check Gmail Sent for SHIPMENT_RECEIVED. PDF: DOC_RECEIVING attached to email. |
| **Pass Evidence** | All 4 tabs have correct rows. Hyperlink opens Drive folder. No duplicate rows. |

---

## TC-002: Complete Shipment — Duplicate Item ID

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. Navigate to `#/receiving` 2. Select Demo Company 3. Add 1 item with Item ID matching an existing `Active` item in Inventory 4. Click "Complete Shipment" |
| **Preconditions** | An `Active` item with known Item ID exists in Demo Company Inventory tab. |
| **Expected UI Result** | Error message displayed. ProcessingOverlay does NOT reach success state. |
| **Row Verification** | Open Inventory tab. Count rows matching the Item ID — should be exactly the same count as before (no new row). |
| **Pass Evidence** | Error shown in UI. Inventory tab row count unchanged. |

---

## TC-003: Batch Create Tasks — Happy Path

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/inventory` 2. Filter to Demo Company 3. Select 2 `Active` items via checkboxes 4. Click "Create Task" in floating action bar 5. Select "Inspection" in CreateTaskModal 6. Confirm |
| **Preconditions** | 2+ `Active` items. No existing `Open` INSP tasks for those Item IDs. |
| **Expected UI Result** | Success toast with task count. |
| **Row Verification** | **Tasks tab:** Find rows by Item ID matching selected items. Verify: Task ID format = INSP-{ITEMID}-N, Type contains "Inspection", Status=`Open`, Item ID matches, Description matches. Count: exactly 2 new rows. |
| **Side Effects** | None (lightweight creation — no email, PDF, or Drive folder). |
| **Pass Evidence** | 2 new task rows with correct IDs. No duplicates. |

---

## TC-004: Batch Create Tasks — Idempotency

| Field | Value |
|-------|-------|
| **Category** | `IDEMP` |
| **Action** | Repeat TC-003 with same items and same service code ("Inspection"). |
| **Preconditions** | TC-003 completed — `Open` INSP tasks already exist for those items. |
| **Expected UI Result** | Success with tasksCreated=0 (all skipped). |
| **Row Verification** | **Tasks tab:** Count INSP tasks for those Item IDs — must be exactly the same count as after TC-003. No new rows added. |
| **Pass Evidence** | Zero new rows. Existing task rows unchanged. |

---

## TC-005: Start Task — Happy Path

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/tasks` 2. Single-click an `Open` task row 3. TaskDetailPanel opens 4. Click "Start Task" 5. Wait for ProcessingOverlay |
| **Preconditions** | `Open` task exists. Task's shipment has a Drive folder (Shipment # hyperlinked in Shipments tab). |
| **Expected UI Result** | ProcessingOverlay → success. Task ID becomes hyperlinked. Status badge = "In Progress" (amber). Folder link appears. |
| **Row Verification** | **Tasks tab:** Find row by Task ID. Verify: Status=`In Progress`, Started At has timestamp (not blank), Task ID cell has RichTextValue hyperlink to Drive folder URL. If Assigned To was provided, verify that column. |
| **Side Effects** | Drive: Click Task ID hyperlink → opens folder inside shipment folder (pattern: SHP-XXXXXX/INSP-ITEMID-N/). Folder contains Work Order PDF (filename starts with "Work_Order_"). |
| **Pass Evidence** | Status=`In Progress`. Started At populated. Hyperlink works. PDF exists in folder. |

---

## TC-006: Start Task — Idempotency (Already In Progress)

| Field | Value |
|-------|-------|
| **Category** | `IDEMP` |
| **Action** | 1. `#/tasks` 2. Click the task from TC-005 (now `In Progress`) 3. Check if "Start Task" button is available |
| **Preconditions** | Task Status=`In Progress`, Started At populated. |
| **Expected UI Result** | "Start Task" button disabled or hidden (task is not `Open`). |
| **Row Verification** | **Tasks tab:** Started At timestamp unchanged from TC-005. No second Drive folder or PDF created. |
| **Pass Evidence** | Button not clickable. Sheet unchanged. |

---

## TC-007: Complete Task — Pass Result

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/tasks` 2. Click an `Open` or `In Progress` task 3. Select Result="Pass" 4. Add notes: "QA test pass" 5. Click "Complete Task" |
| **Preconditions** | Task Status is `Open` or `In Progress`. |
| **Expected UI Result** | ProcessingOverlay → success. Status badge = "Completed" (green). Close button disabled during processing. |
| **Row Verification** | **Tasks tab:** Find by Task ID. Verify: Status=`Completed`, Result=`Pass`, Task Notes contains "QA test pass", Completion Processed At has timestamp. |
| | **Billing_Ledger tab:** Search for row where Task ID matches. If task type has billIfPass=TRUE in Price_List, verify: Svc Code matches task type, Item ID matches, Status=`Unbilled`. If billIfPass=FALSE, verify NO billing row exists for this Task ID. |
| **Side Effects** | Email: TASK_COMPLETE or INSP_EMAIL template in Gmail Sent (with Work Order PDF attached if folder exists). |
| **Pass Evidence** | Task Status=`Completed`. Billing row exists only if billIfPass. No duplicate billing rows. |

---

## TC-008: Complete Task — Fail Result (Auto-Create Repair)

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/tasks` 2. Click an `Open` inspection (INSP) task 3. Select Result="Fail" 4. Notes: "Damaged frame" 5. Click "Complete Task" |
| **Preconditions** | `Open` INSP task exists. |
| **Row Verification** | **Tasks tab:** Find by Task ID. Verify: Status=`Completed`, Result=`Fail`. |
| | **Repairs tab:** Find row where Source Task ID = completed task's Task ID. Verify: Status=`Pending Quote`, Item ID matches task's Item ID, Description populated. |
| **Side Effects** | Email: INSP_EMAIL template. Repair row auto-created. |
| **Pass Evidence** | Repair row exists with Source Task ID pointing to failed task. Exactly 1 new repair row (not duplicated). |

---

## TC-009: Complete Task — Idempotency (Already Completed)

| Field | Value |
|-------|-------|
| **Category** | `IDEMP` |
| **Action** | Open a `Completed` task in TaskDetailPanel. Attempt to complete again. |
| **Preconditions** | Task has Status=`Completed`, Completion Processed At set. |
| **Expected UI Result** | Complete button disabled/hidden for `Completed` tasks. |
| **Row Verification** | **Tasks tab:** Completion Processed At unchanged. **Billing_Ledger:** No new billing row for this Task ID. **Repairs tab:** No new repair row (if was inspection fail). |
| **Pass Evidence** | No changes to any tab. Row counts unchanged. |

---

## TC-010: Task Status Filter Chips

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/tasks` 2. Verify 4 status chips visible: `Open`, `In Progress`, `Completed`, `Cancelled` 3. Click each chip and verify filtering 4. Verify badge colors: Open=blue, In Progress=amber, Completed=green, Cancelled=gray |
| **Preconditions** | Tasks exist in multiple statuses. |
| **Expected UI Result** | All 4 chips always visible (even 0 count). Clicking each shows correct filtered set. |
| **Pass Evidence** | All chips rendered. Correct color per status. Filtering works. |

---

## TC-011: Send Repair Quote — Happy Path

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/repairs` 2. Click a `Pending Quote` repair 3. Enter quote amount $150.00 4. Click "Send Quote" |
| **Preconditions** | Repair with Status=`Pending Quote` exists. |
| **Expected UI Result** | Success card. Status badge → `Quote Sent`. |
| **Row Verification** | **Repairs tab:** Find by Repair ID. Verify: Status=`Quote Sent`, Quote Amount=150, Quote Sent At has timestamp. |
| **Side Effects** | Email: REPAIR_QUOTE_SENT template. |
| **Pass Evidence** | Status=`Quote Sent`. Amount and timestamp present. |

---

## TC-012: Approve Repair Quote

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/repairs` 2. Click a `Quote Sent` repair 3. Click "Approve" |
| **Preconditions** | Repair Status=`Quote Sent`. |
| **Row Verification** | **Repairs tab:** Find by Repair ID. Verify: Status=`Approved`, Approval Processed At has timestamp. |
| **Side Effects** | Email: REPAIR_APPROVED. Drive: Repair folder created (pattern: REPAIR-XXXXX/). PDF: DOC_REPAIR_WORK_ORDER inside folder. |
| **Pass Evidence** | Status=`Approved`. Folder + PDF exist. |

---

## TC-013: Decline Repair Quote

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/repairs` 2. Click a `Quote Sent` repair 3. Click "Decline" |
| **Row Verification** | **Repairs tab:** Find by Repair ID. Verify: Status=`Declined`, Decline Processed At has timestamp, Approved column=`Declined`. |
| **Side Effects** | Email: REPAIR_DECLINED. No Drive folder or PDF created. |
| **Pass Evidence** | Status=`Declined`. No folder created. |

---

## TC-014: Complete Repair — Pass

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/repairs` 2. Click an `Approved` repair 3. Result="Pass", final amount=$145 4. Click "Complete Repair" |
| **Row Verification** | **Repairs tab:** Find by Repair ID. Verify: Status=`Complete`, Repair Result=`Pass`, Final Amount=145, Completion Processed At has timestamp. |
| | **Billing_Ledger tab:** Find row where Repair ID matches. Verify: Svc Code="REPAIR", Total matches final amount, Status=`Unbilled`. Exactly 1 billing row (no duplicates). |
| **Side Effects** | Email: REPAIR_COMPLETE. |
| **Pass Evidence** | Repair `Complete`. Billing row with correct amount. |

---

## TC-015: Create Will Call — Happy Path

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/inventory` 2. Filter Demo Company 3. Select 2 `Active` items 4. "Create Will Call" 5. Modal: Pickup Party="John Doe" 6. Submit |
| **Preconditions** | 2+ `Active` items. Items not `Released` or on another WC. |
| **Row Verification** | **Will_Calls tab:** Find by WC Number (from API response, format WC-MMDDYYHHMMSS). Verify: Status=`Pending`, Pickup Party="John Doe". |
| | **WC_Items tab:** Find rows by WC Number. Verify: 2 rows, each with correct Item ID, Status=`Pending`. |
| | **Billing_Ledger tab:** Find rows by WC Number or matching Item IDs + Svc Code="WC". Verify: Status=`Unbilled`. |
| **Side Effects** | Email: WILL_CALL_CREATED. PDF: DOC_WILL_CALL_RELEASE in WC folder. Drive: WC folder created. |
| **Pass Evidence** | WC row + 2 item rows + billing rows. Folder + PDF exist. |

---

## TC-016: Will Call Release — Full

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/will-calls` 2. Click a `Pending` WC (from TC-015) 3. Check ALL items 4. Click "Release Items" |
| **Row Verification** | **Will_Calls tab:** Find by WC Number. Verify: Status=`Released`. |
| | **WC_Items tab:** Find by WC Number. Verify: ALL rows Status=`Released`. |
| | **Inventory tab:** Find items by Item ID. Verify: Status=`Released`, Release Date set. |
| **Side Effects** | Email: WILL_CALL_RELEASED. PDF: DOC_WILL_CALL_RELEASE regenerated. |
| **Pass Evidence** | WC=`Released`. All items=`Released`. Inventory Status=`Released`. |

---

## TC-017: Will Call Release — Partial

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. Create WC with 3 items 2. `#/will-calls` → WillCallDetailPanel 3. Check only 1 of 3 items 4. "Release Items" |
| **Row Verification** | **Will_Calls tab:** WC Number Status=`Partial`. |
| | **WC_Items tab:** Released item Status=`Released`. Other 2 items Status unchanged. |
| | **Inventory tab:** Only released item Status=`Released`. Others still `Active`. |
| **Pass Evidence** | WC=`Partial`. Exactly 1 item released. |

---

## TC-018: Cancel Will Call

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/will-calls` 2. Click a `Pending` WC 3. Click "Cancel WC" |
| **Preconditions** | WC Status=`Pending` (not `Released`). |
| **Row Verification** | **Will_Calls tab:** Find by WC Number. Status=`Cancelled`. |
| | **WC_Items tab:** ALL rows Status=`Cancelled`. |
| | **Inventory tab:** Items remain `Active` (not released). |
| **Side Effects** | Email: WILL_CALL_CANCELLED. |
| **Pass Evidence** | WC+items=`Cancelled`. Inventory unchanged. |

---

## TC-019: Will Call Release — Idempotency (Already Released)

| Field | Value |
|-------|-------|
| **Category** | `IDEMP` |
| **Action** | Open a `Released` WC. Attempt to release again. |
| **Expected UI Result** | No unreleased items available to select. Release button disabled/hidden. |
| **Row Verification** | WC_Items row count unchanged. No duplicate release entries. |
| **Pass Evidence** | Cannot initiate release on already-released WC. |

---

## TC-020: Print Release Doc

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/will-calls` 2. Click a WC with Drive folder + PDF 3. Click "Print Release Doc" |
| **Preconditions** | WC has been released or created (folder+PDF exist). |
| **Expected UI Result** | Loading spinner on button → PDF opens in new browser tab. |
| **Pass Evidence** | PDF opens. Document contains WC number and item details matching sheet data. |

---

## TC-021: Generate Storage Charges

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/billing` 2. "Generate Storage Charges" 3. Set date range (last 30 days) 4. Confirm |
| **Preconditions** | `Active` items exist past FREE_STORAGE_DAYS. |
| **Row Verification** | **Billing_Ledger tab (Demo Company):** Find STOR rows by Svc Code="STOR". Verify: |
| | - Task ID column contains idempotency key format: `STOR-{ItemID}-{YYYYMMDD}-{YYYYMMDD}` |
| | - Status=`Unbilled` |
| | - Rate = Base STOR rate from Price_List × Class cubic volume (XS=10, S=25, M=50, L=75, XL=110 cuFt) × (1 + DISCOUNT_STORAGE_PCT/100) |
| | - Items within FREE_STORAGE_DAYS NOT billed (no STOR row) |
| | - No duplicate STOR rows for same item+period (old unbilled STOR deleted, new ones written) |
| **Pass Evidence** | STOR rows match active items. Rates correct per class. No duplicates. Free-period items excluded. |

---

## TC-022: Storage Charges — Rate Calculation

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | After TC-021, pick one STOR row and manually verify rate math. |
| **Row Verification** | 1. Find the item's Class in Inventory tab (e.g., "L") 2. Look up Class cubic volume: L=75 cuFt 3. Look up base STOR rate from Price_List (Price_Cache) for that class 4. Look up DISCOUNT_STORAGE_PCT from client Settings tab 5. Expected Rate = base_rate × 75 × (1 + discount_pct/100). If discount_pct=-5, multiply by 0.95. 6. Compare against Rate column in Billing_Ledger. |
| **Pass Evidence** | Calculated rate matches Billing_Ledger Rate column exactly. |

---

## TC-023: Storage Charges — Dedup (Repeat Generation)

| Field | Value |
|-------|-------|
| **Category** | `IDEMP` |
| **Action** | Run TC-021 again with same date range. |
| **Row Verification** | **Billing_Ledger:** Count STOR rows for same period. Must be SAME count as after TC-021 (old `Unbilled` STOR deleted, new ones written). Any `Invoiced`/`Billed`/`Void` STOR rows must be untouched. |
| **Pass Evidence** | No duplicate STOR rows. Previously invoiced rows preserved. |

---

## TC-024: Generate Unbilled Report

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/billing` 2. "Generate Unbilled Report" |
| **Preconditions** | `Unbilled` rows exist across clients. |
| **Expected UI Result** | Inline table showing unbilled rows with totals. CSV export button available. |
| **Row Verification** | **CB Unbilled_Report tab:** Verify rows exist. Cross-check: pick 3 rows, verify each exists in the corresponding client's Billing_Ledger with Status=`Unbilled`. Match by Ledger Row ID. Verify column mapping: Client, Item ID, Svc Code, Svc Name, Qty, Rate, Total. |
| **Pass Evidence** | Unbilled_Report populated. Row count matches React display. Spot-checked rows match source ledgers. |

---

## TC-025: Create Invoice

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/billing` 2. "Create Invoices" 3. Select unbilled rows for Demo Company 4. Confirm |
| **Row Verification** | **Client Billing_Ledger:** Find rows by Invoice # (from response). Verify each: Status=`Invoiced`, Invoice # set (INV-XXXXXX format), Invoice Date populated, Invoice URL is a Google Drive link. |
| | **CB Consolidated_Ledger:** Find matching rows by Invoice #. Verify they exist with same totals. |
| | **No duplicate billing rows:** Count total Billing_Ledger rows for those Item IDs — must not increase (status changed, not new rows). |
| **Side Effects** | PDF: Invoice document at Invoice URL (click to verify). Email: Invoice email with PDF. Counter: Invoice # from Master RPC (sequential, not duplicated). |
| **Pass Evidence** | All ledger rows = `Invoiced` with correct Invoice #. PDF opens. CB has matching rows. |

---

## TC-026: Invoice — No Duplicate Billing Rows After Repeat

| Field | Value |
|-------|-------|
| **Category** | `IDEMP` |
| **Action** | Attempt to invoice the same rows again (they are now `Invoiced`, not `Unbilled`). |
| **Expected UI Result** | Rows should not be available for invoicing (they are `Invoiced`). |
| **Row Verification** | No new Invoice # assigned. No status changes. Row count unchanged. |
| **Pass Evidence** | Cannot re-invoice already-invoiced rows. |

---

## TC-027: Task/Repair Completion Creates Expected Ledger Rows

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. Complete a task (Pass) → check Billing_Ledger for task billing row. 2. Complete a repair (Pass, $200) → check Billing_Ledger for repair billing row. |
| **Row Verification** | **Billing_Ledger:** |
| | Task completion: Find row by Task ID. Svc Code matches task type. Rate from Price_List. Status=`Unbilled`. |
| | Repair completion: Find row by Repair ID. Svc Code="REPAIR". Total=$200 (or adjusted by discount). Status=`Unbilled`. |
| | Neither should create duplicate rows if re-run (idempotency via Completion Processed At). |
| **Pass Evidence** | Exactly 1 billing row per completed task. Exactly 1 per repair. Amounts match Price_List rates. |

---

## TC-028: Resend Invoice Email

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/billing` 2. Select an `Invoiced` row 3. Click "Re-send Email" |
| **Preconditions** | Row has Status=`Invoiced` with Invoice URL (PDF in Drive). |
| **Side Effects** | Email re-sent. Check Gmail Sent for email with PDF attachment. |
| **Pass Evidence** | Email in Sent folder with correct Invoice PDF attached. |

---

## TC-029: Transfer Items — Happy Path

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/inventory` 2. Filter Demo Company 3. Select 1 `Active` item 4. "Transfer Items" 5. Destination: Justin Demo Company 6. Confirm |
| **Row Verification** | **Source (Demo Company) Inventory:** Find by Item ID. Status=`Transferred`. |
| | **Destination (Justin Demo Company) Inventory:** Find by Item ID. Status=`Active`. Same Item ID, Description, Class. |
| | **Source Billing_Ledger:** Any `Unbilled` rows for that Item ID should be voided or removed. |
| | **Destination Billing_Ledger:** Corresponding unbilled rows recreated. |
| **Side Effects** | Email: TRANSFER_RECEIVED (no attachment). |
| **Pass Evidence** | Source=`Transferred`. Destination=`Active`. Billing moved. |

---

## TC-030: Create Claim — Item Claim with Linked Inventory

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/claims` 2. "New Claim" 3. Type=`Item Claim`, Company="Demo Company", Contact="Jane Doe", Email="jane@test.com", Description="Scratched antique dresser" 4. Add 1 inventory item (select from autocomplete by Item ID) 5. Submit |
| **Preconditions** | Admin role. Claims schema set up (5 tabs on CB). Item exists in Demo Company Inventory. |
| **Row Verification** | **CB Claims tab:** Find by Claim ID (CLM-XXXXXX from response). Verify: Claim Type=`Item Claim`, Status=`Under Review`, Company Client Name="Demo Company", Primary Contact Name="Jane Doe", Email="jane@test.com", Issue Description contains "Scratched antique dresser", First Reviewed By populated, First Reviewed At has timestamp, Date Opened set. |
| | **CB Claim_Items tab:** Find by Claim ID. Verify: Item ID matches selected item, Item Description Snapshot populated, Vendor Snapshot populated, Class Snapshot populated, Status Snapshot populated, Added By populated. |
| | **CB Claim_History tab:** Find by Claim ID. Verify: Event Type="created" (or similar), Actor populated, Event Timestamp set. |
| **Side Effects** | Drive: Claim folder created (check Claim Folder URL column). Email: claim-opened template. |
| **Pass Evidence** | CLM# in Claims tab. Item snapshot in Claim_Items. History event logged. Folder exists. |

---

## TC-031: Claim — Add Note (Internal)

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. Open claim from TC-030 2. Type internal note "Reviewing with adjuster" 3. Submit |
| **Row Verification** | **CB Claim_History tab:** Find newest row for this Claim ID. Verify: Event Message contains "Reviewing with adjuster", Is Public=FALSE, Actor populated. |
| **Pass Evidence** | Note row in history. isPublic=FALSE. |

---

## TC-032: Claim — Request More Info

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. Open claim 2. "Request More Info" 3. Enter: "Please provide photos of the damage" 4. Submit |
| **Row Verification** | **CB Claims tab:** Status=`Waiting on Info`. |
| | **CB Claim_History tab:** Event with info request text. |
| **Side Effects** | Email: claim-need-info template sent to claimant email. |
| **Pass Evidence** | Status=`Waiting on Info`. History logged. Email sent. |

---

## TC-033: Claim — Generate Settlement

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. Open claim 2. "Generate Settlement" 3. Coverage Type, Outcome Type=`Approved`, Approved Amount=$500, Explanation="Full replacement value" 4. Submit |
| **Row Verification** | **CB Claims tab:** Status=`Settlement Sent`, Approved Amount=500. |
| | **CB Claim_Files tab:** Find by Claim ID. Verify: File Type="settlement" (or similar), Version No=1, Is Current=TRUE, File URL populated, Created By populated. |
| | **CB Claim_History tab:** Settlement-generated event. |
| **Side Effects** | PDF: Settlement document at File URL (click to verify contents — should contain claim details, items, amount). Email: claim-settlement template. |
| **Pass Evidence** | Status=`Settlement Sent`. PDF accessible. Version=1. |

---

## TC-034: Claim — Close + Reopen

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. Close an existing claim 2. Verify Status + Date Closed 3. Reopen it 4. Verify Status + Date Closed cleared |
| **Row Verification** | **After Close:** CB Claims: Status=`Closed`, Date Closed set. Claim_History: close event. |
| | **After Reopen:** CB Claims: Status=`Under Review`, Date Closed blank. Claim_History: reopen event. |
| **Pass Evidence** | Both transitions correct. History has both events. |

---

## TC-035: Claim — Void

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | Void an existing claim. |
| **Row Verification** | **CB Claims:** Status=`Void`. Claim_History: void event. |
| **Pass Evidence** | Status=`Void`. No further write actions available. |

---

## TC-036: Client Onboarding — Create

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/settings` → Clients → "Onboard Client" 2. Name="Test QA Client", Email="qa@test.com" 3. Submit |
| **Preconditions** | CB Settings: CLIENT_INVENTORY_TEMPLATE_ID and CLIENT_PARENT_FOLDER_ID set. |
| **Row Verification** | **CB Clients tab:** Find by client name. Verify: Spreadsheet ID populated, Client Email="qa@test.com". |
| | **CB Users tab:** Find by email. Verify: Role, Active=TRUE. |
| | **New spreadsheet:** Open by Spreadsheet ID. Verify: Settings tab exists with CLIENT_NAME="Test QA Client". Inventory, Tasks, Repairs, etc. tabs all present. |
| **Side Effects** | Drive: Client folder + subfolders. Caches copied from Master. |
| **Pass Evidence** | CB Clients row. New spreadsheet accessible with all tabs. |

---

## TC-037: Settings Sync

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `#/settings` → Clients → "Sync All" |
| **Row Verification** | Open Demo Company Settings tab. Verify values match CB Clients tab for that client (CLIENT_NAME, CLIENT_EMAIL, DISCOUNT_STORAGE_PCT, etc.). |
| **Pass Evidence** | Client Settings match CB source values. |

---

## TC-038: Row-Click Detail Panels — All Pages

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | Verify single-click opens detail panel on each page: |
| | 1. `#/inventory` → click item row → ItemDetailPanel slides out |
| | 2. `#/tasks` → click task row → TaskDetailPanel |
| | 3. `#/repairs` → click repair row → RepairDetailPanel |
| | 4. `#/will-calls` → click WC row → WillCallDetailPanel |
| | 5. `#/billing` → click billing row → BillingDetailPanel |
| | 6. `#/shipments` → click shipment row → inline expansion |
| | 7. `#/claims` → click claim row → ClaimDetailPanel |
| | Also verify: clicking checkbox column does NOT open panel. Clicking action icons does NOT open panel. |
| **Pass Evidence** | All 7 pages respond to single click. No double-click required. Exclusions work. |

---

## TC-039: Repair Status Filter Chips — All 7 Visible

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | `#/repairs` — verify chips: `Pending Quote`, `Quote Sent`, `Approved`, `Declined`, `In Progress`, `Complete`, `Cancelled`. All visible even with 0 count. |
| **Pass Evidence** | All 7 chips rendered. Exact text matches canonical values. |

---

## TC-040: Will Call Status Filter Chips — All 5 Visible

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | `#/will-calls` — verify chips: `Pending`, `Scheduled`, `Released`, `Partial`, `Cancelled`. All visible even with 0 count. |
| **Pass Evidence** | All 5 chips rendered. Exact text matches. |

---

## TC-041: Dashboard Task Navigation → Detail Panel

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | 1. `/#/` (Dashboard) 2. Click a task row in work queue 3. Verify navigates to `#/tasks` with TaskDetailPanel auto-opened |
| **Pass Evidence** | Tasks page loads. Correct task shown in detail panel. Task ID matches clicked row. |

---

## TC-042: Loading Spinners — No Mock Data Flash

| Field | Value |
|-------|-------|
| **Category** | `E2E` |
| **Action** | Hard-refresh (Ctrl+Shift+R) each page while API configured: Dashboard, Inventory, Tasks, Repairs, WillCalls, Billing. Watch for mock data flash. |
| **Expected UI Result** | Spinner shown during load. Real data appears when ready. NO fake/mock rows visible at any point. |
| **Pass Evidence** | Spinner observed on all 6 pages. Zero mock data flash. |

---

# SECTION B: CONCURRENCY TESTS

## TC-043: Start Task — Concurrent from Two Sessions

| Field | Value |
|-------|-------|
| **Category** | `CONC` |
| **Action** | 1. Open same `Open` task in two browser tabs/windows 2. Click "Start Task" in both tabs simultaneously (or within 2 seconds) |
| **Preconditions** | Task Status=`Open`. |
| **Expected Result** | One succeeds, one either fails gracefully or succeeds idempotently (no duplicate folder/PDF). |
| **Row Verification** | **Tasks tab:** Status=`In Progress`. Started At set. Only ONE task folder in Drive (not two). Only ONE Work Order PDF. |
| **Pass Evidence** | No duplicate side effects. Sheet shows consistent final state. |

---

## TC-044: Start Task — Rapid Double-Click

| Field | Value |
|-------|-------|
| **Category** | `CONC` |
| **Action** | Click "Start Task" button rapidly 3 times within 1 second. |
| **Expected UI Result** | ProcessingOverlay blocks after first click. Subsequent clicks ignored. |
| **Row Verification** | Only 1 folder, 1 PDF, 1 status change. |
| **Pass Evidence** | WriteButton's double-click protection works. Single folder+PDF created. |

---

## TC-045: Complete Task — Concurrent from Two Sessions

| Field | Value |
|-------|-------|
| **Category** | `CONC` |
| **Action** | 1. Open same `In Progress` task in two browser tabs 2. Complete with Result="Pass" in both tabs near-simultaneously |
| **Expected Result** | One succeeds. Second gets idempotency guard (Completion Processed At already set). |
| **Row Verification** | **Tasks tab:** Exactly 1 Completion Processed At timestamp. **Billing_Ledger:** Exactly 1 billing row for this Task ID (not 2). |
| **Pass Evidence** | No duplicate billing. No duplicate completion. |

---

## TC-046: WC Release — Concurrent from Two Sessions

| Field | Value |
|-------|-------|
| **Category** | `CONC` |
| **Action** | 1. Open same `Pending` WC in two browser tabs 2. Release all items in both tabs near-simultaneously |
| **Expected Result** | One succeeds. Second fails (items already released) or succeeds idempotently. |
| **Row Verification** | WC_Items: each item released exactly once. Inventory: each item Status=`Released` exactly once. No duplicate billing. |
| **Pass Evidence** | No duplicates across WC_Items, Inventory, or Billing_Ledger. |

---

## TC-047: Edit Same Record from Two Sessions

| Field | Value |
|-------|-------|
| **Category** | `CONC` |
| **Action** | 1. Open same repair in two browser tabs (both at RepairDetailPanel) 2. Send quote from Tab A ($100) and Tab B ($200) near-simultaneously |
| **Expected Result** | One wins. Final sheet value should be one of the two amounts (not corrupted). |
| **Row Verification** | **Repairs tab:** Quote Amount is either 100 or 200 (not mixed/corrupted). Status=`Quote Sent`. Only 1 Quote Sent At timestamp. |
| **Pass Evidence** | Consistent final state. No corruption. |

---

# SECTION C: FAILURE / STRESS TESTS

## TC-048: Refresh During Write (Navigate Away)

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. Start "Complete Shipment" with valid data 2. While ProcessingOverlay is showing, press F5 (refresh) or navigate to another page |
| **Expected Result** | UI interrupts, but server-side write either completes or fails atomically. |
| **Row Verification** | Check Inventory/Shipments tabs: either all rows written (shipment completed) or none (rolled back). NOT partial (2 of 5 items written). |
| **Pass Evidence** | Sheet is in consistent state — either fully complete or no changes. |

---

## TC-049: Navigation Away During Write

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. Click "Start Task" 2. While ProcessingOverlay is showing, click sidebar nav to go to Inventory |
| **Expected Result** | ProcessingOverlay should block navigation. Or if navigation succeeds, server-side completes independently. |
| **Row Verification** | Task either fully started (folder+PDF+status) or unchanged. Not partial. |
| **Pass Evidence** | Consistent sheet state. |

---

## TC-050: Complete Shipment — Missing Required Fields

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. `#/receiving` 2. Add item with missing Item ID (blank) 3. Click "Complete Shipment" |
| **Expected UI Result** | Validation error before API call. Or API returns field-level error. |
| **Row Verification** | No new rows in Inventory or Shipments. |
| **Pass Evidence** | Error displayed. No sheet changes. |

---

## TC-051: Complete Shipment — Missing Class

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. `#/receiving` 2. Add item with Item ID and Description but no Class 3. Click "Complete Shipment" |
| **Expected UI Result** | Validation error (Class is required). |
| **Pass Evidence** | Error shown. No rows written. |

---

## TC-052: Invalid Task State Transition

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | Attempt to Start Task on a `Completed` or `Cancelled` task (via direct API call or sheet manipulation). |
| **Expected Result** | API rejects (status guard: only `Open` tasks can be started). |
| **Row Verification** | Task row unchanged. No folder/PDF created. |
| **Pass Evidence** | Error response. Sheet unchanged. |

---

## TC-053: Missing Client Settings — PHOTOS_FOLDER_ID

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. Temporarily clear PHOTOS_FOLDER_ID in client Settings tab 2. Attempt Start Task |
| **Expected Result** | API falls back to DRIVE_PARENT_FOLDER_ID. If both missing, returns error. |
| **Row Verification** | If fallback works: folder created under parent folder. If error: task unchanged. |
| **Pass Evidence** | Either graceful fallback or clear error message. |
| **Cleanup** | Restore PHOTOS_FOLDER_ID after test. |

---

## TC-054: Gmail Scope Failure (Email Send Fails)

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | Complete a task or shipment where email sending may fail (if Gmail OAuth stale). |
| **Expected Result** | Data write succeeds even if email fails. UI may show warning about email failure. |
| **Row Verification** | Sheet data (status, billing, etc.) correctly written despite email failure. |
| **Pass Evidence** | Write committed. Email failure is non-blocking. |

---

## TC-055: API Timeout / Network Error

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. Open DevTools → Network → throttle to "Offline" or "Slow 3G" 2. Attempt any write action 3. Observe error handling |
| **Expected UI Result** | Error message displayed. ProcessingOverlay shows error state. No success toast. |
| **Row Verification** | Sheet unchanged (no partial write from disconnected request). |
| **Pass Evidence** | Clean error display. No false success. |

---

## TC-056: Multi-Client Batch Guard

| Field | Value |
|-------|-------|
| **Category** | `FAIL` |
| **Action** | 1. `#/inventory` 2. Remove client filter 3. Select items from 2 different clients 4. Click "Create Will Call" or "Transfer Items" |
| **Expected UI Result** | BatchGuard modal warns about multi-client selection. Action blocked. |
| **Pass Evidence** | Warning shown. Cannot proceed. |

---

# SECTION D: AUTH BOUNDARY TESTS

## TC-057: Client User Isolation

| Field | Value |
|-------|-------|
| **Category** | `AUTH` |
| **Action** | 1. Log in as client user (role=client, clientSheetId=Demo Company) 2. Navigate to Inventory, Tasks, Repairs, WillCalls 3. Verify only Demo Company data shown 4. Check sidebar nav for reduced menu |
| **Expected Result** | No data from other clients visible. No client dropdown (auto-filtered). Reduced sidebar nav (no admin pages). |
| **Pass Evidence** | All pages show only assigned client data. |

---

## TC-058: Invalid clientSheetId

| Field | Value |
|-------|-------|
| **Category** | `AUTH` |
| **Action** | Manually call API with clientSheetId="INVALID_ID_12345". |
| **Expected Result** | Error response — no data returned. No server crash. |
| **Pass Evidence** | API returns error. No data leakage. |

---

## TC-059: Expired Session

| Field | Value |
|-------|-------|
| **Category** | `AUTH` |
| **Action** | 1. Log in 2. Clear Supabase session (clear localStorage or wait for expiry) 3. Navigate to a data page |
| **Expected Result** | Redirected to login page. No data flash before redirect. |
| **Pass Evidence** | Login page shown immediately. No stale data visible. |

---

# SECTION E: SIDE EFFECT VERIFICATION

## TC-060: Email — Receiving Notification

| Field | Value |
|-------|-------|
| **Category** | `FX` |
| **Action** | Complete a shipment (TC-001). Check Gmail Sent folder. |
| **Verify** | 1. Email exists with SHIPMENT_RECEIVED subject 2. To: client email + staff emails (from Settings) 3. Subject contains shipment # 4. Body contains item summary table 5. PDF attachment: "Receiving_" prefix, openable, contains correct items |
| **Pass Evidence** | Email found. PDF opens with matching content. |

---

## TC-061: PDF — Work Order

| Field | Value |
|-------|-------|
| **Category** | `FX` |
| **Action** | Start a task (TC-005). Navigate to task folder in Drive. |
| **Verify** | 1. Folder exists inside shipment folder 2. PDF exists with "Work_Order_" prefix 3. PDF contains: Task ID, Item ID, Description, Location, any notes |
| **Pass Evidence** | PDF exists and content matches task details. |

---

## TC-062: Drive Folder — Shipment

| Field | Value |
|-------|-------|
| **Category** | `FX` |
| **Action** | Complete a shipment. Click Shipment # hyperlink in Inventory tab. |
| **Verify** | 1. Hyperlink opens Google Drive folder 2. Folder name contains Shipment # 3. Folder is inside DRIVE_PARENT_FOLDER_ID or PHOTOS_FOLDER_ID |
| **Pass Evidence** | Folder accessible. Name matches. Location correct. |

---

# SECTION F: EXPORT VERIFICATION

## TC-063: Inventory CSV Export

| Field | Value |
|-------|-------|
| **Category** | `EXP` |
| **Action** | 1. `#/inventory` 2. Click Export/Download button |
| **Verify** | 1. Browser downloads a `.csv` file 2. Open in Excel/text editor 3. First row = column headers matching table columns (Item ID, Vendor, Description, Class, Qty, Location, Sidemark, Status, etc.) 4. Data rows match visible table data 5. Quotes properly escaped (items with commas in description) 6. Row count matches page display |
| **Pass Evidence** | CSV file downloads. Headers correct. Data matches. No encoding issues. |

---

## TC-064: Tasks CSV Export

| Field | Value |
|-------|-------|
| **Category** | `EXP` |
| **Action** | 1. `#/tasks` 2. Click Export button |
| **Verify** | CSV downloads with task columns (Task ID, Type, Status, Item ID, Client, etc.). Data matches filtered view. |
| **Pass Evidence** | File downloads. Content matches. |

---

## TC-065: Repairs CSV Export

| Field | Value |
|-------|-------|
| **Category** | `EXP` |
| **Action** | 1. `#/repairs` 2. Export |
| **Verify** | CSV with repair columns. Status values match canonical strings exactly. |
| **Pass Evidence** | Correct data. Status strings match: `Pending Quote`, `Quote Sent`, etc. |

---

## TC-066: Will Calls CSV Export

| Field | Value |
|-------|-------|
| **Category** | `EXP` |
| **Action** | `#/will-calls` → Export |
| **Verify** | CSV with WC columns. |
| **Pass Evidence** | Correct data. |

---

## TC-067: Billing CSV Export

| Field | Value |
|-------|-------|
| **Category** | `EXP` |
| **Action** | `#/billing` → Export ledger rows |
| **Verify** | CSV with billing columns. Totals spot-checked against Billing_Ledger tab. |
| **Pass Evidence** | Amounts match sheet data. |

---

## TC-068: Unbilled Report CSV Export

| Field | Value |
|-------|-------|
| **Category** | `EXP` |
| **Action** | 1. Generate unbilled report (TC-024) 2. Click CSV export in the unbilled report view |
| **Verify** | CSV file with unbilled rows. Cross-check 3 rows against CB Unbilled_Report tab. |
| **Pass Evidence** | File downloads. Data matches CB tab. |

---

# SECTION G: GLOBAL SEARCH COVERAGE

## TC-069: Global Search — Exact Field Coverage

| Field | Value |
|-------|-------|
| **Category** | `E2E` |

**Searchable entities and fields (from `UniversalSearch.tsx` `buildSearchIndex`):**

| Entity | Searchable Fields (indexed into title/subtitle/id) | Example Search | Expected Result |
|--------|-----------------------------------------------------|----------------|-----------------|
| **Inventory** | `itemId` (id), `itemId + vendor` (title), `description + clientName + sidemark` (subtitle) | Search "sofa" | Items with "sofa" in description |
| **Task** | `taskId` (id), `taskId + type` (title), `description + clientName` (subtitle) | Search "INSP" | Tasks with INSP in taskId or type |
| **Repair** | `repairId` (id), `repairId + status` (title), `description + clientName` (subtitle) | Search repair ID (e.g., "REPAIR-") | Matching repair result |
| **Will Call** | `wcNumber` (id), `wcNumber + pickupParty` (title), `clientName + status + itemCount` (subtitle) | Search "WC-" | Will calls matching |
| **Client** | `clientName` (id + title), `N inventory items` (subtitle) | Search "Demo" | Demo Company client result |

**NOT searchable (known gap):** Shipments, Billing, Claims.

| Action | 1. Press Cmd+K 2. Type "sofa" → verify Items results appear with descriptions 3. Type a known Task ID → verify Task result appears 4. Type a known Repair ID → verify Repair result 5. Type "WC-" → verify Will Call results 6. Type "Demo" → verify Client result 7. Click an Inventory result → verify navigates to `#/inventory` 8. Click a Task result → verify navigates to `#/tasks` with detail panel |
| **Pass Evidence** | All 5 entity types return results when matching data exists. Navigation works for each type. |

---

# SECTION H: CODE PARITY CHECKS (Non-Runtime)

> These are code-review/comparison checks, NOT browser E2E tests. They validate that duplicated logic matches across systems.

## TC-070: Task Board — Shared Handler Version Parity

| Field | Value |
|-------|-------|
| **Category** | `PARITY` |
| **Action** | Code review (not browser): |
| | 1. Read `task board script.txt` — find `SHARED_HANDLER_VERSION` value (expected: "1.1.0") |
| | 2. Compare SH_ functions vs client script originals: |
| | - `SH_writeBillingRow_` vs `writeBillingRow_` in Billing.gs — same columns/fields? |
| | - `SH_sendTemplateEmail_` vs `sendTemplateEmail_` in Emails.gs — same template resolution? |
| | - `SH_generateTaskWorkOrderPdf_` vs task PDF in Tasks.gs — same HTML/doc generation? |
| | - `SH_startTask_` vs `startTask_` in Tasks.gs — same folder creation + hyperlink logic? |
| | 3. Compare status validation values in Task Board vs Code.gs: |
| | - Task: `["Open", "In Progress", "Completed", "Cancelled"]` |
| | - Repair: `["Pending Quote", "Quote Sent", "Approved", "Declined", "In Progress", "Complete", "Cancelled"]` |
| | - Will Call: `["Pending", "Scheduled", "Released", "Partial", "Cancelled"]` |
| **Known Divergence** | Task Board email uses its own fallback path (not shared `sendTemplateEmail_`) — documented in CLAUDE.md Known Issues. |
| **Pass Evidence** | Version matches. Core logic functionally equivalent. Status values identical. |

---

## TC-071: React Status Constants vs Code.gs Validation Lists

| Field | Value |
|-------|-------|
| **Category** | `PARITY` |
| **Action** | Code review: compare `constants.ts` arrays with Code.gs validation lists. |
| | React `TASK_STATUSES` = `['Open', 'In Progress', 'Completed', 'Cancelled']` vs Code.gs `requireValueInList(["Open","In Progress","Completed","Cancelled"])` |
| | React `REPAIR_STATUSES` = `['Pending Quote', 'Quote Sent', 'Approved', 'Declined', 'In Progress', 'Complete', 'Cancelled']` vs Code.gs `Object.values(REPAIR_STATUS)` |
| | React `WILL_CALL_STATUSES` = `['Pending', 'Scheduled', 'Released', 'Partial', 'Cancelled']` vs Code.gs `Object.values(WC_STATUS)` |
| **Pass Evidence** | All arrays match exactly in order and spelling. |

---

# TEST SUMMARY

## Category Counts

| Category | Count | Test IDs |
|----------|-------|----------|
| **E2E Browser** | 42 | TC-001, 003-005, 007-008, 010-018, 020-022, 024-025, 027-042, 069 |
| **Concurrency** | 5 | TC-043 through TC-047 |
| **Failure/Stress** | 9 | TC-002, 048-056 |
| **Idempotency** | 5 | TC-004, 006, 009, 019, 023, 026 |
| **Auth Boundary** | 3 | TC-057, 058, 059 |
| **Side Effect** | 3 | TC-060, 061, 062 |
| **Export** | 6 | TC-063 through TC-068 |
| **Code Parity** | 2 | TC-070, TC-071 |
| **TOTAL** | **71** | |

## Priority: Top 10 Highest-Risk Tests

1. **TC-001** — Complete Shipment (most complex: 4 tabs + email + PDF + Drive + billing + tasks)
2. **TC-025** — Create Invoice (cross-sheet: CB + client + Master RPC + Drive + email)
3. **TC-021** — Generate Storage Charges (bulk write, rate calc, dedup, FREE_STORAGE_DAYS)
4. **TC-029** — Transfer Items (cross-client write: 2 spreadsheets, billing moves)
5. **TC-005** — Start Task (Drive folder + PDF + hyperlink + status change)
6. **TC-008** — Complete Task Fail (auto-creates Repair — cross-tab side effect)
7. **TC-016** — Will Call Full Release (status cascade: WC + items + Inventory + billing)
8. **TC-030** — Create Claim with Linked Item (5-tab write + snapshots + Drive + email)
9. **TC-057** — Client User Isolation (security: data leakage risk)
10. **TC-043** — Concurrent Start Task (race condition: duplicate folders/PDFs)
