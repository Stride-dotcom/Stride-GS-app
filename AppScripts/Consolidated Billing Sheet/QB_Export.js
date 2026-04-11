/***************************************************************
 * QB_Export.gs — Stride Consolidated Billing
 * v1.2.1 — QuickBooks Desktop IIF Export
 *
 * Changelog v1.2.0:
 * - ADD: Client discounts applied to line item totals before IIF export.
 *   STOR lines use DISCOUNT_STORAGE_PCT, all other lines use DISCOUNT_SERVICES_PCT.
 *   Discounted amounts are written to both IIF and Consolidated_Ledger.
 *
 * Changelog v1.1.0:
 * - FIX: IIF escape now handles double quotes (BUG 6)
 * - ADD: QB Item Name support in QB_Service_Mapping and IIF INVITEM field (BUG 9)
 * - ADD: CB13_qbExportFromUnbilledSelection — export IIF directly from
 *   checked rows on Unbilled_Report (no staging sheet needed)
 *
 * Changelog v1.0.2:
 * - ADD: QB Customer Name support — reads "QB Customer Name" column
 *   from Clients tab. If filled, used as NAME in IIF instead of
 *   Stride client name. Falls back to Stride client name if blank.
 ***************************************************************/

/* ============================================================
   CONSTANTS
   ============================================================ */
var QB_SH = {
  INVOICE_EXPORT:  "QB_Invoice_Export",
  SERVICE_MAPPING: "QB_Service_Mapping"
};

var QB_EXPORT_HEADERS = [
  "Invoice #", "Client", "Payment Terms", "Invoice Date", "Due Date",
  "Svc Code", "Svc Name", "Item ID", "Memo",
  "Qty", "Rate", "Total",
  "QB Income Account", "QB Customer Name", "QB Item Name", "Sidemark", "Ledger Row ID", "Export Status", "Exported At"
];

var QB_MAPPING_HEADERS = [
  "Svc Code", "Svc Name", "QB Income Account", "QB Item Name", "Default Payment Terms"
];

/**
 * Clients tab configuration (row numbers)
 * Row 4: Headers (CLIENT NAME, PAYMENT TERMS, QB CUSTOMER NAME, etc.)
 * Row 2+: Data rows (v1.4.0: config rows moved to Settings tab)
 */
var CLIENTS_HEADER_ROW = 1;
var CLIENTS_DATA_START_ROW = 2;

/* ============================================================
   SETUP
   ============================================================ */

/* ============================================================
   STEP 1 — BUILD STAGING SHEET
   ============================================================ */
function CB13_qbExport_buildStagingSheet() {
  var ss   = SpreadsheetApp.getActive();
  var ui   = safeUi_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another QB export run is in progress. Please try again.");
    return;
  }
  try {
    var consolSh = ss.getSheetByName(CB_SH.CONSOL_LEDGER);
    if (!consolSh) { ui.alert("Consolidated_Ledger sheet not found. Run Setup."); return; }
    var consolLR = consolSh.getLastRow();
    if (consolLR < 2) { ui.alert("No data in Consolidated_Ledger."); return; }

    var consolVals = consolSh.getRange(1, 1, consolLR, consolSh.getLastColumn()).getValues();
    var consolHdr  = headerMapFromRow_(consolVals[0]);

    var cStatus    = consolHdr["STATUS"];
    var cInvNo     = consolHdr["INVOICE #"];
    var cClient    = consolHdr["CLIENT"];
    var cLedgerRow = consolHdr["LEDGER ROW ID"];
    var cDate      = consolHdr["DATE"];
    var cSvcCode   = consolHdr["SVC CODE"];
    var cSvcName   = consolHdr["SVC NAME"];
    var cItemId    = consolHdr["ITEM ID"];
    var cDesc      = consolHdr["DESCRIPTION"];
    var cQty       = consolHdr["QTY"];
    var cRate      = consolHdr["RATE"];
    var cTotal     = consolHdr["TOTAL"];
    var cItemNotes = consolHdr["ITEM NOTES"];
    var cSidemark  = consolHdr["SIDEMARK"];

    if (cStatus === undefined || cInvNo === undefined || cClient === undefined ||
        cDate === undefined || cSvcCode === undefined || cTotal === undefined) {
      ui.alert("Consolidated_Ledger is missing required headers. Cannot proceed.");
      return;
    }

    // Load export sheet — build set of already-staged Ledger Row IDs
    var exportSh = ensureSheet_(ss, QB_SH.INVOICE_EXPORT);
    ensureHeaderRowExact_(exportSh, QB_EXPORT_HEADERS);
    var exportLastCol = exportSh.getLastColumn() || QB_EXPORT_HEADERS.length;
    var exportHdr = headerMapFromRow_(
      exportSh.getRange(1, 1, 1, exportLastCol).getValues()[0]
    );
    var exLedgerRowIdx = exportHdr["LEDGER ROW ID"];
    var existingLedgerRowIds = new Set();
    var exportLR = exportSh.getLastRow();
    if (exportLR >= 2 && exLedgerRowIdx !== undefined) {
      exportSh.getRange(2, exLedgerRowIdx + 1, exportLR - 1, 1)
        .getValues().flat()
        .forEach(function(v) {
          var id = String(v || "").trim();
          if (id) existingLedgerRowIds.add(id);
        });
    }

    var mapping       = CB13_qbExport_loadMapping_(ss);
    var clientInfoMap = CB13_qbExport_loadClientInfo_(ss); // returns terms + qbCustomerName

    var pendingRows = [];
    for (var i = 1; i < consolVals.length; i++) {
      var status = String(consolVals[i][cStatus] || "").trim().toUpperCase();
      if (status !== "INVOICED") continue;

      var ledgerRowId = (cLedgerRow !== undefined)
        ? String(consolVals[i][cLedgerRow] || "").trim() : "";
      if (ledgerRowId && existingLedgerRowIds.has(ledgerRowId)) continue;

      var invNo    = String(consolVals[i][cInvNo]   || "").trim();
      var client   = String(consolVals[i][cClient]  || "").trim();
      var dateVal  = consolVals[i][cDate];
      var svcCode  = String(consolVals[i][cSvcCode] || "").trim();
      var svcName  = (cSvcName  !== undefined) ? String(consolVals[i][cSvcName]  || "").trim() : svcCode;
      var itemId   = (cItemId   !== undefined) ? String(consolVals[i][cItemId]   || "").trim() : "";
      var desc     = (cDesc     !== undefined) ? String(consolVals[i][cDesc]     || "").trim() : "";
      var qty      = (cQty      !== undefined) ? CB13_qbExport_safeQty_(consolVals[i][cQty]) : 1;
      var rate     = (cRate     !== undefined) ? Number(consolVals[i][cRate] || 0) : 0;
      var total    = Number(consolVals[i][cTotal] || 0);
      var itemNotes = (cItemNotes !== undefined) ? String(consolVals[i][cItemNotes] || "").trim() : "";

      var sidemark = (cSidemark !== undefined) ? String(consolVals[i][cSidemark] || "").trim() : "";

      // Build memo for QB Description column: Service Name + Item ID (or storage date range if applicable)
      var memoParts = [];
      if (svcName) memoParts.push(svcName);
      if (itemId) memoParts.push(itemId);
      if (itemNotes) memoParts.push(itemNotes);
      var memo = memoParts.join(" - ");

      var clientInfo   = clientInfoMap[client.toUpperCase()] || {};
      var payTerms     = clientInfo.terms || "";
      var qbCustName   = clientInfo.qbCustomerName || ""; // blank = use Stride name

      // Auto-format QB customer name with sidemark for sub-customer matching in QuickBooks
      // Format: "QBCustomerName:Sidemark" (e.g., "Allison Lind Interiors (CC on file):Adler")
      if (sidemark) {
        var baseName = qbCustName || client;
        qbCustName = baseName + ":" + sidemark;
      }

      if (!payTerms && mapping[svcCode.toUpperCase()]) {
        payTerms = mapping[svcCode.toUpperCase()].defaultTerms || "";
      }

      var qbAccount = mapping[svcCode.toUpperCase()]
        ? (mapping[svcCode.toUpperCase()].qbAccount || "") : "";

      var qbItemName = mapping[svcCode.toUpperCase()]
        ? (mapping[svcCode.toUpperCase()].qbItemName || "") : "";

      var invDate = CB13_qbExport_fmtDate_(dateVal);
      var dueDate = CB13_qbExport_calcDueDate_(dateVal, payTerms);

      pendingRows.push([
        invNo, client, payTerms, invDate, dueDate,
        svcCode, svcName, itemId, memo,
        qty, rate, total,
        qbAccount, qbCustName, qbItemName, sidemark, ledgerRowId, "Pending", ""
      ]);

      if (ledgerRowId) existingLedgerRowIds.add(ledgerRowId);
    }

    if (!pendingRows.length) {
      ui.alert("No new Approved rows found in Consolidated_Ledger to stage.");
      return;
    }

    var insertStart = exportSh.getLastRow() + 1;
    exportSh.getRange(insertStart, 1, pendingRows.length, QB_EXPORT_HEADERS.length)
      .setValues(pendingRows);

    ss.toast(pendingRows.length + " row(s) staged to QB_Invoice_Export.", "QB Staging Complete", 5);
    ui.alert(
      "✅ " + pendingRows.length + " row(s) staged to QB_Invoice_Export.\n\n" +
      "Review the sheet and verify:\n" +
      "• QB Income Account column is filled for all rows\n" +
      "• QB Customer Name column is correct (blank = uses Stride client name)\n" +
      "• Payment Terms are correct per client\n\n" +
      "Then run 'Export to QuickBooks (IIF)' to generate the IIF file."
    );
  } catch (err) {
    ui.alert("QB Staging error: " + err.message);
    Logger.log("CB13_qbExport_buildStagingSheet error: " + err + "\n" + err.stack);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ============================================================
   STEP 2 — GENERATE IIF FILE
   ============================================================ */
function CB13_qbExport_generateIIF() {
  var ss   = SpreadsheetApp.getActive();
  var ui   = safeUi_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another QB export run is in progress. Please try again.");
    return;
  }
  try {
    var exportSh = ss.getSheetByName(QB_SH.INVOICE_EXPORT);
    if (!exportSh) { ui.alert("QB_Invoice_Export sheet not found. Run QB Export Setup first."); return; }
    var exportLR = exportSh.getLastRow();
    if (exportLR < 2) { ui.alert("No data in QB_Invoice_Export."); return; }

    var exportLastCol = exportSh.getLastColumn() || QB_EXPORT_HEADERS.length;
    var exportVals = exportSh.getRange(1, 1, exportLR, exportLastCol).getValues();
    var eHdr = headerMapFromRow_(exportVals[0]);

    var eInvNo      = eHdr["INVOICE #"];
    var eClient     = eHdr["CLIENT"];
    var eTerms      = eHdr["PAYMENT TERMS"];
    var eInvDate    = eHdr["INVOICE DATE"];
    var eDueDate    = eHdr["DUE DATE"];
    var eSvcName    = eHdr["SVC NAME"];
    var eMemo       = eHdr["MEMO"];
    var eQty        = eHdr["QTY"];
    var eRate       = eHdr["RATE"];
    var eTotal      = eHdr["TOTAL"];
    var eQbAcct     = eHdr["QB INCOME ACCOUNT"];
    var eQbCustName = eHdr["QB CUSTOMER NAME"];
    var eQbItemName = eHdr["QB ITEM NAME"];
    var eSidemark   = eHdr["SIDEMARK"];
    var eExStatus   = eHdr["EXPORT STATUS"];
    var eExportedAt = eHdr["EXPORTED AT"];

    if (eInvNo === undefined || eClient === undefined || eExStatus === undefined) {
      ui.alert("QB_Invoice_Export is missing required headers. Re-run QB Export Setup.");
      return;
    }

    var invoiceMap   = {};
    var invoiceOrder = [];
    var pendingRowNums = [];

    for (var i = 1; i < exportVals.length; i++) {
      var exStatus = String(exportVals[i][eExStatus] || "").trim().toUpperCase();
      if (exStatus !== "PENDING") continue;

      var invNo      = String(exportVals[i][eInvNo]   || "").trim();
      var client     = String(exportVals[i][eClient]  || "").trim();
      var terms      = (eTerms      !== undefined) ? String(exportVals[i][eTerms]      || "").trim() : "";
      var invDate    = (eInvDate    !== undefined) ? String(exportVals[i][eInvDate]    || "").trim() : "";
      var dueDate    = (eDueDate    !== undefined) ? String(exportVals[i][eDueDate]    || "").trim() : "";
      var svcName    = (eSvcName    !== undefined) ? String(exportVals[i][eSvcName]    || "").trim() : "";
      var memo       = (eMemo       !== undefined) ? String(exportVals[i][eMemo]       || "").trim() : "";
      var qty        = (eQty        !== undefined) ? CB13_qbExport_safeQty_(exportVals[i][eQty]) : 1;
      var rate       = (eRate       !== undefined) ? Number(exportVals[i][eRate]  || 0) : 0;
      var total      = Number(exportVals[i][eTotal] || 0);
      var qbAcct     = (eQbAcct     !== undefined) ? String(exportVals[i][eQbAcct]     || "").trim() : "";
      var qbCustName = (eQbCustName !== undefined) ? String(exportVals[i][eQbCustName] || "").trim() : "";
      var qbItemName = (eQbItemName !== undefined) ? String(exportVals[i][eQbItemName] || "").trim() : "";
      var sidemark   = (eSidemark   !== undefined) ? String(exportVals[i][eSidemark]   || "").trim() : "";

      // Use QB Customer Name if filled, otherwise fall back to Stride client name
      var qbName = qbCustName || client;

      if (!invNo || !client) continue;
      if (!qbAcct) {
        ui.alert(
          "Row " + (i + 1) + " (Invoice " + invNo + ") has no QB Income Account.\n" +
          "Fill QB_Service_Mapping or the QB Income Account column and try again."
        );
        return;
      }

      if (!invoiceMap[invNo]) {
        invoiceMap[invNo] = { qbName: qbName, terms: terms, invDate: invDate, dueDate: dueDate, lines: [] };
        invoiceOrder.push(invNo);
      }
      invoiceMap[invNo].lines.push({ svcName: svcName, memo: memo, qty: qty, rate: rate, total: total, qbAcct: qbAcct, qbItemName: qbItemName, sidemark: sidemark, svcDate: invDate });
      pendingRowNums.push(i + 1);
    }

    if (!invoiceOrder.length) {
      ui.alert("No Pending rows found in QB_Invoice_Export.");
      return;
    }

    // Build IIF
    var iifLines = [];
    iifLines.push("!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tTERMS\tDUEDATE\tCLEAR\tTOPRINT\tOTHER1");
    iifLines.push("!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tQNTY\tPRICE\tINVITEM\tCLEAR");
    iifLines.push("!ENDTRNS");

    for (var inv = 0; inv < invoiceOrder.length; inv++) {
      var invNo2  = invoiceOrder[inv];
      var invData = invoiceMap[invNo2];
      var invTotal = 0;
      for (var l = 0; l < invData.lines.length; l++) {
        invTotal += Number(invData.lines[l].total || 0);
      }

      // Use first line's sidemark for TRNS OTHER1 (invoice-level reference)
      var invSidemark = invData.lines.length ? (invData.lines[0].sidemark || "") : "";
      iifLines.push([
        "TRNS", "INVOICE",
        invData.invDate,
        "Accounts Receivable",
        CB13_qbExport_iifEsc_(invData.qbName),
        invTotal.toFixed(2),
        CB13_qbExport_iifEsc_(invNo2),
        "",
        CB13_qbExport_iifEsc_(invData.terms),
        invData.dueDate,
        "N", "Y",
        CB13_qbExport_iifEsc_(invSidemark)
      ].join("\t"));

      for (var li = 0; li < invData.lines.length; li++) {
        var line    = invData.lines[li];
        var lineAmt = (Number(line.total || 0) * -1).toFixed(2);
        iifLines.push([
          "SPL", "INVOICE",
          line.svcDate || invData.invDate,
          CB13_qbExport_iifEsc_(line.qbAcct),
          CB13_qbExport_iifEsc_(invData.qbName),
          lineAmt,
          CB13_qbExport_iifEsc_(invNo2),
          CB13_qbExport_iifEsc_(line.memo),
          line.qty,
          line.rate.toFixed(2),
          CB13_qbExport_iifEsc_(line.qbItemName),
          "N"
        ].join("\t"));
      }

      iifLines.push("ENDTRNS");
    }

    var iifContent = iifLines.join("\r\n");

    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
    var fileName  = "Stride_QB_Export_" + timestamp + ".iif";
    var file      = DriveApp.createFile(fileName, iifContent, MimeType.PLAIN_TEXT);
    var iifFolderId = getSetting_(SpreadsheetApp.getActive(), CB_SH.SETTINGS, CB_KEYS.IIF_EXPORT_FOLDER_ID);
    if (iifFolderId && String(iifFolderId).trim()) {
      try { DriveApp.getFolderById(String(iifFolderId).trim()).addFile(file); DriveApp.getRootFolder().removeFile(file); } catch(e) { Logger.log("IIF folder move failed: " + e); }
    }
    var fileUrl   = file.getUrl();

    // Batch-mark rows as Exported
    var exportedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss");
    if (eExStatus !== undefined && pendingRowNums.length) {
      pendingRowNums.sort(function(a, b) { return a - b; });
      batchWriteColumn_(exportSh, pendingRowNums, eExStatus + 1, "Exported");
      if (eExportedAt !== undefined) {
        batchWriteColumn_(exportSh, pendingRowNums, eExportedAt + 1, exportedAt);
      }
    }
    SpreadsheetApp.flush();

    ui.alert(
      "✅ IIF file generated!\n\n" +
      "Invoices exported: " + invoiceOrder.length + "\n" +
      "Line items: " + pendingRowNums.length + "\n\n" +
      "File saved to Google Drive: " + fileName + "\n\n" +
      "To import into QuickBooks Desktop:\n" +
      "1) Find and download the file from Google Drive\n" +
      "2) Ensure the file extension is .iif (not .txt)\n" +
      "3) In QB Desktop: File > Utilities > Import > IIF Files\n" +
      "4) Select the downloaded .iif file and click Open"
    );
    Logger.log("QB IIF export complete. File: " + fileName + " | URL: " + fileUrl);

  } catch (err) {
    ui.alert("QB IIF export error: " + err.message);
    Logger.log("CB13_qbExport_generateIIF error: " + err + "\n" + err.stack);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Load QB_Service_Mapping → { "STOR": { qbAccount: "...", defaultTerms: "...", qbItemName: "..." } }
 */
function CB13_qbExport_loadMapping_(ss) {
  var out = {};
  var sh = ss.getSheetByName(QB_SH.SERVICE_MAPPING);
  if (!sh || sh.getLastRow() < 2) return out;
  var lastCol = sh.getLastColumn() || QB_MAPPING_HEADERS.length;
  var vals = sh.getRange(1, 1, sh.getLastRow(), lastCol).getValues();
  var hdr  = headerMapFromRow_(vals[0]);
  var cCode     = hdr["SVC CODE"];
  var cAcct     = hdr["QB INCOME ACCOUNT"];
  var cTerms    = hdr["DEFAULT PAYMENT TERMS"];
  var cItemName = hdr["QB ITEM NAME"];
  if (cCode === undefined || cAcct === undefined) return out;
  for (var i = 1; i < vals.length; i++) {
    var code = String(vals[i][cCode] || "").trim().toUpperCase();
    if (!code) continue;
    out[code] = {
      qbAccount:    String(vals[i][cAcct]  || "").trim(),
      defaultTerms: (cTerms    !== undefined) ? String(vals[i][cTerms]    || "").trim() : "",
      qbItemName:   (cItemName !== undefined) ? String(vals[i][cItemName] || "").trim() : ""
    };
  }
  return out;
}

/**
 * Load Payment Terms AND QB Customer Name per client from Clients tab.
 * Returns: { "CLIENT NAME UPPERCASE": { terms: "Net 30", qbCustomerName: "Acme Corp" } }
 * qbCustomerName is blank string if not set — caller falls back to Stride name.
 */
function CB13_qbExport_loadClientInfo_(ss) {
  var out = {};
  var sh = ss.getSheetByName(CB_SH.CLIENTS);
  if (!sh || sh.getLastRow() < CLIENTS_DATA_START_ROW) return out;
  var hdrRow = sh.getRange(CLIENTS_HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var hdr    = headerMapFromRow_(hdrRow);
  var cName    = hdr["CLIENT NAME"];
  var cTerms   = hdr["PAYMENT TERMS"];
  var cQbName  = hdr["QB_CUSTOMER_NAME"];
  if (cName === undefined) return out;
  var numDataRows = sh.getLastRow() - CLIENTS_DATA_START_ROW + 1;
  if (numDataRows <= 0) return out;
  var data = sh.getRange(CLIENTS_DATA_START_ROW, 1, numDataRows, sh.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    var name   = String(data[i][cName]  || "").trim();
    if (!name) continue;
    out[name.toUpperCase()] = {
      terms:          (cTerms  !== undefined) ? String(data[i][cTerms]  || "").trim() : "",
      qbCustomerName: (cQbName !== undefined) ? String(data[i][cQbName] || "").trim() : ""
    };
  }
  return out;
}

/**
 * Format a date value to MM/DD/YYYY for IIF.
 */
function CB13_qbExport_fmtDate_(v) {
  if (!v) return "";
  var d = (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime()))
    ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "MM/dd/yyyy");
}

/**
 * Calculate due date from invoice date + payment terms string.
 */
function CB13_qbExport_calcDueDate_(invDateVal, terms) {
  var d = (Object.prototype.toString.call(invDateVal) === "[object Date]" && !isNaN(invDateVal.getTime()))
    ? new Date(invDateVal.getTime()) : new Date(invDateVal);
  if (isNaN(d.getTime())) return CB13_qbExport_fmtDate_(invDateVal);
  var match = String(terms || "").trim().toUpperCase().match(/NET\s*(\d+)/);
  if (match) d.setDate(d.getDate() + parseInt(match[1], 10));
  return CB13_qbExport_fmtDate_(d);
}

/**
 * Safely parse qty — avoids falsy coercion on 0.
 */
function CB13_qbExport_safeQty_(v) {
  if (v === null || v === undefined || v === "") return 1;
  var n = Number(v);
  return isFinite(n) ? n : 1;
}

/**
 * Escape a field value for IIF tab-delimited format.
 * Handles tabs, newlines, and double quotes.
 */
function CB13_qbExport_iifEsc_(v) {
  var s = String(v == null ? "" : v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
  if (s.indexOf('"') !== -1) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * CB13_qbExportCombined
 * One-click combined operation:
 * - Auto-creates QB_Invoice_Export and QB_Service_Mapping sheets if missing
 * - Halts if QB_Service_Mapping has no data rows
 * - Clears existing Pending rows from QB_Invoice_Export (fresh re-stage)
 * - Reads Consolidated_Ledger filtering by status "Invoiced"
 * - Stages rows to QB_Invoice_Export
 * - Generates IIF file
 */
function CB13_qbExportCombined() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = safeUi_();
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    ui.alert("Another QB export run is in progress. Please try again.");
    return;
  }

  try {
    // Auto-create sheets if missing
    var exportSh = ensureSheet_(ss, QB_SH.INVOICE_EXPORT);
    ensureHeaderRowExact_(exportSh, QB_EXPORT_HEADERS);

    var mappingSh = ensureSheet_(ss, QB_SH.SERVICE_MAPPING);
    ensureHeaderRowExact_(mappingSh, QB_MAPPING_HEADERS);

    // Check if mapping has data
    if (mappingSh.getLastRow() < 2) {
      ui.alert("QB_Service_Mapping is empty. Fill it with Stride service codes and QB income account names, then try again.");
      return;
    }

    // Clear existing Pending rows from QB_Invoice_Export for fresh re-stage
    if (exportSh.getLastRow() > 1) {
      var exportLastCol = exportSh.getLastColumn() || QB_EXPORT_HEADERS.length;
      var exportVals = exportSh.getRange(1, 1, exportSh.getLastRow(), exportLastCol).getValues();
      var eHdr = headerMapFromRow_(exportVals[0]);
      var eExStatus = eHdr["EXPORT STATUS"];

      if (eExStatus !== undefined) {
        // Delete rows with Pending status (in reverse to avoid shifting issues)
        for (var row = exportVals.length - 1; row >= 1; row--) {
          var status = String(exportVals[row][eExStatus] || "").trim().toUpperCase();
          if (status === "PENDING") {
            exportSh.deleteRow(row + 1);
          }
        }
      }
    }

    ss.toast("Staging invoiced items for QB export...", "QB Export", 10);
    CB13_qbExport_buildStagingSheet();
    SpreadsheetApp.flush();

    ss.toast("Generating IIF file...", "QB Export", 10);
    CB13_qbExport_generateIIF();

  } catch (e) {
    ui.alert("QB export failed: " + (e && e.message ? e.message : String(e)));
    Logger.log("CB13_qbExportCombined error: " + e + "\n" + (e.stack || ""));
    throw e;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ============================================================
   UNBILLED REPORT — DIRECT QB EXPORT FROM SELECTED ROWS
   ============================================================ */

/**
 * CB13_qbExportFromUnbilledSelection
 * Export IIF directly from checked rows on Unbilled_Report.
 * 1. Reads Unbilled_Report, finds rows with Select checkbox = TRUE and not already Invoiced
 * 2. Groups by Client (+ Sidemark if separate billing enabled for that client)
 * 3. Gets sequential invoice numbers via RPC
 * 4. Builds IIF file with full TRNS/SPL/ENDTRNS blocks
 * 5. Writes to Consolidated_Ledger with dedup
 * 6. Syncs status back to client Billing_Ledger
 * 7. Marks Unbilled_Report rows as Invoiced and unchecks them
 * 8. Saves IIF to Google Drive
 */
function CB13_qbExportFromUnbilledSelection() {
  var ui = safeUi_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Unbilled_Report");
  if (!sh) { ui.alert("Unbilled_Report not found. Run Generate Unbilled Report first."); return; }

  // v1.4.0: Use getActiveRangeList() to support non-contiguous selections (Ctrl+click)
  var rangeList = sh.getActiveRangeList();
  if (!rangeList) {
    ui.alert("Highlight the rows you want to export on Unbilled_Report, then run this again.");
    return;
  }
  var ranges = rangeList.getRanges();
  if (!ranges || !ranges.length || ranges[0].getRow() < 2) {
    ui.alert("Highlight the rows you want to export on Unbilled_Report, then run this again.");
    return;
  }

  var data = sh.getDataRange().getValues();
  if (data.length < 2) { ui.alert("No data in Unbilled_Report."); return; }

  var headers = data[0].map(String);

  var hMap = {};
  headers.forEach(function(h, i) { hMap[String(h).trim().toUpperCase()] = i; });

  // v1.4.0: Accept both new and legacy header names
  var idxStatus   = hMap["STATUS"] !== undefined ? hMap["STATUS"] : hMap["BILLING STATUS"];
  var idxClient   = hMap["CLIENT"];
  var idxSidemark = hMap["SIDEMARK"];
  var idxSvcDate  = hMap["DATE"] !== undefined ? hMap["DATE"] : hMap["SERVICE DATE"];
  var idxSvcName  = hMap["SVC NAME"] !== undefined ? hMap["SVC NAME"] : hMap["SERVICE NAME"];
  var idxQty      = hMap["QTY"];
  var idxRate     = hMap["RATE"];
  var idxTotal    = hMap["TOTAL"];
  var idxSvcCode  = hMap["SVC CODE"];
  var idxItemId   = hMap["ITEM ID"];
  var idxLedgerId = hMap["LEDGER ROW ID"] !== undefined ? hMap["LEDGER ROW ID"] : hMap["LEDGER ENTRY ID"];
  var idxSourceId = hMap["SOURCE SHEET ID"] !== undefined ? hMap["SOURCE SHEET ID"] : hMap["CLIENT SHEET ID"];

  if (idxClient === undefined || idxTotal === undefined || idxSvcCode === undefined) {
    ui.alert("Unbilled_Report missing required columns (Client, Total, Svc Code).");
    return;
  }

  // Collect highlighted rows from all selected ranges (skip header, skip already invoiced)
  var selected = [];
  var seenRows = {};
  for (var ri = 0; ri < ranges.length; ri++) {
    var startRow = ranges[ri].getRow();
    var numRows = ranges[ri].getNumRows();
    for (var i = startRow; i < startRow + numRows; i++) {
      if (i < 2 || i > data.length || seenRows[i]) continue;
      seenRows[i] = true;
      var rowData = data[i - 1];
      var status = String(rowData[idxStatus] || "").trim().toUpperCase();
      if (status === "INVOICED" || status === "EXPORTED") continue;
      selected.push({ rowIdx: i - 1, row: rowData, sheetRow: i });
    }
  }

  if (!selected.length) {
    ui.alert("No unbilled rows in your selection. Highlight rows on Unbilled_Report and try again.");
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert("Another export is in progress. Try again.");
    return;
  }

  try {
    // Load QB mappings
    var mapping = CB13_qbExport_loadMapping_(ss);
    var clientInfoMap = CB13_qbExport_loadClientInfo_(ss);

    // Check all rows have QB Income Account mapped
    for (var c = 0; c < selected.length; c++) {
      var svcCode = String(selected[c].row[idxSvcCode] || "").trim().toUpperCase();
      if (!mapping[svcCode] || !mapping[svcCode].qbAccount) {
        ui.alert("Row " + selected[c].sheetRow + " has Svc Code '" + svcCode +
          "' with no QB Income Account mapping.\nFill QB_Service_Mapping and try again.");
        return;
      }
    }

    // Read per-client sidemark setting
    var separateCache = {};

    // Group rows: by client, optionally by sidemark
    var groupsByKey = {};
    var groupOrder = [];

    for (var g = 0; g < selected.length; g++) {
      var r = selected[g].row;
      var client = String(r[idxClient] || "").trim();
      var sidemark = idxSidemark !== undefined ? String(r[idxSidemark] || "").trim() : "";
      var sourceId = idxSourceId !== undefined ? String(r[idxSourceId] || "").trim() : "";

      var separate = false;
      if (sourceId) {
        if (separateCache[sourceId] === undefined) {
          separateCache[sourceId] = CB13_readSeparateBySidemarkSetting_(sourceId);
        }
        separate = separateCache[sourceId];
      }

      var key = separate ? (client + "||" + sidemark) : client;
      if (!groupsByKey[key]) {
        groupsByKey[key] = { client: client, sidemark: separate ? sidemark : "", items: [] };
        groupOrder.push(key);
      }
      groupsByKey[key].items.push(selected[g]);
    }

    // Get invoice numbers for each group
    var cbSettings = CB13_readKeyValueSettings_(ss, "Settings");
    var masterRpcUrl = cbSettings.MASTER_RPC_URL;
    var masterRpcToken = cbSettings.MASTER_RPC_TOKEN;

    if (!masterRpcUrl || !masterRpcToken) {
      ui.alert("Missing MASTER_RPC_URL or MASTER_RPC_TOKEN in Settings.\nThese are needed to generate invoice numbers.");
      return;
    }

    // Build IIF
    var iifLines = [];
    iifLines.push("!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tTERMS\tDUEDATE\tCLEAR\tTOPRINT\tOTHER1");
    iifLines.push("!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\tQNTY\tPRICE\tINVITEM\tCLEAR");
    iifLines.push("!ENDTRNS");

    var invoiceCount = 0;
    var lineCount = 0;
    var consolLedger = ss.getSheetByName("Consolidated_Ledger");
    if (!consolLedger) {
      consolLedger = ss.insertSheet("Consolidated_Ledger");
      ensureHeaderRowExact_(consolLedger, CONSOL_LEDGER_HEADERS);
    }

    // Build existing ledger entry ID set for dedup
    var existingLedgerIds = new Set();
    if (consolLedger.getLastRow() >= 2) {
      var clVals = consolLedger.getDataRange().getValues();
      var clHdr = headerMapFromRow_(clVals[0]);
      var clLedgerIdCol = clHdr["LEDGER ROW ID"];
      if (clLedgerIdCol !== undefined) {
        for (var x = 1; x < clVals.length; x++) {
          var lid = String(clVals[x][clLedgerIdCol] || "").trim();
          if (lid) existingLedgerIds.add(lid);
        }
      }
    }

    var allSelectedSheetRows = []; // track for marking as Invoiced

    for (var gi = 0; gi < groupOrder.length; gi++) {
      var group = groupsByKey[groupOrder[gi]];

      // Get invoice number
      var invNo = CB13_rpcGetNextInvoiceId_(masterRpcUrl, masterRpcToken);
      group.invNo = invNo;
      invoiceCount++;

      var clientInfo = clientInfoMap[group.client.toUpperCase()] || {};
      var qbCustName = clientInfo.qbCustomerName || group.client;
      // Append sidemark for QuickBooks sub-customer matching
      if (group.sidemark) {
        qbCustName = qbCustName + ":" + group.sidemark;
      }
      var payTerms = clientInfo.terms || "";

      // Invoice date = today
      var invDate = CB13_qbExport_fmtDate_(new Date());
      var dueDate = CB13_qbExport_calcDueDate_(new Date(), payTerms);

      // Pre-calculate discounted totals for all line items
      var splData = [];
      var invTotal = 0;

      for (var li = 0; li < group.items.length; li++) {
        var item = group.items[li];
        var r = item.row;
        var svcCode = String(r[idxSvcCode] || "").trim().toUpperCase();
        var svcName = idxSvcName !== undefined ? String(r[idxSvcName] || "").trim() : "";
        var itemId = idxItemId !== undefined ? String(r[idxItemId] || "").trim() : "";
        var qty = idxQty !== undefined ? CB13_qbExport_safeQty_(r[idxQty]) : 1;
        var rate = idxRate !== undefined ? Number(r[idxRate] || 0) : 0;
        var total = Number(r[idxTotal] || 0);

        // v2.6.3: Discounts are now applied at the client billing ledger level.
        // No discount logic here — rates from Unbilled_Report are already discounted.
        var sourceSheetId = idxSourceId !== undefined ? String(r[idxSourceId] || "").trim() : "";

        invTotal += total;

        var qbAcct = mapping[svcCode] ? mapping[svcCode].qbAccount : "";
        var qbItemName = mapping[svcCode] ? (mapping[svcCode].qbItemName || "") : "";

        var memo = svcName;
        if (itemId) memo = (memo ? memo + " - " : "") + itemId;

        splData.push({
          item: item, r: r, svcCode: svcCode, svcName: svcName, itemId: itemId,
          qty: qty, rate: rate, total: total, qbAcct: qbAcct, qbItemName: qbItemName,
          memo: memo, sourceSheetId: sourceSheetId
        });
      }

      // TRNS line (with discounted total)
      iifLines.push([
        "TRNS", "INVOICE",
        invDate,
        "Accounts Receivable",
        CB13_qbExport_iifEsc_(qbCustName),
        invTotal.toFixed(2),
        CB13_qbExport_iifEsc_(invNo),
        "",
        CB13_qbExport_iifEsc_(payTerms),
        dueDate,
        "N", "Y",
        CB13_qbExport_iifEsc_(group.sidemark || "")
      ].join("\t"));

      // SPL lines (with discounted amounts)
      for (var si = 0; si < splData.length; si++) {
        var sd = splData[si];
        var lineAmt = (sd.total * -1).toFixed(2);

        iifLines.push([
          "SPL", "INVOICE",
          invDate,
          CB13_qbExport_iifEsc_(sd.qbAcct),
          CB13_qbExport_iifEsc_(qbCustName),
          lineAmt,
          CB13_qbExport_iifEsc_(invNo),
          CB13_qbExport_iifEsc_(sd.memo),
          sd.qty,
          sd.rate.toFixed(2),
          CB13_qbExport_iifEsc_(sd.qbItemName),
          "N"
        ].join("\t"));
        lineCount++;

        allSelectedSheetRows.push(sd.item.sheetRow);

        // Write to Consolidated_Ledger (with dedup) — uses discounted total
        var ledgerId = idxLedgerId !== undefined ? String(sd.r[idxLedgerId] || "").trim() : "";
        if (!ledgerId || !existingLedgerIds.has(ledgerId)) {
          appendConsolidatedLedgerRow_(consolLedger, {
            status: "Invoiced",
            invoiceNo: invNo,
            client: group.client,
            clientSheetId: sd.sourceSheetId,
            ledgerRowId: ledgerId,
            ledgerEntryId: ledgerId,
            date: idxSvcDate !== undefined ? sd.r[idxSvcDate] : "",
            svcCode: sd.svcCode,
            svcName: sd.svcName,
            itemId: sd.itemId,
            qty: sd.qty,
            rate: sd.rate,
            total: sd.total,
            notes: idxSidemark !== undefined ? String(sd.r[idxSidemark] || "").trim() : ""
          });
          if (ledgerId) existingLedgerIds.add(ledgerId);
        }

        // Update client Billing_Ledger
        if (sd.sourceSheetId && ledgerId) {
          try {
            pushStatusToClientLedger_(sd.sourceSheetId, ledgerId, {
              status: "Invoiced", invoiceNo: invNo
            });
          } catch (syncErr) {
            Logger.log("Client ledger sync warning: " + syncErr);
          }
        }
      }

      iifLines.push("ENDTRNS");
    }

    // Mark selected Unbilled_Report rows as Invoiced
    if (idxStatus !== undefined) {
      for (var m = 0; m < allSelectedSheetRows.length; m++) {
        sh.getRange(allSelectedSheetRows[m], idxStatus + 1).setValue("Invoiced");
      }
    }

    // Generate IIF file
    var iifContent = iifLines.join("\r\n");
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
    var fileName = "Stride_QB_Export_" + timestamp + ".iif";
    var file = DriveApp.createFile(fileName, iifContent, MimeType.PLAIN_TEXT);
    var iifFileUrl = file.getUrl();
    var iifFolderId2 = getSetting_(SpreadsheetApp.getActive(), CB_SH.SETTINGS, CB_KEYS.IIF_EXPORT_FOLDER_ID);
    if (iifFolderId2 && String(iifFolderId2).trim()) {
      try { DriveApp.getFolderById(String(iifFolderId2).trim()).addFile(file); DriveApp.getRootFolder().removeFile(file); } catch(e) { Logger.log("IIF folder move failed: " + e); }
    }

    // v1.4.0: Backfill Invoice URL on Consolidated_Ledger rows just written, hyperlink Invoice #
    try {
      var clData = consolLedger.getDataRange().getValues();
      var clHdr = headerMapFromRow_(clData[0]);
      var clInvNoCol = clHdr["INVOICE #"];
      var clInvUrlCol = clHdr["INVOICE URL"];
      if (clInvNoCol !== undefined) {
        for (var bi = 1; bi < clData.length; bi++) {
          var rowInvNo = String(clData[bi][clInvNoCol] || "").trim();
          if (!rowInvNo) continue;
          // Check if this row's invoice # matches one we just created
          var matchesExport = false;
          for (var gi2 = 0; gi2 < groupOrder.length; gi2++) {
            if (groupsByKey[groupOrder[gi2]].invNo === rowInvNo) { matchesExport = true; break; }
          }
          if (!matchesExport) continue;
          // Hyperlink Invoice # to IIF file
          try {
            var rt = SpreadsheetApp.newRichTextValue()
              .setText(rowInvNo)
              .setLinkUrl(iifFileUrl)
              .build();
            consolLedger.getRange(bi + 1, clInvNoCol + 1).setRichTextValue(rt);
          } catch(_) {}
          // Set Invoice URL
          if (clInvUrlCol !== undefined) {
            try {
              var rt2 = SpreadsheetApp.newRichTextValue()
                .setText("View IIF")
                .setLinkUrl(iifFileUrl)
                .build();
              consolLedger.getRange(bi + 1, clInvUrlCol + 1).setRichTextValue(rt2);
            } catch(_) {}
          }
        }
      }
    } catch(blErr) { Logger.log("IIF backfill hyperlink error: " + blErr); }

    SpreadsheetApp.flush();

    ui.alert(
      "✅ QB Export Complete!\n\n" +
      "Invoices: " + invoiceCount + "\n" +
      "Line items: " + lineCount + "\n\n" +
      "IIF file saved to Google Drive: " + fileName + "\n\n" +
      "To import into QuickBooks Desktop:\n" +
      "1) Find and download the file from Google Drive\n" +
      "2) Ensure the file extension is .iif (not .txt)\n" +
      "3) In QB Desktop: File > Utilities > Import > IIF Files\n" +
      "4) Select the downloaded .iif file and click Open"
    );

  } catch (err) {
    ui.alert("QB Export error: " + err.message);
    Logger.log("CB13_qbExportFromUnbilledSelection error: " + err + "\n" + (err.stack || ""));
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
