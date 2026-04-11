# Phase 7D — Workflow Inventory

**Date:** 2026-03-30
**Built from:** Real code inspection of StrideAPI.gs v24.1.0, 13 client scripts, 11 CB scripts, Task Board v1.5.0, Master Price List v2.2.0, and 76+ React source files.
**Purpose:** Source-of-truth inventory of all workflows, their implementation status across 3 layers (Google Sheets → StrideAPI → React), and side effects.

---

## How to Read This Document

**Implementation Status Legend:**
- **E2E** — End-to-end working (Sheets + API + React)
- **Partial** — Some pieces missing (noted which layer)
- **UI Stub** — Button/page exists in React, no backend wired
- **Backend Only** — Apps Script function exists, no React UI
- **Not Built** — Not implemented anywhere

**Test Account Restriction:** Only use Demo Company (`1bG4Sd7uEkBcTJF513C2GgESskXDyvZomctfmaBVmpZs`) or Justin Demo Company (`1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A`). Brian Paquette Interiors is a LIVE CLIENT — off limits.

---

## WF-01: Dashboard (Work Queue)

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/` (root route) |
| **React Files** | `Dashboard.tsx` |
| **Data Hooks** | `useInventory`, `useTasks`, `useRepairs`, `useWillCalls` |
| **API Endpoints** | `getInventory`, `getTasks`, `getRepairs`, `getWillCalls` |
| **Apps Script** | N/A (read-only aggregation) |
| **Sheets/Tabs** | All client sheets: Inventory, Tasks, Repairs, Will_Calls |
| **Key Columns** | Status, Task ID, Repair ID, WC Number, Item ID |
| **Preconditions** | API configured, at least one client with data |
| **Side Effects** | None (read-only). Task row clicks navigate to `/tasks` with `{ state: { openTaskId } }`. |
| **Success Result** | Unified work queue table showing open Tasks + Repairs + Will Calls with counts. Summary cards show Active Items, Open Tasks across all clients. |
| **Failure/Edge** | No clients → empty state. Loading flash eliminated (spinner shown). Route is `/` not `/dashboard` — navigating to `#/dashboard` shows blank. |
| **Evidence** | Summary cards show non-zero counts. Table rows render with client names. |

**3-Layer Parity:**
- Sheets: Tasks/Repairs/WillCalls tabs exist on every client sheet ✅
- API: All 4 GET endpoints return data with `clientSheetId` ✅
- React: Dashboard merges all 4 hooks, renders unified table ✅

---

## WF-02: Inventory Management

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/inventory` |
| **React Files** | `Inventory.tsx`, `ItemDetailPanel.tsx` |
| **Data Hooks** | `useInventory`, `useClients` |
| **API Endpoints** | `getInventory`, `getClients` |
| **Apps Script** | N/A (read-only display; write actions via other workflows) |
| **Sheets/Tabs** | Client: Inventory |
| **Key Columns** | Item ID, Status (Active/Released/On Hold/Transferred), Vendor, Description, Class, Qty, Location, Sidemark, Room, Receive Date, Release Date |
| **Preconditions** | API configured, items exist in Inventory tab |
| **Side Effects** | None from page itself. Batch actions (Create WC, Transfer, Create Task) trigger their own workflows. |
| **Success Result** | Full inventory table with client dropdown, status filters, column visibility toggles, CSV export. Single-click opens detail panel. |
| **Failure/Edge** | No items → "No items found" empty state with spinner during load. Multi-client batch blocked by BatchGuard. |
| **Evidence** | Table shows real item IDs, descriptions, classes matching Google Sheet data. |

**3-Layer Parity:**
- Sheets: Inventory tab with headers per `Code.gs` CI_SH definition ✅
- API: `handleGetInventory_` reads Inventory tab with header map ✅
- React: `useInventory` hook maps API response to `InventoryItem` type ✅

---

## WF-03: Receiving (Complete Shipment)

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/receiving` → "Complete Shipment" button |
| **React Files** | `Receiving.tsx`, `ProcessingOverlay.tsx` |
| **Data Hooks** | `useLocations`, `useShipments`, `useClients`, `useAutocomplete` |
| **API Endpoints** | POST `completeShipment` |
| **Apps Script (API)** | `handleCompleteShipment_` in StrideAPI.gs |
| **Apps Script (Client)** | `QE_CompleteShipment()` in Shipments.gs (direct sheet version) |
| **Sheets/Tabs** | Client: Dock (form), Inventory, Shipments, Tasks, Billing_Ledger; Master: RPC for shipment # |
| **Key Columns** | Item ID, Description, Class, Qty, Location, Sidemark, Room, Status, Shipment #, Receive Date |
| **Preconditions** | Client selected, at least 1 item row with Item ID + Description + Class filled. No duplicate Item IDs in Active inventory. |
| **Side Effects** | |
| | **Email:** SHIPMENT_RECEIVED template → client + staff |
| | **PDF:** DOC_RECEIVING document generated and attached |
| | **Drive:** Shipment folder created in DRIVE_PARENT_FOLDER_ID/PHOTOS_FOLDER_ID |
| | **Status:** Items created as Status=Active in Inventory |
| | **Billing:** RCVG rows written to Billing_Ledger if ENABLE_RECEIVING_BILLING=TRUE |
| | **Tasks:** INSP/ASM tasks auto-created if needsInspection/needsAssembly checked |
| | **Autocomplete:** New Sidemark/Vendor/Description values logged to Autocomplete_DB |
| **Success Result** | API returns `{ shipmentNo, itemCount, tasksCreated, billingRows, warnings }`. Items appear in Inventory with correct Shipment # hyperlink. |
| **Failure/Edge** | Duplicate Item IDs blocked. Missing required fields (Item ID, Description, Class) → validation error. RPC failure for shipment # → fallback generation. |
| **Evidence** | New rows in Inventory tab, Shipments tab, Tasks tab (if inspection checked), Billing_Ledger (if RCVG enabled). Drive folder exists. |

**3-Layer Parity:**
- Sheets: `QE_CompleteShipment()` in Shipments.gs does full flow ✅
- API: `handleCompleteShipment_` mirrors Shipments.gs logic with email+PDF (v24.0.0) ✅
- React: Receiving.tsx form → POST → ProcessingOverlay → result card ✅

---

## WF-04: Shipments (Read-Only History)

| Field | Value |
|-------|-------|
| **Status** | E2E (read-only) |
| **UI Entry** | `/#/shipments` |
| **React Files** | `Shipments.tsx`, `ShipmentDetailPanel.tsx` |
| **Data Hooks** | `useShipments` |
| **API Endpoints** | `getShipments` |
| **Apps Script (API)** | `handleGetShipments_` reads Shipments + Inventory tabs |
| **Sheets/Tabs** | Client: Shipments, Inventory (for item grouping) |
| **Key Columns** | Shipment #, Client, Status, Carrier, Tracking, Received Date, Item Count |
| **Preconditions** | At least one shipment completed |
| **Side Effects** | None (read-only) |
| **Success Result** | Table shows shipment history. Clicking a row expands to show items received in that shipment. |
| **Failure/Edge** | Very large shipments (100+ items) may render slowly. |
| **Evidence** | Shipment rows match Shipments tab data. Item list matches Inventory rows with same Shipment #. |

---

## WF-05: Task Creation (Batch)

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/inventory` → select rows → "Create Task" floating action bar → `CreateTaskModal.tsx` |
| **React Files** | `Inventory.tsx`, `CreateTaskModal.tsx` |
| **API Endpoints** | POST `batchCreateTasks` |
| **Apps Script (API)** | `handleBatchCreateTasks_` in StrideAPI.gs |
| **Apps Script (Client)** | `StrideCreateInspectionTasks()`, `StrideCreateTasks()`, `batchCreateTasks_()` in Tasks.gs |
| **Sheets/Tabs** | Client: Tasks, Settings (for Price_Cache lookup) |
| **Key Columns** | Task ID, Type (Svc Code), Status=Open, Item ID, Description, Class |
| **Preconditions** | Items selected in Inventory. Service code(s) chosen in modal. |
| **Side Effects** | |
| | **Status:** Task rows created with Status=Open (lightweight — no Drive/PDF yet) |
| | **Idempotency:** Skips if open task with same Svc Code + Item ID already exists |
| **Success Result** | API returns `{ tasksCreated }`. New rows appear in Tasks tab. |
| **Failure/Edge** | Duplicate task (same svc code + item) silently skipped. No items selected → validation error. |
| **Evidence** | New rows in Tasks tab with auto-generated Task IDs (e.g., INSP-61818-1). |

---

## WF-06: Start Task (Deferred Heavy Work)

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/tasks` → click task row → TaskDetailPanel → "Start Task" button |
| **React Files** | `Tasks.tsx`, `TaskDetailPanel.tsx`, `ProcessingOverlay.tsx` |
| **API Endpoints** | POST `startTask` |
| **Apps Script (API)** | `handleStartTask_` in StrideAPI.gs |
| **Apps Script (Client)** | `startTask_()` in Tasks.gs (checkbox-triggered via onTaskEdit_) |
| **Sheets/Tabs** | Client: Tasks, Inventory, Shipments, Settings |
| **Key Columns** | Task ID (hyperlinked after start), Start Task (checkbox), Started At, Status, Assigned To |
| **Preconditions** | Task exists with Status=Open. Shipment folder must exist (falls back to PHOTOS_FOLDER_ID / DRIVE_PARENT_FOLDER_ID). |
| **Side Effects** | |
| | **Drive:** Task subfolder created inside shipment folder (e.g., `SHP-000067/INSP-61818-1/`) |
| | **PDF:** Work Order PDF generated (DOC_TASK_WORK_ORDER template) |
| | **Hyperlink:** Task ID cell gets hyperlink to task folder |
| | **Status:** Open → In Progress (v24.1.0) |
| | **Field:** Started At timestamp, Assigned To (if provided) |
| **Success Result** | Task ID becomes hyperlinked. Status shows "In Progress". Folder + PDF visible in Drive. |
| **Failure/Edge** | Already started (idempotency guard). No shipment folder → falls back to photos/parent folder. Missing PHOTOS_FOLDER_ID → error. |
| **Evidence** | Task ID cell is hyperlinked in Tasks tab. Started At has timestamp. Task folder exists in Drive with Work Order PDF. |

---

## WF-07: Complete Task

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/tasks` → TaskDetailPanel → "Complete Task" (Pass/Fail dropdown) |
| **React Files** | `TaskDetailPanel.tsx`, `ProcessingOverlay.tsx` |
| **API Endpoints** | POST `completeTask` |
| **Apps Script (API)** | `handleCompleteTask_` in StrideAPI.gs |
| **Apps Script (Client)** | `onTaskEdit_` trigger in Triggers.gs → completion handler |
| **Sheets/Tabs** | Client: Tasks, Billing_Ledger, Repairs (if Fail + inspection) |
| **Key Columns** | Status=Completed, Result (Pass/Fail), Task Notes, Completion Processed At |
| **Preconditions** | Task Status is Open or In Progress. |
| **Side Effects** | |
| | **Email:** INSP_EMAIL or TASK_COMPLETE template with existing Work Order PDF attached (v24.0.0) |
| | **Billing:** Billing row created (svc code from task type) if billIfPass/billIfFail is TRUE |
| | **Repair:** If inspection task + Result=Fail → auto-creates Repair row (Pending Quote) |
| | **Status:** Task → Completed |
| | **Idempotency:** `Completion Processed At` timestamp prevents re-processing |
| **Success Result** | Task status=Completed. Billing row appears (if applicable). Repair row created on Fail. |
| **Failure/Edge** | Already completed (idempotency). Gmail scope error → data write succeeds, email fails. |
| **Evidence** | Tasks tab shows Status=Completed + Result. Billing_Ledger has matching row. |

---

## WF-08: Task Status Lifecycle

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **Statuses** | Open → In Progress → Completed / Cancelled |
| **Open** | Created by batch task creation (WF-05) or shipment completion (WF-03) |
| **In Progress** | Set by Start Task (WF-06) — handleStartTask_ sets status (v24.1.0) |
| **Completed** | Set by Complete Task (WF-07) — Pass or Fail result |
| **Cancelled** | Manual status change (sheets only, no React UI for cancel yet) |
| **Validation Lists** | Code.gs v4.1.0 defines: Open, In Progress, Completed, Cancelled |
| **Default Filter** | Sheets: hides Completed + Cancelled. Task Board: shows Open + In Progress. React: all chips visible. |

---

## WF-09: Repair — Send Quote

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/repairs` → RepairDetailPanel → "Send Quote" (enter amount) |
| **React Files** | `Repairs.tsx`, `RepairDetailPanel.tsx` |
| **API Endpoints** | POST `sendRepairQuote` |
| **Apps Script (API)** | `handleSendRepairQuote_` + `api_sendTemplateEmail_` |
| **Apps Script (Client)** | `onRepairEdit_` trigger (Quote Amount entered → Status=Quote Sent) |
| **Sheets/Tabs** | Client: Repairs |
| **Key Columns** | Quote Amount, Status=Quote Sent, Quote Sent At |
| **Preconditions** | Repair Status=Pending Quote. Quote amount > 0. |
| **Side Effects** | |
| | **Email:** REPAIR_QUOTE_SENT template → client |
| | **Status:** Pending Quote → Quote Sent |
| | **Idempotency:** Quote Sent At timestamp |
| **Success Result** | Repair status=Quote Sent. Email sent to client with quote amount. |
| **Evidence** | Repairs tab shows Status=Quote Sent + Quote Amount. |

---

## WF-10: Repair — Approve/Decline

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/repairs` → RepairDetailPanel → "Approve" or "Decline" buttons |
| **API Endpoints** | POST `respondToRepairQuote` |
| **Apps Script (API)** | `handleRespondToRepairQuote_` |
| **Apps Script (Client)** | `onRepairEdit_` trigger (Approved checkbox → Status=Approved/Declined) |
| **Sheets/Tabs** | Client: Repairs |
| **Key Columns** | Status (Approved/Declined), Approval/Decline Processed At |
| **Preconditions** | Repair Status=Quote Sent. |
| **Side Effects** | |
| | **Email:** REPAIR_APPROVED or REPAIR_DECLINED template |
| | **PDF:** On Approve: DOC_REPAIR_WORK_ORDER generated, repair folder created (v24.0.0) |
| | **Drive:** Repair folder created (e.g., `REPAIR-12345/`) on Approve |
| | **Status:** Quote Sent → Approved or Declined |
| **Success Result** | Status updated. On Approve: work order PDF in Drive folder. |
| **Evidence** | Repairs tab shows new Status + timestamp. Drive folder + PDF (Approve only). |

---

## WF-11: Repair — Complete

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/repairs` → RepairDetailPanel → "Complete Repair" (Pass/Fail + final amount) |
| **API Endpoints** | POST `completeRepair` |
| **Apps Script (API)** | `handleCompleteRepair_` |
| **Apps Script (Client)** | `onRepairEdit_` trigger (Repair Result entered → billing + email) |
| **Sheets/Tabs** | Client: Repairs, Billing_Ledger |
| **Key Columns** | Status=Complete, Repair Result, Final Amount, Completion Processed At |
| **Preconditions** | Repair Status=Approved (or In Progress). |
| **Side Effects** | |
| | **Email:** REPAIR_COMPLETE (Pass/Fail variant) |
| | **Billing:** REPAIR service code row written to Billing_Ledger |
| | **Status:** Approved/In Progress → Complete |
| | **Idempotency:** Completion Processed At |
| **Success Result** | Repair complete with billing row. |
| **Evidence** | Repairs tab: Status=Complete + Final Amount. Billing_Ledger: REPAIR row with matching Repair ID. |

---

## WF-12: Will Call — Create

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/inventory` → select rows → "Create Will Call" → `CreateWillCallModal.tsx` |
| **React Files** | `CreateWillCallModal.tsx` |
| **API Endpoints** | POST `createWillCall` |
| **Apps Script (API)** | `handleCreateWillCall_` |
| **Apps Script (Client)** | `StrideCreateWillCall()` in WillCalls.gs |
| **Sheets/Tabs** | Client: Will_Calls, WC_Items, Inventory, Billing_Ledger |
| **Key Columns** | WC Number (auto: WC-MMddyyHHmmss), Status=Pending, Pickup Party, Items |
| **Preconditions** | Selected items must be Active (not Released). Client selected. |
| **Side Effects** | |
| | **Email:** WILL_CALL_CREATED template |
| | **PDF:** DOC_WILL_CALL_RELEASE generated (v24.0.0) |
| | **Drive:** WC folder created |
| | **Billing:** WC service code rows in Billing_Ledger |
| | **Rows:** Will_Calls row + WC_Items rows (one per item) |
| **Success Result** | WC Number generated. Items linked. PDF in Drive. Email sent. |
| **Evidence** | Will_Calls tab: new row. WC_Items tab: item rows. Billing_Ledger: WC rows. |

---

## WF-13: Will Call — Release (Full + Partial)

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/will-calls` → WillCallDetailPanel → "Release Items" (checkbox selector) |
| **React Files** | `WillCallDetailPanel.tsx` |
| **API Endpoints** | POST `processWcRelease` |
| **Apps Script (API)** | `handleProcessWcRelease_` |
| **Apps Script (Client)** | `StrideProcessRelease()` in WillCalls.gs |
| **Sheets/Tabs** | Client: Will_Calls, WC_Items, Inventory, Billing_Ledger |
| **Key Columns** | WC Status (Released/Partial), WC_Items Status, Inventory Status=Released |
| **Preconditions** | WC Status=Pending or Scheduled. At least one unreleased item selected. |
| **Side Effects** | |
| | **Email:** WILL_CALL_RELEASED template |
| | **PDF:** DOC_WILL_CALL_RELEASE regenerated (v24.0.0) |
| | **Status:** Full release: WC→Released, all items Released. Partial: WC→Partial, selected items Released, remainder stays. |
| | **Billing:** WC billing rows for released items |
| | **Inventory:** Released items get Status=Released + Release Date |
| **Success Result** | Selected items released. WC status updated. |
| **Evidence** | WC_Items: released items show Status=Released. Inventory: items Status=Released. |

---

## WF-14: Will Call — Cancel

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/will-calls` → WillCallDetailPanel → "Cancel WC" button |
| **React Files** | `WillCallDetailPanel.tsx` |
| **API Endpoints** | POST `cancelWillCall` |
| **Apps Script (API)** | `handleCancelWillCall_` (StrideAPI.gs v23.2.0) |
| **Apps Script (Client)** | Status-based handling in WillCalls.gs |
| **Sheets/Tabs** | Client: Will_Calls, WC_Items |
| **Key Columns** | Status=Cancelled |
| **Preconditions** | WC Status is not already Released or Cancelled. |
| **Side Effects** | |
| | **Email:** WILL_CALL_CANCELLED template |
| | **Status:** WC + all WC_Items → Cancelled |
| **Success Result** | WC cancelled. Items remain in inventory (not released). |
| **Evidence** | Will_Calls tab: Status=Cancelled. WC_Items: all Cancelled. |

---

## WF-15: Will Call — Print Release Doc

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/will-calls` → WillCallDetailPanel → "Print Release Doc" button |
| **React Files** | `WillCallDetailPanel.tsx` |
| **API Endpoints** | GET `getWcDocUrl` |
| **Apps Script (API)** | `handleGetWcDocUrl_` (StrideAPI.gs v23.3.0) |
| **Sheets/Tabs** | Client: Will_Calls (WC Number RichTextValue for folder URL) |
| **Preconditions** | WC folder exists with PDF inside. |
| **Side Effects** | None (read-only — opens PDF in new tab) |
| **Success Result** | PDF opens in new browser tab. |
| **Failure/Edge** | No folder URL → error. No PDF in folder → "PDF not found" error. |

---

## WF-16: Storage Charge Generation

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/billing` → "Generate Storage Charges" modal |
| **React Files** | `Billing.tsx` |
| **API Endpoints** | POST `generateStorageCharges` |
| **Apps Script (API)** | `handleGenerateStorageCharges_` |
| **Apps Script (CB)** | `StrideGenerateStorageCharges()` in Code.gs.js |
| **Sheets/Tabs** | All client: Inventory, Billing_Ledger, Price_Cache, Class_Cache; CB: Clients |
| **Key Columns** | Svc Code=STOR, Rate (base × class cubic volume × (1-discount%)), Task ID (idempotency key) |
| **Preconditions** | Staff/admin role. Active inventory items exist. |
| **Side Effects** | |
| | **Billing:** STOR rows written per active item to each client's Billing_Ledger |
| | **Dedup:** Existing unbilled STOR rows for same period deleted + recreated. Only Invoiced/Billed/Void rows skipped. |
| | **Rate Calc:** Base rate per cuFt × Class cubic volume (XS=10, S=25, M=50, L=75, XL=110) × (1 + discount_pct/100) |
| | **FREE_STORAGE_DAYS:** Items within free period excluded |
| **Success Result** | Billing rows created for all active items across all clients. |
| **Failure/Edge** | Missing Price_Cache → lookup error. Missing class → default rate. |
| **Evidence** | Billing_Ledger: STOR rows with correct rates. Task ID = `STOR-[ItemID]-[startDate]-[endDate]`. |

---

## WF-17: Unbilled Report Generation

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/billing` → "Generate Unbilled Report" modal |
| **React Files** | `Billing.tsx` |
| **API Endpoints** | POST `generateUnbilledReport`, GET `getUnbilledReport` |
| **Apps Script (API)** | `handleGenerateUnbilledReport_`, `handleGetUnbilledReport_` |
| **Apps Script (CB)** | `CB13_generateUnbilledReport()` in CB13 Unbilled Reports.js |
| **Sheets/Tabs** | All client: Billing_Ledger; CB: Unbilled_Report, Consolidated_Ledger |
| **Key Columns** | Status=Unbilled rows pulled from all clients |
| **Preconditions** | Staff role. Unbilled billing rows exist. |
| **Side Effects** | |
| | **CB Write:** Unbilled_Report tab cleared and rebuilt with all unbilled rows |
| **Success Result** | Report generated with unbilled totals. React shows inline table + CSV export. |
| **Evidence** | Unbilled_Report tab populated on CB sheet. |

---

## WF-18: Invoice Creation

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/billing` → "Create Invoices" modal (groups by client) |
| **React Files** | `Billing.tsx` |
| **API Endpoints** | POST `createInvoice` |
| **Apps Script (API)** | `handleCreateInvoice_` |
| **Apps Script (CB)** | `CB13_commitInvoice()` in Invoice Commit.js |
| **Sheets/Tabs** | CB: Consolidated_Ledger, Settings; Client: Billing_Ledger; Master: Invoice_Templates; Drive: Invoice folder |
| **Key Columns** | Status (Unbilled→Invoiced), Invoice #, Invoice Date, Invoice URL |
| **Preconditions** | Staff role. Unbilled rows selected/provided. |
| **Side Effects** | |
| | **PDF:** Google Doc template → PDF generated in client invoice folder + Master accounting folder |
| | **Email:** Invoice email with PDF attachment |
| | **Status:** Billing_Ledger rows → Invoiced with Invoice # + URL |
| | **CB:** Rows written to Consolidated_Ledger |
| | **Counter:** Invoice # from Master RPC (atomic via LockService) |
| | **Idempotency:** idempotencyKey on request |
| **Success Result** | Invoice PDF created and emailed. Ledger rows marked Invoiced. |
| **Evidence** | Client Billing_Ledger: rows have Invoice #, Status=Invoiced, Invoice URL. PDF in Drive. |

---

## WF-19: Resend Invoice Email

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/billing` → select Invoiced row → floating bar "Re-send Email" |
| **React Files** | `Billing.tsx` |
| **API Endpoints** | POST `resendInvoiceEmail` |
| **Apps Script (API)** | `handleResendInvoiceEmail_` |
| **Sheets/Tabs** | CB: Consolidated_Ledger; Client: Billing_Ledger |
| **Preconditions** | Row has Status=Invoiced with Invoice URL (PDF in Drive). |
| **Side Effects** | Email re-sent with existing PDF. |
| **Success Result** | Email delivered. |

---

## WF-20: Transfer Items

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/inventory` → select rows → "Transfer Items" → `TransferItemsModal.tsx` |
| **React Files** | `Inventory.tsx`, `TransferItemsModal.tsx` |
| **API Endpoints** | POST `transferItems` |
| **Apps Script (API)** | `handleTransferItems_` |
| **Apps Script (Client)** | `StrideAdminTransferItems()` in Transfer.gs |
| **Sheets/Tabs** | Source client: Inventory, Billing_Ledger, Tasks, Repairs; Destination client: Inventory, Billing_Ledger |
| **Key Columns** | Status=Transferred (source), Status=Active (destination) |
| **Preconditions** | Items selected from single client. Destination client chosen. |
| **Side Effects** | |
| | **Email:** TRANSFER_RECEIVED template (email only, no attachment) |
| | **Source:** Items → Status=Transferred. Unbilled billing rows voided. Active tasks/repairs voided. |
| | **Destination:** Items recreated as Active. Unbilled billing rows copied. |
| **Success Result** | Items moved to destination client sheet. |
| **Evidence** | Source Inventory: Status=Transferred. Destination Inventory: new rows with same Item IDs. |

---

## WF-21: Claims — Full Lifecycle

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/claims` → "New Claim" → `CreateClaimModal.tsx` → `ClaimDetailPanel.tsx` |
| **React Files** | `Claims.tsx`, `ClaimDetailPanel.tsx`, `CreateClaimModal.tsx` |
| **Data Hooks** | `useClaims` |
| **API Endpoints** | `getClaims`, `getClaimDetail`, POST: `createClaim`, `addClaimItems`, `addClaimNote`, `requestMoreInfo`, `sendClaimDenial`, `generateClaimSettlement`, `uploadSignedSettlement`, `closeClaim`, `voidClaim`, `reopenClaim` |
| **Apps Script (API)** | 12 handlers in StrideAPI.gs (v22.0.0+) |
| **Sheets/Tabs** | CB: Claims, Claim_Items, Claim_History, Claim_Files, Claims_Config |
| **Guard** | Admin-only (`withAdminGuard_`) |
| **Preconditions** | Admin role. Claims schema set up via CB menu. |
| **Side Effects** | |
| | **Drive:** Claim folder created on createClaim |
| | **Email:** claim-opened, claim-need-info, claim-denied, claim-settlement (5 templates) |
| | **PDF:** Settlement document (Doc template → PDF, versioned) |
| | **History:** Every action logged to Claim_History tab |
| | **Status Flow:** Under Review → Waiting on Info → Settlement Sent → Approved/Closed/Void |
| **Success Result** | Full lifecycle from creation through settlement to closure. |
| **Evidence** | Claims tab: new row with CLM# number. History tab: timestamped events. Files tab: settlement versions. |

---

## WF-22: Client Onboarding

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/settings` → Clients tab → "Onboard Client" → `OnboardClientModal.tsx` |
| **React Files** | `Settings.tsx`, `OnboardClientModal.tsx` |
| **API Endpoints** | POST `onboardClient`, `updateClient`, `syncSettings` |
| **Apps Script (API)** | `handleOnboardClient_`, `handleUpdateClient_`, `handleSyncSettings_` |
| **Apps Script (CB)** | `Client_Onboarding.js` |
| **Sheets/Tabs** | CB: Clients, Settings; New client: all tabs from template |
| **Preconditions** | Staff role. CLIENT_INVENTORY_TEMPLATE_ID and CLIENT_PARENT_FOLDER_ID set in CB Settings. |
| **Side Effects** | |
| | **Drive:** Client folder + subfolders created |
| | **Spreadsheet:** Template spreadsheet cloned for new client |
| | **CB:** Row added to Clients tab |
| | **Cache:** Price_Cache, Class_Cache, Email_Template_Cache copied from Master |
| | **User:** Auto-creates/upserts Users row with Active=TRUE (v19.0.0) |
| **Success Result** | New client spreadsheet created with all tabs. CB row populated. |
| **Evidence** | CB Clients tab: new row with spreadsheetId. New spreadsheet accessible via Drive. |

---

## WF-23: Settings Sync

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/settings` → Clients tab → "Sync All" or per-client sync |
| **API Endpoints** | POST `syncSettings` |
| **Apps Script (API)** | `handleSyncSettings_` |
| **Sheets/Tabs** | CB: Clients, Settings → All client: Settings |
| **Preconditions** | Staff role. |
| **Side Effects** | CB Clients tab values written to each client's Settings tab (one-way sync). |
| **Success Result** | All client Settings tabs updated. |

---

## WF-24: User Management

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/settings` → Users tab |
| **React Files** | `Settings.tsx` |
| **Data Hooks** | `useUsers` |
| **API Endpoints** | `getUsers`, POST `createUser`, `updateUser` |
| **Apps Script (API)** | `handleGetUsers_`, `handleCreateUser_`, `handleUpdateUser_` |
| **Sheets/Tabs** | CB: Users |
| **Guard** | Staff/Admin |
| **Side Effects** | Creates/updates user rows in CB Users tab. |
| **Success Result** | User created or toggled active/inactive. |

---

## WF-25: Global Search

| Field | Value |
|-------|-------|
| **Status** | Partial |
| **UI Entry** | Cmd+K or search icon → `UniversalSearch.tsx` |
| **React Files** | `UniversalSearch.tsx` |
| **Data Hooks** | `useInventory`, `useTasks`, `useRepairs`, `useWillCalls` |
| **API Endpoints** | All GET endpoints (client-side filtering) |
| **Search Scope** | Items (itemId, vendor, description, sidemark), Tasks (taskId, itemId, type), Repairs (repairId, itemId, description), Will Calls (wcNumber, pickupParty) |
| **Missing** | Shipments, Billing, Claims entities not searched. Missing fields per entity. |
| **Side Effects** | None (read-only). Selecting result navigates to relevant page + opens detail panel. |

**Doc Staleness:** Roadmap lists "Global search expansion" as incomplete — matches actual code.

---

## WF-26: Import Inventory

| Field | Value |
|-------|-------|
| **Status** | Backend Only |
| **UI Entry** | Google Sheets menu only: Stride Admin → Import Inventory |
| **Apps Script (Client)** | `StrideImportInventory()` in Import.gs |
| **React** | Not exposed in React app |
| **Sheets/Tabs** | Client: Inventory, Autocomplete_DB |
| **Side Effects** | Appends imported rows to Inventory. Syncs autocomplete. |
| **Notes** | IMP-MMDDYYHHMMSS format. Fuzzy column matching. Photo URLs hyperlinked on Shipment #. |

---

## WF-27: Set Release Date

| Field | Value |
|-------|-------|
| **Status** | Backend Only |
| **UI Entry** | Google Sheets menu: Stride Warehouse → Set Release Date |
| **Apps Script (Client)** | `StrideSetReleaseDate()` in Code.gs (calendar picker dialog) |
| **React** | Not exposed in React app |
| **Sheets/Tabs** | Client: Inventory |
| **Side Effects** | Sets Release Date + Status=Released on selected rows. |

---

## WF-28: View Item History

| Field | Value |
|-------|-------|
| **Status** | Backend Only |
| **UI Entry** | Google Sheets menu: Stride Client → View Item History |
| **Apps Script (Client)** | `StrideViewItemHistory()` in Utils.gs |
| **React** | Not exposed in React app |
| **Side Effects** | Multi-sheet search by Item ID (Tasks, Repairs, Billing, Will Calls). |

---

## WF-29: Refresh Caches

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/settings` → Maintenance tab → "Refresh Caches" |
| **React Files** | `Settings.tsx` |
| **API Endpoints** | POST `refreshCaches` |
| **Apps Script (API)** | `handleRefreshCaches_` |
| **Terminal** | `npm run refresh-caches` |
| **Sheets/Tabs** | Master: Price_List, Class_Map, Email_Templates; CB: Locations; All clients: Price_Cache, Class_Cache, Email_Template_Cache, Location_Cache |
| **Side Effects** | Overwrites cache tabs on all client sheets with current Master data. |

---

## WF-30: Task Board — Two-Way Sync

| Field | Value |
|-------|-------|
| **Status** | Backend Only (no React UI — operates via Google Sheets) |
| **UI Entry** | Task Board spreadsheet → menu or auto-refresh trigger |
| **Apps Script** | `task board script.txt` v1.5.0 |
| **Sheets/Tabs** | Task Board: Open_Tasks, Open_Repairs, Open_Will_Calls, Sync_Log, Settings; All client sheets: Tasks, Repairs, Will_Calls, Inventory, Price_Cache, Email_Templates, Billing_Ledger |
| **Shared Handlers** | SHARED_HANDLER_VERSION = "1.1.0", 30+ SH_ prefixed functions |
| **Key Feature** | Two-way sync: edits on Task Board push back to client sheets |
| **Editable Fields (Tasks)** | Result, Task Notes, Item Notes, Assigned To, Location, Start Task |
| **Editable Fields (Repairs)** | Quote Amount, Approved, Parts Cost, Labor Hours, Repair Vendor, Item Notes, Final Amount, Repair Result, Location, Repair Notes, Task Notes, Scheduled Date, Start Date |
| **Editable Fields (WCs)** | Estimated Pickup Date, Pickup Party, Pickup Phone, Requested By, Notes, COD, COD Amount |
| **System Columns** | __Client Spreadsheet ID, __Source Sheet, __Last Sync, __Sync Token, __Sync Status (hidden) |
| **Side Effects** | Writes back to client sheets. Creates billing rows. Generates work order PDFs. Sends templated emails. |
| **Parity Notes** | SH_ functions duplicate client script logic. Task Board bypasses StrideAPI entirely (direct sheet access). Email fallback path differs from client `sendTemplateEmail_`. |

**Task Board vs Client Script Parity Check:**
- `SH_writeBillingRow_` mirrors `writeBillingRow_` in Billing.gs
- `SH_sendTemplateEmail_` mirrors `sendTemplateEmail_` in Emails.gs (but has own fallback path)
- `SH_generateRepairWorkOrderPdf_` mirrors repair PDF generation in Repairs.gs
- `SH_generateTaskWorkOrderPdf_` mirrors task PDF generation in Tasks.gs
- `SH_startTask_` mirrors `startTask_` in Tasks.gs (folder + PDF + hyperlink)
- **Divergence:** Task Board email uses its own fallback if template cache is empty (known issue in CLAUDE.md)
- **Status Values Match:** Open, In Progress, Completed, Cancelled for tasks; all 7 repair statuses; all 5 WC statuses

---

## WF-31: QB Export

| Field | Value |
|-------|-------|
| **Status** | Partial (CB backend + React UI stub) |
| **UI Entry** | CB: Stride Billing → Export Highlighted to QuickBooks (IIF). React: Payments → IIF Import tab (upload/parse only) |
| **Apps Script (CB)** | `CB13_qbExportFromUnbilledSelection()` in QB_Export.js |
| **React** | IIF Import tab exists with drag-drop + parse preview, but no write endpoint |
| **Sheets/Tabs** | CB: Unbilled_Report, QB_Invoice_Export, QB_Service_Mapping, Clients |
| **Side Effects** | Generates IIF file in Drive. Applies client discounts. |

---

## WF-32: Payments / Stax

| Field | Value |
|-------|-------|
| **Status** | UI Stub (all write operations BLOCKED) |
| **UI Entry** | `/#/payments` — 8 tabs built |
| **React Files** | `Payments.tsx`, `PaymentDetailPanel.tsx`, `CustomerVerificationPanel.tsx`, `PreChargeValidationModal.tsx` |
| **Backend** | `StaxAutoPay.gs` exists but write endpoints not built in StrideAPI |
| **Note** | Per Build Status: "Current Payments UI NOT parity-correct — write endpoints BLOCKED" |

---

## WF-33: Autocomplete

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/receiving` → Sidemark, Vendor, Description fields |
| **React Files** | `Receiving.tsx`, `AutocompleteInput.tsx` |
| **Data Hooks** | `useAutocomplete` |
| **API Endpoints** | GET `getAutocomplete` |
| **Apps Script (API)** | `handleGetAutocomplete_` |
| **Apps Script (Client)** | `AutocompleteDB.gs` — per-client Autocomplete_DB tab |
| **Sheets/Tabs** | Client: Autocomplete_DB (Field, Value columns) |
| **Fields** | Sidemark, Vendor, Description |
| **Side Effects** | Read-only from React. New values added during shipment completion (server-side). |

---

## WF-34: Master Price List RPC

| Field | Value |
|-------|-------|
| **Status** | E2E (backend) |
| **UI Entry** | Not directly — called internally by other workflows |
| **Apps Script** | `doPost(e)` in Master Price list script.txt |
| **Actions** | `getNextShipmentId` → SHP-000001 format (atomic LockService), `getNextInvoiceId` → INV-000001 format |
| **Used By** | completeShipment (shipment #), createInvoice (invoice #) |
| **Side Effects** | Increments GLOBAL_SHIPMENT_COUNTER / GLOBAL_INVOICE_COUNTER in Settings tab. |

---

## WF-35: Remote Admin (Terminal Commands)

| Field | Value |
|-------|-------|
| **Status** | E2E (terminal only, not React) |
| **Entry** | Terminal commands from `stride-client-inventory/` folder |
| **Commands** | `npm run health-check`, `update-headers`, `install-triggers`, `refresh-caches`, `rollout`, `push-cb`, `push-master`, `push-taskboard`, `push-api`, `push-stax` |
| **Apps Script** | `RemoteAdmin.gs` doPost → 6 actions via Web App HTTP POST |
| **Auth** | Shared token: `REMOTE_EXEC_TOKEN_` |
| **Async Pattern** | Some actions use time-based triggers for execution (~30s delay) |
| **Side Effects** | Varies by command: pushes code, refreshes caches, installs triggers, runs health checks. |

---

## WF-36: Email Template Testing

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/settings` → Email Templates tab → "Test Send" button; Claims Emails tab → "Test Send" |
| **API Endpoints** | POST `testSendClientTemplates`, `testSendClaimEmails` |
| **Apps Script (API)** | `handleTestSendClientTemplates_`, `handleTestSendClaimEmails_` |
| **Side Effects** | Sends test email to specified address. |

---

## WF-37: CSV Export

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | Export button on Dashboard, Inventory, Tasks, Repairs, Will Calls, Billing, Claims, Shipments pages |
| **React** | Client-side CSV generation via `Blob` + download link |
| **Format** | CSV with proper quote escaping |
| **No PDF/Excel export** | Only CSV currently available |

---

## WF-38: Authentication (Supabase)

| Field | Value |
|-------|-------|
| **Status** | E2E |
| **UI Entry** | `/#/login` |
| **React Files** | `Login.tsx`, `SetNewPassword.tsx`, `AccessDenied.tsx`, `LoadingScreen.tsx`, `AuthContext.tsx` |
| **Backend** | Supabase Auth (email + password only, no magic links, no Google OAuth) |
| **API Integration** | `getUserByEmail` stamps Last Login. `callerEmail` sent on every API request. |
| **Role-Based** | Client users see reduced nav. Admin-only pages gated. |
| **Double-Gate** | Supabase auth → CB Users tab role check |
| **Password Reset** | "Forgot Password" on login → recovery email → SetNewPassword component |
| **Session** | `recoveryRef` prevents auto-login overriding recovery mode |

---

## Summary Statistics

| Category | Count |
|----------|-------|
| **Total Workflows** | 38 |
| **E2E (fully working)** | 28 |
| **Partial** | 2 (Global Search, QB Export) |
| **Backend Only (no React UI)** | 5 (Import, Set Release Date, View Item History, Task Board, Remote Admin) |
| **UI Stub (no backend)** | 1 (Payments/Stax) |
| **React Pages** | 12 |
| **StrideAPI.gs Handlers** | 61 (42 GET + 19 POST) |
| **Client Script Files** | 13 |
| **CB Script Files** | 11 |

---

## Doc Staleness Flags

1. **CLAUDE.md Known Issues** — `populateUnbilledReport_()` and `CB13_addBillingStatusValidation()` using old header names listed as active bugs. Need to verify if these were fixed.
2. **Build Status** — "Claims React UI wired to read-only" note (line 181) is stale — full write UI has been wired since v22.1.0.
3. **Build Status Feature Matrix** — "COD handling" listed as placeholder (🔲) — verify if backend handles COD in createWillCall.
4. **Global Search** — Correctly flagged as incomplete in both CLAUDE.md roadmap and Build Status.
5. **Task Board email fallback** — Correctly flagged as known issue in CLAUDE.md.
