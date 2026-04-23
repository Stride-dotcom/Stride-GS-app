/***************************************************************
 CB13_INVOICE_COMMIT.gs
 STRIDE CONSOLIDATED BILLING — PHASE 2 COMMIT ENGINE
 ------------------------------------------------------------
 const CB13_INVOICE_COMMIT_V = "v1.6.0"

 v1.6.0 changes (2026-04-23):
 - FIX Bug 1: CB13_markUnbilledRowsInvoiced_ now THROWS on missing
   Status/Ledger Row ID/Client Sheet ID columns instead of silently
   logging and returning. Previously, if Unbilled_Report headers were
   mis-named or missing, the Status would stay "Unbilled" even though
   the client's Billing_Ledger was correctly updated to "Invoiced" —
   the React Billing page would show "Unbilled" after a successful
   invoice create, extremely confusing.
 - FIX Bug 1b: CB13_refreshUnbilledReport now prefers current "Status"
   header with legacy "Billing Status" fallback (was pure legacy lookup
   falling back to column B blindly).
 - Outer CB13_createAndSendInvoices already catches these throws into
   the errors array and surfaces them to the operator via the summary
   alert — so missing headers now visibly fail the invoice run instead
   of silently corrupting state.

 v1.5.0 changes:
 - FIX: Sidemark now written to its own Consolidated_Ledger column
   instead of being mashed into Item Notes. Fixes QB XLSX export
   missing Customer:Sidemark for sub-customer matching.

 v1.4.0 changes:
 - FIX B2: Added client scope validation — all invoice rows must
   belong to the same client (same SOURCE SHEET ID / CLIENT SHEET ID).
   Prevents cross-client invoice mixing that could send wrong charges
   to wrong client.

 v1.3.2 changes:
 - FIX: Removed cleartext RPC token from debug log (BUG 3)
 - FIX: Added deduplication on Consolidated_Ledger writes (BUG 5)
 - FIX: Removed hardcoded fallback column indices in
   CB13_markUnbilledRowsInvoiced_; now skips if headers missing

 v1.3.1 changes:
 - ADD: On invoice approval, approved rows are written to
   Consolidated_Ledger via appendConsolidatedLedgerRow_().
   Previously STOR rows bypassed this step. Now ALL approved
   rows (STOR, RCVG, INSP, REPAIR, etc.) are written to
   Consolidated_Ledger at commit time, maintaining it as the
   authoritative invoice processing record.

 Final-commit on Approve:
  - Get invoice number from Master RPC
  - Build HTML invoice from Master Price List Invoice_Templates
  - Create Google Doc + PDF
  - Save Doc+PDF in Client invoice folder (client Settings)
  - Copy PDF to Master Accounting folder (CB Settings)
  - Write approved rows to Consolidated_Ledger (v1.3.1)
  - Update client Billing_Ledger rows (source of truth):
      Status/Billing Status => "Invoiced"
      Invoice #, Invoice Date, Invoice URL
  - Delete approved rows from Unbilled_Report

 REQUIREMENTS / SETTINGS:
  Consolidated Billing (this spreadsheet) must have a Settings tab
  with Key/Value rows:
    - MASTER_ACCOUNTING_FOLDER_ID
    - MASTER_RPC_URL
    - MASTER_RPC_TOKEN
    - MASTER_SPREADSHEET_ID          (Master Price List spreadsheet ID)
    - INVOICE_TEMPLATE_NAME          (optional; default: "Default")

  Each client sheet must have a Settings tab (Key/Value):
    - Invoice Folder ID              (auto-created if missing)

 ADVANCED DRIVE SERVICE:
  Enable in Apps Script: Services -> Drive API -> Add
***************************************************************/

const CB13_INVOICE_COMMIT_V = "v1.4.0";

function CB13_commitInvoice(previewIndexOrInvoiceObj) {
  var started = new Date();

  try {
    var invoice;

    // Handle both numeric index (backward compat) and direct invoice object
    if (typeof previewIndexOrInvoiceObj === 'object' && previewIndexOrInvoiceObj !== null) {
      invoice = previewIndexOrInvoiceObj;
    } else {
      // Read from ScriptProperties (legacy path)
      var preview = CB13_getPreviewData_();
      if (!preview || !preview.length) throw new Error("No preview data found. Re-run Generate Invoice Previews.");
      invoice = preview[previewIndexOrInvoiceObj];
      if (!invoice) throw new Error("Invalid invoice index: " + previewIndexOrInvoiceObj);
    }

    // Build header-name index map for Unbilled_Report row data
    var _rh = {};
    if (invoice.headers && Array.isArray(invoice.headers)) {
      invoice.headers.forEach(function(h, i) {
        _rh[String(h || "").trim().toUpperCase()] = i;
      });
    }
    // Safe row value getter - looks up by header name, returns "" if not found
    function _rv(row, name1, name2, name3) {
      var names = [name1, name2, name3].filter(Boolean);
      for (var n = 0; n < names.length; n++) {
        var idx = _rh[names[n].toUpperCase()];
        if (idx !== undefined && row[idx] !== undefined && row[idx] !== null && row[idx] !== "") {
          return row[idx];
        }
      }
      return "";
    }

    // Read settings (Consolidated Billing)
    var cbSettings      = CB13_readKeyValueSettings_(SpreadsheetApp.getActiveSpreadsheet(), "Settings");
    var masterFolderId  = cbSettings.MASTER_ACCOUNTING_FOLDER_ID;
    var masterRpcUrl    = cbSettings.MASTER_RPC_URL;
    var masterRpcToken  = cbSettings.MASTER_RPC_TOKEN;
    var masterSpreadsheetId = cbSettings.MASTER_SPREADSHEET_ID;
    var templateName    = cbSettings.INVOICE_TEMPLATE_NAME || "Default";

    if (!masterFolderId)        throw new Error("Missing Settings.MASTER_ACCOUNTING_FOLDER_ID in Consolidated Billing.");
    if (!masterRpcUrl)          throw new Error("Missing Settings.MASTER_RPC_URL in Consolidated Billing.");
    if (!masterRpcToken)        throw new Error("Missing Settings.MASTER_RPC_TOKEN in Consolidated Billing.");
    if (!masterSpreadsheetId)   throw new Error("Missing Settings.MASTER_SPREADSHEET_ID (Master Price List) in Consolidated Billing.");

    // Get invoice number (Master RPC)
    var invNo = CB13_rpcGetNextInvoiceId_(masterRpcUrl, masterRpcToken);

    // v2.0.0: Google Doc Template approach — no more HTML import
    var invDate     = new Date();
    var invDateStr  = Utilities.formatDate(invDate, Session.getScriptTimeZone(), "MM/dd/yyyy");

    // Build line items data (structured, not HTML)
    var li = CB13_buildLineItemsData_(invoice.rows, _rh);

    // Resolve anySourceSheetId using header mapping
    var sourceSheetIdx = _rh["SOURCE SHEET ID"] !== undefined ? _rh["SOURCE SHEET ID"] : _rh["CLIENT SHEET ID"];
    var anySourceSheetId = "";
    if (sourceSheetIdx !== undefined) {
      for (var si = 0; si < invoice.rows.length; si++) {
        var sv = String(invoice.rows[si][sourceSheetIdx] || "").trim();
        if (sv) { anySourceSheetId = sv; break; }
      }
    }
    if (!anySourceSheetId) throw new Error("Invoice rows missing Source Sheet ID; cannot locate client sheet.");

    // v1.4.0 FIX B2: Validate ALL rows belong to the SAME client.
    // Prevents cross-client invoice mixing (rows from Client A + Client B in one invoice).
    if (sourceSheetIdx !== undefined) {
      var _mixedClients = {};
      for (var sci = 0; sci < invoice.rows.length; sci++) {
        var _rowSsId = String(invoice.rows[sci][sourceSheetIdx] || "").trim();
        if (_rowSsId) _mixedClients[_rowSsId] = true;
      }
      var _clientIds = Object.keys(_mixedClients);
      if (_clientIds.length > 1) {
        throw new Error(
          "BLOCKED: Invoice contains rows from " + _clientIds.length + " different clients. " +
          "All rows in a single invoice must belong to the same client. " +
          "Please re-generate the Unbilled Report and ensure grouping is correct."
        );
      }
    }

    // Discounts already applied at client billing ledger level
    var grandTotal = li.subtotal;
    var paymentTerms = "Due upon receipt";
    var dueDateStr   = invDateStr;

    // Get client payment terms from client Settings
    try {
      var _clientSS = SpreadsheetApp.openById(String(anySourceSheetId).trim());
      var _clientSettings = CB13_readKeyValueSettings_(_clientSS, "Settings");
      if (_clientSettings.PAYMENT_TERMS) paymentTerms = _clientSettings.PAYMENT_TERMS;
    } catch (_) {}

    // --- Build Invoice PDF from Google Doc Template ---
    var docTitle = "Invoice " + invNo + " — " + (invoice.client || "");
    if (invoice.sidemark) docTitle += " — " + invoice.sidemark;

    // Get template Doc ID from Master Price List Settings
    var masterSS = SpreadsheetApp.openById(masterSpreadsheetId);
    var masterSettings = CB13_readKeyValueSettings_(masterSS, "Settings");
    var invoiceTemplateId = masterSettings.DOC_INVOICE_TEMPLATE_ID;
    if (!invoiceTemplateId) throw new Error("Missing DOC_INVOICE_TEMPLATE_ID in Master Price List Settings. Run 'Create Doc Templates' first.");

    // Copy the template
    var templateFile = DriveApp.getFileById(invoiceTemplateId);
    var copyFile = templateFile.makeCopy(docTitle);
    var docId = copyFile.getId();

    // Open and populate
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();

    // Replace simple tokens
    body.replaceText("\\{\\{INV_NO\\}\\}", invNo);
    body.replaceText("\\{\\{CLIENT_NAME\\}\\}", invoice.client || "");
    body.replaceText("\\{\\{INV_DATE\\}\\}", invDateStr);
    body.replaceText("\\{\\{PAYMENT_TERMS\\}\\}", paymentTerms);
    body.replaceText("\\{\\{DUE_DATE\\}\\}", dueDateStr);
    body.replaceText("\\{\\{SUBTOTAL\\}\\}", CB13_money_(li.subtotal));
    body.replaceText("\\{\\{GRAND_TOTAL\\}\\}", CB13_money_(grandTotal));

    // Populate line items table (find the table with "Service Date" header)
    var tables = body.getTables();
    var itemsTable = null;
    for (var ti = 0; ti < tables.length; ti++) {
      var firstRow = tables[ti].getRow(0);
      if (firstRow && firstRow.getNumCells() >= 5) {
        var cellText = firstRow.getCell(0).getText().trim();
        if (cellText === "Service Date" || cellText === "{{LINE_ITEMS_HEADER}}") {
          itemsTable = tables[ti];
          break;
        }
      }
    }

    if (itemsTable) {
      // Remove placeholder row (row 1 after header)
      while (itemsTable.getNumRows() > 1) {
        itemsTable.removeRow(1);
      }
      // Add data rows
      for (var ri = 0; ri < li.rows.length; ri++) {
        var rowData = li.rows[ri];
        var newRow = itemsTable.appendTableRow();
        for (var ci = 0; ci < rowData.length; ci++) {
          var cell = newRow.appendTableCell(String(rowData[ci] || ""));
          cell.setFontSize(10);
          cell.setPaddingTop(4);
          cell.setPaddingBottom(4);
          cell.setPaddingLeft(6);
          cell.setPaddingRight(6);
          // Right-align Qty (col 4), Rate (col 5), Total (col 6)
          if (ci >= 4) {
            cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
          }
        }
      }
    }

    // Remove discount placeholder if empty
    body.replaceText("\\{\\{DISCOUNT_ROWS\\}\\}", "");
    body.replaceText("\\{\\{INVOICE_NOTES_BLOCK\\}\\}", "");

    doc.saveAndClose();

    // Export as PDF with 0.25" margins
    var invoiceMargin = 0.25;
    var pdfExportUrl = "https://docs.google.com/document/d/" + docId + "/export?" +
      "format=pdf&size=letter&portrait=true&fitw=true&top=" + invoiceMargin + "&bottom=" + invoiceMargin +
      "&left=" + invoiceMargin + "&right=" + invoiceMargin;
    var pdfResp = UrlFetchApp.fetch(pdfExportUrl, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (pdfResp.getResponseCode() !== 200) {
      throw new Error("Invoice PDF export failed (" + pdfResp.getResponseCode() + ")");
    }
    var pdfBlob = pdfResp.getBlob().setName(docTitle + ".pdf");

    // Client folder
    var clientSS       = SpreadsheetApp.openById(String(anySourceSheetId).trim());
    var clientFolderId = CB13_getOrCreateClientInvoiceFolderId_(clientSS, invoice.client || "Client");
    var clientFolder   = DriveApp.getFolderById(clientFolderId);

    var clientPdfFile = clientFolder.createFile(pdfBlob);

    // Copy PDF to Master Accounting folder
    var masterFolder = DriveApp.getFolderById(masterFolderId);
    masterFolder.createFile(pdfBlob).setName(docTitle + ".pdf");

    // Trash the temp Google Doc — we only need the PDF
    copyFile.setTrashed(true);

    // ----------------------------------------------------------------
    // v1.3.1: Write approved rows to Consolidated_Ledger
    // Consolidated_Ledger is now populated at approval time, not at
    // storage charge generation time. This applies to ALL service codes.
    // ----------------------------------------------------------------
    var ss            = SpreadsheetApp.getActiveSpreadsheet();
    var consolLedger  = ss.getSheetByName("Consolidated_Ledger");
    if (!consolLedger) {
      consolLedger = ss.insertSheet("Consolidated_Ledger");
    }

    // Get client settings for name/sidemark
    var clientSettingsSh = clientSS.getSheetByName("Settings");
    var clientSMap       = clientSettingsSh
      ? CB13_readClientSettingsMap_(clientSettingsSh) : {};

    // Build existing ledger ID set for dedup
    var existingConsolIds = new Set();
    var consolData = consolLedger.getDataRange().getValues();
    var consolHdrMap = headerMapFromRow_(consolData[0]);
    var consolLedgerIdCol = consolHdrMap["LEDGER ROW ID"];
    if (consolLedgerIdCol !== undefined) {
      for (var xi = 1; xi < consolData.length; xi++) {
        var xid = String(consolData[xi][consolLedgerIdCol] || "").trim();
        if (xid) existingConsolIds.add(xid);
      }
    }

    for (var ri = 0; ri < invoice.rows.length; ri++) {
      var r = invoice.rows[ri];
      var ledgerIdVal = _rv(r, "Ledger Entry ID", "Ledger Row ID") || "";
      if (ledgerIdVal && existingConsolIds.has(String(ledgerIdVal).trim())) continue; // dedup
      var consolPayload = {
        status:        "Invoiced",
        invoiceNo:     invNo,
        client:        _rv(r, "Client") || invoice.client || "",
        clientSheetId: _rv(r, "Source Sheet ID", "Client Sheet ID") || String(anySourceSheetId).trim(),
        ledgerRowId:   _rv(r, "Ledger Entry ID", "Ledger Row ID") || "",
        ledgerEntryId: _rv(r, "Ledger Entry ID", "Ledger Row ID") || "",
        sourceRow:     _rv(r, "Source Row") || "",
        date:          _rv(r, "Service Date", "Date") || "",
        svcCode:       _rv(r, "Svc Code", "Service Code") || "",
        svcName:       _rv(r, "Service Name", "Svc Name") || "",
        itemId:        _rv(r, "Item ID") || "",
        description:   _rv(r, "Description") || "",
        klass:         _rv(r, "Class") || "",
        qty:           _rv(r, "Qty", "Quantity"),
        rate:          _rv(r, "Rate"),
        total:         _rv(r, "Total"),
        taskId:        _rv(r, "Task ID") || "",
        repairId:      _rv(r, "Repair ID") || "",
        shipNo:        _rv(r, "Shipment #", "Shipment") || "",
        notes:         _rv(r, "Item Notes") || "",
        sidemark:      _rv(r, "Sidemark") || "",
        emailStatus:   "",
        invoiceUrl:    clientPdfFile.getUrl()
      };
      appendConsolidatedLedgerRow_(consolLedger, consolPayload);
      if (ledgerIdVal) existingConsolIds.add(String(ledgerIdVal).trim());
    }

    // Update client Billing_Ledger rows
    var ledgerIdIdx = _rh["LEDGER ENTRY ID"] !== undefined ? _rh["LEDGER ENTRY ID"] : _rh["LEDGER ROW ID"];
    CB13_markClientLedgerRowsInvoiced_({
      clientSpreadsheetId: String(anySourceSheetId).trim(),
      ledgerEntryIds:      ledgerIdIdx !== undefined ? CB13_extractColumn_(invoice.rows, ledgerIdIdx) : [],
      invoiceNumber:       invNo,
      invoiceDate:         invDate,
      invoiceDocUrl:       clientPdfFile.getUrl()
    });

    // Mark approved rows as "Invoiced" on Unbilled_Report
    CB13_markUnbilledRowsInvoiced_(invoice.rows);

    // Email invoice PDF to client
    var emailStatus = "Not Sent";
    try {
      emailInvoiceToClient_(String(anySourceSheetId).trim(), invNo, clientPdfFile);
      emailStatus = "Sent";
    } catch (emailErr) {
      emailStatus = "Failed";
      Logger.log("Email failed for " + invNo + ": " + emailErr);
    }

    // Update Email Status for all rows of this invoice in Consolidated_Ledger
    var consolVals = consolLedger.getDataRange().getValues();
    var consolHeaders = consolVals[0].map(String);
    var emailStatusCol = consolHeaders.indexOf("Email Status");
    if (emailStatusCol !== -1) {
      for (var i = 1; i < consolVals.length; i++) {
        var invNoCol = consolHeaders.indexOf("Invoice #");
        if (invNoCol !== -1 && String(consolVals[i][invNoCol] || "").trim() === invNo) {
          consolLedger.getRange(i + 1, emailStatusCol + 1).setValue(emailStatus);
        }
      }
    }

    // Log success
    logBilling_({
      fn:        "CB13_commitInvoice",
      type:      "Invoice",
      status:    "Success",
      started:   started,
      invoiceId: invNo,
      details:   "Invoice committed: " + (invoice.client || "")
    });

    return {
      invoiceNumber: invNo,
      client:        invoice.client || "",
      docUrl:        clientPdfFile.getUrl(),
      pdfFile:       clientPdfFile,
      emailStatus:   emailStatus,
      duration:      (new Date() - started)
    };

  } catch (err) {
    console.error("CB13_commitInvoice failed:", err && err.stack ? err.stack : err);
    logBilling_({
      fn:      "CB13_commitInvoice",
      type:    "Invoice",
      status:  "Error",
      started: started,
      details: errToString_(err)
    });
    throw err;
  }
}

/** ---- Preview data read ---- */
function CB13_getPreviewData(index) {
  return CB13_getPreviewData_(index);
}

function CB13_getPreviewData_() {
  var raw = PropertiesService.getScriptProperties().getProperty("CB13_PREVIEW_DATA");
  return raw ? JSON.parse(raw) : [];
}

/** ---- Settings helpers ---- */
function CB13_readKeyValueSettings_(ss, sheetName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Missing sheet: " + sheetName);

  var v   = sh.getDataRange().getValues();
  var out = {};
  for (var i = 0; i < v.length; i++) {
    var k = String(v[i][0] || "").trim();
    if (!k) continue;
    out[k] = String(v[i][1] == null ? "" : v[i][1]).trim();
  }
  return out;
}

/**
 * v1.3.1 helper: reads client Settings tab (Key/Value rows starting row 2)
 * into an uppercase-keyed map. Mirrors readClientSettings_ in Code.gs but
 * scoped locally to avoid cross-file dependency assumptions.
 */
function CB13_readClientSettingsMap_(settingsSh) {
  var map = {};
  var lr  = settingsSh.getLastRow();
  if (lr < 2) return map;
  var vals = settingsSh.getRange(2, 1, lr - 1, 2).getValues();
  vals.forEach(function(r) {
    var k = String(r[0] || "").trim().toUpperCase();
    if (k) map[k] = r[1];
  });
  return map;
}

function CB13_writeKeyValueSetting_(ss, sheetName, key, value) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Missing sheet: " + sheetName);

  var v = sh.getDataRange().getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0] || "").trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  var last = sh.getLastRow();
  sh.getRange(last + 1, 1).setValue(key);
  sh.getRange(last + 1, 2).setValue(value);
}

/** ---- Master RPC ---- */
function CB13_rpcGetNextInvoiceId_(rpcUrl, rpcToken) {
  var payload = {
    action: "getNextInvoiceId",
    token:  rpcToken
  };

  var res = UrlFetchApp.fetch(rpcUrl, {
    method:          "post",
    contentType:     "application/json",
    payload:         JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error("Master RPC invoice id failed (" + code + "): " + text);
  }

  var obj = JSON.parse(text);
  var id  = obj.shipmentNo || obj.id || obj.invoiceId;
  if (!id) throw new Error("Master RPC returned no invoice id. Response: " + text);
  return String(id);
}

/** ---- Invoice template fetch (Master Price List) ---- */
function CB13_fetchInvoiceTemplate_(masterSpreadsheetId, templateName) {
  var ss = SpreadsheetApp.openById(masterSpreadsheetId);
  var sh = ss.getSheetByName("Invoice_Templates");
  if (!sh) throw new Error("Master Price List missing sheet: Invoice_Templates");

  var v = sh.getDataRange().getValues();
  if (!v || v.length < 2) throw new Error("Invoice_Templates is empty.");

  var headers   = v[0].map(function(x){ return String(x || "").trim(); });
  var idxName   = headers.indexOf("Template Name");
  var idxSubject= headers.indexOf("Subject");
  var idxHtml   = headers.indexOf("HTML Body");

  if (idxName === -1 || idxHtml === -1) {
    idxName    = 0;
    idxSubject = 1;
    idxHtml    = 2;
  }

  for (var i = 1; i < v.length; i++) {
    if (String(v[i][idxName] || "").trim() === templateName) {
      return {
        subject: String(v[i][idxSubject] || ""),
        html:    String(v[i][idxHtml] || "")
      };
    }
  }

  // fallback to first template row
  return {
    subject: String(v[1][idxSubject] || ""),
    html:    String(v[1][idxHtml] || "")
  };
}

/** ---- Line items HTML ---- */
function CB13_buildLineItemsHtml_(rows, headerMap) {
  var subtotal = 0;
  var storageSubtotal = 0;
  var servicesSubtotal = 0;
  var htmlRows = "";

  // Helper to safely get values from row using header map
  function _rv(row, name1, name2, name3) {
    var names = [name1, name2, name3].filter(Boolean);
    for (var n = 0; n < names.length; n++) {
      var idx = headerMap[names[n].toUpperCase()];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== null && row[idx] !== "") {
        return row[idx];
      }
    }
    return "";
  }

  // Separate storage rows from non-storage rows
  var storageByKey = {};   // key = sidemark || "(No Sidemark)"
  var storageOrder = [];
  var nonStorageRows = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var svcCode = String(_rv(r, "Svc Code", "Service Code") || "").trim().toUpperCase();

    if (svcCode === "STOR") {
      var sm = String(_rv(r, "Sidemark", "Item Notes") || "").trim() || "(No Sidemark)";
      if (!storageByKey[sm]) {
        storageByKey[sm] = { sidemark: sm, items: [], totalCuFt: 0, total: 0, minDate: null, maxDate: null };
        storageOrder.push(sm);
      }
      var grp = storageByKey[sm];
      var itemTotal = CB13_num_(_rv(r, "Total"));
      var qty = CB13_num_(_rv(r, "Qty", "Quantity"));  // cuFt for storage
      if (isFinite(itemTotal)) grp.total += itemTotal;
      if (isFinite(qty)) grp.totalCuFt += qty;
      grp.items.push(r);

      // Track date range from service date
      var d = CB13_coerceDate_(_rv(r, "Service Date", "Date"));
      if (d) {
        if (!grp.minDate || d < grp.minDate) grp.minDate = d;
        if (!grp.maxDate || d > grp.maxDate) grp.maxDate = d;
      }
    } else {
      nonStorageRows.push(r);
    }
  }

  // --- Render storage summary rows (one per sidemark) ---
  var tdStyle = "padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#1E293B;";
  for (var s = 0; s < storageOrder.length; s++) {
    var grp = storageByKey[storageOrder[s]];
    var period = "";
    if (grp.minDate && grp.maxDate) {
      period = CB13_fmtMMDDYYYY_(grp.minDate) + " - " + CB13_fmtMMDDYYYY_(grp.maxDate);
    } else if (grp.minDate) {
      period = CB13_fmtMMDDYYYY_(grp.minDate);
    }

    var svcName = "Storage - " + grp.sidemark;
    var itemCount = grp.items.length + " items";
    var cuFtStr = CB13_num_(grp.totalCuFt) ? grp.totalCuFt.toFixed(2) + " cuFt" : "";
    var notes = itemCount + (cuFtStr ? ", " + cuFtStr : "");

    if (isFinite(grp.total)) {
      subtotal += grp.total;
      storageSubtotal += grp.total;
    }

        htmlRows +=
          "<tr>" +
          "<td style=\"" + tdStyle + "\">" + CB13_escHtml_(period) + "</td>" +
          "<td style=\"" + tdStyle + "\">" + CB13_escHtml_(svcName) + "</td>" +
          "<td style=\"" + tdStyle + "\"></td>" +
          "<td style=\"" + tdStyle + "font-size:11px;color:#64748B;\">" + CB13_escHtml_(notes) + "</td>" +
          "<td style=\"" + tdStyle + "text-align:center;\"></td>" +
          "<td style=\"" + tdStyle + "text-align:right;\"></td>" +
          "<td style=\"" + tdStyle + "text-align:right;\">" + CB13_escHtml_(CB13_money_(grp.total)) + "</td>" +
          "</tr>";
  }

  // --- Render non-storage rows individually ---
  for (var j = 0; j < nonStorageRows.length; j++) {
    var r = nonStorageRows[j];
    var svcDate = CB13_fmtMMDDYYYY_(CB13_coerceDate_(_rv(r, "Service Date", "Date")) || _rv(r, "Service Date", "Date"));
    var svcName = _rv(r, "Service Name", "Svc Name");
    var itemId  = _rv(r, "Item ID");
    var qty     = _rv(r, "Qty", "Quantity");
    qty = qty !== undefined && qty !== null && qty !== "" ? qty : 1;
    var rate    = CB13_num_(_rv(r, "Rate"));
    var total   = CB13_num_(_rv(r, "Total"));
    var notes   = String(_rv(r, "Sidemark", "Item Notes") || "");

    if (isFinite(total)) {
      subtotal += total;
      servicesSubtotal += total;
    }

        htmlRows +=
          "<tr>" +
          "<td style=\"" + tdStyle + "\">" + CB13_escHtml_(svcDate) + "</td>" +
          "<td style=\"" + tdStyle + "\">" + CB13_escHtml_(svcName) + "</td>" +
          "<td style=\"" + tdStyle + "\">" + CB13_escHtml_(itemId) + "</td>" +
          "<td style=\"" + tdStyle + "font-size:11px;color:#64748B;\">" + CB13_escHtml_(notes) + "</td>" +
          "<td style=\"" + tdStyle + "text-align:center;\">" + CB13_escHtml_(String(qty)) + "</td>" +
          "<td style=\"" + tdStyle + "text-align:right;\">" + CB13_escHtml_(CB13_money_(rate)) + "</td>" +
          "<td style=\"" + tdStyle + "text-align:right;\">" + CB13_escHtml_(CB13_money_(total)) + "</td>" +
          "</tr>";
  }

  return {
    htmlRows: htmlRows,
    subtotal: subtotal,
    storageSubtotal: storageSubtotal,
    servicesSubtotal: servicesSubtotal
  };
}


// Looks up discount percentages from the Clients sheet
// ============================================================

/**
 * Look up price adjustment percentages from the client Settings tab.
 * Reads DISCOUNT_STORAGE_PCT and DISCOUNT_SERVICES_PCT keys.
 * Negative = discount (e.g. -10 = 10% off), Positive = markup (e.g. 10 = 10% increase).
 * Range: -10 to +10.
 * Returns { storagePct: -10 to 10, servicesPct: -10 to 10 }
 */
function CB13_getClientDiscounts_(clientSheetId) {
  if (!clientSheetId) return { storagePct: 0, servicesPct: 0 };
  try {
    var css = SpreadsheetApp.openById(clientSheetId);
    var sMap = CB13_readKeyValueSettings_(css, "Settings");
    var sp = CB13_num_(sMap.DISCOUNT_STORAGE_PCT) || 0;
    var vp = CB13_num_(sMap.DISCOUNT_SERVICES_PCT) || 0;
    if (sp < -10) sp = -10;
    if (sp > 10) sp = 10;
    if (vp < -10) vp = -10;
    if (vp > 10) vp = 10;
    return { storagePct: sp, servicesPct: vp };
  } catch (e) {
    console.log("CB13_getClientDiscounts_ error: " + e.message);
    return { storagePct: 0, servicesPct: 0 };
  }
}


/**
 * Build line items as structured data (not HTML) for Doc template population.
 * Returns { rows: [[col1,col2,...], ...], subtotal, storageSubtotal, servicesSubtotal }
 */
function CB13_buildLineItemsData_(rows, headerMap) {
  var subtotal = 0, storageSubtotal = 0, servicesSubtotal = 0;
  var outRows = [];

  function _rv(row, name1, name2, name3) {
    var names = [name1, name2, name3].filter(Boolean);
    for (var n = 0; n < names.length; n++) {
      var idx = headerMap[names[n].toUpperCase()];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== null && row[idx] !== "") return row[idx];
    }
    return "";
  }

  // Separate storage from non-storage
  var storageByKey = {}, storageOrder = [], nonStorageRows = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var svcCode = String(_rv(r, "Svc Code", "Service Code") || "").trim().toUpperCase();
    if (svcCode === "STOR") {
      var sm = String(_rv(r, "Sidemark", "Item Notes") || "").trim() || "(No Sidemark)";
      if (!storageByKey[sm]) {
        storageByKey[sm] = { sidemark: sm, items: [], totalCuFt: 0, total: 0, minDate: null, maxDate: null };
        storageOrder.push(sm);
      }
      var grp = storageByKey[sm];
      var itemTotal = CB13_num_(_rv(r, "Total"));
      var qty = CB13_num_(_rv(r, "Qty", "Quantity"));
      if (isFinite(itemTotal)) grp.total += itemTotal;
      if (isFinite(qty)) grp.totalCuFt += qty;
      grp.items.push(r);
      var d = CB13_coerceDate_(_rv(r, "Service Date", "Date"));
      if (d) {
        if (!grp.minDate || d < grp.minDate) grp.minDate = d;
        if (!grp.maxDate || d > grp.maxDate) grp.maxDate = d;
      }
    } else {
      nonStorageRows.push(r);
    }
  }

  // Storage summary rows
  for (var s = 0; s < storageOrder.length; s++) {
    var grp = storageByKey[storageOrder[s]];
    var period = "";
    if (grp.minDate && grp.maxDate) {
      period = CB13_fmtMMDDYYYY_(grp.minDate) + " - " + CB13_fmtMMDDYYYY_(grp.maxDate);
    } else if (grp.minDate) {
      period = CB13_fmtMMDDYYYY_(grp.minDate);
    }
    var svcName = "Storage - " + grp.sidemark;
    var notes = grp.items.length + " items" + (grp.totalCuFt ? ", " + grp.totalCuFt.toFixed(2) + " cuFt" : "");
    if (isFinite(grp.total)) { subtotal += grp.total; storageSubtotal += grp.total; }
    // 7 columns: Service Date, Service, Item ID, Notes, Qty, Rate, Total
    outRows.push([period, svcName, "", notes, "", "", CB13_money_(grp.total)]);
  }

  // Non-storage rows
  for (var j = 0; j < nonStorageRows.length; j++) {
    var r = nonStorageRows[j];
    var svcDate = CB13_fmtMMDDYYYY_(CB13_coerceDate_(_rv(r, "Service Date", "Date")) || _rv(r, "Service Date", "Date"));
    var svcName = String(_rv(r, "Service Name", "Svc Name") || "");
    var itemId = String(_rv(r, "Item ID") || "");
    var qty = _rv(r, "Qty", "Quantity"); qty = qty !== undefined && qty !== null && qty !== "" ? qty : 1;
    var rate = CB13_num_(_rv(r, "Rate"));
    var total = CB13_num_(_rv(r, "Total"));
    var notes = String(_rv(r, "Sidemark", "Item Notes") || "");
    if (isFinite(total)) { subtotal += total; servicesSubtotal += total; }
    outRows.push([svcDate || "", svcName, itemId, notes, String(qty), CB13_money_(rate), CB13_money_(total)]);
  }

  return { rows: outRows, subtotal: subtotal, storageSubtotal: storageSubtotal, servicesSubtotal: servicesSubtotal };
}


/**
 * Create the master Invoice Google Doc template.
 * Run this ONCE from Script Editor to generate the template.
 * Stores the Doc ID in Master Price List Settings.
 */
function CB13_createInvoiceDocTemplate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = CB13_readKeyValueSettings_(ss, "Settings");
  var folderId = settings.DOC_TEMPLATES_FOLDER_ID;
  if (!folderId) {
    var ui = safeUi_();
    ui.alert("Set DOC_TEMPLATES_FOLDER_ID in Consolidated Billing Settings first.");
    return;
  }

  var folder = DriveApp.getFolderById(folderId);
  var doc = DocumentApp.create("TEMPLATE - Invoice");
  var docFile = DriveApp.getFileById(doc.getId());
  folder.addFile(docFile);
  try { DriveApp.getRootFolder().removeFile(docFile); } catch(_) {}

  var body = doc.getBody();
  body.clear();
  doc.saveAndClose();

  // Set margins via Docs API (0.25") — must be done after saveAndClose + reopen
  var pts = 18;
  try {
    var apiToken = ScriptApp.getOAuthToken();
    UrlFetchApp.fetch("https://docs.googleapis.com/v1/documents/" + doc.getId() + ":batchUpdate", {
      method: "post", contentType: "application/json",
      headers: { Authorization: "Bearer " + apiToken },
      payload: JSON.stringify({ requests: [{ updateDocumentStyle: {
        documentStyle: {
          marginTop: { magnitude: pts, unit: "PT" }, marginBottom: { magnitude: pts, unit: "PT" },
          marginLeft: { magnitude: pts, unit: "PT" }, marginRight: { magnitude: pts, unit: "PT" }
        }, fields: "marginTop,marginBottom,marginLeft,marginRight"
      }}]}),
      muteHttpExceptions: true
    });
  } catch(marginErr) { Logger.log("Margin API error: " + marginErr); }

  // Reopen to build content
  doc = DocumentApp.openById(doc.getId());
  body = doc.getBody();

  // Helper: style a cell's paragraph
  function styleCell(cell, text, fontSize, bold, align, bgColor) {
    cell.setText(text);
    var para = cell.getChild(0).asParagraph();
    para.editAsText().setFontSize(fontSize).setBold(bold);
    if (align) para.setAlignment(align);
    if (bgColor) cell.setBackgroundColor(bgColor);
    return cell;
  }

  // --- Header Table (2 cols, no border) ---
  var headerData = [["Stride Logistics WMS", "Invoice\n{{INV_NO}}"]];
  var headerTable = body.appendTable(headerData);
  headerTable.setBorderWidth(0);
  styleCell(headerTable.getRow(0).getCell(0), "Stride Logistics WMS", 18, true, null, null);
  headerTable.getRow(0).getCell(0).setWidth(350);
  styleCell(headerTable.getRow(0).getCell(1), "Invoice\n{{INV_NO}}", 20, true, DocumentApp.HorizontalAlignment.RIGHT, null);

  // Divider line
  body.appendParagraph("").setBold(false).setFontSize(1);
  body.appendHorizontalRule();

  // --- Bill To / Invoice Details Table (2 cols, no border) ---
  var detailData = [["Bill To\n{{CLIENT_NAME}}", "Invoice Date:  {{INV_DATE}}\nPayment Terms:  {{PAYMENT_TERMS}}\nDue Date:  {{DUE_DATE}}"]];
  var detailTable = body.appendTable(detailData);
  detailTable.setBorderWidth(0);
  var billToCell = detailTable.getRow(0).getCell(0);
  billToCell.setWidth(350);
  // Style "Bill To" label small, client name larger
  var billPara = billToCell.getChild(0).asParagraph();
  billPara.editAsText().setFontSize(9).setBold(false);
  if (billToCell.getNumChildren() > 1) {
    billToCell.getChild(1).asParagraph().editAsText().setFontSize(14).setBold(true);
  }
  // Right-align invoice details
  var invInfoCell = detailTable.getRow(0).getCell(1);
  for (var di = 0; di < invInfoCell.getNumChildren(); di++) {
    var p = invInfoCell.getChild(di);
    if (p.getType() === DocumentApp.ElementType.PARAGRAPH) {
      p.asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      p.asParagraph().editAsText().setFontSize(10);
    }
  }

  body.appendParagraph("").setFontSize(6); // spacer

  // --- Line Items Table (7 cols with header row + placeholder) ---
  var colHeaders = ["Service Date", "Service", "Item ID", "Notes", "Qty", "Rate", "Total"];
  var itemsData = [colHeaders, ["{{PLACEHOLDER}}", "", "", "", "", "", ""]];
  var itemsTable = body.appendTable(itemsData);
  itemsTable.setBorderColor("#E2E8F0");
  // Style header row
  var hRow = itemsTable.getRow(0);
  for (var c = 0; c < colHeaders.length; c++) {
    styleCell(hRow.getCell(c), colHeaders[c], 9, true, null, "#F1F5F9");
  }
  // Style placeholder row
  var pRow = itemsTable.getRow(1);
  for (var pc = 0; pc < 7; pc++) {
    pRow.getCell(pc).getChild(0).asParagraph().editAsText().setFontSize(10);
  }

  body.appendParagraph("").setFontSize(6); // spacer

  // --- Totals Table (2 cols, no border) ---
  var totalsData = [["Subtotal", "{{SUBTOTAL}}"], ["Total Due", "{{GRAND_TOTAL}}"]];
  var totalsTable = body.appendTable(totalsData);
  totalsTable.setBorderWidth(0);
  // Subtotal row
  styleCell(totalsTable.getRow(0).getCell(0), "Subtotal", 11, false, null, null);
  totalsTable.getRow(0).getCell(0).setWidth(400);
  styleCell(totalsTable.getRow(0).getCell(1), "{{SUBTOTAL}}", 11, false, DocumentApp.HorizontalAlignment.RIGHT, null);
  // Total Due row
  styleCell(totalsTable.getRow(1).getCell(0), "Total Due", 14, true, null, null);
  styleCell(totalsTable.getRow(1).getCell(1), "{{GRAND_TOTAL}}", 14, true, DocumentApp.HorizontalAlignment.RIGHT, null);

  body.appendParagraph("").setFontSize(6); // spacer

  // --- Footer ---
  var footer = body.appendParagraph("Stride Logistics · Kent, WA · accounting@stridenw.com");
  footer.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  footer.editAsText().setFontSize(9).setForegroundColor("#94A3B8");

  doc.saveAndClose();

  // Save template ID to Master Price List Settings
  var masterSsId = settings.MASTER_SPREADSHEET_ID;
  if (masterSsId) {
    try {
      var masterSS = SpreadsheetApp.openById(masterSsId);
      var settingsSh = masterSS.getSheetByName("Settings");
      if (settingsSh) {
        var lastRow = settingsSh.getLastRow() + 1;
        settingsSh.getRange(lastRow, 1).setValue("DOC_INVOICE_TEMPLATE_ID");
        settingsSh.getRange(lastRow, 2).setValue(doc.getId());
        settingsSh.getRange(lastRow, 3).setValue("Google Doc template ID for invoices.");
      }
    } catch (e) {
      Logger.log("Could not write template ID to Master Price List: " + e);
    }
  }

  var ui = safeUi_();
  ui.alert("Invoice template created!\n\nDoc ID: " + doc.getId() + "\n\nYou can now edit it in Google Docs to customize the layout. Keep all {{TOKEN}} placeholders.");
}


/** ---- LEGACY: Create Google Doc from HTML (kept for backward compat) ---- */
function CB13_createGoogleDocFromHtml_(title, html) {
  var blob        = Utilities.newBlob(html, "text/html", title + ".html");
  var tempHtmlFile= DriveApp.createFile(blob);

  try {
    var doc = Drive.Files.copy(
      { title: title, mimeType: MimeType.GOOGLE_DOCS },
      tempHtmlFile.getId()
    );
    tempHtmlFile.setTrashed(true);
    return doc.id;
  } catch (e) {
    try { tempHtmlFile.setTrashed(true); } catch (_) {}
    throw new Error(
      "HTML->Doc conversion failed. Enable Advanced Drive Service in Apps Script. " +
      "Original error: " + (e && e.message ? e.message : e)
    );
  }
}

/** ---- Client folder handling ---- */
function CB13_getOrCreateClientInvoiceFolderId_(clientSS, clientName) {
  var settings = CB13_readKeyValueSettings_(clientSS, "Settings");
  var existing = settings["Invoice Folder ID"];
  if (existing) return existing;

  var folder = DriveApp.createFolder((clientName || "Client") + " Invoices");
  CB13_writeKeyValueSetting_(clientSS, "Settings", "Invoice Folder ID", folder.getId());
  return folder.getId();
}

function CB13_moveFileToFolder_(file, folder) {
  folder.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}
}

/** ---- Ledger updates (client Billing_Ledger) ---- */
function CB13_markClientLedgerRowsInvoiced_(opts) {
  var clientSpreadsheetId = opts.clientSpreadsheetId;
  var ledgerEntryIds      = (opts.ledgerEntryIds || []).filter(function(x){ return String(x || "").trim() !== ""; });
  var invNo               = opts.invoiceNumber;
  var invDate             = opts.invoiceDate;
  var invUrl              = opts.invoiceDocUrl;

  if (!ledgerEntryIds.length) throw new Error("No Ledger Entry IDs provided for commit.");

  var ss = SpreadsheetApp.openById(clientSpreadsheetId);
  var sh = ss.getSheetByName("Billing_Ledger");
  if (!sh) throw new Error("Client missing Billing_Ledger.");

  var data = sh.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error("Client Billing_Ledger has no data.");

  var headers     = data[0].map(String);
  var idxLedgerId = CB13_findHeaderIdx_(headers, ["Ledger Row ID", "Ledger Entry ID"]);
  if (idxLedgerId == null) throw new Error("Client Billing_Ledger missing Ledger Row ID column. Run Update Headers on this client sheet.");

  var idxStatus = CB13_findHeaderIdx_(headers, ["Billing Status", "Status"]);
  if (idxStatus == null) throw new Error("Client Billing_Ledger missing Status/Billing Status column.");

  var idxInvNo   = CB13_findOrAddHeader_(sh, headers, ["Invoice #", "Invoice No", "Invoice Number"], "Invoice #");
  headers        = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  var idxInvDate = CB13_findOrAddHeader_(sh, headers, ["Invoice Date"], "Invoice Date");
  headers        = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  var idxInvUrl  = CB13_findOrAddHeader_(sh, headers, ["Invoice URL", "Invoice Link"], "Invoice URL");
  headers        = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  data = sh.getDataRange().getValues();

  var rowByLedgerId = {};
  for (var r = 1; r < data.length; r++) {
    var id = String(data[r][idxLedgerId] || "").trim();
    if (id) rowByLedgerId[id] = r + 1;
  }

  var touched = 0;
  for (var i = 0; i < ledgerEntryIds.length; i++) {
    var lid    = String(ledgerEntryIds[i]).trim();
    var rowNum = rowByLedgerId[lid];
    if (!rowNum) continue;

    sh.getRange(rowNum, idxStatus + 1).setValue("Invoiced");
    sh.getRange(rowNum, idxInvNo + 1).setValue(invNo);
    sh.getRange(rowNum, idxInvDate + 1).setValue(invDate);
    sh.getRange(rowNum, idxInvUrl + 1).setValue(invUrl);
    touched++;
  }

  if (!touched) {
    throw new Error("No client ledger rows matched Ledger Entry IDs. Nothing was updated.");
  }
}

function CB13_findHeaderIdx_(headers, candidates) {
  var norm = headers.map(function(h){ return String(h || "").trim().toLowerCase(); });
  for (var i = 0; i < candidates.length; i++) {
    var k   = String(candidates[i]).trim().toLowerCase();
    var idx = norm.indexOf(k);
    if (idx !== -1) return idx;
  }
  return null;
}

function CB13_findOrAddHeader_(sheet, headers, candidates, canonical) {
  var idx = CB13_findHeaderIdx_(headers, candidates);
  if (idx != null) return idx;

  var newCol = sheet.getLastColumn() + 1;
  sheet.insertColumnAfter(sheet.getLastColumn());
  sheet.getRange(1, newCol).setValue(canonical);
  return newCol - 1; // 0-based
}

/** ---- Mark approved rows as "Invoiced" on Unbilled_Report ---- */
function CB13_markUnbilledRowsInvoiced_(invoiceRows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Unbilled_Report");
  if (!sh) return;

  var data    = sh.getDataRange().getValues();
  if (data.length < 2) return;

  var headers    = data[0].map(String);

  // Build header index map
  var _hm = {};
  headers.forEach(function(h, i) {
    _hm[String(h || "").trim().toUpperCase()] = i;
  });

  // Find indices using header map — tolerant of legacy + current names
  var idxStatus = _hm["BILLING STATUS"] !== undefined ? _hm["BILLING STATUS"] : _hm["STATUS"];
  var idxLedgerId = _hm["LEDGER ENTRY ID"] !== undefined ? _hm["LEDGER ENTRY ID"] : _hm["LEDGER ROW ID"];
  var idxSourceId = _hm["SOURCE SHEET ID"] !== undefined ? _hm["SOURCE SHEET ID"] : _hm["CLIENT SHEET ID"];

  // v1.5.0: THROW instead of silent-log+return so failures surface to the user's
  // "Create & Send Invoices" error summary. Previously this would swallow the
  // failure, leaving the Unbilled_Report showing "Unbilled" after the client
  // Billing_Ledger was correctly updated to "Invoiced" — confusing.
  var missing = [];
  if (idxStatus === undefined) missing.push("Status (or legacy 'Billing Status')");
  if (idxLedgerId === undefined) missing.push("Ledger Row ID (or legacy 'Ledger Entry ID')");
  if (idxSourceId === undefined) missing.push("Client Sheet ID (or legacy 'Source Sheet ID')");
  if (missing.length) {
    throw new Error(
      "CB13_markUnbilledRowsInvoiced_: Unbilled_Report is missing required column(s): " +
      missing.join(", ") +
      ". Run Update Headers on the Consolidated Billing sheet to repair."
    );
  }

  // Helper to safely get values
  function _rv(row, name1, name2, name3) {
    var names = [name1, name2, name3].filter(Boolean);
    for (var n = 0; n < names.length; n++) {
      var idx = _hm[names[n].toUpperCase()];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== null && row[idx] !== "") {
        return row[idx];
      }
    }
    return "";
  }

  var match = {};
  for (var i = 0; i < invoiceRows.length; i++) {
    var r   = invoiceRows[i];
    var lid = String(_rv(r, "Ledger Entry ID", "Ledger Row ID") || "").trim();
    var sid = String(_rv(r, "Source Sheet ID", "Client Sheet ID") || "").trim();
    if (lid && sid) match[sid + "||" + lid] = true;
  }

  for (var row = 1; row < data.length; row++) {
    var ledgerId = String(data[row][idxLedgerId] || "").trim();
    var sourceId = String(data[row][idxSourceId] || "").trim();
    if (match[sourceId + "||" + ledgerId]) {
      // v1.4.0: Skip rows already marked Invoiced (idempotency)
      var currentStatus = String(data[row][idxStatus] || "").trim();
      if (currentStatus === "Invoiced") continue;
      sh.getRange(row + 1, idxStatus + 1).setValue("Invoiced");
    }
  }
}

/** ---- Refresh Unbilled_Report: remove Invoiced and Void rows ---- */
function CB13_refreshUnbilledReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Unbilled_Report");
  if (!sh) return;

  var data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  var headers   = data[0].map(String);
  // v1.5.0: Tolerant header lookup — accept both current "Status" and legacy "Billing Status"
  var idxStatus = headers.indexOf("Status");
  if (idxStatus === -1) idxStatus = headers.indexOf("Billing Status");
  if (idxStatus === -1) {
    Logger.log("CB13_refreshUnbilledReport: No Status or Billing Status column found — skipping.");
    return;
  }

  for (var row = data.length - 1; row >= 1; row--) {
    var status = String(data[row][idxStatus] || "").trim();
    if (status === "Invoiced" || status === "Void") {
      sh.deleteRow(row + 1);
    }
  }
}

/** ---- Utility ---- */
function CB13_replaceToken_(html, token, value) {
  return String(html || "").split(token).join(String(value == null ? "" : value));
}

function CB13_escHtml_(s) {
  var str = String(s == null ? "" : s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function CB13_fmtMMDDYYYY_(d) {
  if (!d) return "";
  if (Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "MM-dd-yyyy");
  }
  return String(d);
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

function CB13_num_(v) {
  var n = Number(v);
  return isFinite(n) ? n : NaN;
}

function CB13_money_(v) {
  var n = Number(v);
  if (!isFinite(n)) n = 0;
  return n.toFixed(2);
}

function CB13_extractColumn_(rows, idx) {
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(rows[i][idx]);
  return out;
}

function CB13_firstNonEmpty_(rows, idx) {
  for (var i = 0; i < rows.length; i++) {
    var v = rows[i][idx];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}
