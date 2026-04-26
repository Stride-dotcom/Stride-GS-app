// ============================================================
// STAX AUTO-PAY TOOL — v4.7.2
// v4.7.2 (2026-04-26): Three fixes for the Stax→Supabase resync that
//         was rolling back the entire batch when the Invoices sheet
//         had any duplicate QB Invoice # rows (Postgres code 21000:
//         "ON CONFLICT DO UPDATE command cannot affect row a second
//         time").
//           (1) _sbBatchUpsert dedupes rows by the on_conflict key
//               BEFORE sending. Last occurrence wins, order preserved.
//           (2) Failed chunks now retry row-by-row so a single bad
//               row no longer kills the whole batch.
//           (3) New _sbLogSyncError helper writes failed-upsert
//               details into stax_run_log + the Run Log sheet so
//               silent Supabase failures show up in the Payments app
//               (mirror of StrideAPI.gs:sbLogSyncError_ from v38.132.0).
//         Also fixed _sbResyncAllStaxInvoices' Auto Charge cell read
//         which mis-interpreted the JS boolean false as autoCharge=true
//         (same bug as StrideAPI.gs v38.129.0 in api_sbUpsertStaxInvoice_).
// v4.7.1 (2026-04-25): Stamp meta.invoiceNumber = docNum on every Stax
//         invoice pushed by the auto-pay path. Pairs with StrideAPI.gs
//         v38.126.0 link-handler change so future links resolve by the
//         clean bare invoice # rather than parsing the composite refKey.
//         No behavior change to dedup (_checkForDuplicateInvoice still
//         keys on refKey).
// v4.7.0 (2026-04-25): Multi-tier client lookup. Customer matching for
//         Auto Charge eligibility now tries 3 keys in order:
//           1. Stax Customer ID (GUID) — bulletproof, matches the
//              invoice's column-C value to a CB Clients "STAX CUSTOMER ID"
//              column. No string fragility.
//           2. QB_CUSTOMER_NAME — exact-match against CB Clients'
//              QB_CUSTOMER_NAME column. Handles QB-tagged customer
//              names with suffixes like "(ACH on File)" that don't
//              appear in CB Clients' CLIENT NAME column.
//           3. CLIENT NAME — original fallback for back-compat with
//              CB rows that haven't filled in the other two columns.
//         Eliminates UNKNOWN_CLIENT exceptions caused by name drift
//         between QB and CB Clients (e.g. "K&M Interiors (ACH on File)"
//         in QB vs "K&M Interiors" in CB Clients).
//         Helper: _buildClientAutoChargeLookup_, _resolveClientAutoCharge_.
//         Wired into both _prepareEligiblePendingInvoicesForChargeRun
//         and _executeChargeRun.
// v4.6.1 (2026-04-16 — hotfix): Auto Charge column now looked up by HEADER
//         name, not hardcoded index 12, in both `_prepareEligiblePending` and
//         `_executeChargeRun`. Prior behavior read the wrong cell when
//         "Auto Charge" wasn't physically the 13th column (0-based index 12)
//         — which is the case on the production Stax sheet — causing every
//         CREATED invoice with explicit Auto=TRUE to fall through to the
//         client-level check and get blocked by CLIENT_AUTO_DISABLED. Root
//         cause of: "autopay set to 4/7…4/11, nothing charged."
// v4.6.0 (2026-04-16 — session 69 Phase 2f): Supabase write-through for
//         autopay runs. Adds `_sbBatchUpsert` + four resync helpers
//         (`_sbResyncAllStaxInvoices`, `_sbResyncAllStaxCharges`,
//          `_sbResyncStaxExceptions`, `_sbResyncStaxRunLog`) called at the
//         end of `_prepareEligiblePendingInvoicesForChargeRun` (invoices +
//         run log) and `_executeChargeRun` (all four tables). Requires
//         SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in Script Properties.
//         Best-effort — never blocks a sheet write on Supabase failure.
//         Charge log resync is limited to the tail 1000 rows per run to
//         stay under execution time budget; run log to tail 500. Exceptions
//         to tail 500. Unique indexes on Supabase tables make the upserts
//         idempotent (see migration 20260416120001).
// v4.5.0 (2026-04-10 — NVPC Phase 4B): Batch throttling + override verification.
//         (1) Aligned Auto Charge override policy between prepare and charge stages.
//             Previously the charge stage let blank-invoice + unknown-client rows
//             through while the prepare stage skipped them — concrete inconsistency.
//             Both stages now use identical two-bucket fallback:
//               - CLIENT_AUTO_DISABLED: client exists in CB Clients with AUTO CHARGE=FALSE
//               - UNKNOWN_CLIENT:       client not found in CB Clients (undefined)
//             Both buckets log a distinct Exception row. Invoice-level TRUE still
//             overrides client FALSE; invoice-level FALSE still always skips.
//         (2) _executeChargeRun refactored into 3 phases:
//               Phase 2a: Build candidate list (no API calls, no row writes)
//               Phase 2b: Apply MAX_AUTO_CHARGES_PER_RUN cap (default 25)
//               Phase 2c: Sequential charge loop with:
//                         - AUTO_CHARGE_DELAY_MS throttle between actual charge attempts
//                           (defaults to 1500ms; not applied after skips or breaker defers)
//                         - AUTO_CHARGE_CIRCUIT_BREAKER_COUNT consecutive-failure cutoff
//                           (default 3; only counts 5xx/network, NOT 404/400/422 bad-row
//                           data errors or card declines)
//                         - Wall-time watchdog aborts at 5m30s to leave buffer before
//                           Apps Script's 6-minute execution kill
//         (3) New additive Config keys (seeded on first read, append-only):
//               MAX_AUTO_CHARGES_PER_RUN (default 25, min 1, max 100)
//               AUTO_CHARGE_DELAY_MS (default 1500, min 0, max 10000)
//               AUTO_CHARGE_CIRCUIT_BREAKER_COUNT (default 3, min 1, max 10)
//         (4) New helper: _getIntConfig_(key, default, min, max) reads + validates +
//             clamps + seeds defaults without reordering existing Config rows.
//         (5) httpStatus field added to _chargeInvoice return so the charge loop can
//             distinguish 404/400/422 (bad row data, NOT breaker fuel) from 5xx/network
//             (system instability, counts toward breaker).
//         (6) Expanded Run Log: separate pushStage + chargeStage stats with distinct
//             counters for deferredByCap, deferredByBreaker, deferredByWatchdog,
//             breakerTripped, apiErrorsBreakerCounted, apiErrorsBadRow, and split
//             skip-reason buckets.
//         (7) Manual runCharges() UI alert kept concise (6 key lines); full detail in
//             Run Log.
//         Rows deferred by cap/breaker/watchdog remain CREATED in the sheet with no
//         status or notes changes — they are simply re-attempted on the next run.
//         Hard cap of 100 is treated as an upper bound, not a comfort zone (per review).
// v4.4.0 (2026-04-10 — NVPC Phase 4A): Auto-push eligible PENDING invoices
//         before the charge loop runs during runChargesAuto() + runCharges().
//         Closes the gap where a due-today PENDING invoice would get stranded
//         because the daily trigger only charges CREATED rows. Now the daily
//         trigger runs push → reload → charge as ONE serialized operation.
//         New headless helper: _createStaxInvoicesForRows_(rowIndexes) refactored
//         out of createStaxInvoices() — reused by both the manual UI flow and the
//         new _prepareEligiblePendingInvoicesForChargeRun() prepare stage.
//         Expanded Run Log entries distinguish pushStage vs chargeStage stats.
//         Preserves existing duplicate protection (refKey check) and manual UX.
// v4.2.0: Trigger-safe _getSpreadsheet() replaces all getActiveSpreadsheet() calls.
//         Time-based triggers can now find the spreadsheet via Script Properties fallback.
//         Run setupSpreadsheetId() once from the spreadsheet menu to store the ID.
// Phase 1: Sheet setup + IIF file picker + parser
// Phase 2: Stax customer sync + invoice creation via API
// Phase 3: Due-date charge runner (auto daily trigger + manual button)
// Phase 4: Exception handling + send invoice pay links
//
// SETUP CHECKLIST (complete before first use):
//   1. Create a Google Cloud project linked to this Apps Script
//   2. Enable the Google Picker API in that Cloud project
//   3. Create a browser API key (restricted to Picker API)
//   4. Run Setup Sheets from the menu
//   5. Add your Stax API key to Config tab -> STAX_API_KEY
//   6. Add your Google Picker API key to Config tab -> GOOGLE_PICKER_API_KEY
//   7. Set ENVIRONMENT to 'sandbox' or 'production' in Config tab
//      (base URL is derived automatically — do not set it manually)
//   8. Add customer mappings to the Customers tab:
//      QB Customer Name | Stax Customer ID | Stax Name | Company | Email | Payment Method
//   9. Grant the script Drive read scope (triggered on first import)
// ============================================================

var SHEET_NAMES = {
  IMPORT:     'Import',
  INVOICES:   'Invoices',
  CUSTOMERS:  'Customers',
  CHARGE_LOG: 'Charge Log',
  EXCEPTIONS: 'Exceptions',
  CONFIG:     'Config',
  RUN_LOG:    'Run Log'
};

// Expected headers for each sheet — used by validation and repair
var EXPECTED_HEADERS = {
  'Import': {
    row: 4,
    cols: ['ROW_TYPE', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'COL9', 'COL10', 'COL11', 'COL12']
  },
  'Invoices': {
    row: 1,
    cols: ['QB Invoice #', 'QB Customer Name', 'Stax Customer ID', 'Invoice Date',
           'Due Date', 'Total Amount', 'Line Items JSON', 'Stax Invoice ID',
           'Status', 'Created At', 'Notes', 'Is Test', 'Auto Charge']
  },
  'Charge Log': {
    row: 1,
    cols: ['Timestamp', 'QB Invoice #', 'Stax Invoice ID', 'Stax Customer ID',
           'Customer Name', 'Amount', 'Status', 'Stax Transaction ID', 'Notes']
  },
  'Exceptions': {
    row: 1,
    cols: ['Timestamp', 'QB Invoice #', 'QB Customer Name', 'Stax Customer ID',
           'Amount', 'Due Date', 'Reason', 'Stax Invoice Link', 'Resolved']
  },
  'Customers': {
    row: 1,
    cols: ['QB Customer Name', 'Stax Company Name', 'Stax Customer Name',
           'Stax Customer ID', 'Stax Customer Email', 'Payment Method',
           'Notes']
  },
  'Config': {
    row: 1,
    cols: ['Key', 'Value']
  },
  'Run Log': {
    row: 1,
    cols: ['Timestamp', 'Function', 'Summary', 'Details']
  }
};

// Stax API base URLs per environment
// Stax uses the same base URL for sandbox and production.
// Sandbox vs production is determined by the API key, not the URL.
var STAX_URLS = {
  sandbox:    'https://apiprod.fattlabs.com',
  production: 'https://apiprod.fattlabs.com'
};

// HTTP status codes that are safe to retry
var RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

/**
 * v4.2.0: Trigger-safe spreadsheet accessor.
 * getActiveSpreadsheet() returns null when called from a time-based trigger
 * if the script project became unbound during a push. This helper falls back
 * to openById using STAX_SPREADSHEET_ID from Script Properties.
 */
function _getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  // Fallback: read ID from Script Properties (set once via menu or manually)
  var id = PropertiesService.getScriptProperties().getProperty("STAX_SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);
  throw new Error("Cannot access Stax spreadsheet — getActiveSpreadsheet() returned null and STAX_SPREADSHEET_ID not set in Script Properties. Run setupSpreadsheetId() from the editor.");
}

/** One-time setup: stores the bound spreadsheet ID in Script Properties so triggers can find it. */
function setupSpreadsheetId() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Run this from the Stax Auto Pay spreadsheet, not standalone. Open the spreadsheet first, then Extensions → Apps Script → Run.");
  PropertiesService.getScriptProperties().setProperty("STAX_SPREADSHEET_ID", ss.getId());
  SpreadsheetApp.getUi().alert("Spreadsheet ID saved to Script Properties: " + ss.getId());
}

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Stax Auto-Pay')
    .addItem('Setup Sheets', 'setupSheets')
    .addSeparator()
    .addItem('Import IIF File', 'showFilePicker')
    .addItem('Pull Customers (CB + Stax)', 'pullStaxCustomers')
    .addItem('Sync Customers with Stax', 'syncCustomers')
    .addItem('Create Stax Invoices', 'createStaxInvoices')
    .addItem('Run Charges Now', 'runCharges')
    .addSeparator()
    .addItem('Review Exceptions', 'reviewExceptions')
    .addItem('Send Pay Links (Failed Charges)', 'sendPayLinks')
    .addItem('Send Pay Link (Single Invoice)', 'sendSinglePayLink')
    .addItem('Mark Exception Resolved', 'markExceptionResolved')
    .addSeparator()
    .addItem('Enable Daily Auto-Charge', 'setupDailyTrigger')
    .addItem('Disable Daily Auto-Charge', 'removeDailyTrigger')
    .addSeparator()
    .addItem('Validate Sheets', 'validateSheetsUI')
    .addItem('Deduplicate Invoices', 'deduplicateInvoices')
    .addItem('Reset Operational Sheets...', 'resetOperationalSheets')
    .addToUi();
}

// ============================================================
// DEDUPLICATE INVOICES — one-shot cleanup for rows created by both
// the IIF Import path (StaxAutoPay) and the QB Export auto-import
// path (StrideAPI.gs handleQbExport_) before the date-normalization
// fix in v38.118.0. Keeps the OLDEST row (by row number) for each
// unique dedup key; deletes the rest.
// ============================================================
function deduplicateInvoices() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAMES.INVOICES);
  if (!sh) { ui.alert('Invoices sheet not found.'); return; }

  var lr = sh.getLastRow();
  if (lr < 2) { ui.alert('No invoice rows to dedupe.'); return; }

  var data = sh.getDataRange().getValues();
  var seen = {};            // key → first row (1-based) that had it
  var rowsToDelete = [];    // rows to delete, descending

  for (var r = 1; r < data.length; r++) {
    var docNum = String(data[r][0] || '').trim();
    if (!docNum) continue;  // skip blank invoice rows
    // Skip rows already marked DELETED — they're tombstones
    var status = String(data[r][8] || '').trim().toUpperCase();
    if (status === 'DELETED') continue;

    var key = _invoiceKey(docNum, String(data[r][1] || ''), data[r][5], data[r][3]);
    if (seen[key] === undefined) {
      seen[key] = r + 1;
    } else {
      // Duplicate — keep the older row (lower row number), delete this one
      rowsToDelete.push(r + 1);
    }
  }

  if (rowsToDelete.length === 0) {
    ui.alert('No duplicates found.');
    return;
  }

  var resp = ui.alert(
    'Remove duplicates?',
    'Found ' + rowsToDelete.length + ' duplicate invoice row(s). ' +
    'The OLDEST copy of each is kept; extras will be deleted.\n\n' +
    'This cannot be undone.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  // Delete descending so row indexes stay stable
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var d = 0; d < rowsToDelete.length; d++) {
    sh.deleteRow(rowsToDelete[d]);
  }
  ui.alert('Removed ' + rowsToDelete.length + ' duplicate row(s).');
}

// ============================================================
// SETUP — Safe for reruns. Creates missing sheets and repairs
// headers on empty/corrupted sheets. Never wipes existing data.
// ============================================================
function setupSheets() {
  var ss = _getSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  _ensureSheetSafe(ss, SHEET_NAMES.IMPORT, [
    ['IIF Import', '', '', '', '', '', '', '', '', '', '', ''],
    ['Last Imported File', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['ROW_TYPE', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'COL9', 'COL10', 'COL11', 'COL12']
  ]);

  _ensureSheetSafe(ss, SHEET_NAMES.INVOICES, [[
    'QB Invoice #', 'QB Customer Name', 'Stax Customer ID', 'Invoice Date',
    'Due Date', 'Total Amount', 'Line Items JSON', 'Stax Invoice ID',
    'Status', 'Created At', 'Notes'
  ]]);

  _ensureSheetSafe(ss, SHEET_NAMES.CHARGE_LOG, [[
    'Timestamp', 'QB Invoice #', 'Stax Invoice ID', 'Stax Customer ID',
    'Customer Name', 'Amount', 'Status', 'Stax Transaction ID', 'Notes'
  ]]);

  _ensureSheetSafe(ss, SHEET_NAMES.EXCEPTIONS, [[
    'Timestamp', 'QB Invoice #', 'QB Customer Name', 'Stax Customer ID',
    'Amount', 'Due Date', 'Reason', 'Stax Invoice Link', 'Resolved'
  ]]);

  _ensureSheetSafe(ss, SHEET_NAMES.CUSTOMERS, [[
    'QB Customer Name', 'Stax Company Name', 'Stax Customer Name',
    'Stax Customer ID', 'Stax Customer Email', 'Payment Method',
    'Notes'
  ]]);

  _ensureSheetSafe(ss, SHEET_NAMES.CONFIG, [
    ['Key', 'Value'],
    ['STAX_API_KEY', ''],
    ['STAX_INVOICE_PAY_URL', 'https://app.staxpayments.com/#/bill/'],
    ['GOOGLE_PICKER_API_KEY', ''],
    ['CB_SPREADSHEET_ID', ''],
    ['AUTO_CHARGE_ENABLED', 'TRUE'],
    ['NOTIFY_ON_EXCEPTION', 'TRUE'],
    ['ENVIRONMENT', 'sandbox']
  ]);

  _ensureSheetSafe(ss, SHEET_NAMES.RUN_LOG, [[
    'Timestamp', 'Function', 'Summary', 'Details'
  ]]);

  ui.alert(
    'Stax Auto-Pay sheets are ready.\n\n' +
    'Next steps:\n' +
    '1. Set ENVIRONMENT in Config tab (sandbox or production)\n' +
    '2. Add your Stax API key to the Config tab\n' +
    '3. Add your Google Picker API key to the Config tab\n' +
    '4. Add customer mappings to the Customers tab'
  );
}

// ============================================================
// RESET — Explicit destructive action with confirmation dialog.
// ============================================================
function resetOperationalSheets() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    'Reset Operational Sheets',
    'This will permanently delete all data in Import, Invoices, Charge Log, Exceptions, and Run Log.\n\n' +
    'Config and Customers will NOT be affected.\n\n' +
    'Are you sure?',
    ui.ButtonSet.YES_NO
  );
  if (result !== ui.Button.YES) return;

  var ss = _getSpreadsheet();

  _ensureSheet(ss, SHEET_NAMES.IMPORT, [
    ['IIF Import', '', '', '', '', '', '', '', '', '', '', ''],
    ['Last Imported File', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['ROW_TYPE', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'COL9', 'COL10', 'COL11', 'COL12']
  ]);

  _ensureSheet(ss, SHEET_NAMES.INVOICES, [[
    'QB Invoice #', 'QB Customer Name', 'Stax Customer ID', 'Invoice Date',
    'Due Date', 'Total Amount', 'Line Items JSON', 'Stax Invoice ID',
    'Status', 'Created At', 'Notes'
  ]]);

  _ensureSheet(ss, SHEET_NAMES.CHARGE_LOG, [[
    'Timestamp', 'QB Invoice #', 'Stax Invoice ID', 'Stax Customer ID',
    'Customer Name', 'Amount', 'Status', 'Stax Transaction ID', 'Notes'
  ]]);

  _ensureSheet(ss, SHEET_NAMES.EXCEPTIONS, [[
    'Timestamp', 'QB Invoice #', 'QB Customer Name', 'Stax Customer ID',
    'Amount', 'Due Date', 'Reason', 'Stax Invoice Link', 'Resolved'
  ]]);

  _ensureSheet(ss, SHEET_NAMES.RUN_LOG, [[
    'Timestamp', 'Function', 'Summary', 'Details'
  ]]);

  ui.alert('Operational sheets have been reset. Config and Customers were not changed.');
}

// ============================================================
// VALIDATE SHEETS
// ============================================================
function _validateSheets() {
  var ss = _getSpreadsheet();
  var errors = [];

  for (var name in EXPECTED_HEADERS) {
    var expected = EXPECTED_HEADERS[name];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      errors.push('Missing sheet: "' + name + '"');
      continue;
    }
    if (sheet.getLastRow() < expected.row) {
      errors.push('"' + name + '" is empty or missing header row ' + expected.row);
      continue;
    }
    var headerRange = sheet.getRange(expected.row, 1, 1, expected.cols.length);
    var headerValues = headerRange.getValues()[0].map(String);
    for (var c = 0; c < expected.cols.length; c++) {
      if (headerValues[c] !== expected.cols[c]) {
        errors.push('"' + name + '" column ' + (c + 1) + ' expected "' +
                     expected.cols[c] + '" but found "' + headerValues[c] + '"');
      }
    }
  }

  return errors;
}

function validateSheetsUI() {
  var ui = SpreadsheetApp.getUi();
  var errors = _validateSheets();
  if (errors.length === 0) {
    ui.alert('All sheets are valid.');
  } else {
    ui.alert('Sheet validation errors:\n\n' + errors.join('\n'));
  }
}

// ============================================================
// _ensureSheet — creates or clears sheet and writes all rows
// (used only by resetOperationalSheets)
// ============================================================
function _ensureSheet(ss, name, rows) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clearContents();
  }
  rows.forEach(function(row, i) {
    sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
  });
  var lastRow = rows[rows.length - 1];
  sheet.getRange(rows.length, 1, 1, lastRow.length).setFontWeight('bold');
  return sheet;
}

// ============================================================
// _ensureSheetSafe — creates sheet if missing, repairs headers
// if sheet exists but is empty or header row is wrong.
// Never deletes existing data rows.
// ============================================================
function _ensureSheetSafe(ss, name, rows) {
  var sheet = ss.getSheetByName(name);
  var expected = EXPECTED_HEADERS[name];

  if (!sheet) {
    sheet = ss.insertSheet(name);
    rows.forEach(function(row, i) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
    });
    var lastRow = rows[rows.length - 1];
    sheet.getRange(rows.length, 1, 1, lastRow.length).setFontWeight('bold');
  } else if (expected) {
    var headerRow = expected.row;
    var needsRepair = false;

    if (sheet.getLastRow() < headerRow) {
      needsRepair = true;
    } else {
      var currentHeaders = sheet.getRange(headerRow, 1, 1, expected.cols.length).getValues()[0];
      for (var c = 0; c < expected.cols.length; c++) {
        if (String(currentHeaders[c]) !== expected.cols[c]) {
          needsRepair = true;
          break;
        }
      }
    }

    if (needsRepair) {
      for (var i = 0; i < rows.length; i++) {
        sheet.getRange(i + 1, 1, 1, rows[i].length).setValues([rows[i]]);
      }
      var lr = rows[rows.length - 1];
      sheet.getRange(rows.length, 1, 1, lr.length).setFontWeight('bold');
    }
  }

  return sheet;
}

// ============================================================
// CONFIG HELPERS
// ============================================================
function _getConfig(key) {
  var ss    = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return String(data[i][1]).trim();
  }
  return null;
}

function _getStaxBaseUrl() {
  var env = (_getConfig('ENVIRONMENT') || 'sandbox').toLowerCase();
  return STAX_URLS[env] || STAX_URLS.sandbox;
}

function _formatTimestamp(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function _normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

// ============================================================
// MULTI-TIER CLIENT LOOKUP (v4.7.0)
// ============================================================
//
// Builds a 3-tier client lookup map from CB Clients tab. Used by
// the autopay charge-eligibility gates to resolve which client
// owns an invoice. The primary key is Stax Customer ID (GUID,
// bulletproof); falls back to QB_CUSTOMER_NAME (handles QB-tagged
// names like "K&M Interiors (ACH on File)" that don't appear in
// CLIENT NAME); falls back finally to CLIENT NAME for back-compat
// with rows that haven't been onboarded with the other columns.
//
// Returns null if CB Clients can't be read for any reason — caller
// should treat it as "lookup unavailable, skip the gate".
function _buildClientAutoChargeLookup_(cbSheet) {
  if (!cbSheet) return null;
  try {
    var data = cbSheet.getDataRange().getValues();
    if (data.length < 2) return null;
    var hdr = data[0].map(function(h) { return String(h).trim().toUpperCase(); });
    var nameIdx     = hdr.indexOf("CLIENT NAME");
    var qbIdx       = hdr.indexOf("QB_CUSTOMER_NAME");
    var staxIdIdx   = hdr.indexOf("STAX CUSTOMER ID");
    var autoIdx     = hdr.indexOf("AUTO CHARGE");
    if (autoIdx < 0) return null;       // can't determine eligibility without it
    var byStaxId    = {};
    var byQbName    = {};
    var byClientName = {};
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var ac  = row[autoIdx];
      var acBool = (ac === true || String(ac).toUpperCase() === "TRUE");
      if (staxIdIdx >= 0) {
        var sid = String(row[staxIdIdx] || "").trim();
        if (sid) byStaxId[sid] = acBool;
      }
      if (qbIdx >= 0) {
        var qb = String(row[qbIdx] || "").trim();
        if (qb) byQbName[qb.toLowerCase()] = acBool;
      }
      if (nameIdx >= 0) {
        var cn = String(row[nameIdx] || "").trim();
        if (cn) byClientName[cn.toLowerCase()] = acBool;
      }
    }
    return { byStaxId: byStaxId, byQbName: byQbName, byClientName: byClientName };
  } catch (e) {
    Logger.log("_buildClientAutoChargeLookup_ warning: " + e);
    return null;
  }
}

// Resolves Auto Charge for an invoice by trying the 3 lookup tiers
// in order: Stax Customer ID → QB customer name → CB Client Name.
// Returns:
//   true       — client found, Auto Charge ON
//   false      — client found, Auto Charge OFF (CLIENT_AUTO_DISABLED)
//   undefined  — no tier matched (UNKNOWN_CLIENT)
//
// `lookups` is the object returned by _buildClientAutoChargeLookup_;
// pass null to short-circuit to undefined (treats unavailable lookup
// as "unknown" so the charge run logs a clear exception rather than
// silently allowing an unguarded charge).
function _resolveClientAutoCharge_(lookups, staxCustId, custName) {
  if (!lookups) return undefined;
  if (staxCustId) {
    var bySid = lookups.byStaxId[String(staxCustId).trim()];
    if (bySid !== undefined) return bySid;
  }
  if (custName) {
    var lc = String(custName).trim().toLowerCase();
    var byQb = lookups.byQbName[lc];
    if (byQb !== undefined) return byQb;
    var byCn = lookups.byClientName[lc];
    if (byCn !== undefined) return byCn;
  }
  return undefined;
}

// ============================================================
// PREFLIGHT CHECKS
// ============================================================

// Basic preflight: ensures required sheets exist before import
function _preflightCheck() {
  var ss = _getSpreadsheet();
  var required = [SHEET_NAMES.IMPORT, SHEET_NAMES.INVOICES, SHEET_NAMES.CUSTOMERS, SHEET_NAMES.EXCEPTIONS];
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    if (!ss.getSheetByName(required[i])) {
      missing.push(required[i]);
    }
  }
  if (missing.length > 0) {
    return 'Missing required sheet(s): ' + missing.join(', ') +
           '. Please run Setup Sheets from the Stax Auto-Pay menu first.';
  }
  return null;
}

// API preflight: validates config + sheets before any Stax API call
function _preflightApiCheck() {
  var sheetCheck = _preflightCheck();
  if (sheetCheck) return sheetCheck;

  // Also check Run Log exists (non-blocking — create if missing)
  var ss = _getSpreadsheet();
  if (!ss.getSheetByName(SHEET_NAMES.RUN_LOG)) {
    _ensureSheetSafe(ss, SHEET_NAMES.RUN_LOG, [[
      'Timestamp', 'Function', 'Summary', 'Details'
    ]]);
  }

  var apiKey = _getConfig('STAX_API_KEY');
  if (!apiKey) {
    return 'STAX_API_KEY is not set in the Config tab. Please add your Stax API key.';
  }

  var env = _getConfig('ENVIRONMENT');
  if (!env || (env.toLowerCase() !== 'sandbox' && env.toLowerCase() !== 'production')) {
    return 'ENVIRONMENT must be set to "sandbox" or "production" in the Config tab.';
  }

  return null;
}

// ============================================================
// STAX API CORE — request helper with retry/backoff
// ============================================================

// Rate limiter state (reset per script execution)
var _rateLimitState = { count: 0, windowStart: 0 };

function _throttle() {
  var now = Date.now();
  // Reset window every 60 seconds
  if (now - _rateLimitState.windowStart > 60000) {
    _rateLimitState.count = 0;
    _rateLimitState.windowStart = now;
  }
  // If approaching 90 requests in this window, pause until window resets
  if (_rateLimitState.count >= 88) {
    var waitMs = 60000 - (now - _rateLimitState.windowStart) + 1000;
    if (waitMs > 0) {
      Utilities.sleep(waitMs);
    }
    _rateLimitState.count = 0;
    _rateLimitState.windowStart = Date.now();
  }
  _rateLimitState.count++;
}

// Makes a Stax API request with retry logic.
// Returns { success: bool, status: number, data: object|null, error: string }
function _staxApiRequest(method, path, payload) {
  var apiKey  = _getConfig('STAX_API_KEY');
  var baseUrl = _getStaxBaseUrl();
  var url     = baseUrl + path;
  var methodUpper = method.toUpperCase();
  var methodLower = method.toLowerCase();

  var options = {
    method: methodLower,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true,
    contentType: 'application/json'
  };

  if (payload && (methodUpper === 'POST' || methodUpper === 'PUT' || methodUpper === 'PATCH')) {
    options.payload = JSON.stringify(payload);
  }

  var maxRetries = 3;
  var backoffMs = [2000, 4000, 8000];

  for (var attempt = 0; attempt < maxRetries; attempt++) {
    _throttle();

    try {
      var response = UrlFetchApp.fetch(url, options);
      var status   = response.getResponseCode();
      var body     = response.getContentText();

      // Parse JSON response
      var data = null;
      try {
        data = JSON.parse(body);
      } catch (e) {
        // Non-JSON response
      }

      // Success
      if (status >= 200 && status < 300) {
        return { success: true, status: status, data: data, error: null };
      }

      // Non-retryable errors — return immediately
      if (RETRYABLE_STATUS_CODES.indexOf(status) === -1) {
        var errMsg = 'HTTP ' + status;
        if (data && data.message) errMsg += ': ' + data.message;
        else if (data && data.error) errMsg += ': ' + data.error;
        else if (body) errMsg += ': ' + body.substring(0, 200);
        return { success: false, status: status, data: data, error: errMsg };
      }

      // Retryable — sleep and try again
      if (attempt < maxRetries - 1) {
        Utilities.sleep(backoffMs[attempt]);
      }

    } catch (e) {
      // Network error — retry
      if (attempt < maxRetries - 1) {
        Utilities.sleep(backoffMs[attempt]);
      } else {
        return { success: false, status: 0, data: null, error: 'Network error: ' + e.message };
      }
    }
  }

  return { success: false, status: 0, data: null, error: 'Max retries exceeded' };
}

// ============================================================
// RUN LOG — writes summary to the Run Log tab
// ============================================================
function _writeRunLog(funcName, summary, details) {
  var ss = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.RUN_LOG);
  if (!sheet) return;

  var row = [
    _formatTimestamp(new Date()),
    funcName,
    summary,
    details || ''
  ];

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// ============================================================
// SUPABASE WRITE-THROUGH (session 69 / v4.6.0)
// Best-effort mirror of Stax spreadsheet → Supabase caches.
// Never throws; never blocks a sheet write on Supabase failure.
// ============================================================

/** Batch upsert to a Supabase table. Best-effort, never throws.
 *
 * v4.7.2 — De-duplicate rows by their on_conflict key BEFORE sending.
 *          PostgreSQL rejects an entire UPSERT statement with code 21000
 *          ("ON CONFLICT DO UPDATE command cannot affect row a second
 *          time") if two rows in the batch share the same on_conflict
 *          value. This was the source of the stax_invoices HTTP 500
 *          Justin reported after running _sbResyncAllStaxInvoices —
 *          the Invoices sheet had duplicate QB Invoice # rows and the
 *          whole batch rolled back, so Supabase stayed empty.
 *          Also adds row-by-row retry on chunk failure so a single
 *          bad row no longer kills the whole batch, plus surfaces the
 *          failure into stax_run_log + the Run Log sheet via
 *          _sbLogSyncError so silent Supabase errors stop hiding.
 */
function _sbBatchUpsert(table, rows, conflictCol) {
  if (!rows || !rows.length) return;
  try {
    var url = PropertiesService.getScriptProperties().getProperty("SUPABASE_URL");
    var key = PropertiesService.getScriptProperties().getProperty("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;

    // De-dupe by the on_conflict key (last occurrence wins, preserves order).
    if (conflictCol) {
      var keyCols = conflictCol.split(",").map(function(s) { return s.trim(); });
      var seen = {};
      var deduped = [];
      for (var d = rows.length - 1; d >= 0; d--) {
        var dk = keyCols.map(function(c) { return String(rows[d][c] == null ? "" : rows[d][c]); }).join("||");
        if (!seen[dk]) { seen[dk] = true; deduped.unshift(rows[d]); }
      }
      rows = deduped;
    }

    var CHUNK = 50;
    for (var i = 0; i < rows.length; i += CHUNK) {
      var chunk = rows.slice(i, i + CHUNK);
      var postUrl = url + "/rest/v1/" + table;
      if (conflictCol) postUrl += "?on_conflict=" + conflictCol;
      var resp = UrlFetchApp.fetch(postUrl, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + key,
          "apikey":        key,
          "Content-Type":  "application/json",
          "Prefer":        "resolution=merge-duplicates,return=minimal"
        },
        payload: JSON.stringify(chunk),
        muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      if (code < 200 || code >= 300) {
        var errBody = resp.getContentText().substring(0, 500);
        Logger.log("_sbBatchUpsert " + table + " chunk " + i + " HTTP " + code + ": " + errBody);
        try { _sbLogSyncError(table, code, errBody, chunk.length, chunk[0]); } catch (logErr) {}
        // Retry row-by-row to isolate bad rows so one duplicate doesn't
        // wipe out the whole chunk.
        for (var ri = 0; ri < chunk.length; ri++) {
          try {
            var singleResp = UrlFetchApp.fetch(postUrl, {
              method: "POST",
              headers: {
                "Authorization": "Bearer " + key,
                "apikey":        key,
                "Content-Type":  "application/json",
                "Prefer":        "resolution=merge-duplicates,return=minimal"
              },
              payload: JSON.stringify([chunk[ri]]),
              muteHttpExceptions: true
            });
            var sc = singleResp.getResponseCode();
            if (sc < 200 || sc >= 300) {
              Logger.log("_sbBatchUpsert " + table + " row " + (i + ri) + " HTTP " + sc + ": " + singleResp.getContentText().substring(0, 300));
            }
          } catch (rowErr) { /* skip bad row */ }
        }
      }
    }
  } catch (e) {
    Logger.log("_sbBatchUpsert " + table + " error (non-fatal): " + e);
    try { _sbLogSyncError(table, 0, String(e), (rows && rows.length) || 0, rows && rows[0]); } catch (_) {}
  }
}

/**
 * v4.7.2 — Companion to _sbBatchUpsert. Writes a Supabase write-failure
 * row into stax_run_log + the Run Log sheet so silent failures show up
 * in the Payments app's Run Log tab. Uses a direct REST POST (not
 * _sbBatchUpsert) and short-circuits on stax_run_log itself to avoid
 * loop risk. Mirror of StrideAPI.gs:sbLogSyncError_ from v38.132.0.
 */
function _sbLogSyncError(table, httpCode, errorBody, rowCount, sampleRow) {
  if (table === "stax_run_log") return;
  var url = PropertiesService.getScriptProperties().getProperty("SUPABASE_URL");
  var key = PropertiesService.getScriptProperties().getProperty("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;

  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var summary = "_sbBatchUpsert " + table + " HTTP " + httpCode +
                " (" + (rowCount || 0) + " rows): " +
                String(errorBody || "").substring(0, 200);
  var details = "";
  try {
    if (sampleRow) {
      details = "sampleKeys=" + Object.keys(sampleRow).join(",") +
                " | sample=" + JSON.stringify(sampleRow).substring(0, 400);
    }
  } catch (_) {}

  var row = { timestamp: ts, fn: "_sbBatchUpsert", summary: summary, details: details };
  try {
    UrlFetchApp.fetch(url + "/rest/v1/stax_run_log?on_conflict=timestamp,fn,summary", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "apikey":        key,
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates,return=minimal"
      },
      payload: JSON.stringify([row]),
      muteHttpExceptions: true
    });
  } catch (_) {}

  try {
    var ss = _getSpreadsheet();
    var rlSheet = ss && ss.getSheetByName(SHEET_NAMES.RUN_LOG || "Run Log");
    if (rlSheet) rlSheet.appendRow([ts, "_sbBatchUpsert", summary, details]);
  } catch (_) {}
}

/**
 * Read the full Invoices tab and push to public.stax_invoices.
 * Called at the end of _prepareEligiblePendingInvoicesForChargeRun and
 * _executeChargeRun so Supabase reflects the latest statuses.
 */
function _sbResyncAllStaxInvoices(ss) {
  try {
    if (!ss) ss = _getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var headers = data[0].map(function(h) { return String(h).trim(); });
    function col(name) { return headers.indexOf(name); }
    var cQb = col("QB Invoice #");
    var cCust = col("QB Customer Name");
    var cStaxCust = col("Stax Customer ID");
    var cInvDate = col("Invoice Date");
    var cDueDate = col("Due Date");
    var cSchedDate = col("Scheduled Date");  // v38.120.0 — optional column, auto-created on first edit
    var cAmount = col("Total Amount");
    var cLineItems = col("Line Items JSON");
    var cStaxId = col("Stax Invoice ID");
    var cStatus = col("Status");
    var cCreated = col("Created At");
    var cNotes = col("Notes");
    var cIsTest = col("Is Test");
    var cAutoCharge = col("Auto Charge");
    if (cQb < 0 || cStatus < 0) return;
    var rows = [];
    var now = new Date().toISOString();
    for (var i = 1; i < data.length; i++) {
      var qb = String(data[i][cQb] || "").trim();
      if (!qb) continue;
      var staxCustId = cStaxCust >= 0 ? String(data[i][cStaxCust] || "") : "";
      rows.push({
        qb_invoice_no: qb,
        row_index: i + 1,
        customer: cCust >= 0 ? String(data[i][cCust] || "") : "",
        stax_customer_id: staxCustId,
        invoice_date: cInvDate >= 0 ? _formatDateLoose(data[i][cInvDate]) : "",
        due_date: cDueDate >= 0 ? _formatDateLoose(data[i][cDueDate]) : "",
        // v38.120.0 — Scheduled Date: when user has overridden it. Empty means
        // "use due date" — charge loop handles the fallback.
        scheduled_date: cSchedDate >= 0 && data[i][cSchedDate] ? _formatDateLoose(data[i][cSchedDate]) : null,
        amount: cAmount >= 0 ? Number(data[i][cAmount] || 0) : 0,
        line_items_json: cLineItems >= 0 ? String(data[i][cLineItems] || "") : "",
        stax_id: cStaxId >= 0 ? String(data[i][cStaxId] || "") : "",
        status: cStatus >= 0 ? String(data[i][cStatus] || "") : "",
        created_at_sheet: cCreated >= 0 ? _formatDateLoose(data[i][cCreated]) : "",
        notes: cNotes >= 0 ? String(data[i][cNotes] || "") : "",
        is_test: cIsTest >= 0 ? String(data[i][cIsTest] || "").toUpperCase() === "TRUE" : false,
        // v4.7.2 — boolean false in the Sheet cell (native checkbox value)
        // was misread as "default true" because `false || ""` evaluates to
        // "" in JS. Mirror of StrideAPI.gs:stax_parseAutoCharge_.
        auto_charge: (function(v) {
          if (v === false) return false;
          if (v === true) return true;
          var s = String(v == null ? "" : v).toUpperCase();
          return !(s === "FALSE" || s === "NO" || s === "OFF");
        })(cAutoCharge >= 0 ? data[i][cAutoCharge] : true),
        payment_method_status: staxCustId ? "unknown" : "no_customer",
        updated_at: now
      });
    }
    _sbBatchUpsert("stax_invoices", rows, "qb_invoice_no");
  } catch (e) { Logger.log("_sbResyncAllStaxInvoices error (non-fatal): " + e); }
}

/**
 * Read the Charge Log tab and push ALL rows (idempotent via unique index on
 * timestamp + qb_invoice_no + txn_id). Called at end of _executeChargeRun.
 */
function _sbResyncAllStaxCharges(ss) {
  try {
    if (!ss) ss = _getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.CHARGE_LOG);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var headers = data[0].map(function(h) { return String(h).trim(); });
    function col(name) { return headers.indexOf(name); }
    var cTs = col("Timestamp");
    var cQb = col("QB Invoice #");
    var cStaxInv = col("Stax Invoice ID");
    var cStaxCust = col("Stax Customer ID");
    var cCust = col("Customer");
    var cAmount = col("Amount");
    var cStatus = col("Status");
    var cTxn = col("Transaction ID");
    var cNotes = col("Notes");
    var rows = [];
    // Limit to the tail 1000 rows — no need to re-upsert ancient entries each run
    var startRow = Math.max(1, data.length - 1000);
    for (var i = startRow; i < data.length; i++) {
      rows.push({
        timestamp: cTs >= 0 ? _formatDateLoose(data[i][cTs]) : "",
        qb_invoice_no: cQb >= 0 ? String(data[i][cQb] || "") : "",
        stax_invoice_id: cStaxInv >= 0 ? String(data[i][cStaxInv] || "") : "",
        stax_customer_id: cStaxCust >= 0 ? String(data[i][cStaxCust] || "") : "",
        customer: cCust >= 0 ? String(data[i][cCust] || "") : "",
        amount: cAmount >= 0 ? Number(data[i][cAmount] || 0) : 0,
        status: cStatus >= 0 ? String(data[i][cStatus] || "") : "",
        txn_id: cTxn >= 0 ? String(data[i][cTxn] || "") : "",
        notes: cNotes >= 0 ? String(data[i][cNotes] || "") : ""
      });
    }
    _sbBatchUpsert("stax_charges", rows, "timestamp,qb_invoice_no,txn_id");
  } catch (e) { Logger.log("_sbResyncAllStaxCharges error (non-fatal): " + e); }
}

/** Read the Run Log tab tail and upsert to stax_run_log. */
function _sbResyncStaxRunLog(ss) {
  try {
    if (!ss) ss = _getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.RUN_LOG);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var headers = data[0].map(function(h) { return String(h).trim(); });
    function col(name) { return headers.indexOf(name); }
    var cTs = col("Timestamp");
    var cFn = col("Function");
    var cSum = col("Summary");
    var cDet = col("Details");
    var rows = [];
    var startRow = Math.max(1, data.length - 500);
    for (var i = startRow; i < data.length; i++) {
      rows.push({
        timestamp: cTs >= 0 ? _formatDateLoose(data[i][cTs]) : "",
        fn: cFn >= 0 ? String(data[i][cFn] || "") : "",
        summary: cSum >= 0 ? String(data[i][cSum] || "") : "",
        details: cDet >= 0 ? String(data[i][cDet] || "") : ""
      });
    }
    _sbBatchUpsert("stax_run_log", rows, "timestamp,fn,summary");
  } catch (e) { Logger.log("_sbResyncStaxRunLog error (non-fatal): " + e); }
}

/** Read Exceptions tab tail and upsert to stax_exceptions. */
function _sbResyncStaxExceptions(ss) {
  try {
    if (!ss) ss = _getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.EXCEPTIONS);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var headers = data[0].map(function(h) { return String(h).trim(); });
    function col(name) { return headers.indexOf(name); }
    var rows = [];
    var startRow = Math.max(1, data.length - 500);
    for (var i = startRow; i < data.length; i++) {
      rows.push({
        timestamp:        col("Timestamp") >= 0 ? _formatDateLoose(data[i][col("Timestamp")]) : "",
        qb_invoice_no:    col("QB Invoice #") >= 0 ? String(data[i][col("QB Invoice #")] || "") : "",
        customer:         col("Customer") >= 0 ? String(data[i][col("Customer")] || "") : "",
        stax_customer_id: col("Stax Customer ID") >= 0 ? String(data[i][col("Stax Customer ID")] || "") : "",
        amount:           col("Amount") >= 0 ? Number(data[i][col("Amount")] || 0) : 0,
        due_date:         col("Due Date") >= 0 ? _formatDateLoose(data[i][col("Due Date")]) : "",
        reason:           col("Reason") >= 0 ? String(data[i][col("Reason")] || "") : "",
        pay_link:         col("Pay Link") >= 0 ? String(data[i][col("Pay Link")] || "") : "",
        resolved:         col("Resolved") >= 0 ? String(data[i][col("Resolved")] || "").toUpperCase() === "TRUE" : false
      });
    }
    _sbBatchUpsert("stax_exceptions", rows, "timestamp,qb_invoice_no");
  } catch (e) { Logger.log("_sbResyncStaxExceptions error (non-fatal): " + e); }
}

/** Tolerant date formatter — Date → yyyy-MM-dd HH:mm:ss; passthrough for strings. */
function _formatDateLoose(v) {
  if (!v) return "";
  try {
    if (v instanceof Date) {
      return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    }
    return String(v);
  } catch (e) { return String(v || ""); }
}

// ============================================================
// EXCEPTION LOGGER — standardized format
// ============================================================
function _logException(docNum, name, staxId, amount, dueDate, reason, link) {
  var ss = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.EXCEPTIONS);
  if (!sheet) return;

  var row = [
    _formatTimestamp(new Date()),
    docNum || '',
    name || '',
    staxId || '',
    amount || '',
    dueDate || '',
    reason || '',
    link || '',
    ''  // Resolved
  ];

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// ============================================================
// PULL CUSTOMERS — reads active clients from Consolidated Billing,
// then enriches with Stax data for those that have a Stax Customer ID.
// Flags missing IDs so the user knows what to fix in the CB Clients tab.
// ============================================================
function pullStaxCustomers() {
  var ui = SpreadsheetApp.getUi();

  var preflight = _preflightApiCheck();
  if (preflight) {
    ui.alert(preflight);
    return;
  }

  // Must have CB_SPREADSHEET_ID configured
  var cbId = _getConfig('CB_SPREADSHEET_ID');
  if (!cbId) {
    ui.alert('CB_SPREADSHEET_ID is not set in the Config tab.\n\n' +
      'Add your Consolidated Billing spreadsheet ID to Config so the script can read your Clients tab.');
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Another operation is in progress. Please try again in a moment.');
    return;
  }

  try {
    var ss = _getSpreadsheet();
    var custSheet = ss.getSheetByName(SHEET_NAMES.CUSTOMERS);

    // Clear existing data (below header) — full refresh each time
    var lastRow = custSheet.getLastRow();
    if (lastRow > 1) {
      custSheet.getRange(2, 1, lastRow - 1, custSheet.getLastColumn()).clearContent();
    }

    // --- Step 1: Read active clients from Consolidated Billing ---
    var cbSs, cbClients, cbData;
    try {
      cbSs = SpreadsheetApp.openById(cbId);
      cbClients = cbSs.getSheetByName('Clients');
      if (!cbClients) {
        ui.alert('Could not find "Clients" tab in the Consolidated Billing sheet.');
        return;
      }
      cbData = cbClients.getDataRange().getValues();
    } catch (e) {
      ui.alert('Failed to open Consolidated Billing sheet.\n\n' + e.message);
      return;
    }

    // Build header map from CB Clients tab
    var cbHeaders = {};
    for (var h = 0; h < cbData[0].length; h++) {
      cbHeaders[String(cbData[0][h]).trim().toUpperCase()] = h;
    }

    var clientNameIdx = cbHeaders['CLIENT NAME'];
    var qbNameIdx     = cbHeaders['QB_CUSTOMER_NAME'];
    var staxIdIdx     = cbHeaders['STAX CUSTOMER ID'];
    var activeIdx     = cbHeaders['ACTIVE'];
    var cbEmailIdx    = cbHeaders['CLIENT EMAIL'];
    var payTermsIdx   = cbHeaders['PAYMENT TERMS'];

    if (qbNameIdx === undefined) {
      ui.alert('QB_CUSTOMER_NAME column not found in Consolidated Billing Clients tab.');
      return;
    }

    // Collect active clients
    var clients = [];
    for (var r = 1; r < cbData.length; r++) {
      // Skip inactive
      if (activeIdx !== undefined) {
        var activeVal = String(cbData[r][activeIdx] || '').trim().toUpperCase();
        if (activeVal !== 'TRUE' && activeVal !== 'YES') continue;
      }

      var qbName = String(cbData[r][qbNameIdx] || '').trim();
      var clientName = clientNameIdx !== undefined ? String(cbData[r][clientNameIdx] || '').trim() : '';
      if (!qbName && !clientName) continue;

      clients.push({
        qbName:     qbName || clientName,
        clientName: clientName,
        staxId:     staxIdIdx !== undefined ? String(cbData[r][staxIdIdx] || '').trim() : '',
        cbEmail:    cbEmailIdx !== undefined ? String(cbData[r][cbEmailIdx] || '').trim() : '',
        payTerms:   payTermsIdx !== undefined ? String(cbData[r][payTermsIdx] || '').trim() : ''
      });
    }

    if (clients.length === 0) {
      ui.alert('No active clients found in Consolidated Billing Clients tab.');
      return;
    }

    // --- Step 2: For clients WITH a Stax ID, fetch Stax data ---
    var stats = { total: clients.length, hasStaxId: 0, missingStaxId: 0, apiErrors: 0 };
    var newRows = [];

    for (var i = 0; i < clients.length; i++) {
      var cl = clients[i];

      if (cl.staxId) {
        // Has Stax ID — fetch customer details from Stax
        stats.hasStaxId++;
        var custResult = _staxApiRequest('GET', '/customer/' + cl.staxId, null);

        if (custResult.success && custResult.data) {
          var cust = custResult.data;
          var personName = ((cust.firstname || '') + ' ' + (cust.lastname || '')).trim();
          // Use Stax company name if available, otherwise fall back to CB Client Name
          var companyName = cust.company_name || cl.clientName || '';
          var email = cust.email || cl.cbEmail;

          newRows.push([
            cl.qbName,     // QB Customer Name (from CB)
            companyName,   // Stax Company Name
            personName,    // Stax Customer Name
            cl.staxId,     // Stax Customer ID
            email,         // Stax Customer Email
            '',            // Payment Method — filled by Sync
            cl.payTerms    // Notes — payment terms from CB
          ]);
        } else {
          // Stax ID exists but API call failed
          stats.apiErrors++;
          newRows.push([
            cl.qbName,
            '',
            '',
            cl.staxId,
            cl.cbEmail,
            '',
            'API ERROR: Could not verify Stax ID'
          ]);
        }
      } else {
        // No Stax ID — flag it
        stats.missingStaxId++;
        newRows.push([
          cl.qbName,
          '',
          '',
          '⚠ MISSING — Add Stax ID to CB Clients tab',
          cl.cbEmail,
          '',
          cl.payTerms
        ]);
      }
    }

    // Write all rows
    if (newRows.length > 0) {
      custSheet.getRange(2, 1, newRows.length, newRows[0].length).setValues(newRows);
    }

    var summary = stats.total + ' active clients, ' +
      stats.hasStaxId + ' with Stax ID, ' +
      stats.missingStaxId + ' missing Stax ID, ' +
      stats.apiErrors + ' API errors';
    _writeRunLog('pullStaxCustomers', summary, JSON.stringify(stats));

    ui.alert('Pull Customers Complete\n\n' +
      'Active Clients: ' + stats.total + '\n' +
      'With Stax ID: ' + stats.hasStaxId + '\n' +
      'Missing Stax ID: ' + stats.missingStaxId + '\n' +
      'API Errors: ' + stats.apiErrors + '\n\n' +
      (stats.missingStaxId > 0
        ? 'Look for "MISSING" in column D. Add the Stax Customer ID\n' +
          'to the Consolidated Billing Clients tab, then re-run this.'
        : 'All clients have Stax IDs.'));

  } finally {
    lock.releaseLock();
  }
}

// Returns a human-readable payment method label: CC, Debit, ACH, or None
// If multiple active methods, returns them comma-separated (e.g. "CC, ACH")
function _getPaymentMethodLabel(pmData) {
  var methods = _extractArrayFromResponse(pmData);
  var types = {};

  for (var i = 0; i < methods.length; i++) {
    var pm = methods[i];
    // Skip deleted/purged
    if (pm.deleted_at || pm.purged_at) continue;

    var method = (pm.method || '').toLowerCase();
    var binType = (pm.bin_type || '').toLowerCase();

    if (method === 'bank') {
      types['ACH'] = true;
    } else if (method === 'card' || method === 'credit' || method === 'debit') {
      if (binType === 'debit') {
        types['Debit'] = true;
      } else {
        types['CC'] = true;
      }
    } else if (method) {
      types[method.toUpperCase()] = true;
    }
  }

  var labels = Object.keys(types);
  if (labels.length === 0) return 'None';
  return labels.join(', ');
}

// ============================================================
// AUTO-POPULATE CUSTOMERS — adds unique QB names from Invoices
// ============================================================
function autoPopulateCustomers() {
  var ui = SpreadsheetApp.getUi();
  var ss = _getSpreadsheet();
  var invSheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
  var custSheet = ss.getSheetByName(SHEET_NAMES.CUSTOMERS);

  if (!invSheet || !custSheet) {
    ui.alert('Missing Invoices or Customers tab. Run Setup Sheets first.');
    return;
  }

  var invData = invSheet.getDataRange().getValues();
  var custData = custSheet.getDataRange().getValues();

  // Build set of existing QB Customer Names (normalized)
  var existingNames = {};
  for (var c = 1; c < custData.length; c++) {
    var n = _normalizeName(String(custData[c][0]));
    if (n) existingNames[n] = true;
  }

  // Find unique QB customer names from Invoices that aren't in Customers yet
  var seen = {};
  var newRows = [];

  for (var i = 1; i < invData.length; i++) {
    var qbName = String(invData[i][1]).trim();
    if (!qbName) continue;

    var normalized = _normalizeName(qbName);
    if (existingNames[normalized] || seen[normalized]) continue;

    seen[normalized] = true;
    newRows.push([
      qbName,  // QB Customer Name
      '',      // Stax Company Name
      '',      // Stax Customer Name
      '',      // Stax Customer ID
      '',      // Stax Customer Email
      '',      // Payment Method
      ''       // Notes
    ]);
  }

  if (newRows.length === 0) {
    ui.alert('All customer names from the Invoices tab are already in the Customers tab.');
    return;
  }

  custSheet.getRange(custSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
    .setValues(newRows);

  ui.alert('Added ' + newRows.length + ' new customer name(s) to the Customers tab.\n\n' +
    'Next: Match these to Stax customers by filling in the Stax Customer ID (column B)\n' +
    'or email (column C), then run Sync Customers.');
}

// Extracts an array from a Stax API response that may be a flat array or { data: [...] }
function _extractArrayFromResponse(responseData) {
  if (Array.isArray(responseData)) return responseData;
  if (responseData && responseData.data && Array.isArray(responseData.data)) return responseData.data;
  return [];
}

// ============================================================
// PHASE 2: SYNC CUSTOMERS WITH STAX
// ============================================================
function syncCustomers() {
  var ui = SpreadsheetApp.getUi();

  // Preflight
  var preflight = _preflightApiCheck();
  if (preflight) {
    ui.alert(preflight);
    return;
  }

  // Concurrency lock
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Another operation is in progress. Please try again in a moment.');
    return;
  }

  try {
    var ss = _getSpreadsheet();
    var custSheet = ss.getSheetByName(SHEET_NAMES.CUSTOMERS);
    var custData = custSheet.getDataRange().getValues();

    if (custData.length <= 1) {
      ui.alert('No customers found in the Customers tab.');
      return;
    }

    // Counters for summary
    var stats = {
      verified: 0,
      hasPayment: 0,
      noPayment: 0,
      foundByEmail: 0,
      notFound: 0,
      ambiguous: 0,
      noIdentifier: 0,
      apiErrors: 0,
      companyPushed: 0,
      total: custData.length - 1
    };

    // Column layout: A=QB Name, B=Stax Company, C=Stax Name, D=Stax ID, E=Email, F=Payment Method, G=Notes
    var numRows = custData.length - 1;
    var colDRange = custSheet.getRange(2, 4, numRows, 1); // Stax Customer ID (col D)
    var colFRange = custSheet.getRange(2, 6, numRows, 1); // Payment Method (col F)
    var colDValues = colDRange.getValues();
    var colFValues = colFRange.getValues();
    var colDChanged = false;
    var colFChanged = false;

    for (var i = 0; i < numRows; i++) {
      var qbName   = String(custData[i + 1][0]).trim();
      var staxId   = String(colDValues[i][0]).trim();
      var email    = String(custData[i + 1][4]).trim(); // Column E

      if (!qbName) continue; // skip empty rows

      if (staxId) {
        // --- Branch 1: Has Stax ID — verify customer and check payment methods ---
        var custResult = _staxApiRequest('GET', '/customer/' + staxId, null);

        if (!custResult.success) {
          if (custResult.status === 404) {
            _logException('', qbName, staxId, '', '',
              'syncCustomers: NOT_FOUND - Stax Customer ID not found in Stax', '');
            stats.notFound++;
          } else {
            _logException('', qbName, staxId, '', '',
              'syncCustomers: API_ERROR - ' + custResult.error, '');
            stats.apiErrors++;
          }
          continue;
        }

        stats.verified++;

        // Push company name to Stax if Stax has none and we have one locally (col B)
        var localCompany = String(custData[i + 1][1]).trim(); // Col B = Stax Company Name
        var staxCompany = (custResult.data.company_name || '').trim();
        if (localCompany && !staxCompany) {
          var updateResult = _staxApiRequest('PUT', '/customer/' + staxId, {
            company_name: localCompany
          });
          if (updateResult.success) {
            stats.companyPushed++;
          } else {
            _logException('', qbName, staxId, '', '',
              'syncCustomers: PUSH_FAILED - Could not update company name: ' + (updateResult.error || 'Unknown'), '');
          }
        }

        // Check payment methods
        var pmResult = _staxApiRequest('GET', '/customer/' + staxId + '/payment-method', null);

        if (pmResult.success) {
          var pmLabel = _getPaymentMethodLabel(pmResult.data);

          if (String(colFValues[i][0]) !== pmLabel) {
            colFValues[i][0] = pmLabel;
            colFChanged = true;
          }

          if (pmLabel !== 'None') {
            stats.hasPayment++;
          } else {
            stats.noPayment++;
          }
        } else {
          _logException('', qbName, staxId, '', '',
            'syncCustomers: API_ERROR - Payment method check failed: ' + pmResult.error, '');
          stats.apiErrors++;
        }

      } else if (email) {
        // --- Branch 2: No Stax ID, has email — search Stax by email ---
        var searchResult = _staxApiRequest('GET', '/customer?email=' + encodeURIComponent(email), null);

        if (!searchResult.success) {
          _logException('', qbName, '', '', '',
            'syncCustomers: API_ERROR - Customer search failed: ' + searchResult.error, '');
          stats.apiErrors++;
          continue;
        }

        // Extract customer list from response
        var customers = _extractArrayFromResponse(searchResult.data);

        // Filter to exact email matches only
        var exactMatches = [];
        for (var j = 0; j < customers.length; j++) {
          if (customers[j].email &&
              customers[j].email.toLowerCase().trim() === email.toLowerCase()) {
            exactMatches.push(customers[j]);
          }
        }

        if (exactMatches.length === 0) {
          _logException('', qbName, '', '', '',
            'syncCustomers: NOT_FOUND - No Stax customer found with email ' + email, '');
          stats.notFound++;

        } else if (exactMatches.length === 1) {
          // Exactly one match — fill in the Stax Customer ID
          colDValues[i][0] = exactMatches[0].id;
          colDChanged = true;
          stats.foundByEmail++;

        } else {
          // Multiple matches — do NOT auto-link
          var matchIds = exactMatches.map(function(c) { return c.id; }).join(', ');
          _logException('', qbName, '', '', '',
            'syncCustomers: AMBIGUOUS_MATCH - ' + exactMatches.length +
            ' Stax customers found with email ' + email + '. IDs: ' + matchIds, '');
          stats.ambiguous++;
        }

      } else {
        // --- Branch 3: No ID and no email ---
        _logException('', qbName, '', '', '',
          'syncCustomers: NO_IDENTIFIER - No Stax Customer ID or email for this customer', '');
        stats.noIdentifier++;
      }
    }

    // Batch write updates
    if (colDChanged) colDRange.setValues(colDValues);
    if (colFChanged) colFRange.setValues(colFValues);

    // Build summary
    var summary = stats.verified + ' verified, ' +
                  stats.hasPayment + ' with payment method, ' +
                  stats.noPayment + ' without payment method, ' +
                  stats.foundByEmail + ' found by email, ' +
                  stats.notFound + ' not found, ' +
                  stats.ambiguous + ' ambiguous, ' +
                  stats.noIdentifier + ' no identifier, ' +
                  stats.apiErrors + ' API errors';

    _writeRunLog('syncCustomers', summary, JSON.stringify(stats));

    ui.alert('Customer Sync Complete\n\n' +
      'Total: ' + stats.total + '\n' +
      'Verified: ' + stats.verified + '\n' +
      'Has Payment Method: ' + stats.hasPayment + '\n' +
      'No Payment Method: ' + stats.noPayment + '\n' +
      'Company Names Pushed: ' + stats.companyPushed + '\n' +
      'Found by Email: ' + stats.foundByEmail + '\n' +
      'Not Found: ' + stats.notFound + '\n' +
      'Ambiguous Match: ' + stats.ambiguous + '\n' +
      'No Identifier: ' + stats.noIdentifier + '\n' +
      'API Errors: ' + stats.apiErrors);

  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// PHASE 2: CREATE STAX INVOICES
// ============================================================
function createStaxInvoices() {
  var ui = SpreadsheetApp.getUi();

  // Preflight
  var preflight = _preflightApiCheck();
  if (preflight) {
    ui.alert(preflight);
    return;
  }

  // Concurrency lock
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Another operation is in progress. Please try again in a moment.');
    return;
  }

  try {
    // Fill in any missing Stax Customer IDs from the Customers tab first
    _lookupStaxCustomerIds();

    // v4.4.0: Delegate to the headless helper. No rowIndexes filter = all PENDING rows.
    // No dueDateGate = process future-dated invoices too (manual UX allows this).
    var result = _createStaxInvoicesForRows_({
      rowIndexes: null,
      dueDateGate: false,
      requireAutoCharge: false,
      logLabel: 'createStaxInvoices'
    });

    if (result.noRows) {
      ui.alert('No invoices found in the Invoices tab.');
      return;
    }

    var stats = result.stats;
    ui.alert('Create Stax Invoices Complete\n\n' +
      'Eligible: ' + stats.total + '\n' +
      'Created: ' + stats.created + '\n' +
      'Duplicates Linked: ' + stats.skippedDupe + '\n' +
      'Missing Customer: ' + stats.skippedNoCustomer + '\n' +
      'Invalid: ' + stats.skippedInvalid + '\n' +
      'API Errors: ' + stats.apiErrors);

  } finally {
    lock.releaseLock();
  }
}

/**
 * v4.4.0 — Headless core of createStaxInvoices.
 *
 * Processes PENDING invoices and pushes them to Stax. No UI alerts. Caller is
 * responsible for locking and preflight. Safe to call from both the manual
 * menu action and the auto-charge prepare stage.
 *
 * @param {Object} options
 *   - rowIndexes: Array<number>|null — 0-based row indexes (offset from header)
 *                 to limit processing to a subset. null = process all PENDING rows.
 *   - dueDateGate: boolean — when true, only push rows whose Due Date <= today.
 *                 Used by the auto-charge prepare stage to avoid auto-pushing
 *                 future-dated PENDING rows.
 *   - requireAutoCharge: boolean — when true, only push rows that pass the
 *                 same Auto Charge policy as the charge loop (per-invoice TRUE
 *                 OR blank+client default TRUE). Used by the prepare stage.
 *   - logLabel: string — label for _writeRunLog (defaults to helper name).
 *
 * @return {{ stats: Object, noRows: boolean, rowsProcessed: number }}
 */
function _createStaxInvoicesForRows_(options) {
  options = options || {};
  var rowIndexFilter = options.rowIndexes || null;
  var dueDateGate = options.dueDateGate === true;
  var requireAutoCharge = options.requireAutoCharge === true;
  var logLabel = options.logLabel || '_createStaxInvoicesForRows_';

  var ss = _getSpreadsheet();
  var invSheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
  var invData = invSheet.getDataRange().getValues();
  var payUrl = _getConfig('STAX_INVOICE_PAY_URL') || 'https://app.staxpayments.com/#/bill/';

  var stats = {
    total: 0,
    created: 0,
    skippedDupe: 0,
    skippedNoCustomer: 0,
    skippedInvalid: 0,
    skippedFutureDue: 0,           // v4.4.0: pending but future due (prepare stage only)
    skippedNotAuto: 0,             // v4.4.0 alias — sum of the two new buckets below, kept for back-compat
    skippedClientAutoDisabled: 0,  // v4.5.0: blank invoice + client explicit AUTO CHARGE=FALSE
    skippedUnknownClient: 0,       // v4.5.0: blank invoice + client not found in CB Clients
    skippedFilteredOut: 0,         // v4.4.0: row not in rowIndexFilter
    apiErrors: 0
  };

  if (invData.length <= 1) {
    _writeRunLog(logLabel, 'No invoices in sheet', '');
    return { stats: stats, noRows: true, rowsProcessed: 0 };
  }

  var numRows = invData.length - 1;
  var colCRange = invSheet.getRange(2, 3, numRows, 1);   // Stax Customer ID
  var colHRange = invSheet.getRange(2, 8, numRows, 1);   // Stax Invoice ID
  var colIRange = invSheet.getRange(2, 9, numRows, 1);   // Status
  var colKRange = invSheet.getRange(2, 11, numRows, 1);  // Notes

  var colCValues = colCRange.getValues();
  var colHValues = colHRange.getValues();
  var colIValues = colIRange.getValues();
  var colKValues = colKRange.getValues();

  var colHChanged = false;
  var colIChanged = false;
  var colKChanged = false;

  // v4.7.0 — 3-tier client lookup (Stax Customer ID → QB_CUSTOMER_NAME →
  // CLIENT NAME). See _buildClientAutoChargeLookup_ for rationale.
  var clientLookups = null;
  if (requireAutoCharge) {
    try {
      var cbId = PropertiesService.getScriptProperties().getProperty("CB_SPREADSHEET_ID");
      if (!cbId) {
        var cfgCb = _getConfig("CB_SPREADSHEET_ID");
        if (cfgCb) cbId = cfgCb;
      }
      if (cbId) {
        var cbSS = SpreadsheetApp.openById(cbId);
        var cbSheet = cbSS.getSheetByName("Clients");
        clientLookups = _buildClientAutoChargeLookup_(cbSheet);
      }
    } catch (e) { Logger.log(logLabel + ": Auto Charge client lookup warning: " + e); }
  }

  // v4.6.1 — Header-based lookup for Auto Charge column (fix for hardcoded
  // index 12 mismatching the actual sheet layout — CLIENT_AUTO_DISABLED gate
  // was firing for invoices with explicit Auto=TRUE because the wrong cell
  // was being read).
  var acColIdx = -1;
  try {
    var hdrs = invData[0] || [];
    for (var hh = 0; hh < hdrs.length; hh++) {
      if (String(hdrs[hh]).trim() === "Auto Charge") { acColIdx = hh; break; }
    }
  } catch (_) {}

  // Determine "today" in script timezone for the due-date gate
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Build rowIndexFilter lookup set (if provided)
  var filterSet = null;
  if (rowIndexFilter && rowIndexFilter.length) {
    filterSet = {};
    for (var fi = 0; fi < rowIndexFilter.length; fi++) filterSet[rowIndexFilter[fi]] = true;
  }

  for (var i = 0; i < numRows; i++) {
    // Row index filter (prepare stage uses this to target only eligible rows)
    if (filterSet && !filterSet[i]) {
      stats.skippedFilteredOut++;
      continue;
    }

    var status    = String(colIValues[i][0]).trim().toUpperCase();
    var staxInvId = String(colHValues[i][0]).trim();
    var staxCustId = String(colCValues[i][0]).trim();

    // Only process PENDING rows with no Stax Invoice ID
    if (status !== 'PENDING') continue;
    if (staxInvId) continue;

    stats.total++;

    // Must have a Stax Customer ID
    if (!staxCustId) {
      _logException(
        String(invData[i + 1][0]), String(invData[i + 1][1]),
        '', invData[i + 1][5], String(invData[i + 1][4]),
        logLabel + ': NO_CUSTOMER - No Stax Customer ID. Run Sync Customers first.', '');
      stats.skippedNoCustomer++;
      continue;
    }

    // Build payload inputs
    var docNum   = String(invData[i + 1][0]).trim();
    var custName = String(invData[i + 1][1]).trim();
    var invDate  = String(invData[i + 1][3]).trim();
    var dueDate  = String(invData[i + 1][4]).trim();
    var total    = parseFloat(invData[i + 1][5]);
    var lineItemsRaw = String(invData[i + 1][6]).trim();

    // Validate total
    if (isNaN(total) || total <= 0) {
      _logException(docNum, custName, staxCustId, invData[i + 1][5], dueDate,
        logLabel + ': INVALID_PAYLOAD - Total is zero, negative, or not a number', '');
      stats.skippedInvalid++;
      continue;
    }

    // Build due date — fallback to invoice date + 30 days if blank
    var dueDateFormatted = _parseDateForStax(dueDate);
    if (!dueDateFormatted) {
      dueDateFormatted = _parseDateForStax(invDate);
      if (dueDateFormatted) {
        var d = new Date(dueDateFormatted);
        d.setDate(d.getDate() + 30);
        dueDateFormatted = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
    }

    // v4.4.0: Due-date gate (prepare stage only) — don't auto-push future-dated rows
    if (dueDateGate) {
      if (!dueDateFormatted) {
        stats.skippedInvalid++;
        _logException(docNum, custName, staxCustId, total, dueDate,
          logLabel + ': INVALID_DUE_DATE - Could not parse due date for due-date gate', '');
        continue;
      }
      if (dueDateFormatted > today) {
        stats.skippedFutureDue++;
        continue;
      }
    }

    // v4.5.0: Auto Charge policy gate — aligned with _executeChargeRun. Invoice-level
    // TRUE always wins (charge regardless of client). Invoice-level FALSE always wins
    // (skip regardless of client). Blank invoice falls back to client setting with two
    // distinct buckets so operators can see WHY a row was skipped:
    //   - CLIENT_AUTO_DISABLED: client exists in CB Clients with AUTO CHARGE=FALSE
    //   - UNKNOWN_CLIENT:        client not found in CB Clients (undefined)
    // Both cases log an Exception row with a clear reason. Invoice FALSE does NOT log —
    // it's an explicit operator choice, not an error.
    if (requireAutoCharge) {
      var autoChargeVal = (acColIdx >= 0 && invData[i + 1].length > acColIdx) ? String(invData[i + 1][acColIdx] || "").trim().toUpperCase() : "";
      var invoiceExplicitlyAuto = (autoChargeVal === "TRUE" || autoChargeVal === "YES" || autoChargeVal === "ON");
      var invoiceExplicitlyManual = (autoChargeVal === "FALSE" || autoChargeVal === "NO" || autoChargeVal === "OFF");

      if (invoiceExplicitlyManual) {
        stats.skippedNotAuto++; // alias kept for back-compat
        continue;
      }
      if (!invoiceExplicitlyAuto) {
        // v4.7.0 — 3-tier client lookup: Stax Customer ID → QB_CUSTOMER_NAME
        // → CLIENT NAME. Eliminates UNKNOWN_CLIENT for QB-tagged names like
        // "K&M Interiors (ACH on File)" that don't appear in CB CLIENT NAME
        // but DO appear in QB_CUSTOMER_NAME.
        var clientAC = _resolveClientAutoCharge_(clientLookups, staxCustId, custName);
        if (clientAC === false) {
          stats.skippedClientAutoDisabled++;
          stats.skippedNotAuto++; // alias kept for back-compat
          _logException(docNum, custName, staxCustId, total, dueDate,
            '_prepareEligiblePending: CLIENT_AUTO_DISABLED - Client "' + custName + '" has Auto Charge disabled in CB Clients. Set invoice Auto Charge explicitly to override.',
            '');
          continue;
        }
        if (clientAC === undefined) {
          stats.skippedUnknownClient++;
          stats.skippedNotAuto++; // alias kept for back-compat
          _logException(docNum, custName, staxCustId, total, dueDate,
            '_prepareEligiblePending: UNKNOWN_CLIENT - No CB Clients row matched. Tried Stax Customer ID "' + staxCustId + '", QB_CUSTOMER_NAME "' + custName + '", and CLIENT NAME "' + custName + '". Add a CB Clients row with one of those keys + an Auto Charge preference, OR set this invoice\'s Auto Charge field explicitly.',
            '');
          continue;
        }
        // clientAC === true → eligible, fall through
      }
      // invoiceExplicitlyAuto === true → always eligible (invoice TRUE overrides client FALSE)
    }

    // Build line items + reference key for duplicate protection
    var lineItems = _buildStaxLineItems(lineItemsRaw, total, docNum);
    var refKey = 'QB#' + docNum + '|' + _normalizeName(custName) + '|' + total + '|' + invDate;
    var memo = 'QB #' + docNum + ' - ' + custName;

    var subtotal = 0;
    for (var li = 0; li < lineItems.length; li++) {
      subtotal += (lineItems[li].quantity || 1) * (lineItems[li].price || 0);
    }

    var payload = {
      customer_id: staxCustId,
      total: total,
      meta: {
        subtotal: subtotal,
        tax: total - subtotal,
        memo: memo,
        reference: refKey,
        invoiceNumber: docNum,
        lineItems: lineItems
      }
    };
    if (dueDateFormatted) payload.due_at = dueDateFormatted;

    // Duplicate protection (preserved from original createStaxInvoices)
    var dupeCheck = _checkForDuplicateInvoice(refKey);
    if (dupeCheck.found) {
      colHValues[i][0] = dupeCheck.invoiceId;
      colIValues[i][0] = 'CREATED';
      colKValues[i][0] = 'Linked to existing Stax invoice (duplicate protection)';
      colHChanged = true;
      colIChanged = true;
      colKChanged = true;
      stats.skippedDupe++;
      continue;
    }

    // Create invoice in Stax
    var result = _staxApiRequest('POST', '/invoice', payload);

    if (result.success && result.data && result.data.id) {
      colHValues[i][0] = result.data.id;
      colIValues[i][0] = 'CREATED';
      // Stamp a marker in Notes when the auto-run pushes a pending row so it's
      // distinguishable from manually-pushed rows in the audit trail.
      if (requireAutoCharge) {
        colKValues[i][0] = 'PENDING -> CREATED during auto-run (' + _formatTimestamp(new Date()) + ')';
        colKChanged = true;
      }
      colHChanged = true;
      colIChanged = true;
      stats.created++;
    } else {
      var errDetail = result.error || 'Unknown error';
      _logException(docNum, custName, staxCustId, total, dueDate,
        logLabel + ': API_ERROR - ' + errDetail,
        result.data && result.data.id ? payUrl + result.data.id : '');

      colIValues[i][0] = 'EXCEPTION';
      colKValues[i][0] = 'API error: ' + errDetail.substring(0, 200);
      colIChanged = true;
      colKChanged = true;
      stats.apiErrors++;
    }
  }

  // Batch write all updates
  if (colHChanged) colHRange.setValues(colHValues);
  if (colIChanged) colIRange.setValues(colIValues);
  if (colKChanged) colKRange.setValues(colKValues);

  // Summary
  var summary = stats.created + ' created, ' +
                stats.skippedDupe + ' duplicates linked, ' +
                stats.skippedNoCustomer + ' missing customer, ' +
                stats.skippedInvalid + ' invalid, ' +
                stats.apiErrors + ' API errors';
  if (dueDateGate) summary += ', ' + stats.skippedFutureDue + ' future-due (gated)';
  if (requireAutoCharge) {
    summary += ', ' + stats.skippedClientAutoDisabled + ' client-auto-disabled';
    summary += ', ' + stats.skippedUnknownClient + ' unknown-client';
  }

  _writeRunLog(logLabel, summary, JSON.stringify(stats));

  // v4.6.0 — Supabase write-through (session 69 Phase 2f).
  // Resync all invoices + tail of run log; best-effort, never blocks.
  try { _sbResyncAllStaxInvoices(ss); } catch (_) {}
  try { _sbResyncStaxRunLog(ss); } catch (_) {}

  return { stats: stats, noRows: false, rowsProcessed: stats.total };
}

/**
 * v4.4.0 — Prepare stage for runChargesAuto / runCharges.
 *
 * Finds PENDING invoices that are eligible to be pushed to Stax RIGHT NOW
 * (due today or earlier + auto-charge policy satisfied), then pushes them.
 * After this returns, the caller should re-read sheet data (or call
 * _executeChargeRun which re-reads) to pick up the newly-CREATED rows.
 *
 * Safe to call under a lock (does NOT acquire its own lock — caller must).
 * Never creates duplicates — preserves existing refKey duplicate protection.
 *
 * @return {{ stats: Object }} prepare-stage stats for run-log
 */
function _prepareEligiblePendingInvoicesForChargeRun() {
  // Ensure customer IDs are fresh before attempting to push
  try { _lookupStaxCustomerIds(); } catch (e) { Logger.log('_prepareEligiblePendingInvoicesForChargeRun: customer lookup warning: ' + e); }

  var result = _createStaxInvoicesForRows_({
    rowIndexes: null,
    dueDateGate: true,        // only push due-today-or-earlier rows
    requireAutoCharge: true,  // only push rows that pass the auto-charge policy
    logLabel: '_prepareEligiblePending'
  });

  return { stats: result.stats };
}

// ============================================================
// INVOICE HELPERS
// ============================================================

// Builds Stax line items array from the Line Items JSON column.
// Uses confirmed Stax schema: { item, details, quantity, price }
// Falls back to a single line item if JSON is invalid/empty.
function _buildStaxLineItems(lineItemsRaw, total, docNum) {
  var items = [];

  if (lineItemsRaw) {
    try {
      var parsed = JSON.parse(lineItemsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (var i = 0; i < parsed.length; i++) {
          var li = parsed[i];
          // Skip the AR line (typically the first SPL line that mirrors the TRNS amount)
          if (li.accnt && li.accnt.match(/accounts receivable/i)) continue;

          var qty = li.qty || 1;
          var price = li.price ? Math.abs(li.price) : 0;

          // If price is missing but amount exists, calculate price from amount / qty
          if (!price && li.amount) {
            price = Math.abs(li.amount) / qty;
          }

          // Skip zero-value lines
          if (price === 0) continue;

          items.push({
            item: li.invItem || li.memo || ('Line ' + (i + 1)),
            details: li.memo || li.accnt || '',
            quantity: qty,
            price: price
          });
        }
      }
    } catch (e) {
      // JSON parse failed — fall through to single item
    }
  }

  // Fallback: single line item with the total
  if (items.length === 0) {
    items.push({
      item: 'QB Invoice #' + docNum,
      details: 'Invoice total',
      quantity: 1,
      price: total
    });
  }

  return items;
}

// Parses various date formats into yyyy-MM-dd for Stax.
// Prefers explicit MM/DD/YYYY parsing to avoid timezone drift from generic Date().
// Returns null if date cannot be parsed.
function _parseDateForStax(dateStr) {
  if (!dateStr) return null;
  dateStr = String(dateStr).trim();
  if (!dateStr) return null;

  // Try MM/DD/YYYY or M/D/YYYY format first (QB's typical format)
  var parts = dateStr.split('/');
  if (parts.length === 3) {
    var month = parseInt(parts[0], 10);
    var day   = parseInt(parts[1], 10);
    var year  = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      var d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
    }
  }

  // Try yyyy-MM-dd format
  var isoParts = dateStr.split('-');
  if (isoParts.length === 3 && isoParts[0].length === 4) {
    var isoDate = new Date(parseInt(isoParts[0], 10), parseInt(isoParts[1], 10) - 1, parseInt(isoParts[2], 10));
    if (!isNaN(isoDate.getTime())) {
      return Utilities.formatDate(isoDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  }

  // Last resort: generic Date parse (may have timezone drift)
  var fallback = new Date(dateStr);
  if (!isNaN(fallback.getTime())) {
    return Utilities.formatDate(fallback, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return null;
}

// Best-effort duplicate check: searches Stax for an invoice matching the reference key.
// If the Stax API does not support filtering by meta.reference, this returns not-found
// and the script proceeds with creation. The reference is also stored in meta.memo
// for manual search/dedup in the Stax dashboard.
// Returns { found: bool, invoiceId: string|null }
function _checkForDuplicateInvoice(refKey) {
  // Try searching by memo or reference — Stax may or may not support this filter
  var result = _staxApiRequest('GET', '/invoice?memo=' + encodeURIComponent(refKey), null);

  if (result.success && result.data) {
    var invoices = _extractArrayFromResponse(result.data);

    // Look for an invoice whose meta.reference matches our key
    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      if (inv.meta && inv.meta.reference === refKey) {
        return { found: true, invoiceId: inv.id };
      }
    }
  }

  // Not found or endpoint doesn't support filtering — proceed with creation
  return { found: false, invoiceId: null };
}

// ============================================================
// PHASE 1: IIF FILE PICKER (unchanged from v1.3.0)
// ============================================================
function showFilePicker() {
  var preflight = _preflightCheck();
  if (preflight) {
    SpreadsheetApp.getUi().alert(preflight);
    return;
  }

  var html = HtmlService.createHtmlOutput([
    '<!DOCTYPE html>',
    '<html><head><style>',
    '  body { font-family: Arial, sans-serif; padding: 16px; background: #fafafa; margin: 0; }',
    '  select { width: 100%; padding: 8px; font-size: 13px; margin: 4px 0 12px 0; border: 1px solid #ccc; border-radius: 4px; }',
    '  button { padding: 8px 16px; background: #E85D2D; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; margin-right: 6px; }',
    '  button:hover { background: #c94e26; }',
    '  button:disabled { background: #ccc; cursor: not-allowed; }',
    '  .secondary { background: #666; }',
    '  .secondary:hover { background: #555; }',
    '  #status { margin-top: 10px; font-size: 12px; color: #555; }',
    '  label { font-size: 13px; font-weight: bold; color: #333; }',
    '  .info { font-size: 11px; color: #888; margin-bottom: 8px; }',
    '</style></head><body>',
    '  <label>Folder:</label>',
    '  <div class="info" id="folderInfo">Loading...</div>',
    '  <label>IIF / TXT Files:</label>',
    '  <select id="fileSelect" disabled><option>Loading...</option></select>',
    '  <div>',
    '    <button id="importBtn" onclick="doImport()" disabled>Import Selected</button>',
    '    <button class="secondary" onclick="changeFolder()">Change Folder</button>',
    '    <button class="secondary" onclick="loadFiles()">Refresh</button>',
    '  </div>',
    '  <div id="status"></div>',
    '<script>',
    '  function loadFiles() {',
    '    document.getElementById("fileSelect").disabled = true;',
    '    document.getElementById("importBtn").disabled = true;',
    '    document.getElementById("status").innerText = "";',
    '    google.script.run',
    '      .withSuccessHandler(function(result) {',
    '        var sel = document.getElementById("fileSelect");',
    '        sel.innerHTML = "";',
    '        document.getElementById("folderInfo").innerText = result.folderName || "(root)";',
    '        if (!result.files || result.files.length === 0) {',
    '          sel.innerHTML = "<option>No .iif or .txt files found</option>";',
    '          return;',
    '        }',
    '        for (var i = 0; i < result.files.length; i++) {',
    '          var f = result.files[i];',
    '          var opt = document.createElement("option");',
    '          opt.value = f.id;',
    '          opt.text = f.name + "  (" + f.date + ")";',
    '          sel.appendChild(opt);',
    '        }',
    '        sel.disabled = false;',
    '        document.getElementById("importBtn").disabled = false;',
    '      })',
    '      .withFailureHandler(function(err) {',
    '        document.getElementById("status").innerText = "Error: " + err.message;',
    '      })',
    '      .listIIFFiles();',
    '  }',
    '  function doImport() {',
    '    var sel = document.getElementById("fileSelect");',
    '    if (!sel.value) return;',
    '    var name = sel.options[sel.selectedIndex].text.split("  (")[0];',
    '    document.getElementById("status").innerText = "Importing: " + name + "...";',
    '    document.getElementById("importBtn").disabled = true;',
    '    google.script.run',
    '      .withSuccessHandler(function(msg) {',
    '        document.getElementById("status").innerText = msg;',
    '        setTimeout(function() { google.script.host.close(); }, 2500);',
    '      })',
    '      .withFailureHandler(function(err) {',
    '        document.getElementById("status").innerText = "Error: " + err.message;',
    '        document.getElementById("importBtn").disabled = false;',
    '      })',
    '      .importIIFFromDrive(sel.value, name);',
    '  }',
    '  function changeFolder() {',
    '    google.script.run',
    '      .withSuccessHandler(function(changed) {',
    '        if (changed) loadFiles();',
    '      })',
    '      .withFailureHandler(function(err) {',
    '        document.getElementById("status").innerText = "Error: " + err.message;',
    '      })',
    '      .promptForIIFFolder();',
    '  }',
    '  loadFiles();',
    '<\/script>',
    '</body></html>'
  ].join('\n'))
  .setWidth(460)
  .setHeight(280);

  SpreadsheetApp.getUi().showModalDialog(html, 'Import IIF File from Drive');
}

// Lists IIF/TXT files from the configured folder (or root).
// Called from the file picker dialog.
function listIIFFiles() {
  var folderId = _getConfig('IIF_FOLDER_ID') || '';
  var folder;
  var folderName = 'My Drive (root)';

  try {
    if (folderId) {
      folder = DriveApp.getFolderById(folderId);
      folderName = folder.getName();
    }
  } catch (e) {
    // Folder ID invalid or deleted — fall back to root
    folderId = '';
    folder = null;
  }

  var files = [];
  var query = "(mimeType='text/plain' or mimeType='application/octet-stream') and trashed=false";

  var iterator;
  if (folder) {
    iterator = folder.searchFiles(query);
  } else {
    iterator = DriveApp.searchFiles(query);
  }

  while (iterator.hasNext() && files.length < 100) {
    var file = iterator.next();
    var name = file.getName();
    var ext = name.split('.').pop().toLowerCase();
    if (ext === 'iif' || ext === 'txt') {
      files.push({
        id: file.getId(),
        name: name,
        date: Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm')
      });
    }
  }

  // Sort by date descending (newest first)
  files.sort(function(a, b) { return b.date > a.date ? 1 : -1; });

  return { files: files, folderName: folderName };
}

// Prompts user for a Drive folder URL or ID to use as the IIF import folder.
// Saves to Config tab as IIF_FOLDER_ID.
function promptForIIFFolder() {
  var ui = SpreadsheetApp.getUi();
  var current = _getConfig('IIF_FOLDER_ID') || '';

  var response = ui.prompt(
    'Set IIF Import Folder',
    'Paste the Google Drive folder URL or folder ID.\n\n' +
    'To get the URL: open the folder in Drive, copy the URL from your browser.\n' +
    (current ? '(Current folder ID: ' + current + ')' : '(Currently using root/all Drive)'),
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return false;

  var input = response.getResponseText().trim();
  if (!input) return false;

  // Extract folder ID from URL if needed
  var folderId = input;
  var match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) folderId = match[1];

  // Validate the folder exists
  try {
    var folder = DriveApp.getFolderById(folderId);
    _setConfig('IIF_FOLDER_ID', folderId);
    ui.alert('IIF folder set to: ' + folder.getName());
    return true;
  } catch (e) {
    ui.alert('Could not find that folder. Please check the URL or ID and try again.');
    return false;
  }
}

// Sets a config value in the Config tab.
function _setConfig(key, value) {
  var ss = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  // Key not found — append it
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
}

// v4.5.0: Reads an integer config value with default seeding, validation, and clamping.
// If the key is missing/blank/non-numeric, seeds the default via _setConfig (append-only
// — will not reorder or rewrite existing Config rows), then returns the default.
// Otherwise parses the value, clamps to [minVal, maxVal], and returns the clamped int.
// Used by the auto-charge batch controls (MAX_AUTO_CHARGES_PER_RUN, AUTO_CHARGE_DELAY_MS,
// AUTO_CHARGE_CIRCUIT_BREAKER_COUNT).
function _getIntConfig_(key, defaultVal, minVal, maxVal) {
  var raw = _getConfig(key);
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    // Missing — seed default (append) and return default
    _setConfig(key, defaultVal);
    return defaultVal;
  }
  var parsed = parseInt(String(raw).trim(), 10);
  if (isNaN(parsed)) {
    // Non-integer — do NOT overwrite the operator's (possibly intentional) value;
    // just log and fall back to default for this run
    Logger.log('_getIntConfig_: Config key "' + key + '" has non-integer value "' + raw + '" — using default ' + defaultVal);
    return defaultVal;
  }
  // Clamp to safe range
  if (parsed < minVal) return minVal;
  if (parsed > maxVal) return maxVal;
  return parsed;
}

// ============================================================
// PHASE 1: IIF IMPORT (unchanged from v1.3.0)
// ============================================================
function importIIFFromDrive(fileId, fileName) {
  var preflight = _preflightCheck();
  if (preflight) return preflight;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return 'Another import is in progress. Please try again in a moment.';
  }

  try {
    var file = DriveApp.getFileById(fileId);
    var mime = file.getMimeType();
    var allowed = ['text/plain', 'application/octet-stream', 'text/tab-separated-values'];

    if (allowed.indexOf(mime) === -1 && !fileName.match(/\.(iif|txt)$/i)) {
      return 'Invalid file type. Please select an IIF or TXT file.';
    }

    var content = file.getBlob().getDataAsString('UTF-8');
    if (!content || content.trim().length === 0) {
      return 'File appears to be empty.';
    }

    var result = parseIIF(content);

    if (result.invoices.length === 0 && result.exceptions.length === 0) {
      return 'No invoices found in file. Check that this is a valid IIF export.';
    }

    var ss          = _getSpreadsheet();
    var importSheet = ss.getSheetByName(SHEET_NAMES.IMPORT);

    importSheet.getRange('B2').setValue(fileName + '  |  ' + _formatTimestamp(new Date()));

    var lastRow = importSheet.getLastRow();
    if (lastRow > 4) {
      importSheet.getRange(5, 1, lastRow - 4, 12).clearContent();
    }

    if (result.rows.length > 0) {
      importSheet.getRange(5, 1, result.rows.length, 12).setValues(result.rows);
    }

    if (result.exceptions.length > 0) {
      _writeExceptions(result.exceptions);
    }

    var added = _writeInvoicesToTab(result.invoices);

    var msg = 'Done. ' + added + ' new invoice(s) added';
    if (result.invoices.length - added > 0) {
      msg += ' (' + (result.invoices.length - added) + ' duplicate(s) skipped)';
    }
    if (result.exceptions.length > 0) {
      msg += '. ' + result.exceptions.length + ' record(s) sent to Exceptions (blank invoice #).';
    }
    msg += ' File: "' + fileName + '"';
    return msg;
  } catch (e) {
    return 'Import failed: ' + e.message;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// PHASE 1: IIF PARSER (unchanged from v1.3.0)
// ============================================================
function parseIIF(content) {
  var lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').filter(function(l) { return l.replace(/[\t ]/g, '').length > 0; });

  var rows       = [];
  var invoices   = [];
  var exceptions = [];
  var current    = null;

  var trnsColumns = null;
  var splColumns  = null;

  for (var idx = 0; idx < lines.length; idx++) {
    var line = lines[idx];
    line = line.replace(/\s+$/, '');
    var parts   = line.split('\t');
    var rowType = parts[0].trim();

    if (rowType === '!TRNS') {
      trnsColumns = _buildColumnMap(parts);
      continue;
    }
    if (rowType === '!SPL') {
      splColumns = _buildColumnMap(parts);
      continue;
    }
    if (rowType.startsWith('!')) continue;

    if (rowType === 'TRNS') {
      current = trnsColumns
        ? _parseTrnsFromMap(parts, trnsColumns)
        : _parseTrnsPositional(parts);

      var displayRow = parts.slice(0, 12);
      while (displayRow.length < 12) displayRow.push('');
      displayRow[0] = 'TRNS';
      rows.push(displayRow);

    } else if (rowType === 'SPL' && current) {
      var lineItem = splColumns
        ? _parseSplFromMap(parts, splColumns)
        : _parseSplPositional(parts);

      current.lineItems.push(lineItem);

      var splDisplayRow = parts.slice(0, 12);
      while (splDisplayRow.length < 12) splDisplayRow.push('');
      splDisplayRow[0] = 'SPL';
      rows.push(splDisplayRow);

    } else if (rowType === 'ENDTRNS') {
      if (current) {
        _routeParsedTransaction(current, invoices, exceptions);
        current = null;
      }
    }
  }

  if (current) {
    _routeParsedTransaction(current, invoices, exceptions);
  }

  return { rows: rows, invoices: invoices, exceptions: exceptions };
}

function _routeParsedTransaction(trns, invoices, exceptions) {
  var type = trns.trnsType.toUpperCase();
  if (type !== 'INVOICE') return;

  if (!trns.docNum || !trns.docNum.trim()) {
    exceptions.push({
      timestamp: _formatTimestamp(new Date()),
      docNum:    '',
      name:      trns.name,
      staxId:    '',
      amount:    trns.amount,
      dueDate:   trns.dueDate,
      reason:    'Blank QB Invoice # in IIF import',
      link:      '',
      resolved:  ''
    });
    return;
  }

  invoices.push(trns);
}

function _buildColumnMap(headerParts) {
  var map = {};
  for (var i = 1; i < headerParts.length; i++) {
    var col = headerParts[i].trim().toUpperCase();
    if (col) map[col] = i;
  }
  return map;
}

function _parseTrnsFromMap(parts, colMap) {
  function get(key) { return colMap[key] !== undefined ? (parts[colMap[key]] || '') : ''; }
  function getNum(key) {
    var raw = get(key);
    var n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  }
  return {
    trnsType: get('TRNSTYPE'), date: get('DATE'), accnt: get('ACCNT'),
    name: get('NAME'), amount: getNum('AMOUNT'), docNum: get('DOCNUM'),
    memo: get('MEMO'), terms: get('TERMS'), dueDate: get('DUEDATE'),
    clear: get('CLEAR'), toPrint: get('TOPRINT'), lineItems: []
  };
}

function _parseSplFromMap(parts, colMap) {
  function get(key) { return colMap[key] !== undefined ? (parts[colMap[key]] || '') : ''; }
  function getNum(key) {
    var raw = get(key);
    var n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  }
  return {
    trnsType: get('TRNSTYPE'), date: get('DATE'), accnt: get('ACCNT'),
    name: get('NAME'), amount: getNum('AMOUNT'), docNum: get('DOCNUM'),
    memo: get('MEMO'), qty: getNum('QNTY') || 1, price: getNum('PRICE'),
    invItem: get('INVITEM'), clear: get('CLEAR')
  };
}

function _parseTrnsPositional(parts) {
  return {
    trnsType: parts[1] || '', date: parts[2] || '', accnt: parts[3] || '',
    name: parts[4] || '', amount: parseFloat(parts[5]) || 0, docNum: parts[6] || '',
    memo: parts[7] || '', terms: parts[8] || '', dueDate: parts[9] || '',
    clear: parts[10] || '', toPrint: parts[11] || '', lineItems: []
  };
}

function _parseSplPositional(parts) {
  return {
    trnsType: parts[1] || '', date: parts[2] || '', accnt: parts[3] || '',
    name: parts[4] || '', amount: parseFloat(parts[5]) || 0, docNum: parts[6] || '',
    memo: parts[7] || '', qty: parseFloat(parts[8]) || 1, price: parseFloat(parts[9]) || 0,
    invItem: parts[10] || '', clear: parts[11] || ''
  };
}

// ============================================================
// WRITE INVOICES TO INVOICES TAB (unchanged from v1.3.0)
// ============================================================
function _writeInvoicesToTab(invoices) {
  var ss    = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.INVOICES);

  var existing = sheet.getDataRange().getValues();
  var existingSet = new Set();
  for (var e = 1; e < existing.length; e++) {
    var key = _invoiceKey(
      String(existing[e][0]), String(existing[e][1]),
      existing[e][5], String(existing[e][3])
    );
    existingSet.add(key);
  }

  var newRows = [];
  for (var i = 0; i < invoices.length; i++) {
    var inv = invoices[i];
    var dedupKey = _invoiceKey(inv.docNum, inv.name, inv.amount, inv.date);
    if (existingSet.has(dedupKey)) continue;
    existingSet.add(dedupKey);

    var lineItemsJson = '';
    try {
      lineItemsJson = JSON.stringify(inv.lineItems);
    } catch (jsonErr) {
      lineItemsJson = '[]';
    }

    newRows.push([
      inv.docNum, inv.name, '', inv.date, inv.dueDate, inv.amount,
      lineItemsJson, '', 'PENDING', _formatTimestamp(new Date()), ''
    ]);
  }

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
      .setValues(newRows);
    _lookupStaxCustomerIds();
  }

  return newRows.length;
}

/**
 * Normalize a date value to yyyy-MM-dd regardless of whether it's a Date
 * object (from sheet read) or a string. Without this, dedup keys mismatched
 * across write paths — see StrideAPI.gs stax_normalizeDate_ for the same fix.
 */
function _normalizeDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(d).trim();
  if (!s) return '';
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return s;
}

function _invoiceKey(docNum, name, amount, date) {
  // Normalize amount: collapse Number/string/formatted to a consistent string
  var n = Number(String(amount).replace(/[$,]/g, ''));
  var normAmount = isFinite(n) ? n.toFixed(2) : String(amount);
  return String(docNum).trim() + '|' + _normalizeName(name) + '|' +
         normAmount + '|' + _normalizeDate(date);
}

// ============================================================
// WRITE EXCEPTIONS (batch version from Phase 1)
// ============================================================
function _writeExceptions(exceptions) {
  var ss    = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.EXCEPTIONS);
  if (!sheet) return;

  var rows = [];
  for (var i = 0; i < exceptions.length; i++) {
    var ex = exceptions[i];
    rows.push([
      ex.timestamp, ex.docNum, ex.name, ex.staxId,
      ex.amount, ex.dueDate, ex.reason, ex.link, ex.resolved
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
      .setValues(rows);
  }
}

// ============================================================
// AUTO-FILL STAX CUSTOMER IDS (unchanged from v1.3.0)
// ============================================================
// Auto-populates the Customers tab with unique QB Customer Names found in the
// Invoices tab. Only adds names that don't already exist. Stax Customer ID and
// Email are left blank for the user to fill in.
function autoFillCustomersFromInvoices() {
  var ui = SpreadsheetApp.getUi();
  var ss = _getSpreadsheet();

  var invSheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
  var custSheet = ss.getSheetByName(SHEET_NAMES.CUSTOMERS);

  if (!invSheet || !custSheet) {
    ui.alert('Missing Invoices or Customers tab. Run Setup Sheets first.');
    return;
  }

  var invData = invSheet.getDataRange().getValues();
  if (invData.length <= 1) {
    ui.alert('No invoices found in the Invoices tab.\n\nImport an IIF file first.');
    return;
  }

  // Collect existing customer names (normalized) from Customers tab
  var custData = custSheet.getDataRange().getValues();
  var existingNames = {};
  for (var c = 1; c < custData.length; c++) {
    var name = _normalizeName(custData[c][0]);
    if (name) existingNames[name] = true;
  }

  // Collect unique QB Customer Names from Invoices tab
  var newNames = {};
  for (var i = 1; i < invData.length; i++) {
    var rawName = String(invData[i][1]).trim();
    if (!rawName) continue;
    var normalized = _normalizeName(rawName);
    if (!existingNames[normalized] && !newNames[normalized]) {
      newNames[normalized] = rawName; // keep original casing for display
    }
  }

  var nameList = Object.keys(newNames);
  if (nameList.length === 0) {
    ui.alert('All customer names from the Invoices tab are already in the Customers tab.\n\nNo new customers to add.');
    return;
  }

  // Confirm
  var confirm = ui.alert(
    'Auto-Fill Customers',
    'Found ' + nameList.length + ' new customer name(s) in the Invoices tab:\n\n' +
    nameList.slice(0, 15).map(function(n) { return '  - ' + newNames[n]; }).join('\n') +
    (nameList.length > 15 ? '\n  ... and ' + (nameList.length - 15) + ' more' : '') +
    '\n\nAdd them to the Customers tab? (Stax ID and Email will be blank — fill in manually or run Sync.)',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  // Build rows: QB Customer Name | Stax Customer ID | Email | Has Payment Method | Notes
  var newRows = [];
  for (var k = 0; k < nameList.length; k++) {
    newRows.push([newNames[nameList[k]], '', '', '', '']);
  }

  custSheet.getRange(custSheet.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);

  ui.alert(nameList.length + ' customer(s) added to the Customers tab.\n\n' +
    'Next steps:\n' +
    '1. Fill in Stax Customer IDs and/or Emails\n' +
    '2. Run "Sync Customers with Stax" to verify and check payment methods');
}

function _lookupStaxCustomerIds() {
  var ss        = _getSpreadsheet();
  var custSheet = ss.getSheetByName(SHEET_NAMES.CUSTOMERS);
  var invSheet  = ss.getSheetByName(SHEET_NAMES.INVOICES);

  // Build customer map from local Customers tab
  // Col A (index 0) = QB Customer Name, Col D (index 3) = Stax Customer ID
  var custData = custSheet.getDataRange().getValues();
  var custMap  = {};
  for (var c = 1; c < custData.length; c++) {
    if (custData[c][0] && custData[c][3]) {
      var normalized = _normalizeName(custData[c][0]);
      custMap[normalized] = String(custData[c][3]).trim();
    }
  }

  // Also pull from Consolidated Billing Clients tab if configured
  var cbId = _getConfig('CB_SPREADSHEET_ID');
  if (cbId) {
    try {
      var cbSs = SpreadsheetApp.openById(cbId);
      var cbClients = cbSs.getSheetByName('Clients');
      if (cbClients) {
        var cbData = cbClients.getDataRange().getValues();
        // Build header map to find columns by name
        var cbHeaders = {};
        for (var h = 0; h < cbData[0].length; h++) {
          cbHeaders[String(cbData[0][h]).trim().toUpperCase()] = h;
        }
        var qbNameIdx = cbHeaders['QB_CUSTOMER_NAME'];
        var staxIdIdx = cbHeaders['STAX CUSTOMER ID'];
        var activeIdx = cbHeaders['ACTIVE'];
        if (qbNameIdx !== undefined && staxIdIdx !== undefined) {
          for (var cb = 1; cb < cbData.length; cb++) {
            // Skip inactive clients
            if (activeIdx !== undefined) {
              var activeVal = String(cbData[cb][activeIdx] || '').trim().toUpperCase();
              if (activeVal !== 'TRUE' && activeVal !== 'YES') continue;
            }
            var cbQbName = String(cbData[cb][qbNameIdx] || '').trim();
            var cbStaxId = String(cbData[cb][staxIdIdx] || '').trim();
            if (cbQbName && cbStaxId) {
              var cbNorm = _normalizeName(cbQbName);
              // CB takes precedence if not already in local map
              if (!custMap[cbNorm]) {
                custMap[cbNorm] = cbStaxId;
              }
            }
          }
        }
      }
    } catch (e) {
      // CB sheet not accessible — continue with local map only
    }
  }

  var invData = invSheet.getDataRange().getValues();
  if (invData.length <= 1) return;

  var colCRange = invSheet.getRange(2, 3, invData.length - 1, 1);
  var colCValues = colCRange.getValues();
  var changed = false;

  for (var i = 0; i < colCValues.length; i++) {
    if (colCValues[i][0]) continue;
    var qbName = _normalizeName(invData[i + 1][1]);
    if (qbName && custMap[qbName]) {
      colCValues[i][0] = custMap[qbName];
      changed = true;
    }
  }

  if (changed) {
    colCRange.setValues(colCValues);
  }
}

// ============================================================
// PHASE 3: CHARGE RUNNER
// ============================================================

// Manual charge runner — called from menu. Shows UI alerts.
function runCharges() {
  var ui = SpreadsheetApp.getUi();

  var preflight = _preflightApiCheck();
  if (preflight) {
    ui.alert(preflight);
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Another operation is in progress. Please try again in a moment.');
    return;
  }

  try {
    // v4.4.0: Push any eligible PENDING invoices first, then charge.
    // v4.5.0: Charge stage inherits cap/throttle/circuit-breaker/watchdog.
    var prepResult = _prepareEligiblePendingInvoicesForChargeRun();
    var chargeResult = _executeChargeRun();

    // Combined run-log summary with the new batch-control counters
    var combinedSummary =
      'push: ' + prepResult.stats.created + ' created, ' +
      prepResult.stats.skippedDupe + ' linked, ' +
      prepResult.stats.skippedNoCustomer + ' no-customer, ' +
      prepResult.stats.skippedFutureDue + ' future-due, ' +
      prepResult.stats.skippedClientAutoDisabled + ' client-auto-disabled, ' +
      prepResult.stats.skippedUnknownClient + ' unknown-client, ' +
      prepResult.stats.apiErrors + ' push-errors; ' +
      'charge: ' + chargeResult.stats.eligibleTotal + ' eligible, ' +
      chargeResult.stats.processedThisRun + ' processed, ' +
      chargeResult.stats.deferredByCap + ' def-cap, ' +
      chargeResult.stats.deferredByBreaker + ' def-breaker, ' +
      (chargeResult.stats.deferredByWatchdog || 0) + ' def-watchdog, ' +
      chargeResult.stats.paid + ' paid, ' +
      chargeResult.stats.declined + ' declined, ' +
      chargeResult.stats.noPaymentMethod + ' no-pm, ' +
      chargeResult.stats.alreadyPaid + ' already-paid, ' +
      chargeResult.stats.partial + ' partial, ' +
      chargeResult.stats.apiErrors + ' api-errors' +
      ' (breaker=' + chargeResult.stats.apiErrorsBreakerCounted + ', bad-row=' + chargeResult.stats.apiErrorsBadRow + '), ' +
      'breakerTripped=' + chargeResult.stats.breakerTripped +
      (chargeResult.stats.watchdogTripped ? ', watchdogTripped=true' : '');

    _writeRunLog('runCharges', combinedSummary, JSON.stringify({
      pushStage: prepResult.stats,
      chargeStage: chargeResult.stats
    }));

    // Concise UI alert — 6 key lines, full detail in Run Log (per review point 7)
    var alertLines = [
      'Charge Run Complete',
      '',
      'Push stage:',
      '  Pushed to Stax: ' + prepResult.stats.created,
      '',
      'Charge stage:',
      '  Charged: ' + chargeResult.stats.paid + ' paid, ' + chargeResult.stats.declined + ' declined',
      '  Skipped: ' + chargeResult.stats.noPaymentMethod + ' no-payment-method, ' + chargeResult.stats.alreadyPaid + ' already paid',
      '  Deferred: ' + chargeResult.stats.deferredByCap + ' by cap, ' + chargeResult.stats.deferredByBreaker + ' by breaker' +
        (chargeResult.stats.deferredByWatchdog ? ', ' + chargeResult.stats.deferredByWatchdog + ' by watchdog' : ''),
      '  Breaker tripped: ' + (chargeResult.stats.breakerTripped ? 'YES' : 'No'),
      '',
      'See Run Log for full details (skip reasons, API error counts).'
    ];
    ui.alert(alertLines.join('\n'));

  } finally {
    lock.releaseLock();
  }
}

// Headless charge runner — called by daily time-driven trigger.
// No UI alerts. Checks AUTO_CHARGE_ENABLED config flag.
function runChargesAuto() {
  // Check if auto-charge is enabled
  var autoEnabled = _getConfig('AUTO_CHARGE_ENABLED');
  if (!autoEnabled || autoEnabled.toUpperCase() !== 'TRUE') {
    _writeRunLog('runChargesAuto', 'Skipped: AUTO_CHARGE_ENABLED is not TRUE', '');
    return;
  }

  var preflight = _preflightApiCheck();
  if (preflight) {
    _writeRunLog('runChargesAuto', 'Preflight failed: ' + preflight, '');
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    _writeRunLog('runChargesAuto', 'Skipped: could not acquire lock (another run in progress)', '');
    return;
  }

  try {
    // v4.4.0: Phase 4A — two-stage pipeline under one lock.
    // v4.5.0: Charge stage now has per-run cap, throttle, circuit breaker, watchdog.
    //
    // Stage 1: Push any PENDING invoices that are eligible (due today-or-earlier
    //          + pass auto-charge policy with distinct CLIENT_AUTO_DISABLED vs
    //          UNKNOWN_CLIENT exception reasons) so they become CREATED.
    // Stage 2: Charge the loop — _executeChargeRun re-reads sheet data internally,
    //          so the rows we just created in Stage 1 are seen as CREATED.
    var prepResult = _prepareEligiblePendingInvoicesForChargeRun();
    var chargeResult = _executeChargeRun();

    // Combined run-log entry with distinguishable pushStage + chargeStage stats
    var combinedSummary =
      'push: ' + prepResult.stats.created + ' created, ' +
      prepResult.stats.skippedDupe + ' linked, ' +
      prepResult.stats.skippedNoCustomer + ' no-customer, ' +
      prepResult.stats.skippedFutureDue + ' future-due, ' +
      prepResult.stats.skippedClientAutoDisabled + ' client-auto-disabled, ' +
      prepResult.stats.skippedUnknownClient + ' unknown-client, ' +
      prepResult.stats.apiErrors + ' push-errors; ' +
      'charge: ' + chargeResult.stats.eligibleTotal + ' eligible, ' +
      chargeResult.stats.processedThisRun + ' processed, ' +
      chargeResult.stats.deferredByCap + ' def-cap, ' +
      chargeResult.stats.deferredByBreaker + ' def-breaker, ' +
      (chargeResult.stats.deferredByWatchdog || 0) + ' def-watchdog, ' +
      chargeResult.stats.paid + ' paid, ' +
      chargeResult.stats.declined + ' declined, ' +
      chargeResult.stats.noPaymentMethod + ' no-pm, ' +
      chargeResult.stats.alreadyPaid + ' already-paid, ' +
      chargeResult.stats.partial + ' partial, ' +
      chargeResult.stats.apiErrors + ' api-errors' +
      ' (breaker=' + chargeResult.stats.apiErrorsBreakerCounted + ', bad-row=' + chargeResult.stats.apiErrorsBadRow + '), ' +
      'breakerTripped=' + chargeResult.stats.breakerTripped +
      (chargeResult.stats.watchdogTripped ? ', watchdogTripped=true' : '');

    _writeRunLog('runChargesAuto', combinedSummary, JSON.stringify({
      pushStage: prepResult.stats,
      chargeStage: chargeResult.stats
    }));
  } catch (e) {
    _writeRunLog('runChargesAuto', 'ERROR: ' + e.message, e.stack || '');
  } finally {
    lock.releaseLock();
  }
}

// Core charge execution logic — shared by manual and auto runners.
// Returns { stats } object with counters.
// v4.5.0 — Charge loop refactored into 3 phases:
//   2a: Build candidate list (no API calls, no row writes)
//   2b: Apply per-run cap (MAX_AUTO_CHARGES_PER_RUN)
//   2c: Sequential charge loop with throttle, circuit breaker, and wall-time watchdog
//
// Per review: hard cap of 100 is treated as an upper bound, not a comfort zone. The
// wall-time watchdog aborts gracefully at ~5m30s to leave buffer before Apps Script's
// 6-minute execution limit. Rows not processed (by cap, breaker, or watchdog) remain
// CREATED in the sheet and will be re-attempted on the next run. No status changes
// are made to deferred rows.
function _executeChargeRun() {
  var ss = _getSpreadsheet();
  var invSheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
  var invData = invSheet.getDataRange().getValues();
  var payUrl = _getConfig('STAX_INVOICE_PAY_URL') || 'https://app.staxpayments.com/#/bill/';

  // Determine "today" in script timezone
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Wall-time watchdog start — aborts gracefully before Apps Script kills us
  var runStartedAt = Date.now();
  var WALL_TIME_BUDGET_MS = 330000; // 5 min 30s — leaves 30s buffer before 6m kill

  var stats = {
    // Existing fields preserved for back-compat
    eligible: 0,
    paid: 0,
    declined: 0,
    noPaymentMethod: 0,
    alreadyPaid: 0,
    partial: 0,
    apiErrors: 0,
    // v4.5.0: batch control counters
    scannedTotal: 0,
    eligibleTotal: 0,
    processedThisRun: 0,
    deferredByCap: 0,
    deferredByBreaker: 0,
    deferredByWatchdog: 0,
    breakerTripped: false,
    watchdogTripped: false,
    // v4.5.0: split skip-reason counters
    skippedNotCreated: 0,
    skippedMissingIds: 0,
    skippedFutureDue: 0,
    skippedManual: 0,
    skippedClientAutoDisabled: 0,
    skippedUnknownClient: 0,
    // v4.5.0: split API-error buckets
    apiErrorsBreakerCounted: 0,
    apiErrorsBadRow: 0
  };

  if (invData.length <= 1) {
    _writeRunLog('_executeChargeRun', 'No invoices in sheet', '');
    return { stats: stats };
  }

  // Read sheet columns once — candidate build is in-memory, no cell writes
  var numRows = invData.length - 1;
  var colHRange = invSheet.getRange(2, 8, numRows, 1);   // Stax Invoice ID
  var colIRange = invSheet.getRange(2, 9, numRows, 1);   // Status
  var colKRange = invSheet.getRange(2, 11, numRows, 1);  // Notes

  var colHValues = colHRange.getValues();
  var colIValues = colIRange.getValues();
  var colKValues = colKRange.getValues();

  var colIChanged = false;
  var colKChanged = false;

  // Cache payment methods per customer to avoid redundant API calls
  var pmCache = {};

  // v4.7.0 — 3-tier client lookup (Stax Customer ID → QB_CUSTOMER_NAME →
  // CLIENT NAME). Same shape as the prepare stage; see
  // _buildClientAutoChargeLookup_ for the column-resolution rationale.
  var clientLookupsExec = null;
  try {
    var cbId = PropertiesService.getScriptProperties().getProperty("CB_SPREADSHEET_ID");
    if (!cbId) {
      var cfgCb = _getConfig("CB_SPREADSHEET_ID");
      if (cfgCb) cbId = cfgCb;
    }
    if (cbId) {
      var cbSS = SpreadsheetApp.openById(cbId);
      var cbSheet = cbSS.getSheetByName("Clients");
      clientLookupsExec = _buildClientAutoChargeLookup_(cbSheet);
    }
  } catch (e) { Logger.log("_executeChargeRun: Auto Charge client lookup warning: " + e); }

  // v4.6.1 — Header-based lookup for Auto Charge column (fix for hardcoded
  // index 12 mismatching the actual sheet layout).
  var acColIdxExec = -1;
  // v4.7.0 — Header-based lookup for Scheduled Date column. When set, the
  // charge loop fires on Scheduled Date instead of Due Date. Empty → fallback.
  var schedColIdxExec = -1;
  try {
    var hdrsExec = invData[0] || [];
    for (var hh2 = 0; hh2 < hdrsExec.length; hh2++) {
      var _hdrName = String(hdrsExec[hh2]).trim();
      if (_hdrName === "Auto Charge") acColIdxExec = hh2;
      else if (_hdrName === "Scheduled Date") schedColIdxExec = hh2;
    }
  } catch (_) {}

  // ════════════════════════════════════════════════════════════════════
  // PHASE 2a — BUILD CANDIDATE LIST (no API calls, no row writes)
  // ════════════════════════════════════════════════════════════════════
  var candidates = [];
  for (var i = 0; i < numRows; i++) {
    stats.scannedTotal++;

    var rowStatus  = String(colIValues[i][0]).trim().toUpperCase();
    var staxInvId  = String(colHValues[i][0]).trim();
    var staxCustId = String(invData[i + 1][2]).trim();
    var dueDate    = String(invData[i + 1][4]).trim();
    // v4.7.0 — Scheduled Date override: when set, charge fires on this date
    // instead of Due Date. Empty → fall back to dueDate for timing.
    var schedDateRaw = (schedColIdxExec >= 0 && invData[i + 1].length > schedColIdxExec)
      ? String(invData[i + 1][schedColIdxExec] || "").trim()
      : "";
    var total      = parseFloat(invData[i + 1][5]);
    var docNum     = String(invData[i + 1][0]).trim();
    var custName   = String(invData[i + 1][1]).trim();

    // Gate 1: only CREATED rows
    if (rowStatus !== 'CREATED') {
      stats.skippedNotCreated++;
      continue;
    }
    // Gate 2: must have Stax IDs
    if (!staxInvId || !staxCustId) {
      stats.skippedMissingIds++;
      continue;
    }

    // Gate 3: charge date must be parseable and on or before today.
    // v4.7.0 — Prefer Scheduled Date (operator override) over Due Date.
    var chargeDateSrc = schedDateRaw || dueDate;
    var dueDateFormatted = _parseDateForStax(chargeDateSrc);
    if (!dueDateFormatted || dueDateFormatted > today) {
      stats.skippedFutureDue++;
      continue;
    }

    // Gate 4: Auto Charge policy (aligned with prepare stage — v4.5.0 fix)
    //   - Invoice TRUE → always eligible (overrides client FALSE)
    //   - Invoice FALSE → always skipped (operator choice, no exception logged)
    //   - Blank → fall back to client setting with two distinct buckets:
    //       CLIENT_AUTO_DISABLED (client=false) and UNKNOWN_CLIENT (client missing)
    var autoChargeVal = (acColIdxExec >= 0 && invData[i + 1].length > acColIdxExec) ? String(invData[i + 1][acColIdxExec] || "").trim().toUpperCase() : "";
    var invoiceExplicitlyAuto = (autoChargeVal === "TRUE" || autoChargeVal === "YES" || autoChargeVal === "ON");
    var invoiceExplicitlyManual = (autoChargeVal === "FALSE" || autoChargeVal === "NO" || autoChargeVal === "OFF");

    if (invoiceExplicitlyManual) {
      stats.skippedManual++;
      continue;
    }
    if (!invoiceExplicitlyAuto) {
      // v4.7.0 — 3-tier lookup. See _resolveClientAutoCharge_.
      var clientAC = _resolveClientAutoCharge_(clientLookupsExec, staxCustId, custName);
      if (clientAC === false) {
        stats.skippedClientAutoDisabled++;
        _logException(docNum, custName, staxCustId, total, dueDate,
          '_executeChargeRun: CLIENT_AUTO_DISABLED - Client "' + custName + '" has Auto Charge disabled in CB Clients. Set invoice Auto Charge explicitly to override.',
          payUrl + staxInvId);
        continue;
      }
      if (clientAC === undefined) {
        stats.skippedUnknownClient++;
        _logException(docNum, custName, staxCustId, total, dueDate,
          '_executeChargeRun: UNKNOWN_CLIENT - No CB Clients row matched. Tried Stax Customer ID "' + staxCustId + '", QB_CUSTOMER_NAME "' + custName + '", and CLIENT NAME "' + custName + '". Add a CB Clients row with one of those keys + an Auto Charge preference, OR set this invoice\'s Auto Charge field explicitly.',
          payUrl + staxInvId);
        continue;
      }
      // clientAC === true → eligible
    }
    // invoiceExplicitlyAuto === true → eligible regardless of client

    // Passed all gates — add to candidate list
    candidates.push({
      rowIndex: i,
      docNum: docNum,
      custName: custName,
      staxInvId: staxInvId,
      staxCustId: staxCustId,
      dueDate: dueDate,
      dueDateFormatted: dueDateFormatted,
      total: total
    });
  }

  // Deterministic sort: dueDate ascending (oldest first), then rowIndex ascending
  candidates.sort(function(a, b) {
    if (a.dueDateFormatted < b.dueDateFormatted) return -1;
    if (a.dueDateFormatted > b.dueDateFormatted) return 1;
    return a.rowIndex - b.rowIndex;
  });

  stats.eligibleTotal = candidates.length;
  stats.eligible = candidates.length; // back-compat alias

  // ════════════════════════════════════════════════════════════════════
  // PHASE 2b — APPLY PER-RUN CAP
  // ════════════════════════════════════════════════════════════════════
  var maxPerRun = _getIntConfig_('MAX_AUTO_CHARGES_PER_RUN', 25, 1, 100);
  var toProcess;
  if (candidates.length > maxPerRun) {
    toProcess = candidates.slice(0, maxPerRun);
    stats.deferredByCap = candidates.length - maxPerRun;
  } else {
    toProcess = candidates;
    stats.deferredByCap = 0;
  }

  // Early exit if nothing to process
  if (toProcess.length === 0) {
    if (colIChanged) colIRange.setValues(colIValues);
    if (colKChanged) colKRange.setValues(colKValues);
    var emptySummary = '0 eligible, 0 processed' +
      (stats.scannedTotal > 0 ? ' (scanned ' + stats.scannedTotal + ')' : '');
    _writeRunLog('_executeChargeRun', emptySummary, JSON.stringify(stats));
    return { stats: stats };
  }

  // ════════════════════════════════════════════════════════════════════
  // PHASE 2c — SEQUENTIAL CHARGE LOOP
  //   Throttle: AUTO_CHARGE_DELAY_MS between actual charge attempts
  //   Circuit breaker: AUTO_CHARGE_CIRCUIT_BREAKER_COUNT consecutive 5xx/network
  //                    errors (404s and declines do NOT count)
  //   Watchdog: aborts gracefully at 5m30s to leave buffer
  // ════════════════════════════════════════════════════════════════════
  var delayMs = _getIntConfig_('AUTO_CHARGE_DELAY_MS', 1500, 0, 10000);
  var breakerCount = _getIntConfig_('AUTO_CHARGE_CIRCUIT_BREAKER_COUNT', 3, 1, 10);

  var consecutiveApiFailures = 0;
  var chargeAttemptsMade = 0;

  // Helper: does an HTTP status represent a "bad row / deterministic data" error
  // (which should NOT count toward the breaker) vs a "system instability" error
  // (which SHOULD count)?
  function isBadRowStatus_(httpStatus) {
    // 404 invoice-not-found is always bad row data
    if (httpStatus === 404) return true;
    // 400/422 are usually bad row data (validation failures, invalid IDs, etc.)
    if (httpStatus === 400 || httpStatus === 422) return true;
    // Everything else (5xx, network 0, timeouts, 401/403 auth issues) = system instability
    return false;
  }

  for (var ci2 = 0; ci2 < toProcess.length; ci2++) {
    var c = toProcess[ci2];

    // Watchdog check — abort gracefully if we're running out of budget
    if (Date.now() - runStartedAt > WALL_TIME_BUDGET_MS) {
      stats.watchdogTripped = true;
      var remainingByWatchdog = toProcess.length - ci2;
      stats.deferredByWatchdog = remainingByWatchdog;
      Logger.log('_executeChargeRun: Wall-time watchdog tripped at ' +
        ((Date.now() - runStartedAt) / 1000).toFixed(1) +
        's — deferring ' + remainingByWatchdog + ' remaining candidates');
      break;
    }

    // Breaker short-circuit — skip remaining rows without touching sheet/API
    if (stats.breakerTripped) {
      stats.deferredByBreaker++;
      continue;
    }

    var i = c.rowIndex; // 0-based offset from header row
    var didCallChargeApi = false;

    // --- SAFEGUARD 1: Pre-charge invoice status check ---
    var invCheck = _staxApiRequest('GET', '/invoice/' + c.staxInvId, null);
    if (!invCheck.success) {
      var preCheckStatus = invCheck.status || 0;
      var isBadRow = isBadRowStatus_(preCheckStatus);

      _logChargeResult(c.docNum, c.staxInvId, c.staxCustId, c.custName, c.total, 'API_ERROR',
        '', 'Pre-charge check failed (HTTP ' + preCheckStatus + '): ' + (invCheck.error || 'Unknown'));
      _logException(c.docNum, c.custName, c.staxCustId, c.total, c.dueDate,
        '_executeChargeRun: API_ERROR - Pre-charge check failed (HTTP ' + preCheckStatus + '): ' + (invCheck.error || 'Unknown'),
        payUrl + c.staxInvId);
      colIValues[i][0] = 'CHARGE_FAILED';
      colKValues[i][0] = 'Pre-charge check failed (HTTP ' + preCheckStatus + ')';
      colIChanged = true;
      colKChanged = true;
      stats.apiErrors++;

      if (isBadRow) {
        // Bad-row data (404, 400, 422) — do NOT count toward breaker, reset counter
        stats.apiErrorsBadRow++;
        consecutiveApiFailures = 0;
      } else {
        // System/network/5xx — counts toward breaker
        stats.apiErrorsBreakerCounted++;
        consecutiveApiFailures++;
        if (consecutiveApiFailures >= breakerCount) {
          stats.breakerTripped = true;
          Logger.log('_executeChargeRun: Circuit breaker tripped after ' + breakerCount +
            ' consecutive API/system failures — remaining ' + (toProcess.length - ci2 - 1) +
            ' candidates will be deferred to next run.');
        }
      }
      continue; // NO delay after pre-charge check failures (no charge API call made)
    }

    // Check if already paid in Stax
    var staxInvData = invCheck.data;
    var staxStatus = String(staxInvData.status || '').toUpperCase();
    if (staxStatus === 'PAID') {
      colIValues[i][0] = 'PAID';
      colKValues[i][0] = 'Already paid in Stax (detected during charge run)';
      colIChanged = true;
      colKChanged = true;
      stats.alreadyPaid++;
      _logChargeResult(c.docNum, c.staxInvId, c.staxCustId, c.custName, c.total, 'ALREADY_PAID',
        '', 'Invoice was already paid in Stax');
      consecutiveApiFailures = 0; // reset — successful detection
      continue; // NO delay — no charge API call made
    }

    // Check for zero balance due
    var balanceDue = parseFloat(staxInvData.balance_due);
    if (!isNaN(balanceDue) && balanceDue <= 0) {
      colIValues[i][0] = 'PAID';
      colKValues[i][0] = 'Balance due is zero in Stax';
      colIChanged = true;
      colKChanged = true;
      stats.alreadyPaid++;
      consecutiveApiFailures = 0;
      continue; // NO delay — no charge API call made
    }

    // --- SAFEGUARD 2: Get payment method ---
    var pm;
    if (pmCache[c.staxCustId]) {
      pm = pmCache[c.staxCustId];
    } else {
      pm = _getDefaultPaymentMethod(c.staxCustId);
      pmCache[c.staxCustId] = pm;
    }

    if (!pm.found) {
      _logChargeResult(c.docNum, c.staxInvId, c.staxCustId, c.custName, c.total, 'NO_PAYMENT_METHOD',
        '', pm.error || 'No active payment method on file');
      _logException(c.docNum, c.custName, c.staxCustId, c.total, c.dueDate,
        '_executeChargeRun: NO_PAYMENT_METHOD - ' + (pm.error || 'No active payment method on file'),
        payUrl + c.staxInvId);
      colIValues[i][0] = 'CHARGE_FAILED';
      colKValues[i][0] = 'No payment method on file';
      colIChanged = true;
      colKChanged = true;
      stats.noPaymentMethod++;
      consecutiveApiFailures = 0; // reset — not a breaker case
      continue; // NO delay — no charge API call made
    }

    // --- SAFEGUARD 3: Double-charge protection marker ---
    colKValues[i][0] = 'CHARGE_ATTEMPT|' + _formatTimestamp(new Date());
    colKChanged = true;
    colKRange.setValues(colKValues); // flush marker immediately

    // --- Execute charge ---
    var chargeResult = _chargeInvoice(c.staxInvId, pm.methodId);
    didCallChargeApi = true;
    chargeAttemptsMade++;

    if (chargeResult.success) {
      colIValues[i][0] = 'PAID';
      colKValues[i][0] = 'Paid via ' + pm.methodId + ' | txn: ' + chargeResult.transactionId;
      colIChanged = true;
      colKChanged = true;
      stats.paid++;
      stats.processedThisRun++;
      _logChargeResult(c.docNum, c.staxInvId, c.staxCustId, c.custName, c.total, 'SUCCESS',
        chargeResult.transactionId, '');
      consecutiveApiFailures = 0;

    } else if (chargeResult.partial) {
      colIValues[i][0] = 'CHARGE_FAILED';
      colKValues[i][0] = 'Partial payment: ' + chargeResult.error;
      colIChanged = true;
      colKChanged = true;
      stats.partial++;
      stats.processedThisRun++;
      _logChargeResult(c.docNum, c.staxInvId, c.staxCustId, c.custName, c.total, 'PARTIAL',
        chargeResult.transactionId || '', chargeResult.error || 'Partial payment detected');
      _logException(c.docNum, c.custName, c.staxCustId, c.total, c.dueDate,
        '_executeChargeRun: PARTIAL - ' + (chargeResult.error || 'Partial payment'),
        payUrl + c.staxInvId);
      consecutiveApiFailures = 0; // reset — partial is row-specific, not system

    } else {
      // Full failure — declined, API error, or bad row data
      var chargeStatus = chargeResult.declined ? 'DECLINED' : 'API_ERROR';
      colIValues[i][0] = 'CHARGE_FAILED';
      colKValues[i][0] = chargeStatus + ': ' + (chargeResult.error || 'Unknown').substring(0, 200);
      colIChanged = true;
      colKChanged = true;
      stats.processedThisRun++;

      if (chargeResult.declined) {
        stats.declined++;
        consecutiveApiFailures = 0; // declines don't trip breaker
      } else {
        stats.apiErrors++;
        var chargeBadRow = isBadRowStatus_(chargeResult.httpStatus || 0);
        if (chargeBadRow) {
          stats.apiErrorsBadRow++;
          consecutiveApiFailures = 0;
        } else {
          stats.apiErrorsBreakerCounted++;
          consecutiveApiFailures++;
          if (consecutiveApiFailures >= breakerCount) {
            stats.breakerTripped = true;
            Logger.log('_executeChargeRun: Circuit breaker tripped after ' + breakerCount +
              ' consecutive API/system failures during charge — remaining ' + (toProcess.length - ci2 - 1) +
              ' candidates will be deferred to next run.');
          }
        }
      }

      _logChargeResult(c.docNum, c.staxInvId, c.staxCustId, c.custName, c.total, chargeStatus,
        '', chargeResult.error || 'Unknown');
      _logException(c.docNum, c.custName, c.staxCustId, c.total, c.dueDate,
        '_executeChargeRun: ' + chargeStatus + ' - ' + (chargeResult.error || 'Unknown'),
        payUrl + c.staxInvId);
    }

    // --- Throttle (between actual charge attempts only) ---
    // Only sleep if: charge API was actually called, not the last candidate,
    // breaker hasn't tripped, watchdog hasn't tripped, and delay is > 0
    var isLastCandidate = (ci2 === toProcess.length - 1);
    if (didCallChargeApi && !isLastCandidate && !stats.breakerTripped && delayMs > 0) {
      Utilities.sleep(delayMs);
    }
  }

  // Batch write all row updates
  if (colIChanged) colIRange.setValues(colIValues);
  if (colKChanged) colKRange.setValues(colKValues);

  // Expanded summary with batch control visibility
  var summary = stats.eligibleTotal + ' eligible, ' +
    stats.processedThisRun + ' processed';
  if (stats.deferredByCap > 0) summary += ', ' + stats.deferredByCap + ' deferred-cap';
  if (stats.deferredByBreaker > 0) summary += ', ' + stats.deferredByBreaker + ' deferred-breaker';
  if (stats.deferredByWatchdog > 0) summary += ', ' + stats.deferredByWatchdog + ' deferred-watchdog';
  summary += '; ' +
    stats.paid + ' paid, ' +
    stats.declined + ' declined, ' +
    stats.noPaymentMethod + ' no-pm, ' +
    stats.alreadyPaid + ' already-paid, ' +
    stats.partial + ' partial, ' +
    stats.apiErrors + ' api-errors' +
    ' (breaker=' + stats.apiErrorsBreakerCounted + ', bad-row=' + stats.apiErrorsBadRow + ')' +
    ', breakerTripped=' + stats.breakerTripped +
    (stats.watchdogTripped ? ', watchdogTripped=true' : '');

  _writeRunLog('_executeChargeRun', summary, JSON.stringify(stats));

  // v4.6.0 — Supabase write-through (session 69 Phase 2f).
  // Resync invoices + charge log + exceptions + run log tails.
  try { _sbResyncAllStaxInvoices(ss); } catch (_) {}
  try { _sbResyncAllStaxCharges(ss); } catch (_) {}
  try { _sbResyncStaxExceptions(ss); } catch (_) {}
  try { _sbResyncStaxRunLog(ss); } catch (_) {}

  return { stats: stats };
}

// ============================================================
// PHASE 3: CHARGE HELPERS
// ============================================================

// Charges a Stax invoice using the specified payment method.
// Pre-validates the invoice is still chargeable.
// Returns { success, transactionId, error, declined, partial }
function _chargeInvoice(staxInvoiceId, paymentMethodId) {
  var payload = {
    payment_method_id: paymentMethodId,
    email_receipt: '1'
  };

  var result = _staxApiRequest('POST', '/invoice/' + staxInvoiceId + '/pay', payload);

  if (result.success && result.data) {
    // Check if fully paid
    var balanceDue = parseFloat(result.data.balance_due);
    var invoiceStatus = String(result.data.status || '').toUpperCase();

    // Extract transaction ID from response
    var transactionId = '';
    if (result.data.transactions && result.data.transactions.length > 0) {
      transactionId = result.data.transactions[result.data.transactions.length - 1].id || '';
    } else if (result.data.transaction_id) {
      transactionId = result.data.transaction_id;
    } else if (result.data.id) {
      transactionId = result.data.id; // fallback to invoice id
    }

    // Check for partial payment
    if (!isNaN(balanceDue) && balanceDue > 0 && invoiceStatus !== 'PAID') {
      return {
        success: false,
        transactionId: transactionId,
        error: 'Remaining balance: ' + balanceDue,
        declined: false,
        partial: true,
        httpStatus: result.status || 200
      };
    }

    return {
      success: true,
      transactionId: transactionId,
      error: null,
      declined: false,
      partial: false,
      httpStatus: result.status || 200
    };
  }

  // Failure — determine if it's a decline vs other error
  var isDeclined = false;
  var errMsg = result.error || 'Unknown error';

  if (result.status === 422 || result.status === 400) {
    // Likely a processor decline or validation error
    var errLower = errMsg.toLowerCase();
    if (errLower.indexOf('decline') !== -1 ||
        errLower.indexOf('insufficient') !== -1 ||
        errLower.indexOf('expired') !== -1 ||
        errLower.indexOf('card') !== -1 ||
        errLower.indexOf('do not honor') !== -1) {
      isDeclined = true;
    }
  }

  return {
    success: false,
    transactionId: '',
    error: errMsg,
    declined: isDeclined,
    partial: false,
    httpStatus: result.status || 0
  };
}

// Gets the default (or first active) payment method for a customer.
// Prefers is_default=true, falls back to first active method.
// Active = not deleted, not purged.
// Returns { found, methodId, methodType, error }
function _getDefaultPaymentMethod(staxCustomerId) {
  var result = _staxApiRequest('GET', '/customer/' + staxCustomerId + '/payment-method', null);

  if (!result.success) {
    return {
      found: false,
      methodId: null,
      methodType: null,
      error: 'API error fetching payment methods: ' + (result.error || 'Unknown')
    };
  }

  var methods = _extractArrayFromResponse(result.data);

  // Filter to active methods only
  var activeMethods = [];
  for (var i = 0; i < methods.length; i++) {
    var m = methods[i];
    if (!m.deleted_at && !m.purged_at) {
      activeMethods.push(m);
    }
  }

  if (activeMethods.length === 0) {
    return {
      found: false,
      methodId: null,
      methodType: null,
      error: 'No active payment methods on file'
    };
  }

  // Prefer is_default = true
  for (var j = 0; j < activeMethods.length; j++) {
    if (activeMethods[j].is_default === true || activeMethods[j].is_default === 1) {
      return {
        found: true,
        methodId: activeMethods[j].id,
        methodType: activeMethods[j].method || 'unknown',
        error: null
      };
    }
  }

  // Fallback: first active method
  return {
    found: true,
    methodId: activeMethods[0].id,
    methodType: activeMethods[0].method || 'unknown',
    error: null
  };
}

// Logs a charge result to the Charge Log tab.
function _logChargeResult(docNum, staxInvId, staxCustId, custName, amount, status, transactionId, notes) {
  var ss = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.CHARGE_LOG);
  if (!sheet) return;

  var row = [
    _formatTimestamp(new Date()),
    docNum || '',
    staxInvId || '',
    staxCustId || '',
    custName || '',
    amount || '',
    status || '',
    transactionId || '',
    notes || ''
  ];

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

// ============================================================
// PHASE 3: DAILY TRIGGER MANAGEMENT
// ============================================================

// Sets up a daily time-driven trigger for runChargesAuto at ~8 AM.
// Prevents duplicate triggers.
function setupDailyTrigger() {
  var ui = SpreadsheetApp.getUi();

  // Check for existing trigger
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runChargesAuto') {
      ui.alert('Daily auto-charge trigger is already enabled.\n\n' +
        'To reset it, first click "Disable Daily Auto-Charge", then re-enable.');
      return;
    }
  }

  // Create the trigger — runs daily between 8:00-9:00 AM in script timezone
  ScriptApp.newTrigger('runChargesAuto')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  _writeRunLog('setupDailyTrigger', 'Daily auto-charge trigger enabled (8 AM)', '');

  ui.alert('Daily auto-charge trigger enabled.\n\n' +
    'runChargesAuto will run once daily between 8-9 AM.\n' +
    'Make sure AUTO_CHARGE_ENABLED is set to TRUE in the Config tab.');
}

// Removes the daily trigger for runChargesAuto.
function removeDailyTrigger() {
  var ui = SpreadsheetApp.getUi();
  var removed = 0;

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runChargesAuto') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  if (removed > 0) {
    _writeRunLog('removeDailyTrigger', 'Daily auto-charge trigger disabled', '');
    ui.alert('Daily auto-charge trigger has been disabled.');
  } else {
    ui.alert('No daily auto-charge trigger was found.');
  }
}

// ============================================================
// PHASE 4: EXCEPTION HANDLING + SEND PAY LINKS
// ============================================================

// Sends a Stax invoice email with pay link to the customer.
// Uses PUT /invoice/{id}/send/email.
// Returns { success, error }
function _sendInvoiceEmail(staxInvoiceId) {
  var result = _staxApiRequest('PUT', '/invoice/' + staxInvoiceId + '/send/email', {});

  if (result.success) {
    return { success: true, error: null };
  }

  return {
    success: false,
    error: result.error || 'Unknown error sending invoice email'
  };
}

// Review Exceptions — shows summary dialog of unresolved exceptions grouped by type.
function reviewExceptions() {
  var ui = SpreadsheetApp.getUi();
  var ss = _getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.EXCEPTIONS);

  if (!sheet) {
    ui.alert('Exceptions tab not found. Run Setup Sheets first.');
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    ui.alert('No exceptions found.');
    return;
  }

  // Count unresolved exceptions by reason category
  var counts = {
    noPaymentMethod: 0,
    declined: 0,
    apiError: 0,
    partial: 0,
    blankInvoice: 0,
    other: 0,
    total: 0,
    resolved: 0
  };

  for (var i = 1; i < data.length; i++) {
    var resolved = String(data[i][8]).trim();
    if (resolved) {
      counts.resolved++;
      continue;
    }

    counts.total++;
    var reason = String(data[i][6]).toUpperCase();

    if (reason.indexOf('NO_PAYMENT_METHOD') !== -1) {
      counts.noPaymentMethod++;
    } else if (reason.indexOf('DECLINED') !== -1 || reason.indexOf('DO NOT HONOR') !== -1) {
      counts.declined++;
    } else if (reason.indexOf('API_ERROR') !== -1) {
      counts.apiError++;
    } else if (reason.indexOf('PARTIAL') !== -1) {
      counts.partial++;
    } else if (reason.indexOf('BLANK QB INVOICE') !== -1) {
      counts.blankInvoice++;
    } else {
      counts.other++;
    }
  }

  // Also count how many CHARGE_FAILED invoices are eligible for pay link
  var invSheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
  var invData = invSheet ? invSheet.getDataRange().getValues() : [];
  var payLinkEligible = 0;
  for (var j = 1; j < invData.length; j++) {
    var status = String(invData[j][8]).trim().toUpperCase();
    var staxInvId = String(invData[j][7]).trim();
    if (status === 'CHARGE_FAILED' && staxInvId) {
      payLinkEligible++;
    }
  }

  var msg = 'Exception Summary (Unresolved)\n\n' +
    'Total Unresolved: ' + counts.total + '\n' +
    'Resolved: ' + counts.resolved + '\n' +
    '─────────────────────\n' +
    'No Payment Method: ' + counts.noPaymentMethod + '\n' +
    'Declined: ' + counts.declined + '\n' +
    'API Errors: ' + counts.apiError + '\n' +
    'Partial Payments: ' + counts.partial + '\n' +
    'Blank Invoice #: ' + counts.blankInvoice + '\n' +
    'Other: ' + counts.other + '\n' +
    '─────────────────────\n' +
    'Pay Link Eligible (CHARGE_FAILED with Stax ID): ' + payLinkEligible + '\n\n' +
    (payLinkEligible > 0
      ? 'Use "Send Pay Links (Failed Charges)" to email pay links to these customers.'
      : 'No invoices are currently eligible for pay link sending.');

  ui.alert(msg);
}

// Send Pay Links — bulk sends Stax invoice emails for all CHARGE_FAILED invoices.
// Shows confirmation before sending. Updates status to SENT on success.
function sendPayLinks() {
  var ui = SpreadsheetApp.getUi();

  var preflight = _preflightApiCheck();
  if (preflight) {
    ui.alert(preflight);
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Another operation is in progress. Please try again in a moment.');
    return;
  }

  try {
    var ss = _getSpreadsheet();
    var invSheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
    var invData = invSheet.getDataRange().getValues();

    if (invData.length <= 1) {
      ui.alert('No invoices found.');
      return;
    }

    // Find eligible invoices (CHARGE_FAILED with Stax Invoice ID)
    var numRows = invData.length - 1;
    var eligible = [];

    for (var i = 0; i < numRows; i++) {
      var status    = String(invData[i + 1][8]).trim().toUpperCase();
      var staxInvId = String(invData[i + 1][7]).trim();

      if (status === 'CHARGE_FAILED' && staxInvId) {
        eligible.push({
          rowIndex: i,
          docNum: String(invData[i + 1][0]).trim(),
          custName: String(invData[i + 1][1]).trim(),
          staxInvId: staxInvId,
          amount: invData[i + 1][5]
        });
      }
    }

    if (eligible.length === 0) {
      ui.alert('No CHARGE_FAILED invoices with Stax Invoice IDs found.\n\nNothing to send.');
      return;
    }

    // Confirmation dialog
    var confirm = ui.alert(
      'Send Pay Link Emails',
      'About to send pay link emails for ' + eligible.length + ' invoice(s).\n\n' +
      'Each customer will receive a Stax email with a link to pay their invoice.\n\n' +
      'Proceed?',
      ui.ButtonSet.YES_NO
    );

    if (confirm !== ui.Button.YES) {
      ui.alert('Cancelled. No emails were sent.');
      return;
    }

    // Read columns for batch update
    var colIRange = invSheet.getRange(2, 9, numRows, 1);   // Status
    var colKRange = invSheet.getRange(2, 11, numRows, 1);  // Notes
    var colIValues = colIRange.getValues();
    var colKValues = colKRange.getValues();
    var colIChanged = false;
    var colKChanged = false;

    var stats = { sent: 0, failed: 0, total: eligible.length };

    for (var e = 0; e < eligible.length; e++) {
      var inv = eligible[e];
      var sendResult = _sendInvoiceEmail(inv.staxInvId);

      if (sendResult.success) {
        colIValues[inv.rowIndex][0] = 'SENT';
        colKValues[inv.rowIndex][0] = 'Pay link emailed ' + _formatTimestamp(new Date());
        colIChanged = true;
        colKChanged = true;
        stats.sent++;
      } else {
        colKValues[inv.rowIndex][0] = 'Send failed: ' + (sendResult.error || 'Unknown').substring(0, 200);
        colKChanged = true;
        stats.failed++;

        _logException(inv.docNum, inv.custName, '', inv.amount, '',
          'sendPayLinks: SEND_FAILED - ' + (sendResult.error || 'Unknown'), '');
      }
    }

    // Batch write
    if (colIChanged) colIRange.setValues(colIValues);
    if (colKChanged) colKRange.setValues(colKValues);

    var summary = stats.sent + ' sent, ' + stats.failed + ' failed';
    _writeRunLog('sendPayLinks', summary, JSON.stringify(stats));

    ui.alert('Send Pay Links Complete\n\n' +
      'Total: ' + stats.total + '\n' +
      'Sent: ' + stats.sent + '\n' +
      'Failed: ' + stats.failed);

  } finally {
    lock.releaseLock();
  }
}

// Send a pay link for a single invoice by QB Invoice #.
// Prompts the user for the invoice number.
function sendSinglePayLink() {
  var ui = SpreadsheetApp.getUi();

  var preflight = _preflightApiCheck();
  if (preflight) {
    ui.alert(preflight);
    return;
  }

  // Try to read from active cell first (if on Invoices or Exceptions tab)
  var ss = _getSpreadsheet();
  var activeSheet = ss.getActiveSheet();
  var activeCell = activeSheet.getActiveCell();
  var defaultDocNum = '';

  if (activeSheet.getName() === SHEET_NAMES.INVOICES && activeCell) {
    // Read QB Invoice # from column A of the active row
    var activeRow = activeCell.getRow();
    if (activeRow > 1) {
      defaultDocNum = String(activeSheet.getRange(activeRow, 1).getValue()).trim();
    }
  } else if (activeSheet.getName() === SHEET_NAMES.EXCEPTIONS && activeCell) {
    // Read QB Invoice # from column B of the active row
    var exRow = activeCell.getRow();
    if (exRow > 1) {
      defaultDocNum = String(activeSheet.getRange(exRow, 2).getValue()).trim();
    }
  }

  // Prompt for invoice number
  var prompt = ui.prompt(
    'Send Single Pay Link',
    'Enter the QB Invoice # to send a pay link for:' +
    (defaultDocNum ? '\n(Detected: ' + defaultDocNum + ' — press OK to use)' : ''),
    ui.ButtonSet.OK_CANCEL
  );

  if (prompt.getSelectedButton() !== ui.Button.OK) return;

  var docNum = prompt.getResponseText().trim() || defaultDocNum;
  if (!docNum) {
    ui.alert('No invoice number provided.');
    return;
  }

  // Find the invoice row
  var invSheet = ss.getSheetByName(SHEET_NAMES.INVOICES);
  var invData = invSheet.getDataRange().getValues();
  var foundRow = -1;
  var staxInvId = '';
  var custName = '';

  for (var i = 1; i < invData.length; i++) {
    if (String(invData[i][0]).trim() === docNum) {
      foundRow = i;
      staxInvId = String(invData[i][7]).trim();
      custName = String(invData[i][1]).trim();
      break;
    }
  }

  if (foundRow === -1) {
    ui.alert('Invoice #' + docNum + ' not found in the Invoices tab.');
    return;
  }

  if (!staxInvId) {
    ui.alert('Invoice #' + docNum + ' does not have a Stax Invoice ID.\n\n' +
      'The invoice must be created in Stax first (run Create Stax Invoices).');
    return;
  }

  // Confirm
  var confirm = ui.alert(
    'Send Pay Link',
    'Send pay link email for Invoice #' + docNum + ' (' + custName + ')?\n\n' +
    'Stax Invoice ID: ' + staxInvId,
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  var sendResult = _sendInvoiceEmail(staxInvId);

  if (sendResult.success) {
    // Update status
    invSheet.getRange(foundRow + 1, 9).setValue('SENT');
    invSheet.getRange(foundRow + 1, 11).setValue('Pay link emailed ' + _formatTimestamp(new Date()));
    _writeRunLog('sendSinglePayLink', 'Sent pay link for #' + docNum + ' to ' + custName, '');
    ui.alert('Pay link sent for Invoice #' + docNum + ' (' + custName + ').');
  } else {
    ui.alert('Failed to send pay link for Invoice #' + docNum + '.\n\n' +
      'Error: ' + (sendResult.error || 'Unknown'));
  }
}

// Mark the active row in the Exceptions tab as resolved.
// Writes a timestamp to the Resolved column (I).
function markExceptionResolved() {
  var ui = SpreadsheetApp.getUi();
  var ss = _getSpreadsheet();
  var activeSheet = ss.getActiveSheet();

  if (activeSheet.getName() !== SHEET_NAMES.EXCEPTIONS) {
    ui.alert('Please navigate to the Exceptions tab first, then select the row you want to resolve.');
    return;
  }

  var activeCell = activeSheet.getActiveCell();
  if (!activeCell || activeCell.getRow() <= 1) {
    ui.alert('Please select a row in the Exceptions tab (below the header row).');
    return;
  }

  var row = activeCell.getRow();
  var currentResolved = String(activeSheet.getRange(row, 9).getValue()).trim();

  if (currentResolved) {
    ui.alert('This exception is already marked as resolved (' + currentResolved + ').');
    return;
  }

  // Get some context for confirmation
  var docNum = String(activeSheet.getRange(row, 2).getValue()).trim();
  var custName = String(activeSheet.getRange(row, 3).getValue()).trim();
  var reason = String(activeSheet.getRange(row, 7).getValue()).trim();

  var confirm = ui.alert(
    'Mark Exception Resolved',
    'Mark this exception as resolved?\n\n' +
    'Row ' + row + ': #' + docNum + ' / ' + custName + '\n' +
    'Reason: ' + reason.substring(0, 100),
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  activeSheet.getRange(row, 9).setValue(_formatTimestamp(new Date()));
  ui.alert('Exception marked as resolved.');
}
