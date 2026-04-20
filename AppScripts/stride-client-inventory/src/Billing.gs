/* ===================================================
   Billing.gs — v3.2.0 — 2026-04-04 11:27 AM PST
   v3.2.0: Discount range widened from ±10 to ±100 in applyClientDiscount_.
   =================================================== */

/* ============================================================
   BILLING LEDGER
   ============================================================ */

function writeBillingRow_(payload) {
var ss = SpreadsheetApp.getActive();
var billing = ss.getSheetByName(CI_SH.BILLING_LEDGER);
if (!billing) return;
ensureHeaderRow_(billing, BILLING_LEDGER_HEADERS);
var map = getHeaderMap_(billing);
// v2.6.3: Apply client discount based on service category
var rate = payload.rate !== undefined ? payload.rate : 0;
var qty = payload.qty !== undefined ? payload.qty : 1;
if (rate > 0 && payload.category) {
  rate = applyClientDiscount_(ss, rate, payload.category);
}
var total = rate * qty;
var row = buildRowFromMap_(map, {
"Status": payload.status || "Unbilled",
"Invoice #": payload.invoiceNo || "",
"Client": payload.client || "",
"Date": payload.date || new Date(),
"Svc Code": payload.svcCode || "",
"Svc Name": payload.svcName || "",
"Category": payload.category || "",
"Item ID": payload.itemId || "",
"Description": payload.description || "",
"Class": payload.itemClass || "",
"Qty": qty,
"Rate": rate,
"Total": total,
"Task ID": payload.taskId || "",
"Repair ID": payload.repairId || "",
"Shipment #": payload.shipNo || "",
    "Item Notes": payload.notes || "",
    "Ledger Row ID": payload.ledgerEntryId || ""
});
var insertRow = getLastDataRow_(billing) + 1;
billing.getRange(insertRow, 1, 1, row.length).setValues([row]);
// v2.6.4: Hyperlink Shipment # to photos folder if URL provided
if (payload.photosUrl && map["Shipment #"]) {
  var shipVal = String(payload.shipNo || "").trim();
  if (shipVal) {
    var rt = SpreadsheetApp.newRichTextValue()
      .setText(shipVal)
      .setLinkUrl(payload.photosUrl)
      .build();
    billing.getRange(insertRow, map["Shipment #"]).setRichTextValue(rt);
  }
}
// v2.6.5: Hyperlink Task ID to task folder if URL provided
if (payload.taskUrl && map["Task ID"]) {
  var tidVal = String(payload.taskId || "").trim();
  if (tidVal) {
    var rtTask = SpreadsheetApp.newRichTextValue()
      .setText(tidVal)
      .setLinkUrl(payload.taskUrl)
      .build();
    billing.getRange(insertRow, map["Task ID"]).setRichTextValue(rtTask);
  }
}
// v2.6.5: Hyperlink Repair ID to repair folder if URL provided
if (payload.repairUrl && map["Repair ID"]) {
  var ridVal = String(payload.repairId || "").trim();
  if (ridVal) {
    var rtRepair = SpreadsheetApp.newRichTextValue()
      .setText(ridVal)
      .setLinkUrl(payload.repairUrl)
      .build();
    billing.getRange(insertRow, map["Repair ID"]).setRichTextValue(rtRepair);
  }
}
}

/**
 * v2.7.0: Applies client-specific price adjustment based on service category.
 * Reads DISCOUNT_STORAGE_PCT or DISCOUNT_SERVICES_PCT from Settings.
 * Negative value = discount (e.g. -10 = 10% off), Positive = markup (e.g. +50 = 50% surcharge).
 * Range: -100 to +100 (widened from ±10 in v2.7.0 so premium/surcharge clients work).
 * @param {Spreadsheet} ss  Active spreadsheet
 * @param {number} rate     Base rate before adjustment
 * @param {string} category "Storage Charges" or "Whse Services"
 * @return {number} Adjusted rate (rounded to 2 decimals)
 */
function applyClientDiscount_(ss, rate, category) {
  if (!category || rate <= 0) return rate;
  var cat = String(category).trim().toLowerCase();
  var pctKey = "";
  if (cat === "storage charges" || cat === "storage") {
    pctKey = CI_SETTINGS_KEYS.DISCOUNT_STORAGE_PCT;
  } else {
    pctKey = CI_SETTINGS_KEYS.DISCOUNT_SERVICES_PCT;
  }
  var pct = Number(getSetting_(ss, pctKey)) || 0;
  if (pct === 0 || pct < -100 || pct > 100) return rate;
  var adjusted = rate * (1 + pct / 100);
  return Math.round(adjusted * 100) / 100;
}

/**
 * v2.6.3: Looks up the Category for a service code from Price_Cache.
 * @param {Spreadsheet} ss
 * @param {string} svcCode
 * @return {string} Category value (e.g. "Storage Charges", "Whse Services") or ""
 */
function lookupCategoryByCode_(ss, svcCode) {
  if (!svcCode) return "";
  try {
    var cache = ss.getSheetByName(CI3_SH.PRICECACHE);
    if (!cache || cache.getLastRow() < 2) return "";
    var map = getHeaderMap_(cache);
    var data = cache.getRange(2, 1, cache.getLastRow() - 1, cache.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      var code = String(getCellByHeader_(data[i], map, "Service Code") || "").trim().toUpperCase();
      if (code === svcCode.toUpperCase()) {
        return String(getCellByHeader_(data[i], map, "Category") || "").trim();
      }
    }
  } catch (e) { Logger.log("lookupCategoryByCode_ error: " + e); }
  return "";
}

/* ============================================================
   MASTER PRICE LIST LOOKUP
   ============================================================ */

function lookupPriceFromMaster_(ss, svcCode, itemClass) {
var defaults = { rate: 0, svcName: svcCode, billIfPass: true, billIfFail: true };
if (!svcCode) return defaults;
try {
var masterId = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID);
if (!masterId) return defaults;
var master = SpreadsheetApp.openById(masterId);
var priceSheet = master.getSheetByName("Price_List");
if (!priceSheet || priceSheet.getLastRow() < 2) return defaults;
var pMap = getHeaderMap_(priceSheet);
var pData = priceSheet.getRange(2, 1, priceSheet.getLastRow() - 1, priceSheet.getLastColumn()).getValues();
var svcRow = null;
for (var i = 0; i < pData.length; i++) {
var code = getCellByHeader_(pData[i], pMap, "Service Code");
if (code && code.toUpperCase() === String(svcCode).toUpperCase()) {
svcRow = pData[i];
break;
}
}
if (!svcRow) return defaults;
var svcName = getCellByHeader_(svcRow, pMap, "Service Name") || svcCode;
var category = getCellByHeader_(svcRow, pMap, "Category") || "";
var billIfPass = truthy_(getCellByHeaderRaw_(svcRow, pMap, "BillIfPASS"));
var billIfFail = truthy_(getCellByHeaderRaw_(svcRow, pMap, "BillIfFAIL"));
var rateColName = itemClass ? (String(itemClass).toUpperCase() + " Rate") : "";
var rateCol = rateColName && pMap[rateColName] ? pMap[rateColName] : null;
var rate = rateCol ? (Number(svcRow[rateCol - 1]) || 0) : 0;
return { rate: rate, svcName: svcName, category: category, billIfPass: billIfPass, billIfFail: billIfFail };
} catch (err) {
Logger.log("lookupPriceFromMaster_ error: " + err);
return defaults;
}
}

/* ============================================================
   RECALC UNBILLED RATES
   ============================================================ */

function recalcUnbilledRates_(ss) {
  var billing = ss.getSheetByName(CI_SH.BILLING_LEDGER);
  if (!billing || billing.getLastRow() < 2) return { total: 0, updated: 0 };
  var map = getHeaderMap_(billing);
  var colStatus = map["Status"];
  var colSvcCode = map["Svc Code"];
  var colSvcName = map["Svc Name"];
  var colClass = map["Class"];
  var colQty = map["Qty"];
  var colRate = map["Rate"];
  var colTotal = map["Total"];
  if (!colStatus || !colSvcCode || !colRate || !colTotal) return { total: 0, updated: 0 };
  var lastRow = getLastDataRow_(billing);
  if (lastRow < 2) return { total: 0, updated: 0 };
  var data = billing.getRange(2, 1, lastRow - 1, billing.getLastColumn()).getValues();
  var updated = 0;
  var total = 0;
  // v3.1.0: Pre-load class sizes for STOR cubic volume multiplication
  var classSizes = loadClassSizes_(ss);
  for (var i = 0; i < data.length; i++) {
    var status = String(data[i][colStatus - 1] || "").trim();
    if (status !== "Unbilled") continue;
    total++;
    var svcCode = String(data[i][colSvcCode - 1] || "").trim();
    var itemClass = colClass ? String(data[i][colClass - 1] || "").trim() : "";
    if (!svcCode) continue;
    var newRate = lookupRateByCodeAndClass_(ss, svcCode, itemClass);
    // v3.1.0: STOR rates are per-cuFt — multiply by class cubic volume to get daily rate
    if (svcCode === "STOR" && itemClass) {
      var cuVol = Number(classSizes[itemClass.toUpperCase()] || 0) || 0;
      if (cuVol > 0) newRate = newRate * cuVol;
    }
    // v2.6.3: Apply client discount based on service category
    var category = lookupCategoryByCode_(ss, svcCode);
    if (newRate > 0 && category) {
      newRate = applyClientDiscount_(ss, newRate, category);
    }
    var newName = lookupSvcNameByCode_(ss, svcCode) || svcCode;
    var qty = colQty ? (Number(data[i][colQty - 1]) || 1) : 1;
    var newTotal = newRate * qty;
    var oldRate = Number(data[i][colRate - 1] || 0);
    var oldTotal = Number(data[i][colTotal - 1] || 0);
    var oldName = colSvcName ? String(data[i][colSvcName - 1] || "").trim() : "";
    if (newRate !== oldRate || newTotal !== oldTotal || (colSvcName && newName !== oldName)) {
      var rowNum = i + 2;
      billing.getRange(rowNum, colRate).setValue(newRate);
      billing.getRange(rowNum, colTotal).setValue(newTotal);
      if (colSvcName) billing.getRange(rowNum, colSvcName).setValue(newName);
      updated++;
    }
  }
  // v2.6.3: Backfill missing Ledger Entry IDs on all rows (one-time fix for legacy data)
  var colLedgerId = map["Ledger Entry ID"];
  var colItemId = map["Item ID"];
  var colTaskId = map["Task ID"];
  var colRepairId = map["Repair ID"];
  var colShipNo = map["Shipment #"];
  if (colLedgerId) {
    for (var li = 0; li < data.length; li++) {
      var existingId = String(data[li][colLedgerId - 1] || "").trim();
      if (existingId) continue;
      var liSvcCode = String(data[li][colSvcCode - 1] || "").trim();
      var liItemId = colItemId ? String(data[li][colItemId - 1] || "").trim() : "";
      var liTaskId = colTaskId ? String(data[li][colTaskId - 1] || "").trim() : "";
      var liRepairId = colRepairId ? String(data[li][colRepairId - 1] || "").trim() : "";
      var liShipNo = colShipNo ? String(data[li][colShipNo - 1] || "").trim() : "";
      var newId = "";
      if (liRepairId) newId = "REPAIR-" + liRepairId;
      else if (liTaskId) newId = liSvcCode + "-TASK-" + liTaskId;
      else if (liSvcCode === "RCVG" && liItemId) newId = "RCVG-" + liItemId + "-" + liShipNo;
      else if (liSvcCode === "STOR" && liItemId) newId = "STOR-" + liItemId;
      else if (liSvcCode && liItemId) newId = liSvcCode + "-" + liItemId + "-" + (li + 2);
      if (newId) billing.getRange(li + 2, colLedgerId).setValue(newId);
    }
  }
  // v2.6.2: Also recalculate WC Fee on WC_Items and Total WC Fee on Will_Calls for pending WCs
  recalcPendingWillCallFees_(ss);
  return { total: total, updated: updated };
}

/**
 * v2.6.2: Recalculates WC Fee on WC_Items rows and Total WC Fee on Will_Calls
 * for any Will Call that is still Pending or Scheduled (not yet released).
 */
function recalcPendingWillCallFees_(ss) {
  var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  if (!wciSh || !wcSh) return;
  var wciMap = getHeaderMap_(wciSh);
  var wcMap = getHeaderMap_(wcSh);
  var colWcNum = wciMap["WC Number"];
  var colClass = wciMap["Class"];
  var colFee = wciMap["WC Fee"];
  var colReleased = wciMap["Released"];
  if (!colWcNum || !colClass || !colFee) return;
  var wciLast = getLastDataRow_(wciSh);
  if (wciLast < 2) return;
  var wciData = wciSh.getRange(2, 1, wciLast - 1, wciSh.getLastColumn()).getValues();
  // Get pending/scheduled WC numbers
  var wcColNum = wcMap["WC Number"];
  var wcColStatus = wcMap["Status"];
  var wcColTotalFee = wcMap["Total WC Fee"];
  if (!wcColNum || !wcColStatus) return;
  var wcLast = getLastDataRow_(wcSh);
  if (wcLast < 2) return;
  var wcData = wcSh.getRange(2, 1, wcLast - 1, wcSh.getLastColumn()).getValues();
  var pendingWCs = {};
  for (var w = 0; w < wcData.length; w++) {
    var wcStatus = String(wcData[w][wcColStatus - 1] || "").trim();
    if (wcStatus === WC_STATUS.PENDING || wcStatus === WC_STATUS.SCHEDULED) {
      var wcNum = String(wcData[w][wcColNum - 1] || "").trim();
      if (wcNum) pendingWCs[wcNum] = { row: w + 2, total: 0 };
    }
  }
  if (!Object.keys(pendingWCs).length) return;
  // Update WC_Items fees for pending WCs
  for (var j = 0; j < wciData.length; j++) {
    var itemWcNum = String(wciData[j][colWcNum - 1] || "").trim();
    if (!pendingWCs[itemWcNum]) continue;
    var released = colReleased ? wciData[j][colReleased - 1] : false;
    if (released === true || String(released).toLowerCase() === "true") continue;
    var cls = String(wciData[j][colClass - 1] || "").trim();
    var newFee = lookupRateByCodeAndClass_(ss, "WC", cls);
    // v2.6.3: Apply client discount to WC fees
    if (newFee > 0) newFee = applyClientDiscount_(ss, newFee, "Whse Services");
    wciSh.getRange(j + 2, colFee).setValue(newFee);
    pendingWCs[itemWcNum].total += newFee;
  }
  // Update Total WC Fee on Will_Calls
  if (wcColTotalFee) {
    var keys = Object.keys(pendingWCs);
    for (var k = 0; k < keys.length; k++) {
      var wc = pendingWCs[keys[k]];
      wcSh.getRange(wc.row, wcColTotalFee).setValue(wc.total);
    }
  }
}

/* ============================================================
   STORAGE BILLING HELPERS
   ============================================================ */

function loadStorRates_(ss) {
var cache = ss.getSheetByName(CI3_SH.PRICECACHE);
if (!cache || cache.getLastRow() < 2) return null;
var map = getHeaderMap_(cache);
var data = cache.getRange(2, 1, cache.getLastRow() - 1, cache.getLastColumn()).getValues();
var storRow = null;
for (var i = 0; i < data.length; i++) {
var code = getCellByHeader_(data[i], map, "Service Code");
if (code && code.toUpperCase() === "STOR") {
storRow = data[i];
break;
}
}
if (!storRow) return null;
var rates = {};
var classes = ["XS","S","M","L","XL","XXL"];
for (var c = 0; c < classes.length; c++) {
var colName = classes[c] + " Rate";
var val = getCellByHeaderRaw_(storRow, map, colName);
rates[classes[c]] = (val !== null && val !== "") ? Number(val) || 0 : 0;
}
// Default fallback
rates["DEFAULT"] = rates["M"] || 0;
return rates;
}

/**
* Loads cubic volume (cu ft) per class from Class_Cache.
* Returns object like { "XS": 5, "S": 15, "M": 45, ... }
* v3.1.0: Check "Cubic Volume" first, fall back to "Storage Size"
*/
function loadClassSizes_(ss) {
var cache = ss.getSheetByName(CI3_SH.CLASSCACHE);
if (!cache || cache.getLastRow() < 2) return {};
var map = getHeaderMap_(cache);
var data = cache.getRange(2, 1, cache.getLastRow() - 1, cache.getLastColumn()).getValues();
var sizes = {};
for (var i = 0; i < data.length; i++) {
var className = getCellByHeader_(data[i], map, "Class");
var sizeVal = getCellByHeaderRaw_(data[i], map, "Cubic Volume");
if (sizeVal === null || sizeVal === "") {
  sizeVal = getCellByHeaderRaw_(data[i], map, "Storage Size");
}
if (className) {
sizes[className.toUpperCase()] = (sizeVal !== null && sizeVal !== "") ? Number(sizeVal) || 0 : 0;
}
}
return sizes;
}

/**
* Scans Billing_Ledger for STOR entries and returns a map of
* itemId -> latest billing end date (parsed from Notes field).
*/
function buildLastBilledMap_(ss) {
var billing = ss.getSheetByName(CI_SH.BILLING_LEDGER);
if (!billing || billing.getLastRow() < 2) return {};
var map = getHeaderMap_(billing);
var data = billing.getRange(2, 1, billing.getLastRow() - 1, billing.getLastColumn()).getValues();
var lastBilled = {};
for (var i = 0; i < data.length; i++) {
var svcCode = getCellByHeader_(data[i], map, "Svc Code");
if (svcCode !== "STOR") continue;
var itemId = getCellByHeader_(data[i], map, "Item ID");
var notes = getCellByHeader_(data[i], map, "Item Notes");
if (!itemId || !notes) continue;
// Parse end date from "Storage: MM/DD/YY - MM/DD/YY (X days)"
var match = notes.match(/- (\d{1,2}\/\d{1,2}\/\d{2,4})/);
if (match) {
var endDate = parseDateInput_(match[1]);
if (endDate) {
if (!lastBilled[itemId] || endDate > lastBilled[itemId]) {
lastBilled[itemId] = endDate;
}
}
}
}
return lastBilled;
}

/* ============================================================
   DATE HELPERS
   ============================================================ */

/**
* Parses a date string in MM/DD/YY format. Returns Date or null.
*/
function parseDateInput_(str) {
if (!str) return null;
var s = String(str).trim();
var parts = s.split("/");
if (parts.length !== 3) return null;
var month = parseInt(parts[0], 10);
var day = parseInt(parts[1], 10);
var year = parseInt(parts[2], 10);
if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
if (year < 100) year += 2000;
if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) return null;
var d = new Date(year, month - 1, day);
d.setHours(0, 0, 0, 0);
return d;
}

/**
* Converts a value to a Date object. Handles Date objects, strings, and numbers.
*/
function toDate_(val) {
if (!val) return null;
if (val instanceof Date) {
var d = new Date(val.getTime());
d.setHours(0, 0, 0, 0);
return d;
}
var s = String(val).trim();
if (!s) return null;
var parsed = new Date(s);
if (isNaN(parsed.getTime())) return null;
parsed.setHours(0, 0, 0, 0);
return parsed;
}
