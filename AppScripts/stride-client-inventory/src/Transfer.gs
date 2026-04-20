/* ===================================================
   Transfer.gs — v3.1.0 — 2026-04-04 11:20 AM PST
   v3.1.0: Discount range widened from ±10 to ±100 in billing re-apply
           logic so premium clients (e.g. +50% surcharge) transfer correctly.
   =================================================== */

/***************************************************************
[ADD-ON] STRIDE TRANSFER ITEMS — v1.1.2 (CLIENT SHEET ADD-ON)

PURPOSE
- Adds a workflow to transfer selected Inventory items to another client spreadsheet
  (destination chosen from Consolidated Billing -> Clients tab).
- Transfers ONLY "Unbilled" Billing_Ledger rows.
- Transfers ONLY active Tasks (Status != Completed/Cancelled).
- Transfers ONLY active Repairs (Status != Complete).
- Safely voids all source rows to preserve historical audit trails.

DESIGN RULES
- Additive-only: does NOT modify Script 2 base logic.
- No global collisions: all internal symbols are prefixed with TR_.
- Menu item should live in the EXISTING "Stride Admin" menu (base script).
  Base script should call StrideAdminTransferItems().

SETUP
1) Put this file in the same Apps Script project as Script 2 v2.4.4+
2) In Settings sheet add:
   CONSOLIDATED_BILLING_SPREADSHEET_ID = 16Yqap3i-nuBWTL9yQGjpuDNEybKCaE8IlM2mb9VJTq8
3) Reload sheet. Use: Stride Admin -> Transfer Items...
***************************************************************/

var TR_V = "v1.3.0";

/**
 * Hook called from Script 2 base onOpen() to add this option into the existing
 * "Stride Admin" menu without creating a second menu.
 * @param {GoogleAppsScript.Base.Menu} adminMenu
 */
function TR_addTransferMenuItem_(adminMenu) {
  if (!adminMenu) return;
  adminMenu.addItem("Transfer Items…", "StrideAdminTransferItems");
}

var TR_FALLBACK_CONSOLIDATED_ID = "16Yqap3i-nuBWTL9yQGjpuDNEybKCaE8IlM2mb9VJTq8";

// === Settings Keys ===
var TR_SETTINGS_KEYS = {
  CLIENT_NAME: "CLIENT_NAME",
  CONSOLIDATED_BILLING_SPREADSHEET_ID: "CONSOLIDATED_BILLING_SPREADSHEET_ID"
};

// === Sheet name fallbacks (will use CI_SH.* if present) ===
function TR_sheetName_(key, fallback) {
  try {
    if (typeof CI_SH !== "undefined" && CI_SH && CI_SH[key]) return CI_SH[key];
  } catch (e) {}
  return fallback;
}

/**
 * Entry point wired from the EXISTING Stride Admin menu in Script 2.
 * Keeps this add-on additive without creating/overwriting menus.
 */
function StrideAdminTransferItems() {
  TR_openTransferDialog();
}

/**
 * Opens the HTML modal to drive transfer flow.
 */
function TR_openTransferDialog() {
  var ss = SpreadsheetApp.getActive();
  var invName = TR_sheetName_("INVENTORY", "Inventory");
  var inv = ss.getSheetByName(invName);
  if (!inv) throw new Error("Inventory sheet not found: " + invName);

  // Require selection is on Inventory sheet to avoid transferring wrong rows.
  var activeSheet = ss.getActiveSheet();
  if (!activeSheet || activeSheet.getName() !== invName) {
    throw new Error("Please click into the Inventory sheet and select the rows to transfer.");
  }

  var rangeList = ss.getActiveRangeList();
  if (!rangeList) throw new Error("Select one or more Inventory rows first.");
  var ranges = rangeList.getRanges();
  if (!ranges || !ranges.length || ranges[0].getRow() < 2) throw new Error("Selection must start on row 2+ (below headers).");

  var ctx = TR_getTransferContext_();

  // Build pure HTML string (no scriptlets) to avoid escaping issues
  var out = HtmlService.createHtmlOutput(TR_buildTransferHtml_(ctx))
    .setWidth(980)
    .setHeight(620)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);

  SpreadsheetApp.getUi().showModalDialog(out, "Transfer Items");
}

/**
 * Server call: returns context for UI: selected items preview + clients list.
 */
function TR_getTransferContext_() {
  var ss = SpreadsheetApp.getActive();
  var invName = TR_sheetName_("INVENTORY", "Inventory");
  var inv = ss.getSheetByName(invName);
  if (!inv) throw new Error("Inventory sheet not found: " + invName);

  // v2.7.1: Use getActiveRangeList() to support non-contiguous selections (Ctrl+click)
  var rangeList = ss.getActiveRangeList();
  if (!rangeList) throw new Error("Select one or more Inventory rows first.");
  var ranges = rangeList.getRanges();
  if (!ranges || !ranges.length || ranges[0].getRow() < 2) throw new Error("Selection must start on row 2+ (below headers).");

  var invHeaders = TR_getHeaders_(inv);
  var invMap = TR_headerMap_(invHeaders);

  var colItemId = invMap["ITEM ID"];
  if (!colItemId) throw new Error("Inventory is missing required header: Item ID");

  // Preview columns order: (item id, qty, vendor, description, sidemark)
  var colQty = invMap["QTY"];
  var colVendor = invMap["VENDOR"];
  var colDesc = invMap["DESCRIPTION"];
  var colSidemark = invMap["SIDEMARK"];
  var colStatus = invMap["STATUS"];

  var preview = [];
  var seenIds = {};
  for (var ri = 0; ri < ranges.length; ri++) {
    var rng = ranges[ri];
    if (rng.getRow() < 2) continue;
    var values = inv.getRange(rng.getRow(), 1, rng.getNumRows(), inv.getLastColumn()).getValues();
    for (var vi = 0; vi < values.length; vi++) {
      var row = values[vi];
      var id = String(TR_cell_(row, colItemId) || "").trim();
      if (!id || seenIds[id]) continue;
      seenIds[id] = true;
      preview.push({
        itemId: id,
        qty: colQty ? TR_cell_(row, colQty) : "",
        vendor: colVendor ? TR_cell_(row, colVendor) : "",
        description: colDesc ? TR_cell_(row, colDesc) : "",
        sidemark: colSidemark ? TR_cell_(row, colSidemark) : "",
        status: colStatus ? TR_cell_(row, colStatus) : ""
      });
    }
  }

  if (!preview.length) throw new Error("No Item IDs found in selected rows.");

  // Filter out rows that are already transferred to reduce duplicates.
  preview = preview.filter(function(r) {
    return String(r.status || "").trim() !== "Transferred";
  });
  if (!preview.length) throw new Error("All selected items already have Status = Transferred.");

  var consolidatedId =
    String(TR_getSettingValue_(ss, TR_SETTINGS_KEYS.CONSOLIDATED_BILLING_SPREADSHEET_ID) || "").trim()
    || TR_FALLBACK_CONSOLIDATED_ID;

  if (!consolidatedId) {
    throw new Error("Missing Settings value: " + TR_SETTINGS_KEYS.CONSOLIDATED_BILLING_SPREADSHEET_ID + ". Please add this key to the Settings tab.");
  }

  var clients = TR_listClientsFromConsolidated_(consolidatedId);
  var sourceClientName = TR_getSettingValue_(ss, TR_SETTINGS_KEYS.CLIENT_NAME) || "";

  return {
    version: TR_V,
    sourceSpreadsheetId: ss.getId(),
    sourceClientName: sourceClientName,
    invSheetName: invName,
    selectionA1: ranges[0].getA1Notation(),
    selectionRow: ranges[0].getRow(),
    selectionNumRows: ranges[0].getNumRows(),
    preview: preview.map(function(p) {
      return { itemId: p.itemId, qty: p.qty, vendor: p.vendor, description: p.description, sidemark: p.sidemark };
    }),
    clients: clients
  };
}

/**
 * Server call (from UI): executes transfer.
 * @param { destinationSpreadsheetId: string, itemIds: string[] } payload
 */
function TR_executeTransfer(payload) {
  if (!payload || !payload.destinationSpreadsheetId) throw new Error("Missing destinationSpreadsheetId.");
  if (!payload.itemIds || !payload.itemIds.length) throw new Error("No items selected.");

  var ss = SpreadsheetApp.getActive();
  var sourceId = ss.getId();
  var destId = String(payload.destinationSpreadsheetId).trim();
  if (destId === sourceId) throw new Error("Destination cannot be the same spreadsheet.");

  var itemIds = payload.itemIds.map(function (x) { return String(x || "").trim(); }).filter(Boolean);
  if (!itemIds.length) throw new Error("No valid Item IDs.");

  // Sheet References
  var invName = TR_sheetName_("INVENTORY", "Inventory");
  var billingName = TR_sheetName_("BILLING_LEDGER", "Billing_Ledger");
  var tasksName = TR_sheetName_("TASKS", "Tasks");
  var repairsName = TR_sheetName_("REPAIRS", "Repairs");

  var inv = ss.getSheetByName(invName);
  var billing = ss.getSheetByName(billingName);
  var tasks = ss.getSheetByName(tasksName);
  var repairs = ss.getSheetByName(repairsName);

  if (!inv) throw new Error("Inventory sheet not found: " + invName);
  if (!billing) throw new Error("Billing_Ledger sheet not found: " + billingName);

  // Destination spreadsheet
  var destSS = SpreadsheetApp.openById(destId);
  var destInv = destSS.getSheetByName(invName);
  var destBilling = destSS.getSheetByName(billingName);
  var destTasks = destSS.getSheetByName(tasksName);
  var destRepairs = destSS.getSheetByName(repairsName);

  if (!destInv) throw new Error("Destination Inventory sheet not found.");
  if (!destBilling) throw new Error("Destination Billing_Ledger sheet not found.");

  var sourceClientName = TR_getSettingValue_(ss, TR_SETTINGS_KEYS.CLIENT_NAME) || "";
  var destClientName = TR_getSettingValue_(destSS, TR_SETTINGS_KEYS.CLIENT_NAME) || "";
  var now = new Date();
  var transferNote = "Transferred from " + (sourceClientName || "Source") + " to " + (destClientName || "Destination") +
    " on " + Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm");

  // ==========================================
  // 1. INVENTORY TRANSFER
  // ==========================================
  var invHeaders = TR_getHeaders_(inv);
  var invMap = TR_headerMap_(invHeaders);
  var destInvHeaders = TR_getHeaders_(destInv);

  var colItemIdInv = invMap["ITEM ID"];
  var colStatusInv = invMap["STATUS"];
  if (!colItemIdInv) throw new Error("Inventory missing header: Item ID");

  var invValues = inv.getDataRange().getValues();
  var invRows = invValues.slice(1);
  var rowsToCopy = [];
  var sourceRowNumbers = [];

  invRows.forEach(function (row, i) {
    var itemId = String(TR_cell_(row, colItemIdInv) || "").trim();
    if (!itemId || itemIds.indexOf(itemId) === -1) return;
    // Skip already transferred rows to reduce duplicates
    if (colStatusInv && String(TR_cell_(row, colStatusInv) || "").trim() === "Transferred") return;
    rowsToCopy.push(row);
    sourceRowNumbers.push(i + 2);
  });

  if (!rowsToCopy.length) throw new Error("No matching Inventory rows found for selected Item IDs.");

  // v1.3.0 FIX B3: Check destination for existing Active/On Hold items with same Item IDs.
  // Prevents silent duplicate item creation in destination spreadsheet.
  var destInvMap_chk = TR_headerMap_(destInvHeaders);
  var destItemIdCol_chk = destInvMap_chk["ITEM ID"];
  var destStatusCol_chk = destInvMap_chk["STATUS"];
  if (destItemIdCol_chk) {
    var destInvData_chk = destInv.getDataRange().getValues();
    var destActiveIds = {};
    for (var dci = 1; dci < destInvData_chk.length; dci++) {
      var dStatus_chk = destStatusCol_chk ? String(destInvData_chk[dci][destStatusCol_chk] || "").trim().toLowerCase() : "active";
      if (dStatus_chk === "active" || dStatus_chk === "on hold") {
        var dId_chk = String(destInvData_chk[dci][destItemIdCol_chk] || "").trim();
        if (dId_chk) destActiveIds[dId_chk] = true;
      }
    }
    var transferConflicts = [];
    for (var tci = 0; tci < rowsToCopy.length; tci++) {
      var srcItemId = String(TR_cell_(rowsToCopy[tci], colItemIdInv) || "").trim();
      if (srcItemId && destActiveIds[srcItemId]) {
        transferConflicts.push(srcItemId);
      }
    }
    if (transferConflicts.length) {
      throw new Error(
        "BLOCKED: " + transferConflicts.length + " item(s) already exist as Active/On Hold in destination (" + destClientName + "):\n\n" +
        transferConflicts.slice(0, 15).join(", ") +
        (transferConflicts.length > 15 ? " ... (" + (transferConflicts.length - 15) + " more)" : "") +
        "\n\nResolve duplicate Item IDs before transferring."
      );
    }
  }

  var destAppendRows = rowsToCopy.map(function (srcRow) {
    return TR_projectRowByHeaders_(srcRow, invHeaders, destInvHeaders);
  });

  TR_appendRows_(destInv, destAppendRows);

  if (colStatusInv) {
    sourceRowNumbers.forEach(function(rowNum) {
      inv.getRange(rowNum, colStatusInv).setValue("Transferred");
    });
  }

  // ==========================================
  // 2. BILLING LEDGER TRANSFER (Unbilled only)
  // ==========================================
  var billHeaders = TR_getHeaders_(billing);
  var billMap = TR_headerMap_(billHeaders);
  var destBillHeaders = TR_getHeaders_(destBilling);
  var destBillMap = TR_headerMap_(destBillHeaders);

  var colItemIdBill = billMap["ITEM ID"];
  var colStatusBill = billMap["STATUS"];
  var colInvoiceBill = billMap["INVOICE #"] || billMap["INVOICE NO"] || billMap["INVOICE"];
  var colNotesBill = billMap["ITEM NOTES"];

  var destLedgerAppend = [];
  var sourceVoidRowNums = [];

  if (colItemIdBill && colStatusBill) {
    var billValues = billing.getDataRange().getValues();
    var billRows = billValues.slice(1);

    billRows.forEach(function (row, i) {
      var itemId = String(TR_cell_(row, colItemIdBill) || "").trim();
      if (!itemId || itemIds.indexOf(itemId) === -1) return;

      var status = String(TR_cell_(row, colStatusBill) || "").trim();
      if (status !== "Unbilled") return; // Only move unbilled charges

      var destRow = TR_projectRowByHeaders_(row, billHeaders, destBillHeaders);
      TR_setByHeader_(destRow, destBillMap, "STATUS", "Unbilled");
      if (destBillMap["CLIENT"] && destClientName) TR_setByHeader_(destRow, destBillMap, "CLIENT", destClientName);

      // Clear invoice fields on destination
      if (colInvoiceBill) {
        if (destBillMap["INVOICE #"]) TR_setByHeader_(destRow, destBillMap, "INVOICE #", "");
        if (destBillMap["INVOICE NO"]) TR_setByHeader_(destRow, destBillMap, "INVOICE NO", "");
        if (destBillMap["INVOICE"]) TR_setByHeader_(destRow, destBillMap, "INVOICE", "");
      }

      // v2.7.1: Re-apply destination client's discount to transferred billing rows
      // Skip manually-priced service codes (REPAIR) — those rates are set by techs, not price list
      var destColRate = destBillMap["RATE"];
      var destColTotal = destBillMap["TOTAL"];
      var destColQty = destBillMap["QTY"];
      var destColCategory = destBillMap["CATEGORY"];
      var destColSvcCode = destBillMap["SVC CODE"] || destBillMap["SERVICE CODE"];
      if (destColRate && destColTotal && destColCategory) {
        var billSvcCode = String(destColSvcCode ? TR_getByHeader_(destRow, destBillMap, destColSvcCode === destBillMap["SVC CODE"] ? "SVC CODE" : "SERVICE CODE") : "").trim().toUpperCase();
        // Skip discount recalculation for manually-priced services (repairs, custom quotes)
        var skipDiscount = (billSvcCode === "REPAIR" || billSvcCode === "RPR");
        if (!skipDiscount) {
          var origRate = Number(TR_getByHeader_(destRow, destBillMap, "RATE") || 0);
          var billCategory = String(TR_getByHeader_(destRow, destBillMap, "CATEGORY") || "").trim();
          var billQty = Number(TR_getByHeader_(destRow, destBillMap, "QTY") || 1) || 1;
          if (origRate > 0 && billCategory) {
            var catLower = billCategory.toLowerCase();
            var isStorage = (catLower === "storage charges" || catLower === "storage");
            var destPct = Number(TR_getSettingValue_(destSS, isStorage ? "DISCOUNT_STORAGE_PCT" : "DISCOUNT_SERVICES_PCT") || 0);
            var srcPct = Number(TR_getSettingValue_(ss, isStorage ? "DISCOUNT_STORAGE_PCT" : "DISCOUNT_SERVICES_PCT") || 0);
            // Reverse source adjustment to get base rate, then apply destination adjustment
            // v3.1.0: widened from ±10 to ±100 to match applyClientDiscount_
            var baseRate = (srcPct !== 0 && srcPct >= -100 && srcPct <= 100) ? origRate / (1 + srcPct / 100) : origRate;
            var newRate = (destPct !== 0 && destPct >= -100 && destPct <= 100) ? Math.round(baseRate * (1 + destPct / 100) * 100) / 100 : baseRate;
            newRate = Math.round(newRate * 100) / 100;
            TR_setByHeader_(destRow, destBillMap, "RATE", newRate);
            TR_setByHeader_(destRow, destBillMap, "TOTAL", Math.round(newRate * billQty * 100) / 100);
          }
        }
      }

      if (destBillMap["ITEM NOTES"]) {
        var existing = TR_getByHeader_(destRow, destBillMap, "ITEM NOTES");
        TR_setByHeader_(destRow, destBillMap, "ITEM NOTES", (existing ? (existing + " | ") : "") + transferNote);
      }

      destLedgerAppend.push(destRow);
      sourceVoidRowNums.push(i + 2);
    });

    if (destLedgerAppend.length) TR_appendRows_(destBilling, destLedgerAppend);

    // Void source rows
    sourceVoidRowNums.forEach(function(rowNum) {
      billing.getRange(rowNum, colStatusBill).setValue("Void");
      if (colNotesBill) {
        var cell = billing.getRange(rowNum, colNotesBill);
        var val = String(cell.getValue() || "").trim();
        cell.setValue((val ? val + " | " : "") + transferNote);
      }
    });
  }

  // ==========================================
  // 3. TASKS TRANSFER (Active only)
  // ==========================================
  var tasksAppended = 0;
  if (tasks && destTasks) {
    var tasksHeaders = TR_getHeaders_(tasks);
    var tasksMap = TR_headerMap_(tasksHeaders);
    var destTasksHeaders = TR_getHeaders_(destTasks);
    var destTasksMap = TR_headerMap_(destTasksHeaders);

    var colItemIdTasks = tasksMap["ITEM ID"];
    var colStatusTasks = tasksMap["STATUS"];
    var colNotesTasks = tasksMap["ITEM NOTES"];

    if (colItemIdTasks) {
      var tasksValues = tasks.getDataRange().getValues();
      var tasksRows = tasksValues.slice(1);
      var destTasksAppend = [];
      var sourceTasksRowNums = [];

      tasksRows.forEach(function (row, i) {
        var itemId = String(TR_cell_(row, colItemIdTasks) || "").trim();
        if (!itemId || itemIds.indexOf(itemId) === -1) return;

        var status = colStatusTasks ? String(TR_cell_(row, colStatusTasks) || "").trim() : "";
        if (status === "Completed" || status === "Cancelled") return; // Only active tasks

        var destRow = TR_projectRowByHeaders_(row, tasksHeaders, destTasksHeaders);
        if (destTasksMap["ITEM NOTES"]) {
          var existing = TR_getByHeader_(destRow, destTasksMap, "ITEM NOTES");
          TR_setByHeader_(destRow, destTasksMap, "ITEM NOTES", (existing ? (existing + " | ") : "") + transferNote);
        }

        destTasksAppend.push(destRow);
        sourceTasksRowNums.push(i + 2);
      });

      if (destTasksAppend.length) {
        TR_appendRows_(destTasks, destTasksAppend);
        tasksAppended = destTasksAppend.length;
      }

      // Void/cancel on source
      sourceTasksRowNums.forEach(function(rowNum) {
        if (colStatusTasks) tasks.getRange(rowNum, colStatusTasks).setValue("Cancelled");
        if (colNotesTasks) {
          var cell = tasks.getRange(rowNum, colNotesTasks);
          var val = String(cell.getValue() || "").trim();
          cell.setValue((val ? val + " | " : "") + "Voided - " + transferNote);
        }
      });
    }
  }

  // ==========================================
  // 4. REPAIRS TRANSFER (Active only)
  // ==========================================
  var repairsAppended = 0;
  if (repairs && destRepairs) {
    var repairsHeaders = TR_getHeaders_(repairs);
    var repairsMap = TR_headerMap_(repairsHeaders);
    var destRepairsHeaders = TR_getHeaders_(destRepairs);
    var destRepairsMap = TR_headerMap_(destRepairsHeaders);

    var colItemIdRepairs = repairsMap["ITEM ID"];
    var colStatusRepairs = repairsMap["STATUS"];
    var colNotesRepairs = repairsMap["ITEM NOTES"];

    if (colItemIdRepairs) {
      var repairsValues = repairs.getDataRange().getValues();
      var repairsRows = repairsValues.slice(1);
      var destRepairsAppend = [];
      var sourceRepairsRowNums = [];

      repairsRows.forEach(function (row, i) {
        var itemId = String(TR_cell_(row, colItemIdRepairs) || "").trim();
        if (!itemId || itemIds.indexOf(itemId) === -1) return;

        var status = colStatusRepairs ? String(TR_cell_(row, colStatusRepairs) || "").trim() : "";
        if (status === "Complete") return; // Only active repairs

        var destRow = TR_projectRowByHeaders_(row, repairsHeaders, destRepairsHeaders);
        if (destRepairsMap["ITEM NOTES"]) {
          var existing = TR_getByHeader_(destRow, destRepairsMap, "ITEM NOTES");
          TR_setByHeader_(destRow, destRepairsMap, "ITEM NOTES", (existing ? (existing + " | ") : "") + transferNote);
        }

        destRepairsAppend.push(destRow);
        sourceRepairsRowNums.push(i + 2);
      });

      if (destRepairsAppend.length) {
        TR_appendRows_(destRepairs, destRepairsAppend);
        repairsAppended = destRepairsAppend.length;
      }

      // Void/close on source
      sourceRepairsRowNums.forEach(function(rowNum) {
        if (colStatusRepairs) repairs.getRange(rowNum, colStatusRepairs).setValue("Complete");
        if (colNotesRepairs) {
          var cell = repairs.getRange(rowNum, colNotesRepairs);
          var val = String(cell.getValue() || "").trim();
          cell.setValue((val ? val + " | " : "") + "Voided - " + transferNote);
        }
      });
    }
  }

  // ==========================================
  // 5. PHOTO FOLDER TRANSFER
  // ==========================================
  var photosCopied = 0;
  var sourceParentFolderId = String(TR_getSettingValue_(ss, "DRIVE_PARENT_FOLDER_ID") || "").trim();
  var destParentFolderId = String(TR_getSettingValue_(destSS, "DRIVE_PARENT_FOLDER_ID") || "").trim();

  if (sourceParentFolderId && destParentFolderId) {
    var destParentFolder = null;
    try {
      destParentFolder = DriveApp.getFolderById(destParentFolderId);
    } catch (e) {
      Logger.log("TR_executeTransfer: Cannot access destination DRIVE_PARENT_FOLDER_ID: " + e);
    }

    if (destParentFolder) {
      var copiedShipmentFolders = {};
      var folderUrlCache = {};
      var itemPhotoUrlMap = {};

      var destInvMap = TR_headerMap_(destInvHeaders);
      var destColPhotos = destInvMap["SHIPMENT PHOTOS URL"];
      var destColInspPhotos = destInvMap["INSPECTION PHOTOS URL"];
      var destColRepairPhotos = destInvMap["REPAIR PHOTOS URL"];
      var destColItemId = destInvMap["ITEM ID"];

      var invColPhotos = invMap["SHIPMENT PHOTOS URL"];
      // v2.7.0: Photo URL columns removed from Inventory — read folder URLs from hyperlinked ID cells instead
      // Fallback: if old columns still exist on source sheet, read from them
      var invColInspPhotos = invMap["INSPECTION PHOTOS URL"]; // legacy fallback
      var invColRepairPhotos = invMap["REPAIR PHOTOS URL"]; // legacy fallback
      rowsToCopy.forEach(function(srcRow) {
        var itemId = String(TR_cell_(srcRow, colItemIdInv) || "").trim();
        if (!itemId) return;

        var photosUrl = invColPhotos ? String(TR_cell_(srcRow, invColPhotos) || "").trim() : "";
        var inspPhotosUrl = invColInspPhotos ? String(TR_cell_(srcRow, invColInspPhotos) || "").trim() : "";
        var repairPhotosUrl = invColRepairPhotos ? String(TR_cell_(srcRow, invColRepairPhotos) || "").trim() : "";

        if (!photosUrl && !inspPhotosUrl && !repairPhotosUrl) return;

        var newPhotosUrl = "";
        var newInspPhotosUrl = "";
        var newRepairPhotosUrl = "";

        var shipmentFolderId = TR_extractFolderId_(photosUrl);
        if (shipmentFolderId) {
          var destShipmentFolder = copiedShipmentFolders[shipmentFolderId] || null;
          if (!destShipmentFolder) {
            try {
              var srcShipmentFolder = DriveApp.getFolderById(shipmentFolderId);
              destShipmentFolder = TR_copyFolderRecursive_(srcShipmentFolder, destParentFolder);
              if (destShipmentFolder) {
                copiedShipmentFolders[shipmentFolderId] = destShipmentFolder;
                photosCopied++;
              }
            } catch (e) {
              Logger.log("TR photo copy: Cannot access shipment folder " + shipmentFolderId + ": " + e);
            }
          }
          if (destShipmentFolder) {
            newPhotosUrl = destShipmentFolder.getUrl();

            if (inspPhotosUrl) {
              var srcInspFolderId = TR_extractFolderId_(inspPhotosUrl);
              if (srcInspFolderId) {
                if (folderUrlCache[srcInspFolderId]) {
                  newInspPhotosUrl = folderUrlCache[srcInspFolderId];
                } else {
                  try {
                    var srcInspFolder = DriveApp.getFolderById(srcInspFolderId);
                    var inspFolderName = srcInspFolder.getName();
                    var destInspIter = destShipmentFolder.getFoldersByName(inspFolderName);
                    if (destInspIter.hasNext()) {
                      var destInspFolder = destInspIter.next();
                      newInspPhotosUrl = destInspFolder.getUrl();
                      folderUrlCache[srcInspFolderId] = newInspPhotosUrl;

                      if (repairPhotosUrl) {
                        var srcRepairFolderId = TR_extractFolderId_(repairPhotosUrl);
                        if (srcRepairFolderId) {
                          if (folderUrlCache[srcRepairFolderId]) {
                            newRepairPhotosUrl = folderUrlCache[srcRepairFolderId];
                          } else {
                            try {
                              var srcRepairFolder = DriveApp.getFolderById(srcRepairFolderId);
                              var repairFolderName = srcRepairFolder.getName();
                              var destRepairIter = destInspFolder.getFoldersByName(repairFolderName);
                              if (destRepairIter.hasNext()) {
                                newRepairPhotosUrl = destRepairIter.next().getUrl();
                                folderUrlCache[srcRepairFolderId] = newRepairPhotosUrl;
                              }
                            } catch (e) {
                              Logger.log("TR photo copy: Cannot access repair folder " + srcRepairFolderId + ": " + e);
                            }
                          }
                        }
                      }
                    }
                  } catch (e) {
                    Logger.log("TR photo copy: Cannot access inspection folder " + srcInspFolderId + ": " + e);
                  }
                }
              }
            }
          }
        }

        if (newPhotosUrl || newInspPhotosUrl || newRepairPhotosUrl) {
          itemPhotoUrlMap[itemId] = {
            photos: newPhotosUrl,
            insp: newInspPhotosUrl,
            repair: newRepairPhotosUrl
          };
        }
      });
      // --- Update destination Inventory rows with new URLs ---
      if (destColItemId && Object.keys(itemPhotoUrlMap).length > 0) {
        var destInvData = destInv.getDataRange().getValues();
        var destLastRow = destInvData.length;

        for (var di = destLastRow - 1; di >= 1; di--) {
          var destItemId = String(destInvData[di][destColItemId - 1] || "").trim();
          if (!destItemId || !itemPhotoUrlMap[destItemId]) continue;

          var urls = itemPhotoUrlMap[destItemId];
          var destRowNum = di + 1;

          if (destColPhotos && urls.photos) {
            destInv.getRange(destRowNum, destColPhotos).setValue(urls.photos);
          }
          if (destColInspPhotos && urls.insp) {
            destInv.getRange(destRowNum, destColInspPhotos).setValue(urls.insp);
          }
          if (destColRepairPhotos && urls.repair) {
            destInv.getRange(destRowNum, destColRepairPhotos).setValue(urls.repair);
          }

          delete itemPhotoUrlMap[destItemId];
          if (Object.keys(itemPhotoUrlMap).length === 0) break;
        }
      }

      // --- Update destination Tasks rows (Inspection Photos URL) ---
      if (destTasks && tasksAppended > 0) {
        var destTasksHeaders = TR_getHeaders_(destTasks);
        var destTasksMapFresh = TR_headerMap_(destTasksHeaders);
        var destTaskInspCol = destTasksMapFresh["INSPECTION PHOTOS URL"];
        var destTaskItemIdCol = destTasksMapFresh["ITEM ID"];

        if (destTaskInspCol && destTaskItemIdCol) {
          var destTasksData = destTasks.getDataRange().getValues();
          var destTasksLastRow = destTasksData.length;

          var taskInspUrlMap = {};
          rowsToCopy.forEach(function(srcRow) {
            var iid = String(TR_cell_(srcRow, colItemIdInv) || "").trim();
            var inspUrl = invColInspPhotos ? String(TR_cell_(srcRow, invColInspPhotos) || "").trim() : "";
            if (iid && inspUrl) {
              var srcFid = TR_extractFolderId_(inspUrl);
              if (srcFid && folderUrlCache[srcFid]) {
                taskInspUrlMap[iid] = folderUrlCache[srcFid];
              }
            }
          });

          for (var ti = destTasksLastRow - 1; ti >= Math.max(1, destTasksLastRow - tasksAppended); ti--) {
            var taskItemId = String(destTasksData[ti][destTaskItemIdCol - 1] || "").trim();
            if (taskItemId && taskInspUrlMap[taskItemId]) {
              destTasks.getRange(ti + 1, destTaskInspCol).setValue(taskInspUrlMap[taskItemId]);
            }
          }
        }
      }

      // --- Update destination Repairs rows (Inspection Photos URL + Repair Photos URL) ---
      if (destRepairs && repairsAppended > 0) {
        var destRepairsHeaders = TR_getHeaders_(destRepairs);
        var destRepairsMapFresh = TR_headerMap_(destRepairsHeaders);
        var destRepairInspCol = destRepairsMapFresh["INSPECTION PHOTOS URL"];
        var destRepairPhotosCol = destRepairsMapFresh["REPAIR PHOTOS URL"];
        var destRepairItemIdCol = destRepairsMapFresh["ITEM ID"];

        if (destRepairItemIdCol) {
          var destRepairsData = destRepairs.getDataRange().getValues();
          var destRepairsLastRow = destRepairsData.length;

          var repInspUrlMap = {};
          var repRepairUrlMap = {};
          rowsToCopy.forEach(function(srcRow) {
            var iid = String(TR_cell_(srcRow, colItemIdInv) || "").trim();
            if (!iid) return;
            var inspUrl = invColInspPhotos ? String(TR_cell_(srcRow, invColInspPhotos) || "").trim() : "";
            var repUrl = invColRepairPhotos ? String(TR_cell_(srcRow, invColRepairPhotos) || "").trim() : "";
            if (inspUrl) {
              var srcFid = TR_extractFolderId_(inspUrl);
              if (srcFid && folderUrlCache[srcFid]) repInspUrlMap[iid] = folderUrlCache[srcFid];
            }
            if (repUrl) {
              var srcRFid = TR_extractFolderId_(repUrl);
              if (srcRFid && folderUrlCache[srcRFid]) repRepairUrlMap[iid] = folderUrlCache[srcRFid];
            }
          });

          for (var ri = destRepairsLastRow - 1; ri >= Math.max(1, destRepairsLastRow - repairsAppended); ri--) {
            var repItemId = String(destRepairsData[ri][destRepairItemIdCol - 1] || "").trim();
            if (!repItemId) continue;
            if (destRepairInspCol && repInspUrlMap[repItemId]) {
              destRepairs.getRange(ri + 1, destRepairInspCol).setValue(repInspUrlMap[repItemId]);
            }
            if (destRepairPhotosCol && repRepairUrlMap[repItemId]) {
              destRepairs.getRange(ri + 1, destRepairPhotosCol).setValue(repRepairUrlMap[repItemId]);
            }
          }
        }
      }
    }
  }

  // ==========================================
  // 6. TRANSFER RECEIVED EMAIL (to destination client)
  // ==========================================
  try {
    var destNotifEnabled = truthy_(TR_getSettingValue_(destSS, "ENABLE_NOTIFICATIONS"));
    if (destNotifEnabled) {
      // Build items table HTML from transferred rows
      var trItemsHtml = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">';
      var trCols = ["Item ID", "Qty", "Vendor", "Description", "Sidemark", "Room", "Item Notes"];
      trItemsHtml += '<tr>';
      for (var tc = 0; tc < trCols.length; tc++) {
        trItemsHtml += '<td style="padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;font-size:13px">' + trCols[tc] + '</td>';
      }
      trItemsHtml += '</tr>';
      for (var tri = 0; tri < rowsToCopy.length; tri++) {
        trItemsHtml += '<tr>';
        for (var tc2 = 0; tc2 < trCols.length; tc2++) {
          var trColIdx = invMap[trCols[tc2].toUpperCase()];
          var trVal = trColIdx ? String(TR_cell_(rowsToCopy[tri], trColIdx) || "") : "";
          trItemsHtml += '<td style="padding:6px 12px;border:1px solid #e2e8f0;font-size:13px">' + trVal + '</td>';
        }
        trItemsHtml += '</tr>';
      }
      trItemsHtml += '</table>';

      var transferDateFmt = Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), "MM/dd/yyyy");

      sendTemplateEmail_(destSS, "TRANSFER_RECEIVED", "", {
        "{{CLIENT_NAME}}": destClientName || "Client",
        "{{SOURCE_CLIENT_NAME}}": sourceClientName || "Previous Account",
        "{{ITEM_COUNT}}": String(rowsToCopy.length),
        "{{TRANSFER_DATE}}": transferDateFmt,
        "{{TRANSFER_NOTES}}": transferNote,
        "{{ITEMS_TABLE}}": trItemsHtml
      });
    }
  } catch (trEmailErr) {
    Logger.log("TR_executeTransfer: Transfer email failed: " + trEmailErr);
  }

  return {
    ok: true,
    copiedItems: rowsToCopy.length,
    voidedLedgerRows: sourceVoidRowNums.length,
    createdLedgerRows: destLedgerAppend.length,
    tasksTransferred: tasksAppended,
    repairsTransferred: repairsAppended,
    photoFoldersCopied: photosCopied,
    destinationSpreadsheetId: destId
  };
}

// ============================================================
// HELPERS (local, prefixed)
// ============================================================

function TR_getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || "").trim(); });
}

function TR_headerMap_(headers) {
  var map = {};
  headers.forEach(function (h, i) {
    var key = String(h || "").trim().toUpperCase();
    if (!key) return;
    map[key] = i + 1; // 1-based
  });
  return map;
}

function TR_cell_(row, col1Based) {
  if (!col1Based) return "";
  return row[col1Based - 1];
}

function TR_getSettingValue_(ss, key) {
  var sheet = ss.getSheetByName(TR_sheetName_("SETTINGS", "Settings"));
  if (!sheet) return "";
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    var k = String(values[i][0] || "").trim();
    if (k === key) return values[i][1];
  }
  return "";
}

function TR_listClientsFromConsolidated_(consolidatedSpreadsheetId) {
  var cons = SpreadsheetApp.openById(String(consolidatedSpreadsheetId).trim());
  var sh = cons.getSheetByName("Clients");
  if (!sh) throw new Error("Consolidated Billing spreadsheet missing 'Clients' sheet.");
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  // v2.7.0: Find header row by scanning for the row with BOTH "Client Name" AND "Active".
  // Supports both old layout (config rows 1-3, headers row 4) and new layout (headers row 1).
  var headerRowIdx = -1;
  var dataStartIdx = 1;
  var debugRows = [];
  for (var hi = 0; hi < Math.min(values.length, 10); hi++) {
    var cellA = String(values[hi][0] || "").trim();
    debugRows.push("Row " + (hi + 1) + " A=" + cellA);
    if (cellA.toUpperCase() === "CLIENT NAME") {
      var rowStr = values[hi].map(function(c) { return String(c || "").trim().toUpperCase(); }).join("|");
      if (rowStr.indexOf("ACTIVE") !== -1) {
        headerRowIdx = hi;
        dataStartIdx = hi + 1;
        break;
      }
    }
  }
  if (headerRowIdx === -1) {
    throw new Error("Could not find 'Client Name' header in Clients tab. First 10 rows col A: [" + debugRows.join(" | ") + "]");
  }
  if (values.length <= dataStartIdx) return [];

  var headers = values[headerRowIdx].map(function (h) { return String(h || "").trim(); });
  var map = TR_headerMap_(headers);

  var colName = map["CLIENT NAME"] || map["CLIENT"];
  var colId = map["CLIENT SPREADSHEET ID"] || map["SPREADSHEET ID"] || map["SHEET ID"] || map["SPREADSHEETID"];
  var colActive = map["ACTIVE"] || map["ACTIVE CLIENT"] || map["IS ACTIVE"];

  if (!colName || !colId) throw new Error("Headers found at row " + (headerRowIdx + 1) + ": [" + headers.filter(Boolean).join(", ") + "]. Missing: " + (!colName ? "'Client Name'" : "") + (!colId ? " 'Client Spreadsheet ID'" : ""));

  Logger.log("[TR_listClients] colActive=" + colActive + " headers: " + headers.filter(Boolean).join(", "));

  var out = [];
  for (var i = dataStartIdx; i < values.length; i++) {
    var r = values[i];
    var name = String(TR_cell_(r, colName) || "").trim();
    var id = String(TR_cell_(r, colId) || "").trim();
    if (!name || !id) continue;
    // v2.6.5: Only include active clients (Active checkbox must be TRUE)
    if (colActive) {
      var active = TR_cell_(r, colActive);
      var activeStr = String(active || "").trim().toLowerCase();
      if (active === true || activeStr === "true" || activeStr === "yes" || activeStr === "y" || activeStr === "1" || active === 1) {
        // active — include
      } else {
        Logger.log("[TR_listClients] Skipping inactive: " + name + " (active=" + active + ")");
        continue; // not explicitly active — skip
      }
    } else {
      Logger.log("[TR_listClients] WARNING: No 'Active' column found — all clients included. Headers: " + headers.filter(Boolean).join(", "));
    }
    out.push({ name: name, spreadsheetId: id });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function TR_projectRowByHeaders_(srcRow, srcHeaders, destHeaders) {
  var srcMap = TR_headerMap_(srcHeaders);
  var out = new Array(destHeaders.length);
  for (var i = 0; i < destHeaders.length; i++) {
    var h = String(destHeaders[i] || "").trim();
    if (!h) { out[i] = ""; continue; }
    var col = srcMap[String(h).trim().toUpperCase()];
    out[i] = col ? srcRow[col - 1] : "";
  }
  return out;
}

function TR_appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;
  // Find actual last data row by scanning multiple columns for content
  // Checks cols A, B, and C to handle sheets where col A has dropdown validations
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) { lastRow = 1; }
  var scanData = sheet.getRange(1, 1, lastRow, 3).getValues();
  var lastDataRow = 0;
  for (var i = scanData.length - 1; i >= 0; i--) {
    var a = String(scanData[i][0] || "").trim();
    var b = String(scanData[i][1] || "").trim();
    var c = String(scanData[i][2] || "").trim();
    if (a !== "" || b !== "" || c !== "") {
      lastDataRow = i + 1;
      break;
    }
  }
  var start = lastDataRow + 1;
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

function TR_getByHeader_(row, headerMap, headerName) {
  var col = headerMap[String(headerName).trim().toUpperCase()];
  if (!col) return "";
  return row[col - 1];
}

function TR_setByHeader_(row, headerMap, headerName, value) {
  var col = headerMap[String(headerName).trim().toUpperCase()];
  if (!col) return;
  row[col - 1] = value;
}
/**
 * Extracts a Google Drive folder ID from a folder URL.
 * @param {string} url
 * @returns {string|null}
 */
function TR_extractFolderId_(url) {
  if (!url) return null;
  var s = String(url).trim();
  if (!s) return null;
  var match = s.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

/**
 * Recursively copies a Drive folder and all its contents into a destination parent folder.
 * @param {GoogleAppsScript.Drive.Folder} sourceFolder
 * @param {GoogleAppsScript.Drive.Folder} destParentFolder
 * @returns {GoogleAppsScript.Drive.Folder|null}
 */
function TR_copyFolderRecursive_(sourceFolder, destParentFolder) {
  if (!sourceFolder || !destParentFolder) return null;
  try {
    var newFolder = destParentFolder.createFolder(sourceFolder.getName());

    var files = sourceFolder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      file.makeCopy(file.getName(), newFolder);
    }

    var subFolders = sourceFolder.getFolders();
    while (subFolders.hasNext()) {
      var sub = subFolders.next();
      TR_copyFolderRecursive_(sub, newFolder);
    }

    return newFolder;
  } catch (err) {
    Logger.log("TR_copyFolderRecursive_ error: " + err);
    return null;
  }
}

// ============================================================
// HTML (inline template)
// ============================================================

function TR_buildTransferHtml_(ctx) {
  var esc = function(s) { return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); };

  // Build client options HTML — exclude the source spreadsheet
  var sourceId = ctx.sourceSpreadsheetId || "";
  var optionsHtml = '';
  for (var i = 0; i < ctx.clients.length; i++) {
    if (ctx.clients[i].spreadsheetId === sourceId) continue;
    optionsHtml += '<option value="' + esc(ctx.clients[i].spreadsheetId) + '">' + esc(ctx.clients[i].name) + '</option>';
  }

  // Build items table rows
  var itemRowsHtml = "";
  for (var j = 0; j < ctx.preview.length; j++) {
    var p = ctx.preview[j];
    itemRowsHtml += '<tr><td>' + esc(p.itemId) + '</td><td>' + esc(p.qty) + '</td><td>' + esc(p.vendor) + '</td><td>' + esc(p.description) + '</td><td>' + esc(p.sidemark) + '</td></tr>';
  }

  // Build safe JSON for script — escape </ to prevent script tag injection
  var ctxJson = JSON.stringify(ctx).replace(/<\//g, "<\\/");

  return '<!DOCTYPE html>' +
  '<html><head><base target="_top"><style>' +
  'body { font-family: Arial, sans-serif; margin: 16px; color:#1f2937; }' +
  'select, button { padding: 8px; font-size: 14px; border: 1px solid #d1d5db; border-radius: 4px; }' +
  '#destSearch { width:260px; padding:6px 8px; border:1px solid #ccc; border-radius:4px; font-size:13px; box-sizing:border-box; margin-right:8px; }' +
  'table { border-collapse: collapse; width: 100%; margin-top: 10px; }' +
  'th, td { border: 1px solid #e5e7eb; padding: 8px; font-size: 13px; }' +
  'th { background: #f9fafb; text-align: left; }' +
  '.muted { color:#6b7280; font-size:13px; line-height: 1.4; }' +
  '.actions { display:flex; justify-content:flex-end; gap:10px; margin-top: 20px; }' +
  '.pill { display:inline-block; padding:2px 8px; border-radius: 999px; background:#eef2ff; font-size:12px; font-weight: bold; color: #4f46e5; }' +
  '#loadingOverlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.85);z-index:9999;justify-content:center;align-items:center;flex-direction:column;}' +
  '.spinner{width:40px;height:40px;border:4px solid #E2E8F0;border-top:4px solid #ea580c;border-radius:50%;animation:spin 0.8s linear infinite;}' +
  '@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}' +
  '</style></head><body>' +
  '<div id="loadingOverlay"><div class="spinner"></div><div style="margin-top:12px;font-size:13px;font-weight:600;color:#64748B;">Transferring items... please wait</div></div>' +

  // Header
  '<div style="margin-bottom:12px;">' +
  '<div style="font-size:15px;"><strong>Source Client:</strong> ' + esc(ctx.sourceClientName || "Client Sheet") + ' <span class="pill">' + esc(ctx.version) + '</span></div>' +
  '<div class="muted">Selection: ' + esc(ctx.invSheetName) + '!' + esc(ctx.selectionA1) + '</div>' +
  '</div>' +

  // Destination picker — searchable select
  '<div style="margin-bottom:12px;">' +
  '<label><strong>Destination Client:</strong></label><br>' +
  '<input type="text" id="destSearch" placeholder="Type to filter clients..." oninput="filterClients()" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;box-sizing:border-box;margin:6px 0;">' +
  '<select id="dest" size="6" style="width:100%;padding:4px;font-size:14px;border:1px solid #d1d5db;border-radius:4px;">' + optionsHtml + '</select>' +
  '</div>' +

  // Info box
  '<div class="muted" style="background:#f3f4f6; padding:10px; border-radius:6px; margin-bottom:20px;">' +
  '<strong>What happens during transfer?</strong><br>' +
  '&bull; Selected Inventory items are copied.<br>' +
  '&bull; <strong>Unbilled</strong> Ledger rows are transferred and voided on the source.<br>' +
  '&bull; <strong>Active</strong> Tasks &amp; Repairs are transferred and cancelled/closed on the source.' +
  '</div>' +

  // Items table
  '<h3 style="margin-bottom:5px;">Selected Items</h3>' +
  '<table><thead><tr><th>Item ID</th><th>Qty</th><th>Vendor</th><th>Description</th><th>Sidemark</th></tr></thead>' +
  '<tbody>' + itemRowsHtml + '</tbody></table>' +

  // Actions
  '<div class="actions" id="actionsDiv">' +
  '<button onclick="google.script.host.close()" style="background:#f3f4f6;cursor:pointer;">Cancel</button>' +
  '<button id="confirmBtn" onclick="doTransfer()" style="background:#ea580c;color:white;border:none;cursor:pointer;font-weight:bold;">Confirm Transfer</button>' +
  '</div>' +
  '<div id="status" class="muted" style="margin-top:15px;font-weight:bold;"></div>' +

  // Script — pure ES5, no scriptlets
  '<script>' +
  'var ctx = ' + ctxJson + ';' +
  'var _allOpts = [];' +
  'var _sel = document.getElementById("dest");' +
  'for (var oi = 1; oi < _sel.options.length; oi++) { _allOpts.push({v:_sel.options[oi].value, t:_sel.options[oi].text}); }' +

  'function filterClients() {' +
  '  var q = document.getElementById("destSearch").value.toLowerCase();' +
  '  var sel = document.getElementById("dest");' +
  '  while (sel.options.length > 0) sel.remove(0);' +
  '  var count = 0;' +
  '  for (var fi = 0; fi < _allOpts.length; fi++) {' +
  '    if (q === "" || _allOpts[fi].t.toLowerCase().indexOf(q) !== -1) {' +
  '      var opt = document.createElement("option");' +
  '      opt.value = _allOpts[fi].v;' +
  '      opt.text = _allOpts[fi].t;' +
  '      sel.add(opt);' +
  '      count++;' +
  '    }' +
  '  }' +
  '  if (count === 1) sel.selectedIndex = 0;' +
  '}' +

  'function doTransfer() {' +
  '  try {' +
  '    var dest = document.getElementById("dest").value;' +
  '    if (!dest) { alert("Choose a destination client first."); return; }' +
  '    document.getElementById("loadingOverlay").style.display="flex";' +
  '    document.getElementById("actionsDiv").style.display="none";' +
  '    document.getElementById("status").style.color = "#ea580c";' +
  '    document.getElementById("status").textContent = "";' +
  '    var itemIds = [];' +
  '    for (var pi = 0; pi < ctx.preview.length; pi++) {' +
  '      var tid = String(ctx.preview[pi].itemId || "").trim();' +
  '      if (tid) itemIds.push(tid);' +
  '    }' +
  '    google.script.run' +
  '      .withSuccessHandler(function(res) {' +
  '        document.getElementById("loadingOverlay").style.display="none";' +
  '        document.getElementById("status").style.color = "#16a34a";' +
  '        document.getElementById("status").innerHTML = "\\u2705 Transfer Complete!<br>" +' +
  '          "Items Copied: " + res.copiedItems +' +
  '          " | Ledgers: " + res.createdLedgerRows +' +
  '          " | Tasks: " + res.tasksTransferred +' +
  '          " | Repairs: " + res.repairsTransferred +' +
  '          " | Photos: " + res.photoFoldersCopied +' +
  '          "<br><br><button onclick=\\"google.script.host.close()\\" style=\\"background:#16a34a;color:white;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:14px;\\">Done</button>";' +
  '      })' +
  '      .withFailureHandler(function(err) {' +
  '        document.getElementById("loadingOverlay").style.display="none";' +
  '        document.getElementById("actionsDiv").style.display="flex";' +
  '        document.getElementById("status").style.color = "#b91c1c";' +
  '        document.getElementById("status").textContent = "Error: " + (err && err.message ? err.message : String(err));' +
  '      })' +
  '      .TR_executeTransfer({ destinationSpreadsheetId: dest, itemIds: itemIds });' +
  '  } catch(e) {' +
  '    document.getElementById("loadingOverlay").style.display="none";' +
  '    document.getElementById("actionsDiv").style.display="flex";' +
  '    alert("Transfer error: " + e.message);' +
  '  }' +
  '}' +
  '</script></body></html>';
}
