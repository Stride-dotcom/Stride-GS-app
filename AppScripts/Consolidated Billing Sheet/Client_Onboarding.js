/* ===================================================
   Client_Onboarding.js — v1.8.0 — 2026-04-09 12:00 PM PST
   =================================================== */
/**
 * Client_Onboarding.gs — Stride Consolidated Billing
 * v1.5.0: Sends onboard notification email with rollout instructions
 * v1.4.0: Config values moved from Clients rows 1-3 to Settings tab.
 *         Clients tab is now clean: Row 1 = headers, Row 2+ = data.
 *         BUG-001 fix (folder IDs not writing back to Clients tab)
 *         BUG-004 fix (truthy_() not defined in CB project — inlined)
 *         Write PHOTOS_FOLDER_ID to new client Settings tab on onboard
 *
 * Settings tab keys (Consolidated Billing):
 *   CLIENT_INVENTORY_TEMPLATE_ID  — Spreadsheet ID of the template to copy
 *   CLIENT_PARENT_FOLDER_ID       — Drive folder where new client folders go
 *
 * Clients tab layout (v1.4.0):
 *   Row 1: Column headers
 *   Row 2+: Client data rows
 */

/* ================================================================
   CONSTANTS
   ================================================================ */

var CB_SETTINGS_KEYS = {
  TEMPLATE_ID: "CLIENT_INVENTORY_TEMPLATE_ID",
  PARENT_FOLDER_ID: "CLIENT_PARENT_FOLDER_ID"
};
var CLIENTS_HEADER_ROW = 1;
var CLIENTS_DATA_START_ROW = 2;

var ONBOARD_COL = {
  CLIENT_NAME:              "Client Name",
  CLIENT_SPREADSHEET_ID:    "Client Spreadsheet ID",
  CLIENT_FOLDER_ID:         "Client Folder ID",
  PHOTOS_FOLDER_ID:         "Photos Folder ID",
  INVOICE_FOLDER_ID:        "Invoice Folder ID",
  CLIENT_EMAIL:             "Client Email",
  FREE_STORAGE_DAYS:        "Free Storage Days",
  DISCOUNT_STORAGE_PCT:     "Discount Storage %",
  DISCOUNT_SERVICES_PCT:    "Discount Services %",
  PAYMENT_TERMS:            "Payment Terms",
  ENABLE_RECEIVING_BILLING: "Enable Receiving Billing",
  ENABLE_SHIPMENT_EMAIL:    "Enable Shipment Email",
  ENABLE_NOTIFICATIONS:     "Enable Notifications",
  AUTO_INSPECTION:          "Auto Inspection",
  SEPARATE_BY_SIDEMARK:     "Separate By Sidemark",
  ACTIVE:                   "Active",
  RUN_ONBOARD:              "Run Onboard",
  NOTES:                    "Notes",
  QB_CUSTOMER_NAME:         "QB_CUSTOMER_NAME",
  STAX_CUSTOMER_ID:         "Stax Customer ID",
  IMPORT_INVENTORY_URL:     "Import Inventory URL"
};

var ONBOARD_TO_SETTINGS_MAP = {
  "Client Email":             "CLIENT_EMAIL",
  "Client Name":              "CLIENT_NAME",
  "Free Storage Days":        "FREE_STORAGE_DAYS",
  "Discount Storage %":       "DISCOUNT_STORAGE_PCT",
  "Discount Services %":      "DISCOUNT_SERVICES_PCT",
  "Payment Terms":            "PAYMENT_TERMS",
  "Enable Receiving Billing": "ENABLE_RECEIVING_BILLING",
  "Enable Shipment Email":    "ENABLE_SHIPMENT_EMAIL",
  "Enable Notifications":     "ENABLE_NOTIFICATIONS",
  "Auto Inspection":          "AUTO_INSPECTION",
  "Separate By Sidemark":     "SEPARATE_BY_SIDEMARK",
    "QB_CUSTOMER_NAME":   "QB_CUSTOMER_NAME"
};

/* ================================================================
   LOCAL HELPER — BUG-004 FIX
   truthy_() is not defined in the Consolidated Billing project.
   Inlined here to avoid ReferenceError silent failures.
   ================================================================ */

/**
 * Returns true if val is boolean true, string "TRUE" (case-insensitive),
 * or number 1.
 * @param {*} val
 * @return {boolean}
 */
function isTruthy_(val) {
  if (val === true || val === 1) return true;
  if (typeof val === "string" && val.trim().toUpperCase() === "TRUE") return true;
  return false;
}

/* ================================================================
   CONFIG HELPERS
   ================================================================ */

/**
 * Reads a config value from the Consolidated Billing Settings tab by key name.
 * @param {string} settingsKey  e.g. "CLIENT_INVENTORY_TEMPLATE_ID"
 * @return {string}
 */
function getCBSettingValue_(settingsKey) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CB_SH.SETTINGS);
  if (!sh) return "";
  var data = sh.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0] || "").trim() === settingsKey) {
      return String(data[i][1] || "").trim();
    }
  }
  return "";
}

/* ================================================================
   ONBOARD TRIGGER
   ================================================================ */

function handleOnboardEditTrigger_(e) {
  if (!e || !e.range) return;
  if (!e.authMode || e.authMode !== ScriptApp.AuthMode.FULL) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== CB_SH.CLIENTS) return;

  var editedRow = e.range.getRow();
  var editedCol = e.range.getColumn();

  if (editedRow < CLIENTS_DATA_START_ROW) return;

  var headerRow = sh.getRange(CLIENTS_HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var hMap = {};
  for (var h = 0; h < headerRow.length; h++) {
    var key = String(headerRow[h]).trim().toUpperCase();
    if (key) hMap[key] = h;
  }

  var runOnboardIdx = hMap[ONBOARD_COL.RUN_ONBOARD.toUpperCase()];
  if (runOnboardIdx === undefined) return;
  if (editedCol !== runOnboardIdx + 1) return;

  // BUG-004 FIX: use isTruthy_() instead of truthy_()
  var newVal = e.range.getValue();
  if (!isTruthy_(newVal)) return;

  var rowData = sh.getRange(editedRow, 1, 1, sh.getLastColumn()).getValues()[0];

  var nameIdx = hMap[ONBOARD_COL.CLIENT_NAME.toUpperCase()];
  if (nameIdx === undefined) return;
  var clientName = String(rowData[nameIdx] || "").trim();
  if (!clientName) {
    SpreadsheetApp.getUi().alert("Onboard Error: Client Name is required.");
    sh.getRange(editedRow, runOnboardIdx + 1).setValue(false);
    return;
  }

  var ssIdIdx = hMap[ONBOARD_COL.CLIENT_SPREADSHEET_ID.toUpperCase()];
  if (ssIdIdx === undefined) return;
  if (String(rowData[ssIdIdx] || "").trim()) {
    SpreadsheetApp.getUi().alert(
      "Client \"" + clientName + "\" already has a Spreadsheet ID. " +
      "Use Stride Billing > Sync Settings to Client to update settings."
    );
    // v1.4.0: Keep checkbox checked so users can see onboard was already run
    return;
  }

  try {
    var onboardResult = onboardNewClient_(sh, editedRow, rowData, hMap);
    var toastMsg = "Client \"" + clientName + "\" onboarded successfully!";
    if (onboardResult && onboardResult.importResult) {
      if (onboardResult.importResult.error) {
        toastMsg += " ⚠ Inventory import failed: " + onboardResult.importResult.error;
      } else {
        toastMsg += " Imported " + onboardResult.importResult.imported + " items.";
        if (onboardResult.importResult.tasks > 0) {
          toastMsg += " Created " + onboardResult.importResult.tasks + " assembly tasks.";
        }
      }
    }
    SpreadsheetApp.getActiveSpreadsheet().toast(toastMsg, "Onboard Complete", 10);

    // v1.5.0: Send rollout instructions email (internal)
    var newSsId = "";
    try {
      var ssIdIdx = hMap[ONBOARD_COL.CLIENT_SPREADSHEET_ID.toUpperCase()];
      newSsId = ssIdIdx !== undefined ? String(sh.getRange(editedRow, ssIdIdx + 1).getValue() || "").trim() : "";
      sendOnboardNotificationEmail_(clientName, newSsId);
    } catch (emailErr) {
      Logger.log("Onboard notification email failed: " + emailErr);
    }

    // v3.0.1: Send welcome email to client
    try {
      if (newSsId) {
        var clientSs = SpreadsheetApp.openById(newSsId);
        sendWelcomeEmailFromCB_(clientSs, clientName);
      }
    } catch (welcomeErr) {
      Logger.log("Welcome email failed: " + welcomeErr);
    }

    // v1.6.0: Auto-create user record in Users tab (Active=FALSE, requires manual activation)
    try {
      var clientEmailIdx = hMap[ONBOARD_COL.CLIENT_EMAIL.toUpperCase()];
      var clientEmail = clientEmailIdx !== undefined
        ? String(rowData[clientEmailIdx] || "").trim()
        : "";
      if (clientEmail && newSsId) {
        autoCreateUserOnOnboard_(clientEmail, clientName, newSsId);
      }
    } catch (userErr) {
      Logger.log("Auto-create user failed (non-blocking): " + userErr);
    }
  } catch (err) {
    // On failure, uncheck so user can retry
    sh.getRange(editedRow, runOnboardIdx + 1).setValue(false);
    SpreadsheetApp.getUi().alert("Onboard failed for \"" + clientName + "\": " + err.message);
    Logger.log("Onboard error: " + err + "\n" + err.stack);
  }
  // v1.4.0: Checkbox stays checked after successful onboard to prevent accidental re-runs
}

/* ================================================================
   CORE ONBOARD LOGIC
   ================================================================ */

function onboardNewClient_(clientsSh, row, rowData, hMap) {

  /* 1. Read config from Settings tab */
  var templateId = getCBSettingValue_(CB_SETTINGS_KEYS.TEMPLATE_ID);
  var parentFolderId = getCBSettingValue_(CB_SETTINGS_KEYS.PARENT_FOLDER_ID);

  if (!templateId) throw new Error("CLIENT_INVENTORY_TEMPLATE_ID is not set in the Settings tab.");
  if (!parentFolderId) throw new Error("CLIENT_PARENT_FOLDER_ID is not set in the Settings tab.");

  /* 2. Read client name */
  var nameIdx = hMap[ONBOARD_COL.CLIENT_NAME.toUpperCase()];
  if (nameIdx === undefined) throw new Error("Client Name column not found in Clients tab headers.");
  var clientName = String(rowData[nameIdx] || "").trim();

  /* BUG-001 FIX: Pre-flight column existence check.
     Validates all auto-fill columns exist in hMap BEFORE any Drive
     resources are created. Throws a clear error instead of silently
     skipping writes after folders have already been created. */
  var requiredAutofillCols = [
    ONBOARD_COL.CLIENT_SPREADSHEET_ID,
    ONBOARD_COL.CLIENT_FOLDER_ID,
    ONBOARD_COL.PHOTOS_FOLDER_ID,
    ONBOARD_COL.INVOICE_FOLDER_ID,
    ONBOARD_COL.ACTIVE
  ];
  var missingCols = [];
  for (var mc = 0; mc < requiredAutofillCols.length; mc++) {
    if (hMap[requiredAutofillCols[mc].toUpperCase()] === undefined) {
      missingCols.push(requiredAutofillCols[mc]);
    }
  }
  if (missingCols.length > 0) {
    throw new Error(
      "Clients tab is missing required columns: " + missingCols.join(", ") + ". " +
      "Please run Stride Billing > Migrate Clients Tab (v1.3.0) first."
    );
  }

  /* 3. Create client folder */
  var parentFolder = DriveApp.getFolderById(parentFolderId);
  var clientFolder = parentFolder.createFolder(clientName);
  var clientFolderId = clientFolder.getId();

  /* 4. Create Photos subfolder */
  var photosFolder = clientFolder.createFolder("Photos");
  var photosFolderId = photosFolder.getId();

  /* 5. Create Invoices subfolder */
  var invoicesFolder = clientFolder.createFolder("Invoices");
  var invoicesFolderId = invoicesFolder.getId();

  /* 6. Copy inventory template */
  var templateFile = DriveApp.getFileById(templateId);
  var newFile = templateFile.makeCopy(clientName, clientFolder);
  var newSpreadsheetId = newFile.getId();

  /* 7. Write settings to new client sheet */
  var cbSsId = SpreadsheetApp.getActive().getId();
  writeSettingsToClientSheet_(newSpreadsheetId, clientName, rowData, hMap,
    clientFolderId, photosFolderId, invoicesFolderId, cbSsId);

  /* 8. Write IDs back to Clients row.
     BUG-001 FIX: pre-flight above guarantees none of these are undefined.
     Removed the undefined guards that were causing silent skips. */
  var colSsId   = hMap[ONBOARD_COL.CLIENT_SPREADSHEET_ID.toUpperCase()];
  var colFolder  = hMap[ONBOARD_COL.CLIENT_FOLDER_ID.toUpperCase()];
  var colPhotos  = hMap[ONBOARD_COL.PHOTOS_FOLDER_ID.toUpperCase()];
  var colInvoice = hMap[ONBOARD_COL.INVOICE_FOLDER_ID.toUpperCase()];
  var colActive  = hMap[ONBOARD_COL.ACTIVE.toUpperCase()];

  clientsSh.getRange(row, colSsId + 1).setValue(newSpreadsheetId);
  clientsSh.getRange(row, colFolder + 1).setValue(clientFolderId);
  clientsSh.getRange(row, colPhotos + 1).setValue(photosFolderId);
  clientsSh.getRange(row, colInvoice + 1).setValue(invoicesFolderId);
  clientsSh.getRange(row, colActive + 1).setValue(true);

  /* 9. Import inventory from old spreadsheet if URL is provided */
  var result = { importResult: null };
  var importUrlIdx = hMap[ONBOARD_COL.IMPORT_INVENTORY_URL.toUpperCase()];
  if (importUrlIdx !== undefined) {
    var importUrl = String(rowData[importUrlIdx] || "").trim();
    if (importUrl) {
      try {
        result.importResult = onboardImportInventory_(importUrl, newSpreadsheetId);
      } catch (importErr) {
        Logger.log("Import inventory error during onboard: " + importErr);
        // Don't fail the whole onboard — just log the import error
        result.importResult = { imported: 0, tasks: 0, error: importErr.message };
      }
    }
  }
  return result;
}

function writeSettingsToClientSheet_(ssId, clientName, rowData, hMap,
                                      clientFolderId, photosFolderId, invoiceFolderId, cbSsId) {
  var clientSs = SpreadsheetApp.openById(ssId);
  var settingsSh = clientSs.getSheetByName("Settings");
  if (!settingsSh) {
    Logger.log("Warning: No Settings tab found in client sheet " + ssId);
    return { updated: [], skipped: ["No Settings tab"] };
  }

  var settingsData = settingsSh.getDataRange().getValues();
  var keyToRow = {};
  for (var i = 0; i < settingsData.length; i++) {
    var key = String(settingsData[i][0] || "").trim();
    if (key) keyToRow[key] = i + 1;
  }

  var updated = [];
  var skipped = [];

  // Folder IDs
  if (clientFolderId) {
    if (keyToRow["DRIVE_PARENT_FOLDER_ID"]) {
      settingsSh.getRange(keyToRow["DRIVE_PARENT_FOLDER_ID"], 2).setValue(clientFolderId);
      updated.push("DRIVE_PARENT_FOLDER_ID");
    } else {
      var nr = settingsSh.getLastRow() + 1;
      settingsSh.getRange(nr, 1).setValue("DRIVE_PARENT_FOLDER_ID");
      settingsSh.getRange(nr, 2).setValue(clientFolderId);
      keyToRow["DRIVE_PARENT_FOLDER_ID"] = nr;
      updated.push("DRIVE_PARENT_FOLDER_ID (added)");
    }
  }
  if (invoiceFolderId) {
    if (keyToRow["MASTER_ACCOUNTING_FOLDER_ID"]) {
      settingsSh.getRange(keyToRow["MASTER_ACCOUNTING_FOLDER_ID"], 2).setValue(invoiceFolderId);
      updated.push("MASTER_ACCOUNTING_FOLDER_ID");
    } else {
      var nr2 = settingsSh.getLastRow() + 1;
      settingsSh.getRange(nr2, 1).setValue("MASTER_ACCOUNTING_FOLDER_ID");
      settingsSh.getRange(nr2, 2).setValue(invoiceFolderId);
      keyToRow["MASTER_ACCOUNTING_FOLDER_ID"] = nr2;
      updated.push("MASTER_ACCOUNTING_FOLDER_ID (added)");
    }
  }
  if (photosFolderId) {
    if (keyToRow["PHOTOS_FOLDER_ID"]) {
      settingsSh.getRange(keyToRow["PHOTOS_FOLDER_ID"], 2).setValue(photosFolderId);
      updated.push("PHOTOS_FOLDER_ID");
    } else {
      var nr3 = settingsSh.getLastRow() + 1;
      settingsSh.getRange(nr3, 1).setValue("PHOTOS_FOLDER_ID");
      settingsSh.getRange(nr3, 2).setValue(photosFolderId);
      keyToRow["PHOTOS_FOLDER_ID"] = nr3;
      updated.push("PHOTOS_FOLDER_ID (added)");
    }
  }

  if (!cbSsId) cbSsId = SpreadsheetApp.getActive().getId();
  if (keyToRow["CONSOLIDATED_BILLING_SPREADSHEET_ID"]) {
    settingsSh.getRange(keyToRow["CONSOLIDATED_BILLING_SPREADSHEET_ID"], 2).setValue(cbSsId);
    updated.push("CONSOLIDATED_BILLING_SPREADSHEET_ID");
  }

  for (var colHeader in ONBOARD_TO_SETTINGS_MAP) {
    var settingsKey = ONBOARD_TO_SETTINGS_MAP[colHeader];
    var colIdx = hMap[colHeader.toUpperCase()];
    if (colIdx === undefined) {
      skipped.push(settingsKey + " (column '" + colHeader + "' not found in headers)");
      continue;
    }

    var val = rowData[colIdx];
    var source = "from sheet";
    if (settingsKey === "CLIENT_NAME") { val = clientName; source = "clientName param"; }
    if (val === "" || val === undefined || val === null) {
      if (settingsKey === "FREE_STORAGE_DAYS" || settingsKey === "DISCOUNT_STORAGE_PCT" ||
          settingsKey === "DISCOUNT_SERVICES_PCT") {
        val = 0; source = "default";
      } else if (settingsKey === "ENABLE_RECEIVING_BILLING" || settingsKey === "ENABLE_SHIPMENT_EMAIL" ||
                 settingsKey === "ENABLE_NOTIFICATIONS" || settingsKey === "AUTO_INSPECTION") {
        val = "TRUE"; source = "default";
      } else if (settingsKey === "PAYMENT_TERMS") {
        val = "CC ON FILE"; source = "default";
      } else if (settingsKey === "SEPARATE_BY_SIDEMARK") {
        val = "FALSE"; source = "default";
      }
    }

    var settingsRow = keyToRow[settingsKey];
    if (settingsRow) {
      var cell = settingsSh.getRange(settingsRow, 2);
      cell.clearDataValidations();
      cell.setValue(val);
      updated.push(settingsKey + " = " + val);
    } else {
      var newRow = settingsSh.getLastRow() + 1;
      settingsSh.getRange(newRow, 1).setValue(settingsKey);
      settingsSh.getRange(newRow, 2).setValue(val);
      keyToRow[settingsKey] = newRow;
      updated.push(settingsKey + " = " + val + " (added)");
    }
    Logger.log("[SYNC] " + settingsKey + " = " + val + " (" + source + ", col=" + colIdx + ")");
  }

  if (skipped.length) Logger.log("[SYNC] Skipped: " + skipped.join(", "));
  return { updated: updated, skipped: skipped };
}

/* ================================================================
   SYNC SETTINGS TO CLIENT  (menu action)
   ================================================================ */

/**
 * v1.4.2: Supports multi-row selection — syncs settings for all highlighted client rows.
 * Uses getActiveRangeList() for non-contiguous selections (Ctrl+click).
 */
function StrideSyncSettingsToClient() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var clientsSh = ss.getSheetByName(CB_SH.CLIENTS);
  if (!clientsSh) { ui.alert("Clients sheet not found."); return; }

  // Build header map
  var headerRow = clientsSh.getRange(CLIENTS_HEADER_ROW, 1, 1, clientsSh.getLastColumn()).getValues()[0];
  var hMap = {};
  for (var h = 0; h < headerRow.length; h++) {
    var key = String(headerRow[h]).trim().toUpperCase();
    if (key) hMap[key] = h;
  }

  var nameIdx = hMap[ONBOARD_COL.CLIENT_NAME.toUpperCase()];
  var ssIdIdx = hMap[ONBOARD_COL.CLIENT_SPREADSHEET_ID.toUpperCase()];
  if (nameIdx === undefined || ssIdIdx === undefined) {
    ui.alert("Required columns (Client Name, Client Spreadsheet ID) not found in headers.");
    return;
  }

  // Collect all selected rows using getActiveRangeList
  var rangeList = ss.getActiveRangeList();
  if (!rangeList) {
    ui.alert("Please select one or more client rows on the Clients tab.");
    return;
  }
  var ranges = rangeList.getRanges();
  var clientRows = [];
  var seenRows = {};
  for (var ri = 0; ri < ranges.length; ri++) {
    var startRow = ranges[ri].getRow();
    var numRows = ranges[ri].getNumRows();
    for (var si = startRow; si < startRow + numRows; si++) {
      if (si < CLIENTS_DATA_START_ROW || seenRows[si]) continue;
      seenRows[si] = true;
      var rowData = clientsSh.getRange(si, 1, 1, clientsSh.getLastColumn()).getValues()[0];
      var name = String(rowData[nameIdx] || "").trim();
      var id = String(rowData[ssIdIdx] || "").trim();
      if (name && id) clientRows.push({ row: si, name: name, id: id, data: rowData });
    }
  }

  if (!clientRows.length) {
    ui.alert("No valid client rows selected. Select rows with both a Client Name and Spreadsheet ID.");
    return;
  }

  var clientNames = clientRows.map(function(c) { return c.name; }).join(", ");
  var resp = ui.alert(
    "Sync Settings",
    "Push settings to " + clientRows.length + " client(s)?\n\n" + clientNames,
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  var cbSsId = ss.getId();
  var synced = [];
  var failed = [];
  var allDetails = [];

  for (var ci = 0; ci < clientRows.length; ci++) {
    var c = clientRows[ci];
    try {
      var folderIdx = hMap[ONBOARD_COL.CLIENT_FOLDER_ID.toUpperCase()];
      var invoiceIdx = hMap[ONBOARD_COL.INVOICE_FOLDER_ID.toUpperCase()];
      var photosIdx = hMap[ONBOARD_COL.PHOTOS_FOLDER_ID.toUpperCase()];
      var clientFolderId = (folderIdx !== undefined) ? String(c.data[folderIdx] || "").trim() : "";
      var invoiceFolderId = (invoiceIdx !== undefined) ? String(c.data[invoiceIdx] || "").trim() : "";
      var photosFolderId = (photosIdx !== undefined) ? String(c.data[photosIdx] || "").trim() : "";

      var result = writeSettingsToClientSheet_(c.id, c.name, c.data, hMap,
        clientFolderId, photosFolderId, invoiceFolderId, cbSsId);
      synced.push(c.name);
      if (result) {
        allDetails.push(c.name + ":");
        if (result.updated.length) allDetails.push("  Updated: " + result.updated.join(", "));
        if (result.skipped.length) allDetails.push("  Skipped: " + result.skipped.join(", "));
      }
    } catch (err) {
      failed.push(c.name + ": " + err.message);
      Logger.log("Sync settings error for " + c.name + ": " + err + "\n" + err.stack);
    }
  }

  var msg = "Sync complete.\n\n✅ Synced: " + synced.length;
  if (synced.length) msg += "\n" + synced.join(", ");
  if (failed.length) msg += "\n\n❌ Failed: " + failed.length + "\n" + failed.join("\n");
  if (allDetails.length) msg += "\n\n--- Details ---\n" + allDetails.join("\n");
  ui.alert(msg);
}

/* ================================================================
   UPDATED getActiveClients_  (replaces existing in Code.gs)
   ================================================================ */

function getActiveClients_v2_() {
  var ss = SpreadsheetApp.getActive();
  var clientsSh = ss.getSheetByName(CB_SH.CLIENTS);
  if (!clientsSh) return [];

  var lastRow = clientsSh.getLastRow();
  if (lastRow < CLIENTS_DATA_START_ROW) return [];

  var headerRow = clientsSh.getRange(CLIENTS_HEADER_ROW, 1, 1, clientsSh.getLastColumn()).getValues()[0];
  var cMap = {};
  for (var h = 0; h < headerRow.length; h++) {
    var key = String(headerRow[h]).trim().toUpperCase();
    if (key) cMap[key] = h;
  }

  var idxName   = cMap["CLIENT NAME"];
  var idxId     = cMap["CLIENT SPREADSHEET ID"];
  var idxActive = cMap["ACTIVE"];

  if (idxName === undefined || idxId === undefined) return [];

  var numDataRows = lastRow - CLIENTS_DATA_START_ROW + 1;
  if (numDataRows <= 0) return [];
  var dataRange = clientsSh.getRange(CLIENTS_DATA_START_ROW, 1, numDataRows, clientsSh.getLastColumn());
  var dataValues = dataRange.getValues();

  var out = [];
  for (var r = 0; r < dataValues.length; r++) {
    var name = String(dataValues[r][idxName] || "").trim();
    var id = String(dataValues[r][idxId] || "").trim();
    // BUG-004 FIX: use isTruthy_() instead of truthy_()
    var active = (idxActive === undefined) ? true : isTruthy_(dataValues[r][idxActive]);
    if (name && id && active) out.push({ name: name, id: id });
  }
  return out;
}

/* ================================================================
   ONE-TIME MIGRATION: Restructure Clients tab for v1.3.0
   ================================================================ */

/**
 * v1.4.0 Migration: Moves config rows 1-3 from Clients tab to Settings tab,
 * then deletes those rows so Clients has headers on row 1 and data on row 2+.
 */
function StrideMigrateClientsTab_v140() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getSheetByName(CB_SH.CLIENTS);
  if (!sh) { ui.alert("Clients sheet not found."); return; }

  // Check if row 1 col A is a config key (old layout) or a header (already migrated)
  var cellA1 = String(sh.getRange(1, 1).getValue() || "").trim();
  if (cellA1.toUpperCase() === "CLIENT NAME") {
    ui.alert("Clients tab already has headers on row 1 — no migration needed.");
    return;
  }

  var resp = ui.alert(
    "Migrate Clients Tab (v1.4.0)",
    "This will:\n" +
    "1. Move config values (Template ID, Parent Folder ID) to the Settings tab\n" +
    "2. Delete the old config rows 1-3 from Clients\n" +
    "3. Headers become row 1, data starts at row 2\n\nProceed?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  // Read existing config values from rows 1-3 before deleting
  var templateId = "";
  var parentFolderId = "";
  for (var r = 1; r <= 3; r++) {
    var label = String(sh.getRange(r, 1).getValue() || "").trim();
    var val = String(sh.getRange(r, 2).getValue() || "").trim();
    if (label === "Client Inventory Template ID" && val) templateId = val;
    if (label === "Client Parent Folder ID" && val) parentFolderId = val;
  }

  // Write config values to Settings tab
  var settingsSh = ss.getSheetByName(CB_SH.SETTINGS);
  if (!settingsSh) { ui.alert("Settings tab not found."); return; }

  var settingsData = settingsSh.getDataRange().getValues();
  var keyToRow = {};
  for (var i = 0; i < settingsData.length; i++) {
    var key = String(settingsData[i][0] || "").trim();
    if (key) keyToRow[key] = i + 1;
  }

  // Write or update CLIENT_INVENTORY_TEMPLATE_ID
  if (templateId) {
    if (keyToRow["CLIENT_INVENTORY_TEMPLATE_ID"]) {
      settingsSh.getRange(keyToRow["CLIENT_INVENTORY_TEMPLATE_ID"], 2).setValue(templateId);
    } else {
      var newRow = settingsSh.getLastRow() + 1;
      settingsSh.getRange(newRow, 1).setValue("CLIENT_INVENTORY_TEMPLATE_ID");
      settingsSh.getRange(newRow, 2).setValue(templateId);
      settingsSh.getRange(newRow, 3).setValue("Spreadsheet ID of the Client Inventory Template to copy for new clients.");
    }
  }

  // Write or update CLIENT_PARENT_FOLDER_ID
  if (parentFolderId) {
    if (keyToRow["CLIENT_PARENT_FOLDER_ID"]) {
      settingsSh.getRange(keyToRow["CLIENT_PARENT_FOLDER_ID"], 2).setValue(parentFolderId);
    } else {
      var newRow2 = settingsSh.getLastRow() + 1;
      settingsSh.getRange(newRow2, 1).setValue("CLIENT_PARENT_FOLDER_ID");
      settingsSh.getRange(newRow2, 2).setValue(parentFolderId);
      settingsSh.getRange(newRow2, 3).setValue("Google Drive folder where new client folders are created.");
    }
  }

  // Delete config rows 1-3 from Clients tab
  sh.deleteRows(1, 3);

  // Update frozen rows — freeze just header row 1
  sh.setFrozenRows(1);

  // Remove old config row protection if it exists
  var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var p = 0; p < protections.length; p++) {
    if (protections[p].getDescription() === "Clients config rows — do not edit manually") {
      protections[p].remove();
    }
  }

  ss.toast(
    "Config moved to Settings tab. Clients tab now starts with headers on row 1.",
    "Migration Complete (v1.4.0)", 8
  );
}


/* ================================================================
   IMPORT INVENTORY DURING ONBOARD
   Lightweight version of the import functions from inventory code.gs
   Runs in the CB script context, writes to the new client sheet.
   ================================================================ */

/** Column fuzzy matching config (mirrored from client script) */
var OB_IMPORT_COL_MAP_ = {
  "Item ID":          ["ID#", "ID", "ITEM ID", "ITEM #", "ITEM NUMBER"],
  "Qty":              ["QTY", "QUANTITY"],
  "Vendor":           ["VENDOR", "MFG", "MANUFACTURER", "BRAND"],
  "Description":      ["DESCRIPTION", "DESC", "ITEM DESCRIPTION", "ITEM NAME"],
  "Class":            ["STORAGE SIZE", "SIZE", "CU FT", "CUFT", "CUBIC", "CUBIC FEET", "CUBIC VOLUME", "VOLUME"],
  "Location":         ["LOCATION", "LOC", "WHSE LOCATION", "WAREHOUSE LOCATION"],
  "Room":             ["ROOM", "PROJECT"],
  "Item Notes":       ["ITEM NOTES", "ITEMS NOTES", "NOTES", "COMMENTS"],
  "Inspection Notes": ["INSPECTION NOTES", "INSP NOTES", "INSPECTION"],
  "Assembly Status":  ["ASSEMBLY STATUS", "ASSEMBLY", "ASSM", "ASSY STATUS"],
  "Receive Date":     ["DATE RECEIVED", "RECEIVED", "REC'D", "RECEIVE DATE", "RECV DATE"],
  "Release Date":     ["DATE RELEASED", "RELEASED", "RELEASE DATE"],
  "Photos":           ["PHOTO", "PHOTOS", "PHOTO LINK", "PHOTO URL", "PHOTOS URL"],
  "Sidemark":         ["SIDEMARK", "SIDE MARK", "CLIENT"]
};

var OB_TAB_ACTIVE_   = ["ACTIVE STOCK", "ACTIVE", "STOCK", "INVENTORY", "CURRENT INVENTORY", "IN STORAGE"];
var OB_TAB_RELEASED_ = ["RELEASED ITEMS", "RELEASED", "RELEASE", "RELEASED STOCK", "PAST INVENTORY", "DELIVERED"];
var OB_TAB_SKIP_     = ["FORM", "REQUEST", "MEASUREMENT", "TEMPLATE", "SETUP", "SETTINGS", "BILLING"];

/**
 * Import inventory from old spreadsheet URL into a newly created client sheet.
 * Called during onboarding — no UI dialogs, runs silently.
 */
function onboardImportInventory_(oldUrl, newSpreadsheetId) {
  var ssId = (String(oldUrl).match(/\/d\/([-\w]{25,})/) || [])[1];
  if (!ssId) throw new Error("Could not extract spreadsheet ID from Import Inventory URL.");

  var oldSS = SpreadsheetApp.openById(ssId);
  var newSS = SpreadsheetApp.openById(newSpreadsheetId);

  // Load class map
  var classMap = obLoadClassMap_(newSS);

  // Get new sheet tabs
  var invSh = newSS.getSheetByName("Inventory");
  if (!invSh) throw new Error("New client sheet missing Inventory tab.");
  var invMap = obGetHeaderMap_(invSh);

  var taskSh = newSS.getSheetByName("Tasks");
  var taskMap = taskSh ? obGetHeaderMap_(taskSh) : null;

  var shipSh = newSS.getSheetByName("Shipments");
  var shipMap = shipSh ? obGetHeaderMap_(shipSh) : null;

  // Build existing ID set for dedup
  var existingIds = {};

  // Placeholder shipment
  var now = new Date();
  var shipNo = "SHP-MIGRATED-" + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMddHHmmss");

  var totalImported = 0, totalSkipped = 0, totalTasks = 0;

  // Process old sheets
  var sheets = oldSS.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var nameUpper = sheets[i].getName().trim().toUpperCase();
    var shouldSkip = false;
    for (var sk = 0; sk < OB_TAB_SKIP_.length; sk++) {
      if (nameUpper.indexOf(OB_TAB_SKIP_[sk]) !== -1) { shouldSkip = true; break; }
    }
    if (nameUpper.match(/^SHEET\d*$/) || shouldSkip) continue;

    var isActive = false, isReleased = false;
    for (var a = 0; a < OB_TAB_ACTIVE_.length; a++) {
      if (nameUpper.indexOf(OB_TAB_ACTIVE_[a]) !== -1) { isActive = true; break; }
    }
    if (!isActive) {
      for (var r = 0; r < OB_TAB_RELEASED_.length; r++) {
        if (nameUpper.indexOf(OB_TAB_RELEASED_[r]) !== -1) { isReleased = true; break; }
      }
    }
    if (!isActive && !isReleased) continue;

    var result = obImportSheetRows_(sheets[i], invSh, invMap, classMap, existingIds, taskSh, taskMap, isReleased, shipNo);
    totalImported += result.imported;
    totalSkipped += result.skipped;
    totalTasks += result.tasks;
  }

  // Write placeholder shipment
  if (totalImported > 0 && shipSh && shipMap) {
    var shipRow = obBuildRow_(shipMap, {
      "Shipment #": shipNo,
      "Receive Date": now,
      "Item Count": totalImported,
      "Carrier": "Migration",
      "Shipment Notes": "Imported from old spreadsheet: " + oldSS.getName()
    });
    shipSh.getRange(shipSh.getLastRow() + 1, 1, 1, shipRow.length).setValues([shipRow]);
  }

  return { imported: totalImported, skipped: totalSkipped, tasks: totalTasks };
}

/**
 * Import rows from one old sheet tab. Mirrors importSheetRows_() from client script.
 */
function obImportSheetRows_(oldSheet, invSh, invMap, classMap, existingIds, taskSh, taskMap, isReleased, shipNo) {
  var data = oldSheet.getDataRange().getValues();
  if (data.length < 2) return { imported: 0, skipped: 0, tasks: 0 };

  var oldHeaders = data[0].map(function(h) { return String(h || "").trim(); });
  var oldHeadersUpper = oldHeaders.map(function(h) { return h.toUpperCase(); });

  // Build column index map
  var oldColIdx = {};
  for (var newCol in OB_IMPORT_COL_MAP_) {
    var candidates = OB_IMPORT_COL_MAP_[newCol];
    for (var c = 0; c < candidates.length; c++) {
      var idx = oldHeadersUpper.indexOf(candidates[c]);
      if (idx !== -1) { oldColIdx[newCol] = idx; break; }
    }
  }

  // Hard stop: released tab without release date column
  if (isReleased && oldColIdx["Release Date"] === undefined) {
    throw new Error("Released tab '" + oldSheet.getName() + "' is missing a Release Date column. Cannot safely filter to 2026+.");
  }

  var imported = 0, skipped = 0, tasks = 0;
  var invRows = [], taskRows = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var itemId = oldColIdx["Item ID"] !== undefined ? String(row[oldColIdx["Item ID"]] || "").trim() : "";
    if (!itemId) continue;

    // Released year filter FIRST — skip blank/invalid dates too
    if (isReleased && oldColIdx["Release Date"] !== undefined) {
      var relDate = row[oldColIdx["Release Date"]];
      var relYear = null;
      if (relDate instanceof Date && !isNaN(relDate.getTime())) relYear = relDate.getFullYear();
      else if (typeof relDate === "string") {
        var yrMatch = relDate.match(/\b(20\d{2})\b/);
        if (yrMatch) relYear = parseInt(yrMatch[1], 10);
      }
      if (relYear === null || relYear < 2026) continue;
    }

    // Dedup AFTER filter
    if (existingIds[itemId]) { skipped++; continue; }

    // Map fields
    var qty = oldColIdx["Qty"] !== undefined ? row[oldColIdx["Qty"]] : 1;
    var vendor = oldColIdx["Vendor"] !== undefined ? String(row[oldColIdx["Vendor"]] || "") : "";
    var desc = oldColIdx["Description"] !== undefined ? String(row[oldColIdx["Description"]] || "") : "";
    var location = oldColIdx["Location"] !== undefined ? String(row[oldColIdx["Location"]] || "") : "";
    var room = oldColIdx["Room"] !== undefined ? String(row[oldColIdx["Room"]] || "") : "";
    var sidemark = oldColIdx["Sidemark"] !== undefined ? String(row[oldColIdx["Sidemark"]] || "") : "";
    var itemNotes = oldColIdx["Item Notes"] !== undefined ? String(row[oldColIdx["Item Notes"]] || "") : "";
    var recvDate = oldColIdx["Receive Date"] !== undefined ? row[oldColIdx["Receive Date"]] : "";
    var relDate2 = oldColIdx["Release Date"] !== undefined ? row[oldColIdx["Release Date"]] : "";
    var inspNotes = oldColIdx["Inspection Notes"] !== undefined ? String(row[oldColIdx["Inspection Notes"]] || "").trim() : "";
    var photoUrl = oldColIdx["Photos"] !== undefined ? String(row[oldColIdx["Photos"]] || "").trim() : "";

    // Append inspection notes to item notes
    if (inspNotes) {
      itemNotes = itemNotes ? itemNotes + " | Insp: " + inspNotes : "Insp: " + inspNotes;
    }

    // Class conversion — supports numeric size OR direct class letters
    var itemClass = "";
    if (oldColIdx["Class"] !== undefined) {
      var rawClass = row[oldColIdx["Class"]];
      var rawClassStr = String(rawClass || "").trim().toUpperCase();
      var sizeVal = Number(rawClass);
      if (isFinite(sizeVal) && sizeVal > 0) {
        itemClass = obSizeToClass_(sizeVal, classMap);
      } else if (classMap[rawClassStr] !== undefined || ["XS","S","M","L","XL","XXL"].indexOf(rawClassStr) !== -1) {
        itemClass = rawClassStr;
      }
    }

    // Assembly status fuzzy match
    var needsAssembly = false;
    var asmRawVal = "";
    if (oldColIdx["Assembly Status"] !== undefined) {
      asmRawVal = String(row[oldColIdx["Assembly Status"]] || "").trim();
      var asmVal = asmRawVal.toUpperCase();
      if (asmVal.indexOf("NEED") !== -1 || asmVal.indexOf("ASSM") !== -1 || asmVal.indexOf("ASSY") !== -1 || asmVal.indexOf("REQUIRED") !== -1) {
        needsAssembly = true;
      }
    }

    // Photo URL to notes
    if (photoUrl && photoUrl.indexOf("http") === 0) {
      itemNotes = itemNotes ? itemNotes + " | Old photos: " + photoUrl : "Old photos: " + photoUrl;
    }

    var status = isReleased ? "Released" : "Active";

    // Mark dedup
    existingIds[itemId] = true;

    // Build inventory row
    var invRow = obBuildRow_(invMap, {
      "Item ID": itemId, "Qty": qty || 1, "Vendor": vendor, "Description": desc,
      "Class": itemClass, "Location": location, "Sidemark": sidemark, "Room": room,
      "Item Notes": itemNotes, "Needs Inspection": false, "Needs Assembly": needsAssembly,
      "Shipment #": shipNo, "Receive Date": recvDate, "Release Date": isReleased ? relDate2 : "",
      "Status": status
    });
    invRows.push(invRow);
    imported++;

    // Assembly task
    if (needsAssembly && taskSh && taskMap) {
      var taskId = "ASM-" + itemId + "-MIGRATED";
      var taskRow = obBuildRow_(taskMap, {
        "Task ID": taskId, "Item ID": itemId, "Type": "Assembly",
        "Shipment #": shipNo, "Vendor": vendor, "Description": desc,
        "Location": location, "Item Notes": itemNotes,
        "Task Notes": asmRawVal || "Needs assembly",
        "Status": "Open", "Created": new Date(), "Svc Code": "ASM", "Billed": false
      });
      taskRows.push(taskRow);
      tasks++;
    }
  }

  // Batch write
  if (invRows.length > 0) {
    invSh.getRange(invSh.getLastRow() + 1, 1, invRows.length, invRows[0].length).setValues(invRows);
  }
  if (taskRows.length > 0 && taskSh) {
    taskSh.getRange(taskSh.getLastRow() + 1, 1, taskRows.length, taskRows[0].length).setValues(taskRows);
  }

  return { imported: imported, skipped: skipped, tasks: tasks };
}

/** Get header map from a sheet: { "Header Name": 1-based column index } */
function obGetHeaderMap_(sh) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").trim();
    if (h) map[h] = i + 1;
  }
  return map;
}

/** Build a row array matching a header map by column name */
function obBuildRow_(headerMap, values) {
  var maxCol = 0;
  for (var key in headerMap) { if (headerMap[key] > maxCol) maxCol = headerMap[key]; }
  var row = new Array(maxCol).fill("");
  for (var field in values) {
    if (headerMap[field]) row[headerMap[field] - 1] = values[field];
  }
  return row;
}

/** Convert cubic feet to nearest class letter */
function obSizeToClass_(cuFt, classMap) {
  var bestClass = "", bestDiff = Infinity;
  for (var cls in classMap) {
    var diff = Math.abs(classMap[cls] - cuFt);
    if (diff < bestDiff) { bestDiff = diff; bestClass = cls; }
  }
  return bestClass;
}

/** Load class map from client sheet or master */
function obLoadClassMap_(ss) {
  var classMap = {};
  var cacheSh = ss.getSheetByName("Class_Cache");
  if (!cacheSh) {
    // Try master via client Settings
    var settingsSh = ss.getSheetByName("Settings");
    if (settingsSh) {
      var sData = settingsSh.getDataRange().getValues();
      for (var i = 0; i < sData.length; i++) {
        if (String(sData[i][0] || "").trim() === "MASTER_SPREADSHEET_ID") {
          var masterId = String(sData[i][1] || "").trim();
          if (masterId) {
            try { cacheSh = SpreadsheetApp.openById(masterId).getSheetByName("Class_Map"); } catch (_) {}
          }
          break;
        }
      }
    }
  }
  if (!cacheSh || cacheSh.getLastRow() < 2) {
    return { "XS": 10, "S": 25, "M": 50, "L": 75, "XL": 110 };
  }
  var data = cacheSh.getDataRange().getValues();
  var map = {};
  for (var j = 0; j < data[0].length; j++) map[String(data[0][j]).trim().toUpperCase()] = j;
  var classCol = map["CLASS"], volCol = map["CUBIC VOLUME"] !== undefined ? map["CUBIC VOLUME"] : map["STORAGE SIZE"];
  if (classCol === undefined || volCol === undefined) return { "XS": 10, "S": 25, "M": 50, "L": 75, "XL": 110 };
  for (var k = 1; k < data.length; k++) {
    var cls = String(data[k][classCol] || "").trim();
    var vol = Number(data[k][volCol]) || 0;
    if (cls) classMap[cls] = vol;
  }
  return classMap;
}

/* ================================================================
   ONBOARD NOTIFICATION EMAIL (v1.5.0)
   ================================================================ */

/**
 * Sends a branded HTML email with rollout instructions after onboarding.
 * Sent from whse@stridenw.com to email@stridenw.com.
 */
function sendOnboardNotificationEmail_(clientName, spreadsheetId) {
  var sheetUrl = spreadsheetId
    ? "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit"
    : "(spreadsheet ID not available)";

  var subject = "New Client Onboarded: \"" + clientName + "\" — authorize the spreadsheet";

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;">'
    + '<div style="max-width:640px;margin:0 auto;padding:24px;">'

    // --- HEADER ---
    + '<div style="background:#000000;border-radius:12px 12px 0 0;padding:16px 22px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td style="vertical-align:middle;">'
    + '<img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" '
    + 'width="34" height="34" style="vertical-align:middle;margin-right:10px;" />'
    + '<span style="color:#ffffff;font-size:16px;font-weight:700;vertical-align:middle;">Stride Logistics </span>'
    + '<span style="color:#E85D2D;font-size:16px;font-weight:700;vertical-align:middle;">WMS</span>'
    + '</td>'
    + '<td style="text-align:right;vertical-align:middle;">'
    + '<span style="color:#ffffff;font-size:14px;font-weight:700;">New Client Onboarded</span>'
    + '</td>'
    + '</tr></table>'
    + '</div>'

    // --- MAIN CARD ---
    + '<div style="background:#ffffff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;padding:22px;">'

    // --- HEADLINE ---
    + '<h1 style="font-size:20px;font-weight:900;color:#1E293B;margin:0 0 6px 0;">Client Onboarded: ' + escHtml_(clientName) + '</h1>'
    + '<p style="font-size:14px;color:#64748B;margin:0 0 20px 0;">The spreadsheet, Drive folders, Web App, and triggers have been set up automatically. Just one step left.</p>'

    // --- CLIENT INFO BOX ---
    + '<div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:20px;">'
    + '<table cellpadding="0" cellspacing="0" border="0" width="100%">'
    + '<tr><td style="padding:4px 0;"><span style="font-size:11px;text-transform:uppercase;font-weight:800;color:#64748B;">Client Name</span><br/>'
    + '<span style="font-size:14px;font-weight:800;color:#1E293B;">' + escHtml_(clientName) + '</span></td></tr>'
    + '<tr><td style="padding:4px 0;"><span style="font-size:11px;text-transform:uppercase;font-weight:800;color:#64748B;">Spreadsheet</span><br/>'
    + '<a href="' + sheetUrl + '" style="font-size:14px;font-weight:700;color:#E85D2D;text-decoration:none;">Open Client Sheet</a></td></tr>'
    + '</table></div>'

    // --- SINGLE STEP ---
    + '<div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:14px;">'
    + '<h2 style="font-size:16px;font-weight:800;color:#E85D2D;margin:0 0 8px 0;">Authorize the Spreadsheet</h2>'
    + '<ol style="font-size:14px;color:#1E293B;margin:0;padding-left:20px;line-height:1.8;">'
    + '<li>Click the <b>Open Client Sheet</b> link above</li>'
    + '<li>Wait for the spreadsheet to load (the custom menus will appear after a few seconds)</li>'
    + '<li>Click <b>Stride Admin</b> in the menu bar</li>'
    + '<li>Click any menu item (e.g. <b>Verify Triggers</b>)</li>'
    + '<li>Google will show an <b>Authorization Required</b> dialog &mdash; click <b>Continue</b></li>'
    + '<li>Choose your Google account and click <b>Allow</b></li>'
    + '</ol>'
    + '<p style="font-size:13px;color:#64748B;margin:12px 0 0 0;">That\'s it! The client sheet is now fully operational. The user account has been created and set to active &mdash; the client can log in to <a href="https://www.mystridehub.com" style="color:#E85D2D;font-weight:600;">mystridehub.com</a> immediately.</p>'
    + '</div>'

    // --- WHAT WAS AUTO-CONFIGURED ---
    + '<div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:14px;">'
    + '<h2 style="font-size:14px;font-weight:800;color:#E85D2D;margin:0 0 10px 0;text-transform:uppercase;letter-spacing:1px;">Auto-Configured by Onboarding</h2>'
    + '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;color:#1E293B;line-height:1.7;">'
    + '<tr><td style="padding:4px 0;color:#16A34A;font-weight:700;width:24px;">&#10003;</td><td style="padding:4px 0;">Client spreadsheet created from template</td></tr>'
    + '<tr><td style="padding:4px 0;color:#16A34A;font-weight:700;">&#10003;</td><td style="padding:4px 0;">Drive folders created (Photos, Invoices)</td></tr>'
    + '<tr><td style="padding:4px 0;color:#16A34A;font-weight:700;">&#10003;</td><td style="padding:4px 0;">All settings written to client sheet</td></tr>'
    + '<tr><td style="padding:4px 0;color:#16A34A;font-weight:700;">&#10003;</td><td style="padding:4px 0;">Client row added to Consolidated Billing</td></tr>'
    + '<tr><td style="padding:4px 0;color:#16A34A;font-weight:700;">&#10003;</td><td style="padding:4px 0;">User account created (Active)</td></tr>'
    + '<tr><td style="padding:4px 0;color:#16A34A;font-weight:700;">&#10003;</td><td style="padding:4px 0;">Web App deployed &amp; triggers installed</td></tr>'
    + '</table></div>'

    // --- FOOTER ---
    + '<div style="border-top:1px solid #E2E8F0;padding-top:14px;margin-top:10px;font-size:12px;color:#64748B;text-align:center;">'
    + 'Stride Logistics &middot; Kent, WA &middot; whse@stridenw.com'
    + '</div>'

    + '</div></div></body></html>';

  GmailApp.sendEmail(
    "email@stridenw.com",
    subject,
    "New client \"" + clientName + "\" has been onboarded. Open the spreadsheet and authorize to complete setup.",
    {
      htmlBody: html,
      from: "whse@stridenw.com",
      name: "Stride Logistics WMS"
    }
  );

  Logger.log("Onboard notification email sent for: " + clientName);
}

/* ================================================================
   WELCOME EMAIL TO CLIENT (v3.0.1)
   Sends branded welcome email to the client after onboarding.
   Reads WELCOME_EMAIL template from master Email_Templates,
   falls back to a simple default if not found.
   ================================================================ */

function sendWelcomeEmailFromCB_(clientSs, clientName) {
  // Read client email from Settings tab
  var settingsSh = clientSs.getSheetByName("Settings");
  if (!settingsSh) {
    Logger.log("[WELCOME_EMAIL] No Settings tab found — skipping.");
    return;
  }
  var settingsData = settingsSh.getDataRange().getValues();
  var clientEmail = "";
  var masterId = "";
  for (var i = 0; i < settingsData.length; i++) {
    var key = String(settingsData[i][0] || "").trim();
    if (key === "CLIENT_EMAIL") clientEmail = String(settingsData[i][1] || "").trim();
    if (key === "MASTER_SPREADSHEET_ID") masterId = String(settingsData[i][1] || "").trim();
  }
  if (!clientEmail) {
    Logger.log("[WELCOME_EMAIL] No CLIENT_EMAIL in Settings — skipping.");
    return;
  }

  var subject = "Welcome to Stride Warehouse Management — " + clientName;
  var htmlBody = "";

  // Read NOTIFICATION_EMAILS from Settings for {{STAFF_EMAILS}} token
  var staffEmails = "";
  for (var s = 0; s < settingsData.length; s++) {
    if (String(settingsData[s][0] || "").trim() === "NOTIFICATION_EMAILS") {
      staffEmails = String(settingsData[s][1] || "").trim();
      break;
    }
  }

  // Try to load WELCOME_EMAIL template from master Email_Templates
  var templateRecipients = "";
  try {
    if (masterId) {
      var master = SpreadsheetApp.openById(masterId);
      var tmplSh = master.getSheetByName("Email_Templates");
      if (tmplSh && tmplSh.getLastRow() >= 2) {
        var lastCol = Math.max(tmplSh.getLastColumn(), 6);
        var data = tmplSh.getRange(2, 1, tmplSh.getLastRow() - 1, lastCol).getValues();
        for (var j = 0; j < data.length; j++) {
          if (String(data[j][0] || "").trim() === "WELCOME_EMAIL") {
            var tmplSubject = String(data[j][1] || "").trim();
            var tmplHtml = String(data[j][2] || "").trim();
            var tmplRecipients = String(data[j][4] || "").trim(); // Column E = Recipients
            if (tmplSubject) subject = tmplSubject;
            if (tmplHtml) htmlBody = tmplHtml;
            if (tmplRecipients) templateRecipients = tmplRecipients;
            break;
          }
        }
      }
    }
  } catch (err) {
    Logger.log("[WELCOME_EMAIL] Template lookup failed: " + err);
  }

  // Fallback if no template found
  if (!htmlBody) {
    htmlBody = '<html><body style="font-family:Arial,sans-serif;padding:20px;">'
      + '<h2>Welcome to Stride Warehouse Management</h2>'
      + '<p>Hi ' + escHtml_(clientName) + ',</p>'
      + '<p>Your inventory management system is set up and ready to use.</p>'
      + '<p><a href="' + clientSs.getUrl() + '">Open My Inventory</a></p>'
      + '<p>Look for the <b>Stride Client</b> menu at the top of your spreadsheet.</p>'
      + '<p>Questions? Contact us at whse@stridenw.com or (206) 550-1848.</p>'
      + '</body></html>';
  }

  // Resolve recipients from Column E (same logic as sendTemplateEmail_)
  var resolvedEmails = "";
  if (templateRecipients) {
    resolvedEmails = templateRecipients
      .replace(/\{\{STAFF_EMAILS\}\}/gi, staffEmails)
      .replace(/\{\{CLIENT_EMAIL\}\}/gi, clientEmail);
  } else {
    resolvedEmails = clientEmail;
  }
  var emails = resolvedEmails.split(",").map(function(e) { return e.trim(); }).filter(Boolean);
  emails = emails.filter(function(item, pos) { return item && emails.indexOf(item) === pos; });
  if (!emails.length) {
    Logger.log("[WELCOME_EMAIL] No recipients resolved — skipping.");
    return;
  }

  // Resolve tokens
  var tokens = {
    "{{CLIENT_NAME}}": clientName,
    "{{SPREADSHEET_URL}}": clientSs.getUrl() || "#",
    "{{CLIENT_EMAIL}}": clientEmail
  };
  var entries = Object.entries(tokens);
  for (var k = 0; k < entries.length; k++) {
    subject = subject.split(entries[k][0]).join(String(entries[k][1] || ""));
    htmlBody = htmlBody.split(entries[k][0]).join(String(entries[k][1] || ""));
  }

  GmailApp.sendEmail(emails.join(","), subject, "", {
    htmlBody: htmlBody,
    from: "whse@stridenw.com",
    name: "Stride Logistics"
  });

  Logger.log("[WELCOME_EMAIL] Sent to " + emails.join(",") + " for " + clientName);
}

/* ================================================================
   AUTO-CREATE USER ON ONBOARD (v1.6.0)
   Creates a user record in the CB Users tab when a client is onboarded.
   Active defaults to FALSE — manual activation required before login.
   Sends internal admin notification so staff knows to activate.
   ================================================================ */

/**
 * Auto-create a user row in the Users tab during onboarding.
 * @param {string} clientEmail — email from the Clients tab
 * @param {string} clientName — client name
 * @param {string} clientSheetId — the new client spreadsheet ID
 */
function autoCreateUserOnOnboard_(clientEmail, clientName, clientSheetId) {
  if (!clientEmail) return;

  var ss = SpreadsheetApp.getActive();
  var usersSh = ss.getSheetByName(CB_SH.USERS);
  if (!usersSh) {
    Logger.log("[AUTO_USER] Users tab not found — skipping user creation for " + clientEmail);
    return;
  }

  // Check if user already exists (case-insensitive)
  var data = usersSh.getDataRange().getValues();
  var headers = data.length > 0 ? data[0].map(function(h) { return String(h).trim(); }) : [];
  var emailIdx = headers.indexOf("Email");
  if (emailIdx < 0) {
    Logger.log("[AUTO_USER] Email column not found in Users tab");
    return;
  }

  var lowerEmail = clientEmail.toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx] || "").trim().toLowerCase() === lowerEmail) {
      Logger.log("[AUTO_USER] User already exists: " + clientEmail + " — skipping");
      return;
    }
  }

  // Append new user row — Active = TRUE (ready to log in immediately)
  var now = new Date();
  var newRow = [
    clientEmail,    // Email
    "client",       // Role
    clientName,     // Client Name
    clientSheetId,  // Client Spreadsheet ID
    true,           // Active (TRUE — can log in immediately)
    now,            // Created
    "",             // Last Login
    "",             // Last Login Source
    "system",       // Updated By
    now             // Updated At
  ];
  usersSh.appendRow(newRow);
  Logger.log("[AUTO_USER] Created user: " + clientEmail + " (role=client, active=TRUE)");

  // Send internal admin notification
  try {
    sendUserActivationNotification_(clientEmail, clientName, clientSheetId, now);
  } catch (notifErr) {
    Logger.log("[AUTO_USER] Activation notification failed (non-blocking): " + notifErr);
  }
}

/**
 * Send internal admin notification that a new user was auto-created during onboarding.
 * User is set to Active automatically — this is an FYI notification only.
 * Sent to OWNER_EMAIL (from CB Settings) and whse@stridenw.com.
 */
function sendUserActivationNotification_(email, clientName, clientSheetId, createdAt) {
  // Read OWNER_EMAIL from Settings
  var ownerEmail = "";
  try {
    var ss = SpreadsheetApp.getActive();
    var settingsSh = ss.getSheetByName(CB_SH.SETTINGS);
    if (settingsSh) {
      var sData = settingsSh.getDataRange().getValues();
      for (var i = 0; i < sData.length; i++) {
        if (String(sData[i][0] || "").trim() === "OWNER_EMAIL") {
          ownerEmail = String(sData[i][1] || "").trim();
          break;
        }
      }
    }
  } catch (e) { /* ignore */ }

  var recipients = "whse@stridenw.com";
  if (ownerEmail && ownerEmail !== "whse@stridenw.com") {
    recipients += "," + ownerEmail;
  }

  var subject = "New User Created — " + clientName;
  var timestamp = createdAt instanceof Date
    ? Utilities.formatDate(createdAt, Session.getScriptTimeZone(), "MM/dd/yyyy hh:mm a")
    : String(createdAt);

  var sheetUrl = clientSheetId
    ? "https://docs.google.com/spreadsheets/d/" + clientSheetId + "/edit"
    : "(not available)";

  var html = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;">'
    + '<div style="max-width:600px;margin:0 auto;padding:20px;">'
    + '<div style="background:#16A34A;padding:16px 24px;border-radius:8px 8px 0 0;">'
    + '<h2 style="color:#fff;margin:0;">New User Created</h2></div>'
    + '<div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0;border-radius:0 0 8px 8px;">'
    + '<p>A new user account was auto-created during client onboarding. The account is <b>active</b> and ready to log in.</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
    + '<tr><td style="padding:8px 12px;font-weight:bold;background:#f0f0f0;width:180px;">Email</td>'
    + '<td style="padding:8px 12px;">' + email + '</td></tr>'
    + '<tr><td style="padding:8px 12px;font-weight:bold;background:#f0f0f0;">Role</td>'
    + '<td style="padding:8px 12px;">client</td></tr>'
    + '<tr><td style="padding:8px 12px;font-weight:bold;background:#f0f0f0;">Client Name</td>'
    + '<td style="padding:8px 12px;">' + clientName + '</td></tr>'
    + '<tr><td style="padding:8px 12px;font-weight:bold;background:#f0f0f0;">Client Sheet</td>'
    + '<td style="padding:8px 12px;"><a href="' + sheetUrl + '" style="color:#E85D2D;">' + clientName + '</a></td></tr>'
    + '<tr><td style="padding:8px 12px;font-weight:bold;background:#f0f0f0;">Created</td>'
    + '<td style="padding:8px 12px;">' + timestamp + '</td></tr>'
    + '<tr><td style="padding:8px 12px;font-weight:bold;background:#f0f0f0;">Status</td>'
    + '<td style="padding:8px 12px;color:#16A34A;font-weight:bold;">ACTIVE</td></tr>'
    + '</table>'
    + '<p>The client can log in at <a href="https://www.mystridehub.com" style="color:#E85D2D;font-weight:600;">mystridehub.com</a> and use Forgot Password to set up their credentials.</p>'
    + '<hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0;">'
    + '<p style="font-size:12px;color:#999;">Stride Logistics &middot; Kent, WA &middot; whse@stridenw.com</p>'
    + '</div></div></body></html>';

  GmailApp.sendEmail(recipients, subject, "New user " + email + " created for " + clientName + " (active, ready to log in).", {
    htmlBody: html,
    from: "whse@stridenw.com",
    name: "Stride Logistics WMS"
  });

  Logger.log("[AUTO_USER] User creation notification sent for: " + email + " (" + clientName + ")");
}

/* escHtml_() is defined in Code.gs.js */