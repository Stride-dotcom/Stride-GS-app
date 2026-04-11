/***************************************************************
CB13_UNBILLED_REPORT.gs
v1.3.3 — Fix: .id property (was .spreadsheetId), getActiveClients_v2_(), MM/DD/YY
***************************************************************/

function CB13_generateUnbilledReport() {
var ui = SpreadsheetApp.getUi();

// v1.4.2: Use ui.prompt instead of Browser.inputBox — allows Enter key to submit
var endDateResp = ui.prompt(
  "Generate Unbilled Report",
  "Enter End Date (MM/DD/YY):",
  ui.ButtonSet.OK_CANCEL
);
if (endDateResp.getSelectedButton() !== ui.Button.OK) return;
var endDateInput = endDateResp.getResponseText();

// Inline parse MM/DD/YY (2-digit year)
var endDate = (function(s) {
  if (!s) return null;
  var m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  var mm = parseInt(m[1], 10), dd = parseInt(m[2], 10), yy = parseInt(m[3], 10);
  var yyyy = yy < 50 ? 2000 + yy : 1900 + yy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  var d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null;
  return d;
})(endDateInput);

if (!endDate) {
ui.alert("Invalid date. Please use MM/DD/YY (example: 03/02/26).");
return;
}
endDate.setHours(23, 59, 59, 999);

var ss = SpreadsheetApp.getActiveSpreadsheet();

// v1.4.2: Clear data rows only (row 2+), preserve header row and all formatting
var reportSheet = ss.getSheetByName(CB13.SHEETS.UNBILLED) || ss.insertSheet(CB13.SHEETS.UNBILLED);
if (reportSheet.getLastRow() > 1) {
  reportSheet.getRange(2, 1, reportSheet.getLastRow() - 1, reportSheet.getLastColumn()).clearContent();
}

// v1.3.2 — Use getActiveClients_v2_() instead of manual Clients tab read
var clients = getActiveClients_v2_();
if (!clients || clients.length === 0) return ui.alert("No active clients found.");

// === CONFIG (if your cache sheet name differs, change here) ===
var PRICE_CACHE_TAB = "Price_Cache";

// v1.4.2: Use existing headers if present (preserves formatting), otherwise build from Consolidated_Ledger
var outHeaders = null;
var sheetHasHeaders = (reportSheet.getLastRow() >= 1 && reportSheet.getLastColumn() >= 1);

if (sheetHasHeaders) {
  // Use whatever headers are already on the sheet — preserves user's column order and formatting
  var existingH = reportSheet.getRange(1, 1, 1, reportSheet.getLastColumn()).getValues()[0];
  outHeaders = existingH.map(function(h) { return String(h || "").trim(); }).filter(Boolean);
  if (outHeaders.length < 3) outHeaders = null; // too few headers, rebuild
}

if (!outHeaders) {
  // Build headers dynamically from Consolidated_Ledger
  var CB_ONLY_COLS = { "CLIENT SHEET ID": true, "SOURCE ROW": true, "EMAIL STATUS": true,
    "DATE ADDED": true, "INVOICE URL": true, "INVOICE #": true };
  outHeaders = ["Status","Client","Sidemark","Date","Svc Code","Svc Name",
    "Item ID","Description","Class","Qty","Rate","Total","Item Notes","Ledger Row ID","Source Sheet ID"];
  try {
    var consolSheet = ss.getSheetByName("Consolidated_Ledger");
    if (consolSheet && consolSheet.getLastColumn() >= 1) {
      var clHeaders = consolSheet.getRange(1, 1, 1, consolSheet.getLastColumn()).getValues()[0];
      var dynamicHeaders = [];
      for (var ch = 0; ch < clHeaders.length; ch++) {
        var hdr = String(clHeaders[ch] || "").trim();
        if (hdr && !CB_ONLY_COLS[hdr.toUpperCase()]) dynamicHeaders.push(hdr);
      }
      var dynSet = {};
      dynamicHeaders.forEach(function(d) { dynSet[d.toUpperCase()] = true; });
      if (!dynSet["SIDEMARK"]) dynamicHeaders.splice(2, 0, "Sidemark");
      if (!dynSet["SOURCE SHEET ID"]) dynamicHeaders.push("Source Sheet ID");
      if (dynamicHeaders.length >= 5) outHeaders = dynamicHeaders;
    }
  } catch(e) { Logger.log("[UnbilledReport] Could not read Consolidated_Ledger headers: " + e); }
  reportSheet.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]).setFontWeight("bold");
}

var outRows = [];

var stats = {
clientsRows: clients.length,
opened: 0,
skippedNoId: 0,
skippedOpenFail: 0,
skippedNoLedger: 0,
skippedMissingCols: 0,
scanned: 0,
matched: 0,
svcNameFilledFromCache: 0
};

for (var i = 0; i < clients.length; i++) {
var clientSheetId = clients[i].id;
if (!clientSheetId) { stats.skippedNoId++; continue; }

var clientSS;
try {
clientSS = SpreadsheetApp.openById(String(clientSheetId).trim());
stats.opened++;
} catch (errOpen) {
console.log("CB13: open client failed row " + i + ": " + errOpen);
stats.skippedOpenFail++;
continue;
}

// Optional: SAFE migration only (ideally add-only)
try {
if (typeof CB13_migrateClientSheet_ === "function") CB13_migrateClientSheet_(clientSS);
} catch (errMig) {
console.log("CB13: migration warning: " + errMig);
}

var ledger = clientSS.getSheetByName(CB13.LEDGER_TAB);
if (!ledger) { stats.skippedNoLedger++; continue; }

var data = ledger.getDataRange().getValues();
if (!data || data.length < 2) continue;

var headers = data[0].map(String);
var h = CB13_indexHeadersNormalized_(headers);

// Dual-schema picks
var idxStatus = CB13_pickHeader_(h, ["Billing Status", "Status"]);
var idxSvcDt = CB13_pickHeader_(h, ["Service Date", "Date"]);
var idxSvcCode= CB13_pickHeader_(h, ["Svc Code", "SVC code", "Service Code"]);
var idxSvcName= CB13_pickHeader_(h, ["Service Name", "Svc Name"]);
var idxTotal = CB13_pickHeader_(h, ["Total"]);
var idxClient = CB13_pickHeader_(h, ["Client"]);
var idxItemId = CB13_pickHeader_(h, ["Item ID"]);
var idxSidemark = CB13_pickHeader_(h, ["Sidemark"]);
var idxLedgerId = CB13_pickHeader_(h, ["Ledger Row ID", "Ledger Entry ID"]);
    var idxQty      = CB13_pickHeader_(h, ["Qty", "Quantity"]);
    var idxRate     = CB13_pickHeader_(h, ["Rate", "Price", "Unit Price"]);

if (idxStatus == null || idxSvcDt == null || idxSvcCode == null || idxTotal == null || idxClient == null) {
stats.skippedMissingCols++;
continue;
}

// Build service name lookup from price_cache once per client
var svcNameByCode = CB13_buildSvcNameMapFromPriceCache_(clientSS, PRICE_CACHE_TAB);

// Build ItemID -> Sidemark lookup from Inventory (fallback when Billing_Ledger has no Sidemark col)
var sidemarkByItemId = {};
    // Always build inventory map (sidemark col may exist but be empty)
  try {
    var invSheet = clientSS.getSheetByName("Inventory");
    if (invSheet && invSheet.getLastRow() > 1) {
      var invData = invSheet.getDataRange().getValues();
      var invH = CB13_indexHeadersNormalized_(invData[0].map(String));
      var invIdxSm = CB13_pickHeader_(invH, ["Sidemark"]);
      var invIdxIt = CB13_pickHeader_(invH, ["Item ID"]);
      if (invIdxSm != null && invIdxIt != null) {
        for (var ir = 1; ir < invData.length; ir++) {
          var iid = String(invData[ir][invIdxIt] || "").trim();
          if (iid) sidemarkByItemId[iid] = String(invData[ir][invIdxSm] || "").trim();
        }
      }
    }
  } catch (eSm) {
    console.log("CB13: Inventory sidemark lookup failed: " + eSm);
  }


for (var r = 1; r < data.length; r++) {
stats.scanned++;
var row = data[r];

var statusRaw = row[idxStatus];
var status = String(statusRaw == null ? "" : statusRaw).trim().toLowerCase();
// Parity: blank status counts as Unbilled
if (status && status !== "unbilled") continue;

var svcDate = CB13_coerceDate_(row[idxSvcDt]);
if (!svcDate) continue;
if (svcDate.getTime() > endDate.getTime()) continue;

var svcCode = row[idxSvcCode];
var svcName = (idxSvcName != null) ? row[idxSvcName] : "";

if (!svcName && svcCode && svcNameByCode) {
var k = String(svcCode).trim();
if (svcNameByCode[k]) {
svcName = svcNameByCode[k];
stats.svcNameFilledFromCache++;
}
}

// v1.4.1: Build output row dynamically by matching outHeaders to client ledger headers by name
var itemId = idxItemId != null ? String(row[idxItemId] || "").trim() : "";
var sidemark = (idxSidemark != null && String(row[idxSidemark] || "").trim())
  ? String(row[idxSidemark]).trim()
  : (sidemarkByItemId[itemId] || "");
var idxDesc = CB13_pickHeader_(h, ["Description"]);
var idxClass = CB13_pickHeader_(h, ["Class"]);
var idxNotes = CB13_pickHeader_(h, ["Item Notes", "Notes"]);
var idxTaskId = CB13_pickHeader_(h, ["Task ID"]);
var idxRepairId = CB13_pickHeader_(h, ["Repair ID"]);
var idxShipNo = CB13_pickHeader_(h, ["Shipment #", "Shipment"]);
var idxCategory = CB13_pickHeader_(h, ["Category"]);
var idxInvoice = CB13_pickHeader_(h, ["Invoice #", "Invoice"]);

// Map header names to values for this row
var valueMap = {
  "STATUS": "Unbilled",
  "CLIENT": row[idxClient] || "",
  "SIDEMARK": sidemark,
  "DATE": CB13_fmtMMDDYYYY_(svcDate),
  "SVC CODE": svcCode || "",
  "SVC NAME": svcName || "",
  "ITEM ID": itemId,
  "DESCRIPTION": idxDesc != null ? String(row[idxDesc] || "") : "",
  "CLASS": idxClass != null ? String(row[idxClass] || "") : "",
  "QTY": idxQty != null ? row[idxQty] : "",
  "RATE": idxRate != null ? row[idxRate] : "",
  "TOTAL": row[idxTotal],
  "ITEM NOTES": idxNotes != null ? String(row[idxNotes] || "") : "",
  "LEDGER ROW ID": idxLedgerId != null ? row[idxLedgerId] : "",
  "SOURCE SHEET ID": String(clientSheetId).trim(),
  "TASK ID": idxTaskId != null ? String(row[idxTaskId] || "") : "",
  "REPAIR ID": idxRepairId != null ? String(row[idxRepairId] || "") : "",
  "SHIPMENT #": idxShipNo != null ? String(row[idxShipNo] || "") : "",
  "CATEGORY": idxCategory != null ? String(row[idxCategory] || "") : "",
  "INVOICE #": idxInvoice != null ? String(row[idxInvoice] || "") : ""
};

// Build row in outHeaders order
var outRow = [];
for (var oi = 0; oi < outHeaders.length; oi++) {
  var key = String(outHeaders[oi]).trim().toUpperCase();
  outRow.push(valueMap[key] !== undefined ? valueMap[key] : "");
}
outRows.push(outRow);

stats.matched++;
}
}

if (outRows.length) {
    reportSheet.getRange(2, 1, outRows.length, outHeaders.length).setValues(outRows);
  }

ui.alert(
"CB13 Unbilled Report complete\n\n" +
"End Date: " + CB13_fmtMMDDYYYY_(endDate) + "\n" +
"Opened client sheets: " + stats.opened + "\n" +
"Scanned ledger rows: " + stats.scanned + "\n" +
"Matched unbilled: " + stats.matched + "\n" +
"Service names filled from cache: " + stats.svcNameFilledFromCache + "\n" +
"Skipped (no Sheet ID): " + stats.skippedNoId + "\n" +
"Skipped (open failed): " + stats.skippedOpenFail + "\n" +
"Skipped (no Billing_Ledger): " + stats.skippedNoLedger + "\n" +
"Skipped (missing required columns): " + stats.skippedMissingCols
);

// Apply Billing Status dropdown validation (Unbilled/Invoiced/Void)
CB13_addBillingStatusValidation();
}

function CB13_buildSvcNameMapFromPriceCache_(clientSS, tabName) {
try {
var sh = clientSS.getSheetByName(tabName);
if (!sh) return null;

var v = sh.getDataRange().getValues();
if (!v || v.length < 2) return null;

var headers = v[0].map(String);
var h = CB13_indexHeadersNormalized_(headers);

var idxCode = CB13_pickHeader_(h, ["Service Code", "Svc Code", "SVC code"]);
var idxName = CB13_pickHeader_(h, ["Service Name", "Svc Name"]);

if (idxCode == null || idxName == null) return null;

var map = {};
for (var i = 1; i < v.length; i++) {
var code = v[i][idxCode];
var name = v[i][idxName];
if (!code) continue;
map[String(code).trim()] = String(name || "").trim();
}
return map;
} catch (e) {
console.log("CB13: price_cache read failed: " + e);
return null;
}
}

/** Picks the first existing header index from candidates (normalized). */
function CB13_pickHeader_(hNormMap, candidates) {
for (var i = 0; i < candidates.length; i++) {
var key = CB13_norm_(candidates[i]);
if (hNormMap[key] != null) return hNormMap[key];
}
return null;
}

function CB13_norm_(s) {
return String(s == null ? "" : s).trim().toLowerCase();
}

function CB13_indexHeadersNormalized_(headers) {
var map = {};
for (var i = 0; i < headers.length; i++) map[CB13_norm_(headers[i])] = i;
return map;
}

function CB13_parseMMDDYYYY_(s) {
if (!s) return null;
var m = String(s).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
if (!m) return null;
var mm = parseInt(m[1], 10), dd = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
var d = new Date(yyyy, mm - 1, dd);
if (d.getFullYear() !== yyyy || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null;
return d;
}

function CB13_coerceDate_(v) {
if (!v) return null;
if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) return v;

var s = String(v).trim();
var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
if (m) {
var mm = parseInt(m[1], 10), dd = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
var d2 = new Date(yyyy, mm - 1, dd);
if (!isNaN(d2.getTime())) return d2;
}

var d3 = new Date(s);
if (!isNaN(d3.getTime())) return d3;
return null;
}

function CB13_fmtMMDDYYYY_(d) {
if (!d || isNaN(d.getTime())) return "";
return Utilities.formatDate(d, Session.getScriptTimeZone(), "MM-dd-yyyy");
}

/**
 * v2.6.4 DIAGNOSTIC: Dumps detailed info about what the unbilled report
 * sees in each client's Billing_Ledger so we can find why rows are skipped.
 * Writes output to a "Unbilled_Diagnostic" sheet.
 */
function CB13_diagnoseUnbilledReport() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var clients = getActiveClients_v2_();
  if (!clients || clients.length === 0) { ui.alert("No active clients found."); return; }

  var diagSheet = ss.getSheetByName("Unbilled_Diagnostic");
  if (!diagSheet) diagSheet = ss.insertSheet("Unbilled_Diagnostic");
  diagSheet.clearContents();

  var diagHeaders = ["Client", "Row#", "Col Count", "Headers", "Status Raw", "Status Parsed",
    "Date Raw", "Date Type", "Date Parsed", "Svc Code", "Total",
    "Skip Reason", "idxStatus", "idxDate", "idxSvcCode", "idxTotal", "idxClient"];
  diagSheet.getRange(1, 1, 1, diagHeaders.length).setValues([diagHeaders]).setFontWeight("bold");

  var diagRows = [];

  for (var i = 0; i < clients.length; i++) {
    var clientName = clients[i].name;
    var clientSheetId = clients[i].id;

    var clientSS;
    try {
      clientSS = SpreadsheetApp.openById(String(clientSheetId).trim());
    } catch (e) {
      diagRows.push([clientName, "-", "-", "-", "-", "-", "-", "-", "-", "-", "-",
        "OPEN FAILED: " + e.message, "-", "-", "-", "-", "-"]);
      continue;
    }

    var ledger = clientSS.getSheetByName(CB13.LEDGER_TAB);
    if (!ledger) {
      diagRows.push([clientName, "-", "-", "-", "-", "-", "-", "-", "-", "-", "-",
        "NO Billing_Ledger TAB", "-", "-", "-", "-", "-"]);
      continue;
    }

    var data = ledger.getDataRange().getValues();
    if (!data || data.length < 2) {
      diagRows.push([clientName, "-", data ? data.length : 0, "-", "-", "-", "-", "-", "-", "-", "-",
        "NO DATA ROWS", "-", "-", "-", "-", "-"]);
      continue;
    }

    var headers = data[0].map(String);
    var h = CB13_indexHeadersNormalized_(headers);

    var idxStatus = CB13_pickHeader_(h, ["Billing Status", "Status"]);
    var idxSvcDt = CB13_pickHeader_(h, ["Service Date", "Date"]);
    var idxSvcCode = CB13_pickHeader_(h, ["Svc Code", "SVC code", "Service Code"]);
    var idxTotal = CB13_pickHeader_(h, ["Total"]);
    var idxClient = CB13_pickHeader_(h, ["Client"]);

    // Log header info
    diagRows.push([clientName, "HDR", headers.length, headers.join(" | "), "-", "-",
      "-", "-", "-", "-", "-",
      (idxStatus == null || idxSvcDt == null || idxSvcCode == null || idxTotal == null || idxClient == null)
        ? "MISSING REQUIRED COLS" : "Headers OK",
      idxStatus, idxSvcDt, idxSvcCode, idxTotal, idxClient]);

    if (idxStatus == null || idxSvcDt == null || idxSvcCode == null || idxTotal == null || idxClient == null) {
      continue;
    }

    // Log first 50 data rows
    var rowLimit = Math.min(data.length, 51);
    for (var r = 1; r < rowLimit; r++) {
      var row = data[r];
      var statusRaw = row[idxStatus];
      var statusParsed = String(statusRaw == null ? "" : statusRaw).trim().toLowerCase();
      var dateRaw = row[idxSvcDt];
      var dateType = Object.prototype.toString.call(dateRaw);
      var dateParsed = CB13_coerceDate_(dateRaw);
      var svcCode = idxSvcCode != null ? row[idxSvcCode] : "";
      var total = idxTotal != null ? row[idxTotal] : "";

      var skipReason = "OK";
      if (statusParsed && statusParsed !== "unbilled") {
        skipReason = "STATUS=" + statusParsed;
      } else if (!dateParsed) {
        skipReason = "DATE_NULL (raw=" + String(dateRaw) + ")";
      }

      diagRows.push([
        clientName, r + 1, row.length,
        "-",
        String(statusRaw), statusParsed,
        String(dateRaw), dateType,
        dateParsed ? CB13_fmtMMDDYYYY_(dateParsed) : "NULL",
        String(svcCode), String(total),
        skipReason,
        idxStatus, idxSvcDt, idxSvcCode, idxTotal, idxClient
      ]);
    }
  }

  if (diagRows.length) {
    diagSheet.getRange(2, 1, diagRows.length, diagHeaders.length).setValues(diagRows);
  }
  ui.alert("Diagnostic complete — check Unbilled_Diagnostic sheet.\n" +
    clients.length + " client(s), " + diagRows.length + " row(s) logged.");
}