/* ===================================================
   Utils.gs — v3.4.0 — 2026-03-31 11:30 AM PST
   =================================================== */

/* ============================================================
INVENTORY LOOKUP
============================================================ */
function findInventoryRowByItemId_(ss, itemId) {
if (!itemId) return null;
var invSheet = ss.getSheetByName(CI_SH.INVENTORY);
if (!invSheet || invSheet.getLastRow() < 2) return null;
var invMap = getHeaderMap_(invSheet);
var invData = invSheet.getRange(2, 1, invSheet.getLastRow() - 1, invSheet.getLastColumn()).getValues();
var matchRow = null;
for (var i = 0; i < invData.length; i++) {
if (getCellByHeader_(invData[i], invMap, "Item ID") === itemId) {
matchRow = invData[i];
break;
}
}
if (!matchRow) return null;
// v2.6.4: Read item folder URL from Item ID hyperlink
var itemIdCol = invMap["Item ID"];
var itemFolderUrl = "";
if (itemIdCol) {
  var rt = invSheet.getRange(i + 2, itemIdCol).getRichTextValue();
  if (rt) itemFolderUrl = rt.getLinkUrl() || "";
}
return {
description: getCellByHeader_(matchRow, invMap, "Description"),
itemClass: getCellByHeader_(matchRow, invMap, "Class"),
vendor: getCellByHeader_(matchRow, invMap, "Vendor"),
shipNo: getCellByHeader_(matchRow, invMap, "Shipment #"),
photos: "",
itemFolderUrl: itemFolderUrl,
location: getCellByHeader_(matchRow, invMap, "Location"),
status: getCellByHeader_(matchRow, invMap, "Status"),
      qty: getCellByHeader_(matchRow, invMap, "Qty"),
      sidemark: getCellByHeader_(matchRow, invMap, "Sidemark"),
      room: getCellByHeader_(matchRow, invMap, "Room"),
      row: i + 2,
      _rawRow: matchRow,
      _invMap: invMap
};
}
/**
 * v2.6.4: Read the item folder URL from the Item ID hyperlink on Inventory.
 */
function getItemFolderUrl_(ss, itemId) {
  if (!itemId) return "";
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv || inv.getLastRow() < 2) return "";
  var map = getHeaderMap_(inv);
  var idCol = map["Item ID"];
  if (!idCol) return "";
  var data = inv.getRange(2, idCol, inv.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0] || "").trim() === String(itemId).trim()) {
      var rt = inv.getRange(i + 2, idCol).getRichTextValue();
      return (rt && rt.getLinkUrl()) ? rt.getLinkUrl() : "";
    }
  }
  return "";
}

/* ============================================================
// PROTECTIONS
// ============================================================ */
// function StrideClientApplyProtections() {
// var ss = SpreadsheetApp.getActive();
// var owner = getSetting_(ss, CI_SETTINGS_KEYS.OWNER_EMAIL) || tryGetEmail_() || "";
// protectSheet_(ss, CI_SH.SETTINGS, owner, getEditableRanges_Settings_);
// protectSheet_(ss, CI_SH.DOCK, owner, getEditableRanges_DockIntake_);
// protectSheet_(ss, CI_SH.INVENTORY, owner, getEditableRanges_Inventory_);
// protectSheet_(ss, CI_SH.SHIPMENTS, owner, getEditableRanges_Shipments_);
// protectSheet_(ss, CI_SH.TASKS, owner, getEditableRanges_Tasks_);
// protectSheet_(ss, CI_SH.REPAIRS, owner, getEditableRanges_Repairs_);
// protectSheet_(ss, CI_SH.BILLING_LEDGER, owner, getEditableRanges_BillingLedger_);
// safeAlert_("Protections applied.");
// }
// function protectSheet_(ss, sheetName, ownerEmail, editableRangesFn) {
// var sh = ss.getSheetByName(sheetName);
// if (!sh) return;
// clearAllProtections_(sh);
// var p = sh.protect().setDescription("Stride Client " + CI_V + " Owner-only: " + sheetName);
// p.setWarningOnly(false);
// if (ownerEmail) p.addEditor(ownerEmail);
// var keep = String(ownerEmail || "").toLowerCase();
// var editors = p.getEditors();
// var toRemove = editors.filter(function(u) { return String(u.getEmail() || "").toLowerCase() !== keep; });
// if (toRemove.length) p.removeEditors(toRemove);
// if (p.canDomainEdit()) p.setDomainEdit(false);
// var editable = editableRangesFn(sh);
// if (editable && editable.length) p.setUnprotectedRanges(editable);
// }
function getEditableRanges_Settings_(sh) {
return [sh.getRange(2, 2, Math.max(sh.getMaxRows() - 1, 1), 1)];
}
function getEditableRanges_DockIntake_(sh) {
var ranges = [sh.getRange("B4"), sh.getRange("B5"), sh.getRange("B6"), sh.getRange("B7")];
var map = getHeaderMapAtRow_(sh, DOCK_ITEMS_HEADER_ROW);
var lastCol = maxColFromHeaderMap_(map) || Math.max(1, sh.getLastColumn());
var rows = Math.max(sh.getMaxRows() - (DOCK_ITEMS_DATA_START_ROW - 1), 1);
var shipCol = map["Shipment #"];
if (!shipCol) {
ranges.push(sh.getRange(DOCK_ITEMS_DATA_START_ROW, 1, rows, Math.max(lastCol, 10)));
return ranges;
}
var editableGridRanges = buildEditableRangesExcludingCols_(
sh, DOCK_ITEMS_DATA_START_ROW, rows, lastCol, [shipCol]
);
return ranges.concat(editableGridRanges || []);
}
function getEditableRanges_Inventory_(sh) {
var map = getHeaderMap_(sh);
var rows = Math.max(sh.getMaxRows() - 1, 1);
var lastCol = Math.max(1, sh.getLastColumn());
var locked = [map["Shipment #"], map["Shipment Photos URL"], map["Invoice URL"]].filter(Boolean);
return buildEditableRangesExcludingCols_(sh, 2, rows, lastCol, locked);
}
function getEditableRanges_Shipments_(sh) {
var map = getHeaderMap_(sh);
var rows = Math.max(sh.getMaxRows() - 1, 1);
var lastCol = Math.max(1, sh.getLastColumn());
var locked = [map["Shipment #"], map["Shipment Photos URL"], map["Invoice URL"]].filter(Boolean);
return buildEditableRangesExcludingCols_(sh, 2, rows, lastCol, locked);
}
function getEditableRanges_Tasks_(sh) {
var map = getHeaderMap_(sh);
var rows = Math.max(sh.getMaxRows() - 1, 1);
var lastCol = Math.max(1, sh.getLastColumn());
var locked = [map["Task ID"], map["Status"], map["Completed At"], map["Cancelled At"], map["Billed"], map["Svc Code"]].filter(Boolean);
return buildEditableRangesExcludingCols_(sh, 2, rows, lastCol, locked);
}
function getEditableRanges_Repairs_(sh) {
var map = getHeaderMap_(sh);
var rows = Math.max(sh.getMaxRows() - 1, 1);
var lastCol = Math.max(1, sh.getLastColumn());
var locked = [map["Repair ID"], map["Invoice ID"], map["Source Task ID"]].filter(Boolean);
return buildEditableRangesExcludingCols_(sh, 2, rows, lastCol, locked);
}
function getEditableRanges_BillingLedger_(sh) {
var map = getHeaderMap_(sh);
var rows = Math.max(sh.getMaxRows() - 1, 1);
var lastCol = Math.max(1, sh.getLastColumn());
var locked = [map["Invoice #"], map["Total"], map["Task ID"], map["Repair ID"]].filter(Boolean);
return buildEditableRangesExcludingCols_(sh, 2, rows, lastCol, locked);
}
function buildEditableRangesExcludingCols_(sh, startRow, numRows, lastCol, lockedCols) {
var locked = {};
lockedCols.forEach(function(c) { locked[Number(c)] = true; });
var ranges = [];
var runStart = null;
for (var c = 1; c <= lastCol; c++) {
var isLocked = !!locked[c];
if (!isLocked && runStart === null) runStart = c;
if ((isLocked || c === lastCol) && runStart !== null) {
var runEnd = isLocked ? c - 1 : c;
var width = runEnd - runStart + 1;
if (width > 0) ranges.push(sh.getRange(startRow, runStart, numRows, width));
runStart = null;
}
}
return ranges;
}
/* ============================================================
HELPERS
============================================================ */
function ensureSheet_(ss, name) {
return ss.getSheetByName(name) || ss.insertSheet(name);
}
function writeHeaders_(sheet, headers) {
sheet.getRange(1, 1, 1, headers.length)
.setValues([headers])
.setFontWeight("bold")
.setBackground("#E85D2D")
.setFontColor("#ffffff");
}
function writeHeadersAtRow_(sheet, headers, row) {
sheet.getRange(row, 1, 1, headers.length)
.setValues([headers])
.setFontWeight("bold")
.setBackground("#E85D2D")
.setFontColor("#ffffff");
}
// v2.7.2: Non-destructive header update — renames legacy headers, appends missing ones,
// and optionally syncs with Consolidated_Ledger headers from the CB spreadsheet.
// Never reorders or removes existing columns. Preserves data alignment.
var HEADER_RENAMES = {
  "Ledger Entry ID": "Ledger Row ID"
};

function ensureHeaderRow_(sheet, headers) {
  var lastCol = Math.max(1, sheet.getLastColumn());
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];

  // Step 1: Rename legacy headers in-place
  for (var ri = 0; ri < existing.length; ri++) {
    var h = String(existing[ri] || "").trim();
    if (HEADER_RENAMES[h]) {
      sheet.getRange(1, ri + 1).setValue(HEADER_RENAMES[h]);
      existing[ri] = HEADER_RENAMES[h];
    }
  }

  // Step 2: Build set of existing headers (case-insensitive)
  var existingSet = {};
  for (var ei = 0; ei < existing.length; ei++) {
    var norm = String(existing[ei] || "").trim().toUpperCase();
    if (norm) existingSet[norm] = true;
  }

  // Step 3: Append any missing headers at the end
  var appendCol = lastCol + 1;
  for (var hi = 0; hi < headers.length; hi++) {
    if (!existingSet[headers[hi].toUpperCase()]) {
      sheet.getRange(1, appendCol).setValue(headers[hi]).setFontWeight("bold");
      appendCol++;
    }
  }

  sheet.setFrozenRows(1);
}

/**
 * v2.7.2: Syncs Billing_Ledger headers with the Consolidated_Ledger on the CB spreadsheet.
 * Reads the Consolidated_Ledger header row, then ensures the client's Billing_Ledger
 * has all matching columns (renames legacy names, appends missing ones).
 * Columns only used by CB (Client Sheet ID, Source Row, Email Status, Date Added) are skipped.
 */
function syncBillingHeadersFromConsolidated_(ss) {
  var cbId = getSetting_(ss, CI_SETTINGS_KEYS.CONSOLIDATED_BILLING_SPREADSHEET_ID);
  if (!cbId) {
    Logger.log("[syncBillingHeaders] No CONSOLIDATED_BILLING_SPREADSHEET_ID set — skipping sync.");
    return;
  }

  try {
    var cbSs = SpreadsheetApp.openById(String(cbId).trim());
    var consolLedger = cbSs.getSheetByName("Consolidated_Ledger");
    if (!consolLedger || consolLedger.getLastColumn() < 1) {
      Logger.log("[syncBillingHeaders] Consolidated_Ledger not found or empty.");
      return;
    }

    var cbHeaders = consolLedger.getRange(1, 1, 1, consolLedger.getLastColumn()).getValues()[0];

    // CB-only columns that don't belong on the client ledger
    var CB_ONLY = {
      "CLIENT SHEET ID": true,
      "SOURCE ROW": true,
      "EMAIL STATUS": true,
      "DATE ADDED": true,
      "INVOICE URL": true
    };

    // Filter to only headers that should exist on the client
    var syncHeaders = [];
    for (var i = 0; i < cbHeaders.length; i++) {
      var h = String(cbHeaders[i] || "").trim();
      if (h && !CB_ONLY[h.toUpperCase()]) {
        syncHeaders.push(h);
      }
    }

    if (!syncHeaders.length) return;

    var billing = ss.getSheetByName(CI_SH.BILLING_LEDGER);
    if (!billing) return;

    // Use the same non-destructive ensureHeaderRow_ logic
    ensureHeaderRow_(billing, syncHeaders);
    Logger.log("[syncBillingHeaders] Synced " + syncHeaders.length + " headers from Consolidated_Ledger.");
  } catch (err) {
    Logger.log("[syncBillingHeaders] Error: " + err);
  }
}
function hasNonHeaderData_(sheet) {
if (!sheet) return false;
var lr = sheet.getLastRow();
if (lr < 2) return false;
var lc = Math.max(1, sheet.getLastColumn());
var values = sheet.getRange(2, 1, lr - 1, lc).getValues();
return values.some(function(r) { return r.some(function(c) { return String(c) !== ""; }); });
}
function readSettingsMap_(sheet) {
var map = {};
if (!sheet || sheet.getLastRow() < 2) return map;
sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function(row) {
var key = String(row[0] || "").trim();
if (key) map[key] = row[1];
});
return map;
}
function applyCheckbox_(sheet, ranges) {
if (!ranges || !ranges.length) return;
try {
var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
ranges.forEach(function(a1) { if (a1) sheet.getRange(a1).setDataValidation(rule); });
} catch (_) {}
}
function getHeaderMap_(sheet) {
var lastCol = sheet.getLastColumn();
if (lastCol < 1) return {};
var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
var map = {};
headers.forEach(function(h, i) {
var key = String(h || "").trim();
      if (key && !(key in map)) map[key] = i + 1;  // v2.5.0: first occurrence wins
});
return map;
}
function getHeaderMapAtRow_(sheet, headerRow) {
var lastCol = sheet.getLastColumn();
if (lastCol < 1) return {};
var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
var map = {};
headers.forEach(function(h, i) {
var key = String(h || "").trim();
      if (key && !(key in map)) map[key] = i + 1;  // v2.5.0: first occurrence wins
});
return map;
}
function maxColFromHeaderMap_(headerMap) {
var vals = Object.values(headerMap || {});
var maxCol = 0;
for (var i = 0; i < vals.length; i++) if (vals[i] > maxCol) maxCol = vals[i];
return maxCol;
}
function getCellByHeader_(rowArray, headerMap, headerName) {
var col = headerMap[headerName];
if (!col || col < 1) return "";
var idx = col - 1;
if (idx >= rowArray.length) return "";
var val = rowArray[idx];
return String(val != null ? val : "").trim();
}
function getCellByHeaderRaw_(rowArray, headerMap, headerName) {
var col = headerMap[headerName];
if (!col || col < 1) return null;
var idx = col - 1;
if (idx >= rowArray.length) return null;
return rowArray[idx];
}
function buildRowFromMap_(headerMap, valuesObj) {
var vals = Object.values(headerMap);
var maxCol = 0;
for (var i = 0; i < vals.length; i++) if (vals[i] > maxCol) maxCol = vals[i];
var row = new Array(maxCol).fill("");
var entries = Object.entries(valuesObj || {});
for (var j = 0; j < entries.length; j++) {
var header = entries[j][0];
var value = entries[j][1];
var col = headerMap[header];
if (col) row[col - 1] = (value !== undefined && value !== null) ? value : "";
}
return row;
}
function numOrBlank_(v) {
var n = parseFloat(v);
return isNaN(n) ? "" : n;
}
function truthy_(v) {
if (v === true) return true;
var s = String(v || "").trim().toLowerCase();
return ["true","yes","y","1","checked"].indexOf(s) !== -1;
}
function colA1Range_(sheet, header, startRow, endRow) {
var map = getHeaderMap_(sheet);
var col = map[header];
if (!col) return "";
return toA1Col_(col) + startRow + ":" + toA1Col_(col) + endRow;
}
function colA1RangeAtRow_(sheet, header, startRow, endRow, headerRow) {
var map = getHeaderMapAtRow_(sheet, headerRow);
var col = map[header];
if (!col) return "";
return toA1Col_(col) + startRow + ":" + toA1Col_(col) + endRow;
}
function toA1Col_(n) {
var s = "";
while (n > 0) {
var m = (n - 1) % 26;
s = String.fromCharCode(65 + m) + s;
n = Math.floor((n - 1) / 26);
}
return s;
}
function getSetting_(ss, key) {
var sh = ss.getSheetByName(CI_SH.SETTINGS);
if (!sh || sh.getLastRow() < 2) return "";
var data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
for (var i = 0; i < data.length; i++) {
if (String(data[i][0]).trim() === key) return String(data[i][1] || "").trim();
}
return "";
}

/**
 * v3.2.0: Writes a value to the Settings tab for the given key.
 * If the key exists, updates column B. If not, appends a new row.
 */
function setSetting_(ss, key, value) {
  var sh = ss.getSheetByName(CI_SH.SETTINGS);
  if (!sh) return;
  var lr = sh.getLastRow();
  if (lr >= 2) {
    var data = sh.getRange(2, 1, lr - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        sh.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sh.appendRow([key, value, ""]);
}

/**
 * v3.4.0: Gets or creates a top-level entity subfolder under DRIVE_PARENT_FOLDER_ID.
 * entityType = "Shipments" | "Tasks" | "Repairs" | "Will Calls"
 * Returns Folder object or null if DRIVE_PARENT_FOLDER_ID not set.
 */
function getOrCreateEntitySubfolder_(ss, entityType) {
  var parentId = getSetting_(ss, CI_SETTINGS_KEYS.DRIVE_PARENT_FOLDER_ID);
  if (!parentId) return null;
  try {
    var parent = DriveApp.getFolderById(parentId);
    var iter = parent.getFoldersByName(entityType);
    return iter.hasNext() ? iter.next() : parent.createFolder(entityType);
  } catch (e) {
    Logger.log("getOrCreateEntitySubfolder_ error (" + entityType + "): " + e);
    return null;
  }
}

/**
* Returns the last row with actual content in column 1 (or specified column).
* Unlike getLastRow(), this ignores rows that only have formatting or validation.
*/
function getLastDataRow_(sheet, col) {
col = col || 1;
var lr = sheet.getLastRow();
if (lr < 2) return 1;
// Scan columns A, B, and C to avoid false positives from dropdown validations/checkboxes
var scanCols = Math.min(3, sheet.getLastColumn());
var data = sheet.getRange(2, 1, lr - 1, scanCols).getValues();
var lastData = 1;
for (var i = data.length - 1; i >= 0; i--) {
  var hasContent = false;
  for (var c = 0; c < scanCols; c++) {
    var v = data[i][c];
    // Skip boolean false (unchecked checkboxes)
    if (v === false) continue;
    if (String(v || "").trim() !== "") { hasContent = true; break; }
  }
  if (hasContent) {
    lastData = i + 2;
    break;
  }
}
return lastData;
}
function tryGetEmail_() {
try {
return Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || "";
} catch (_) { return ""; }
}
function safeAlert_(msg) {
try { SpreadsheetApp.getUi().alert(msg); }
catch (_) { Logger.log("ALERT: " + msg); }
}
function clearAllProtections_(sheet) {
[SpreadsheetApp.ProtectionType.SHEET, SpreadsheetApp.ProtectionType.RANGE].forEach(function(type) {
sheet.getProtections(type).forEach(function(p) { try { p.remove(); } catch (_) {} });
});
}
function mergeEmails_() {
var emailStrings = Array.prototype.slice.call(arguments);
var seen = {};
return emailStrings
.reduce(function(acc, s) { return acc.concat(String(s || "").split(",")); }, [])
.map(function(e) { return e.trim(); })
.filter(function(e) {
if (!e || seen[e]) return false;
seen[e] = true;
return true;
})
.join(",");
}
function formatCurrency_(v) {
var n = Number(v);
return isNaN(n) ? String(v || "0") : n.toFixed(2);
}
function esc_(s) {
return String(s || "").replace(/[&<>"]/g, function(c) {
return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
});
}
/** Alias — receiving doc and work order code uses escHtml_() */
var escHtml_ = esc_;
function isSafeHttpUrl_(url) {
return /^https?:\/\//i.test(String(url || "").trim());
}
/* ============================================================
PHASE 3: CACHE + SETUP INSTRUCTIONS
============================================================ */
function StrideClientSetup_Phase3() {
StrideClientSetup();
buildSetupInstructionsSheet_();
StrideClientRefreshPriceClassCache();
safeAlert_("Phase 3 complete: Setup_Instructions built + cache refreshed (" + CI3_V + ").");
}
function StrideClientRefreshPriceClassCache() {
var ss = SpreadsheetApp.getActive();
var masterId = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID);
if (!masterId) { safeAlert_("Missing Settings.MASTER_SPREADSHEET_ID"); return; }
var master;
try {
master = SpreadsheetApp.openById(masterId);
} catch (err) {
safeAlert_("Could not open Master spreadsheet. Check MASTER_SPREADSHEET_ID.\n\n" + err);
return;
}
var priceSh = master.getSheetByName(CI3_MASTER_SH.PRICE_LIST);
var classSh = master.getSheetByName(CI3_MASTER_SH.CLASS_MAP);
if (!priceSh) { safeAlert_("Master sheet missing: " + CI3_MASTER_SH.PRICE_LIST); return; }
if (!classSh) { safeAlert_("Master sheet missing: " + CI3_MASTER_SH.CLASS_MAP); return; }
var priceCache = ensureSheet_(ss, CI3_SH.PRICECACHE);
var classCache = ensureSheet_(ss, CI3_SH.CLASSCACHE);
copySheetAsCache_(priceSh, priceCache, CI3_SH.PRICECACHE);
copySheetAsCache_(classSh, classCache, CI3_SH.CLASSCACHE);
cleanStrayClassCacheRows_(classCache);
// v4.0.4: Sync Email_Template_Cache from Master Price List
var emailTmplSh = master.getSheetByName(CI3_MASTER_SH.EMAIL_TEMPLATES);
if (emailTmplSh) {
  var emailCache = ensureSheet_(ss, CI3_SH.EMAILCACHE);
  copySheetAsCache_(emailTmplSh, emailCache, CI3_SH.EMAILCACHE);
}
applyClassDropdownValidationFromCache_();
// v3.1.0: Sync Location_Cache from Consolidated Billing
var locationMsg = "";
try {
  var cbId = getSetting_(ss, CI_SETTINGS_KEYS.CONSOLIDATED_BILLING_SPREADSHEET_ID);
  if (cbId) {
    var cbSs = SpreadsheetApp.openById(cbId);
    var locSrc = cbSs.getSheetByName("Locations");
    if (locSrc && locSrc.getLastRow() >= 2) {
      var locCache = ensureSheet_(ss, CI3_SH.LOCATIONCACHE);
      copySheetAsCache_(locSrc, locCache, CI3_SH.LOCATIONCACHE);
      applyLocationDropdownFromCache_();
      applyDockIntakeLocationDropdown_();
      locationMsg = "\nLocation_Cache synced + Location dropdowns updated.";
    } else {
      locationMsg = "\nNo Locations tab found on Consolidated Billing (skipped).";
    }
  } else {
    locationMsg = "\nNo CONSOLIDATED_BILLING_SPREADSHEET_ID set (Location_Cache skipped).";
  }
} catch (locErr) {
  CI_log_("WARN", "Location_Cache sync failed", String(locErr));
  locationMsg = "\nLocation_Cache sync failed: " + locErr;
}
// v2.6.2: Recalculate rates on all Unbilled billing rows using refreshed Price_Cache
var rateResult = recalcUnbilledRates_(ss);
var rateMsg = rateResult.updated > 0
  ? "\n\nUpdated rates on " + rateResult.updated + " of " + rateResult.total + " unbilled charges."
  : "\n\nNo unbilled charges to update.";
safeAlert_("Refreshed Price_Cache + Class_Cache + Email_Template_Cache." + locationMsg + rateMsg);
}
/**
 * StrideClientSyncCachesOnly_ — lightweight remote-safe cache sync.
 * Copies Price_Cache, Class_Cache, Email_Template_Cache, and Location_Cache
 * from Master / CB without running rate recalc or dropdown validation.
 * Called by StrideRemoteSyncCaches_() to avoid 6-minute timeout on large sheets.
 * The full StrideClientRefreshPriceClassCache() is still available from the menu.
 */
function StrideClientSyncCachesOnly_() {
  var ss = SpreadsheetApp.getActive();
  var masterId = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID);
  if (!masterId) return { ok: false, message: 'Missing MASTER_SPREADSHEET_ID' };

  var master;
  try { master = SpreadsheetApp.openById(masterId); }
  catch (err) { return { ok: false, message: 'Cannot open Master: ' + err }; }

  var priceSh = master.getSheetByName(CI3_MASTER_SH.PRICE_LIST);
  var classSh = master.getSheetByName(CI3_MASTER_SH.CLASS_MAP);
  if (!priceSh) return { ok: false, message: 'Master missing: ' + CI3_MASTER_SH.PRICE_LIST };
  if (!classSh) return { ok: false, message: 'Master missing: ' + CI3_MASTER_SH.CLASS_MAP };

  copySheetAsCache_(priceSh, ensureSheet_(ss, CI3_SH.PRICECACHE), CI3_SH.PRICECACHE);
  copySheetAsCache_(classSh, ensureSheet_(ss, CI3_SH.CLASSCACHE), CI3_SH.CLASSCACHE);
  cleanStrayClassCacheRows_(ensureSheet_(ss, CI3_SH.CLASSCACHE));

  var emailTmplSh = master.getSheetByName(CI3_MASTER_SH.EMAIL_TEMPLATES);
  if (emailTmplSh) {
    copySheetAsCache_(emailTmplSh, ensureSheet_(ss, CI3_SH.EMAILCACHE), CI3_SH.EMAILCACHE);
  }

  var locationMsg = 'Location_Cache skipped (no CB ID)';
  try {
    var cbId = getSetting_(ss, CI_SETTINGS_KEYS.CONSOLIDATED_BILLING_SPREADSHEET_ID);
    if (cbId) {
      var cbSs = SpreadsheetApp.openById(cbId);
      var locSrc = cbSs.getSheetByName('Locations');
      if (locSrc && locSrc.getLastRow() >= 2) {
        copySheetAsCache_(locSrc, ensureSheet_(ss, CI3_SH.LOCATIONCACHE), CI3_SH.LOCATIONCACHE);
        locationMsg = 'Location_Cache synced';
      } else {
        locationMsg = 'Location_Cache skipped (no Locations tab on CB)';
      }
    }
  } catch (locErr) {
    CI_log_('WARN', 'Location_Cache sync failed', String(locErr));
    locationMsg = 'Location_Cache failed: ' + locErr;
  }

  return { ok: true, message: 'Price/Class/Email caches synced. ' + locationMsg };
}

/* NOTE: recalcUnbilledRates_ and recalcPendingWillCallFees_ live in Billing.gs */

function StrideClientBuildSetupInstructions() {
buildSetupInstructionsSheet_();
safeAlert_("Setup_Instructions built/refreshed.");
}
function copySheetAsCache_(srcSheet, dstSheet, cacheName) {
var lr = srcSheet.getLastRow();
var lc = srcSheet.getLastColumn();
dstSheet.clearContents();
dstSheet.clearFormats();
if (lr < 1 || lc < 1) {
dstSheet.getRange(1, 1).setValue(cacheName + " (empty)");
return;
}
var values = srcSheet.getRange(1, 1, lr, lc).getValues();
dstSheet.getRange(1, 1, lr, lc).setValues(values);
try {
dstSheet.getRange(1, 1, 1, lc)
.setFontWeight("bold")
.setBackground("#0F172A")
.setFontColor("#ffffff");
dstSheet.setFrozenRows(1);
} catch (_) {}
try { dstSheet.autoResizeColumns(1, Math.min(lc, 20)); } catch (_) {}
}
function cleanStrayClassCacheRows_(classCache) {
if (!classCache || classCache.getLastRow() < 2) return;
var lr = classCache.getLastRow();
var lc = Math.max(classCache.getLastColumn(), 2);
var data = classCache.getRange(2, 1, lr - 1, lc).getValues();
for (var i = data.length - 1; i >= 0; i--) {
var cellA = String(data[i][0] || "").trim();
if (!cellA || cellA.toLowerCase().indexOf("url") !== -1) {
classCache.deleteRow(i + 2);
}
}
}
function applyClassDropdownValidationFromCache_() {
var ss = SpreadsheetApp.getActive();
var inv = ss.getSheetByName(CI_SH.INVENTORY);
if (!inv) return;
var classCache = ss.getSheetByName(CI3_SH.CLASSCACHE);
if (!classCache) return;
var invMap = getHeaderMap_(inv);
var classCol = invMap["Class"];
if (!classCol) return;
var lr = classCache.getLastRow();
if (lr < 2) return;
// v3.3.0: Use range-based validation (no 500-item limit) instead of requireValueInList
var sourceRange = classCache.getRange(2, 1, lr - 1, 1);
var rule = SpreadsheetApp.newDataValidation()
.requireValueInRange(sourceRange, true)
.setAllowInvalid(false)
.build();
inv.getRange(2, classCol, Math.max(inv.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/**
 * Apply a dropdown to the Inventory "Task Type" column using service NAMES from
 * the Price_Cache sheet. Users see names like "Inspection", "Assembly" etc.
 * v1.2.0: Changed from codes to names for user-friendly display.
 */
function applyServiceCodeDropdownFromCache_() {
    var ss = SpreadsheetApp.getActive();
    var inv = ss.getSheetByName(CI_SH.INVENTORY);
    if (!inv) return;
    var priceCache = ss.getSheetByName(CI3_SH.PRICECACHE);
    if (!priceCache) return;
    var invMap = getHeaderMap_(inv);
    var svcCol = invMap["Task Type"];
    if (!svcCol) return;
    var lr = priceCache.getLastRow();
    if (lr < 2) return;
    var pcMap = getHeaderMap_(priceCache);
    var nameCol = pcMap["Service Name"] || pcMap["Svc Name"] || 2;
    var showCol = pcMap["Show In Task Type"];
    var pcData = priceCache.getRange(2, 1, lr - 1, priceCache.getLastColumn()).getValues();
    // Filter to services marked "Show In Task Type" = TRUE (or include all if column doesn't exist)
    var svcNames = [];
    for (var i = 0; i < pcData.length; i++) {
      var name = String(pcData[i][nameCol - 1] || "").trim();
      if (!name) continue;
      if (showCol) {
        var show = pcData[i][showCol - 1];
        if (!show || String(show).toLowerCase() === "false" || show === false) continue;
      }
      svcNames.push(name);
    }
    // Remove duplicates
    var unique = [];
    var seen = {};
    for (var i = 0; i < svcNames.length; i++) {
      if (!seen[svcNames[i]]) { unique.push(svcNames[i]); seen[svcNames[i]] = true; }
    }
    if (!unique.length) return;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(unique, true)
      .setAllowInvalid(false)
      .build();
    inv.getRange(2, svcCol, Math.max(inv.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/**
 * v1.2.0: Look up service code from service name using Price_Cache.
 */
function lookupSvcCodeByName_(ss, svcName) {
  if (!svcName) return svcName;
  try {
    var pc = ss.getSheetByName(CI3_SH.PRICECACHE);
    if (!pc || pc.getLastRow() < 2) return svcName;
    var pcMap = getHeaderMap_(pc);
    var codeCol = pcMap["Service Code"] || pcMap["Svc Code"] || 1;
    var nameCol = pcMap["Service Name"] || pcMap["Svc Name"] || 2;
    var data = pc.getRange(2, 1, pc.getLastRow() - 1, pc.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][nameCol - 1] || "").trim() === svcName) {
        return String(data[i][codeCol - 1] || "").trim();
      }
    }
  } catch (e) {}
  return svcName; // fallback: return as-is if not found
}

/**
 * v1.2.0: Look up service name from service code using Price_Cache.
 */
function lookupSvcNameByCode_(ss, svcCode) {
  if (!svcCode) return svcCode;
  try {
    var pc = ss.getSheetByName(CI3_SH.PRICECACHE);
    if (!pc || pc.getLastRow() < 2) return svcCode;
    var pcMap = getHeaderMap_(pc);
    var codeCol = pcMap["Service Code"] || pcMap["Svc Code"] || 1;
    var nameCol = pcMap["Service Name"] || pcMap["Svc Name"] || 2;
    var data = pc.getRange(2, 1, pc.getLastRow() - 1, pc.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][codeCol - 1] || "").trim().toUpperCase() === svcCode.toUpperCase()) {
        return String(data[i][nameCol - 1] || "").trim() || svcCode;
      }
    }
  } catch (e) {}
  return svcCode;
}
function buildSetupInstructionsSheet_() {
var ss = SpreadsheetApp.getActive();
var sh = ensureSheet_(ss, CI3_SH.SETUP_INSTRUCTIONS);
sh.clearContents();
sh.clearFormats();
var now = new Date();
var tz = (getSetting_(ss, CI_SETTINGS_KEYS.TIMEZONE) || Session.getScriptTimeZone());
var stamped = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
var settings = ss.getSheetByName(CI_SH.SETTINGS);
var settingsMap = settings ? readSettingsMap_(settings) : {};
var clientName = String(settingsMap[CI_SETTINGS_KEYS.CLIENT_NAME] || "").trim();
var masterId = String(settingsMap[CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID] || "").trim();
var rpcUrl = String(settingsMap[CI_SETTINGS_KEYS.MASTER_RPC_URL] || "").trim();
var rpcToken = String(settingsMap[CI_SETTINGS_KEYS.MASTER_RPC_TOKEN] || "").trim();
var parentId = String(settingsMap[CI_SETTINGS_KEYS.DRIVE_PARENT_FOLDER_ID] || "").trim();
sh.getRange(1, 1).setValue("Stride Client Inventory - Setup Instructions").setFontWeight("bold").setFontSize(16);
sh.getRange(2, 1).setValue("Client:").setFontWeight("bold");
sh.getRange(2, 2).setValue(clientName || "(not set)");
sh.getRange(3, 1).setValue("Script Versions:").setFontWeight("bold");
sh.getRange(3, 2).setValue("Core: " + CI_V + " | Phase 3: " + CI3_V);
sh.getRange(4, 1).setValue("Generated:").setFontWeight("bold");
sh.getRange(4, 2).setValue(stamped);
var start = 6;
var checklist = [
["PRE-FLIGHT CHECKLIST", ""],
["1) Master Spreadsheet ID set (Settings)", masterId ? "OK" : "MISSING"],
["2) Master RPC URL set (Settings)", rpcUrl ? "OK" : "MISSING"],
["3) Master RPC Token set (Settings)", rpcToken ? "OK" : "MISSING"],
["4) Drive Parent Folder ID set (Settings)",parentId ? "OK" : "MISSING"],
["5) Triggers installed", "MANUAL CHECK"],
      // [PROTECTIONS REMOVED] ["6) Protections applied", "MANUAL CHECK"],
["7) Cache refreshed", "RECOMMENDED"]
];
sh.getRange(start, 1, checklist.length, 2).setValues(checklist);
sh.getRange(start, 1, 1, 2).setFontWeight("bold").setBackground("#E85D2D").setFontColor("#ffffff");
var stepsRow = start + checklist.length + 2;
var steps = [
["QUICK START (NEW CLIENT SHEET)", ""],
["A) Run: StrideClientSetup() or StrideClientSetup_Phase3()", ""],
["B) Fill Settings values (see checklist above)", ""],
["C) Run: StrideClientInstallTriggers()", ""],
      // [PROTECTIONS REMOVED] ["D) Run: StrideClientApplyProtections()", ""],
["E) Run: StrideClientRefreshPriceClassCache()", ""],
["F) Start intake: Stride Warehouse > Start New Shipment", ""]
];
sh.getRange(stepsRow, 1, steps.length, 2).setValues(steps);
sh.getRange(stepsRow, 1, 1, 2).setFontWeight("bold").setBackground("#0F172A").setFontColor("#ffffff");
var snapRow = stepsRow + steps.length + 2;
sh.getRange(snapRow, 1).setValue("LIVE SHEET LAYOUT SNAPSHOT (headers)").setFontWeight("bold");
var snapshot = [
["Inventory headers", joinHeaders_(ss, CI_SH.INVENTORY)],
["Tasks headers", joinHeaders_(ss, CI_SH.TASKS)],
["Repairs headers", joinHeaders_(ss, CI_SH.REPAIRS)],
["Billing_Ledger headers", joinHeaders_(ss, CI_SH.BILLING_LEDGER)]
];
sh.getRange(snapRow + 1, 1, snapshot.length, 2).setValues(snapshot);
sh.getRange(snapRow + 1, 1, snapshot.length, 1).setFontWeight("bold");
try {
sh.autoResizeColumns(1, 2);
sh.setColumnWidth(2, 700);
sh.getRange(1, 1, snapRow + 1 + snapshot.length, 2).setWrap(true).setVerticalAlignment("top");
sh.setFrozenRows(5);
} catch (_) {}
}
function joinHeaders_(ss, sheetName) {
var sh = ss.getSheetByName(sheetName);
if (!sh) return "(missing sheet)";
var lc = sh.getLastColumn();
if (lc < 1) return "(no headers)";
var headers = sh.getRange(1, 1, 1, lc).getValues()[0]
.map(function(h) { return String(h || "").trim(); })
.filter(Boolean);
return headers.length ? headers.join(" | ") : "(no headers)";
}
/* ============================================================
PHASE 4: INVENTORY VIEW FILTERS (v2.4.0)
============================================================ */
/**
* Sets Inventory filter to show only Active items.
*/
function StrideViewActiveInventory() {
  setInventoryStatusFilter_([INVENTORY_STATUS.RELEASED, INVENTORY_STATUS.ON_HOLD, "Transferred"]);
}
/**
 * Sets Inventory filter to show only Released items.
 */
function StrideViewReleasedInventory() {
  setInventoryStatusFilter_([INVENTORY_STATUS.ACTIVE, INVENTORY_STATUS.ON_HOLD, "Transferred"]);
}
/**
 * Clears Inventory Status filter to show all items.
 */
function StrideViewAllInventory() {
  var ss = SpreadsheetApp.getActive();
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv) { safeAlert_("Inventory sheet not found."); return; }
  var map = getHeaderMap_(inv);
  var statusCol = map["Status"];
  if (!statusCol) { safeAlert_("Status column not found on Inventory."); return; }
  try {
    var filter = inv.getFilter();
    if (filter) filter.removeColumnFilterCriteria(statusCol);
  } catch (err) {
    Logger.log("StrideViewAllInventory error: " + err);
  }
  // silent — no popup
}

/* ============================================================
   REQUEST INSPECTION — Client-facing menu action (v3.0.1)
   Sets Task Type to "Inspection" and checks Create Task for
   the selected inventory row(s). The onClientEdit trigger
   handles the rest (task creation, email notification).
   ============================================================ */
function StrideRequestInspection() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  var activeSheet = ss.getActiveSheet();
  if (!inv || activeSheet.getName() !== CI_SH.INVENTORY) {
    safeAlert_("Please select one or more item rows on the Inventory tab first.");
    return;
  }
  var range = ss.getActiveRange();
  if (!range || range.getRow() < 2) {
    safeAlert_("Please select a data row (not the header).");
    return;
  }
  var map = getHeaderMap_(inv);
  var taskTypeCol = map["Task Type"];
  var createTaskCol = map["Create Task"];
  var itemIdCol = map["Item ID"];
  if (!taskTypeCol || !createTaskCol || !itemIdCol) {
    safeAlert_("Required columns not found: Task Type, Create Task, or Item ID.");
    return;
  }
  var startRow = range.getRow();
  var numRows = range.getNumRows();
  var requested = [];
  for (var r = startRow; r < startRow + numRows; r++) {
    var itemId = inv.getRange(r, itemIdCol).getValue();
    if (!itemId) continue;
    inv.getRange(r, taskTypeCol).setValue("INSP");
    inv.getRange(r, createTaskCol).setValue(true);
    requested.push(String(itemId));
  }
  if (requested.length === 0) {
    safeAlert_("No items found in selected rows.");
    return;
  }
  safeAlert_("Inspection requested for " + requested.length + " item(s): " + requested.join(", "));
}

/* ============================================================
   VIEW ITEM HISTORY — Shows all tasks, repairs, and billing
   for the selected inventory item in a popup dialog.
   ============================================================ */
function StrideViewItemHistory() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var activeSheet = ss.getActiveSheet();
  var activeRange = ss.getActiveRange();

  if (!activeRange || activeRange.getRow() < 2) {
    ui.alert("Select an item row on the Inventory tab first.");
    return;
  }

  // Get Item ID from the selected row
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv || activeSheet.getName() !== CI_SH.INVENTORY) {
    ui.alert("Please click on a row in the Inventory tab first.");
    return;
  }
  var invMap = getHeaderMap_(inv);
  var itemIdCol = invMap["Item ID"];
  if (!itemIdCol) { ui.alert("Item ID column not found."); return; }

  // Support multiple selected rows
  var startRow = activeRange.getRow();
  var numRows = activeRange.getNumRows();
  var itemIds = [];
  var itemRows = []; // row numbers
  for (var ri = 0; ri < numRows; ri++) {
    var r = startRow + ri;
    var id = String(inv.getRange(r, itemIdCol).getValue() || "").trim();
    if (id && itemIds.indexOf(id) === -1) { itemIds.push(id); itemRows.push(r); }
  }
  if (!itemIds.length) { ui.alert("No Item IDs found in the selected rows."); return; }

  // Pre-load all related data once (not per-item) for performance
  var tasksSh = ss.getSheetByName(CI_SH.TASKS);
  var tData = [], tMap = {};
  if (tasksSh && tasksSh.getLastRow() >= 2) {
    tData = tasksSh.getDataRange().getValues();
    tData[0].forEach(function(h, i) { tMap[String(h || "").trim()] = i; });
  }
  var repairsSh = ss.getSheetByName(CI_SH.REPAIRS);
  var rData = [], rMap = {};
  if (repairsSh && repairsSh.getLastRow() >= 2) {
    rData = repairsSh.getDataRange().getValues();
    rData[0].forEach(function(h, i) { rMap[String(h || "").trim()] = i; });
  }
  var billingSh = ss.getSheetByName(CI_SH.BILLING_LEDGER);
  var bData = [], bMap = {};
  if (billingSh && billingSh.getLastRow() >= 2) {
    bData = billingSh.getDataRange().getValues();
    bData[0].forEach(function(h, i) { bMap[String(h || "").trim()] = i; });
  }
  var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  var wciData = [], wciMap = {}, wcLookup = {}, wcMapHist = {};
  if (wciSh && wcSh && wciSh.getLastRow() >= 2 && wcSh.getLastRow() >= 2) {
    wciData = wciSh.getDataRange().getValues();
    wciData[0].forEach(function(h, i) { wciMap[String(h || "").trim()] = i; });
    var wcDataHist = wcSh.getDataRange().getValues();
    wcDataHist[0].forEach(function(h, i) { wcMapHist[String(h || "").trim()] = i; });
    for (var wh = 1; wh < wcDataHist.length; wh++) {
      var whNum = String(wcDataHist[wh][wcMapHist["WC Number"]] || "").trim();
      if (whNum) wcLookup[whNum] = wcDataHist[wh];
    }
  }

  var thStyle = 'padding:6px 8px;font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase;border-bottom:2px solid #E2E8F0;';
  var fullHtml = '<div style="font-family:Arial,sans-serif;color:#1E293B;padding:16px;">';

  // Loop through each selected item
  for (var ix = 0; ix < itemIds.length; ix++) {
    var itemId = itemIds[ix];
    var row = itemRows[ix];

    // Read item details
    var rowData = inv.getRange(row, 1, 1, inv.getLastColumn()).getValues()[0];
    var itemDesc = getCellByHeader_(rowData, invMap, "Description") || "-";
    var itemVendor = getCellByHeader_(rowData, invMap, "Vendor") || "-";
    var itemClass = getCellByHeader_(rowData, invMap, "Class") || "-";
    var itemSidemark = getCellByHeader_(rowData, invMap, "Sidemark") || "-";
    var itemStatus = getCellByHeader_(rowData, invMap, "Status") || "-";
    var itemLocation = getCellByHeader_(rowData, invMap, "Location") || "-";
    var itemNotes = getCellByHeader_(rowData, invMap, "Item Notes") || "";

    var itemShipPhotos = "", itemInspPhotos = "";
    var shipColH = invMap["Shipment #"];
    if (shipColH) { try { var shipRt = inv.getRange(row, shipColH).getRichTextValue(); if (shipRt) itemShipPhotos = shipRt.getLinkUrl() || ""; } catch (_) {} }
    var invItemIdColH = invMap["Item ID"];
    if (invItemIdColH) { try { var invItemRtH = inv.getRange(row, invItemIdColH).getRichTextValue(); if (invItemRtH) { var idLnk = invItemRtH.getLinkUrl() || ""; if (idLnk && idLnk !== itemShipPhotos) itemInspPhotos = idLnk; } } catch (_) {} }

    // Item header card
    if (ix > 0) fullHtml += '<div style="border-top:3px solid #E85D2D;margin:20px 0;"></div>';
    fullHtml += '<div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px;">' +
      '<div style="font-size:18px;font-weight:900;margin-bottom:4px;">Item ' + escHtml_(itemId) + '</div>' +
      '<div style="font-size:13px;color:#64748B;">' + escHtml_(itemDesc) + ' \u00B7 ' + escHtml_(itemVendor) + ' \u00B7 Class ' + escHtml_(itemClass) + '</div>' +
      '<div style="font-size:13px;color:#64748B;margin-top:2px;">Location: ' + escHtml_(itemLocation) + ' \u00B7 Sidemark: ' + escHtml_(itemSidemark) + ' \u00B7 Status: <b>' + escHtml_(itemStatus) + '</b></div>' +
      (itemNotes ? '<div style="font-size:12px;color:#475569;margin-top:6px;padding:6px 10px;background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;"><b>Item Notes:</b> ' + escHtml_(itemNotes) + '</div>' : '') +
      '<div style="margin-top:6px;">' +
      (itemShipPhotos ? '<a href="' + escHtml_(itemShipPhotos) + '" target="_blank" style="display:inline-block;background:#F1F5F9;color:#E85D2D;text-decoration:none;font-weight:600;padding:4px 10px;border-radius:6px;font-size:12px;margin-right:6px;">Shipment Photos</a>' : '') +
      (itemInspPhotos ? '<a href="' + escHtml_(itemInspPhotos) + '" target="_blank" style="display:inline-block;background:#F1F5F9;color:#E85D2D;text-decoration:none;font-weight:600;padding:4px 10px;border-radius:6px;font-size:12px;margin-right:6px;">Inspection Photos</a>' : '') +
      '</div></div>';

      // Collect Tasks for this item
    var tasksHtml = "";
    var taskCount = 0;
    var tItemIdCol = tMap["Item ID"];
    if (tData.length > 1 && tItemIdCol !== undefined) {
      for (var t = 1; t < tData.length; t++) {
        if (String(tData[t][tItemIdCol] || "").trim() !== itemId) continue;
        taskCount++;
        var tStatus = tMap["Status"] !== undefined ? String(tData[t][tMap["Status"]] || "") : "";
        var tResult = tMap["Result"] !== undefined ? String(tData[t][tMap["Result"]] || "") : "";
        var tSvcCode = tMap["Svc Code"] !== undefined ? String(tData[t][tMap["Svc Code"]] || "") : "";
        var tType = tMap["Type"] !== undefined ? String(tData[t][tMap["Type"]] || "") : "";
        var tTaskNotes = tMap["Task Notes"] !== undefined ? String(tData[t][tMap["Task Notes"]] || "") : "";
        var tItemNotes = tMap["Item Notes"] !== undefined ? String(tData[t][tMap["Item Notes"]] || "") : "";
        var tNotes = [tTaskNotes, tItemNotes].filter(Boolean).join(" | ");
        var tCreated = tMap["Created"] !== undefined ? tData[t][tMap["Created"]] : "";
        var tCompAt = tMap["Completed At"] !== undefined ? tData[t][tMap["Completed At"]] : "";
        var tTaskId = tMap["Task ID"] !== undefined ? String(tData[t][tMap["Task ID"]] || "") : "";

        // v2.6.4: Get task folder URL from Task ID hyperlink
        var tTaskFolderUrl = "";
        var tTaskIdColH = tMap["Task ID"];
        if (tTaskIdColH !== undefined) {
          var tTaskRtH = tasksSh.getRange(t + 1, tTaskIdColH + 1).getRichTextValue();
          if (tTaskRtH) tTaskFolderUrl = tTaskRtH.getLinkUrl() || "";
        }

        var resultBadge = "";
        if (tResult === "Pass" || tResult === "PASS") resultBadge = '<span style="background:#16A34A;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">Pass</span>';
        else if (tResult === "Fail" || tResult === "FAIL") resultBadge = '<span style="background:#DC2626;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">Fail</span>';

        var statusColor = tStatus === "Completed" ? "#16A34A" : tStatus === "Cancelled" ? "#94A3B8" : "#E85D2D";

        var tPhotoLinks = "";
        if (tTaskFolderUrl) tPhotoLinks += '<a href="' + escHtml_(tTaskFolderUrl) + '" target="_blank" style="color:#E85D2D;font-size:11px;text-decoration:none;">Photos</a>';

        tasksHtml += '<tr>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:600;">' + escHtml_(tTaskId) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + escHtml_(tSvcCode || tType) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:' + statusColor + ';font-weight:600;">' + escHtml_(tStatus) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + resultBadge + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#475569;">' + escHtml_(tNotes) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + tPhotoLinks + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;color:#94A3B8;">' + formatDateShort_(tCompAt || tCreated) + '</td>' +
          '</tr>';
      }
    }

    // Collect Repairs for this item
    var repairsHtml = "";
    var repairCount = 0;
    var rItemIdCol = rMap["Item ID"];
    if (rData.length > 1 && rItemIdCol !== undefined) {
      for (var r = 1; r < rData.length; r++) {
        if (String(rData[r][rItemIdCol] || "").trim() !== itemId) continue;
        repairCount++;
        var rStatus = rMap["Status"] !== undefined ? String(rData[r][rMap["Status"]] || "") : "";
        var rResult = rMap["Repair Result"] !== undefined ? String(rData[r][rMap["Repair Result"]] || "") : "";
        var rQuote = rMap["Quote Amount"] !== undefined ? rData[r][rMap["Quote Amount"]] : "";
        var rFinal = rMap["Final Amount"] !== undefined ? rData[r][rMap["Final Amount"]] : "";
        var rNotes = rMap["Repair Notes"] !== undefined ? String(rData[r][rMap["Repair Notes"]] || "") : "";
        var rTaskNotes = rMap["Task Notes"] !== undefined ? String(rData[r][rMap["Task Notes"]] || "") : "";
        var rItemNotes = rMap["Item Notes"] !== undefined ? String(rData[r][rMap["Item Notes"]] || "") : "";
        var rAllNotes = [rNotes, rTaskNotes, rItemNotes].filter(Boolean).join(" | ");
        var rRepairId = rMap["Repair ID"] !== undefined ? String(rData[r][rMap["Repair ID"]] || "") : "";
        var rVendor = rMap["Repair Vendor"] !== undefined ? String(rData[r][rMap["Repair Vendor"]] || "") : "";
        var rCompDt = rMap["Completed Date"] !== undefined ? rData[r][rMap["Completed Date"]] : "";

        // v2.6.4: Get repair folder URL from Repair ID hyperlink
        var rRepairFolderUrl = "";
        var rRepairIdColH = rMap["Repair ID"];
        if (rRepairIdColH !== undefined) {
          var rRepairRtH = repairsSh.getRange(r + 1, rRepairIdColH + 1).getRichTextValue();
          if (rRepairRtH) rRepairFolderUrl = rRepairRtH.getLinkUrl() || "";
        }

        var rResultBadge = "";
        if (rResult === "Pass" || rResult === "PASS") rResultBadge = '<span style="background:#16A34A;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">Pass</span>';
        else if (rResult === "Fail" || rResult === "FAIL") rResultBadge = '<span style="background:#DC2626;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">Fail</span>';

        var rStatusColor = rStatus === "Complete" ? "#16A34A" : rStatus === "Cancelled" ? "#94A3B8" : "#E85D2D";
        var rAmt = rFinal || rQuote;
        var rAmtStr = rAmt ? "$" + Number(rAmt).toFixed(2) : "-";

        var rPhotoLinks = "";
        if (rRepairFolderUrl) rPhotoLinks += '<a href="' + escHtml_(rRepairFolderUrl) + '" target="_blank" style="color:#E85D2D;font-size:11px;text-decoration:none;">Photos</a>';

        repairsHtml += '<tr>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:600;">' + escHtml_(rRepairId) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:' + rStatusColor + ';font-weight:600;">' + escHtml_(rStatus) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + rResultBadge + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:600;">' + escHtml_(rAmtStr) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;">' + escHtml_(rVendor) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#475569;">' + escHtml_(rAllNotes) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + rPhotoLinks + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;color:#94A3B8;">' + formatDateShort_(rCompDt) + '</td>' +
          '</tr>';
      }
    }

    // Collect Billing for this item
    var billingHtml = "";
    var billingCount = 0;
    var bItemIdCol = bMap["Item ID"];
    if (bData.length > 1 && bItemIdCol !== undefined) {
      for (var b = 1; b < bData.length; b++) {
        if (String(bData[b][bItemIdCol] || "").trim() !== itemId) continue;
        billingCount++;
        var bStatus = bMap["Status"] !== undefined ? String(bData[b][bMap["Status"]] || "") : "";
        var bSvcCode = bMap["Svc Code"] !== undefined ? String(bData[b][bMap["Svc Code"]] || "") : "";
        var bSvcName = bMap["Svc Name"] !== undefined ? String(bData[b][bMap["Svc Name"]] || "") : "";
        var bTotal = bMap["Total"] !== undefined ? bData[b][bMap["Total"]] : "";
        var bDate = bMap["Date"] !== undefined ? bData[b][bMap["Date"]] : "";
        var bInvNo = bMap["Invoice #"] !== undefined ? String(bData[b][bMap["Invoice #"]] || "") : "";
        var bItemNotes = bMap["Item Notes"] !== undefined ? String(bData[b][bMap["Item Notes"]] || "") : "";

        var bStatusColor = bStatus === "Unbilled" ? "#E85D2D" : bStatus === "Invoiced" ? "#16A34A" : "#94A3B8";
        var bTotalStr = bTotal !== "" ? "$" + Number(bTotal).toFixed(2) : "-";

        billingHtml += '<tr>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + formatDateShort_(bDate) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + escHtml_(bSvcCode) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + escHtml_(bSvcName) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:600;">' + escHtml_(bTotalStr) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:' + bStatusColor + ';font-weight:600;">' + escHtml_(bStatus) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;">' + escHtml_(bInvNo) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#475569;">' + escHtml_(bItemNotes) + '</td>' +
          '</tr>';
      }
    }

    // Tasks section for this item
    fullHtml += '<div style="font-size:14px;font-weight:800;margin-bottom:6px;">Tasks (' + taskCount + ')</div>';
    if (taskCount > 0) {
      fullHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
        '<tr><th style="' + thStyle + '">Task ID</th><th style="' + thStyle + '">Type</th><th style="' + thStyle + '">Status</th><th style="' + thStyle + '">Result</th><th style="' + thStyle + '">Notes</th><th style="' + thStyle + '">Photos</th><th style="' + thStyle + '">Date</th></tr>' +
        tasksHtml + '</table>';
    } else {
      fullHtml += '<div style="color:#94A3B8;font-size:13px;margin-bottom:16px;">No tasks for this item.</div>';
    }

    // Repairs section for this item
    fullHtml += '<div style="font-size:14px;font-weight:800;margin-bottom:6px;">Repairs (' + repairCount + ')</div>';
    if (repairCount > 0) {
      fullHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
        '<tr><th style="' + thStyle + '">Repair ID</th><th style="' + thStyle + '">Status</th><th style="' + thStyle + '">Result</th><th style="' + thStyle + '">Amount</th><th style="' + thStyle + '">Vendor</th><th style="' + thStyle + '">Notes</th><th style="' + thStyle + '">Photos</th><th style="' + thStyle + '">Date</th></tr>' +
        repairsHtml + '</table>';
    } else {
      fullHtml += '<div style="color:#94A3B8;font-size:13px;margin-bottom:16px;">No repairs for this item.</div>';
    }

    // Billing section for this item
    fullHtml += '<div style="font-size:14px;font-weight:800;margin-bottom:6px;">Billing (' + billingCount + ')</div>';
    if (billingCount > 0) {
      fullHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
        '<tr><th style="' + thStyle + '">Date</th><th style="' + thStyle + '">Code</th><th style="' + thStyle + '">Service</th><th style="' + thStyle + '">Total</th><th style="' + thStyle + '">Status</th><th style="' + thStyle + '">Invoice #</th><th style="' + thStyle + '">Notes</th></tr>' +
        billingHtml + '</table>';
    } else {
      fullHtml += '<div style="color:#94A3B8;font-size:13px;margin-bottom:16px;">No billing entries for this item.</div>';
    }

    // Will Calls section for this item
    var wcHtml = "";
    var wcCount = 0;
    var wciItemCol = wciMap["Item ID"];
    var wciWcCol = wciMap["WC Number"];
    if (wciData.length > 1 && wciItemCol !== undefined && wciWcCol !== undefined) {
      for (var wci = 1; wci < wciData.length; wci++) {
        if (String(wciData[wci][wciItemCol] || "").trim() !== itemId) continue;
        wcCount++;
        var wcNum = String(wciData[wci][wciWcCol] || "").trim();
        var wcRow = wcLookup[wcNum];
        var wcStatus = wcRow ? String(wcRow[wcMapHist["Status"]] || "") : "";
        var wcParty = wcRow ? String(wcRow[wcMapHist["Pickup Party"]] || "") : "";
        var wcPickupDate = wcRow ? (wcRow[wcMapHist["Actual Pickup Date"]] || wcRow[wcMapHist["Estimated Pickup Date"]] || "") : "";
        var wcCod = wcRow ? truthy_(wcRow[wcMapHist["COD"]]) : false;
        var wcNotes = wcRow && wcMapHist["Notes"] !== undefined ? String(wcRow[wcMapHist["Notes"]] || "") : "";
        var wcStatusColor = wcStatus === "Released" ? "#16A34A" : wcStatus === "Cancelled" ? "#94A3B8" : "#E85D2D";
        var wcCodBadge = wcCod ? '<span style="background:#DC2626;color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;">COD</span>' : '';
        wcHtml += '<tr>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:600;">' + escHtml_(wcNum) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:' + wcStatusColor + ';font-weight:600;">' + escHtml_(wcStatus) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + escHtml_(wcParty) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + formatDateShort_(wcPickupDate) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#475569;">' + escHtml_(wcNotes) + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + wcCodBadge + '</td>' +
          '</tr>';
      }
    }
    fullHtml += '<div style="font-size:14px;font-weight:800;margin-bottom:6px;">Will Calls (' + wcCount + ')</div>';
    if (wcCount > 0) {
      fullHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
        '<tr><th style="' + thStyle + '">WC Number</th><th style="' + thStyle + '">Status</th><th style="' + thStyle + '">Pickup Party</th><th style="' + thStyle + '">Date</th><th style="' + thStyle + '">Notes</th><th style="' + thStyle + '">COD</th></tr>' +
        wcHtml + '</table>';
    } else {
      fullHtml += '<div style="color:#94A3B8;font-size:13px;margin-bottom:16px;">No will calls for this item.</div>';
    }

  } // end item loop

  fullHtml += '</div>';

  var dialogTitle = itemIds.length > 1 ? "Item History \u2014 " + itemIds.length + " items" : "Item History \u2014 " + itemIds[0];
  var output = HtmlService.createHtmlOutput(fullHtml)
    .setWidth(780)
    .setHeight(550);
  ui.showModalDialog(output, dialogTitle);
}

/* ============================================================
   INVENTORY FILTER & DOCK INTAKE HELPERS
   ============================================================ */
/* NOTE: formatDateShort_ lives in Emails.gs */

/**
* Helper: applies a filter on Inventory Status column hiding the given values.
*/
function setInventoryStatusFilter_(hiddenValues) {
var ss = SpreadsheetApp.getActive();
var inv = ss.getSheetByName(CI_SH.INVENTORY);
if (!inv) { safeAlert_("Inventory sheet not found."); return; }
var map = getHeaderMap_(inv);
var statusCol = map["Status"];
if (!statusCol) { safeAlert_("Status column not found on Inventory."); return; }
try {
var filter = inv.getFilter();
// Remove old filter and recreate with full sheet range so new rows are always included
if (filter) filter.remove();
var maxRows = inv.getMaxRows();
var maxCols = inv.getMaxColumns();
inv.getRange(1, 1, maxRows, maxCols).createFilter();
filter = inv.getFilter();
if (!filter) return;
var crit = SpreadsheetApp.newFilterCriteria()
.setHiddenValues(hiddenValues)
.build();
filter.setColumnFilterCriteria(statusCol, crit);
} catch (err) {
Logger.log("setInventoryStatusFilter_ error: " + err);
}
}
/**
* Sets default Inventory filter to show Active only. Called from setup.
*/
function ensureInventoryDefaultFilter_(invSheet) {
try {
var map = getHeaderMap_(invSheet);
var statusCol = map["Status"];
if (!statusCol) return;
var filter = invSheet.getFilter();
if (!filter) {
invSheet.getDataRange().createFilter();
filter = invSheet.getFilter();
}
if (!filter) return;
var crit = SpreadsheetApp.newFilterCriteria()
.setHiddenValues([INVENTORY_STATUS.RELEASED, INVENTORY_STATUS.ON_HOLD])
.build();
filter.setColumnFilterCriteria(statusCol, crit);
} catch (err) {
Logger.log("ensureInventoryDefaultFilter_ warning: " + err);
}
}
/**
* Wires Dock Intake Class column to Class_Cache dropdown. Called from setup.
*/
function applyDockIntakeClassDropdown_(dock) {
var ss = SpreadsheetApp.getActive();
var classCache = ss.getSheetByName(CI3_SH.CLASSCACHE);
if (!classCache || classCache.getLastRow() < 2) return;
var map = getHeaderMapAtRow_(dock, DOCK_ITEMS_HEADER_ROW);
var classCol = map["Class"];
if (!classCol) return;
// v3.3.0: Use range-based validation (no 500-item limit) instead of requireValueInList
var lr = classCache.getLastRow();
var sourceRange = classCache.getRange(2, 1, lr - 1, 1);
var rule = SpreadsheetApp.newDataValidation()
.requireValueInRange(sourceRange, true)
.setAllowInvalid(false)
.build();
dock.getRange(DOCK_ITEMS_DATA_START_ROW, classCol, 5000, 1).setDataValidation(rule);
}

/**
 * v3.1.0: Apply Location dropdown on Inventory tab from Location_Cache.
 * Allows invalid entries so users can still type custom locations.
 */
function applyLocationDropdownFromCache_() {
  var ss = SpreadsheetApp.getActive();
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv) return;
  var locCache = ss.getSheetByName(CI3_SH.LOCATIONCACHE);
  if (!locCache || locCache.getLastRow() < 2) return;
  var invMap = getHeaderMap_(inv);
  var locCol = invMap["Location"];
  if (!locCol) return;
  var locVals = locCache.getRange(2, 1, locCache.getLastRow() - 1, 1).getValues()
    .flat()
    .map(function(x) { return String(x || "").trim(); })
    .filter(Boolean);
  // v3.3.0: Use range-based validation (no 500-item limit)
  var locLr = locCache.getLastRow();
  var locSourceRange = locCache.getRange(2, 1, locLr - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(locSourceRange, true)
    .setAllowInvalid(true)
    .build();
  inv.getRange(2, locCol, Math.max(inv.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/**
 * v3.1.0: Apply Location dropdown on Dock Intake tab from Location_Cache.
 * Allows invalid entries so users can still type custom locations.
 */
function applyDockIntakeLocationDropdown_() {
  var ss = SpreadsheetApp.getActive();
  var dock = ss.getSheetByName(CI_SH.DOCK);
  if (!dock) return;
  var locCache = ss.getSheetByName(CI3_SH.LOCATIONCACHE);
  if (!locCache || locCache.getLastRow() < 2) return;
  var map = getHeaderMapAtRow_(dock, DOCK_ITEMS_HEADER_ROW);
  var locCol = map["Location"];
  if (!locCol) return;
  // v3.3.0: Use range-based validation (no 500-item limit)
  var locLr = locCache.getLastRow();
  var locSourceRange = locCache.getRange(2, 1, locLr - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(locSourceRange, true)
    .setAllowInvalid(true)
    .build();
  dock.getRange(DOCK_ITEMS_DATA_START_ROW, locCol, 5000, 1).setDataValidation(rule);
}

/* ============================================================
   FIX MISSING FOLDERS & LINKS
   Scans Tasks, Repairs, and Inventory for rows without
   hyperlinked IDs and creates the missing Drive folder structure.
   ============================================================ */

function StrideFixMissingFolders() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var photosId = getSetting_(ss, "PHOTOS_FOLDER_ID") || getSetting_(ss, "DRIVE_PARENT_FOLDER_ID");
  if (!photosId) { ui.alert("PHOTOS_FOLDER_ID is not set in Settings."); return; }
  var photosUrl = "https://drive.google.com/drive/folders/" + photosId;

  var confirm = ui.alert("Fix Missing Folders & Links",
    "This will scan Inventory, Tasks, Repairs, Shipments, and Will Calls for rows without hyperlinked IDs " +
    "and create missing Drive folders.\n\nProceed?",
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  var fixed = { inventory: 0, tasks: 0, repairs: 0, shipments: 0 };

  // --- Fix Inventory: Create shipment folders for items without Shipment # hyperlinks ---
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (inv && inv.getLastRow() >= 2) {
    var invMap = getHeaderMap_(inv);
    var shipCol = invMap["Shipment #"];
    var itemIdCol = invMap["Item ID"];
    if (shipCol && itemIdCol) {
      var invLr = getLastDataRow_(inv);
      for (var i = 2; i <= invLr; i++) {
        try {
          var itemIdVal = String(inv.getRange(i, itemIdCol).getValue() || "").trim();
          if (!itemIdVal) continue;

          // Check if Item ID has a hyperlink
          var idRt = inv.getRange(i, itemIdCol).getRichTextValue();
          var hasIdLink = idRt && idRt.getLinkUrl();

          if (!hasIdLink) {
            // Create item folder under photos folder
            var itemFolderUrl = createItemFolder_(photosUrl, itemIdVal);
            if (itemFolderUrl) {
              var rt = SpreadsheetApp.newRichTextValue().setText(itemIdVal).setLinkUrl(itemFolderUrl).build();
              inv.getRange(i, itemIdCol).setRichTextValue(rt);
              fixed.inventory++;
            }
          }

          // Check if Shipment # has a hyperlink
          var shipRt = inv.getRange(i, shipCol).getRichTextValue();
          var hasShipLink = shipRt && shipRt.getLinkUrl();
          if (!hasShipLink) {
            var shipVal = String(inv.getRange(i, shipCol).getValue() || "").trim();
            if (shipVal) {
              // Create shipment folder if it doesn't exist
              var shipFolderUrl = createItemFolder_(photosUrl, shipVal);
              if (shipFolderUrl) {
                var shipRtNew = SpreadsheetApp.newRichTextValue().setText(shipVal).setLinkUrl(shipFolderUrl).build();
                inv.getRange(i, shipCol).setRichTextValue(shipRtNew);
              }
            }
          }
        } catch (invErr) { Logger.log("FixFolders inventory row " + i + ": " + invErr); }
      }
    }
  }

  // --- Fix Tasks: Create task folders + shipment hyperlinks ---
  var taskSh = ss.getSheetByName(CI_SH.TASKS);
  if (taskSh && taskSh.getLastRow() >= 2) {
    var taskMap = getHeaderMap_(taskSh);
    var taskIdCol = taskMap["Task ID"];
    var taskItemIdCol = taskMap["Item ID"];
    var taskShipCol = taskMap["Shipment #"];
    var taskLr = getLastDataRow_(taskSh);

    for (var t = 2; t <= taskLr; t++) {
      try {
        // Fix Task ID hyperlink
        if (taskIdCol) {
          var tIdVal = String(taskSh.getRange(t, taskIdCol).getValue() || "").trim();
          if (tIdVal) {
            var tRt = taskSh.getRange(t, taskIdCol).getRichTextValue();
            if (!tRt || !tRt.getLinkUrl()) {
              var taskFolderUrl = createItemFolder_(photosUrl, "TASK-" + tIdVal);
              if (taskFolderUrl) {
                taskSh.getRange(t, taskIdCol).setRichTextValue(
                  SpreadsheetApp.newRichTextValue().setText(tIdVal).setLinkUrl(taskFolderUrl).build()
                );
                fixed.tasks++;
              }
            }
          }
        }
        // Fix Item ID hyperlink on Tasks (links to same item folder as Inventory)
        if (taskItemIdCol) {
          var tItemVal = String(taskSh.getRange(t, taskItemIdCol).getValue() || "").trim();
          if (tItemVal) {
            var tItemRt = taskSh.getRange(t, taskItemIdCol).getRichTextValue();
            if (!tItemRt || !tItemRt.getLinkUrl()) {
              var tItemUrl = createItemFolder_(photosUrl, tItemVal);
              if (tItemUrl) {
                taskSh.getRange(t, taskItemIdCol).setRichTextValue(
                  SpreadsheetApp.newRichTextValue().setText(tItemVal).setLinkUrl(tItemUrl).build()
                );
              }
            }
          }
        }
        // Fix Shipment # hyperlink on Tasks
        if (taskShipCol) {
          var tShipVal = String(taskSh.getRange(t, taskShipCol).getValue() || "").trim();
          if (tShipVal) {
            var tShipRt = taskSh.getRange(t, taskShipCol).getRichTextValue();
            if (!tShipRt || !tShipRt.getLinkUrl()) {
              var tShipUrl = createItemFolder_(photosUrl, tShipVal);
              if (tShipUrl) {
                taskSh.getRange(t, taskShipCol).setRichTextValue(
                  SpreadsheetApp.newRichTextValue().setText(tShipVal).setLinkUrl(tShipUrl).build()
                );
              }
            }
          }
        }
      } catch (tErr) { Logger.log("FixFolders task row " + t + ": " + tErr); }
    }
  }

  // --- Fix Repairs: Create repair folders + shipment hyperlinks ---
  var repairSh = ss.getSheetByName(CI_SH.REPAIRS);
  if (repairSh && repairSh.getLastRow() >= 2) {
    var repairMap = getHeaderMap_(repairSh);
    var repairIdCol = repairMap["Repair ID"];
    var repairItemIdCol = repairMap["Item ID"];
    var repairShipCol = repairMap["Shipment #"];
    var repairLr = getLastDataRow_(repairSh);

    for (var rr = 2; rr <= repairLr; rr++) {
      try {
        // Fix Repair ID hyperlink
        if (repairIdCol) {
          var rIdVal = String(repairSh.getRange(rr, repairIdCol).getValue() || "").trim();
          if (rIdVal) {
            var rRt = repairSh.getRange(rr, repairIdCol).getRichTextValue();
            if (!rRt || !rRt.getLinkUrl()) {
              var repairFolderUrl = createItemFolder_(photosUrl, "REPAIR-" + rIdVal);
              if (repairFolderUrl) {
                repairSh.getRange(rr, repairIdCol).setRichTextValue(
                  SpreadsheetApp.newRichTextValue().setText(rIdVal).setLinkUrl(repairFolderUrl).build()
                );
                fixed.repairs++;
              }
            }
          }
        }
        // Fix Item ID hyperlink on Repairs (links to same item folder as Inventory)
        if (repairItemIdCol) {
          var rItemVal = String(repairSh.getRange(rr, repairItemIdCol).getValue() || "").trim();
          if (rItemVal) {
            var rItemRt = repairSh.getRange(rr, repairItemIdCol).getRichTextValue();
            if (!rItemRt || !rItemRt.getLinkUrl()) {
              var rItemUrl = createItemFolder_(photosUrl, rItemVal);
              if (rItemUrl) {
                repairSh.getRange(rr, repairItemIdCol).setRichTextValue(
                  SpreadsheetApp.newRichTextValue().setText(rItemVal).setLinkUrl(rItemUrl).build()
                );
              }
            }
          }
        }
        // Fix Shipment # hyperlink on Repairs
        if (repairShipCol) {
          var rShipVal = String(repairSh.getRange(rr, repairShipCol).getValue() || "").trim();
          if (rShipVal) {
            var rShipRt = repairSh.getRange(rr, repairShipCol).getRichTextValue();
            if (!rShipRt || !rShipRt.getLinkUrl()) {
              var rShipUrl = createItemFolder_(photosUrl, rShipVal);
              if (rShipUrl) {
                repairSh.getRange(rr, repairShipCol).setRichTextValue(
                  SpreadsheetApp.newRichTextValue().setText(rShipVal).setLinkUrl(rShipUrl).build()
                );
              }
            }
          }
        }
      } catch (rErr) { Logger.log("FixFolders repair row " + rr + ": " + rErr); }
    }
  }

  // --- Fix Shipments: Create shipment folders for Shipment # without hyperlinks ---
  var shipFixSh = ss.getSheetByName(CI_SH.SHIPMENTS);
  fixed.shipments = 0;
  if (shipFixSh && shipFixSh.getLastRow() >= 2) {
    var shipFixMap = getHeaderMap_(shipFixSh);
    var shipFixCol = shipFixMap["Shipment #"];
    if (shipFixCol) {
      var shipFixLr = getLastDataRow_(shipFixSh);
      for (var sf = 2; sf <= shipFixLr; sf++) {
        try {
          var sfVal = String(shipFixSh.getRange(sf, shipFixCol).getValue() || "").trim();
          if (!sfVal) continue;
          var sfRt = shipFixSh.getRange(sf, shipFixCol).getRichTextValue();
          if (sfRt && sfRt.getLinkUrl()) continue; // already linked

          var sfUrl = createItemFolder_(photosUrl, sfVal);
          if (sfUrl) {
            shipFixSh.getRange(sf, shipFixCol).setRichTextValue(
              SpreadsheetApp.newRichTextValue().setText(sfVal).setLinkUrl(sfUrl).build()
            );
            fixed.shipments++;
          }
        } catch (sfErr) { Logger.log("FixFolders shipment row " + sf + ": " + sfErr); }
      }
    }
  }

  // --- Fix Will Calls: Create WC folders for will calls without WC Number hyperlinks ---
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  fixed.willCalls = 0;
  if (wcSh && wcSh.getLastRow() >= 2) {
    var wcMap = getHeaderMap_(wcSh);
    var wcNumCol = wcMap["WC Number"];
    if (wcNumCol) {
      var wcLr = getLastDataRow_(wcSh);
      for (var wc = 2; wc <= wcLr; wc++) {
        try {
          var wcVal = String(wcSh.getRange(wc, wcNumCol).getValue() || "").trim();
          if (!wcVal) continue;
          var wcRt = wcSh.getRange(wc, wcNumCol).getRichTextValue();
          if (wcRt && wcRt.getLinkUrl()) continue; // already linked

          var wcFolderUrl = createItemFolder_(photosUrl, "WC-" + wcVal);
          if (wcFolderUrl) {
            var wcRtNew = SpreadsheetApp.newRichTextValue().setText(wcVal).setLinkUrl(wcFolderUrl).build();
            wcSh.getRange(wc, wcNumCol).setRichTextValue(wcRtNew);
            fixed.willCalls++;
          }
        } catch (wcErr) { Logger.log("FixFolders WC row " + wc + ": " + wcErr); }
      }
    }
  }

  // --- Fix WC_Items: Hyperlink WC Number to match Will_Calls ---
  var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  fixed.wcItems = 0;
  if (wciSh && wcSh && wciSh.getLastRow() >= 2) {
    var wciMap = getHeaderMap_(wciSh);
    var wciWcCol = wciMap["WC Number"];
    if (wciWcCol && wcSh) {
      // Build WC folder URL lookup from Will_Calls
      var wcFolderLookup = {};
      var wcMap2 = getHeaderMap_(wcSh);
      var wcNumCol2 = wcMap2["WC Number"];
      if (wcNumCol2) {
        var wcLr2 = getLastDataRow_(wcSh);
        for (var wl = 2; wl <= wcLr2; wl++) {
          var wcNum2 = String(wcSh.getRange(wl, wcNumCol2).getValue() || "").trim();
          var wcRt2 = wcSh.getRange(wl, wcNumCol2).getRichTextValue();
          if (wcNum2 && wcRt2 && wcRt2.getLinkUrl()) wcFolderLookup[wcNum2] = wcRt2.getLinkUrl();
        }
      }
      var wciLr = getLastDataRow_(wciSh);
      for (var wi = 2; wi <= wciLr; wi++) {
        try {
          var wciVal = String(wciSh.getRange(wi, wciWcCol).getValue() || "").trim();
          if (!wciVal) continue;
          var wciRt = wciSh.getRange(wi, wciWcCol).getRichTextValue();
          if (wciRt && wciRt.getLinkUrl()) continue; // already linked
          var wcUrl = wcFolderLookup[wciVal];
          if (wcUrl) {
            var wciRtNew = SpreadsheetApp.newRichTextValue().setText(wciVal).setLinkUrl(wcUrl).build();
            wciSh.getRange(wi, wciWcCol).setRichTextValue(wciRtNew);
            fixed.wcItems++;
          }
        } catch (wiErr) { Logger.log("FixFolders WCI row " + wi + ": " + wiErr); }
      }
    }
  }

  var total = fixed.inventory + fixed.tasks + fixed.repairs + fixed.shipments + fixed.willCalls + fixed.wcItems;
  ui.alert("Fix Missing Folders Complete",
    "Created folders and hyperlinks:\n\n" +
    "Inventory items: " + fixed.inventory + "\n" +
    "Tasks: " + fixed.tasks + "\n" +
    "Repairs: " + fixed.repairs + "\n" +
    "Shipments: " + fixed.shipments + "\n" +
    "Will Calls: " + fixed.willCalls + "\n" +
    "WC Items: " + fixed.wcItems + "\n\n" +
    "Total: " + total + " fixed.",
    ui.ButtonSet.OK);
}

/* ============================================================
   SMART FILTER & SORT — v3.0.1
   Rebuilds filter range every time so new rows are always
   included. Sort is applied after filter.
   ============================================================ */

/**
 * Helper: applies filter + sort on any sheet.
 * @param {Sheet} sheet
 * @param {Object} filterSpec  { columnName: [hiddenValues] } or { columnName: [shownValues], mode: "show" }
 * @param {Array} sortSpec     [{ column: "ColName", ascending: true }, ...]
 */
function applySmartFilterSort_(sheet, filterSpec, sortSpec) {
  if (!sheet) return;
  var map = getHeaderMap_(sheet);
  var maxRows = sheet.getMaxRows();
  var maxCols = sheet.getMaxColumns();

  // Remove existing filter
  try { var f = sheet.getFilter(); if (f) f.remove(); } catch (_) {}

  // Create filter on full range
  sheet.getRange(1, 1, maxRows, maxCols).createFilter();
  var filter = sheet.getFilter();
  if (!filter) return;

  // Apply filter criteria
  if (filterSpec) {
    var filterKeys = Object.keys(filterSpec);
    for (var fi = 0; fi < filterKeys.length; fi++) {
      var colName = filterKeys[fi];
      var col = map[colName];
      if (!col) continue;
      var spec = filterSpec[colName];
      var crit;
      if (spec.mode === "show") {
        // Get all unique values in column, hide everything not in the show list
        var colData = sheet.getRange(2, col, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
        var allVals = {};
        for (var cv = 0; cv < colData.length; cv++) {
          var v = String(colData[cv][0] || "").trim();
          if (v) allVals[v] = true;
        }
        var hidden = Object.keys(allVals).filter(function(v) { return spec.values.indexOf(v) === -1; });
        if (hidden.length === 0) continue;
        crit = SpreadsheetApp.newFilterCriteria().setHiddenValues(hidden).build();
      } else {
        crit = SpreadsheetApp.newFilterCriteria().setHiddenValues(spec).build();
      }
      filter.setColumnFilterCriteria(col, crit);
    }
  }

  // Apply sort
  if (sortSpec && sortSpec.length > 0) {
    var sortRange = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), maxCols);
    for (var si = 0; si < sortSpec.length; si++) {
      var sortCol = map[sortSpec[si].column];
      if (!sortCol) continue;
      sortRange.sort({ column: sortCol, ascending: sortSpec[si].ascending !== false });
    }
  }
}

/* --- DEFAULT VIEWS --- */

/**
 * Inventory: Filter Active, sort by Sidemark then Item ID
 */
function StrideDefaultViewInventory() {
  var ss = SpreadsheetApp.getActive();
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv) { safeAlert_("Inventory sheet not found."); return; }
  applySmartFilterSort_(inv,
    { "Status": [INVENTORY_STATUS.RELEASED, INVENTORY_STATUS.ON_HOLD, INVENTORY_STATUS.TRANSFERRED] },
    [{ column: "Sidemark", ascending: true }, { column: "Item ID", ascending: true }]
  );
  // silent — no popup
}

/**
 * Tasks: Filter Open, sort by Type then Created
 */
function StrideDefaultViewTasks() {
  var ss = SpreadsheetApp.getActive();
  var tasks = ss.getSheetByName(CI_SH.TASKS);
  if (!tasks) { safeAlert_("Tasks sheet not found."); return; }
  applySmartFilterSort_(tasks,
    { "Status": { values: ["Open"], mode: "show" } },
    [{ column: "Type", ascending: true }, { column: "Created", ascending: true }]
  );
  // silent — no popup
}

/**
 * Repairs: Filter by active statuses, sort by Status then Scheduled Date
 */
function StrideDefaultViewRepairs() {
  var ss = SpreadsheetApp.getActive();
  var repairs = ss.getSheetByName(CI_SH.REPAIRS);
  if (!repairs) { safeAlert_("Repairs sheet not found."); return; }
  var activeStatuses = [REPAIR_STATUS.PENDING_QUOTE, REPAIR_STATUS.QUOTE_SENT, REPAIR_STATUS.APPROVED, REPAIR_STATUS.IN_PROGRESS];
  applySmartFilterSort_(repairs,
    { "Status": { values: activeStatuses, mode: "show" } },
    [{ column: "Status", ascending: true }, { column: "Scheduled Date", ascending: true }]
  );
  // silent — no popup
}

/**
 * Batch processor: scans all Inventory rows for checked Needs Inspection,
 * Needs Assembly, and Create Task checkboxes that don't have matching tasks.
 * Fixes missed triggers from rapid checkbox clicking.
 */
// v4.0.1: StrideProcessPendingTasks removed — task creation now uses batch menu actions

/**
 * Clear all filters and sorts on the current active sheet
 */
function StrideClearFilters() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getActiveSheet();
  try {
    var filter = sheet.getFilter();
    if (filter) filter.remove();
  } catch (_) {}
  // silent — no popup
}
