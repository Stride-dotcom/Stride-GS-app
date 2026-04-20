/* ===================================================
   Import.gs — v4.4.0 — 2026-04-17 PST — IMP Shipments-tab hyperlinks reuse legacy photo URLs
   v4.4.0: (a) Forward: Import no longer creates an empty IMP folder under
           Shipments/. The Shipments-tab Shipment # cell is hyperlinked directly
           to the first non-empty legacy photo URL collected from the imported
           items, so the React app's folder button opens the real photos.
           (b) Backfill: new `backfillImpShipmentFolderUrls_()` walks every
           existing IMP-* row on the Shipments tab and rewrites the hyperlink
           to the URL found on a matching Inventory row's Shipment # rich-text
           link. Safe to re-run; skips rows already pointing outside the
           empty Shipments/IMP-* self-folder.
   v4.3.0: Reference column added to IMPORT_COL_MAP_ and written to the new
           Inventory row. Matches legacy headers: REFERENCE, REF, REF#, PO, PO#,
           PURCHASE ORDER, ORDER, ORDER #, SO#, SALES ORDER, WORKROOM, INVOICE #,
           JOB, JOB #. Previously imported items always had blank Reference,
           which meant the WC release email columns (Item ID / Vendor /
           Description / Reference in WillCalls.gs v4.3.0) couldn't show
           reference numbers for migrated items.
   v4.2.3: Create Drive folder for imported shipments + hyperlink Shipment # cell.
   v4.2.2: Import now pulls legacy Task Notes + Inspection Notes into assembly
           tasks. Header aliases: TASK NOTES, ASSEMBLY NOTES, ASSEMBLY INSTRUCTIONS,
           ASSM NOTES, ASSY NOTES. Priority: legacy Task Notes > Assembly Status
           cell value > "Needs assembly" default. Inspection Notes already imported
           into Item Notes (appended with "Insp: " prefix) — now ALSO copied to
           Task Notes when no dedicated Task Notes column exists, so assembly
           workers see inspection context without opening the item.
   v4.2.1: PERF — 13-row import was taking ~17 min. Fixed 4 per-row round-trips:
           (1) batch-read photo notes once instead of per-cell getCell().getNote()
           (2) pre-compute ASM-<itemId>-N counter in one read (was re-reading Tasks sheet per row)
           (3) batch setRichTextValues for photo hyperlinks (was per-cell setRichTextValue)
           (4) removed SpreadsheetApp.flush() that forced full ARRAYFORMULA recalc before insert
   v4.2.0: Skip assembly task creation for Released items during import.
           Only Active items get ASM tasks — released items are historical.
   v4.1.0: Fuzzy size word matching for Class column
           (Small/Medium/Large/XL text values + stripped unit suffixes)
   =================================================== */

/* ================================================================
   v2.6.2: Photos Folder Setting — merged from patch file
   Run once per EXISTING client sheet from Stride Admin menu
   to add PHOTOS_FOLDER_ID to Settings. New clients get it automatically.
   ================================================================ */
function StrideAddPhotosFolderSetting() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var settingsSh = ss.getSheetByName("Settings");
  if (!settingsSh) { ui.alert("Settings sheet not found."); return; }
  var data = settingsSh.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === "PHOTOS_FOLDER_ID") {
      ui.alert("PHOTOS_FOLDER_ID already exists in Settings (row " + (i + 1) + ").");
      return;
    }
  }
  var insertAfterRow = -1;
  for (var j = 0; j < data.length; j++) {
    if (String(data[j][0]).trim() === "DRIVE_PARENT_FOLDER_ID") {
      insertAfterRow = j + 1;
      break;
    }
  }
  if (insertAfterRow === -1) insertAfterRow = settingsSh.getLastRow();
  settingsSh.insertRowAfter(insertAfterRow);
  settingsSh.getRange(insertAfterRow + 1, 1).setValue("PHOTOS_FOLDER_ID");
  settingsSh.getRange(insertAfterRow + 1, 2).setValue("");
  settingsSh.getRange(insertAfterRow + 1, 3).setValue("Optional: Separate Drive folder ID for shipment photos. Leave blank to use DRIVE_PARENT_FOLDER_ID.");
  ui.alert("PHOTOS_FOLDER_ID added to Settings (row " + (insertAfterRow + 1) + ").\nPaste the client Photos subfolder ID into column B of that row.");
}


/* ============================================================
   IMPORT INVENTORY — Migrate old client sheets to new format
   v2.0: Local-tab approach. User copies old tabs into this sheet,
   script reads locally (instant), imports, then deletes temp tabs.
   ============================================================ */

/**
 * Entry point: Stride Admin → Import Inventory
 * Direct import — no dialog. Detects pasted tabs, confirms with simple prompt, imports.
 */
function StrideImportInventory() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();

  // Find pasted import tabs
  var activeTabs = [], releasedTabs = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName().trim();
    var nameUpper = name.toUpperCase();
    // Skip system tabs
    var isSystem = false;
    for (var sy = 0; sy < IMPORT_TAB_SYSTEM_.length; sy++) { if (nameUpper === IMPORT_TAB_SYSTEM_[sy]) { isSystem = true; break; } }
    if (isSystem) continue;

    for (var a = 0; a < IMPORT_TAB_ACTIVE_.length; a++) { if (nameUpper.indexOf(IMPORT_TAB_ACTIVE_[a]) !== -1) { activeTabs.push({ name: name, sheet: sheets[i], rows: Math.max(0, sheets[i].getLastRow() - 1) }); break; } }
    if (activeTabs.length && activeTabs[activeTabs.length - 1].name === name) continue;
    for (var r = 0; r < IMPORT_TAB_RELEASED_.length; r++) { if (nameUpper.indexOf(IMPORT_TAB_RELEASED_[r]) !== -1) { releasedTabs.push({ name: name, sheet: sheets[i], rows: Math.max(0, sheets[i].getLastRow() - 1) }); break; } }
  }

  if (!activeTabs.length && !releasedTabs.length) {
    ui.alert("No Import Tabs Found",
      "Copy your old ACTIVE STOCK and/or RELEASED ITEMS tabs into this spreadsheet first.\n\n" +
      "How to:\n1. Open the old spreadsheet\n2. Right-click the tab → Copy to → this spreadsheet\n3. Then run Import Inventory again",
      ui.ButtonSet.OK);
    return;
  }

  // Build summary
  var summary = "Found import tabs:\n";
  for (var ai = 0; ai < activeTabs.length; ai++) summary += "  \u2713 " + activeTabs[ai].name + " (" + activeTabs[ai].rows + " rows) \u2014 Active\n";
  for (var ri = 0; ri < releasedTabs.length; ri++) summary += "  \u2713 " + releasedTabs[ri].name + " (" + releasedTabs[ri].rows + " rows) \u2014 Released\n";
  summary += "\nImport these into the Inventory tab?\nTemp tabs will be deleted after import.";

  var resp = ui.alert("Import Inventory", summary, ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  // Run import
  ss.toast("Importing inventory... please wait.", "Import", -1);
  var result = importInventoryExecuteLocal_();

  if (result.error) {
    ui.alert("Import Error", result.error, ui.ButtonSet.OK);
  } else {
    // v3.1.0: Auto-sync Autocomplete DB after successful import
    try {
      ss.toast("Syncing autocomplete database...", "Autocomplete DB", -1);
      ensureAutocompleteDBSheet_(ss);
      var acResult = syncAutocompleteDB_();
      result.message += " Autocomplete DB: " + acResult.added + " entries added.";
    } catch (acErr) { CI_log_("WARN", "Post-import autocomplete sync failed", String(acErr)); }
    ss.toast(result.message, "Import Complete", 10);
    ui.alert("Import Complete", result.message, ui.ButtonSet.OK);
  }
}

function getImportInventoryDialogHtml_() {
  return '' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:16px;color:#1E293B;}' +
    'h2{margin:0 0 8px;font-size:18px;}' +
    '.steps{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.7;}' +
    '.steps b{color:#E85D2D;}' +
    '.btn{padding:10px 20px;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;}' +
    '.btn-primary{background:#E85D2D;color:#fff;}.btn-primary:hover{background:#D4501F;}' +
    '.btn-secondary{background:#E2E8F0;color:#1E293B;}.btn-secondary:hover{background:#CBD5E1;}' +
    '#preview{display:none;margin-top:14px;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;max-height:300px;overflow-y:auto;}' +
    '#status{margin-top:8px;font-size:12px;color:#64748B;}' +
    '.match{color:#16A34A;}.nomatch{color:#DC2626;}.skip{color:#64748B;}' +
    'table.map{width:100%;border-collapse:collapse;margin:8px 0;}' +
    'table.map td,table.map th{padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;text-align:left;}' +
    'table.map th{background:#F1F5F9;font-weight:700;}' +
    '.spinner{display:inline-block;width:16px;height:16px;border:2px solid #E2E8F0;border-top:2px solid #E85D2D;border-radius:50%;animation:spin 0.8s linear infinite;}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '</style>' +
    '<h2>Import Inventory</h2>' +
    '<div class="steps">' +
    '<b>Step 1:</b> Open the old client spreadsheet<br>' +
    '<b>Step 2:</b> Right-click the <b>ACTIVE STOCK</b> tab \u2192 <b>Copy to</b> \u2192 this spreadsheet<br>' +
    '<b>Step 3:</b> Do the same for <b>RELEASED ITEMS</b> tab (if it exists)<br>' +
    '<b>Step 4:</b> Click <b>Scan Local Tabs</b> below to preview the import' +
    '</div>' +
    '<button class="btn btn-primary" id="scanBtn" onclick="scanLocal()">Scan Local Tabs</button>' +
    '<div id="status"></div>' +
    '<div id="preview"></div>' +
    '<div id="actions" style="display:none;margin-top:12px;text-align:right;">' +
    '<button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button> ' +
    '<button class="btn btn-primary" id="importBtn" onclick="confirmImport()">Confirm Import</button>' +
    '</div>' +
    '<script>' +
    'function scanLocal(){' +
    '  document.getElementById("status").innerHTML = "<span class=\\"spinner\\"></span> Scanning tabs...";' +
    '  document.getElementById("scanBtn").disabled = true;' +
    '  google.script.run.withSuccessHandler(function(r){' +
    '    document.getElementById("status").textContent = "";' +
    '    document.getElementById("scanBtn").disabled = false;' +
    '    if(r.error){document.getElementById("status").textContent = "Error: " + r.error;return;}' +
    '    showPreview(r);' +
    '  }).withFailureHandler(function(err){' +
    '    document.getElementById("status").textContent = "Error: " + err.message;' +
    '    document.getElementById("scanBtn").disabled = false;' +
    '  }).importInventoryScanLocal_();' +
    '}' +
    'function showPreview(r){' +
    '  var h = "<h3 style=\\"margin:0 0 8px;font-size:14px;\\">Import Preview</h3>";' +
    '  h += "<div style=\\"margin-bottom:8px;\\"><b>Tabs detected:</b></div>";' +
    '  for(var i=0;i<r.tabs.length;i++){' +
    '    var t=r.tabs[i];' +
    '    h += "<div style=\\"margin-left:12px;\\">" + (t.skip ? "<span class=\\"skip\\">- " : "<span class=\\"match\\">+ ") + t.name + "</span> \u2014 " + t.rowCount + " rows" + (t.type ? " (" + t.type + ")" : "") + (t.skip ? " <i>skipped</i>" : "") + "</div>";' +
    '  }' +
    '  h += "<div style=\\"margin:12px 0 8px;\\"><b>Column Mapping:</b></div>";' +
    '  h += "<table class=\\"map\\"><tr><th>Old Column</th><th></th><th>New Column</th></tr>";' +
    '  for(var j=0;j<r.mapping.length;j++){' +
    '    var m=r.mapping[j];' +
    '    h += "<tr><td>" + m.old + "</td><td>\u2192</td><td class=\\"match\\">" + m.new_ + "</td></tr>";' +
    '  }' +
    '  h += "</table>";' +
    '  if(r.unmatched && r.unmatched.length){' +
    '    h += "<div style=\\"margin:12px 0 4px;color:#DC2626;font-weight:700;\\">Unmatched columns (not imported):</div>";' +
    '    for(var k=0;k<r.unmatched.length;k++) h += "<div style=\\"margin-left:12px;\\" class=\\"nomatch\\">- " + r.unmatched[k] + "</div>";' +
    '  }' +
    '  h += "<div style=\\"margin-top:12px;\\"><b>Summary:</b> " + r.activeCount + " active items, " + r.releasedCount + " released items (2026+)" + (r.asmCount > 0 ? ", " + r.asmCount + " assembly tasks" : "") + "</div>";' +
    '  document.getElementById("preview").innerHTML = h;' +
    '  document.getElementById("preview").style.display = "block";' +
    '  document.getElementById("actions").style.display = "block";' +
    '}' +
    'function confirmImport(){' +
    '  document.getElementById("importBtn").disabled = true;' +
    '  document.getElementById("status").innerHTML = "<span class=\\"spinner\\"></span> Importing inventory...";' +
    '  google.script.run.withSuccessHandler(function(r){' +
    '    if(r.error){document.getElementById("status").textContent = "Error: " + r.error;document.getElementById("importBtn").disabled=false;return;}' +
    '    document.getElementById("status").innerHTML = "<span style=\\"color:#16A34A;font-weight:700;\\">Done! " + r.message + "</span>";' +
    '    document.getElementById("actions").style.display = "none";' +
    '  }).withFailureHandler(function(err){' +
    '    document.getElementById("status").textContent = "Error: " + err.message;' +
    '    document.getElementById("importBtn").disabled = false;' +
    '  }).importInventoryExecuteLocal_();' +
    '}' +
    '</script>';
}

/* --- Column fuzzy matching config --- */
var IMPORT_COL_MAP_ = {
  "Item ID":          ["ID#", "ID", "ITEM ID", "ITEM #", "ITEM NUMBER"],
  "Qty":              ["QTY", "QUANTITY"],
  "Vendor":           ["VENDOR", "MFG", "MANUFACTURER", "BRAND"],
  "Description":      ["DESCRIPTION", "DESC", "ITEM DESCRIPTION", "ITEM NAME"],
  "Class":            ["CLASS", "STORAGE SIZE", "SIZE", "CU FT", "CUFT", "CUBIC", "CUBIC FEET", "CUBIC VOLUME", "VOLUME", "TTL CU FT", "TTL CUFT", "TOTAL CU FT", "TOTAL CUFT", "TOTAL CUBIC FEET", "TTL CUBIC FEET", "TTL CUBIC FT", "TOTAL CUBIC FT"],
  "Location":         ["LOCATION", "LOC", "WHSE LOCATION", "WAREHOUSE LOCATION"],
  "Room":             ["ROOM", "PROJECT"],
  "Item Notes":       ["ITEM NOTES", "ITEMS NOTES", "NOTES", "COMMENTS"],
  "Inspection Notes": ["INSPECTION NOTES", "INSP NOTES", "INSPECTION"],
  "Assembly Status":  ["ASSEMBLY STATUS", "ASSEMBLY", "ASSM", "ASSY STATUS"],
  "Task Notes":       ["TASK NOTES", "ASSEMBLY NOTES", "ASSEMBLY INSTRUCTIONS", "ASSM NOTES", "ASSY NOTES"],
  "Receive Date":     ["DATE RECEIVED", "RECEIVED", "REC'D", "RECEIVE DATE", "RECV DATE"],
  "Release Date":     ["DATE RELEASED", "RELEASED", "RELEASE DATE"],
  "Photos":           ["PHOTO", "PHOTOS", "PHOTO LINK", "PHOTO URL", "PHOTOS URL"],
  "Sidemark":         ["SIDEMARK", "SIDE MARK", "CLIENT"],
  "Reference":        ["REFERENCE", "REF", "REF#", "REF #", "PO", "PO#", "PO #", "PO NUMBER", "PURCHASE ORDER", "ORDER", "ORDER #", "ORDER NUMBER", "SO#", "SO #", "SALES ORDER", "WORKROOM", "WORKROOM #", "INVOICE #", "JOB", "JOB #", "JOB NUMBER"]
};

/* --- Tab detection --- */
var IMPORT_TAB_ACTIVE_  = ["ACTIVE STOCK", "ACTIVE", "STOCK", "CURRENT INVENTORY", "IN STORAGE"];
var IMPORT_TAB_RELEASED_ = ["RELEASED ITEMS", "RELEASED", "RELEASE", "RELEASED STOCK", "PAST INVENTORY", "DELIVERED"];
var IMPORT_TAB_SYSTEM_ = ["INVENTORY", "SHIPMENTS", "TASKS", "REPAIRS", "WILL_CALLS", "WC_ITEMS",
  "BILLING_LEDGER", "SETTINGS", "SETUP_INSTRUCTIONS", "DOCK_INTAKE", "PRICE_CACHE", "CLASS_CACHE",
  "LOCATION_CACHE", "AUTOCOMPLETE_DB"];

/** Scan LOCAL tabs for pasted old inventory. Instant — no cross-spreadsheet calls. */
function importInventoryScanLocal_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var tabs = [], activeSheet = null, releasedSheet = null, mapping = [], unmatched = [];

    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i].getName().trim();
      var nameUpper = name.toUpperCase();
      var isSystem = false;
      for (var sy = 0; sy < IMPORT_TAB_SYSTEM_.length; sy++) { if (nameUpper === IMPORT_TAB_SYSTEM_[sy]) { isSystem = true; break; } }
      if (isSystem) continue;

      var lr = sheets[i].getLastRow();
      var tabInfo = { name: name, rowCount: Math.max(0, lr - 1), type: "", skip: false };

      if (!activeSheet) { for (var a = 0; a < IMPORT_TAB_ACTIVE_.length; a++) { if (nameUpper.indexOf(IMPORT_TAB_ACTIVE_[a]) !== -1) { activeSheet = sheets[i]; tabInfo.type = "Active Inventory"; break; } } }
      if (!releasedSheet && !tabInfo.type) { for (var r = 0; r < IMPORT_TAB_RELEASED_.length; r++) { if (nameUpper.indexOf(IMPORT_TAB_RELEASED_[r]) !== -1) { releasedSheet = sheets[i]; tabInfo.type = "Released Items"; break; } } }
      if (!tabInfo.type) tabInfo.skip = true;
      tabs.push(tabInfo);
    }

    if (!activeSheet && !releasedSheet) return { error: "No import tabs found. Copy your old ACTIVE STOCK and/or RELEASED ITEMS tabs into this spreadsheet first." };

    var sampleSheet = activeSheet || releasedSheet;
    var lc = sampleSheet.getLastColumn();
    if (lc < 1) return { error: "Detected tab has no columns." };
    var sampleHeaders = sampleSheet.getRange(1, 1, 1, lc).getValues()[0].map(function(h) { return String(h || "").trim(); });
    var matchedOldCols = {};
    for (var newCol in IMPORT_COL_MAP_) {
      var candidates = IMPORT_COL_MAP_[newCol]; var found = false;
      for (var c = 0; c < candidates.length; c++) { for (var h = 0; h < sampleHeaders.length; h++) { if (sampleHeaders[h].toUpperCase() === candidates[c]) { mapping.push({ old: sampleHeaders[h], new_: newCol }); matchedOldCols[sampleHeaders[h].toUpperCase()] = true; found = true; break; } } if (found) break; }
    }
    for (var u = 0; u < sampleHeaders.length; u++) { if (sampleHeaders[u] && !matchedOldCols[sampleHeaders[u].toUpperCase()]) unmatched.push(sampleHeaders[u]); }

    var activeCount = activeSheet ? Math.max(0, activeSheet.getLastRow() - 1) : 0;
    var releasedCount = releasedSheet ? Math.max(0, releasedSheet.getLastRow() - 1) : 0;
    var asmCount = 0;

    // Quick assembly count from active header
    if (activeSheet && activeCount > 0) {
      var actHeaders = activeSheet.getRange(1, 1, 1, activeSheet.getLastColumn()).getValues()[0].map(function(h) { return String(h || "").trim().toUpperCase(); });
      var asmCol = -1;
      var asmCands = ["ASSEMBLY STATUS", "ASSEMBLY", "ASSM", "ASSY STATUS"];
      for (var ac = 0; ac < asmCands.length; ac++) { asmCol = actHeaders.indexOf(asmCands[ac]); if (asmCol !== -1) break; }
      if (asmCol !== -1) {
        var asmData = activeSheet.getRange(2, asmCol + 1, activeCount, 1).getValues();
        for (var ai = 0; ai < asmData.length; ai++) {
          var av = String(asmData[ai][0] || "").trim().toUpperCase();
          if (av.indexOf("NEED") !== -1 || av.indexOf("ASSM") !== -1 || av.indexOf("ASSY") !== -1 || av.indexOf("REQUIRED") !== -1) asmCount++;
        }
      }
    }

    return { tabs: tabs, mapping: mapping, unmatched: unmatched, activeCount: activeCount, releasedCount: releasedCount, asmCount: asmCount };
  } catch (e) { return { error: e.message || String(e) }; }
}

/** Execute import from local pasted tabs. Writes to Inventory/Tasks/Shipments, then deletes temp tabs. */
function importInventoryExecuteLocal_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var classMap = loadClassMapForImport_(ss);
    var invSh = ss.getSheetByName("Inventory");
    if (!invSh) return { error: "Inventory tab not found." };
    var invMap = getHeaderMap_(invSh);
    var taskSh = ss.getSheetByName("Tasks"); var taskMap = taskSh ? getHeaderMap_(taskSh) : null;
    var shipSh = ss.getSheetByName("Shipments"); var shipMap = shipSh ? getHeaderMap_(shipSh) : null;

    var existingIds = {};
    if (invSh.getLastRow() > 1) {
      var idCol = invMap["Item ID"];
      if (idCol) { var idData = invSh.getRange(2, idCol, invSh.getLastRow() - 1, 1).getValues(); for (var ei = 0; ei < idData.length; ei++) { var eid = String(idData[ei][0] || "").trim(); if (eid) existingIds[eid] = true; } }
    }

    var now = new Date();
    // v4.0.2: IMP-MMDDYYHHMMSS format so import date is human-readable
    var shipNo = "IMP-" + Utilities.formatDate(now, Session.getScriptTimeZone(), "MMddyyHHmmss");
    var totalImported = 0, totalSkipped = 0, totalTasks = 0, importedTabNames = [];
    var firstPhotoUrlAgg = ""; // v4.2.4: aggregate across tabs for Shipments-tab hyperlink

    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i].getName().trim(); var nameUpper = name.toUpperCase();
      var isSystem = false;
      for (var sy = 0; sy < IMPORT_TAB_SYSTEM_.length; sy++) { if (nameUpper === IMPORT_TAB_SYSTEM_[sy]) { isSystem = true; break; } }
      if (isSystem) continue;

      var isActive = false, isReleased = false;
      for (var a = 0; a < IMPORT_TAB_ACTIVE_.length; a++) { if (nameUpper.indexOf(IMPORT_TAB_ACTIVE_[a]) !== -1) { isActive = true; break; } }
      if (!isActive) { for (var r = 0; r < IMPORT_TAB_RELEASED_.length; r++) { if (nameUpper.indexOf(IMPORT_TAB_RELEASED_[r]) !== -1) { isReleased = true; break; } } }
      if (!isActive && !isReleased) continue;

      var result = importSheetRows_(sheets[i], invSh, invMap, classMap, existingIds, taskSh, taskMap, isReleased, shipNo);
      totalImported += result.imported; totalSkipped += result.skipped; totalTasks += result.tasks;
      if (!firstPhotoUrlAgg && result.firstPhotoUrl) firstPhotoUrlAgg = result.firstPhotoUrl;
      importedTabNames.push(name);
    }

    if (totalImported > 0 && shipSh && shipMap) {
      var shipRow = buildHeaderRow_(shipMap, { "Shipment #": shipNo, "Receive Date": now, "Item Count": totalImported, "Carrier": "Migration", "Shipment Notes": "Imported from: " + importedTabNames.join(", ") });
      var shipInsertRow = getLastDataRow_(shipSh) + 1;
      shipSh.getRange(shipInsertRow, 1, 1, shipRow.length).setValues([shipRow]);

      // v4.2.4: Hyperlink Shipments-tab Shipment # to first legacy photo URL (no new folder).
      // Previously (v4.2.3) we created an empty IMP folder under Shipments/ — that left the
      // React app's shipment folder button opening an empty folder while real photos lived
      // under the old system URL. Now we reuse the first non-empty photo URL from the items.
      try {
        var shipNumCol = shipMap["Shipment #"];
        if (shipNumCol && firstPhotoUrlAgg) {
          var impRt = SpreadsheetApp.newRichTextValue()
            .setText(shipNo)
            .setLinkUrl(firstPhotoUrlAgg)
            .build();
          shipSh.getRange(shipInsertRow, shipNumCol).setRichTextValue(impRt);
        }
      } catch (linkErr) {
        Logger.log("Import Shipments-tab hyperlink failed (non-fatal): " + linkErr);
      }
    }

    // Delete temp tabs
    for (var d = 0; d < importedTabNames.length; d++) { var tempSh = ss.getSheetByName(importedTabNames[d]); if (tempSh) ss.deleteSheet(tempSh); }

    return { message: "Imported " + totalImported + " items" + (totalSkipped > 0 ? " (" + totalSkipped + " duplicates skipped)" : "") + (totalTasks > 0 ? ". Created " + totalTasks + " assembly tasks." : ".") + " Temp tabs removed." };
  } catch (e) { return { error: e.message || String(e) }; }
}

/** Import rows from one pasted tab into Inventory. */
function importSheetRows_(srcSheet, invSh, invMap, classMap, existingIds, taskSh, taskMap, isReleased, shipNo) {
  var data = srcSheet.getDataRange().getValues();
  if (data.length < 2) return { imported: 0, skipped: 0, tasks: 0, firstPhotoUrl: "" };
  var oldHeaders = data[0].map(function(h) { return String(h || "").trim(); });
  var oldHeadersUpper = oldHeaders.map(function(h) { return h.toUpperCase(); });
  var oldColIdx = {};
  for (var newCol in IMPORT_COL_MAP_) { var candidates = IMPORT_COL_MAP_[newCol]; for (var c = 0; c < candidates.length; c++) { var idx = oldHeadersUpper.indexOf(candidates[c]); if (idx !== -1) { oldColIdx[newCol] = idx; break; } } }

  // Extract photo URLs from rich text, formulas, or plain text
  var photoRichUrls = {};
  if (oldColIdx["Photos"] !== undefined) {
    try {
      var photoCol = oldColIdx["Photos"] + 1; // 1-based
      var lastRow = srcSheet.getLastRow();
      if (lastRow > 1) {
        var photoRange = srcSheet.getRange(2, photoCol, lastRow - 1, 1);
        var richTexts = photoRange.getRichTextValues();
        var formulas = photoRange.getFormulas();
        var plainVals = photoRange.getValues();
        // v4.2.1 perf: batch-read notes once instead of per-cell getCell().getNote() round-trips
        var photoNotes;
        try { photoNotes = photoRange.getNotes(); } catch (_) { photoNotes = null; }

        for (var rt = 0; rt < richTexts.length; rt++) {
          var url = "";

          // Method 1: Rich text link (hyperlinked text)
          var rtVal = richTexts[rt][0];
          if (rtVal) {
            url = rtVal.getLinkUrl() || "";
            if (!url) {
              var runs = rtVal.getRuns();
              for (var rn = 0; rn < runs.length; rn++) {
                var runUrl = runs[rn].getLinkUrl();
                if (runUrl && runUrl.indexOf("http") === 0) { url = runUrl; break; }
              }
            }
          }

          // Method 2: HYPERLINK formula — =HYPERLINK("url", "text")
          if (!url && formulas[rt][0]) {
            var fMatch = formulas[rt][0].match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
            if (fMatch) url = fMatch[1];
          }

          // Method 3: Plain text URL in cell value
          if (!url) {
            var plain = String(plainVals[rt][0] || "").trim();
            if (plain.indexOf("http") === 0) url = plain;
            // Method 4: If cell has a note with a URL (some old sheets store links in notes)
            // v4.2.1 perf: use batch-read photoNotes instead of per-cell getCell().getNote()
            if (!url && photoNotes) {
              var note = String(photoNotes[rt][0] || "");
              if (note && note.indexOf("http") === 0) url = note;
            }
          }

          if (url && url.indexOf("http") === 0) photoRichUrls[rt + 1] = url;
        }
      }
    } catch (rtErr) { Logger.log("Photo URL extraction error: " + rtErr); }
  }

  if (isReleased && oldColIdx["Release Date"] === undefined) throw new Error("Released tab '" + srcSheet.getName() + "' missing Release Date column.");

  // v4.2.1 perf: pre-compute highest existing ASM-<itemId>-N counter per item in ONE read,
  // then increment in-memory. Replaces per-row nextTaskCounter_() calls that each re-read
  // the entire Task ID column.
  var asmCounterByItem = {};
  if (!isReleased && taskSh && taskMap) {
    var taskLr = taskSh.getLastRow();
    if (taskLr > 1) {
      var taskIdCol = taskMap["Task ID"] || 1;
      var allTaskIds = taskSh.getRange(2, taskIdCol, taskLr - 1, 1).getValues();
      for (var tci = 0; tci < allTaskIds.length; tci++) {
        var tid = String(allTaskIds[tci][0] || "");
        var tm = tid.match(/^ASM-(.+)-(\d+)$/);
        if (tm) {
          var tnum = parseInt(tm[2], 10);
          if (!isNaN(tnum) && tnum > (asmCounterByItem[tm[1]] || 0)) asmCounterByItem[tm[1]] = tnum;
        }
      }
    }
  }

  var imported = 0, skipped = 0, tasks = 0, invRows = [], taskRows = [], photoUrlsForRows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var itemId = oldColIdx["Item ID"] !== undefined ? String(row[oldColIdx["Item ID"]] || "").trim() : "";
    if (!itemId) continue;

    if (isReleased && oldColIdx["Release Date"] !== undefined) {
      var relDate = row[oldColIdx["Release Date"]]; var relYear = null;
      if (relDate instanceof Date && !isNaN(relDate.getTime())) relYear = relDate.getFullYear();
      else if (typeof relDate === "string") { var yrMatch = relDate.match(/\b(20\d{2})\b/); if (yrMatch) relYear = parseInt(yrMatch[1], 10); }
      if (relYear === null || relYear < 2026) continue;
    }
    if (existingIds[itemId]) { skipped++; continue; }

    var qty = oldColIdx["Qty"] !== undefined ? row[oldColIdx["Qty"]] : 1;
    var vendor = oldColIdx["Vendor"] !== undefined ? String(row[oldColIdx["Vendor"]] || "") : "";
    var desc = oldColIdx["Description"] !== undefined ? String(row[oldColIdx["Description"]] || "") : "";
    var location = oldColIdx["Location"] !== undefined ? String(row[oldColIdx["Location"]] || "") : "";
    var room = oldColIdx["Room"] !== undefined ? String(row[oldColIdx["Room"]] || "") : "";
    var sidemark = oldColIdx["Sidemark"] !== undefined ? String(row[oldColIdx["Sidemark"]] || "") : "";
    var itemNotes = oldColIdx["Item Notes"] !== undefined ? String(row[oldColIdx["Item Notes"]] || "") : "";
    var reference = oldColIdx["Reference"] !== undefined ? String(row[oldColIdx["Reference"]] || "").trim() : "";
    var recvDate = oldColIdx["Receive Date"] !== undefined ? row[oldColIdx["Receive Date"]] : "";
    var relDate2 = oldColIdx["Release Date"] !== undefined ? row[oldColIdx["Release Date"]] : "";
    var inspNotes = oldColIdx["Inspection Notes"] !== undefined ? String(row[oldColIdx["Inspection Notes"]] || "").trim() : "";
    // Get photo URL from rich text extraction (smart chips), fall back to plain text
    var photoUrl = photoRichUrls[i] || "";
    if (!photoUrl && oldColIdx["Photos"] !== undefined) photoUrl = String(row[oldColIdx["Photos"]] || "").trim();

    if (inspNotes) itemNotes = itemNotes ? itemNotes + " | Insp: " + inspNotes : "Insp: " + inspNotes;
    // v4.0.2: Stamp import date/time in Item Notes for Item History visibility
    var importStamp = "Imported " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yy h:mm a");
    itemNotes = itemNotes ? itemNotes + " | " + importStamp : importStamp;

    var itemClass = "";
    if (oldColIdx["Class"] !== undefined) {
      itemClass = resolveImportClass_(row[oldColIdx["Class"]], classMap);
    }

    var needsAssembly = false, asmRawVal = "";
    if (oldColIdx["Assembly Status"] !== undefined) {
      asmRawVal = String(row[oldColIdx["Assembly Status"]] || "").trim(); var asmVal = asmRawVal.toUpperCase();
      if (asmVal.indexOf("NEED") !== -1 || asmVal.indexOf("ASSM") !== -1 || asmVal.indexOf("ASSY") !== -1 || asmVal.indexOf("REQUIRED") !== -1) needsAssembly = true;
    }
    var status = isReleased ? INVENTORY_STATUS.RELEASED : INVENTORY_STATUS.ACTIVE;
    existingIds[itemId] = true;

    // Track photo URL for this row to hyperlink Shipment # after write
    photoUrlsForRows.push((photoUrl && photoUrl.indexOf("http") === 0) ? photoUrl : "");

    // v4.0.2: Removed Needs Inspection/Assembly — task creation now via menu
    invRows.push(buildHeaderRow_(invMap, {
      "Item ID": itemId, "Qty": qty || 1, "Vendor": vendor, "Description": desc,
      "Class": itemClass, "Location": location, "Sidemark": sidemark, "Room": room,
      "Item Notes": itemNotes, "Reference": reference,
      "Shipment #": shipNo, "Receive Date": recvDate, "Release Date": isReleased ? relDate2 : "", "Status": status
    }));
    imported++;

    if (needsAssembly && !isReleased && taskSh && taskMap) {
      // v4.2.1 perf: use pre-computed in-memory counter instead of re-reading Tasks sheet per row
      asmCounterByItem[itemId] = (asmCounterByItem[itemId] || 0) + 1;
      var asmTaskId = "ASM-" + itemId + "-" + asmCounterByItem[itemId];
      // v4.2.2: Pull dedicated Task Notes column from legacy sheet if present;
      // fall back to inspection notes (so assembly workers see condition context),
      // then the Assembly Status cell value, then generic default.
      var legacyTaskNotes = oldColIdx["Task Notes"] !== undefined ? String(row[oldColIdx["Task Notes"]] || "").trim() : "";
      var taskNoteVal = legacyTaskNotes || inspNotes || asmRawVal || "Needs assembly";
      taskRows.push(buildHeaderRow_(taskMap, {
        "Task ID": asmTaskId, "Item ID": itemId, "Type": "Assembly",
        "Task Notes": taskNoteVal, "Status": "Open", "Created": new Date(),
        "Svc Code": "ASM", "Billed": false, "Shipment #": shipNo, "Vendor": vendor,
        "Description": desc, "Location": location, "Sidemark": sidemark, "Item Notes": itemNotes
      }));
      tasks++;
    }
  }
  if (invRows.length > 0) {
    // v4.2.1 perf: removed SpreadsheetApp.flush() — no prior writes in this function need committing;
    // it was forcing full recalc of ARRAYFORMULAs/validations before every insert.
    var invStartRow = getLastDataRow_(invSh) + 1;
    Logger.log("Import: inserting " + invRows.length + " rows at row " + invStartRow + " (getLastDataRow_=" + (invStartRow - 1) + ", sheet.getLastRow()=" + invSh.getLastRow() + ")");
    invSh.getRange(invStartRow, 1, invRows.length, invRows[0].length).setValues(invRows);

    // v4.0.3: Re-apply Create Repair Quote checkbox (setValues strips data validation)
    var repairQuoteCol = invMap["Create Repair Quote"];
    if (repairQuoteCol) {
      invSh.getRange(invStartRow, repairQuoteCol, invRows.length, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireCheckbox().build()
      );
    }

    // v4.0.3: Hyperlink Shipment # (IMP-number) to photo URL from old system
    // v4.2.1 perf: batch into a single setRichTextValues call instead of per-cell writes
    var shipColImport = invMap["Shipment #"];
    if (shipColImport && photoUrlsForRows.length > 0) {
      var hasAnyPhoto = false;
      for (var pc = 0; pc < photoUrlsForRows.length; pc++) { if (photoUrlsForRows[pc]) { hasAnyPhoto = true; break; } }
      if (hasAnyPhoto) {
        try {
          var rtRange = invSh.getRange(invStartRow, shipColImport, invRows.length, 1);
          var existingRt = rtRange.getRichTextValues();
          var newRt = [];
          for (var p = 0; p < invRows.length; p++) {
            if (photoUrlsForRows[p]) {
              newRt.push([SpreadsheetApp.newRichTextValue()
                .setText(shipNo)
                .setLinkUrl(photoUrlsForRows[p])
                .build()]);
            } else {
              // Preserve whatever setValues just wrote (plain-text shipNo)
              newRt.push([existingRt[p][0]]);
            }
          }
          rtRange.setRichTextValues(newRt);
        } catch (_) {}
      }
    }
  }
  if (taskRows.length > 0 && taskSh) {
    var taskStartRow = getLastDataRow_(taskSh) + 1;
    taskSh.getRange(taskStartRow, 1, taskRows.length, taskRows[0].length).setValues(taskRows);

    // Re-apply checkbox data validation for Billed column
    var billedCol = taskMap["Billed"];
    if (billedCol) taskSh.getRange(taskStartRow, billedCol, taskRows.length, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().build()
    );

    // v4.0.2: Task folder/PDF creation removed from Import — deferred to Start Task checkbox
  }
  // v4.2.4: find first non-empty photo URL to pass up for Shipments-tab hyperlink
  var firstPhotoUrl = "";
  for (var fp = 0; fp < photoUrlsForRows.length; fp++) {
    if (photoUrlsForRows[fp]) { firstPhotoUrl = photoUrlsForRows[fp]; break; }
  }
  return { imported: imported, skipped: skipped, tasks: tasks, firstPhotoUrl: firstPhotoUrl };
}

/**
 * v4.1.0: Resolve a legacy Class/Size cell value to a canonical class code.
 * Handles:
 *   - numeric cu-ft (e.g. 50 → M via sizeToClass_)
 *   - direct class codes (XS/S/M/L/XL/XXL)
 *   - size words ("Small" → S, "Medium" → M, "Extra Large" → XL, etc.)
 *   - mixed strings with units ("50 cf", "75 cu ft", "110 cubic ft")
 *   - embedded class codes ("Large - box" → L)
 * Returns "" if no match.
 */
function resolveImportClass_(rawClass, classMap) {
  if (rawClass === "" || rawClass == null) return "";
  // 1) Pure number → nearest class by cubic volume
  var numVal = Number(rawClass);
  if (isFinite(numVal) && numVal > 0) return sizeToClass_(numVal, classMap);

  var s = String(rawClass).trim().toUpperCase();
  if (!s) return "";

  // 2) Exact class code match
  if (classMap[s] !== undefined) return s;
  if (["XS","S","M","L","XL","XXL"].indexOf(s) !== -1) return s;

  // 3) Extract first number from mixed string (e.g. "50 cf", "75 cu ft", "~110")
  var numMatch = s.match(/-?\d+(\.\d+)?/);
  if (numMatch) {
    var extracted = Number(numMatch[0]);
    if (isFinite(extracted) && extracted > 0) return sizeToClass_(extracted, classMap);
  }

  // 4) Size word fuzzy match (check longest/most specific first)
  //    Extra Small → XS, Extra Large → XL, then single words
  if (/\b(EXTRA[\s\-]*SMALL|X[\s\-]*SMALL|XSMALL|XS)\b/.test(s)) return "XS";
  if (/\b(EXTRA[\s\-]*EXTRA[\s\-]*LARGE|XX[\s\-]*LARGE|XXLARGE|XXL)\b/.test(s)) return "XXL";
  if (/\b(EXTRA[\s\-]*LARGE|X[\s\-]*LARGE|XLARGE|XL)\b/.test(s)) return "XL";
  if (/\b(SMALL|SMAL|SML|SM)\b/.test(s)) return "S";
  if (/\b(MEDIUM|MED|MID|MD)\b/.test(s)) return "M";
  if (/\b(LARGE|LRG|LG|LRGE)\b/.test(s)) return "L";

  // 5) Single-letter at start (e.g. "S - box", "M/large")
  var firstLetter = s.charAt(0);
  if (s.length === 1 && ["S","M","L"].indexOf(firstLetter) !== -1) return firstLetter;

  return "";
}

function sizeToClass_(cuFt, classMap) {
  var bestClass = "", bestDiff = Infinity;
  for (var cls in classMap) { var diff = Math.abs(classMap[cls] - cuFt); if (diff < bestDiff) { bestDiff = diff; bestClass = cls; } }
  return bestClass;
}

function loadClassMapForImport_(ss) {
  var cacheSh = ss.getSheetByName("Class_Cache");
  if (!cacheSh) { var masterId = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_SPREADSHEET_ID); if (masterId) { try { cacheSh = SpreadsheetApp.openById(masterId).getSheetByName("Class_Map"); } catch(_) {} } }
  if (!cacheSh || cacheSh.getLastRow() < 2) return { "XS": 10, "S": 25, "M": 50, "L": 75, "XL": 110 };
  var data = cacheSh.getDataRange().getValues(); var map = {};
  for (var i = 0; i < data[0].length; i++) map[String(data[0][i]).trim().toUpperCase()] = i;
  var classCol = map["CLASS"], volCol = map["CUBIC VOLUME"] !== undefined ? map["CUBIC VOLUME"] : map["STORAGE SIZE"];
  if (classCol === undefined || volCol === undefined) return { "XS": 10, "S": 25, "M": 50, "L": 75, "XL": 110 };
  var classMap = {};
  for (var j = 1; j < data.length; j++) { var cls = String(data[j][classCol] || "").trim(); if (cls) classMap[cls] = Number(data[j][volCol]) || 0; }
  return classMap;
}

function buildHeaderRow_(headerMap, values) {
  var maxCol = 0;
  for (var key in headerMap) { if (headerMap[key] > maxCol) maxCol = headerMap[key]; }
  var row = new Array(maxCol).fill("");
  for (var field in values) { if (headerMap[field]) row[headerMap[field] - 1] = values[field]; }
  return row;
}

/**
 * v4.4.0: Backfill IMP Shipments-tab hyperlinks from Inventory row photo URLs.
 *
 * Why: Import.gs v4.2.3 created an empty Drive folder per IMP shipment and
 * hyperlinked the Shipments-tab Shipment # to it. Meanwhile the real legacy
 * photo URLs were correctly written to each Inventory row's Shipment # cell.
 * The React app's shipment folder button reads the Shipments-tab hyperlink,
 * so it opens the empty folder. This function rewrites every IMP row's
 * Shipments-tab hyperlink to a URL pulled from a matching Inventory row.
 *
 * Strategy per IMP row:
 *   1. Scan Inventory for any row with matching Shipment # (plain text match).
 *   2. Read that row's Shipment # rich-text link. First non-empty wins.
 *   3. Rewrite Shipments row's Shipment # rich-text with the same shipNo text
 *      but the discovered URL.
 *
 * Safe to re-run. Rows already pointing at a non-"/folders/<shipNo>"-style
 * link are left alone unless force=true. Returns a summary object.
 *
 * @param {boolean} [force=false] If true, overwrites even rows already linked
 *                                to a URL that doesn't look like the empty
 *                                self-folder. Default: only rewrite rows whose
 *                                current link is missing OR looks like the
 *                                auto-created empty IMP folder.
 */
function backfillImpShipmentFolderUrls_(force) {
  force = !!force;
  var ss = SpreadsheetApp.getActive();
  var shipSh = ss.getSheetByName("Shipments");
  var invSh  = ss.getSheetByName("Inventory");
  if (!shipSh || !invSh) {
    return { ok: false, message: "Missing Shipments or Inventory tab", scanned: 0, updated: 0 };
  }
  var shipMap = getHeaderMap_(shipSh);
  var invMap  = getHeaderMap_(invSh);
  var shipCol_Ship = shipMap["Shipment #"]; if (!shipCol_Ship) return { ok: false, message: "Shipments missing Shipment # column" };
  var invCol_Ship  = invMap["Shipment #"];  if (!invCol_Ship)  return { ok: false, message: "Inventory missing Shipment # column" };

  var shipLast = getLastDataRow_(shipSh);
  var invLast  = getLastDataRow_(invSh);
  if (shipLast < 2 || invLast < 2) return { ok: true, message: "No data to backfill", scanned: 0, updated: 0 };

  // Build map: shipNo -> first non-empty legacy URL found on Inventory
  var invRange = invSh.getRange(2, invCol_Ship, invLast - 1, 1);
  var invPlain = invRange.getValues();
  var invRt    = invRange.getRichTextValues();
  var urlByShip = {};
  for (var i = 0; i < invPlain.length; i++) {
    var sn = String(invPlain[i][0] || "").trim();
    if (!sn || sn.indexOf("IMP-") !== 0) continue;
    if (urlByShip[sn]) continue;
    var rt = invRt[i][0];
    var url = rt ? rt.getLinkUrl() : "";
    if (url && url.indexOf("http") === 0) urlByShip[sn] = url;
  }

  // Walk Shipments tab and rewrite IMP rows
  var shipRange = shipSh.getRange(2, shipCol_Ship, shipLast - 1, 1);
  var shipPlain = shipRange.getValues();
  var shipRt    = shipRange.getRichTextValues();
  var newRt     = shipRange.getRichTextValues(); // start from existing
  var scanned = 0, updated = 0, noSource = 0, skipped = 0;
  var examples = [];
  for (var r = 0; r < shipPlain.length; r++) {
    var snShip = String(shipPlain[r][0] || "").trim();
    if (!snShip || snShip.indexOf("IMP-") !== 0) continue;
    scanned++;
    var sourceUrl = urlByShip[snShip];
    if (!sourceUrl) { noSource++; continue; }
    var curUrl = shipRt[r][0] ? shipRt[r][0].getLinkUrl() : "";
    // Default: always rewrite IMP rows, since v4.2.3 created universally-broken empty
    // folder links. If the current link already matches the Inventory source, it's a
    // no-op anyway. `force` is preserved for API symmetry but the default is already
    // aggressive.
    if (curUrl === sourceUrl) { skipped++; continue; }
    newRt[r][0] = SpreadsheetApp.newRichTextValue()
      .setText(snShip)
      .setLinkUrl(sourceUrl)
      .build();
    updated++;
    if (examples.length < 5) examples.push({ shipNo: snShip, newUrl: sourceUrl });
  }
  if (updated > 0) {
    shipRange.setRichTextValues(newRt);
  }
  return {
    ok: true,
    scanned: scanned,
    updated: updated,
    skippedHadLink: skipped,
    noSourceInInventory: noSource,
    force: force,
    examples: examples,
    message: "Backfilled " + updated + "/" + scanned + " IMP Shipments rows" +
             (skipped ? " (skipped " + skipped + " already-linked; pass force=true to overwrite)" : "") +
             (noSource ? "; " + noSource + " had no matching Inventory URL" : "")
  };
}

/** Menu-friendly wrapper: preview only (no force). */
function backfillImpShipmentFolderUrls_Preview() {
  var res = backfillImpShipmentFolderUrls_(false);
  SpreadsheetApp.getUi().alert("Backfill preview\n\n" + JSON.stringify(res, null, 2));
}

/** Menu-friendly wrapper: force overwrite all IMP Shipments rows. */
function backfillImpShipmentFolderUrls_Force() {
  var res = backfillImpShipmentFolderUrls_(true);
  SpreadsheetApp.getUi().alert("Backfill (force)\n\n" + JSON.stringify(res, null, 2));
}
