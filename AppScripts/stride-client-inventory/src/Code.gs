/* ===================================================
   Code.gs — v4.7.0 — 2026-04-26 PST — Add Cleanup Item Photo Folders menu items
   v4.7.0: Stride Admin menu: added "Cleanup Item Photo Folders (dry run)"
           and "(execute)" entries. Backed by StrideCleanupItemPhotoFolders_
           in Utils.gs — trashes empty per-item Drive folders that were
           historically created but never used (photos live in Supabase).
   v4.6.0: Inventory schema adds "Transfer Date" column (between Release Date and Status).
           Used by storage billing to split charges at the transfer cutover.
           Non-destructive — added to both fresh-setup invHeaders and runUpdateClientHeaders_'s invExpected.
   v4.5.0: Settings seed descriptions now say "Price adjustment % (-100 to +100)"
           to match widened range in api_applyDiscount_ / applyClientDiscount_.
   =================================================== */
/***************************************************************
[SCRIPT 2] STRIDE CLIENT INVENTORY v2.8.0 (CLIENT SHEET)
v2.3.0 changes:
- Dock Intake: Quick_Entry + QE_Items replaced by one sheet.
- Same menu flow: Start New Shipment + Complete Shipment.
- Dock Intake items grid header at row 10, data from row 11.
- AUTO_INSPECTION from v2.2.4 preserved.
v2.3.0-HOTFIX changes:
- Removed markdown rendering artifacts (smart quotes, stray
backticks) that prevented Apps Script from saving.
- Eliminated Config sheet: all config now lives in Settings.
Config sheet is no longer created or referenced. Two new
Settings keys added: LOGO_URL, MASTER_SHEET_URL.
- Aligned cache sheet names: script now uses Price_Cache and
Class_Cache (matching the template), not PRICECACHE/CLASSCACHE.
- Phase 3 cache refresh cleans stray Logo URL row from
Class_Cache if present.
- Inventory Class dropdown points to Class_Cache!A2:A500.
- Billing_Events sheet (legacy) is no longer created but is
not deleted if it already exists.
v2.5.0 changes:
// - ADD: Repair Quote Request email alert (internal only) when
//   "Create Repair Quote" checkbox is checked on Inventory tab.
//   Uses REPAIR_QUOTE_REQUEST template, sends to NOTIFICATION_EMAILS.
v2.4.4 changes:
// This version introduces receiving‑billing and custom task creation on the
// client sheet. Key additions:
// - Receiving billing: when shipments are completed via Dock Intake, each
//   item now generates a billing ledger entry using service code "RCVG".
// - New Inventory columns: "Create Task" (checkbox) and "Task Type"
//   (dropdown listing service codes). Checking the box creates a task for
//   the selected service.
// - Task Status dropdown on the Tasks sheet: users may manually change
//   status among "Open", "Completed" or "Cancelled" without breaking
//   automated billing.
// - Improved email sending: eliminates empty/duplicate recipients.
// - Added ENABLE_RECEIVING_BILLING setting (default TRUE) to control
//   automatic receiving billing.
// - Bug fixes and minor optimizations.
- Menu consolidation: "Stride Client" and "Stride Client (Phase 3)"
replaced with "Stride Warehouse" (daily ops) and "Stride Admin"
(setup/management).
- Release Date column added to Inventory (after Receive Date).
- Auto status flip: entering a Release Date sets Status to "Released".
- Inventory Status dropdown: Active, Released, On Hold.
- Inventory view filters via menu: View Active, View Released, View All.
- Dock Intake Class dropdown auto-wired to Class_Cache on setup.
DEPLOYMENT:
(A) CLIENT SHEET: paste everything above the Master RPC section.
(B) MASTER RPC WEB APP: paste the doPost section into a
separate .gs file in the MASTER spreadsheet project and
deploy as a Web App.
****************************************************************/
/* =========================
(A) CLIENT SHEET SCRIPT
========================= */
var CI_V = "v3.0.0";
/*
v2.6.0 changes vs v2.5.1:
1) FIX: REPAIR_HEADERS now has 28 columns (added Source Task ID, Start Date, Billed)
2) FIX: HEADER_RENAMES adds Issue->Task Notes, Inspection Notes->Task Notes mappings
3) FIX: Bidirectional sync fields match spec (8 fields: Item Notes, Task Notes, Repair Notes,
        Assigned To, Repair Vendor, Repair Result, Scheduled Date, Status)
4) FIX: Removed duplicate "Task Notes" key in createRepairRowFromTask_
5) FIX: Removed duplicate esc_() function (kept complete version)
6) FIX: Removed no-op rename entry ["Task Notes","Task Notes"]
*/
/* ========= EXECUTION LOGGING ========= */
/**
 * CI_log_ — structured logging for client script executions.
 * Writes to Logger.log with level prefix, and also logs to Sync_Log
 * sheet if it exists (for operator visibility in Apps Script Executions).
 */
function CI_log_(lvl, msg, detail) {
  var prefix = "[" + lvl + "] " + msg;
  if (detail) prefix += " | " + detail;
  Logger.log(prefix);
}

/* ========= SHEET NAMES ========= */
var CI_SH = {
SETTINGS: "Settings",
DOCK: "Dock Intake",
INVENTORY: "Inventory",
SHIPMENTS: "Shipments",
TASKS: "Tasks",
REPAIRS: "Repairs",
BILLING_LEDGER: "Billing_Ledger",
WILL_CALLS: "Will_Calls",
WC_ITEMS: "WC_Items"
};
/* ========= SETTINGS KEYS ========= */
var CI_SETTINGS_KEYS = {
OWNER_EMAIL: "OWNER_EMAIL",
MASTER_SPREADSHEET_ID: "MASTER_SPREADSHEET_ID",
CONSOLIDATED_BILLING_SPREADSHEET_ID: "CONSOLIDATED_BILLING_SPREADSHEET_ID",
MASTER_SHEET_URL: "MASTER_SHEET_URL",
DRIVE_PARENT_FOLDER_ID: "DRIVE_PARENT_FOLDER_ID",
PHOTOS_FOLDER_ID: "PHOTOS_FOLDER_ID",
NOTIFICATION_EMAILS: "NOTIFICATION_EMAILS",
TIMEZONE: "TIMEZONE",
CLIENT_NAME: "CLIENT_NAME",
CLIENT_EMAIL: "CLIENT_EMAIL",
FREE_STORAGE_DAYS: "FREE_STORAGE_DAYS",
PAYMENT_TERMS: "PAYMENT_TERMS",
ENABLE_SHIPMENT_EMAIL: "ENABLE_SHIPMENT_EMAIL",
ENABLE_NOTIFICATIONS: "ENABLE_NOTIFICATIONS",
AUTO_INSPECTION: "AUTO_INSPECTION",
MASTER_RPC_URL: "MASTER_RPC_URL",
MASTER_RPC_TOKEN: "MASTER_RPC_TOKEN",
  LOGO_URL: "LOGO_URL",
  /**
   * When TRUE, the system will automatically create a billing ledger entry for each
   * item received during Dock Intake. The entry will use the RCVG service code
   * (Receiving) and rate information from the master price list based on the
   * item's class. When FALSE, no receiving billing rows will be created on
   * shipment save. Defaults to TRUE when not set in Settings.
   */
  ENABLE_RECEIVING_BILLING: "ENABLE_RECEIVING_BILLING",
  DISCOUNT_STORAGE_PCT: "DISCOUNT_STORAGE_PCT",
  DISCOUNT_SERVICES_PCT: "DISCOUNT_SERVICES_PCT",
  SEPARATE_BY_SIDEMARK: "SEPARATE_BY_SIDEMARK",
  QB_CUSTOMER_NAME: "QB_CUSTOMER_NAME",
  ADMIN_EMAILS: "ADMIN_EMAILS",
  // v4.0.3: Async remote sync status tracking
  SYNC_STATUS:       "SYNC_STATUS",
  SYNC_QUEUED_AT:    "SYNC_QUEUED_AT",
  SYNC_COMPLETED_AT: "SYNC_COMPLETED_AT",
  SYNC_MESSAGE:      "SYNC_MESSAGE"
};
/* ========= SHEET HEADERS ========= */
var TASK_HEADERS = [
"Task ID","Type","Status","Item ID","Vendor","Description","Location","Sidemark",
"Shipment #","Created","Item Notes",
"Completed At","Cancelled At",
"Result","Task Notes","Svc Code","Billed","Assigned To",
"Start Task","Started At",
"Completion Started At","Completion Processed At","Email Sent At","Billing Exception",
"Custom Price"
];
var REPAIR_HEADERS = [
"Repair ID","Source Task ID","Item ID","Description","Class","Vendor","Location","Sidemark",
"Task Notes","Created By","Created Date","Quote Amount","Quote Sent Date",
"Status","Approved","Scheduled Date","Start Date","Repair Vendor",
"Parts Cost","Labor Hours",
"Repair Result","Final Amount","Invoice ID","Item Notes","Repair Notes","Completed Date","Billed",
"Completion Started At","Completion Processed At","Quote Sent At","Approval Processed At","Email Sent At","Billing Exception"
];
var BILLING_LEDGER_HEADERS = [
"Status","Invoice #","Client","Date","Svc Code","Svc Name","Category",
"Item ID","Description","Class","Qty","Rate","Total",
"Task ID","Repair ID","Shipment #","Item Notes","Ledger Row ID"
];
var WILL_CALL_HEADERS = [
"WC Number","Status","Created Date","Created By","Pickup Party","Pickup Phone",
"Requested By","Estimated Pickup Date","Actual Pickup Date","Notes",
"COD","COD Amount","Items Count","Total WC Fee"
];
var WC_ITEMS_HEADERS = [
"WC Number","Item ID","Qty","Vendor","Description","Class",
"Location","Sidemark","Room","WC Fee","Released","Status"
];
/* ========= WILL CALL STATUSES ========= */
var WC_STATUS = {
PENDING: "Pending",
SCHEDULED: "Scheduled",
RELEASED: "Released",
PARTIAL: "Partial",
CANCELLED: "Cancelled"
};
/* ========= REQUIRED FIELDS ========= */
var QE_REQUIRED = ["Item ID","Description","Class"];
/* ========= DOCK INTAKE LAYOUT ========= */
var DOCK_FORM_RANGE_TO_CLEAR = "B2:B7";
var DOCK_ITEMS_HEADER_ROW = 10;
var DOCK_ITEMS_DATA_START_ROW = 11;
/* ========= REPAIR STATUSES ========= */
var REPAIR_STATUS = {
PENDING_QUOTE: "Pending Quote",
QUOTE_SENT: "Quote Sent",
APPROVED: "Approved",
DECLINED: "Declined",
IN_PROGRESS: "In Progress",
COMPLETE: "Complete",
CANCELLED: "Cancelled"
};
/* ========= INVENTORY STATUSES (v2.4.0) ========= */
var INVENTORY_STATUS = {
ACTIVE: "Active",
RELEASED: "Released",
ON_HOLD: "On Hold",
TRANSFERRED: "Transferred"
};
/* ========= TASK RESULT COLORS ========= */
var RESULT_COLOR = {
"Pass": "#16A34A",
"PASS": "#16A34A",
"Fail": "#DC2626",
"FAIL": "#DC2626"
};
/* ========= PHASE 3 SHEET NAMES ========= */
var CI3_V = "v2.4.5";
var CI3_SH = {
PRICECACHE: "Price_Cache",
CLASSCACHE: "Class_Cache",
LOCATIONCACHE: "Location_Cache",
EMAILCACHE: "Email_Template_Cache",
SETUP_INSTRUCTIONS: "Setup_Instructions"
};
var CI3_MASTER_SH = {
PRICE_LIST: "Price_List",
CLASS_MAP: "Class_Map",
EMAIL_TEMPLATES: "Email_Templates"
};
/* ============================================================
UI -- v3.0.1 ROLE-BASED MENUS
============================================================ */
function isAdminUser_() {
  try {
    var ss = SpreadsheetApp.getActive();
    var adminRaw = getSetting_(ss, CI_SETTINGS_KEYS.ADMIN_EMAILS);
    if (!adminRaw) return true; // fallback: if no admin emails set, show all menus
    var currentUser = Session.getActiveUser().getEmail().toLowerCase().trim();
    if (!currentUser) return true; // can't determine user, show all menus
    var admins = String(adminRaw).toLowerCase().split(",");
    for (var i = 0; i < admins.length; i++) {
      if (admins[i].trim() === currentUser) return true;
    }
    return false;
  } catch (err) {
    Logger.log("isAdminUser_ error: " + err);
    return true; // fallback: show all menus on error
  }
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var admin = isAdminUser_();

  // --- Stride Client menu (visible to everyone) ---
  ui.createMenu("Stride Client")
    .addItem("Default View: Inventory", "StrideDefaultViewInventory")
    .addItem("Default View: Tasks", "StrideDefaultViewTasks")
    .addItem("Default View: Repairs", "StrideDefaultViewRepairs")
    .addItem("View Released Inventory", "StrideViewReleasedInventory")
    .addItem("View All Inventory", "StrideViewAllInventory")
    .addItem("Clear Filters", "StrideClearFilters")
    .addSeparator()
    .addItem("View Item History", "StrideViewItemHistory")
    .addSeparator()
    .addItem("Create Will Call", "StrideCreateWillCall")
    .addSeparator()
    .addItem("📋 Create Inspections", "StrideCreateInspectionTasks")
    .addItem("📋 Create Tasks", "StrideCreateTasks")
    .addToUi();

  if (!admin) return; // non-admin users only see Stride Client menu

  // --- Stride Warehouse menu (admin only) ---
  var whMenu = ui.createMenu("Stride Warehouse")
    .addItem("Start New Shipment", "QE_StartNewShipment")
    .addItem("Complete Shipment (Confirm > Folder > Save)", "QE_CompleteShipment")
    .addSeparator()
    .addItem("View Active Inventory", "StrideViewActiveInventory")
    .addItem("View Released Inventory", "StrideViewReleasedInventory")
    .addItem("View All Inventory", "StrideViewAllInventory")
    .addSeparator()
    .addItem("View Item History", "StrideViewItemHistory")
    .addSeparator()
    .addItem("Create Will Call", "StrideCreateWillCall")
    .addItem("Complete Will Call", "StrideProcessRelease")
    .addItem("Regenerate Will Call Doc", "StrideRegenerateWillCallDoc")
    .addSeparator()
    .addItem("Default View: Inventory", "StrideDefaultViewInventory")
    .addItem("Default View: Tasks", "StrideDefaultViewTasks")
    .addItem("Default View: Repairs", "StrideDefaultViewRepairs")
    .addItem("Clear Filters", "StrideClearFilters")
    .addSeparator()
    .addItem("📋 Create Inspections", "StrideCreateInspectionTasks")
    .addItem("📋 Create Tasks", "StrideCreateTasks")
    .addItem("📅 Set Release Date", "StrideSetReleaseDate")
    .addSeparator();

  // v2.4.4: Transfer Items is implemented in a separate add-on script file.
  try {
    if (typeof TR_addTransferMenuItem_ === "function") {
      TR_addTransferMenuItem_(whMenu);
    }
  } catch (err) {
    Logger.log("TR_addTransferMenuItem_ failed: " + err);
  }

  whMenu.addToUi();

  // --- Stride Admin menu (admin only) ---
  ui.createMenu("Stride Admin")
    // — Setup & Configuration —
    .addItem("Initial Setup (Full Reset)", "StrideClientSetup")
    .addItem("Update Headers & Validations", "StrideClientUpdateHeadersAndValidations")
    .addItem("Install Triggers", "StrideClientInstallTriggers")
    .addItem("Verify Triggers", "verifyTriggers")
    .addItem("Reset Triggers", "resetTriggers")
    .addItem("Refresh Price/Class Cache", "StrideClientRefreshPriceClassCache")
    .addSeparator()
    // — Data & Import —
    .addItem("Import Inventory", "StrideImportInventory")
    .addItem("Sync Autocomplete DB", "StrideSyncAutocompleteDB")
    .addItem("Fix Missing Folders & Links", "StrideFixMissingFolders")
    .addItem("Cleanup Item Photo Folders (dry run)", "StrideCleanupItemPhotoFoldersDryRun")
    .addItem("Cleanup Item Photo Folders (execute)", "StrideCleanupItemPhotoFoldersExecute")
    .addSeparator()
    // — Email & Docs —
    .addItem("Re-send Email", "StrideResendEmail")
    .addItem("Send Welcome Email", "StrideSendWelcomeEmail")
    .addItem("Test Send Emails & Docs", "StrideTestSendAll")
    .addSeparator()
    // — Reference —
    .addItem("Update Setup Instructions", "StrideClientBuildSetupInstructions")
    .addToUi();
}

/* ============================================================
SETUP -- v2.4.0 (Release Date + Status dropdown + Dock Class dropdown)
============================================================ */
function StrideClientSetup() {
var ui = SpreadsheetApp.getUi();
var ss = SpreadsheetApp.getActive();
// v2.6.0: Safety check — if any data sheet has content, route to Update Headers instead
var dataSheets = [CI_SH.INVENTORY, CI_SH.TASKS, CI_SH.REPAIRS, CI_SH.BILLING_LEDGER];
var hasData = false;
for (var ds = 0; ds < dataSheets.length; ds++) {
  var checkSh = ss.getSheetByName(dataSheets[ds]);
  if (checkSh && hasNonHeaderData_(checkSh)) { hasData = true; break; }
}
if (hasData) {
  var safeConfirm = ui.alert(
    "Existing Data Detected",
    "This sheet already has data. Running a full reset would DESTROY it.\n\n" +
    "Would you like to run 'Update Headers & Validations' instead?\n" +
    "(This safely adds missing columns and fixes validations without data loss.)\n\n" +
    "Click YES for safe update, NO to cancel.",
    ui.ButtonSet.YES_NO
  );
  if (safeConfirm === ui.Button.YES) {
    StrideClientUpdateHeadersAndValidations();
  } else {
    safeAlert_("Cancelled. No changes were made.");
  }
  return;
}
var confirm = ui.alert(
"Full Setup (New Sheet)",
"This will set up Dock Intake, Inventory, Tasks, Repairs, and Shipments from scratch.\n\n" +
"Continue?",
ui.ButtonSet.OK_CANCEL
);
if (confirm !== ui.Button.OK) {
safeAlert_("Cancelled. No changes were made.");
return;
}
var settings = ensureSheet_(ss, CI_SH.SETTINGS);
setupClientSettings_(settings);
// Dock Intake (combined form + items grid)
var dock = ensureSheet_(ss, CI_SH.DOCK);
dock.clear();
dock.getRange("A1").setValue("Dock Intake").setFontWeight("bold");
dock.getRange("A2").setValue("Shipment #");
dock.getRange("B2").setValue("").setFontWeight("bold").setBackground("#F1F5F9").setNote("Auto-filled. Do not edit.");
dock.getRange("A3").setValue("Shipment Photos URL");
dock.getRange("B3").setValue("").setFontWeight("bold").setBackground("#F1F5F9").setNote("Auto-filled. Do not edit.");
dock.getRange("A4").setValue("Carrier");
dock.getRange("B4").setValue("");
dock.getRange("A5").setValue("Tracking #");
dock.getRange("B5").setValue("");
dock.getRange("A6").setValue("Shipment Notes");
dock.getRange("B6").setValue("");
dock.getRange("A7").setValue("Receive Date");
dock.getRange("B7").setValue("").setNote("Optional. Leave blank to use today's date.");
dock.getRange("A8").setValue("Instructions").setFontWeight("bold");
dock.getRange("A9").setValue(
"1) Enter items in the grid below\n" +
"2) Click Complete Shipment\n" +
"3) Confirm > Folder created > Shipment Photos URL generated\n" +
"4) Inventory/Shipments/Tasks updated + Email sent"
);
var qeHeaders = [
"Item ID","Qty","Vendor","Description","Class","Location","Sidemark",
"Needs Inspection","Needs Assembly","Item Notes","Shipment #"
];
writeHeadersAtRow_(dock, qeHeaders, DOCK_ITEMS_HEADER_ROW);
applyCheckbox_(dock, [
colA1RangeAtRow_(dock, "Needs Inspection", DOCK_ITEMS_DATA_START_ROW, 5000, DOCK_ITEMS_HEADER_ROW),
colA1RangeAtRow_(dock, "Needs Assembly", DOCK_ITEMS_DATA_START_ROW, 5000, DOCK_ITEMS_HEADER_ROW)
].filter(Boolean));
// v2.4.0: Wire Dock Intake Class dropdown to Class_Cache
applyDockIntakeClassDropdown_(dock);
// v3.1.0: Wire Dock Intake Location dropdown to Location_Cache
applyDockIntakeLocationDropdown_();
dock.setFrozenRows(1);
// Inventory -- v2.4.0: added "Release Date" after "Receive Date"
var inv = ensureSheet_(ss, CI_SH.INVENTORY);
inv.clear();
// v4.0.0: Removed Needs Inspection, Needs Assembly, Create Task, Task Type from Inventory
// Task creation now uses menu-driven batch actions (Stride Warehouse menu)
var invHeaders = [
"Item ID","Reference","Qty","Vendor","Description","Class","Location","Sidemark","Room",
"Item Notes","Task Notes","Carrier","Tracking #","Shipment #",
"Receive Date","Release Date","Transfer Date","Status","Invoice URL",
"Create Repair Quote"
];
writeHeaders_(inv, invHeaders);
// v2.4.0: Status dropdown
var invMap = getHeaderMap_(inv);
var statusColInv = invMap["Status"];
if (statusColInv) {
var statusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(INVENTORY_STATUS), true)
.setAllowInvalid(false)
.build();
inv.getRange(2, statusColInv, 5000, 1).setDataValidation(statusRule);
}
applyServiceCodeDropdownFromCache_();
// v3.1.0: Wire Inventory Location dropdown to Location_Cache
applyLocationDropdownFromCache_();
inv.setFrozenRows(1);
// v2.4.0: Default filter to show Active only
ensureInventoryDefaultFilter_(inv);
// Shipments
var ship = ensureSheet_(ss, CI_SH.SHIPMENTS);
ship.clear();
var shipHeaders = [
"Shipment #","Receive Date","Item Count","Carrier","Tracking #","Shipment Photos URL","Shipment Notes","Invoice URL"
];
writeHeaders_(ship, shipHeaders);
ship.setFrozenRows(1);
// Tasks
var tasks = ensureSheet_(ss, CI_SH.TASKS);
tasks.clear();
writeHeaders_(tasks, TASK_HEADERS);
var resultRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Pass","Fail"], true)
.setAllowInvalid(false)
.build();
var taskMap = getHeaderMap_(tasks);
var resultColSetup = taskMap["Result"];
if (resultColSetup) tasks.getRange(2, resultColSetup, 5000, 1).setDataValidation(resultRule);
var taskStatusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(["Open","In Progress","Completed","Cancelled"], true)
.setAllowInvalid(false)
.build();
var statusColSetup = taskMap["Status"];
if (statusColSetup) tasks.getRange(2, statusColSetup, 5000, 1).setDataValidation(taskStatusRule);
var billedColSetup = taskMap["Billed"];
if (billedColSetup) {
tasks.getRange(2, billedColSetup, 5000, 1).setDataValidation(
SpreadsheetApp.newDataValidation().requireCheckbox().build()
);
}
// v4.0.0: Start Task checkbox
var startTaskColSetup = taskMap["Start Task"];
if (startTaskColSetup) {
tasks.getRange(2, startTaskColSetup, 5000, 1).setDataValidation(
SpreadsheetApp.newDataValidation().requireCheckbox().build()
);
}
tasks.setFrozenRows(1);
ensureTasksDefaultFilter_(tasks);
// Repairs
var repairs = ensureSheet_(ss, CI_SH.REPAIRS);
repairs.clear();
writeHeaders_(repairs, REPAIR_HEADERS);
var repairStatusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(REPAIR_STATUS), true)
.setAllowInvalid(false)
.build();
var repairMap = getHeaderMap_(repairs);
var repStatusCol = repairMap["Status"];
if (repStatusCol) repairs.getRange(2, repStatusCol, 5000, 1).setDataValidation(repairStatusRule);
var approvedCol = repairMap["Approved"];
if (approvedCol) {
repairs.getRange(2, approvedCol, 5000, 1).setDataValidation(
SpreadsheetApp.newDataValidation().requireValueInList(["Approved", "Declined"], true).setAllowInvalid(false).build()
);
}
repairs.setFrozenRows(1);
// Billing_Ledger
var billing = ensureSheet_(ss, CI_SH.BILLING_LEDGER);
if (!hasNonHeaderData_(billing)) {
billing.clear();
writeHeaders_(billing, BILLING_LEDGER_HEADERS);
billing.setFrozenRows(1);
} else {
ensureHeaderRow_(billing, BILLING_LEDGER_HEADERS);
}
// v2.7.2: Sync Billing_Ledger headers with Consolidated_Ledger (if CB spreadsheet is configured)
syncBillingHeadersFromConsolidated_(ss);
// Will_Calls
var willCalls = ensureSheet_(ss, CI_SH.WILL_CALLS);
if (!hasNonHeaderData_(willCalls)) {
willCalls.clear();
writeHeaders_(willCalls, WILL_CALL_HEADERS);
var wcMap = getHeaderMap_(willCalls);
var wcStatusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(WC_STATUS), true)
.setAllowInvalid(false)
.build();
if (wcMap["Status"]) willCalls.getRange(2, wcMap["Status"], 5000, 1).setDataValidation(wcStatusRule);
if (wcMap["COD"]) {
willCalls.getRange(2, wcMap["COD"], 5000, 1).setDataValidation(
SpreadsheetApp.newDataValidation().requireCheckbox().build()
);
}
willCalls.setFrozenRows(1);
} else {
ensureHeaderRow_(willCalls, WILL_CALL_HEADERS);
}
// WC_Items
var wcItems = ensureSheet_(ss, CI_SH.WC_ITEMS);
if (!hasNonHeaderData_(wcItems)) {
wcItems.clear();
writeHeaders_(wcItems, WC_ITEMS_HEADERS);
var wciMap = getHeaderMap_(wcItems);
if (wciMap["Released"]) {
wcItems.getRange(2, wciMap["Released"], 5000, 1).setDataValidation(
SpreadsheetApp.newDataValidation().requireCheckbox().build()
);
}
// v2.6.5: Status dropdown on WC_Items matching WC_STATUS values
if (wciMap["Status"]) {
var wciStatusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(WC_STATUS), true)
.setAllowInvalid(false)
.build();
wcItems.getRange(2, wciMap["Status"], 5000, 1).setDataValidation(wciStatusRule);
}
wcItems.setFrozenRows(1);
} else {
ensureHeaderRow_(wcItems, WC_ITEMS_HEADERS);
}
  // v3.1.0: Create Autocomplete_DB tab
  ensureAutocompleteDBSheet_(ss);
  // v3.0.0: Hide + warn-protect internal tabs
  hideAndWarnProtectInternalTabs_(ss);
safeAlert_(
"Client Inventory Setup complete (" + CI_V + ").\n\nNext:\n" +
"1) Fill Settings values (MASTER_RPC_URL, MASTER_RPC_TOKEN,\n" +
" DRIVE_PARENT_FOLDER_ID, NOTIFICATION_EMAILS,\n" +
" CLIENT_NAME, CLIENT_EMAIL)\n" +
"2) Run Install Triggers\n" +
"3) Run Refresh Price/Class Cache (Stride Admin menu)"
);
}
function setupClientSettings_(settingsSheet) {
var existingMap = readSettingsMap_(settingsSheet);
settingsSheet.clear();
// Clear any leftover data validations from prior versions to prevent
// "violates data validation" errors when writing new rows
try {
var maxRow = Math.max(settingsSheet.getMaxRows(), 1);
var maxCol = Math.max(settingsSheet.getMaxColumns(), 3);
settingsSheet.getRange(1, 1, maxRow, maxCol).clearDataValidations();
} catch (_) {}
settingsSheet.getRange(1, 1, 1, 3)
.setValues([["Key","Value","Notes"]])
.setFontWeight("bold");
settingsSheet.setFrozenRows(1);
var ownerGuess = (existingMap[CI_SETTINGS_KEYS.OWNER_EMAIL] || tryGetEmail_() || "").trim();
var rows = [
[CI_SETTINGS_KEYS.OWNER_EMAIL, ownerGuess, "Owner email."],
[CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID, existingMap[CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID] || "", "Master spreadsheet ID (for Price List + Email Templates)."],
[CI_SETTINGS_KEYS.CONSOLIDATED_BILLING_SPREADSHEET_ID, existingMap[CI_SETTINGS_KEYS.CONSOLIDATED_BILLING_SPREADSHEET_ID] || "", "Spreadsheet ID for Consolidated Billing Transfers."],
[CI_SETTINGS_KEYS.MASTER_SHEET_URL, existingMap[CI_SETTINGS_KEYS.MASTER_SHEET_URL] || "", "Full URL to Master spreadsheet (display/reference only)."],
[CI_SETTINGS_KEYS.MASTER_RPC_URL, existingMap[CI_SETTINGS_KEYS.MASTER_RPC_URL] || "", "Master Web App URL for atomic shipment ID generation (doPost endpoint)."],
[CI_SETTINGS_KEYS.MASTER_RPC_TOKEN, existingMap[CI_SETTINGS_KEYS.MASTER_RPC_TOKEN] || "", "Shared secret token for Master RPC authentication."],
[CI_SETTINGS_KEYS.DRIVE_PARENT_FOLDER_ID, existingMap[CI_SETTINGS_KEYS.DRIVE_PARENT_FOLDER_ID] || "", "Drive folder ID where shipment folders are created."],
[CI_SETTINGS_KEYS.PHOTOS_FOLDER_ID, existingMap[CI_SETTINGS_KEYS.PHOTOS_FOLDER_ID] || "", "Optional: Separate Drive folder ID for shipment photos. Leave blank to use DRIVE_PARENT_FOLDER_ID."],
[CI_SETTINGS_KEYS.LOGO_URL, existingMap[CI_SETTINGS_KEYS.LOGO_URL] || "", "Logo image URL for email templates and branding."],
[CI_SETTINGS_KEYS.NOTIFICATION_EMAILS, existingMap[CI_SETTINGS_KEYS.NOTIFICATION_EMAILS] || "", "Comma-separated internal staff emails."],
[CI_SETTINGS_KEYS.CLIENT_EMAIL, existingMap[CI_SETTINGS_KEYS.CLIENT_EMAIL] || "", "Client billing/contact email."],
[CI_SETTINGS_KEYS.CLIENT_NAME, existingMap[CI_SETTINGS_KEYS.CLIENT_NAME] || "", "Client display name for emails and billing."],
[CI_SETTINGS_KEYS.ENABLE_SHIPMENT_EMAIL, existingMap[CI_SETTINGS_KEYS.ENABLE_SHIPMENT_EMAIL] !== undefined ? existingMap[CI_SETTINGS_KEYS.ENABLE_SHIPMENT_EMAIL] : true, "TRUE/FALSE - send email on shipment submit."],
[CI_SETTINGS_KEYS.ENABLE_NOTIFICATIONS, existingMap[CI_SETTINGS_KEYS.ENABLE_NOTIFICATIONS] !== undefined ? existingMap[CI_SETTINGS_KEYS.ENABLE_NOTIFICATIONS] : true, "TRUE/FALSE - master toggle for inspection/repair emails."],
[CI_SETTINGS_KEYS.FREE_STORAGE_DAYS, existingMap[CI_SETTINGS_KEYS.FREE_STORAGE_DAYS] !== undefined ? existingMap[CI_SETTINGS_KEYS.FREE_STORAGE_DAYS] : 30, "Days before storage charges begin per item. 0 = no free period."],
[CI_SETTINGS_KEYS.PAYMENT_TERMS, existingMap[CI_SETTINGS_KEYS.PAYMENT_TERMS] || "Net 30", "Payment terms shown on invoices."],
[CI_SETTINGS_KEYS.TIMEZONE, existingMap[CI_SETTINGS_KEYS.TIMEZONE] || Session.getScriptTimeZone(), "Script time zone (auto-filled)."],
    [CI_SETTINGS_KEYS.AUTO_INSPECTION, existingMap[CI_SETTINGS_KEYS.AUTO_INSPECTION] !== undefined ? existingMap[CI_SETTINGS_KEYS.AUTO_INSPECTION] : false, "TRUE/FALSE. If TRUE: intake creates INSP task for every item."],
    // v2.4.5: optionally bill receiving items at shipment intake
    [CI_SETTINGS_KEYS.ENABLE_RECEIVING_BILLING, existingMap[CI_SETTINGS_KEYS.ENABLE_RECEIVING_BILLING] !== undefined ? existingMap[CI_SETTINGS_KEYS.ENABLE_RECEIVING_BILLING] : true, "TRUE/FALSE. If TRUE: Dock Intake save will create a receiving billing row for each item."],
    [CI_SETTINGS_KEYS.DISCOUNT_STORAGE_PCT, existingMap[CI_SETTINGS_KEYS.DISCOUNT_STORAGE_PCT] || "0", "Price adjustment % (-100 to +100). Negative = discount, Positive = markup."],
    [CI_SETTINGS_KEYS.DISCOUNT_SERVICES_PCT, existingMap[CI_SETTINGS_KEYS.DISCOUNT_SERVICES_PCT] || "0", "Price adjustment % (-100 to +100). Negative = discount, Positive = markup."],
    [CI_SETTINGS_KEYS.SEPARATE_BY_SIDEMARK, existingMap[CI_SETTINGS_KEYS.SEPARATE_BY_SIDEMARK] || "FALSE", "TRUE/FALSE. If TRUE: invoices are separated by sidemark for this client."],
    [CI_SETTINGS_KEYS.QB_CUSTOMER_NAME, existingMap[CI_SETTINGS_KEYS.QB_CUSTOMER_NAME] || "", "QuickBooks customer name (if different from Client Name)."],
    // v4.0.3: Async remote sync status tracking
    [CI_SETTINGS_KEYS.SYNC_STATUS, existingMap[CI_SETTINGS_KEYS.SYNC_STATUS] || "never", "(auto) Last remote sync status"],
    [CI_SETTINGS_KEYS.SYNC_QUEUED_AT, existingMap[CI_SETTINGS_KEYS.SYNC_QUEUED_AT] || "", "(auto) When last sync was queued"],
    [CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, existingMap[CI_SETTINGS_KEYS.SYNC_COMPLETED_AT] || "", "(auto) When last sync completed"],
    [CI_SETTINGS_KEYS.SYNC_MESSAGE, existingMap[CI_SETTINGS_KEYS.SYNC_MESSAGE] || "", "(auto) Last sync result message"]
];
settingsSheet.getRange(2, 1, rows.length, 3).setValues(rows);
// Apply PAYMENT_TERMS dropdown
try {
var ptRule = SpreadsheetApp.newDataValidation()
.requireValueInList(["CC ON FILE","ACH ON FILE","NET 15","NET 30"], true)
.setAllowInvalid(false)
.build();
var ptIdx = -1;
for (var p = 0; p < rows.length; p++) { if (rows[p][0] === CI_SETTINGS_KEYS.PAYMENT_TERMS) { ptIdx = p; break; } }
if (ptIdx >= 0) settingsSheet.getRange(ptIdx + 2, 2).setDataValidation(ptRule);
} catch (ptErr) { Logger.log("setupClientSettings_ PAYMENT_TERMS validation error: " + ptErr); }
// Apply TRUE/FALSE dropdowns
try {
var boolRule = SpreadsheetApp.newDataValidation()
.requireValueInList(["TRUE","FALSE"], true)
.setAllowInvalid(false)
.build();
    // Include new ENABLE_RECEIVING_BILLING flag in boolean dropdowns
    var boolKeys = [CI_SETTINGS_KEYS.ENABLE_SHIPMENT_EMAIL, CI_SETTINGS_KEYS.ENABLE_NOTIFICATIONS, CI_SETTINGS_KEYS.AUTO_INSPECTION, CI_SETTINGS_KEYS.ENABLE_RECEIVING_BILLING];
for (var bk = 0; bk < boolKeys.length; bk++) {
for (var bi = 0; bi < rows.length; bi++) {
if (rows[bi][0] === boolKeys[bk]) {
settingsSheet.getRange(bi + 2, 2).setDataValidation(boolRule);
break;
}
}
}
} catch (boolErr) { Logger.log("setupClientSettings_ boolean validation error: " + boolErr); }
}
/* ============================================================
UPDATE HEADERS & VALIDATIONS (SAFE - NO DATA LOSS)
Adds missing columns, re-applies dropdowns and checkboxes
to correct positions without clearing any existing data.
============================================================ */
function StrideClientUpdateHeadersAndValidations() {
var ss = SpreadsheetApp.getActive();
var report = [];
// v2.5.1: Rename headers in-place (preserves column order)
var headerRenames = [
  ["Issue", "Task Notes"],
  ["Inspection Notes", "Task Notes"],
  ["Result Notes", "Task Notes"],
  ["Photos URL", "Shipment Photos URL"]
];
var sheetsToRename = [CI_SH.TASKS, CI_SH.REPAIRS, CI_SH.INVENTORY, CI_SH.SHIPMENTS];
for (var ri = 0; ri < sheetsToRename.length; ri++) {
  var renameSheet = ss.getSheetByName(sheetsToRename[ri]);
  if (renameSheet) {
    var renamed = renameHeaders_(renameSheet, headerRenames);
    if (renamed.length) report.push(sheetsToRename[ri] + ": renamed " + renamed.join(", "));
  }
}
// --- INVENTORY ---
// v4.3.0: Non-destructive — no clearSheetDataValidations_, no removeColumnsByName_
// Only adds missing headers and applies validations to specific columns
var inv = ss.getSheetByName(CI_SH.INVENTORY);
if (inv) {
    var invExpected = [
        "Item ID","Reference","Qty","Vendor","Description","Class","Location","Sidemark","Room",
        "Item Notes","Task Notes","Carrier","Tracking #","Shipment #",
        "Receive Date","Release Date","Transfer Date","Status","Invoice URL",
        "Create Repair Quote"
    ];
var invChanges = ensureMissingHeaders_(inv, invExpected);
if (invChanges.length) report.push("Inventory: added " + invChanges.join(", "));
var invMap = getHeaderMap_(inv);
    if (invMap["Create Repair Quote"]) {
      applyCheckboxToCol_(inv, invMap["Create Repair Quote"]);
    }
if (invMap["Status"]) {
var statusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(INVENTORY_STATUS), true)
.setAllowInvalid(false)
.build();
inv.getRange(2, invMap["Status"], Math.max(inv.getMaxRows() - 1, 1), 1).setDataValidation(statusRule);
}
try { applyClassDropdownValidationFromCache_(); }
catch (e) { report.push("Inventory: Class dropdown skipped — " + e.message); }
try { applyLocationDropdownFromCache_(); }
catch (e) { report.push("Inventory: Location dropdown skipped — " + e.message); }
inv.setFrozenRows(1);
report.push("Inventory: validations updated");
}
// --- DOCK INTAKE ---
// v4.3.0: Non-destructive — apply validations to specific columns only
var dock = ss.getSheetByName(CI_SH.DOCK);
if (dock) {
var a7Val = String(dock.getRange("A7").getValue() || "").trim();
if (a7Val !== "Receive Date") {
dock.getRange("A7").setValue("Receive Date");
dock.getRange("B7").setNote("Optional. Leave blank to use today's date.");
report.push("Dock Intake: added Receive Date field");
}
var mapDock = getHeaderMapAtRow_(dock, DOCK_ITEMS_HEADER_ROW);
applyCheckboxToColAtRow_(dock, mapDock["Needs Inspection"], DOCK_ITEMS_DATA_START_ROW);
applyCheckboxToColAtRow_(dock, mapDock["Needs Assembly"], DOCK_ITEMS_DATA_START_ROW);
try { applyDockIntakeClassDropdown_(dock); }
catch (e) { report.push("Dock Intake: Class dropdown skipped — " + e.message); }
try { applyDockIntakeLocationDropdown_(); }
catch (e) { report.push("Dock Intake: Location dropdown skipped — " + e.message); }
report.push("Dock Intake: validations updated");
}
// --- TASKS ---
// v4.3.0: Non-destructive — no clearSheetDataValidations_, no removeColumnsByName_
var tasks = ss.getSheetByName(CI_SH.TASKS);
if (tasks) {
var taskChanges = ensureMissingHeaders_(tasks, TASK_HEADERS);
if (taskChanges.length) report.push("Tasks: added " + taskChanges.join(", "));
var taskMap = getHeaderMap_(tasks);
if (taskMap["Result"]) {
var resultRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Pass","Fail"], true)
.setAllowInvalid(false)
.build();
tasks.getRange(2, taskMap["Result"], Math.max(tasks.getMaxRows() - 1, 1), 1).setDataValidation(resultRule);
}
applyCheckboxToCol_(tasks, taskMap["Billed"]);
        if (taskMap["Status"]) {
            var taskStatusRule = SpreadsheetApp.newDataValidation()
                .requireValueInList(["Open", "In Progress", "Completed", "Cancelled"], true)
                .setAllowInvalid(false)
                .build();
            tasks.getRange(2, taskMap["Status"], Math.max(tasks.getMaxRows() - 1, 1), 1).setDataValidation(taskStatusRule);
        }
applyCheckboxToCol_(tasks, taskMap["Start Task"]);
applyPassFailFormatting_(tasks, taskMap["Result"]);
tasks.setFrozenRows(1);
ensureTasksDefaultFilter_(tasks);
report.push("Tasks: validations updated");
}
// --- REPAIRS ---
// v4.3.0: Non-destructive — no clearSheetDataValidations_, no removeColumnsByName_
var repairs = ss.getSheetByName(CI_SH.REPAIRS);
if (repairs) {
var repairChanges = ensureMissingHeaders_(repairs, REPAIR_HEADERS);
if (repairChanges.length) report.push("Repairs: added " + repairChanges.join(", "));
var repairMap = getHeaderMap_(repairs);
if (repairMap["Status"]) {
var repairStatusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(REPAIR_STATUS), true)
.setAllowInvalid(false)
.build();
repairs.getRange(2, repairMap["Status"], Math.max(repairs.getMaxRows() - 1, 1), 1).setDataValidation(repairStatusRule);
}
// Approved dropdown — also clean stale FALSE/TRUE from old checkbox
if (repairMap["Approved"]) {
  var appCol = repairMap["Approved"];
  var appRows = Math.max(repairs.getMaxRows() - 1, 1);
  var appRange = repairs.getRange(2, appCol, appRows, 1);
  var appVals = appRange.getValues();
  for (var ai = 0; ai < appVals.length; ai++) {
    var av = appVals[ai][0];
    if (av === true || av === false || String(av).toUpperCase() === "TRUE" || String(av).toUpperCase() === "FALSE") {
      appVals[ai][0] = "";
    }
  }
  appRange.setValues(appVals);
  var approvedRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Approved", "Declined"], true)
    .setAllowInvalid(true)
    .build();
  appRange.setDataValidation(approvedRule);
}
    if (repairMap["Repair Result"]) {
      var repairResultRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Pass", "Fail"], true)
        .setAllowInvalid(false)
        .build();
      repairs.getRange(2, repairMap["Repair Result"], Math.max(repairs.getMaxRows() - 1, 1), 1).setDataValidation(repairResultRule);
    }
applyCheckboxToCol_(repairs, repairMap["Billed"]);
applyPassFailFormatting_(repairs, repairMap["Repair Result"]);
repairs.setFrozenRows(1);
report.push("Repairs: validations updated");
}
// --- BILLING LEDGER ---
var billing = ss.getSheetByName(CI_SH.BILLING_LEDGER);
if (billing) {
ensureHeaderRow_(billing, BILLING_LEDGER_HEADERS);
billing.setFrozenRows(1);
report.push("Billing_Ledger: headers verified");
}
// --- SHIPMENTS ---
var ship = ss.getSheetByName(CI_SH.SHIPMENTS);
if (ship) {
var shipExpected = [
"Shipment #","Receive Date","Item Count","Carrier","Tracking #","Shipment Photos URL","Shipment Notes","Invoice URL"
];
var shipChanges = ensureMissingHeaders_(ship, shipExpected);
if (shipChanges.length) report.push("Shipments: added " + shipChanges.join(", "));
ship.setFrozenRows(1);
}
// --- WILL_CALLS ---
var willCalls = ss.getSheetByName(CI_SH.WILL_CALLS);
if (!willCalls) {
willCalls = ensureSheet_(ss, CI_SH.WILL_CALLS);
writeHeaders_(willCalls, WILL_CALL_HEADERS);
report.push("Will_Calls: created");
} else {
var wcChanges = ensureMissingHeaders_(willCalls, WILL_CALL_HEADERS);
if (wcChanges.length) report.push("Will_Calls: added " + wcChanges.join(", "));
}
// v4.3.0: Non-destructive — apply validations to specific columns only
var wcMapUpd = getHeaderMap_(willCalls);
if (wcMapUpd["Status"]) {
var wcStatusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(WC_STATUS), true)
.setAllowInvalid(false)
.build();
willCalls.getRange(2, wcMapUpd["Status"], Math.max(willCalls.getMaxRows() - 1, 1), 1).setDataValidation(wcStatusRule);
}
applyCheckboxToCol_(willCalls, wcMapUpd["COD"]);
willCalls.setFrozenRows(1);
report.push("Will_Calls: validations updated");
// --- WC_ITEMS ---
var wcItems = ss.getSheetByName(CI_SH.WC_ITEMS);
if (!wcItems) {
wcItems = ensureSheet_(ss, CI_SH.WC_ITEMS);
writeHeaders_(wcItems, WC_ITEMS_HEADERS);
report.push("WC_Items: created");
} else {
var wciChanges = ensureMissingHeaders_(wcItems, WC_ITEMS_HEADERS);
if (wciChanges.length) report.push("WC_Items: added " + wciChanges.join(", "));
}
// v4.3.0: Non-destructive
var wciMapUpd = getHeaderMap_(wcItems);
applyCheckboxToCol_(wcItems, wciMapUpd["Released"]);
if (wciMapUpd["Status"]) {
var wciStatusRule = SpreadsheetApp.newDataValidation()
.requireValueInList(Object.values(WC_STATUS), true)
.setAllowInvalid(false)
.build();
wcItems.getRange(2, wciMapUpd["Status"], Math.max(wcItems.getMaxRows() - 1, 1), 1).setDataValidation(wciStatusRule);
}
wcItems.setFrozenRows(1);
report.push("WC_Items: validations updated");

  // ── SETTINGS ──
  var settings = ss.getSheetByName(CI_SH.SETTINGS);
  if (settings) {
    var settingsAdded = ensureMissingSettings_(settings, [
      [CI_SETTINGS_KEYS.DISCOUNT_STORAGE_PCT, "0", "Price adjustment % (-100 to +100). Negative = discount, Positive = markup."],
      [CI_SETTINGS_KEYS.DISCOUNT_SERVICES_PCT, "0", "Price adjustment % (-100 to +100). Negative = discount, Positive = markup."],
      [CI_SETTINGS_KEYS.ENABLE_RECEIVING_BILLING, "TRUE", "Auto-bill receiving at shipment intake"],
      [CI_SETTINGS_KEYS.SEPARATE_BY_SIDEMARK, "FALSE", "TRUE/FALSE. If TRUE: invoices are separated by sidemark."],
      [CI_SETTINGS_KEYS.QB_CUSTOMER_NAME, "", "QuickBooks customer name (if different from Client Name)."]
    ]);
    if (settingsAdded.length) report.push("Settings: added " + settingsAdded.join(", "));
  }

  // v3.1.0: Ensure Autocomplete_DB tab exists
  var acDbSh = ss.getSheetByName(ACDB_SHEET_NAME);
  if (!acDbSh) {
    ensureAutocompleteDBSheet_(ss);
    report.push("Created Autocomplete_DB tab");
  }
  // v3.0.0: Hide + warn-protect internal tabs
  hideAndWarnProtectInternalTabs_(ss);
var summary = report.length ? report.join("\n") : "All headers and validations already up to date.";
safeAlert_("Update complete (" + CI_V + ").\n\n" + summary);
}
/* --- Hide & Protect Internal Tabs (v3.0.0) --- */
/**
 * Hides internal-only tabs and applies WARNING-level protection.
 * WARNING protection shows a confirmation dialog if someone tries to edit manually,
 * but does NOT block script writes or onEdit triggers.
 * This avoids the issue where strict protection blocked tasks/billing/dock intake.
 */
var INTERNAL_TABS_ = [
  CI_SH.SETTINGS, CI_SH.BILLING_LEDGER,
  CI3_SH.PRICECACHE, CI3_SH.CLASSCACHE, CI3_SH.LOCATIONCACHE,
  CI3_SH.SETUP_INSTRUCTIONS, ACDB_SHEET_NAME
];

function hideAndWarnProtectInternalTabs_(ss) {
  var owner = ss.getOwner();
  var ownerEmail = owner ? owner.getEmail() : "";

  for (var i = 0; i < INTERNAL_TABS_.length; i++) {
    var sh = ss.getSheetByName(INTERNAL_TABS_[i]);
    if (!sh) continue;

    // Hide the tab
    try { sh.hideSheet(); } catch (_) {}

    // Apply warning-only protection (does NOT block scripts or triggers)
    // First remove any existing protections on this sheet to avoid duplicates
    var existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var p = 0; p < existing.length; p++) {
      if (existing[p].getDescription() === "Internal tab — do not edit manually") {
        existing[p].remove();
      }
    }

    var protection = sh.protect().setDescription("Internal tab — do not edit manually");
    protection.setWarningOnly(true);
  }
}

/* --- Update Helpers --- */
/**
* Checks the header row for missing columns. Appends any missing ones to the right.
* Returns list of added column names.
*/
function ensureMissingHeaders_(sheet, expectedHeaders) {
var lastCol = Math.max(sheet.getLastColumn(), 1);
var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
.map(function(h) { return String(h || "").trim(); });
var added = [];
for (var i = 0; i < expectedHeaders.length; i++) {
var h = expectedHeaders[i];
if (existing.indexOf(h) === -1) {
var newCol = sheet.getLastColumn() + 1;
sheet.getRange(1, newCol).setValue(h).setFontWeight("bold").setBackground("#E85D2D").setFontColor("#ffffff");
added.push(h);
}
}
return added;
}

/**
 * v2.5.1: Renames column headers in-place without moving them.
 * Takes an array of [oldName, newName] pairs. Only renames if old exists and new does not.
 * @param {Sheet} sheet
 * @param {Array} renames - e.g. [["Task Notes","Task Notes"],["Result Notes","Task Notes"]]
 * @returns {Array} list of renamed headers
 */
function renameHeaders_(sheet, renames) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headerRange = sheet.getRange(1, 1, 1, lastCol);
  var headers = headerRange.getValues()[0].map(function(h) { return String(h || "").trim(); });
  var changed = [];
  for (var r = 0; r < renames.length; r++) {
    var oldName = renames[r][0];
    var newName = renames[r][1];
    var oldIdx = headers.indexOf(oldName);
    var newIdx = headers.indexOf(newName);
    // Only rename if old exists and new doesn't (avoid duplicates)
    if (oldIdx !== -1 && newIdx === -1) {
      headers[oldIdx] = newName;
      changed.push(oldName + " -> " + newName);
    }
  }
  if (changed.length) {
    headerRange.setValues([headers]);
  }
  return changed;
}

/**
 * Adds missing settings key-value pairs to the Settings sheet without clearing existing data.
 * @param {Sheet} settingsSheet - The Settings sheet
 * @param {Array} expectedRows - Array of [key, defaultValue, notes] to ensure exist
 * @returns {Array} list of added key names
 */
function ensureMissingSettings_(settingsSheet, expectedRows) {
  var existing = readSettingsMap_(settingsSheet);
  var added = [];
  for (var i = 0; i < expectedRows.length; i++) {
    var key = expectedRows[i][0];
    if (existing[key] === undefined || existing[key] === null) {
      var nextRow = Math.max(settingsSheet.getLastRow() + 1, 2);
      settingsSheet.getRange(nextRow, 1, 1, 3).setValues([expectedRows[i]]);
      added.push(key);
    }
  }
  return added;
}
/**
* Clears all data validations on a sheet from startRow down (default row 2).
*/
function clearSheetDataValidations_(sheet, startRow) {
startRow = startRow || 2;
try {
var maxRow = sheet.getMaxRows();
var maxCol = Math.max(sheet.getMaxColumns(), sheet.getLastColumn(), 1);
if (maxRow >= startRow) {
sheet.getRange(startRow, 1, maxRow - startRow + 1, maxCol).clearDataValidations();
}
} catch (_) {}
}

/**
 * v4.0.1: Removes columns by exact header name match.
 * Deletes right-to-left to avoid index shifting.
 * @param {Sheet} sheet - The sheet to remove columns from
 * @param {string[]} columnsToRemove - Array of exact header names to remove
 * @return {string[]} List of columns that were removed
 */
function removeColumnsByName_(sheet, columnsToRemove) {
  if (!sheet || !columnsToRemove || !columnsToRemove.length) return [];
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var removeSet = {};
  for (var i = 0; i < columnsToRemove.length; i++) {
    removeSet[String(columnsToRemove[i]).trim()] = true;
  }
  // Collect column indexes to delete (1-based), then delete right-to-left
  var colsToDelete = [];
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "").trim();
    if (h && removeSet[h]) colsToDelete.push({ col: c + 1, name: h });
  }
  var removed = [];
  // Sort descending so we delete from right to left (no index shift)
  colsToDelete.sort(function(a, b) { return b.col - a.col; });
  for (var d = 0; d < colsToDelete.length; d++) {
    try {
      sheet.deleteColumn(colsToDelete[d].col);
      removed.push(colsToDelete[d].name);
    } catch (err) {
      Logger.log("removeColumnsByName_ could not delete '" + colsToDelete[d].name + "': " + err);
    }
  }
  return removed;
}
/**
* Applies checkbox validation to a column from row 2 down.
*/
function applyCheckboxToCol_(sheet, col) {
if (!col) return;
try {
var rows = Math.max(sheet.getMaxRows() - 1, 1);
sheet.getRange(2, col, rows, 1).setDataValidation(
SpreadsheetApp.newDataValidation().requireCheckbox().build()
);
} catch (_) {}
}
/**
* Applies checkbox validation to a column from a specific start row down.
*/
/**
 * v2.6.0: Applies conditional formatting for Pass/Fail on a column.
 * Pass = green background, white text. Fail = red background, white text.
 */
function applyPassFailFormatting_(sheet, col) {
  if (!col) return;
  try {
    var rows = Math.max(sheet.getMaxRows() - 1, 1);
    var range = sheet.getRange(2, col, rows, 1);
    // Build Pass rule (green)
    var passRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Pass")
      .setBackground("#16A34A")
      .setFontColor("#FFFFFF")
      .setRanges([range])
      .build();
    // Also handle uppercase PASS
    var passUpperRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("PASS")
      .setBackground("#16A34A")
      .setFontColor("#FFFFFF")
      .setRanges([range])
      .build();
    // Build Fail rule (red)
    var failRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Fail")
      .setBackground("#DC2626")
      .setFontColor("#FFFFFF")
      .setRanges([range])
      .build();
    // Also handle uppercase FAIL
    var failUpperRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("FAIL")
      .setBackground("#DC2626")
      .setFontColor("#FFFFFF")
      .setRanges([range])
      .build();
    // Get existing rules and add new ones
    var rules = sheet.getConditionalFormatRules() || [];
    // Remove any existing Pass/Fail rules on this column to avoid duplicates
    var colLetter = toA1Col_(col);
    rules = rules.filter(function(r) {
      var ranges = r.getRanges();
      for (var i = 0; i < ranges.length; i++) {
        if (ranges[i].getColumn() === col) return false;
      }
      return true;
    });
    rules.push(passRule, passUpperRule, failRule, failUpperRule);
    sheet.setConditionalFormatRules(rules);
  } catch (err) {
    Logger.log("applyPassFailFormatting_ error: " + err);
  }
}
function applyCheckboxToColAtRow_(sheet, col, startRow) {
if (!col) return;
try {
var rows = Math.max(sheet.getMaxRows() - startRow + 1, 1);
sheet.getRange(startRow, col, rows, 1).setDataValidation(
SpreadsheetApp.newDataValidation().requireCheckbox().build()
);
} catch (_) {}
}
