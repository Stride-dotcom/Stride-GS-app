/***************************************************************
CB13_PREVIEW_CORE.gs
Phase 2 Preview Core (Self-contained)
- Builds invoice preview groups from selected rows in Unbilled_Report
- Saves to ScriptProperties under CB13_PREVIEW_DATA
- Opens modal CB13_UI
- Provides CB13_getPreviewData() for HTML
***************************************************************/

/**
* Grouping rule:
* - 1 invoice per Client
* - If client Settings has "Separate invoices per sidemark" TRUE,
* then 1 invoice per Client+Sidemark (sidemark can be blank)
* - Preserves selected row order within each invoice
* - Preserves invoice order by first appearance in selected rows
*/
function CB13_groupInvoicesFromSelected_(headers, selectedRows) {
var h = CB13_indexHeadersNorm_(headers);

var idxClient = CB13_pickHeaderIdx_(h, ["Client"]);
var idxSidemark = CB13_pickHeaderIdx_(h, ["Sidemark"]);
var idxSourceId = CB13_pickHeaderIdx_(h, ["Source Sheet ID", "Client Sheet ID"]);

if (idxClient == null) throw new Error("Missing Client column in Unbilled_Report.");

// cache setting per client sheet id
var separateCache = {};

// keep insertion order
var groupsByKey = {};
var groupOrder = [];

for (var i = 0; i < selectedRows.length; i++) {
var row = selectedRows[i];
var client = row[idxClient];
var sidemark = idxSidemark != null ? row[idxSidemark] : "";

var sourceSheetId = idxSourceId != null ? row[idxSourceId] : "";
var separate = false;

if (sourceSheetId) {
if (separateCache[sourceSheetId] == null) {
separateCache[sourceSheetId] = CB13_readSeparateBySidemarkSetting_(sourceSheetId);
}
separate = separateCache[sourceSheetId];
}

// v1.4.4 — Normalize sidemark for grouping so "Smith", "smith", and
// " Smith " collapse into one invoice. Without this, a single typo
// in casing/whitespace fragments the client's invoices. The first
// original spelling encountered for a given normalized key is what
// appears on the invoice (preserves the operator's preferred casing).
var normSidemark = CB13_normalizeSidemark_(sidemark);
var key = separate ? (String(client) + "||" + normSidemark) : String(client);

if (!groupsByKey[key]) {
groupsByKey[key] = {
client: client,
sidemark: separate ? (sidemark || "") : null,
rows: []
};
groupOrder.push(key);
}

groupsByKey[key].rows.push(row);
}

return groupOrder.map(function(k) { return groupsByKey[k]; });
}

/**
 * v1.4.4: Normalize a sidemark for grouping. Lowercase + trim + collapse
 * internal whitespace so "Smith", "smith", " Smith ", and "Smith  " all
 * map to the same key. Display value on the invoice keeps the original
 * spelling of the first-seen row.
 */
function CB13_normalizeSidemark_(s) {
  if (s == null) return "";
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * v1.4.3: Reads SEPARATE_BY_SIDEMARK setting.
 * Checks the Consolidated Billing Clients tab FIRST (source of truth),
 * then falls back to client sheet Settings tab.
 */
function CB13_readSeparateBySidemarkSetting_(clientSheetId) {
  // Primary: check Consolidated Billing Clients tab (source of truth)
  try {
    var cbSs = SpreadsheetApp.getActive();
    var clientsSh = cbSs.getSheetByName("Clients");
    if (clientsSh && clientsSh.getLastRow() >= 2) {
      var cData = clientsSh.getDataRange().getValues();
      var cMap = {};
      for (var h = 0; h < cData[0].length; h++) {
        var hk = String(cData[0][h] || "").trim().toUpperCase();
        if (hk) cMap[hk] = h;
      }
      var idxSsId = cMap["CLIENT SPREADSHEET ID"];
      var idxSep = cMap["SEPARATE BY SIDEMARK"];
      if (idxSsId !== undefined && idxSep !== undefined) {
        for (var r = 1; r < cData.length; r++) {
          if (String(cData[r][idxSsId] || "").trim() === String(clientSheetId).trim()) {
            var val = cData[r][idxSep];
            return val === true || String(val || "").trim().toUpperCase() === "TRUE";
          }
        }
      }
    }
  } catch (e) {
    Logger.log("[SeparateBySidemark] Clients tab lookup failed: " + e);
  }

  // Fallback: check client sheet Settings tab
  try {
    var css = SpreadsheetApp.openById(String(clientSheetId).trim());
    var sh = css.getSheetByName("Settings");
    if (sh) {
      var v = sh.getDataRange().getValues();
      for (var i = 0; i < v.length; i++) {
        var key = String(v[i][0] || "").trim();
        if (key === "Separate invoices per sidemark" || key === "SEPARATE_BY_SIDEMARK") {
          return String(v[i][1] || "").trim().toUpperCase() === "TRUE";
        }
      }
    }
  } catch (e2) {
    Logger.log("[SeparateBySidemark] Client Settings fallback failed: " + e2);
  }

  return false;
}

/** Modal launcher (required) */

/** Helpers */
function CB13_norm_(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
function CB13_indexHeadersNorm_(headers) {
var m = {};
headers.forEach(function(h, i) { m[CB13_norm_(h)] = i; });
return m;
}
function CB13_pickHeaderIdx_(hMap, names) {
for (var i = 0; i < names.length; i++) {
var k = CB13_norm_(names[i]);
if (hMap[k] != null) return hMap[k];
}
return null;
}

/**
 * CB13_createAndSendInvoices
 * One-click: reads selected rows from Unbilled_Report,
 * groups by client (+sidemark if enabled), creates invoices,
 * generates PDFs, and emails them to clients.
 */
function CB13_createAndSendInvoices() {
  var ui = safeUi_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Unbilled_Report");
  if (!sh) { ui.alert("Unbilled_Report not found."); return; }

  // v1.4.0: Use getActiveRangeList() to support non-contiguous selections (Ctrl+click)
  var rangeList = sh.getActiveRangeList();
  if (!rangeList) {
    ui.alert("Highlight the rows you want to invoice on Unbilled_Report, then run this again.");
    return;
  }
  var ranges = rangeList.getRanges();
  if (!ranges || !ranges.length || ranges[0].getRow() < 2) {
    ui.alert("Highlight the rows you want to invoice on Unbilled_Report, then run this again.");
    return;
  }

  var data = sh.getDataRange().getValues();
  if (data.length < 2) { ui.alert("No rows in Unbilled_Report."); return; }

  var headers = data[0].map(String);

  // Collect highlighted rows from all selected ranges
  var selected = [];
  var seenRows = {};
  for (var ri = 0; ri < ranges.length; ri++) {
    var startRow = ranges[ri].getRow();
    var numRows = ranges[ri].getNumRows();
    for (var si = startRow; si < startRow + numRows; si++) {
      if (si < 2 || si > data.length || seenRows[si]) continue;
      seenRows[si] = true;
      selected.push(data[si - 1]);
    }
  }
  if (!selected.length) { ui.alert("No data rows highlighted."); return; }

  // Skip already-invoiced rows — accept both "Status" and legacy "Billing Status"
  var statusIdx = headers.indexOf("Status");
  if (statusIdx === -1) statusIdx = headers.indexOf("Billing Status");
  if (statusIdx === -1) statusIdx = 0;
  var filtered = [];
  var skipped = 0;
  selected.forEach(function(r) {
    var st = String(r[statusIdx] || "").trim().toUpperCase();
    if (st === "INVOICED") { skipped++; } else { filtered.push(r); }
  });
  if (skipped > 0) {
    ss.toast("Skipped " + skipped + " already-invoiced row(s).", "Info", 5);
  }
  if (!filtered.length) { ui.alert("All highlighted rows are already invoiced."); return; }

  var grouped = CB13_groupInvoicesFromSelected_(headers, filtered);

  // Attach headers to each group for downstream processing
  for (var g = 0; g < grouped.length; g++) {
    grouped[g].headers = headers;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another invoice run is in progress. Try again in a minute.");
    return;
  }

  var invoicesCreated = 0;
  var emailsSent = 0;
  var errors = [];

  try {
    ss.toast("Starting invoice creation for " + grouped.length + " invoice(s)...", "Invoicing", 5);

    for (var i = 0; i < grouped.length; i++) {
      var invoice = grouped[i];
      var label = (invoice.client || "Unknown") + (invoice.sidemark ? " - " + invoice.sidemark : "");

      try {
        ss.toast("Processing " + (i + 1) + " of " + grouped.length + ": " + label, "Invoicing", 10);
        var result = CB13_commitInvoice(invoice);
        invoicesCreated++;
        if (result && result.emailStatus === "Sent") emailsSent++;
      } catch (invErr) {
        errors.push(label + ": " + (invErr.message || invErr));
        Logger.log("Invoice failed for " + label + ": " + invErr + "\n" + (invErr.stack || ""));
      }
    }

    var summary = "Invoice run complete.\n" +
      "Invoices created: " + invoicesCreated + "\n" +
      "Emails sent: " + emailsSent;
    if (errors.length) {
      summary += "\n\nErrors (" + errors.length + "):\n" + errors.join("\n");
    }
    ui.alert(summary);

  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * CB13_resendInvoiceEmail
 * Re-send invoice email for a previously-created invoice
 */
function CB13_resendInvoiceEmail() {
  var ui = safeUi_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consolSh = ss.getSheetByName("Consolidated_Ledger");
  if (!consolSh) { ui.alert("Consolidated_Ledger not found."); return; }

  var activeCell = consolSh.getActiveCell();
  if (!activeCell) { ui.alert("Select a cell in the Invoice # column first."); return; }

  var data = consolSh.getDataRange().getValues();
  var headers = data[0].map(String);
  var hMap = {};
  headers.forEach(function(h, i) { hMap[String(h).trim()] = i; });

  var invNoCol = hMap["Invoice #"];
  var invUrlCol = hMap["Invoice URL"];
  var clientSheetIdCol = hMap["Client Sheet ID"];
  var emailStatusCol = hMap["Email Status"];

  if (invNoCol === undefined) { ui.alert("Invoice # column not found."); return; }

  // Read invoice # from the active row
  var activeRow = activeCell.getRow();
  if (activeRow < 2) { ui.alert("Select a data row, not the header."); return; }

  var invNo = String(data[activeRow - 1][invNoCol] || "").trim();
  if (!invNo) { ui.alert("No Invoice # found in the selected row."); return; }

  // Find all rows with this invoice # to get client sheet ID and PDF URL
  var clientSheetId = "";
  var invoiceUrl = "";
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][invNoCol] || "").trim() === invNo) {
      if (!clientSheetId && clientSheetIdCol !== undefined) clientSheetId = String(data[i][clientSheetIdCol] || "").trim();
      if (!invoiceUrl && invUrlCol !== undefined) {
        // Try RichTextValue first (URL is stored as hyperlink, display text is "View Invoice")
        try {
          var rt = consolSh.getRange(i + 1, invUrlCol + 1).getRichTextValue();
          if (rt) invoiceUrl = rt.getLinkUrl() || "";
        } catch (_) {}
        // Fallback to plain cell value
        if (!invoiceUrl) invoiceUrl = String(data[i][invUrlCol] || "").trim();
      }
      if (clientSheetId && invoiceUrl) break;
    }
  }

  if (!clientSheetId) { ui.alert("No Client Sheet ID found for Invoice " + invNo + "."); return; }
  if (!invoiceUrl) { ui.alert("No Invoice URL found for Invoice " + invNo + ". Was the invoice created?"); return; }

  try {
    // Extract file ID from URL and get PDF
    var fileIdMatch = invoiceUrl.match(/[-\w]{25,}/);
    if (!fileIdMatch) throw new Error("Could not parse file ID from Invoice URL.");
    var pdfFile = DriveApp.getFileById(fileIdMatch[0]);

    emailInvoiceToClient_(clientSheetId, invNo, pdfFile);

    // Update Email Status for all rows of this invoice
    if (emailStatusCol !== undefined) {
      for (var j = 1; j < data.length; j++) {
        if (String(data[j][invNoCol] || "").trim() === invNo) {
          consolSh.getRange(j + 1, emailStatusCol + 1).setValue("Re-sent");
        }
      }
    }

    ui.alert("Email re-sent for Invoice " + invNo + ".");
  } catch (e) {
    ui.alert("Failed to re-send email: " + e.message);
    Logger.log("CB13_resendInvoiceEmail error: " + e + "\n" + (e.stack || ""));
  }
}