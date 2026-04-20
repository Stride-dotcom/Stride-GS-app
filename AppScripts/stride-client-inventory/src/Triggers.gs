/* ===================================================
   Triggers.gs — v4.7.1 — 2026-04-16 PST — Repair quote "VIEW INSPECTION PHOTOS" points to Source Task folder
   v4.7.1: FIX — processRepairQuoteById_ was falling back to the Item folder
           for the {{PHOTOS_BUTTON}} URL because the Source Task ID column
           stores plain text, not a hyperlink. Added a fourth tier that
           looks up the Source Task row in the Tasks sheet and reads the
           Task ID cell's hyperlink (set by startTask_ to the task's Drive
           folder). The email's button now opens the inspection task folder
           where the damage was actually documented.
   v4.7.0: Added SH_buildSidemarkHeader_ helper. INSP_EMAIL / TASK_COMPLETE /
           REPAIR_COMPLETE / REPAIR_QUOTE / WILL_CALL_CANCELLED now emit
           {{SIDEMARK}} + {{SIDEMARK_HEADER}} tokens so the Project/Sidemark chip
           renders at the top of each email. Operators + clients can see
           which project an email references without scanning the items table.
   v4.6.0: Email CTA URLs changed from #/tasks/ID to #/tasks?open=ID&client=SHEETID
           (same for repairs + will-calls). Lands on list page; session-65 handlers
           auto-select client + auto-open detail panel. Fixes user report where
           clicking the email CTA landed on empty list with nothing selected.
   v4.5.0 — 2026-04-15 10:00 AM PST
   v4.4.0: Discount range widened from ±10 to ±100 in SH_WriteBillingRow_
           helper so Task Board → client billing writes apply premium
           surcharges correctly.
   =================================================== */

/* ============================================================
TRIGGERS
============================================================ */
function StrideClientInstallTriggers() {
var ss = SpreadsheetApp.getActive();
var editFns = ["onClientEdit","onTaskEdit_","onRepairEdit_","onShipmentEdit_","onWillCallEdit_"];
var timedFn = "reconcilePendingTasks_";
var allFns = editFns.concat([timedFn]);
ScriptApp.getProjectTriggers().forEach(function(t) {
if (allFns.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
});
editFns.forEach(function(fn) {
ScriptApp.newTrigger(fn).forSpreadsheet(ss).onEdit().create();
});
// v4.0.0: reconcilePendingTasks_ timer removed — task creation now uses batch menu actions
// The function still exists as a self-destruct stub to clean up old triggers
safeAlert_("Triggers installed: 5 edit triggers. Task creation via Stride Warehouse menu.");
}

/**
 * v4.0.0: reconcilePendingTasks_ — decommissioned.
 * Task creation checkboxes removed from Inventory in v4.0.0.
 * Task creation now uses menu-driven batch actions.
 * This function self-removes its trigger on next execution.
 */
function reconcilePendingTasks_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "reconcilePendingTasks_") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    Logger.log("reconcilePendingTasks_: decommissioned (v4.0.0 — task creation moved to batch menu)");
  } catch (_) {}
}
/* ============================================================
EDIT HANDLERS
============================================================ */
/**
* v4.0.0: Watches Inventory sheet.
* - Release Date entered -> auto-flip Status to "Released"
* - Create Repair Quote checkbox -> create repair row
* - Field sync (Item Notes, Location, etc.) -> propagate to Tasks/Repairs
* NOTE: Needs Inspection / Needs Assembly / Create Task / Task Type
*       checkbox handlers REMOVED in v4.0.0. Task creation now uses
*       menu-driven batch actions (Stride Warehouse menu).
*/
function onClientEdit(e) {
try {
if (!e || !e.range) return;
var sh = e.range.getSheet();
if (sh.getName() !== CI_SH.INVENTORY) return;
var map = getHeaderMap_(sh);
var editedCol = e.range.getColumn();
var editedRow = e.range.getRow();
if (editedRow < 2) return;

    // v4.0.2: Release Date onEdit handler removed — use "Set Release Date" menu action instead

// v2.5.0: Create Repair Quote checkbox -> create repair row
    var colRepairQuote = map["Create Repair Quote"];
    if (colRepairQuote && editedCol === colRepairQuote) {
      var repairEnabled = truthy_(e.value);
      if (repairEnabled) {
        var rowValsRQ = sh.getRange(editedRow, 1, 1, sh.getLastColumn()).getValues()[0];
        var itemIdRQ = getCellByHeader_(rowValsRQ, map, "Item ID");
        if (itemIdRQ) {
          var inspPhotosUrl = ""; // v2.6.4: Photos URL now read from Repair ID hyperlink
          createRepairRowFromInventory_({
            itemId: itemIdRQ,
            description: getCellByHeader_(rowValsRQ, map, "Description"),
            itemClass: getCellByHeader_(rowValsRQ, map, "Class"),
            vendor: getCellByHeader_(rowValsRQ, map, "Vendor"),
            location: getCellByHeader_(rowValsRQ, map, "Location"),
            sidemark: getCellByHeader_(rowValsRQ, map, "Sidemark") || "",
            inspectionPhotosUrl: inspPhotosUrl,
            itemNotes: getCellByHeader_(rowValsRQ, map, "Item Notes") || ""
          });
        // v2.5.0: Send internal alert email for repair quote request
        try {
          var rqSs = SpreadsheetApp.getActive();
          var rqNotifOn = truthy_(getSetting_(rqSs, CI_SETTINGS_KEYS.ENABLE_NOTIFICATIONS));
          if (rqNotifOn) {
            var rqNotifEmails = getSetting_(rqSs, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS);
            var rqClientName = getSetting_(rqSs, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
            var rqDesc = getCellByHeader_(rowValsRQ, map, "Description") || "-";
            var rqLocation = getCellByHeader_(rowValsRQ, map, "Location") || "-";
            var rqSidemark = getCellByHeader_(rowValsRQ, map, "Sidemark") || "-";
            var rqInvLookup = findInventoryRowByItemId_(rqSs, itemIdRQ);
            var rqTableHtml = buildSingleItemTableHtml_(rqInvLookup, itemIdRQ);
            if (rqNotifEmails) {
              var rqPhotosUrl = getItemFolderUrl_(rqSs, itemIdRQ) || "";
              sendTemplateEmail_(rqSs, "REPAIR_QUOTE_REQUEST", rqNotifEmails, {
                "{{ITEM_ID}}": itemIdRQ,
                "{{CLIENT_NAME}}": rqClientName,
                "{{DESCRIPTION}}": rqDesc,
                "{{LOCATION}}": rqLocation,
                "{{SIDEMARK}}": rqSidemark,
                "{{ITEM_TABLE_HTML}}": rqTableHtml,
                "{{PHOTOS_URL}}": rqPhotosUrl
              });
            }
          }
        } catch (emailErr) {
          Logger.log("Repair quote request email failed: " + emailErr);
        }
        }
      }
      return;
    }


    // v2.6.0: Propagate item-level field changes from Inventory to Tasks and Repairs
    // Matches spec: Item Notes, Task Notes, Repair Notes, Assigned To, Repair Vendor, Repair Result, Scheduled Date, Status
    var INVENTORY_SYNC_FIELDS = ["Item Notes", "Task Notes", "Repair Notes", "Assigned To", "Repair Vendor", "Repair Result", "Scheduled Date", "Status", "Location", "Vendor", "Description"];
    var editedHeader = null;
    for (var sf = 0; sf < INVENTORY_SYNC_FIELDS.length; sf++) {
      var syncCol = map[INVENTORY_SYNC_FIELDS[sf]];
      if (syncCol && editedCol === syncCol) { editedHeader = INVENTORY_SYNC_FIELDS[sf]; break; }
    }
    if (editedHeader) {
      var rowValsSync = sh.getRange(editedRow, 1, 1, sh.getLastColumn()).getValues()[0];
      var itemIdSync = getCellByHeader_(rowValsSync, map, "Item ID");
      var newVal = String(e.value || "");
      if (itemIdSync) {
        var ssSync = SpreadsheetApp.getActive();
        // Update matching Tasks rows
        var tsh = ssSync.getSheetByName(CI_SH.TASKS);
        if (tsh) {
          var tMap = getHeaderMap_(tsh);
          var tItemCol = tMap["Item ID"];
          var tTargetCol = tMap[editedHeader];
          if (tItemCol && tTargetCol) {
            var tLast = tsh.getLastRow();
            if (tLast >= 2) {
              var tIds = tsh.getRange(2, tItemCol, tLast - 1, 1).getValues().flat().map(String);
              for (var ti = 0; ti < tIds.length; ti++) {
                if (tIds[ti] === String(itemIdSync)) tsh.getRange(ti + 2, tTargetCol).setValue(newVal);
              }
            }
          }
        }
        // Update matching Repairs rows
        var rsh = ssSync.getSheetByName(CI_SH.REPAIRS);
        if (rsh) {
          var rMap = getHeaderMap_(rsh);
          var rItemCol = rMap["Item ID"];
          var rTargetCol = rMap[editedHeader];
          if (rItemCol && rTargetCol) {
            var rLast = rsh.getLastRow();
            if (rLast >= 2) {
              var rIds = rsh.getRange(2, rItemCol, rLast - 1, 1).getValues().flat().map(String);
              for (var ri = 0; ri < rIds.length; ri++) {
                if (rIds[ri] === String(itemIdSync)) rsh.getRange(ri + 2, rTargetCol).setValue(newVal);
              }
            }
          }
        }
      }
      return;
    }

    // v4.0.0: Needs Inspection / Needs Assembly / Create Task handlers removed.
    // Task creation now uses batch menu actions.
} catch (err) {
Logger.log("onClientEdit error: " + err);
}
}
/**
* Watches Tasks sheet.
* When Result column is filled on an Open task:
* 1) Marks task Complete + stamps Completed At
* 2) Looks up rate from Master Price List
* 3) Checks BillIfPASS / BillIfFAIL flags
* 4) Writes a Billing_Ledger row if billable
* 5) Sends inspection email (staff + client)
 * 6) [Removed in v2.5.0] Needs Repair path removed — repairs now created from Inventory
*
* Idempotency: exits early if Status is Completed/Cancelled OR Billed is true.

/**
 * v1.2.0: Reverse-sync item-level fields from Tasks/Repairs back to Inventory.
 */
// Map field names from Tasks/Repairs to their Inventory equivalents
// v2.7.0: "Task Notes" removed — Inventory Task Notes is now a computed aggregation (SH_updateInventoryTaskNotes_)
var FIELD_NAME_TO_INVENTORY_ = {
  "Repair Notes": "Item Notes"
};
function syncFieldToInventory_(itemId, fieldName, newValue) {
  if (!itemId || !fieldName) return;
  try {
    var ss = SpreadsheetApp.getActive();
    var inv = ss.getSheetByName(CI_SH.INVENTORY);
    if (!inv) return;
    var invMap = getHeaderMap_(inv);
    var invItemCol = invMap["Item ID"];
    // Map field name to inventory equivalent if needed
    var invFieldName = FIELD_NAME_TO_INVENTORY_[fieldName] || fieldName;
    var invTargetCol = invMap[invFieldName];
    if (!invItemCol || !invTargetCol) return;
    var invLast = inv.getLastRow();
    if (invLast < 2) return;
    var invIds = inv.getRange(2, invItemCol, invLast - 1, 1).getValues().flat().map(String);
    for (var ii = 0; ii < invIds.length; ii++) {
      if (invIds[ii] === String(itemId)) {
        inv.getRange(ii + 2, invTargetCol).setValue(newValue);
        break;
      }
    }
  } catch (err) { Logger.log("syncFieldToInventory_ error: " + err); }
}
// v2.6.0: Bidirectional sync fields — Tasks/Repairs back to Inventory
// Matches spec: Item Notes, Task Notes, Repair Notes, Assigned To, Repair Vendor, Repair Result, Scheduled Date, Status
var ITEM_LEVEL_SYNC_FIELDS_ = {"Item Notes": true, "Task Notes": true, "Repair Notes": true, "Assigned To": true, "Repair Vendor": true, "Repair Result": true, "Scheduled Date": true, "Status": true, "Location": true, "Vendor": true, "Description": true};

/* =====================================================================
   SHARED HANDLERS v1.0.0 (keep in sync with task board script)
   Parity-controlled duplicated block. MUST be identical in:
     - inventory code.gs.txt (Client Inventory)
     - task board script.txt (Task Board)
   Any change requires:
     1. Increment SHARED_HANDLER_VERSION in BOTH files
     2. Copy updated shared handler section to BOTH files
     3. Verify parity: diff shared sections
     4. Deployment instructions ALWAYS list BOTH files
   ===================================================================== */
var SHARED_HANDLER_VERSION = "1.1.0";

/* --- SH_ helpers (prefixed to avoid collision with script-local functions) --- */

function SH_headerMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").trim();
    if (h && !map[h]) map[h] = i + 1;
  }
  return map;
}

function SH_getSetting_(ss, key) {
  var sh = ss.getSheetByName("Settings");
  if (!sh) return "";
  var data = sh.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0] || "").trim() === key) return data[i][1];
  }
  return "";
}

function SH_findRowById_(sheet, idColNum, idValue) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var data = sheet.getRange(2, idColNum, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0] || "").trim() === String(idValue).trim()) return i + 2;
  }
  return -1;
}

function SH_truthy_(v) {
  var s = String(v || "").toLowerCase().trim();
  return s === "true" || s === "yes" || s === "1" || s === "y" || s === "on";
}

function SH_esc_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function SH_formatCurrency_(v) {
  var n = Number(v);
  return isFinite(n) ? n.toFixed(2) : String(v || "0");
}

function SH_mergeEmails_() {
  var all = [];
  for (var i = 0; i < arguments.length; i++) {
    var s = String(arguments[i] || "").trim();
    if (s) s.split(",").forEach(function(e) { var t = e.trim(); if (t && all.indexOf(t) === -1) all.push(t); });
  }
  return all.join(",");
}

function SH_getLastDataRow_(sheet) {
  var lr = sheet.getLastRow();
  if (lr < 2) return 1;
  var scanCols = Math.min(3, sheet.getLastColumn());
  var data = sheet.getRange(2, 1, lr - 1, scanCols).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    for (var c = 0; c < scanCols; c++) {
      if (data[i][c] === false) continue;
      if (String(data[i][c] || "").trim() !== "") return i + 2;
    }
  }
  return 1;
}

function SH_findInventoryItem_(ss, itemId) {
  var inv = ss.getSheetByName("Inventory");
  if (!inv || inv.getLastRow() < 2) return null;
  var data = inv.getDataRange().getValues();
  var hdr = {};
  data[0].forEach(function(h, i) { hdr[String(h || "").trim()] = i; });
  var itemCol = hdr["Item ID"];
  if (itemCol === undefined) return null;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][itemCol] || "").trim() === String(itemId).trim()) {
      return {
        description: hdr["Description"] !== undefined ? String(data[r][hdr["Description"]] || "") : "",
        itemClass: hdr["Class"] !== undefined ? String(data[r][hdr["Class"]] || "") : "",
        vendor: hdr["Vendor"] !== undefined ? String(data[r][hdr["Vendor"]] || "") : "",
        location: hdr["Location"] !== undefined ? String(data[r][hdr["Location"]] || "") : "",
        sidemark: hdr["Sidemark"] !== undefined ? String(data[r][hdr["Sidemark"]] || "") : "",
        shipNo: hdr["Shipment #"] !== undefined ? String(data[r][hdr["Shipment #"]] || "") : "",
        qty: hdr["Qty"] !== undefined ? data[r][hdr["Qty"]] : "",
        room: hdr["Room"] !== undefined ? String(data[r][hdr["Room"]] || "") : "",
        row: r + 1,
        _raw: data[r],
        _hdr: hdr
      };
    }
  }
  return null;
}

function SH_lookupRate_(ss, svcCode, itemClass) {
  var result = { rate: 0, svcName: svcCode, category: "", billIfPass: true, billIfFail: true };
  var pc = ss.getSheetByName("Price_Cache");
  if (!pc || pc.getLastRow() < 2) return result;
  var data = pc.getDataRange().getValues();
  var hdr = {};
  data[0].forEach(function(h, i) { hdr[String(h || "").trim().toUpperCase()] = i; });
  var codeCol = hdr["SERVICE CODE"] !== undefined ? hdr["SERVICE CODE"] : hdr["SVC CODE"];
  var nameCol = hdr["SERVICE NAME"] !== undefined ? hdr["SERVICE NAME"] : hdr["SVC NAME"];
  var catCol = hdr["CATEGORY"];
  var rateCol = hdr[(itemClass || "").toUpperCase() + " RATE"];
  var passCol = hdr["BILL IF PASS"];
  var failCol = hdr["BILL IF FAIL"];
  if (codeCol === undefined) return result;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][codeCol] || "").trim().toUpperCase() === svcCode.toUpperCase()) {
      if (nameCol !== undefined) result.svcName = String(data[r][nameCol] || "").trim() || svcCode;
      if (catCol !== undefined) result.category = String(data[r][catCol] || "").trim();
      if (rateCol !== undefined) result.rate = Number(data[r][rateCol] || 0) || 0;
      if (passCol !== undefined) result.billIfPass = SH_truthy_(data[r][passCol]);
      if (failCol !== undefined) result.billIfFail = SH_truthy_(data[r][failCol]);
      break;
    }
  }
  return result;
}

function SH_getItemFolderUrl_(ss, itemId) {
  var inv = ss.getSheetByName("Inventory");
  if (!inv || inv.getLastRow() < 2) return "";
  var hdr = SH_headerMap_(inv);
  var itemCol = hdr["Item ID"];
  if (!itemCol) return "";
  var lastRow = inv.getLastRow();
  var ids = inv.getRange(2, itemCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === String(itemId).trim()) {
      try {
        var rt = inv.getRange(i + 2, itemCol).getRichTextValue();
        if (rt && rt.getLinkUrl()) return rt.getLinkUrl();
      } catch (_) {}
      return "";
    }
  }
  return "";
}

function SH_findPdfInFolder_(folderUrl, namePrefix) {
  if (!folderUrl || folderUrl.indexOf("http") !== 0) return null;
  try {
    var folderId = String(folderUrl).match(/[-\w]{25,}/);
    if (!folderId) return null;
    var folder = DriveApp.getFolderById(folderId[0]);
    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName().indexOf(namePrefix) === 0) return f.getBlob();
    }
  } catch (_) {}
  return null;
}

/**
 * v4.4.0 — Build a conditional Sidemark header block for client-facing alert emails.
 * Empty string when sidemark is blank (so templates with `{{SIDEMARK_HEADER}}` don't
 * render an empty label). Used by INSP_EMAIL, TASK_COMPLETE, REPAIR_QUOTE,
 * REPAIR_COMPLETE, SHIPMENT_RECEIVED, WILL_CALL_* templates.
 */
function SH_buildSidemarkHeader_(sidemark) {
  var s = String(sidemark || "").trim();
  if (!s) return "";
  return '<div style="background:#FEF3E8;border:1px solid #F9C79F;border-radius:8px;padding:10px 14px;margin:0 0 14px 0;font-size:13px;color:#7C2D12"><span style="font-weight:800;color:#E85D2D;text-transform:uppercase;letter-spacing:0.04em;font-size:11px">Project / Sidemark:</span> <span style="font-weight:700;color:#1E293B;font-size:14px">' + SH_esc_(s) + '</span></div>';
}

function SH_buildItemTableHtml_(ss, itemId, fallbackDesc) {
  if (!itemId) return '<p style="color:#94a3b8;font-size:13px"><em>Item details unavailable</em></p>';
  try {
    var inv = ss.getSheetByName("Inventory");
    if (inv && inv.getLastRow() >= 2) {
      var data = inv.getDataRange().getValues();
      var hdr = {};
      data[0].forEach(function(h, i) { hdr[String(h || "").trim()] = i; });
      var itemCol = hdr["Item ID"];
      if (itemCol !== undefined) {
        for (var r = 1; r < data.length; r++) {
          if (String(data[r][itemCol] || "").trim() === String(itemId).trim()) {
            var cols = ["Item ID", "Qty", "Vendor", "Description", "Sidemark", "Room"];
            var vals = [SH_esc_(itemId)];
            for (var ci = 1; ci < cols.length; ci++) {
              vals.push(SH_esc_(hdr[cols[ci]] !== undefined ? String(data[r][hdr[cols[ci]]] || "") : ""));
            }
            var html = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr>';
            for (var c = 0; c < cols.length; c++) html += '<td style="padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;font-size:13px">' + cols[c] + '</td>';
            html += '</tr><tr>';
            for (var v = 0; v < vals.length; v++) html += '<td style="padding:6px 12px;border:1px solid #e2e8f0;font-size:13px">' + vals[v] + '</td>';
            html += '</tr></table>';
            return html;
          }
        }
      }
    }
  } catch (_) {}
  return '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
    '<td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Item ID</div><div style="font-size:14px;font-weight:800">' + SH_esc_(itemId) + '</div></td>' +
    '<td style="vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Description</div><div style="font-size:14px;font-weight:600">' + SH_esc_(fallbackDesc || "-") + '</div></td></tr></table>';
}

function SH_writeBillingRow_(ss, payload) {
  try {
    var blSheet = ss.getSheetByName("Billing_Ledger");
    if (!blSheet) return { success: false, error: "Billing_Ledger sheet not found" };
    var headers = blSheet.getRange(1, 1, 1, blSheet.getLastColumn()).getValues()[0];
    var blMap = {};
    headers.forEach(function(h, i) { blMap[String(h || "").trim().toUpperCase()] = i; });
    var leidCol = blMap["LEDGER ENTRY ID"];
    if (leidCol !== undefined && payload.ledgerEntryId) {
      var blData = blSheet.getDataRange().getValues();
      for (var d = 1; d < blData.length; d++) {
        if (String(blData[d][leidCol] || "").trim() === payload.ledgerEntryId) {
          return { success: true, ledgerRowId: "", skipped: true };
        }
      }
    }
    var ledgerRowId = "";
    var settingsSh = ss.getSheetByName("Settings");
    if (settingsSh) {
      var sData = settingsSh.getDataRange().getValues();
      for (var s = 0; s < sData.length; s++) {
        if (String(sData[s][0] || "").trim() === "BILLING_LEDGER_COUNTER") {
          var cnt = parseInt(sData[s][1], 10) || 0;
          cnt++;
          settingsSh.getRange(s + 1, 2).setValue(cnt);
          ledgerRowId = "BL-" + String(cnt).padStart(6, "0");
          break;
        }
      }
    }
    var rate = Number(payload.rate || 0);
    var total = rate * (payload.qty || 1);
    if (rate > 0 && payload.category) {
      var cat = String(payload.category).trim().toLowerCase();
      var discKey = (cat === "storage charges" || cat === "storage") ? "DISCOUNT_STORAGE_PCT" : "DISCOUNT_SERVICES_PCT";
      var pct = Number(SH_getSetting_(ss, discKey) || 0);
      // v4.4.0: Convention: negative = discount, positive = surcharge. Range: -100 to +100.
      if (pct !== 0 && pct >= -100 && pct <= 100) {
        total = Math.round(total * (1 + pct / 100) * 100) / 100;
      }
    }
    var row = new Array(headers.length).fill("");
    function setCol(name, val) { var idx = blMap[name.toUpperCase()]; if (idx !== undefined) row[idx] = val != null ? val : ""; }
    setCol("Status", payload.status || "Unbilled");
    setCol("Invoice #", "");
    setCol("Client", payload.client || "");
    setCol("Date", payload.date || new Date());
    setCol("Svc Code", payload.svcCode || "");
    setCol("Svc Name", payload.svcName || "");
    setCol("Category", payload.category || "");
    setCol("Item ID", payload.itemId || "");
    setCol("Description", payload.description || "");
    setCol("Class", payload.itemClass || "");
    setCol("Qty", payload.qty || 1);
    setCol("Rate", rate);
    setCol("Total", payload.totalOverride !== null && payload.totalOverride !== undefined ? payload.totalOverride : total);
    setCol("Task ID", payload.taskId || "");
    setCol("Repair ID", payload.repairId || "");
    setCol("Shipment #", payload.shipNo || "");
    setCol("Item Notes", payload.notes || "");
    setCol("Ledger Row ID", ledgerRowId);
    setCol("Ledger Entry ID", payload.ledgerEntryId || "");
    blSheet.getRange(SH_getLastDataRow_(blSheet) + 1, 1, 1, row.length).setValues([row]);
    return { success: true, ledgerRowId: ledgerRowId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function SH_sendTemplateEmail_(ss, templateKey, toEmails, subject, tokens, pdfBlob) {
  if (!toEmails) return { success: false, error: "No recipients" };
  try {
    var masterId = String(SH_getSetting_(ss, "MASTER_SPREADSHEET_ID") || "").trim();
    var eSubj = subject;
    var eBody = "";
    var tplRecipients = "";
    if (masterId) {
      try {
        var mSS = SpreadsheetApp.openById(masterId);
        var tplSh = mSS.getSheetByName("Email_Templates");
        if (tplSh && tplSh.getLastRow() >= 2) {
          var tplD = tplSh.getDataRange().getValues();
          var tplH = {};
          tplD[0].forEach(function(h, i) { tplH[String(h || "").trim()] = i; });
          var tKC = tplH["Template Key"] !== undefined ? tplH["Template Key"] : 0;
          var tSC = tplH["Subject"] !== undefined ? tplH["Subject"] : 1;
          var tBC = tplH["HTML Body"] !== undefined ? tplH["HTML Body"] : 2;
          var tRC = tplH["Recipients"] !== undefined ? tplH["Recipients"] : -1;
          for (var ti = 1; ti < tplD.length; ti++) {
            if (String(tplD[ti][tKC] || "").trim() === templateKey) {
              eSubj = String(tplD[ti][tSC] || "").trim() || eSubj;
              eBody = String(tplD[ti][tBC] || "").trim();
              if (tRC >= 0) tplRecipients = String(tplD[ti][tRC] || "").trim();
              break;
            }
          }
        }
      } catch (_) {}
    }
    var staffEmails = String(SH_getSetting_(ss, "NOTIFICATION_EMAILS") || "").trim();
    var clientEmail = String(SH_getSetting_(ss, "CLIENT_EMAIL") || "").trim();
    if (tplRecipients) {
      toEmails = tplRecipients.replace(/\{\{STAFF_EMAILS\}\}/gi, staffEmails || "").replace(/\{\{CLIENT_EMAIL\}\}/gi, clientEmail || "");
    }
    if (eBody) {
      var photosUrl = tokens["{{PHOTOS_URL}}"] || "";
      if (!photosUrl || photosUrl === "#" || photosUrl.indexOf("http") !== 0) {
        eBody = eBody.replace(/<a[^>]*\{\{PHOTOS_URL\}\}[^>]*>[^<]*<\/a>/gi, "");
        tokens["{{PHOTOS_URL}}"] = "#";
      }
      for (var tk in tokens) { eSubj = eSubj.split(tk).join(tokens[tk] || ""); eBody = eBody.split(tk).join(tokens[tk] || ""); }
      eBody += '<div style="text-align:center;font-size:8px;color:#CBD5E1;margin-top:4px;">T-SH</div>';
    } else {
      // No template found — per approved plan, do NOT invent fallback email.
      // Skip send, log exception, leave Email Sent At blank for manual resend.
      Logger.log("SH_sendTemplateEmail_: No template found for key '" + templateKey + "'. Skipping send.");
      return { success: false, error: "No template found for " + templateKey + ". Email skipped — resendable via menu." };
    }
    var emailOpts = { htmlBody: eBody, from: "whse@stridenw.com" };
    if (pdfBlob) emailOpts.attachments = [pdfBlob];
    GmailApp.sendEmail(toEmails, eSubj, "", emailOpts);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/* --- Shared PDF Generation Helpers --- */

/**
 * Shared helper: fetch doc template HTML from Master Email_Templates tab.
 * Returns { title, html } or null if not found.
 */
function SH_getDocTemplateHtml_(ss, templateKey) {
  try {
    var masterId = String(SH_getSetting_(ss, "MASTER_SPREADSHEET_ID") || "").trim();
    if (!masterId) return null;
    var master = SpreadsheetApp.openById(masterId);
    var tmplSh = master.getSheetByName("Email_Templates");
    if (!tmplSh || tmplSh.getLastRow() < 2) return null;
    var lastCol = Math.max(tmplSh.getLastColumn(), 6);
    var data = tmplSh.getRange(2, 1, tmplSh.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || "").trim() === templateKey) {
        var html = String(data[i][2] || "").trim();
        if (!html) return null;
        return { title: String(data[i][1] || ""), html: html };
      }
    }
  } catch (err) {
    Logger.log("SH_getDocTemplateHtml_ error for " + templateKey + ": " + err);
  }
  return null;
}

/**
 * Shared helper: hardcoded fallback HTML for DOC_REPAIR_WORK_ORDER.
 */
function SH_getDefaultRepairWorkOrderHtml_() {
  return '<html><head><style>body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:0;padding:0;}table{border-collapse:collapse;width:8in;}</style></head><body><div style="width:8in;margin:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;"><tr><td style="vertical-align:middle;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="{{LOGO_URL}}" alt="Logo" style="height:38px;width:38px;" /></td><td style="vertical-align:middle;"><span style="font-size:20px;font-weight:bold;color:#1E293B;">Stride Logistics </span><span style="font-size:20px;font-weight:bold;color:#E85D2D;">WMS</span><br><span style="font-size:10px;color:#64748B;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</span></td></tr></table></td><td style="text-align:right;vertical-align:middle;"><div style="font-size:20px;font-weight:bold;color:#1E293B;">Work Order</div><div style="font-size:15px;font-weight:bold;color:#E85D2D;margin-top:2px;">{{REPAIR_ID}}</div></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;margin-bottom:14px;"><tr><td style="width:50%;vertical-align:top;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:80px;font-weight:bold;">CLIENT</td><td style="font-size:12px;font-weight:bold;">{{CLIENT_NAME}}</td></tr>{{SIDEMARK_ROW}}</table></td><td style="width:50%;vertical-align:top;"><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;text-align:right;width:65px;font-weight:bold;">DATE</td><td style="font-size:12px;font-weight:bold;text-align:right;">{{DATE}}</td></tr><tr><td style="font-size:10px;color:#64748B;padding:2px 0;text-align:right;font-weight:bold;">STATUS</td><td style="font-size:12px;font-weight:bold;text-align:right;">{{STATUS}}</td></tr></table></td></tr></table><div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:10px 12px;margin-bottom:14px;"><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:6px;">REPAIR DETAILS</div><table cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td style="font-size:10px;color:#64748B;padding:2px 0;width:100px;font-weight:bold;">Repair Type</td><td style="font-size:12px;font-weight:bold;">{{REPAIR_TYPE}}</td></tr>{{APPROVED_ROW}}{{NOTES_ROW}}{{PHOTOS_ROW}}</table></div><div style="font-size:9px;color:#64748B;font-weight:bold;margin-bottom:4px;">ITEM DETAILS</div><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E2E8F0;margin-bottom:16px;"><tr style="background:#E85D2D;"><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Item ID</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:center;width:30px;">Qty</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Vendor</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Description</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Sidemark</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Room</th></tr><tr><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;font-weight:bold;">{{ITEM_ID}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;text-align:center;">{{ITEM_QTY}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_VENDOR}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_DESC}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_SIDEMARK}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_ROOM}}</td></tr></table><div style="border:2px solid #1E293B;padding:14px;margin-bottom:14px;"><div style="font-size:11px;font-weight:bold;color:#1E293B;margin-bottom:10px;border-bottom:2px solid #E2E8F0;padding-bottom:5px;">WAREHOUSE USE ONLY</div><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:50%;padding-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:4px;">Completed By</div><div style="border-bottom:1.5px solid #CBD5E1;height:22px;width:90%;"></div></td><td style="width:50%;padding-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:4px;text-align:right;">Date</div><div style="border-bottom:1.5px solid #CBD5E1;height:22px;width:90%;margin-left:auto;"></div></td></tr></table><div style="margin-bottom:14px;"><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:6px;">Repair Result</div><span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Complete</span><span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Partial</span><span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Unable to Repair</span><span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Other</span></div><div><div style="font-size:10px;font-weight:bold;color:#64748B;margin-bottom:6px;">Notes</div><div style="border-bottom:1px solid #E2E8F0;height:18px;margin-bottom:6px;">&nbsp;</div><div style="border-bottom:1px solid #E2E8F0;height:18px;margin-bottom:6px;">&nbsp;</div><div style="border-bottom:1px solid #E2E8F0;height:18px;">&nbsp;</div></div></div><div style="text-align:center;font-size:9px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:6px;">Stride Logistics &middot; 206-550-1848 &middot; whse@stridenw.com</div></div></body></html>';
}

/**
 * Shared helper: create Google Doc from HTML using Advanced Drive Service.
 * Returns doc ID. Requires Drive Advanced Service enabled.
 */
function SH_createGoogleDocFromHtml_(title, html) {
  var blob = Utilities.newBlob(html, "text/html", title + ".html");
  var tempFile = DriveApp.createFile(blob);
  try {
    var doc = Drive.Files.copy(
      { title: title, mimeType: MimeType.GOOGLE_DOCS },
      tempFile.getId()
    );
    tempFile.setTrashed(true);
    return doc.id;
  } catch (e) {
    try { tempFile.setTrashed(true); } catch (_) {}
    throw new Error("HTML->Doc conversion failed. Enable Advanced Drive Service. Error: " + (e && e.message ? e.message : e));
  }
}

/**
 * Shared helper: export Google Doc as PDF blob with custom margins.
 */
function SH_exportDocAsPdfBlob_(docId, fileName, marginInches) {
  var m = marginInches || 0.25;
  var pts = m * 72;
  try {
    var token = ScriptApp.getOAuthToken();
    var updateUrl = "https://docs.googleapis.com/v1/documents/" + docId + ":batchUpdate";
    UrlFetchApp.fetch(updateUrl, {
      method: "post", contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({ requests: [{ updateDocumentStyle: {
        documentStyle: { marginTop: { magnitude: pts, unit: "PT" }, marginBottom: { magnitude: pts, unit: "PT" },
          marginLeft: { magnitude: pts, unit: "PT" }, marginRight: { magnitude: pts, unit: "PT" } },
        fields: "marginTop,marginBottom,marginLeft,marginRight" } }] }),
      muteHttpExceptions: true
    });
  } catch (marginErr) { Logger.log("SH_exportDocAsPdfBlob_ margin update failed (non-fatal): " + marginErr); }
  var url = "https://docs.google.com/document/d/" + docId + "/export?format=pdf&size=letter&portrait=true&fitw=true&top=" + m + "&bottom=" + m + "&left=" + m + "&right=" + m;
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error("PDF export failed (" + resp.getResponseCode() + ")");
  return resp.getBlob().setName(fileName);
}

/**
 * Shared helper: generate Repair Work Order PDF. Fully portable — works in both scripts.
 * Uses SH_ helpers only. Requires Advanced Drive Service enabled.
 */
function SH_generateRepairWorkOrderPdf_(ss, repairRowData, repairMap, folderUrl) {
  var clientName = String(SH_getSetting_(ss, "CLIENT_NAME") || "Client");
  var logoUrl = String(SH_getSetting_(ss, "LOGO_URL") || "");

  function gv(h) { return repairMap[h] ? String(repairRowData[repairMap[h] - 1] || "").trim() : ""; }
  var repairId = gv("Repair ID");
  var itemId = gv("Item ID");
  var repairType = gv("Description");
  var repairNotes = gv("Repair Notes");
  var taskNotes = gv("Task Notes");
  var status = gv("Status");
  var approved = gv("Approved");
  var createdDate = repairMap["Created Date"] ? repairRowData[repairMap["Created Date"] - 1] : new Date();
  var photosUrl = folderUrl || "";

  var allNotes = "";
  if (taskNotes && repairNotes) allNotes = taskNotes + "\n" + repairNotes;
  else allNotes = taskNotes || repairNotes || "";

  var invItem = SH_findInventoryItem_(ss, itemId);
  var sidemark = invItem ? invItem.sidemark : "";
  var itemQty = invItem ? String(invItem.qty || "1") : "1";
  var itemVendor = invItem ? invItem.vendor : "";
  var itemDesc = invItem ? invItem.description : "";
  var itemRoom = invItem ? invItem.room : "";

  var dateStr;
  if (createdDate instanceof Date) dateStr = Utilities.formatDate(createdDate, Session.getScriptTimeZone(), "MM/dd/yyyy");
  else { try { dateStr = Utilities.formatDate(new Date(createdDate), Session.getScriptTimeZone(), "MM/dd/yyyy"); } catch(_) { dateStr = String(createdDate || ""); } }

  var approvedStr = "";
  if (approved !== undefined && approved !== null && approved !== "") {
    approvedStr = (approved === "true" || approved === "TRUE" || approved === "Yes") ? "Yes" : "No";
  }

  var e = SH_esc_;
  var tokens = {
    "{{LOGO_URL}}": e(logoUrl), "{{REPAIR_ID}}": e(repairId), "{{CLIENT_NAME}}": e(clientName),
    "{{DATE}}": e(dateStr), "{{SIDEMARK}}": e(sidemark),
    "{{SIDEMARK_ROW}}": sidemark ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">SIDEMARK</td><td style="font-size:12px;">' + e(sidemark) + '</td></tr>' : '',
    "{{STATUS}}": e(status), "{{REPAIR_TYPE}}": e(repairType),
    "{{APPROVED_ROW}}": approvedStr ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Approved</td><td style="font-size:12px;">' + e(approvedStr) + '</td></tr>' : '',
    "{{NOTES_ROW}}": allNotes ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Notes</td><td style="font-size:12px;">' + e(allNotes) + '</td></tr>' : '',
    "{{PHOTOS_ROW}}": photosUrl ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Photos</td><td style="font-size:12px;"><a href="' + e(photosUrl) + '" style="color:#E85D2D;text-decoration:underline;">View Photos</a></td></tr>' : '',
    "{{ITEM_ID}}": e(itemId), "{{ITEM_QTY}}": e(itemQty), "{{ITEM_VENDOR}}": e(itemVendor),
    "{{ITEM_DESC}}": e(itemDesc), "{{ITEM_SIDEMARK}}": e(sidemark), "{{ITEM_ROOM}}": e(itemRoom),
    "{{RESULT_OPTIONS_HTML}}": '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Complete</span><span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Partial</span><span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Unable to Repair</span><span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Other</span>'
  };

  var tplResult = SH_getDocTemplateHtml_(ss, "DOC_REPAIR_WORK_ORDER");
  var html = tplResult ? tplResult.html : SH_getDefaultRepairWorkOrderHtml_();
  // Resolve tokens
  for (var tk in tokens) html = html.split(tk).join(tokens[tk]);

  var docTitle = "Work Order - " + repairId;
  var docId = SH_createGoogleDocFromHtml_(docTitle, html);
  var pdfBlob = SH_exportDocAsPdfBlob_(docId, "Work_Order_" + repairId + ".pdf", 0.25);

  var folderId = String(folderUrl).match(/[-\w]{25,}/);
  if (folderId) DriveApp.getFolderById(folderId[0]).createFile(pdfBlob);
  try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {}
  Logger.log("SH: Repair work order PDF generated: " + repairId);
}

/* --- Main Shared Handlers --- */

function processTaskCompletionById_(srcSs, taskId, resultValue) {
  var out = { success: false, skipped: false, error: "", billingCreated: false, billingException: "", emailSent: false, emailException: "", pdfFound: false, repairCreated: false };
  var completeLock = null; // v4.2.0: race condition guard
  try {
    var taskSheet = srcSs.getSheetByName("Tasks");
    if (!taskSheet) { out.error = "Tasks sheet not found"; return out; }
    var map = SH_headerMap_(taskSheet);
    var idCol = map["Task ID"];
    if (!idCol) { out.error = "Task ID column not found"; return out; }
    var row = SH_findRowById_(taskSheet, idCol, taskId);
    if (row < 2) { out.error = "Task not found: " + taskId; return out; }
    var rowData = taskSheet.getRange(row, 1, 1, taskSheet.getLastColumn()).getValues()[0];
    function getVal(h) { return map[h] ? String(rowData[map[h] - 1] || "").trim() : ""; }
    var processedAt = getVal("Completion Processed At");
    if (processedAt) { out.success = true; out.skipped = true; return out; }

    // v4.2.0: Race condition guard — acquire lock before writing
    completeLock = LockService.getScriptLock();
    try { completeLock.waitLock(10000); } catch (lockErr) {
      out.error = "Another task completion is in progress. Please wait and try again.";
      return out;
    }
    // Re-check idempotency INSIDE lock (concurrent request guard)
    var freshRowData = taskSheet.getRange(row, 1, 1, taskSheet.getLastColumn()).getValues()[0];
    function getFreshVal(h) { return map[h] ? String(freshRowData[map[h] - 1] || "").trim() : ""; }
    if (getFreshVal("Completion Processed At")) {
      completeLock.releaseLock(); out.success = true; out.skipped = true; return out;
    }

    var now = new Date();
    var tz = Session.getScriptTimeZone();
    var nowFmt = Utilities.formatDate(now, tz, "MM/dd/yyyy HH:mm:ss");
    if (map["Completion Started At"]) taskSheet.getRange(row, map["Completion Started At"]).setValue(nowFmt);
    var currentStatus = getFreshVal("Status");
    if (currentStatus === "Completed" || currentStatus === "Cancelled") {
      completeLock.releaseLock(); out.success = true; out.skipped = true;
      if (map["Completion Processed At"]) taskSheet.getRange(row, map["Completion Processed At"]).setValue(nowFmt);
      return out;
    }
    if (map["Status"]) taskSheet.getRange(row, map["Status"]).setValue("Completed");
    if (map["Completed At"]) taskSheet.getRange(row, map["Completed At"]).setValue(now);
    var svcCode = getVal("Svc Code") || getVal("Type");
    if (map["Svc Code"] && !getVal("Svc Code")) taskSheet.getRange(row, map["Svc Code"]).setValue(svcCode);
    var itemId = getVal("Item ID");
    if (!itemId) { out.error = "Item ID is empty on task row"; return out; }
    var invItem = SH_findInventoryItem_(srcSs, itemId);
    if (!invItem) { out.error = "Item not found in Inventory: " + itemId; return out; }
    var taskType = getVal("Type");
    var shipNo = getVal("Shipment #");
    var taskNotes = getVal("Task Notes");
    var photosUrl = "";
    if (map["Task ID"]) { try { var rt = taskSheet.getRange(row, map["Task ID"]).getRichTextValue(); if (rt) photosUrl = rt.getLinkUrl() || ""; } catch (_) {} }
    if (!photosUrl) photosUrl = SH_getItemFolderUrl_(srcSs, itemId) || "";
    var rateData = SH_lookupRate_(srcSs, svcCode, invItem.itemClass);
    var resultToCheck = resultValue ? resultValue : "Pass";
    var isPASS = (resultToCheck === "Pass" || resultToCheck === "PASS");
    var isFAIL = (resultToCheck === "Fail" || resultToCheck === "FAIL");
    var shouldBill = (isPASS && rateData.billIfPass) || (isFAIL && rateData.billIfFail);
    if (shouldBill) {
      var clientName = String(SH_getSetting_(srcSs, "CLIENT_NAME") || "");
      var missingRate = (rateData.rate === 0);
      var billingResult = SH_writeBillingRow_(srcSs, {
        status: "Unbilled", client: clientName, date: now,
        svcCode: svcCode, svcName: rateData.svcName || svcCode, category: rateData.category || "",
        itemId: itemId, description: invItem.description, itemClass: invItem.itemClass, qty: 1,
        rate: missingRate ? 0 : rateData.rate,
        totalOverride: missingRate ? "Missing Rate" : null,
        taskId: taskId, repairId: "", shipNo: shipNo,
        notes: (missingRate ? "MISSING RATE - " : "") + resultToCheck + (taskNotes ? " - " + taskNotes : ""),
        ledgerEntryId: svcCode + "-TASK-" + taskId
      });
      if (billingResult.success && !billingResult.skipped) {
        out.billingCreated = true;
        if (missingRate) {
          out.billingException = "Missing Rate for " + svcCode + "/" + invItem.itemClass + " — billing row created, rate needs update";
          if (map["Billing Exception"]) taskSheet.getRange(row, map["Billing Exception"]).setValue(out.billingException);
          // Do NOT set Billed=true when rate is missing — admin must fix rate first
        } else {
          if (map["Billed"]) taskSheet.getRange(row, map["Billed"]).setValue(true);
        }
      } else if (!billingResult.success) {
        out.billingException = billingResult.error || "Billing row creation failed";
        if (map["Billing Exception"]) taskSheet.getRange(row, map["Billing Exception"]).setValue(out.billingException);
      }
    }
    var pdfBlob = null;
    if (photosUrl) { try { pdfBlob = SH_findPdfInFolder_(photosUrl, "Work_Order_"); if (pdfBlob) out.pdfFound = true; } catch (_) {} }
    var emailSentAt = getVal("Email Sent At");
    if (!emailSentAt && resultValue) {
      var notifOn = SH_truthy_(SH_getSetting_(srcSs, "ENABLE_NOTIFICATIONS"));
      if (notifOn) {
        var staffEmails = String(SH_getSetting_(srcSs, "NOTIFICATION_EMAILS") || "");
        var clientEmail = String(SH_getSetting_(srcSs, "CLIENT_EMAIL") || "");
        var clientNameE = String(SH_getSetting_(srcSs, "CLIENT_NAME") || "Client");
        var allRecipients = SH_mergeEmails_(staffEmails, clientEmail);
        if (allRecipients) {
          var taskTypeLower = String(taskType || "").trim().toLowerCase();
          var isInspection = (taskTypeLower === "inspection" || taskTypeLower === "insp");
          var emailKey = isInspection ? "INSP_EMAIL" : "TASK_COMPLETE";
          var emailSubj = (isInspection ? "Inspection Report " : "Task Completed ") + clientNameE + " Item " + itemId;
          var itemTableHtml = SH_buildItemTableHtml_(srcSs, itemId, invItem.description);
          var resultColor = isPASS ? "#16A34A" : isFAIL ? "#DC2626" : "#64748B";
          // v4.4.0 — include Sidemark so clients see which project an email references
          var _sidemark = (invItem && invItem.sidemark) ? invItem.sidemark : "";
          var emailResult = SH_sendTemplateEmail_(srcSs, emailKey, allRecipients, emailSubj, {
            "{{ITEM_ID}}": itemId, "{{CLIENT_NAME}}": clientNameE, "{{SHIPMENT_NO}}": shipNo || "-",
            "{{RESULT}}": resultValue, "{{TASK_TYPE}}": taskType || "Task",
            "{{SVC_NAME}}": rateData.svcName || taskType || "Task", "{{TASK_NOTES}}": taskNotes || "-",
            "{{DESCRIPTION}}": invItem.description || "-", "{{ITEM_TABLE_HTML}}": itemTableHtml,
            "{{PHOTOS_URL}}": photosUrl || "", "{{RESULT_COLOR}}": resultColor, "{{REPAIR_NOTE}}": "",
            "{{SIDEMARK}}": _sidemark,
            "{{SIDEMARK_HEADER}}": SH_buildSidemarkHeader_(_sidemark),
            "{{APP_DEEP_LINK}}": isInspection ? "https://www.mystridehub.com/#/tasks?open=" + encodeURIComponent(taskId) + "&client=" + encodeURIComponent(srcSs.getId()) : ""
          }, pdfBlob);
          if (emailResult.success) {
            out.emailSent = true;
            if (map["Email Sent At"]) taskSheet.getRange(row, map["Email Sent At"]).setValue(nowFmt);
          } else {
            out.emailException = emailResult.error || "Email send failed";
          }
        }
      }
    }
    if (map["Completion Processed At"]) taskSheet.getRange(row, map["Completion Processed At"]).setValue(nowFmt);
    if (map["Completion Started At"]) taskSheet.getRange(row, map["Completion Started At"]).setValue("");

    // Update aggregated Task Notes on Inventory
    try { SH_updateInventoryTaskNotes_(srcSs, itemId); } catch (_) {}

    // v3.0.1: Disposal task completion sets Release Date + Status → Released
    // v4.0.2: Sets Status directly (no longer relies on onEdit handler)
    var taskTypeLower2 = String(taskType || "").trim().toLowerCase();
    if (taskTypeLower2 === "disposal" || taskTypeLower2 === "disp") {
      try {
        var invSheet = srcSs.getSheetByName("Inventory");
        var relDateCol = invItem._hdr["Release Date"];
        var invStatusCol = invItem._hdr["Status"];
        if (relDateCol !== undefined) {
          invSheet.getRange(invItem.row, relDateCol + 1).setValue(now);
        }
        if (invStatusCol !== undefined) {
          invSheet.getRange(invItem.row, invStatusCol + 1).setValue("Released");
        }
        CI_log_("INFO", "Disposal complete — Release Date + Status set for item " + itemId);
      } catch (dispErr) { Logger.log("Disposal auto-release failed (non-fatal): " + dispErr); }
    }

    try { if (completeLock) completeLock.releaseLock(); } catch (_) {} // v4.2.0
    out.success = true;
  } catch (err) { try { if (completeLock) completeLock.releaseLock(); } catch (_) {} out.error = String(err); }
  return out;
}

function processRepairCompletionById_(srcSs, repairId, resultValue) {
  var out = { success: false, skipped: false, error: "", billingCreated: false, billingException: "", emailSent: false, emailException: "" };
  try {
    var repSheet = srcSs.getSheetByName("Repairs");
    if (!repSheet) { out.error = "Repairs sheet not found"; return out; }
    var map = SH_headerMap_(repSheet);
    var idCol = map["Repair ID"];
    if (!idCol) { out.error = "Repair ID column not found"; return out; }
    var row = SH_findRowById_(repSheet, idCol, repairId);
    if (row < 2) { out.error = "Repair not found: " + repairId; return out; }
    var rowData = repSheet.getRange(row, 1, 1, repSheet.getLastColumn()).getValues()[0];
    function getVal(h) { return map[h] ? String(rowData[map[h] - 1] || "").trim() : ""; }
    function getRaw(h) { return map[h] ? rowData[map[h] - 1] : ""; }
    var processedAt = getVal("Completion Processed At");
    if (processedAt) { out.success = true; out.skipped = true; return out; }
    var currentStatus = getVal("Status");
    if (currentStatus === "Complete" || currentStatus === "Cancelled") { out.success = true; out.skipped = true; return out; }
    var now = new Date();
    var tz = Session.getScriptTimeZone();
    var nowFmt = Utilities.formatDate(now, tz, "MM/dd/yyyy HH:mm:ss");
    if (map["Completion Started At"]) repSheet.getRange(row, map["Completion Started At"]).setValue(nowFmt);
    if (map["Status"]) repSheet.getRange(row, map["Status"]).setValue("Complete");
    if (map["Completed Date"] && !getVal("Completed Date")) repSheet.getRange(row, map["Completed Date"]).setValue(now);
    var itemId = getVal("Item ID"); var desc = getVal("Description"); var itemClass = getVal("Class");
    var quoteAmt = getRaw("Quote Amount"); var finalAmt = getRaw("Final Amount");
    var vendor = getVal("Repair Vendor"); var repairNotes = getVal("Repair Notes");
    var billingAmt = (finalAmt !== "" && finalAmt !== null && finalAmt !== 0) ? finalAmt : quoteAmt;
    billingAmt = Number(billingAmt || 0);
    {
      var missingRate = (billingAmt === 0);
      var clientName = String(SH_getSetting_(srcSs, "CLIENT_NAME") || "");
      var billingResult = SH_writeBillingRow_(srcSs, {
        status: "Unbilled", client: clientName, date: now, svcCode: "REPAIR", svcName: "Repair",
        itemId: itemId, description: desc, itemClass: itemClass, qty: 1,
        rate: missingRate ? 0 : billingAmt,
        totalOverride: missingRate ? "Missing Rate" : null,
        repairId: repairId, taskId: "", shipNo: "",
        notes: (missingRate ? "MISSING RATE - " : "") + "Result: " + resultValue,
        ledgerEntryId: "REPAIR-" + repairId
      });
      if (billingResult.success && !billingResult.skipped) {
        out.billingCreated = true;
        if (missingRate) {
          out.billingException = "Missing Rate — billing row created, amount needs update";
          if (map["Billing Exception"]) repSheet.getRange(row, map["Billing Exception"]).setValue(out.billingException);
        } else {
          if (map["Billed"]) repSheet.getRange(row, map["Billed"]).setValue(true);
        }
      }
      else if (!billingResult.success) { out.billingException = billingResult.error || "Billing failed"; if (map["Billing Exception"]) repSheet.getRange(row, map["Billing Exception"]).setValue(out.billingException); }
    }
    var emailSentAt = getVal("Email Sent At");
    if (!emailSentAt) {
      var notifOn = SH_truthy_(SH_getSetting_(srcSs, "ENABLE_NOTIFICATIONS"));
      var clientEmail = String(SH_getSetting_(srcSs, "CLIENT_EMAIL") || "");
      var clientNameE = String(SH_getSetting_(srcSs, "CLIENT_NAME") || "Client");
      if (notifOn && clientEmail) {
        var repairPhotosUrl = "";
        try { var rrt = repSheet.getRange(row, idCol).getRichTextValue(); if (rrt) repairPhotosUrl = rrt.getLinkUrl() || ""; } catch (_) {}
        var repairPdfBlob = null;
        if (repairPhotosUrl) { try { repairPdfBlob = SH_findPdfInFolder_(repairPhotosUrl, "Work_Order_"); } catch (_) {} }
        var itemTableHtml = SH_buildItemTableHtml_(srcSs, itemId, desc);
        var resultColor = (resultValue === "Pass" || resultValue === "PASS") ? "#16A34A" : (resultValue === "Fail" || resultValue === "FAIL") ? "#DC2626" : "#64748B";
        var emailSubj = "Repair Complete: " + itemId + " " + resultValue;
        // v4.4.0 — include Sidemark
        var _rcInv = SH_findInventoryItem_(srcSs, itemId);
        var _rcSidemark = _rcInv ? (_rcInv.sidemark || "") : "";
        var emailResult = SH_sendTemplateEmail_(srcSs, "REPAIR_COMPLETE", clientEmail, emailSubj, {
          "{{ITEM_ID}}": itemId, "{{CLIENT_NAME}}": clientNameE, "{{DESCRIPTION}}": desc || "-",
          "{{ITEM_TABLE_HTML}}": itemTableHtml, "{{REPAIR_RESULT}}": resultValue,
          "{{REPAIR_RESULT_COLOR}}": resultColor,
          "{{COMPLETED_DATE}}": Utilities.formatDate(now, Session.getScriptTimeZone(), "MM/dd/yyyy"),
          "{{QUOTE_AMOUNT}}": SH_formatCurrency_(quoteAmt), "{{FINAL_AMOUNT}}": SH_formatCurrency_(billingAmt),
          "{{REPAIR_VENDOR}}": vendor || "-", "{{PARTS_COST}}": SH_formatCurrency_(getRaw("Parts Cost") || "-"),
          "{{LABOR_HOURS}}": String(getRaw("Labor Hours") || "-"), "{{REPAIR_PHOTOS_URL}}": repairPhotosUrl || "#",
          "{{REPAIR_ID}}": repairId, "{{NOTES}}": repairNotes || "-",
          "{{SIDEMARK}}": _rcSidemark,
          "{{SIDEMARK_HEADER}}": SH_buildSidemarkHeader_(_rcSidemark),
          "{{APP_DEEP_LINK}}": repairId ? "https://www.mystridehub.com/#/repairs?open=" + encodeURIComponent(repairId) + "&client=" + encodeURIComponent(srcSs.getId()) : ""
        }, repairPdfBlob);
        if (emailResult.success) { out.emailSent = true; if (map["Email Sent At"]) repSheet.getRange(row, map["Email Sent At"]).setValue(nowFmt); }
        else { out.emailException = emailResult.error || "Email send failed"; }
      }
    }
    if (map["Completion Processed At"]) repSheet.getRange(row, map["Completion Processed At"]).setValue(nowFmt);
    if (map["Completion Started At"]) repSheet.getRange(row, map["Completion Started At"]).setValue("");
    out.success = true;
  } catch (err) { out.error = String(err); }
  return out;
}

function processRepairQuoteById_(srcSs, repairId, quoteAmount) {
  var out = { success: false, skipped: false, error: "", emailSent: false };
  try {
    var repSheet = srcSs.getSheetByName("Repairs");
    if (!repSheet) { out.error = "Repairs sheet not found"; return out; }
    var map = SH_headerMap_(repSheet);
    var idCol = map["Repair ID"];
    if (!idCol) { out.error = "Repair ID column not found"; return out; }
    var row = SH_findRowById_(repSheet, idCol, repairId);
    if (row < 2) { out.error = "Repair not found: " + repairId; return out; }
    var rowData = repSheet.getRange(row, 1, 1, repSheet.getLastColumn()).getValues()[0];
    function getVal(h) { return map[h] ? String(rowData[map[h] - 1] || "").trim() : ""; }
    var quoteSentAt = getVal("Quote Sent At");
    if (quoteSentAt && String(getVal("Quote Amount")) === String(quoteAmount)) { out.success = true; out.skipped = true; return out; }
    var currentStatus = getVal("Status");
    var wasQuotePending = (currentStatus === "Pending Quote" || currentStatus === "");
    if (wasQuotePending && map["Status"]) repSheet.getRange(row, map["Status"]).setValue("Quote Sent");
    var now = new Date();
    var tz = Session.getScriptTimeZone();
    var nowFmt = Utilities.formatDate(now, tz, "MM/dd/yyyy HH:mm:ss");
    if (map["Quote Sent Date"] && !getVal("Quote Sent Date")) repSheet.getRange(row, map["Quote Sent Date"]).setValue(now);
    if (wasQuotePending) {
      var notifOn = SH_truthy_(SH_getSetting_(srcSs, "ENABLE_NOTIFICATIONS"));
      var clientEmail = String(SH_getSetting_(srcSs, "CLIENT_EMAIL") || "");
      var clientName = String(SH_getSetting_(srcSs, "CLIENT_NAME") || "Client");
      if (notifOn && clientEmail) {
        var itemId = getVal("Item ID"); var desc = getVal("Description");
        var vendor = getVal("Repair Vendor"); var repairNotes = getVal("Repair Notes"); var taskNotes = getVal("Task Notes");
        var photosUrl = "";
        try { var rrt = repSheet.getRange(row, idCol).getRichTextValue(); if (rrt) photosUrl = rrt.getLinkUrl() || ""; } catch (_) {}
        if (!photosUrl && map["Source Task ID"]) { try { var srt = repSheet.getRange(row, map["Source Task ID"]).getRichTextValue(); if (srt) photosUrl = srt.getLinkUrl() || ""; } catch (_) {} }
        // v4.7.1 — lookup the Source Task row in Tasks sheet and use its Task ID
        // cell's hyperlink (set by startTask_ to the task's Drive folder). The
        // Source Task ID column on Repairs stores plain text, so the previous
        // tier always fell through to the Item folder — not where inspection
        // photos live. This new tier points the email's button at the task
        // folder where the inspection was actually documented.
        if (!photosUrl && map["Source Task ID"]) {
          try {
            var srcTaskId = String(rowData[map["Source Task ID"] - 1] || "").trim();
            if (srcTaskId) {
              var tasksSheet = srcSs.getSheetByName("Tasks");
              if (tasksSheet && tasksSheet.getLastRow() >= 2) {
                var tMap = SH_headerMap_(tasksSheet);
                var tIdCol = tMap["Task ID"];
                if (tIdCol) {
                  var tRow = SH_findRowById_(tasksSheet, tIdCol, srcTaskId);
                  if (tRow >= 2) {
                    var tRt = tasksSheet.getRange(tRow, tIdCol).getRichTextValue();
                    if (tRt && tRt.getLinkUrl()) photosUrl = tRt.getLinkUrl();
                  }
                }
              }
            }
          } catch (_) {}
        }
        if (!photosUrl) photosUrl = SH_getItemFolderUrl_(srcSs, itemId) || "";
        var itemTableHtml = SH_buildItemTableHtml_(srcSs, itemId, desc);
        var quoteAmtFmt = SH_formatCurrency_(quoteAmount);
        var photosButton = photosUrl ? '<a href="' + photosUrl + '" style="display:inline-block;background:#E85D2D;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px">View Inspection Photos</a>' : '';
        // v4.4.0 — include Sidemark
        var _rqInv = SH_findInventoryItem_(srcSs, itemId);
        var _rqSidemark = _rqInv ? (_rqInv.sidemark || "") : "";
        var emailResult = SH_sendTemplateEmail_(srcSs, "REPAIR_QUOTE", clientEmail,
          "Repair Quote Ready: " + itemId + " $" + quoteAmtFmt, {
          "{{ITEM_ID}}": itemId, "{{CLIENT_NAME}}": clientName, "{{DESCRIPTION}}": desc || "-",
          "{{ITEM_TABLE_HTML}}": itemTableHtml, "{{TASK_NOTES}}": taskNotes || "-",
          "{{QUOTE_AMOUNT}}": quoteAmtFmt, "{{REPAIR_ID}}": repairId, "{{REPAIR_VENDOR}}": vendor || "-",
          "{{NOTES}}": repairNotes || "-", "{{PHOTOS_URL}}": photosUrl || "#", "{{PHOTOS_BUTTON}}": photosButton,
          "{{SIDEMARK}}": _rqSidemark,
          "{{SIDEMARK_HEADER}}": SH_buildSidemarkHeader_(_rqSidemark),
          "{{APP_DEEP_LINK}}": repairId ? "https://www.mystridehub.com/#/repairs?open=" + encodeURIComponent(repairId) + "&client=" + encodeURIComponent(srcSs.getId()) : ""
        }, null);
        if (emailResult.success) { out.emailSent = true; if (map["Quote Sent At"]) repSheet.getRange(row, map["Quote Sent At"]).setValue(nowFmt); }
      }
    }
    out.success = true;
  } catch (err) { out.error = String(err); }
  return out;
}

function processRepairApprovalById_(srcSs, repairId) {
  var out = { success: false, skipped: false, error: "", folderCreated: false, pdfGenerated: false };
  try {
    var repSheet = srcSs.getSheetByName("Repairs");
    if (!repSheet) { out.error = "Repairs sheet not found"; return out; }
    var map = SH_headerMap_(repSheet);
    var idCol = map["Repair ID"];
    if (!idCol) { out.error = "Repair ID column not found"; return out; }
    var row = SH_findRowById_(repSheet, idCol, repairId);
    if (row < 2) { out.error = "Repair not found: " + repairId; return out; }
    var rowData = repSheet.getRange(row, 1, 1, repSheet.getLastColumn()).getValues()[0];
    function getVal(h) { return map[h] ? String(rowData[map[h] - 1] || "").trim() : ""; }
    var approvalProcessed = getVal("Approval Processed At");
    if (approvalProcessed) { out.success = true; out.skipped = true; return out; }
    if (map["Status"]) repSheet.getRange(row, map["Status"]).setValue("Approved");
    var now = new Date();
    var tz = Session.getScriptTimeZone();
    var nowFmt = Utilities.formatDate(now, tz, "MM/dd/yyyy HH:mm:ss");
    var itemId = getVal("Item ID");
    // v4.1.0: Flat folder structure — repair folders in Repairs/ subfolder (no item/shipment dependency)
    try {
      var repairsParent = getOrCreateEntitySubfolder_(srcSs, "Repairs");
      if (repairsParent) {
        var repFolderName = repairId;
        var existing = repairsParent.getFoldersByName(repFolderName);
        var repairFolder = existing.hasNext() ? existing.next() : repairsParent.createFolder(repFolderName);
        var repairFolderUrl = repairFolder.getUrl();
        out.folderCreated = true;
        try {
          var ridVal = String(repSheet.getRange(row, idCol).getValue() || "");
          var repRt = SpreadsheetApp.newRichTextValue().setText(ridVal).setLinkUrl(repairFolderUrl).build();
          repSheet.getRange(row, idCol).setRichTextValue(repRt);
        } catch (_) {}
        try {
          SH_generateRepairWorkOrderPdf_(srcSs, rowData, map, repairFolderUrl);
          out.pdfGenerated = true;
        } catch (pdfErr) {
          Logger.log("SH_generateRepairWorkOrderPdf_ failed (non-fatal): " + pdfErr);
        }
      }
    } catch (folderErr) { Logger.log("Approval folder/PDF failed (non-fatal): " + folderErr); }
    if (map["Approval Processed At"]) repSheet.getRange(row, map["Approval Processed At"]).setValue(nowFmt);

    // v3.0.1: Send REPAIR_APPROVED email
    try {
      var clientName = String(SH_getSetting_(srcSs, "CLIENT_NAME") || "Client");
      var notifEmails = String(SH_getSetting_(srcSs, "NOTIFICATION_EMAILS") || "");
      if (notifEmails) {
        var quoteAmt = getVal("Quote Amount");
        var invItem2 = SH_findInventoryItem_(srcSs, itemId);
        var itemLoc = invItem2 ? invItem2.location : "";
        var itemSidemark = invItem2 ? invItem2.sidemark : "";
        var itemTableHtml = SH_buildItemTableHtml_(srcSs, itemId, invItem2 ? invItem2.description : "");
        SH_sendTemplateEmail_(srcSs, "REPAIR_APPROVED", notifEmails,
          "Repair Approved: " + itemId + " - " + clientName, {
          "{{ITEM_ID}}": itemId,
          "{{CLIENT_NAME}}": clientName,
          "{{REPAIR_ID}}": repairId,
          "{{QUOTE_AMOUNT}}": quoteAmt,
          "{{LOCATION}}": itemLoc,
          "{{SIDEMARK}}": itemSidemark,
          "{{ITEM_TABLE_HTML}}": itemTableHtml,
          "{{APP_DEEP_LINK}}": repairId ? "https://www.mystridehub.com/#/repairs?open=" + encodeURIComponent(repairId) + "&client=" + encodeURIComponent(srcSs.getId()) : ""
        });
        out.emailSent = true;
      }
    } catch (approvalEmailErr) {
      Logger.log("REPAIR_APPROVED email failed (non-fatal): " + approvalEmailErr);
    }

    out.success = true;
  } catch (err) { out.error = String(err); }
  return out;
}

/**
 * Shared handler: Repair Declined (v3.0.1)
 * Sets status to Declined, sends REPAIR_DECLINED email, does NOT create a task.
 */
function processRepairDeclinedById_(srcSs, repairId) {
  var out = { success: false, skipped: false, error: "", emailSent: false };
  try {
    var repSheet = srcSs.getSheetByName("Repairs");
    if (!repSheet) { out.error = "Repairs sheet not found"; return out; }
    var map = SH_headerMap_(repSheet);
    var idCol = map["Repair ID"];
    if (!idCol) { out.error = "Repair ID column not found"; return out; }
    var row = SH_findRowById_(repSheet, idCol, repairId);
    if (row < 2) { out.error = "Repair not found: " + repairId; return out; }
    var rowData = repSheet.getRange(row, 1, 1, repSheet.getLastColumn()).getValues()[0];
    function getVal(h) { return map[h] ? String(rowData[map[h] - 1] || "").trim() : ""; }

    // Already declined? Skip
    var currentStatus = getVal("Status");
    if (currentStatus === "Declined") { out.success = true; out.skipped = true; return out; }

    // Set status to Declined
    if (map["Status"]) repSheet.getRange(row, map["Status"]).setValue("Declined");

    var now = new Date();
    var tz = Session.getScriptTimeZone();
    var nowFmt = Utilities.formatDate(now, tz, "MM/dd/yyyy HH:mm:ss");

    // Set Approved column to "Declined"
    if (map["Approved"]) repSheet.getRange(row, map["Approved"]).setValue("Declined");

    var itemId = getVal("Item ID");
    var clientName = String(SH_getSetting_(srcSs, "CLIENT_NAME") || "Client");
    var notifEmails = String(SH_getSetting_(srcSs, "NOTIFICATION_EMAILS") || "");

    if (notifEmails && itemId) {
      var quoteAmt = getVal("Quote Amount");
      var invItem = SH_findInventoryItem_(srcSs, itemId);
      var itemLoc = invItem ? invItem.location : "";
      var itemSidemark = invItem ? invItem.sidemark : "";
      var itemTableHtml = SH_buildItemTableHtml_(srcSs, itemId, invItem ? invItem.description : "");
      SH_sendTemplateEmail_(srcSs, "REPAIR_DECLINED", notifEmails,
        "Repair Declined: " + itemId + " - " + clientName, {
        "{{ITEM_ID}}": itemId,
        "{{CLIENT_NAME}}": clientName,
        "{{REPAIR_ID}}": repairId,
        "{{QUOTE_AMOUNT}}": quoteAmt,
        "{{LOCATION}}": itemLoc,
        "{{SIDEMARK}}": itemSidemark,
        "{{ITEM_TABLE_HTML}}": itemTableHtml,
        "{{APP_DEEP_LINK}}": repairId ? "https://www.mystridehub.com/#/repairs?open=" + encodeURIComponent(repairId) + "&client=" + encodeURIComponent(srcSs.getId()) : ""
      });
      out.emailSent = true;
    }

    out.success = true;
  } catch (err) { out.error = String(err); }
  return out;
}

/**
 * Shared helper: update aggregated Task Notes on Inventory for an item.
 * Builds multi-line text with hyperlinked Task IDs showing result + notes.
 */
function SH_updateInventoryTaskNotes_(ss, itemId) {
  try {
    if (!itemId) return;
    var inv = ss.getSheetByName("Inventory");
    if (!inv || inv.getLastRow() < 2) return;
    var invMap = SH_headerMap_(inv);
    var invTaskNotesCol = invMap["Task Notes"];
    var invItemCol = invMap["Item ID"];
    if (!invTaskNotesCol || !invItemCol) return;

    // Find inventory row for this item
    var invRow = SH_findRowById_(inv, invItemCol, itemId);
    if (invRow < 2) return;

    // Read all tasks for this item
    var taskSheet = ss.getSheetByName("Tasks");
    if (!taskSheet || taskSheet.getLastRow() < 2) return;
    var tMap = SH_headerMap_(taskSheet);
    var tItemCol = tMap["Item ID"];
    var tIdCol = tMap["Task ID"];
    var tResultCol = tMap["Result"];
    var tNotesCol = tMap["Task Notes"];
    var tStatusCol = tMap["Status"];
    if (!tItemCol || !tIdCol) return;

    var tData = taskSheet.getDataRange().getValues();
    var lines = [];
    var linkUrls = [];
    var lineStarts = [];

    // Collect tasks for this item (newest first — reverse scan)
    for (var r = tData.length - 1; r >= 1; r--) {
      if (String(tData[r][tItemCol - 1] || "").trim() !== String(itemId).trim()) continue;
      var taskId = String(tData[r][tIdCol - 1] || "").trim();
      if (!taskId) continue;
      var result = tResultCol ? String(tData[r][tResultCol - 1] || "").trim() : "";
      var status = tStatusCol ? String(tData[r][tStatusCol - 1] || "").trim() : "";
      var notes = tNotesCol ? String(tData[r][tNotesCol - 1] || "").trim() : "";
      var display = result || status || "Open";
      var line = taskId + " (" + display + ")" + (notes ? ": " + notes : "");
      // Get task folder URL from Task ID hyperlink
      var folderUrl = "";
      try {
        var rt = taskSheet.getRange(r + 1, tIdCol).getRichTextValue();
        if (rt && rt.getLinkUrl()) folderUrl = rt.getLinkUrl();
      } catch (_) {}

      var startPos = 0;
      if (lines.length > 0) startPos = lines.join("\n").length + 1; // +1 for the newline
      lines.push(line);
      linkUrls.push({ start: startPos, end: startPos + taskId.length, url: folderUrl, taskId: taskId });
    }

    if (lines.length === 0) {
      inv.getRange(invRow, invTaskNotesCol).setValue("");
      return;
    }

    var fullText = lines.join("\n");
    // Build RichTextValue with hyperlinks on task IDs
    var rtBuilder = SpreadsheetApp.newRichTextValue().setText(fullText);
    for (var li = 0; li < linkUrls.length; li++) {
      if (linkUrls[li].url) {
        rtBuilder.setLinkUrl(linkUrls[li].start, linkUrls[li].end, linkUrls[li].url);
      }
    }
    inv.getRange(invRow, invTaskNotesCol).setRichTextValue(rtBuilder.build());
  } catch (err) {
    Logger.log("SH_updateInventoryTaskNotes_ error: " + err);
  }
}

/* === END SHARED HANDLERS v1.1.0 === */

function onTaskEdit_(e) {
try {
if (!e || !e.range) return;
var sh = e.range.getSheet();
if (sh.getName() !== CI_SH.TASKS) return;
    var map = getHeaderMap_(sh);
    var editedCol = e.range.getColumn();
    var row = e.range.getRow();
    if (row < 2) return;

    // v4.0.0: Start Task checkbox → create folder, PDF, hyperlinks
    var startTaskCol = map["Start Task"];
    if (startTaskCol && editedCol === startTaskCol && truthy_(e.value)) {
      startTask_(SpreadsheetApp.getActive(), sh, row, map);
      return;
    }

    var resultCol = map["Result"];
    var completedCol = map["Completed At"];
    var statusCol = map["Status"];
    if (!resultCol && !completedCol && !statusCol) return;
    if (editedCol !== resultCol && editedCol !== completedCol && editedCol !== statusCol) return;

    // v1.2.0: Reverse-sync item-level fields from Tasks back to Inventory
    var editedColName = null;
    for (var hk in map) { if (map[hk] === editedCol) { editedColName = hk; break; } }
    if (editedColName && ITEM_LEVEL_SYNC_FIELDS_[editedColName]) {
      var syncRowData = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
      var syncItemId = getCellByHeader_(syncRowData, map, "Item ID");
      if (syncItemId) syncFieldToInventory_(syncItemId, editedColName, e.value);
    }

    // Determine trigger type
    var resultVal = "";
    var manualComplete = false;
    if (editedCol === resultCol) resultVal = String(e.value || "").trim();
    if (editedCol === completedCol || (editedCol === statusCol && String(e.value || "").trim() === "Completed")) manualComplete = true;
    if (!resultVal && !manualComplete) return;

    // Read task ID for shared handler
    var rowData = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    var taskId = getCellByHeader_(rowData, map, "Task ID");
    if (!taskId) return;

    // v2.7.0: Delegate to shared handler (thin wrapper)
    var ss = SpreadsheetApp.getActive();
    var result = processTaskCompletionById_(ss, taskId, resultVal || null);
    if (result.success && !result.skipped) {
      CI_log_("INFO", "Task completed: " + taskId, "billing=" + result.billingCreated + " email=" + result.emailSent + " exception=" + (result.billingException || result.emailException || "none"));
    } else if (!result.success && !result.skipped) {
      CI_log_("ERROR", "Task completion failed: " + taskId, result.error);
    }

} catch (err) {
Logger.log("onTaskEdit_ error: " + err);
}
}
function onRepairEdit_(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== CI_SH.REPAIRS) return;
    var map = getHeaderMap_(sh);
    var quoteCol = map["Quote Amount"];
    var statusCol = map["Status"];
    var approvedCol = map["Approved"];
    var resultCol = map["Repair Result"];
    if (!quoteCol && !statusCol && !approvedCol && !resultCol) return;

    var editedCol = e.range.getColumn();
    var row = e.range.getRow();
    if (row < 2) return;

    // v1.2.0: Reverse-sync item-level fields from Repairs back to Inventory
    var editedColNameR = null;
    for (var hkr in map) { if (map[hkr] === editedCol) { editedColNameR = hkr; break; } }
    if (editedColNameR && ITEM_LEVEL_SYNC_FIELDS_[editedColNameR]) {
      var syncRowR = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
      var syncItemIdR = getCellByHeader_(syncRowR, map, "Item ID");
      if (syncItemIdR) syncFieldToInventory_(syncItemIdR, editedColNameR, e.value);
    }

    // Read repair ID for shared handlers
    var rowData = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    var repairId = getCellByHeader_(rowData, map, "Repair ID");

    var ss = SpreadsheetApp.getActive();

    // --- QUOTE AMOUNT entered -> shared handler ---
    if (quoteCol && editedCol === quoteCol) {
      var quoteAmt = e.range.getValue();
      if (quoteAmt !== "" && quoteAmt !== null && repairId) {
        var qResult = processRepairQuoteById_(ss, repairId, quoteAmt);
        if (qResult.success && !qResult.skipped) CI_log_("INFO", "Quote sent: " + repairId, "email=" + qResult.emailSent);
        else if (!qResult.success) CI_log_("ERROR", "Quote send failed: " + repairId, qResult.error);
      }
    }

    // --- APPROVED dropdown (Approved / Declined) -> shared handler ---
    if (approvedCol && editedCol === approvedCol) {
      var approvedVal = String(e.value || "").trim();
      if (approvedVal === "Approved" && repairId) {
        var aResult = processRepairApprovalById_(ss, repairId);
        if (aResult.success && !aResult.skipped) CI_log_("INFO", "Approval processed: " + repairId, "folder=" + aResult.folderCreated + " pdf=" + aResult.pdfGenerated);
        else if (!aResult.success) CI_log_("ERROR", "Approval failed: " + repairId, aResult.error);
      } else if (approvedVal === "Declined" && repairId) {
        var dResult = processRepairDeclinedById_(ss, repairId);
        if (dResult.success && !dResult.skipped) CI_log_("INFO", "Repair declined: " + repairId, "email=" + dResult.emailSent);
        else if (!dResult.success) CI_log_("ERROR", "Repair declined failed: " + repairId, dResult.error);
      }
    }

    // --- REPAIR RESULT entered -> shared handler ---
    if (resultCol && editedCol === resultCol) {
      var resultVal = String(e.value || "").trim();
      if ((resultVal === "Pass" || resultVal === "Fail") && repairId) {
        var rResult = processRepairCompletionById_(ss, repairId, resultVal);
        if (rResult.success && !rResult.skipped) CI_log_("INFO", "Repair completed: " + repairId, "billing=" + rResult.billingCreated + " email=" + rResult.emailSent + " exception=" + (rResult.billingException || rResult.emailException || "none"));
        else if (!rResult.success) CI_log_("ERROR", "Repair completion failed: " + repairId, rResult.error);
      }
    }

    // --- STATUS set to Declined -> send declined email ---
    if (statusCol && editedCol === statusCol && String(e.value || "").trim() === "Declined") {
      if (repairId) {
        var dResult = processRepairDeclinedById_(ss, repairId);
        if (dResult.success && !dResult.skipped) CI_log_("INFO", "Repair declined: " + repairId, "email=" + dResult.emailSent);
        else if (!dResult.success) CI_log_("ERROR", "Repair declined failed: " + repairId, dResult.error);
      }
    }

    // --- STATUS manually set to Complete (legacy/fallback) ---
    if (statusCol && editedCol === statusCol && String(e.value || "").trim() === "Complete") {
      var completedDateCol = map["Completed Date"];
      var existingDate = getCellByHeader_(rowData, map, "Completed Date");
      if (completedDateCol && !existingDate) {
        sh.getRange(row, completedDateCol).setValue(new Date());
      }
    }

  } catch (err) {
    Logger.log("onRepairEdit_ error: " + err);
  }
}





/**
 * Edit handler for Shipments sheet.
 * Fires SHIPMENT_RECEIVED email when Status changes to "Received".
 */
function onShipmentEdit_(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== CI_SH.SHIPMENTS) return;
    var ss = SpreadsheetApp.getActive();
    var shipMap = getHeaderMapAtRow_(sh, 1);
    if (!shipMap || !shipMap["Status"]) return;
    var statusCol = shipMap["Status"];
    var editedCol = e.range.getColumn();
    var editedRow = e.range.getRow();
    if (editedRow < 2) return;

    // Shipment Received email trigger
    if (editedCol === statusCol) {
      var newVal = String(e.value || "").trim();
      var oldVal = String(e.oldValue || "").trim();
      if (newVal === "Received" && oldVal !== "Received") {
        onShipmentReceived_(ss, sh, shipMap, editedRow);
      }
    }
  } catch (err) {
    Logger.log("onShipmentEdit_ error: " + err);
  }
}

function onWillCallEdit_(e) {
  if (!e || !e.range) return;
  var ss = SpreadsheetApp.getActive();
  var sh = e.range.getSheet();
  if (sh.getName() !== CI_SH.WILL_CALLS) return;

  var row = e.range.getRow();
  if (row < 2) return;

  var map = getHeaderMap_(sh);
  var editedCol = e.range.getColumn();
  var rowData = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

  // --- Status changed → sync to WC_Items + handle Cancelled email ---
  if (editedCol === map["Status"]) {
    var newStatus = String(e.value || "").trim();
    var oldStatus = String(e.oldValue || "").trim();
    var wcNumber = String(rowData[map["WC Number"] - 1] || "").trim();

    // v2.6.5: Sync ANY status change to matching WC_Items rows
    if (newStatus && wcNumber) {
      var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
      if (wciSh && wciSh.getLastRow() >= 2) {
        var wciMap = getHeaderMap_(wciSh);
        var wciData = wciSh.getDataRange().getValues();
        var wciStatusCol = wciMap["Status"];
        if (wciStatusCol) {
          for (var si = 1; si < wciData.length; si++) {
            if (String(wciData[si][wciMap["WC Number"] - 1] || "").trim() === wcNumber) {
              wciSh.getRange(si + 1, wciStatusCol).setValue(newStatus);
            }
          }
        }
      }
    }

    // Cancelled → send cancellation email
    if (newStatus === WC_STATUS.CANCELLED && oldStatus !== WC_STATUS.CANCELLED) {
      var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
      var notif = getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS);
      var clientEmail = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL);
      var allRecip = mergeEmails_(notif, clientEmail);

      // Get items for this WC
      var wciShCancel = ss.getSheetByName(CI_SH.WC_ITEMS);
      var cancelItems = [];
      if (wciShCancel && wciShCancel.getLastRow() >= 2) {
        var wciMapCancel = getHeaderMap_(wciShCancel);
        var wciDataCancel = wciShCancel.getDataRange().getValues();
        for (var wi = 1; wi < wciDataCancel.length; wi++) {
          if (String(wciDataCancel[wi][wciMapCancel["WC Number"] - 1] || "").trim() === wcNumber) {
            cancelItems.push({
              itemId: String(wciDataCancel[wi][wciMapCancel["Item ID"] - 1] || ""),
              description: String(wciDataCancel[wi][wciMapCancel["Description"] - 1] || ""),
              itemClass: String(wciDataCancel[wi][wciMapCancel["Class"] - 1] || "")
            });
          }
        }
      }

      if (allRecip) {
        try {
          // v4.4.0 — collect distinct Sidemarks across cancelled items
          var _wcxSidemarks = "";
          try {
            var _wcxInv = ss.getSheetByName("Inventory");
            if (_wcxInv && _wcxInv.getLastRow() >= 2) {
              var _wcxMapInv = getHeaderMap_(_wcxInv);
              var _wcxItemIdCol = _wcxMapInv["Item ID"];
              var _wcxSmCol = _wcxMapInv["Sidemark"];
              if (_wcxItemIdCol && _wcxSmCol) {
                var _wcxData = _wcxInv.getDataRange().getValues();
                var _wcxIds = {};
                cancelItems.forEach(function(it) { if (it && it.itemId) _wcxIds[String(it.itemId).trim()] = true; });
                var _wcxSeen = {}; var _wcxOut = [];
                for (var _wxi = 1; _wxi < _wcxData.length; _wxi++) {
                  var _wxid = String(_wcxData[_wxi][_wcxItemIdCol - 1] || "").trim();
                  if (!_wxid || !_wcxIds[_wxid]) continue;
                  var _wxsm = String(_wcxData[_wxi][_wcxSmCol - 1] || "").trim();
                  if (_wxsm && !_wcxSeen[_wxsm]) { _wcxSeen[_wxsm] = true; _wcxOut.push(_wxsm); }
                }
                _wcxSidemarks = _wcxOut.join(", ");
              }
            }
          } catch (_wcxSmErr) { Logger.log("WC_CANCELLED sidemark collection non-fatal: " + _wcxSmErr); }
          sendTemplateEmail_(ss, "WILL_CALL_CANCELLED", allRecip, {
            "{{WC_NUMBER}}": wcNumber,
            "{{CLIENT_NAME}}": clientName,
            "{{ITEMS_TABLE}}": buildWcItemsEmailTable_(cancelItems),
            "{{ITEMS_COUNT}}": String(cancelItems.length),
            "{{CANCEL_DATE}}": Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy"),
            "{{SIDEMARK}}": _wcxSidemarks,
            "{{SIDEMARK_HEADER}}": SH_buildSidemarkHeader_(_wcxSidemarks),
            "{{APP_DEEP_LINK}}": wcNumber ? "https://www.mystridehub.com/#/will-calls?open=" + encodeURIComponent(wcNumber) + "&client=" + encodeURIComponent(srcSs.getId()) : ""
          });
        } catch (emailErr) {
          Logger.log("Will call cancellation email error: " + emailErr);
        }
      }
      SpreadsheetApp.getActive().toast("Will call " + wcNumber + " cancelled. Notification sent.", "Cancelled", 5);
    }
  }

  // --- Estimated Pickup Date entered while Pending → auto-flip to Scheduled ---
  if (editedCol === map["Estimated Pickup Date"]) {
    var currentStatus = String(rowData[map["Status"] - 1] || "").trim();
    var dateVal = String(e.value || "").trim();
    if (currentStatus === WC_STATUS.PENDING && dateVal) {
      sh.getRange(row, map["Status"]).setValue(WC_STATUS.SCHEDULED);
      // v2.6.5: Sync Scheduled status to WC_Items
      var wcNumSched = String(rowData[map["WC Number"] - 1] || "").trim();
      if (wcNumSched) {
        var wciShSched = ss.getSheetByName(CI_SH.WC_ITEMS);
        if (wciShSched && wciShSched.getLastRow() >= 2) {
          var wciMapSched = getHeaderMap_(wciShSched);
          var wciDataSched = wciShSched.getDataRange().getValues();
          var wciStatusColSched = wciMapSched["Status"];
          if (wciStatusColSched) {
            for (var ssi = 1; ssi < wciDataSched.length; ssi++) {
              if (String(wciDataSched[ssi][wciMapSched["WC Number"] - 1] || "").trim() === wcNumSched) {
                wciShSched.getRange(ssi + 1, wciStatusColSched).setValue(WC_STATUS.SCHEDULED);
              }
            }
          }
        }
      }
    }
  }
}

/* ============================================================
   TRIGGER VERIFICATION & RESET (v3.0.0)
   ============================================================ */
/**
 * verifyTriggers — writes current trigger state to _TRIGGER_STATE setting key.
 * Call from menu or after rollout to record trigger health.
 * NOTE: This reports the state at time of execution, not live state.
 */
function verifyTriggers() {
  var ss = SpreadsheetApp.getActive();
  var triggers = ScriptApp.getProjectTriggers();
  var state = triggers.map(function(t) {
    return {
      fn: t.getHandlerFunction(),
      type: String(t.getEventType()),
      source: t.getTriggerSourceId()
    };
  });
  var result = {
    version: CI_V,
    triggerCount: triggers.length,
    triggers: state,
    timestamp: new Date().toISOString()
  };
  var sh = ss.getSheetByName(CI_SH.SETTINGS);
  if (sh) {
    var lr = sh.getLastRow();
    var data = lr > 0 ? sh.getRange(1, 1, lr, 2).getValues() : [];
    var found = false;
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === "_TRIGGER_STATE") {
        sh.getRange(i + 1, 2).setValue(JSON.stringify(result));
        found = true;
        break;
      }
    }
    if (!found) {
      sh.getRange(lr + 1, 1, 1, 2).setValues([["_TRIGGER_STATE", JSON.stringify(result)]]);
    }
    // Also write script project ID so sync-clients.mjs can find it
    var scriptId = ScriptApp.getScriptId();
    var scriptIdFound = false;
    // Re-read in case rows were added above
    lr = sh.getLastRow();
    data = lr > 0 ? sh.getRange(1, 1, lr, 2).getValues() : [];
    for (var si = 0; si < data.length; si++) {
      if (String(data[si][0]).trim() === "_SCRIPT_ID") {
        sh.getRange(si + 1, 2).setValue(scriptId);
        scriptIdFound = true;
        break;
      }
    }
    if (!scriptIdFound) {
      sh.getRange(lr + 1, 1, 1, 2).setValues([["_SCRIPT_ID", scriptId]]);
    }
  }
  safeAlert_("Trigger state recorded: " + triggers.length + " triggers found (" + CI_V + ")");
  return result;
}

/**
 * resetTriggers — deletes ALL project triggers then reinstalls the standard set.
 * Use when triggers are broken or duplicated.
 */
function resetTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
  StrideClientInstallTriggers();
}
