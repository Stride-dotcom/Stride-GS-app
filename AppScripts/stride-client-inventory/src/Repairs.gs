/* ===================================================
   Repairs.gs — v3.1.0 — 2026-03-31 11:40 AM PST
   =================================================== */

/* ============================================================
REPAIRS
============================================================ */
function createRepairRowFromTask_(payload) {
var ss = SpreadsheetApp.getActive();
var repairs = ss.getSheetByName(CI_SH.REPAIRS);
if (!repairs) return;
var map = getHeaderMap_(repairs);
var last = repairs.getLastRow();
var sourceTaskCol = map["Source Task ID"];
if (last >= 2 && sourceTaskCol && payload.taskId) {
var existingTaskIds = repairs.getRange(2, sourceTaskCol, last - 1, 1).getValues().flat().map(String);
if (existingTaskIds.indexOf(payload.taskId) !== -1) {
Logger.log("createRepairRowFromTask_: skipped - repair already exists for task " + payload.taskId);
return;
}
}
var repairId = "RPR-" + payload.itemId + "-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss");
var rn = String(payload.resultNotes || "").trim();
var tn = String(payload.taskNotes || "").trim();
var mergedContext = "";
if (rn && tn) mergedContext = rn + " | Task Notes: " + tn;
else if (rn) mergedContext = rn;
else if (tn) mergedContext = "Task Notes: " + tn;
var issueShort = String(payload.issue || "").trim();
var rowValues = buildRowFromMap_(map, {
"Repair ID": repairId,
"Source Task ID": payload.taskId || "",
"Item ID": payload.itemId,
"Vendor": payload.itemVendor || "",
"Description": payload.itemDesc || "",
"Class": payload.itemClass || "",
"Location": payload.itemLocation || "",
"Task Notes": mergedContext || issueShort || "",
"Quote Amount": "",
"Approved": "",
"Parts Cost": "",
"Labor Hours": "",
"Repair Vendor": "",
"Status": REPAIR_STATUS.PENDING_QUOTE,
"Start Date": "",
"Invoice ID": "",
"Repair Notes": "",
"Item Notes": "Auto-created from inspection task" +
(payload.taskId ? " (" + payload.taskId + ")" : "") +
(mergedContext ? " - " + mergedContext : ""),
"Final Amount": "",
"Completed Date": ""
});
var insertRow = getLastDataRow_(repairs) + 1;
repairs.getRange(insertRow, 1, 1, rowValues.length).setValues([rowValues]);
}

function generateRepairWorkOrderPdf_(ss, repairRowData, repairMap, folderUrl) {
  try {
    var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
    var logoUrl    = getSetting_(ss, CI_SETTINGS_KEYS.LOGO_URL) || "";

    var repairId    = getCellByHeader_(repairRowData, repairMap, "Repair ID") || "";
    var itemId      = getCellByHeader_(repairRowData, repairMap, "Item ID") || "";
    var repairType  = getCellByHeader_(repairRowData, repairMap, "Description") || "";
    var repairNotes = getCellByHeader_(repairRowData, repairMap, "Repair Notes") || "";
    var taskNotes   = getCellByHeader_(repairRowData, repairMap, "Task Notes") || "";
    var status      = getCellByHeader_(repairRowData, repairMap, "Status") || "";
    var approved    = getCellByHeader_(repairRowData, repairMap, "Approved");
    var photosUrl   = folderUrl || ""; // v2.6.4: folder URL passed directly, no longer read from column
    var createdDate = getCellByHeader_(repairRowData, repairMap, "Created Date") || new Date();

    // Combine notes
    var allNotes = "";
    if (taskNotes && repairNotes) allNotes = taskNotes + "\n" + repairNotes;
    else allNotes = taskNotes || repairNotes || "";

    // Look up item details from Inventory
    var inv = findInventoryRowByItemId_(ss, itemId);
    var sidemark   = inv ? (inv.sidemark || "") : "";
    var itemQty    = inv ? (inv.qty || "1") : "1";
    var itemVendor = inv ? (inv.vendor || "") : "";
    var itemDesc   = inv ? (inv.description || "") : "";
    var itemRoom   = inv ? (inv.room || "") : "";

    var dateStr;
    if (createdDate instanceof Date) {
      dateStr = Utilities.formatDate(createdDate, Session.getScriptTimeZone(), "MM/dd/yyyy");
    } else {
      try { dateStr = Utilities.formatDate(new Date(createdDate), Session.getScriptTimeZone(), "MM/dd/yyyy"); }
      catch(_) { dateStr = String(createdDate || ""); }
    }

    // --- Build tokens and resolve against template (Email_Templates lookup with embedded fallback) ---
    var e = esc_;
    var approvedStr = "";
    if (approved !== undefined && approved !== null && approved !== "") {
      approvedStr = (approved === true || String(approved).toUpperCase() === "TRUE" || approved === "Yes") ? "Yes" : "No";
    }
    var repairTokens = {
      "{{LOGO_URL}}": e(logoUrl),
      "{{REPAIR_ID}}": e(repairId),
      "{{CLIENT_NAME}}": e(clientName),
      "{{DATE}}": e(dateStr),
      "{{SIDEMARK}}": e(sidemark),
      "{{SIDEMARK_ROW}}": sidemark ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">SIDEMARK</td><td style="font-size:12px;">' + e(sidemark) + '</td></tr>' : '',
      "{{STATUS}}": e(status),
      "{{REPAIR_TYPE}}": e(repairType),
      "{{APPROVED_ROW}}": approvedStr ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Approved</td><td style="font-size:12px;">' + e(approvedStr) + '</td></tr>' : '',
      "{{NOTES_ROW}}": allNotes ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Notes</td><td style="font-size:12px;">' + e(allNotes) + '</td></tr>' : '',
      "{{PHOTOS_ROW}}": photosUrl ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Photos</td><td style="font-size:12px;"><a href="' + e(photosUrl) + '" style="color:#E85D2D;text-decoration:underline;">View Photos</a></td></tr>' : '',
      "{{ITEM_ID}}": e(itemId),
      "{{ITEM_QTY}}": e(String(itemQty)),
      "{{ITEM_VENDOR}}": e(itemVendor),
      "{{ITEM_DESC}}": e(itemDesc),
      "{{ITEM_SIDEMARK}}": e(sidemark),
      "{{ITEM_ROOM}}": e(itemRoom),
      "{{RESULT_OPTIONS_HTML}}": '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Complete</span>' +
        '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Partial</span>' +
        '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Unable to Repair</span>' +
        '<span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Other</span>'
    };
    var repairTemplateResult = getDocTemplateHtml_(ss, "DOC_REPAIR_WORK_ORDER");
    var html = resolveDocTokens_(repairTemplateResult ? repairTemplateResult.html : getDefaultDocHtml_("DOC_REPAIR_WORK_ORDER"), repairTokens);

    var docTitle = "Work Order - " + repairId;
    var docId    = createGoogleDocFromHtml_(docTitle, html);
    var pdfBlob  = exportDocAsPdfBlob_(docId, "Work_Order_" + repairId + ".pdf", 0.25);

    // Save to repair photos folder
    var folderId = String(folderUrl).match(/[-\w]{25,}/);
    if (folderId) {
      DriveApp.getFolderById(folderId[0]).createFile(pdfBlob);
    }

    // Clean up temp Google Doc
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {}
    Logger.log("Repair work order PDF generated: " + repairId);
  } catch (err) {
    Logger.log("generateRepairWorkOrderPdf_ error: " + err + " | Stack: " + (err.stack || ""));
    // Non-fatal — don't block the repair approval, but warn user
    try { SpreadsheetApp.getActive().toast("Repair work order PDF failed: " + (err.message || err) + "\n\nEnable Advanced Drive Service: Apps Script → Services → Drive API", "PDF Warning", 10); } catch(_){}
  }
}

function buildWorkOrderHtml_(opts) {
  var e = esc_;
  var type         = opts.type;
  var id           = opts.id || "";
  var client       = opts.clientName || "";
  var logo         = opts.logoUrl || "";
  var date         = opts.date || "";
  var sidemark     = opts.sidemark || "";
  var status       = opts.status || "";
  var detailLabel  = opts.detailLabel || "";
  var detailValue  = opts.detailValue || "";
  var notesLabel   = opts.notesLabel || "";
  var notesValue   = opts.notesValue || "";
  var approved     = opts.approved;
  var photosUrl    = opts.photosUrl || "";
  var resultLabel  = opts.resultLabel || "";
  var resultOpts   = opts.resultOptions || "";
  var item         = opts.item || {};

  var O  = "#E85D2D";   // brand orange
  var N  = "#1E293B";   // dark navy
  var GB = "#F1F5F9";   // light gray bg
  var GR = "#E2E8F0";   // border gray
  var GT = "#64748B";   // text gray

  var html = '<html><head><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:' + N + ';margin:0;padding:0;}' +
    'table{border-collapse:collapse;}' +
    '</style></head><body>' +
    '<div style="margin:0 auto;">' +

    // ===== HEADER =====
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:3px solid ' + O + ';padding-bottom:12px;margin-bottom:16px;">' +
    '<tr>' +
    '<td style="vertical-align:middle;">' +
    '<table cellpadding="0" cellspacing="0" border="0"><tr>' +
    (logo ? '<td style="vertical-align:middle;padding-right:8px;"><img src="' + e(logo) + '" alt="Logo" style="height:36px;width:36px;border-radius:4px;" /></td>' : '') +
    '<td style="vertical-align:middle;"><span style="font-size:22px;font-weight:900;color:' + N + ';">Stride Logistics</span> ' +
    '<span style="font-size:22px;font-weight:900;color:' + O + ';">WMS</span></td>' +
    '</tr></table>' +
    '<div style="font-size:11px;color:' + GT + ';margin-top:2px;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</div>' +
    '</td>' +
    '<td style="text-align:right;vertical-align:top;">' +
    '<div style="font-size:22px;font-weight:900;color:' + N + ';">Work Order</div>' +
    '<div style="font-size:16px;font-weight:800;color:' + O + ';margin-top:2px;">' + e(id) + '</div>' +
    '</td>' +
    '</tr></table>' +

    // ===== CLIENT / DATE / SIDEMARK / STATUS =====
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">' +
    '<tr>' +
    '<td style="width:50%;vertical-align:top;">' +
    '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;">' +
    '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;width:90px;font-weight:700;">CLIENT</td>' +
    '<td style="font-size:13px;font-weight:700;">' + e(client) + '</td></tr>' +
    (sidemark ? '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;font-weight:700;">SIDEMARK</td>' +
    '<td style="font-size:13px;font-weight:600;">' + e(sidemark) + '</td></tr>' : '') +
    '</table></td>' +
    '<td style="width:50%;vertical-align:top;">' +
    '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;">' +
    '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;text-align:right;width:70px;font-weight:700;">DATE</td>' +
    '<td style="font-size:13px;font-weight:700;text-align:right;">' + e(date) + '</td></tr>' +
    '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;text-align:right;font-weight:700;">STATUS</td>' +
    '<td style="font-size:13px;font-weight:600;text-align:right;">' + e(status) + '</td></tr>' +
    '</table></td>' +
    '</tr></table>' +

    // ===== TASK/REPAIR DETAILS =====
    '<div style="background:' + GB + ';border:1px solid ' + GR + ';border-radius:8px;padding:12px;margin-bottom:16px;">' +
    '<div style="font-size:10px;color:' + GT + ';font-weight:800;text-transform:uppercase;margin-bottom:8px;">' +
    e(type === "TASK" ? "Task Details" : "Repair Details") + '</div>' +
    '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;">' +
    '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;width:110px;font-weight:700;">' + e(detailLabel) + '</td>' +
    '<td style="font-size:13px;font-weight:700;">' + e(detailValue) + '</td></tr>';

  if (type === "REPAIR" && approved !== undefined && approved !== null && approved !== "") {
    var approvedStr = (approved === true || String(approved).toUpperCase() === "TRUE" || approved === "Yes") ? "Yes" : "No";
    html += '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;font-weight:700;">Approved</td>' +
      '<td style="font-size:13px;font-weight:600;">' + e(approvedStr) + '</td></tr>';
  }

  if (notesValue) {
    html += '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;vertical-align:top;font-weight:700;">' + e(notesLabel) + '</td>' +
      '<td style="font-size:13px;">' + e(notesValue) + '</td></tr>';
  }

  if (photosUrl) {
    html += '<tr><td style="font-size:11px;color:' + GT + ';padding:3px 0;font-weight:700;">Photos</td>' +
      '<td><a href="' + e(photosUrl) + '" style="font-size:12px;color:' + O + ';font-weight:600;">Open Photos Folder</a></td></tr>';
  }

  html += '</table></div>' +

    // ===== ITEM DETAILS TABLE =====
    '<div style="font-size:10px;color:' + GT + ';font-weight:800;text-transform:uppercase;margin-bottom:6px;">Item Details</div>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + GR + ';border-radius:8px;overflow:hidden;margin-bottom:20px;">' +
    '<tr style="background:' + O + ';">' +
    '<th style="padding:6px 8px;font-size:10px;color:#fff;font-weight:700;text-align:left;">Item ID</th>' +
    '<th style="padding:6px 8px;font-size:10px;color:#fff;font-weight:700;text-align:center;">Qty</th>' +
    '<th style="padding:6px 8px;font-size:10px;color:#fff;font-weight:700;text-align:left;">Vendor</th>' +
    '<th style="padding:6px 8px;font-size:10px;color:#fff;font-weight:700;text-align:left;">Description</th>' +
    '<th style="padding:6px 8px;font-size:10px;color:#fff;font-weight:700;text-align:left;">Sidemark</th>' +
    '<th style="padding:6px 8px;font-size:10px;color:#fff;font-weight:700;text-align:left;">Room</th>' +
    '</tr>' +
    '<tr>' +
    '<td style="padding:8px;font-size:12px;border-bottom:1px solid ' + GR + ';font-weight:700;">' + e(item.itemId || "") + '</td>' +
    '<td style="padding:8px;font-size:12px;border-bottom:1px solid ' + GR + ';text-align:center;">' + e(String(item.qty || "1")) + '</td>' +
    '<td style="padding:8px;font-size:12px;border-bottom:1px solid ' + GR + ';">' + e(item.vendor || "") + '</td>' +
    '<td style="padding:8px;font-size:12px;border-bottom:1px solid ' + GR + ';">' + e(item.description || "") + '</td>' +
    '<td style="padding:8px;font-size:12px;border-bottom:1px solid ' + GR + ';">' + e(item.sidemark || "") + '</td>' +
    '<td style="padding:8px;font-size:12px;border-bottom:1px solid ' + GR + ';">' + e(item.room || "") + '</td>' +
    '</tr></table>' +

    // ===== WAREHOUSE USE SECTION =====
    '<div style="border:2px solid ' + N + ';border-radius:8px;padding:16px;margin-bottom:16px;">' +
    '<div style="font-size:12px;font-weight:900;text-transform:uppercase;color:' + N + ';margin-bottom:14px;border-bottom:2px solid ' + GR + ';padding-bottom:6px;">Warehouse Use Only</div>' +

    '<table width="100%" cellpadding="0" cellspacing="0" border="0">' +
    '<tr>' +
    '<td style="width:50%;padding-bottom:20px;">' +
    '<span style="font-size:11px;font-weight:700;color:' + GT + ';">Completed By:</span> ' +
    '<span style="display:inline-block;width:180px;border-bottom:1px solid ' + N + ';">&nbsp;</span></td>' +
    '<td style="width:50%;padding-bottom:20px;text-align:right;">' +
    '<span style="font-size:11px;font-weight:700;color:' + GT + ';">Date:</span> ' +
    '<span style="display:inline-block;width:150px;border-bottom:1px solid ' + N + ';">&nbsp;</span></td>' +
    '</tr></table>' +

    '<div style="margin-bottom:16px;">' +
    '<span style="font-size:11px;font-weight:700;color:' + GT + ';">' + e(resultLabel) + ':</span>&nbsp;&nbsp;&nbsp;';

  var options = resultOpts.split("/");
  for (var oi = 0; oi < options.length; oi++) {
    html += '<span style="font-size:13px;margin-right:20px;">&#9744; ' + e(options[oi].trim()) + '</span>';
  }

  html += '</div>' +

    '<div style="margin-bottom:6px;"><span style="font-size:11px;font-weight:700;color:' + GT + ';">Notes:</span></div>' +
    '<div style="border-bottom:1px solid ' + GR + ';height:20px;margin-bottom:8px;">&nbsp;</div>' +
    '<div style="border-bottom:1px solid ' + GR + ';height:20px;margin-bottom:8px;">&nbsp;</div>' +
    '<div style="border-bottom:1px solid ' + GR + ';height:20px;">&nbsp;</div>' +

    '</div>' +

    // ===== FOOTER =====
    '<div style="text-align:center;font-size:10px;color:' + GT + ';border-top:1px solid ' + GR + ';padding-top:8px;">' +
    'Stride Logistics &middot; 206-550-1848 &middot; whse@stridenw.com' +
    '</div>' +

    '</div></body></html>';

  return html;
}

/**
 * Creates a new repair row in the Repairs tab from Inventory data.
 * Called when "Create Repair Quote" checkbox is checked on Inventory.
 */
function createRepairRowFromInventory_(payload) {
  var ss = SpreadsheetApp.getActive();
  var repairs = ss.getSheetByName(CI_SH.REPAIRS);
  if (!repairs) return;
  var map = getHeaderMap_(repairs);
  var repairId = "RPR-" + payload.itemId + "-" +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss");

  // Issue 48: Look up the most recent inspection task notes for this item
  if (!payload.taskNotes) {
    try {
      var tasksSh = ss.getSheetByName(CI_SH.TASKS);
      if (tasksSh && tasksSh.getLastRow() >= 2) {
        var tData = tasksSh.getDataRange().getValues();
        var tHdr = {};
        tData[0].forEach(function(h, i) { tHdr[String(h || "").trim()] = i; });
        var tItemCol = tHdr["Item ID"];
        var tTypeCol = tHdr["Type"];
        var tNotesCol = tHdr["Task Notes"];
        if (tItemCol !== undefined && tNotesCol !== undefined) {
          // Scan from bottom to find most recent task for this item
          for (var ti = tData.length - 1; ti >= 1; ti--) {
            if (String(tData[ti][tItemCol] || "").trim() === payload.itemId) {
              var tn = String(tData[ti][tNotesCol] || "").trim();
              if (tn) { payload.taskNotes = tn; break; }
            }
          }
        }
      }
    } catch (_) {}
  }
  var createdBy = "";
  try { createdBy = Session.getActiveUser().getEmail(); } catch (e) { createdBy = ""; }
  var now = new Date();
  var inspectionPhotosUrl = payload.inspectionPhotosUrl || "";
  var rowValues = buildRowFromMap_(map, {
    "Repair ID": repairId,
    "Item ID": payload.itemId,
    "Description": payload.description || "",
    "Class": payload.itemClass || "",
    "Vendor": payload.vendor || "",
    "Location": payload.location || "",
    "Sidemark": payload.sidemark || "",
    "Task Notes": payload.taskNotes || payload.itemNotes || "",
    "Created By": createdBy,
    "Created Date": now,
    "Quote Amount": "",
    "Quote Sent Date": "",
    "Status": REPAIR_STATUS.PENDING_QUOTE,
    "Approved": "",
    "Scheduled Date": "",
    "Repair Vendor": "",
    "Parts Cost": "",
    "Labor Hours": "",
    "Repair Result": "",
    "Final Amount": "",
    "Invoice ID": "",
    "Item Notes": payload.itemNotes || "",
    "Repair Notes": "",
    "Completed Date": ""
  });
  var insertRow = getLastDataRow_(repairs) + 1;
  repairs.getRange(insertRow, 1, 1, rowValues.length).setValues([rowValues]);

  // v3.1.0: Create repair folder in Repairs/ subfolder (flat structure, independent of item folder)
  try {
    var repairsParent = getOrCreateEntitySubfolder_(ss, "Repairs");
    if (repairsParent && repairId) {
      var repFolderName = repairId;
      var repIt = repairsParent.getFoldersByName(repFolderName);
      var repFolder = repIt.hasNext() ? repIt.next() : repairsParent.createFolder(repFolderName);
      var repairFolderUrl = repFolder.getUrl();
      if (repairFolderUrl && map["Repair ID"]) {
        var rt = SpreadsheetApp.newRichTextValue().setText(repairId).setLinkUrl(repairFolderUrl).build();
        repairs.getRange(insertRow, map["Repair ID"]).setRichTextValue(rt);
      }
    }
  } catch (folderErr) {
    Logger.log("createRepairRowFromInventory_ folder error: " + folderErr);
  }
}

/**
 * v2.5.1: Cancels the most recent open repair for an item when
 * the "Create Task" checkbox is unchecked with Task Type = REPAIR.
 * Finds the last repair by Item ID with a non-terminal status and
 * sets it to Cancelled + stamps Completed Date.
 */
function cancelRepairFromInventory_(itemId) {
  if (!itemId) return;
  var ss = SpreadsheetApp.getActive();
  var repairs = ss.getSheetByName(CI_SH.REPAIRS);
  if (!repairs) return;
  var map = getHeaderMap_(repairs);
  var last = repairs.getLastRow();
  if (last < 2) return;
  var itemIdCol = map["Item ID"];
  var statusCol = map["Status"];
  var completedCol = map["Completed Date"];
  if (!itemIdCol || !statusCol) return;

  // Terminal statuses that should not be cancelled
  var terminal = [
    REPAIR_STATUS.COMPLETE,
    REPAIR_STATUS.CANCELLED,
    REPAIR_STATUS.DECLINED
  ];

  var data = repairs.getRange(2, 1, last - 1, repairs.getLastColumn()).getValues();
  // Search from bottom (most recent) to top
  for (var i = data.length - 1; i >= 0; i--) {
    var rowItemId = String(data[i][itemIdCol - 1] || "").trim();
    var rowStatus = String(data[i][statusCol - 1] || "").trim();
    if (rowItemId === String(itemId).trim() && terminal.indexOf(rowStatus) === -1) {
      var dataRow = i + 2; // offset for header row
      repairs.getRange(dataRow, statusCol).setValue(REPAIR_STATUS.CANCELLED);
      if (completedCol) {
        repairs.getRange(dataRow, completedCol).setValue(new Date());
      }
      Logger.log("cancelRepairFromInventory_: cancelled repair at row " + dataRow + " for item " + itemId);
      return;
    }
  }
  Logger.log("cancelRepairFromInventory_: no open repair found for item " + itemId);
}
