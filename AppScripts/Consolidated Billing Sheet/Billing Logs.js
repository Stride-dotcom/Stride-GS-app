/***************************************************************
[ADD-ON] STRIDE CONSOLIDATED BILLING LOGGING WRAPPER — v2.0.0

PURPOSE
- Single consolidated Billing_Log sheet for all pipeline events.
- Wraps base billing functions to capture success/error with timing.

LOGGED EVENTS
(A) StrideGenerateStorageCharges  — via StrideGenerateStorageCharges_WithLogs()
(B) CB13_generateUnbilledReport   — via CB13_generateUnbilledReport_WithLogs()
(C) CB13_commitInvoice            — logged directly inside Invoice Commit.gs

SHEET: Billing_Log
Headers: Timestamp | Function | Type | Status | Invoice # |
         Duration ms | Details | Suggested Fix
****************************************************************/

var LOG_SHEET_NAME = "Billing_Log";
var LOG_HEADERS = [
  "Timestamp", "Function", "Type", "Status", "Invoice #",
  "Duration ms", "Details", "Suggested Fix"
];

// -------------------------
// INSTALL
// -------------------------

function installBillingLogSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, LOG_SHEET_NAME, LOG_HEADERS);

  // Clean up legacy log sheets
  var legacy = [
    "Billing_Run_Success", "Billing_Run_Errors",
    "Invoice_Run_Success", "Invoice_Run_Errors",
    "Invoice_Review"
  ];
  var deleted = [];
  legacy.forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (sh) {
      ss.deleteSheet(sh);
      deleted.push(name);
    }
  });

  var msg = "Billing_Log sheet installed/verified.";
  if (deleted.length) {
    msg += "\n\nRemoved legacy sheets:\n- " + deleted.join("\n- ");
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log(msg); }
}

// -------------------------
// WRAPPED ENTRYPOINTS
// -------------------------

function StrideGenerateStorageCharges_WithLogs() {
  var started = new Date();
  try {
    assertFnExists_("StrideGenerateStorageCharges");
    StrideGenerateStorageCharges();
    logBilling_({
      fn: "StrideGenerateStorageCharges",
      type: "Billing Run",
      status: "Success",
      started: started,
      details: "OK"
    });
  } catch (err) {
    logBilling_({
      fn: "StrideGenerateStorageCharges",
      type: "Billing Run",
      status: "Error",
      started: started,
      details: errToString_(err),
      fix: suggestFix_(errToString_(err), err.stack || "")
    });
    safeEmailError_("StrideGenerateStorageCharges", "", err);
    throw err;
  }
}

function CB13_generateUnbilledReport_WithLogs() {
  var started = new Date();
  try {
    assertFnExists_("CB13_generateUnbilledReport");
    CB13_generateUnbilledReport();
    logBilling_({
      fn: "CB13_generateUnbilledReport",
      type: "Billing Run",
      status: "Success",
      started: started,
      details: "OK"
    });
  } catch (err) {
    logBilling_({
      fn: "CB13_generateUnbilledReport",
      type: "Billing Run",
      status: "Error",
      started: started,
      details: errToString_(err),
      fix: suggestFix_(errToString_(err), err.stack || "")
    });
    safeEmailError_("CB13_generateUnbilledReport", "", err);
    throw err;
  }
}

// -------------------------
// CORE LOGGING FUNCTION
// -------------------------

/**
 * Central logging function. Writes a single row to Billing_Log.
 * @param {Object} opts
 * @param {string} opts.fn        - Function name
 * @param {string} opts.type      - "Billing Run" or "Invoice"
 * @param {string} opts.status    - "Success" or "Error"
 * @param {Date}   opts.started   - Start time
 * @param {string} [opts.invoiceId] - Invoice number (for invoice events)
 * @param {string} [opts.details] - Result details or error message
 * @param {string} [opts.fix]     - Suggested fix (for errors)
 */
function logBilling_(opts) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sh) {
      sh = ensureSheet_(ss, LOG_SHEET_NAME, LOG_HEADERS);
    }
    var durationMs = opts.started
      ? (new Date().getTime() - opts.started.getTime()) : "";
    sh.appendRow([
      new Date(),
      opts.fn || "",
      opts.type || "",
      opts.status || "",
      opts.invoiceId || "",
      durationMs,
      opts.details || "",
      opts.fix || ""
    ]);
  } catch (e) {
    Logger.log("logBilling_ failed: " + errToString_(e));
  }
}

// -------------------------
// EMAIL HELPER
// -------------------------

function safeEmailError_(fn, invoiceId, err) {
  try {
    var to = "";
    try {
      to = CB_KEYS && CB_KEYS.OWNER_EMAIL
        ? getSetting_(SpreadsheetApp.getActiveSpreadsheet(),
                      CB_KEYS.OWNER_EMAIL) : "";
    } catch(_) {}
    if (!to) to = "info@stridenw.com";

    var msg = errToString_(err);
    var stack = (err && err.stack) ? String(err.stack) : "";
    var fix = suggestFix_(msg, stack);

    var subject = "Stride Billing Error: " + fn;
    var body =
      "Function: " + fn + "\n" +
      (invoiceId ? ("Invoice ID: " + invoiceId + "\n") : "") +
      "Error: " + msg + "\n\n" +
      "Suggested Fix:\n" + fix + "\n\n" +
      "Stack:\n" + stack + "\n";

    MailApp.sendEmail(to, subject, body);
  } catch (e) {
    Logger.log("safeEmailError_ failed: " + errToString_(e));
  }
}

// -------------------------
// SUGGESTED FIX ENGINE
// -------------------------

function suggestFix_(msg, stack) {
  var hints = [];
  var m = (msg || "").toLowerCase();

  if (m.indexOf("not found") !== -1 || m.indexOf("is not a function") !== -1) {
    hints.push("Confirm the base function exists in Code.gs and the name matches exactly.");
  }
  if (m.indexOf("permission") !== -1 || m.indexOf("authorization") !== -1) {
    hints.push("Re-run the function from Apps Script editor and approve requested permissions.");
  }
  if (m.indexOf("timeout") !== -1 || m.indexOf("exceeded maximum execution") !== -1) {
    hints.push("The function timed out. Try processing fewer clients or reduce data volume.");
  }
  if (m.indexOf("ledger entry id") !== -1) {
    hints.push("Ledger Entry IDs may be missing. Run Generate Storage Charges first, then re-generate the Unbilled Report.");
  }
  if (m.indexOf("no rows") !== -1 || m.indexOf("no unbilled") !== -1) {
    hints.push("No billable rows found. Verify client Billing_Ledger sheets have Unbilled entries.");
  }
  if (m.indexOf("sheet") !== -1 && m.indexOf("not found") !== -1) {
    hints.push("A required sheet is missing. Run Setup from the Stride Billing menu.");
  }
  if (m.indexOf("quota") !== -1) {
    hints.push("Daily quota exceeded. Wait 24 hours or reduce batch size.");
  }
  if (m.indexOf("duplicate") !== -1) {
    hints.push("Duplicate entry detected. Verify source data for duplicate rows.");
  }

  return hints.length
    ? hints.join("\n")
    : "No automatic suggestion. Review the error details and stack trace.";
}

// -------------------------
// UTILITIES
// -------------------------

function assertFnExists_(fnName) {
  if (typeof this[fnName] !== "function") {
    throw new Error("Required base function not found: " + fnName);
  }
}

function errToString_(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err.message) return String(err.message);
  return String(err);
}