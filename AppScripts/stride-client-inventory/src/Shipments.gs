/* ===================================================
   Shipments.gs — v4.3.3 — 2026-04-17 PST — RECEIVED_DATE email token uses MM/dd/yyyy
   v4.3.2: SHIPMENT_RECEIVED email CTA ({{APP_DEEP_LINK}}) URL now appends
           `?client=<spreadsheetId>` to match the Tasks / Will Call / Repair
           deep-link format. Fixes user-reported "shipment detail page won't
           open" — without the client hint, the React ShipmentJobPage could
           land on the shipment detail route but fail to load items for
           certain auth states. The client param gives the app explicit
           context for the tenant owning this shipment. Both the
           completeShipment path (line 458) and the resend path (line 595)
           updated.
   v4.3.1: Receiving Document PDF row builder (completeShipment) now emits
           columns: #, Item ID, Reference, Qty, Vendor, Description, Sidemark,
           Notes. Class + Location removed — operators requested Reference be
           surfaced to the client PDF, and Class/Location are warehouse-internal.
   v4.3.0: SHIPMENT_RECEIVED (both completeShipment and resend paths) now emit
           {{SIDEMARK}} + {{SIDEMARK_HEADER}} tokens with distinct Sidemarks
           collected across all items in the shipment. Clients see the project
           chip at the top of the email.
   =================================================== */

/* ============================================================
QUICK ENTRY FLOW
============================================================ */
function QE_StartNewShipment(silent) {
var ss = SpreadsheetApp.getActive();
var dock = ss.getSheetByName(CI_SH.DOCK);
if (!dock) { safeAlert_("Missing Dock Intake sheet. Run Initial Setup."); return; }
dock.getRange(DOCK_FORM_RANGE_TO_CLEAR).clearContent();
var map = getHeaderMapAtRow_(dock, DOCK_ITEMS_HEADER_ROW);
var width = maxColFromHeaderMap_(map);
if (!width) width = 10;
var lastRow = dock.getLastRow();
if (lastRow >= DOCK_ITEMS_DATA_START_ROW) {
dock.getRange(DOCK_ITEMS_DATA_START_ROW, 1, lastRow - DOCK_ITEMS_DATA_START_ROW + 1, width).clearContent();
}
// Re-apply checkbox validations after clearContent (ensures checkboxes render properly)
var inspCol = map["Needs Inspection"];
var asmCol = map["Needs Assembly"];
if (inspCol) applyCheckboxToColAtRow_(dock, inspCol, DOCK_ITEMS_DATA_START_ROW);
if (asmCol) applyCheckboxToColAtRow_(dock, asmCol, DOCK_ITEMS_DATA_START_ROW);
// Re-apply Class dropdown
applyDockIntakeClassDropdown_(dock);
// Auto-check Needs Inspection if AUTO_INSPECTION = TRUE
var autoInsp = truthy_(getSetting_(ss, CI_SETTINGS_KEYS.AUTO_INSPECTION));
if (autoInsp && inspCol) {
  var preFillRows = 50; // pre-fill first 50 rows with TRUE
  var cbVals = [];
  for (var ai = 0; ai < preFillRows; ai++) cbVals.push([true]);
  dock.getRange(DOCK_ITEMS_DATA_START_ROW, inspCol, preFillRows, 1).setValues(cbVals);
  dock.getRange(DOCK_ITEMS_HEADER_ROW, inspCol).setNote("Auto-Inspection is ON. All items will be inspected.");
}
SpreadsheetApp.flush(); // Force UI refresh so checkboxes render immediately
if (!silent) {
  safeAlert_("Ready. Enter items below, then click Complete Shipment." +
    (autoInsp ? "\n\nAuto-Inspection is ON — all items will be inspected." : ""));
}
}
function QE_CompleteShipment() {
var ui = SpreadsheetApp.getUi();
var ss = SpreadsheetApp.getActive();
var dock = ss.getSheetByName(CI_SH.DOCK);
var inv = ss.getSheetByName(CI_SH.INVENTORY);
var ship = ss.getSheetByName(CI_SH.SHIPMENTS);
if (!dock || !inv || !ship) { safeAlert_("Missing sheets. Run Initial Setup."); return; }
var mapDock = getHeaderMapAtRow_(dock, DOCK_ITEMS_HEADER_ROW);
var width = maxColFromHeaderMap_(mapDock);
if (!width) { safeAlert_("Dock Intake items header row not found (row " + DOCK_ITEMS_HEADER_ROW + "). Run Initial Setup."); return; }
var last = dock.getLastRow();
if (last < DOCK_ITEMS_DATA_START_ROW) { safeAlert_("No items entered."); return; }
var rawRows = dock.getRange(DOCK_ITEMS_DATA_START_ROW, 1, last - DOCK_ITEMS_DATA_START_ROW + 1, width).getValues();
var rows = rawRows.filter(function(r) {
return getCellByHeader_(r, mapDock, "Item ID") !== "";
});
if (!rows.length) { safeAlert_("No items entered."); return; }
var missing = [];
rows.forEach(function(r, idx) {
QE_REQUIRED.forEach(function(h) {
var v = getCellByHeader_(r, mapDock, h);
if (!v) missing.push("Row " + (idx + DOCK_ITEMS_DATA_START_ROW) + " missing: " + h);
});
});
if (missing.length) {
safeAlert_("Required fields missing:\n\n" + missing.slice(0, 20).join("\n") + (missing.length > 20 ? "\n..." : ""));
return;
}
// v4.0.2: Check for duplicate Item IDs against existing Active inventory
var invMap_dup = getHeaderMap_(inv);
var invItemIdCol_dup = invMap_dup["Item ID"];
var invStatusCol_dup = invMap_dup["Status"];
var invVendorCol_dup = invMap_dup["Vendor"];
var invDescCol_dup = invMap_dup["Description"];
var invLastData_dup = getLastDataRow_(inv);
if (invItemIdCol_dup && invLastData_dup >= 2) {
  var invData_dup = inv.getRange(2, 1, invLastData_dup - 1, inv.getLastColumn()).getValues();
  var activeItems = {};
  for (var di = 0; di < invData_dup.length; di++) {
    var dStatus = invStatusCol_dup ? String(invData_dup[di][invStatusCol_dup - 1] || "").trim().toLowerCase() : "active";
    if (dStatus === "active" || dStatus === "on hold") {
      var dId = String(invData_dup[di][invItemIdCol_dup - 1] || "").trim();
      if (dId) {
        activeItems[dId] = {
          vendor: invVendorCol_dup ? String(invData_dup[di][invVendorCol_dup - 1] || "").trim() : "",
          description: invDescCol_dup ? String(invData_dup[di][invDescCol_dup - 1] || "").trim() : ""
        };
      }
    }
  }
  var dockItemIdCol_dup = mapDock["Item ID"];
  var duplicates = [];
  if (dockItemIdCol_dup) {
    for (var dr = 0; dr < rows.length; dr++) {
      var dockId = String(rows[dr][dockItemIdCol_dup - 1] || "").trim();
      if (dockId && activeItems[dockId]) {
        duplicates.push(dockId + "  |  " + activeItems[dockId].vendor + "  |  " + activeItems[dockId].description);
      }
    }
  }
  if (duplicates.length) {
    safeAlert_(
      "BLOCKED: " + duplicates.length + " item(s) already exist in Active inventory.\n\n" +
      "Item ID  |  Vendor  |  Description\n" +
      duplicates.slice(0, 20).join("\n") +
      (duplicates.length > 20 ? "\n... (" + (duplicates.length - 20) + " more)" : "") +
      "\n\nPlease resolve these duplicates before completing the shipment.\n" +
      "If the item was previously released, verify its status is 'Released' (not 'Active')."
    );
    return;
  }
}
// v4.0.5 FIX B1: Idempotency guard — check if dock already has a Shipment # from a prior run
// and that shipment already exists on the Shipments sheet. Prevents duplicate Inventory/Task rows.
var priorShipNo = String(dock.getRange("B2").getValue() || "").trim();
if (priorShipNo && priorShipNo.indexOf("SHP-") === 0) {
  var shipMap_idem = getHeaderMap_(ship);
  var shipNoCol_idem = shipMap_idem["Shipment #"];
  if (shipNoCol_idem) {
    var shipLastRow_idem = getLastDataRow_(ship);
    if (shipLastRow_idem >= 2) {
      var shipNos_idem = ship.getRange(2, shipNoCol_idem, shipLastRow_idem - 1, 1).getValues();
      for (var si_idem = 0; si_idem < shipNos_idem.length; si_idem++) {
        if (String(shipNos_idem[si_idem][0] || "").trim() === priorShipNo) {
          safeAlert_(
            "BLOCKED: Shipment " + priorShipNo + " has already been processed.\n\n" +
            "This dock form was already completed. To start a new shipment:\n" +
            "1. Click 'Start New Shipment' from the Stride Warehouse menu\n" +
            "2. Enter new items\n" +
            "3. Click 'Complete Shipment'"
          );
          return;
        }
      }
    }
  }
}

// v4.1.0: Validate DRIVE_PARENT_FOLDER_ID before proceeding
var parentId = getSetting_(ss, CI_SETTINGS_KEYS.DRIVE_PARENT_FOLDER_ID);
if (!parentId) { safeAlert_("Missing Settings.DRIVE_PARENT_FOLDER_ID"); return; }
var rpcUrl = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_RPC_URL);
if (!rpcUrl) { safeAlert_("Missing Settings.MASTER_RPC_URL. Cannot generate Shipment ID."); return; }
var confirm = ui.alert(
"Confirm Save Shipment",
"Ready to save " + rows.length + " items?\n\n" +
"This will:\n" +
"- Generate a Shipment ID\n" +
"- Create a Drive folder\n" +
"- Write to Inventory, Shipments, and Tasks\n" +
"- Send notification email (if enabled)\n\n" +
"Continue?",
ui.ButtonSet.YES_NO
);
if (confirm !== ui.Button.YES) {
safeAlert_("Cancelled. Nothing was created or saved.");
return;
}
var shipmentNo = nextGlobalShipmentNumber_();
if (!shipmentNo) {
safeAlert_("Could not generate Shipment #. Check MASTER_RPC_URL, MASTER_RPC_TOKEN, and Master Web App deployment.");
return;
}
// v4.1.0: Use shared entity subfolder helper
var folderUrl = "";
try {
var shipmentsParent = getOrCreateEntitySubfolder_(ss, "Shipments");
if (!shipmentsParent) { safeAlert_("Could not create Drive folder. Check DRIVE_PARENT_FOLDER_ID."); return; }
var folder = shipmentsParent.createFolder(shipmentNo);
folderUrl = folder.getUrl();
} catch (err) {
safeAlert_("Could not create Drive folder. Check DRIVE_PARENT_FOLDER_ID permissions.\n\n" + err);
return;
}
dock.getRange("B2").setValue(shipmentNo).setFontWeight("bold").setBackground("#F1F5F9");
dock.getRange("B3").setValue(folderUrl).setFontWeight("bold").setBackground("#F1F5F9");
var shipColDock = mapDock["Shipment #"];
var itemColDock = mapDock["Item ID"];
if (shipColDock && itemColDock) {
var writeRange = dock.getRange(DOCK_ITEMS_DATA_START_ROW, shipColDock, last - DOCK_ITEMS_DATA_START_ROW + 1, 1);
var shipVals = writeRange.getValues();
for (var i = 0; i < shipVals.length; i++) {
if (String(rawRows[i][itemColDock - 1] || "").trim()) shipVals[i][0] = shipmentNo;
}
writeRange.setValues(shipVals);
}
var now = new Date();
var carrier = String(dock.getRange("B4").getValue() || "").trim();
var tracking = String(dock.getRange("B5").getValue() || "").trim();
var shipNotes = String(dock.getRange("B6").getValue() || "").trim();
// v2.4.0: Use manually entered Receive Date if provided, otherwise today
var receiveDateRaw = dock.getRange("B7").getValue();
var receiveDate = receiveDateRaw ? toDate_(receiveDateRaw) : null;
if (!receiveDate) receiveDate = now;
var mapShip = getHeaderMap_(ship);
var shipRowArr = buildRowFromMap_(mapShip, {
"Shipment #": shipmentNo,
"Receive Date": receiveDate,
"Item Count": rows.length,
"Carrier": carrier,
"Tracking #": tracking,
"Shipment Photos URL": folderUrl,
"Shipment Notes": shipNotes,
"Invoice URL": ""
});
var shipInsertRow = getLastDataRow_(ship) + 1;
ship.getRange(shipInsertRow, 1, 1, shipRowArr.length).setValues([shipRowArr]);
var mapInv = getHeaderMap_(inv);
// v2.6.2: Support both old "Photos URL" and new "Shipment Photos URL" header names
var invPhotosHeader = mapInv["Shipment Photos URL"] ? "Shipment Photos URL" : (mapInv["Photos URL"] ? "Photos URL" : "Shipment Photos URL");
var invPhotosCol = mapInv[invPhotosHeader] || null;
// v4.0.0: Read dock flags (Needs Inspection / Needs Assembly) BEFORE writing to Inventory.
// These columns no longer exist on Inventory — we capture them here for task creation.
var dockTaskFlags = {};
rows.forEach(function(r) {
  var iid = String(getCellByHeader_(r, mapDock, "Item ID") || "").trim();
  if (iid) {
    dockTaskFlags[iid] = {
      needsInsp: truthy_(getCellByHeader_(r, mapDock, "Needs Inspection")),
      needsAsm: truthy_(getCellByHeader_(r, mapDock, "Needs Assembly"))
    };
  }
});
var invRows = rows.map(function(r) {
var invRowObj = {
"Item ID": getCellByHeader_(r, mapDock, "Item ID"),
"Qty": numOrBlank_(getCellByHeader_(r, mapDock, "Qty")),
"Vendor": getCellByHeader_(r, mapDock, "Vendor"),
"Description": getCellByHeader_(r, mapDock, "Description"),
"Class": getCellByHeader_(r, mapDock, "Class"),
"Location": getCellByHeader_(r, mapDock, "Location"),
"Sidemark": getCellByHeader_(r, mapDock, "Sidemark"),
"Room": "",
"Item Notes": getCellByHeader_(r, mapDock, "Item Notes"),
"Carrier": carrier,
"Tracking #": tracking,
"Shipment #": shipmentNo,
"Receive Date": receiveDate,
"Release Date": "",
"Status": "Active",
"Invoice URL": ""
};
invRowObj[invPhotosHeader] = folderUrl;
return buildRowFromMap_(mapInv, invRowObj);
});
// AUTO_INSPECTION setting is used as a default — dock intake pre-checks the checkbox,
// but the user can uncheck individual items before completing shipment.
// We respect whatever the user left on the dock form (already mapped into invRows above).
var autoInspEnabled = truthy_(getSetting_(ss, CI_SETTINGS_KEYS.AUTO_INSPECTION));
var invStart = getLastDataRow_(inv) + 1;
if (invRows.length) {
inv.getRange(invStart, 1, invRows.length, invRows[0].length).setValues(invRows);
}
// v4.0.3: Item folder creation REMOVED from receiving — deferred to Start Task.
// Only shipment folder + Shipment # hyperlinks created here.
if (folderUrl) {
  // Hyperlink Shipment # on Shipments sheet
  if (mapShip["Shipment #"]) {
    var shipRt = SpreadsheetApp.newRichTextValue()
      .setText(shipmentNo)
      .setLinkUrl(folderUrl)
      .build();
    ship.getRange(shipInsertRow, mapShip["Shipment #"]).setRichTextValue(shipRt);
  }
  // Hyperlink Shipment # on each Inventory row
  if (mapInv["Shipment #"]) {
    for (var hli = 0; hli < invRows.length; hli++) {
      var invShipRt = SpreadsheetApp.newRichTextValue()
        .setText(shipmentNo)
        .setLinkUrl(folderUrl)
        .build();
      inv.getRange(invStart + hli, mapInv["Shipment #"]).setRichTextValue(invShipRt);
    }
  }
}
// v4.0.0: Create LIGHTWEIGHT task rows only — no Drive folders, no PDFs.
// Folder/PDF creation deferred to "Start Task" checkbox on Tasks sheet.
// Read task flags from dockTaskFlags map (keyed by Item ID).
var taskSheet = ss.getSheetByName(CI_SH.TASKS);
var taskMap = taskSheet ? getHeaderMap_(taskSheet) : {};
var taskBatch = [];
var pendingTaskIds = [];
invRows.forEach(function(r, idx) {
var itemId = String(r[mapInv["Item ID"] - 1] || "").trim();
if (!itemId) return;
var flags = dockTaskFlags[itemId] || {};
var invRow = invStart + idx;
var taskExtras = {
vendor: String(r[mapInv["Vendor"] - 1] || "").trim(),
description: String(r[mapInv["Description"] - 1] || "").trim(),
location: String(r[mapInv["Location"] - 1] || "").trim(),
sidemark: mapInv["Sidemark"] ? String(r[mapInv["Sidemark"] - 1] || "").trim() : "",
itemNotes: mapInv["Item Notes"] ? String(r[mapInv["Item Notes"] - 1] || "").trim() : ""
};
if (flags.needsInsp) {
  var inspN = nextTaskCounter_(taskSheet, "INSP", itemId, pendingTaskIds);
  var inspTaskId = "INSP-" + itemId + "-" + inspN;
  pendingTaskIds.push(inspTaskId);
  taskBatch.push(buildTaskRow_(taskMap, "INSP", itemId, shipmentNo, invRow, now, taskExtras, inspTaskId));
}
if (flags.needsAsm) {
  var asmN = nextTaskCounter_(taskSheet, "ASM", itemId, pendingTaskIds);
  var asmTaskId = "ASM-" + itemId + "-" + asmN;
  pendingTaskIds.push(asmTaskId);
  taskBatch.push(buildTaskRow_(taskMap, "ASM", itemId, shipmentNo, invRow, now, taskExtras, asmTaskId));
}
});
    if (taskSheet && taskBatch.length) {
        var taskInsertRow = getLastDataRow_(taskSheet) + 1;
        taskSheet.getRange(taskInsertRow, 1, taskBatch.length, taskBatch[0].length).setValues(taskBatch);
        ensureTasksDefaultFilter_(taskSheet);
      // Hyperlink Shipment # on each task row to shipment folder (lightweight — no Drive API)
      var taskShipCol = taskMap["Shipment #"];
      if (taskShipCol && folderUrl) {
        for (var tsi = 0; tsi < taskBatch.length; tsi++) {
          var shipRtT = SpreadsheetApp.newRichTextValue().setText(shipmentNo).setLinkUrl(folderUrl).build();
          taskSheet.getRange(taskInsertRow + tsi, taskShipCol).setRichTextValue(shipRtT);
        }
      }
      // v4.0.0: Task subfolder + PDF creation REMOVED from dock intake.
      // Staff will use "Start Task" checkbox on Tasks sheet when ready.
    }
    // v2.4.4: optionally create receiving billing rows for each item
    var receivingBillingEnabled = truthy_(getSetting_(ss, CI_SETTINGS_KEYS.ENABLE_RECEIVING_BILLING));
    if (receivingBillingEnabled) {
        invRows.forEach(function(r) {
            var itemIdRB = String(r[mapInv["Item ID"] - 1] || "").trim();
            if (!itemIdRB) return;
            var itemClassRB = String(r[mapInv["Class"] - 1] || "").trim();
            var descRB = String(r[mapInv["Description"] - 1] || "").trim();
            var priceRB = lookupPriceFromMaster_(ss, "RCVG", itemClassRB);
            var rateRB = priceRB.rate || 0;
            var svcNameRB = priceRB.svcName || "RCVG";
            writeBillingRow_({
                status: "Unbilled",
                invoiceNo: "",
                client: getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME),
                date: receiveDate,
                svcCode: "RCVG",
                svcName: svcNameRB,
                category: priceRB.category || "",
                itemId: itemIdRB,
                description: descRB,
                itemClass: itemClassRB,
                qty: 1,
                rate: rateRB,
                total: rateRB,
                taskId: "",
                repairId: "",
                shipNo: shipmentNo,
                notes: "Receiving",
                ledgerEntryId: "RCVG-" + itemIdRB + "-" + shipmentNo,
                photosUrl: folderUrl || ""
            });
        });
    }
    // --- Generate Receiving Document PDF ---
    var rcvBlob = null;
    try {
      var clientNamePdf = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
      var clientEmailPdf = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL) || "";
      var logoUrl = getSetting_(ss, CI_SETTINGS_KEYS.LOGO_URL) || "https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png";
      var rcvDateStr = Utilities.formatDate(receiveDate instanceof Date ? receiveDate : new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy");

      // Build items table rows — v4.3.0: Class/Location removed, Reference added
      var itemsTableRows = "";
      var itemNum = 0;
      invRows.forEach(function(r) {
        var iid = String(r[mapInv["Item ID"] - 1] || "").trim();
        if (!iid) return;
        itemNum++;
        var iref = mapInv["Reference"] ? escHtml_(String(r[mapInv["Reference"] - 1] || "")) : "";
        var iqty = mapInv["Qty"] ? String(r[mapInv["Qty"] - 1] || "1") : "1";
        var ivendor = mapInv["Vendor"] ? escHtml_(String(r[mapInv["Vendor"] - 1] || "")) : "";
        var idesc = mapInv["Description"] ? escHtml_(String(r[mapInv["Description"] - 1] || "")) : "";
        var ism = mapInv["Sidemark"] ? escHtml_(String(r[mapInv["Sidemark"] - 1] || "")) : "";
        var inotes = mapInv["Item Notes"] ? escHtml_(String(r[mapInv["Item Notes"] - 1] || "")) : "";
        var bgColor = itemNum % 2 === 0 ? "#F8FAFC" : "#FFFFFF";
        itemsTableRows += '<tr style="background:' + bgColor + ';">' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;text-align:center;font-weight:600;">' + itemNum + '</td>' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;font-weight:700;">' + escHtml_(iid) + '</td>' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;">' + iref + '</td>' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;text-align:center;">' + escHtml_(iqty) + '</td>' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;">' + ivendor + '</td>' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;">' + idesc + '</td>' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;">' + ism + '</td>' +
          '<td style="padding:6px;border-bottom:1px solid #E2E8F0;font-size:11px;">' + inotes + '</td>' +
          '</tr>';
      });

      // --- Build tokens and resolve against template (Email_Templates lookup with embedded fallback) ---
      var rcvTokens = {
        "{{LOGO_URL}}": escHtml_(logoUrl),
        "{{SHIPMENT_NO}}": escHtml_(shipmentNo),
        "{{RECEIVED_DATE}}": escHtml_(rcvDateStr),
        "{{CARRIER}}": escHtml_(carrier || "-"),
        "{{TRACKING}}": escHtml_(tracking || "-"),
        "{{ITEM_COUNT}}": String(rows.length),
        "{{CLIENT_NAME}}": escHtml_(clientNamePdf),
        "{{CLIENT_EMAIL_HTML}}": clientEmailPdf ? '<div style="font-size:11px;color:#64748B;">' + escHtml_(clientEmailPdf) + '</div>' : '',
        "{{SHIPMENT_NOTES_HTML}}": shipNotes ? '<div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;padding:8px 12px;margin-bottom:14px;">' +
          '<div style="font-size:9px;color:#92400E;font-weight:800;text-transform:uppercase;margin-bottom:2px;letter-spacing:0.5px;">Shipment Notes</div>' +
          '<div style="font-size:11px;color:#78350F;">' + escHtml_(shipNotes) + '</div></div>' : '',
        "{{ITEMS_TABLE_ROWS}}": itemsTableRows,
        "{{TOTAL_ITEMS}}": String(rows.length)
      };
      var rcvTemplateResult = getDocTemplateHtml_(ss, "DOC_RECEIVING");
      var rcvHtml = resolveDocTokens_(rcvTemplateResult ? rcvTemplateResult.html : getDefaultDocHtml_("DOC_RECEIVING"), rcvTokens);

      // Create PDF via Google Doc with 0.25" margins and save to shipment folder
      var rcvPdfName = "Receiving_" + shipmentNo + "_" + clientNamePdf.replace(/[^a-zA-Z0-9]/g, "_") + ".pdf";
      var rcvDocId = createGoogleDocFromHtml_("Receiving " + shipmentNo, rcvHtml);
      rcvBlob = exportDocAsPdfBlob_(rcvDocId, rcvPdfName, 0.25);
      var shipFolder = DriveApp.getFolderById(folderUrl.match(/[-\w]{25,}/)[0]);
      shipFolder.createFile(rcvBlob);
      try { DriveApp.getFileById(rcvDocId).setTrashed(true); } catch(_){}
      Logger.log("Receiving document PDF saved for " + shipmentNo);
    } catch (pdfErr) {
      Logger.log("Receiving document PDF failed: " + pdfErr + " | Stack: " + (pdfErr.stack || ""));
      // Non-fatal — don't block the shipment save, but warn the user
      SpreadsheetApp.getActive().toast(
        "Receiving PDF failed: " + pdfErr.message +
        "\n\nMake sure Advanced Drive Service is enabled: Apps Script Editor → Services → Drive API → Add",
        "PDF Warning", 10
      );
    }

    var shipEmailEnabled = truthy_(getSetting_(ss, CI_SETTINGS_KEYS.ENABLE_SHIPMENT_EMAIL));
if (shipEmailEnabled) {
var notif = getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS);
      var clientEmailShip = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL);
var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME);
      var allRecipShip = mergeEmails_(notif, clientEmailShip);
      if (allRecipShip) {
// v4.4.0 — include distinct Sidemarks across shipment items
var _shipSidemarks = collectSidemarksFromRows_(mapInv, invRows);
sendTemplateEmail_(ss, "SHIPMENT_RECEIVED", allRecipShip, {
"{{SHIPMENT_NO}}": shipmentNo,
"{{ITEM_COUNT}}": String(rows.length),
"{{CARRIER}}": carrier || "-",
"{{TRACKING}}": tracking || "-",
"{{PHOTOS_URL}}": folderUrl,
"{{CLIENT_NAME}}": clientName || "Client",
          "{{RECEIVED_DATE}}": Utilities.formatDate(receiveDate instanceof Date ? receiveDate : new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy"),
          "{{ITEMS_TABLE}}": buildItemsHtmlTable_(mapInv, invRows),
      "{{SHIPMENT_NOTES}}": shipNotes || "",
"{{SIDEMARK}}": _shipSidemarks,
"{{SIDEMARK_HEADER}}": buildSidemarkHeader_(_shipSidemarks),
"{{APP_DEEP_LINK}}": "https://www.mystridehub.com/#/shipments?open=" + encodeURIComponent(shipmentNo) + "&client=" + encodeURIComponent(ss.getId())
}, rcvBlob);
}
}
// v3.1.0: Log new sidemark/vendor/description values to Autocomplete_DB
try {
  var acItems = rows.map(function(r) {
    return {
      sidemark: getCellByHeader_(r, mapDock, "Sidemark") || "",
      vendor: getCellByHeader_(r, mapDock, "Vendor") || "",
      description: getCellByHeader_(r, mapDock, "Description") || ""
    };
  });
  logAutocompleteEntries_(acItems);
} catch (acErr) { CI_log_("WARN", "Autocomplete DB log failed", String(acErr)); }
QE_StartNewShipment(true); // silent — skip the "Ready" alert since we show our own
safeAlert_("Saved shipment " + shipmentNo +
  "\nShipment # is hyperlinked to the Drive folder." +
  "\nShipment Photos URL saved to Inventory.");
}

/* ============================================================
GLOBAL SHIPMENT # (via Master RPC)
============================================================ */
function nextGlobalShipmentNumber_() {
var ss = SpreadsheetApp.getActive();
var rpcUrl = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_RPC_URL);
var rpcToken = getSetting_(ss, CI_SETTINGS_KEYS.MASTER_RPC_TOKEN);
if (!rpcUrl) { Logger.log("nextGlobalShipmentNumber_: MASTER_RPC_URL not set."); return ""; }
if (!rpcToken) { Logger.log("nextGlobalShipmentNumber_: MASTER_RPC_TOKEN not set."); return ""; }
var payload = { token: rpcToken, action: "getNextShipmentId" };
var options = {
method: "post",
contentType: "application/json",
payload: JSON.stringify(payload),
muteHttpExceptions: true
};
try {
var response = UrlFetchApp.fetch(rpcUrl, options);
var code = response.getResponseCode();
var body = response.getContentText();
if (code !== 200) {
Logger.log("nextGlobalShipmentNumber_: HTTP " + code + " -- " + body);
return "";
}
var result = JSON.parse(body);
if (result && result.success && result.shipmentNo) return result.shipmentNo;
Logger.log("nextGlobalShipmentNumber_: RPC error -- " + ((result && result.error) ? result.error : "unknown"));
return "";
} catch (err) {
Logger.log("nextGlobalShipmentNumber_: Network error - " + err);
return "";
}
}

/**
 * Fires when a shipment Status is set to "Received".
 * Sends SHIPMENT_RECEIVED email with items table.
 * @param {Spreadsheet} ss
 * @param {Sheet} shipSheet  The Shipments sheet
 * @param {Object} shipMap   Header map for Shipments
 * @param {number} row       The edited row
 */
function onShipmentReceived_(ss, shipSheet, shipMap, row) {
  var shipEmailEnabled = truthy_(getSetting_(ss, CI_SETTINGS_KEYS.ENABLE_SHIPMENT_EMAIL));
  if (!shipEmailEnabled) return;

  var notif = getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS);
    var clientEmailShip2 = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL);
    var allRecipShip2 = mergeEmails_(notif, clientEmailShip2);
    if (!allRecipShip2) return;

  // Validate required headers
  var reqHeaders = ["Shipment #", "Carrier", "Tracking #", "Receive Date"];
  for (var h = 0; h < reqHeaders.length; h++) {
    if (!shipMap[reqHeaders[h]]) {
      Logger.log("onShipmentReceived_: missing header " + reqHeaders[h]);
      return;
    }
  }

  var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME);
  var shipRow = shipSheet.getRange(row, 1, 1, shipSheet.getLastColumn()).getValues()[0];

  var shipNo = String(shipRow[shipMap["Shipment #"] - 1] || "");
  var carrier = String(shipRow[shipMap["Carrier"] - 1] || "-");
  var tracking = String(shipRow[shipMap["Tracking #"] - 1] || "-");

  var receivedDate = shipRow[shipMap["Receive Date"] - 1];
  if (receivedDate instanceof Date) {
    receivedDate = Utilities.formatDate(receivedDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
  } else if (receivedDate) {
    receivedDate = String(receivedDate).trim();
  } else {
    receivedDate = new Date().toISOString().slice(0, 10);
  }

  // Get items for this shipment from Inventory
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv) return;
  var mapInv = getHeaderMapAtRow_(inv, 1);
  var shipColInv = mapInv["Shipment #"];
  if (!shipColInv) return;

  var invData = inv.getDataRange().getValues();
  var itemRows = [];
  for (var i = 1; i < invData.length; i++) {
    if (String(invData[i][shipColInv - 1]) === shipNo) {
      itemRows.push(invData[i]);
    }
  }

  var itemCount = itemRows.length;
  var itemsTable = buildItemsHtmlTable_(mapInv, itemRows);

  var photosUrl = "";
    var shipNotesCol2 = shipMap["Shipment Notes"];
    var shipNotes2 = shipNotesCol2 ? String(shipRow[shipNotesCol2 - 1] || "") : "";
  if (shipMap["Shipment Photos URL"]) {
    photosUrl = String(shipRow[shipMap["Shipment Photos URL"] - 1] || "");
  }

  try {
    // v4.4.0 — include distinct Sidemarks across shipment items
    var _ship2Sidemarks = collectSidemarksFromRows_(mapInv, itemRows);
    sendTemplateEmail_(ss, "SHIPMENT_RECEIVED", allRecipShip2, {
      "{{SHIPMENT_NO}}": shipNo,
      "{{CLIENT_NAME}}": clientName || "Client",
      "{{CARRIER}}": carrier,
      "{{TRACKING}}": tracking,
      "{{RECEIVED_DATE}}": receivedDate,
      "{{ITEM_COUNT}}": String(itemCount),
      "{{PHOTOS_URL}}": photosUrl,
      "{{ITEMS_TABLE}}": itemsTable,
      "{{SHIPMENT_NOTES}}": shipNotes2 || "",
      "{{SIDEMARK}}": _ship2Sidemarks,
      "{{SIDEMARK_HEADER}}": buildSidemarkHeader_(_ship2Sidemarks),
      "{{APP_DEEP_LINK}}": "https://www.mystridehub.com/#/shipments?open=" + encodeURIComponent(shipNo) + "&client=" + encodeURIComponent(ss.getId())
    });
  } catch (err) {
    Logger.log("Failed to send SHIPMENT_RECEIVED email: " + err);
  }
}
function getFallbackTemplate_(templateKey, tokens) {
var t = tokens || {};
var plain = function(s) { return String(s || "-"); };
switch (templateKey) {
case "SHIPMENT_RECEIVED":
return {
subject: "Shipment Received: " + plain(t["{{SHIPMENT_NO}}"]),
htmlBody: "<p><b>Shipment Received</b></p>" +
"<p>Shipment #: " + plain(t["{{SHIPMENT_NO}}"]) + "<br>" +
"Items: " + plain(t["{{ITEM_COUNT}}"]) + "<br>" +
"Carrier: " + plain(t["{{CARRIER}}"]) + "<br>" +
"Tracking: " + plain(t["{{TRACKING}}"]) + "<br>" +
              "Received Date: " + plain(t["{{RECEIVED_DATE}}"]) + "<br>" +
              "Shipment Notes: " + (t["{{SHIPMENT_NOTES}}"] || "") + "<br>" +
"<a href=\"" + plain(t["{{PHOTOS_URL}}"]) + "\">Open Photos Folder</a></p>" +
"<p><small>Stride Logistics</small></p>"
};
case "INSP_EMAIL":
return {
subject: "Inspection Report - " + plain(t["{{CLIENT_NAME}}"]) + " - Item " + plain(t["{{ITEM_ID}}"]),
htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Inspection Report</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">Item ' + plain(t["{{ITEM_ID}}"]) + '</div><div style="color:#64748B;margin-bottom:16px">' + plain(t["{{CLIENT_NAME}}"]) + ' · Shipment ' + plain(t["{{SHIPMENT_NO}}"]) + '</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase;margin-bottom:8px">Inspection Result</div><div style="font-size:18px;font-weight:900;margin-bottom:8px"><span style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;background:' + plain(t["{{RESULT_COLOR}}"]) + ';color:#fff">' + plain(t["{{RESULT}}"]) + '</span></div>' + (t["{{ITEM_TABLE_HTML}}"] || "") + '<div style="color:#475569;margin-top:4px"><b>Notes:</b> ' + plain(t["{{TASK_NOTES}}"]) + '</div></div>' + (t["{{REPAIR_NOTE}}"] || "") + (t["{{PHOTOS_URL}}"] && t["{{PHOTOS_URL}}"] !== "#" && t["{{PHOTOS_URL}}"] !== "-" ? '<div style="margin:16px 0"><a href="' + plain(t["{{PHOTOS_URL}}"]) + '" style="display:inline-block;background:#E85D2D;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px">View Photos Folder</a></div>' : '') + '<div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
};
case "TASK_COMPLETE":
return {
subject: plain(t["{{SVC_NAME}}"]) + " Complete - " + plain(t["{{CLIENT_NAME}}"]) + " - Item " + plain(t["{{ITEM_ID}}"]),
htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Task Complete</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">' + plain(t["{{SVC_NAME}}"]) + ' — Item ' + plain(t["{{ITEM_ID}}"]) + '</div><div style="color:#64748B;margin-bottom:16px">' + plain(t["{{CLIENT_NAME}}"]) + ' · Shipment ' + plain(t["{{SHIPMENT_NO}}"]) + '</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Task Type</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{SVC_NAME}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Result</div><div style="font-size:14px;font-weight:800;color:#1E293B"><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;font-weight:700;background:' + plain(t["{{RESULT_COLOR}}"]) + ';color:#fff">' + plain(t["{{RESULT}}"]) + '</span></div></td></tr></table><div style="border-top:1px solid #E2E8F0;margin-top:12px;padding-top:10px;">' + (t["{{ITEM_TABLE_HTML}}"] || "") + '<div style="color:#475569;margin-top:4px"><b>Notes:</b> ' + plain(t["{{TASK_NOTES}}"]) + '</div></div></div>' + (t["{{PHOTOS_URL}}"] && t["{{PHOTOS_URL}}"] !== "#" && t["{{PHOTOS_URL}}"] !== "-" ? '<div style="margin:16px 0"><a href="' + plain(t["{{PHOTOS_URL}}"]) + '" style="display:inline-block;background:#E85D2D;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px">View Photos Folder</a></div>' : '') + '<div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
};
case "REPAIR_QUOTE":
return {
subject: "Repair Quote - " + plain(t["{{CLIENT_NAME}}"]) + " - Item " + plain(t["{{ITEM_ID}}"]),
htmlBody: "<p><b>Repair Quote</b></p>" +
"<p>Item: " + plain(t["{{ITEM_ID}}"]) + "<br>" +
"Task Notes: " + plain(t["{{TASK_NOTES}}"]) + "<br>" +
"Quote: $" + plain(t["{{QUOTE_AMOUNT}}"]) + "</p>" +
"<p>Please reply to approve or decline.</p>" +
"<p><small>Stride Logistics</small></p>"
};
    case "REPAIR_QUOTE_REQUEST":
      return {
        subject: "Repair Quote Requested: " + plain(t["{{ITEM_ID}}"]) + " - " + plain(t["{{CLIENT_NAME}}"]),
        htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Repair Quote Request</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">Repair Quote Requested — Item ' + plain(t["{{ITEM_ID}}"]) + '</div><div style="color:#64748B;margin-bottom:16px">A client has requested a repair quote. Please review and provide a quote.</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Client</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{CLIENT_NAME}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Location</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{LOCATION}}"]) + '</div></td><td style="vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Sidemark</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{SIDEMARK}}"]) + '</div></td></tr></table><div style="border-top:1px solid #E2E8F0;margin-top:12px;padding-top:10px;">' + (t["{{ITEM_TABLE_HTML}}"] || "") + '</div></div><div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
      };
case "REPAIR_COMPLETE":
return {
subject: "Repair Complete - " + plain(t["{{CLIENT_NAME}}"]) + " - Item " + plain(t["{{ITEM_ID}}"]),
htmlBody: "<p><b>Repair Complete</b></p>" +
"<p>Item: " + plain(t["{{ITEM_ID}}"]) + "<br>" +
"Task Notes: " + plain(t["{{TASK_NOTES}}"]) + "<br>" +
"Final Charge: $" + plain(t["{{FINAL_AMOUNT}}"]) + "</p>" +
"<p><small>Stride Logistics</small></p>"
};
case "WILL_CALL_CREATED":
return {
subject: "Will Call " + plain(t["{{WC_NUMBER}}"]) + " — Created — " + plain(t["{{CLIENT_NAME}}"]),
htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Will Call Created</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">Will Call ' + plain(t["{{WC_NUMBER}}"]) + '</div><div style="color:#64748B;margin-bottom:16px">A new will call has been created for ' + plain(t["{{CLIENT_NAME}}"]) + '.</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding-right:24px;vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Pickup Party</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{PICKUP_PARTY}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Phone</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{PICKUP_PHONE}}"]) + '</div></td><td style="vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Requested By</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{REQUESTED_BY}}"]) + '</div></td></tr><tr><td style="padding-right:24px;vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Est. Pickup Date</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{EST_PICKUP_DATE}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Status</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{STATUS}}"]) + '</div></td><td style="vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Items</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{ITEMS_COUNT}}"]) + '</div></td></tr><tr><td style="padding-right:24px;vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">COD</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{COD}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Total WC Fee</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{TOTAL_WC_FEE}}"]) + '</div></td><td style="vertical-align:top;padding-bottom:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Created By</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{CREATED_BY}}"]) + '</div></td></tr></table><div style="border-top:1px solid #E2E8F0;margin-top:12px;padding-top:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Notes</div><div style="font-size:13px;font-weight:600;color:#1E293B;margin-top:2px;">' + plain(t["{{NOTES}}"]) + '</div></div></div><div style="margin-top:16px"><p style="font-weight:600;margin-bottom:8px">Will Call Items:</p>' + (t["{{ITEMS_TABLE}}"] || "") + '</div><div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
};
case "WILL_CALL_RELEASE":
return {
subject: "Will Call " + plain(t["{{WC_NUMBER}}"]) + " — Items Released — " + plain(t["{{CLIENT_NAME}}"]),
htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Will Call Release</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">Will Call ' + plain(t["{{WC_NUMBER}}"]) + ' — Released</div><div style="color:#64748B;margin-bottom:16px">Items have been released for pickup.</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Client</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{CLIENT_NAME}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Pickup Party</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{PICKUP_PARTY}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Pickup Date</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{PICKUP_DATE}}"]) + '</div></td><td style="vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Items Released</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{ITEMS_COUNT}}"]) + '</div></td></tr></table><div style="border-top:1px solid #E2E8F0;margin-top:12px;padding-top:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Notes</div><div style="font-size:13px;font-weight:600;color:#1E293B;margin-top:2px;">' + plain(t["{{NOTES}}"]) + '</div></div></div>' + (t["{{PARTIAL_NOTE}}"] || "") + '<div style="margin-top:16px"><p style="font-weight:600;margin-bottom:8px">Released Items:</p>' + (t["{{ITEMS_TABLE}}"] || "") + '</div>' + (t["{{PHOTOS_URL}}"] && t["{{PHOTOS_URL}}"] !== "#" && t["{{PHOTOS_URL}}"] !== "-" ? '<div style="margin:16px 0"><a href="' + plain(t["{{PHOTOS_URL}}"]) + '" style="display:inline-block;background:#E85D2D;color:#fff;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:10px">Open Photos Folder</a></div>' : "") + '<div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
};
case "TRANSFER_RECEIVED":
return {
subject: "Items Transferred to " + plain(t["{{CLIENT_NAME}}"]) + " from " + plain(t["{{SOURCE_CLIENT_NAME}}"]),
htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Transfer Received</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">Items Transferred to ' + plain(t["{{CLIENT_NAME}}"]) + '</div><div style="color:#64748B;margin-bottom:16px">' + plain(t["{{ITEM_COUNT}}"]) + ' item(s) have been transferred to your account from ' + plain(t["{{SOURCE_CLIENT_NAME}}"]) + '.</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Items</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{ITEM_COUNT}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">From</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{SOURCE_CLIENT_NAME}}"]) + '</div></td><td style="vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Transfer Date</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{TRANSFER_DATE}}"]) + '</div></td></tr></table><div style="border-top:1px solid #E2E8F0;margin-top:12px;padding-top:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Transfer Notes</div><div style="font-size:13px;font-weight:600;color:#1E293B;margin-top:2px;">' + plain(t["{{TRANSFER_NOTES}}"]) + '</div></div></div><div style="margin-top:16px"><p style="font-weight:600;margin-bottom:8px">Items Transferred:</p>' + (t["{{ITEMS_TABLE}}"] || "") + '</div><div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
};
case "WILL_CALL_CANCELLED":
return {
subject: "Will Call " + plain(t["{{WC_NUMBER}}"]) + " — Cancelled — " + plain(t["{{CLIENT_NAME}}"]),
htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Will Call Cancelled</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">Will Call ' + plain(t["{{WC_NUMBER}}"]) + ' — Cancelled</div><div style="color:#64748B;margin-bottom:16px">This will call has been cancelled. Items remain in storage.</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Client</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{CLIENT_NAME}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Cancellation Date</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{CANCEL_DATE}}"]) + '</div></td><td style="vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Items</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{ITEMS_COUNT}}"]) + '</div></td></tr></table></div><div style="margin-top:16px"><p style="font-weight:600;margin-bottom:8px">Cancelled Items:</p>' + (t["{{ITEMS_TABLE}}"] || "") + '</div><div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
};
case "WILL_CALL_CREATED":
return {
subject: "Will Call " + plain(t["{{WC_NUMBER}}"]) + " — Created — " + plain(t["{{CLIENT_NAME}}"]),
htmlBody: '<div style="background:#F8FAFC;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;color:#ffffff;"><tr><td style="padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><img src="https://static.wixstatic.com/media/a38fbc_e4bdb945b21f4b9f8b10873799e8f8f1~mv2.png" alt="Stride Logo" style="height:34px;width:34px;display:block;border-radius:4px;object-fit:cover;" /></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.3px;color:#ffffff;white-space:nowrap;vertical-align:middle;">Stride Logistics</td><td style="width:6px;"></td><td style="font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#E85D2D;white-space:nowrap;vertical-align:middle;">WMS</td></tr></table></td><td style="padding:18px 22px;text-align:right;font-size:14px;font-weight:800;color:#ffffff;white-space:nowrap;">Will Call Created</td></tr></table><div style="padding:22px;color:#1E293B"><div style="font-size:20px;font-weight:900;margin-bottom:6px">Will Call ' + plain(t["{{WC_NUMBER}}"]) + '</div><div style="color:#64748B;margin-bottom:16px">A new will call has been created for ' + plain(t["{{CLIENT_NAME}}"]) + '.</div><div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:16px"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Status</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{STATUS}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Pickup Party</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{PICKUP_PARTY}}"]) + '</div></td><td style="padding-right:24px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Est. Pickup</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{EST_PICKUP_DATE}}"]) + '</div></td><td style="vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Items</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{ITEMS_COUNT}}"]) + '</div></td></tr><tr><td style="padding-right:24px;padding-top:12px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Requested By</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{REQUESTED_BY}}"]) + '</div></td><td style="padding-right:24px;padding-top:12px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">COD</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{COD}}"]) + '</div></td><td style="padding-right:24px;padding-top:12px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Total WC Fee</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{TOTAL_WC_FEE}}"]) + '</div></td><td style="padding-top:12px;vertical-align:top;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Created By</div><div style="font-size:14px;font-weight:800;color:#1E293B">' + plain(t["{{CREATED_BY}}"]) + '</div></td></tr></table><div style="border-top:1px solid #E2E8F0;margin-top:12px;padding-top:10px;"><div style="font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase">Notes</div><div style="font-size:13px;font-weight:600;color:#1E293B;margin-top:2px;">' + plain(t["{{NOTES}}"]) + '</div></div></div><div style="margin-top:16px"><p style="font-weight:600;margin-bottom:8px">Will Call Items:</p>' + (t["{{ITEMS_TABLE}}"] || "") + '</div><div style="color:#64748B;font-size:12px;border-top:1px solid #E2E8F0;margin-top:18px;padding-top:14px">Stride Logistics · Kent, WA · whse@stridenw.com</div></div></div></div>'
};
default:
return {
subject: "Stride Notification",
htmlBody: "<p>A Stride automation event occurred. Template key: " + templateKey + "</p>"
};
}
}
