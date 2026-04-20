/* ===================================================
   AutocompleteDB.gs — v3.1.0 — 2026-03-26
   Per-client autocomplete database for Sidemark, Vendor, Description.
   Scans Inventory tab for unique values, stores them in Autocomplete_DB tab.
   =================================================== */

/* ========= CONSTANTS ========= */
var ACDB_SHEET_NAME = "Autocomplete_DB";
var ACDB_HEADERS = ["Field", "Value"];
var ACDB_FIELDS = ["Sidemark", "Vendor", "Description"];

/* ========= FULL SYNC — Scan entire Inventory tab ========= */
/**
 * Scans the Inventory tab and rebuilds the Autocomplete_DB tab with all
 * unique Sidemark, Vendor, and Description values.
 * Safe to re-run: merges with existing DB entries (never loses manual additions).
 */
function syncAutocompleteDB_() {
  var ss = SpreadsheetApp.getActive();
  var invSh = ss.getSheetByName(CI_SH.INVENTORY);
  if (!invSh || invSh.getLastRow() < 2) {
    CI_log_("INFO", "syncAutocompleteDB_: No inventory data to scan.");
    return { added: 0 };
  }

  var invMap = getHeaderMap_(invSh);
  var data = invSh.getRange(2, 1, invSh.getLastRow() - 1, invSh.getLastColumn()).getValues();

  // Collect unique values from Inventory
  var newValues = {}; // { "Sidemark": Set, "Vendor": Set, "Description": Set }
  for (var f = 0; f < ACDB_FIELDS.length; f++) {
    newValues[ACDB_FIELDS[f]] = {};
  }

  for (var i = 0; i < data.length; i++) {
    for (var f = 0; f < ACDB_FIELDS.length; f++) {
      var field = ACDB_FIELDS[f];
      var col = invMap[field];
      if (!col) continue;
      var val = String(data[i][col - 1] || "").trim();
      if (val) newValues[field][val] = true;
    }
  }

  // Merge with existing DB (preserves manually added entries)
  var dbSh = ensureAutocompleteDBSheet_(ss);
  var existing = readAutocompleteDB_(dbSh);

  var added = 0;
  for (var f = 0; f < ACDB_FIELDS.length; f++) {
    var field = ACDB_FIELDS[f];
    var existingSet = existing[field] || {};
    var newSet = newValues[field] || {};
    for (var val in newSet) {
      if (!existingSet[val]) {
        existingSet[val] = true;
        added++;
      }
    }
    existing[field] = existingSet;
  }

  // Rewrite DB sheet
  writeAutocompleteDB_(dbSh, existing);
  CI_log_("INFO", "syncAutocompleteDB_: Done", "added=" + added);
  return { added: added };
}

/* ========= INCREMENTAL — Log new values from a batch of items ========= */
/**
 * Logs new Sidemark/Vendor/Description values from an array of item objects.
 * Called after Complete Shipment to incrementally grow the DB.
 * @param {Object[]} items - Array of { sidemark, vendor, description }
 */
function logAutocompleteEntries_(items) {
  if (!items || !items.length) return;
  var ss = SpreadsheetApp.getActive();
  var dbSh = ss.getSheetByName(ACDB_SHEET_NAME);
  if (!dbSh) return; // DB not set up yet — skip silently

  var existing = readAutocompleteDB_(dbSh);
  var added = 0;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var pairs = [
      ["Sidemark", item.sidemark || ""],
      ["Vendor", item.vendor || ""],
      ["Description", item.description || ""]
    ];
    for (var p = 0; p < pairs.length; p++) {
      var field = pairs[p][0];
      var val = String(pairs[p][1]).trim();
      if (!val) continue;
      if (!existing[field]) existing[field] = {};
      if (!existing[field][val]) {
        existing[field][val] = true;
        added++;
      }
    }
  }

  if (added > 0) {
    writeAutocompleteDB_(dbSh, existing);
    CI_log_("INFO", "logAutocompleteEntries_: added " + added + " new entries");
  }
}

/* ========= GET VALUES — For dropdown/autocomplete use ========= */
/**
 * Returns sorted array of unique values for a given field.
 * @param {string} field - "Sidemark", "Vendor", or "Description"
 * @return {string[]}
 */
function getAutocompleteValues_(field) {
  var ss = SpreadsheetApp.getActive();
  var dbSh = ss.getSheetByName(ACDB_SHEET_NAME);
  if (!dbSh || dbSh.getLastRow() < 2) return [];

  var existing = readAutocompleteDB_(dbSh);
  var set = existing[field] || {};
  var vals = Object.keys(set);
  vals.sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
  return vals;
}

/* ========= MENU ENTRY POINT ========= */
/**
 * Menu action: Stride Admin → Sync Autocomplete DB
 */
function StrideSyncAutocompleteDB() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  ss.toast("Scanning inventory for autocomplete values...", "Autocomplete DB", -1);
  ensureAutocompleteDBSheet_(ss);
  var result = syncAutocompleteDB_();
  ss.toast("Done! " + result.added + " new entries added.", "Autocomplete DB", 5);
  ui.alert("Autocomplete DB Synced",
    "Scanned Inventory tab and updated the Autocomplete_DB sheet.\n\n" +
    "New entries added: " + result.added + "\n\n" +
    "The DB now contains unique Sidemark, Vendor, and Description values\n" +
    "that will be available for autocomplete in future entries.",
    ui.ButtonSet.OK);
}

/* ========= INTERNAL HELPERS ========= */

/**
 * Ensures the Autocomplete_DB sheet exists with proper headers.
 */
function ensureAutocompleteDBSheet_(ss) {
  var sh = ss.getSheetByName(ACDB_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ACDB_SHEET_NAME);
    writeHeaders_(sh, ACDB_HEADERS);
    sh.setFrozenRows(1);
    // Format header
    sh.getRange(1, 1, 1, ACDB_HEADERS.length).setFontWeight("bold").setBackground("#F1F5F9");
    sh.setColumnWidth(1, 120);
    sh.setColumnWidth(2, 400);
  } else {
    // Ensure headers exist
    var h1 = sh.getRange(1, 1).getValue();
    if (String(h1).trim() !== ACDB_HEADERS[0]) {
      writeHeaders_(sh, ACDB_HEADERS);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

/**
 * Reads existing Autocomplete_DB into { field: { value: true, ... }, ... }
 */
function readAutocompleteDB_(dbSh) {
  var result = {};
  for (var f = 0; f < ACDB_FIELDS.length; f++) result[ACDB_FIELDS[f]] = {};

  if (dbSh.getLastRow() < 2) return result;
  var data = dbSh.getRange(2, 1, dbSh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    var field = String(data[i][0] || "").trim();
    var val = String(data[i][1] || "").trim();
    if (field && val && result[field] !== undefined) {
      result[field][val] = true;
    }
  }
  return result;
}

/**
 * Writes the full DB back to the sheet (sorted by field, then alphabetically).
 */
function writeAutocompleteDB_(dbSh, dbMap) {
  // Clear existing data (keep header)
  if (dbSh.getLastRow() > 1) {
    dbSh.getRange(2, 1, dbSh.getLastRow() - 1, 2).clearContent();
  }

  var rows = [];
  for (var f = 0; f < ACDB_FIELDS.length; f++) {
    var field = ACDB_FIELDS[f];
    var vals = Object.keys(dbMap[field] || {});
    vals.sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    for (var v = 0; v < vals.length; v++) {
      rows.push([field, vals[v]]);
    }
  }

  if (rows.length > 0) {
    dbSh.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  // Apply basic filter for easy browsing
  try {
    var existingFilter = dbSh.getFilter();
    if (existingFilter) existingFilter.remove();
    dbSh.getRange(1, 1, Math.max(dbSh.getLastRow(), 2), 2).createFilter();
  } catch (_) {}
}
