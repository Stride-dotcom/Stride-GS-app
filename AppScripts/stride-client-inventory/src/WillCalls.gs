/* ===================================================
   WillCalls.gs — v4.5.0 — 2026-04-16 PST — Sidemark in WILL_CALL_CREATED / RELEASE emails
   v4.5.0: WILL_CALL_CREATED + WILL_CALL_RELEASE now emit {{SIDEMARK}} +
           {{SIDEMARK_HEADER}} tokens. Distinct Sidemarks collected by joining
           WC items to Inventory via Item ID (comma-joined when multiple
           projects are represented in one WC). Renders as a prominent chip
           near the top of the email so clients know which project to expect.
   v4.3.0: buildWcItemsEmailTable_ now renders Item ID / Vendor / Description / Reference.
           Class column removed; Vendor + Reference backfilled from Inventory via optional
           ss arg. Used by both WILL_CALL_CREATED and WILL_CALL_RELEASE (completed) emails.
   v4.2.0 — 2026-04-02 07:00 PM PST
   =================================================== */

/* ============================================================
   WILL CALL / OUTBOUND SHIPMENTS
   ============================================================ */

/**
 * Looks up the rate for a given service code and item class from Price_Cache.
 * Returns the numeric rate, or 0 if not found.
 */
function lookupRateByCodeAndClass_(ss, svcCode, itemClass) {
  if (!svcCode || !itemClass) return 0;
  try {
    var cache = ss.getSheetByName(CI3_SH.PRICECACHE);
    if (!cache || cache.getLastRow() < 2) return 0;
    var map = getHeaderMap_(cache);
    var data = cache.getRange(2, 1, cache.getLastRow() - 1, cache.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      var code = String(getCellByHeader_(data[i], map, "Service Code") || "").trim().toUpperCase();
      if (code === svcCode.toUpperCase()) {
        var colName = itemClass.toUpperCase() + " Rate";
        var val = getCellByHeaderRaw_(data[i], map, colName);
        return (val !== null && val !== "") ? (Number(val) || 0) : 0;
      }
    }
  } catch (e) { Logger.log("lookupRateByCodeAndClass_ error: " + e); }
  return 0;
}

/**
 * Generates a WC number from timestamp: WC-MMDDYYHHmmss
 */
function generateWcNumber_() {
  var now = new Date();
  return "WC-" + Utilities.formatDate(now, Session.getScriptTimeZone(), "MMddyyHHmmss");
}

/**
 * Creates a will call Drive folder inside Will Calls/ subfolder.
 * v4.1.0: Flat structure — uses getOrCreateEntitySubfolder_
 * Returns the folder URL or "" on failure.
 */
function createWillCallFolder_(ss, wcNumber) {
  try {
    var wcParent = getOrCreateEntitySubfolder_(ss, "Will Calls");
    if (!wcParent) return "";
    var it = wcParent.getFoldersByName(wcNumber);
    var folder = it.hasNext() ? it.next() : wcParent.createFolder(wcNumber);
    return folder.getUrl();
  } catch (err) {
    Logger.log("createWillCallFolder_ error: " + err);
    return "";
  }
}

/**
 * MENU ACTION: Create Will Call
 * User selects rows on Inventory tab, then runs this.
 * Shows a dialog to enter pickup details, creates the WC order.
 */
function StrideCreateWillCall() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var activeSheet = ss.getActiveSheet();

  if (activeSheet.getName() !== CI_SH.INVENTORY) {
    ui.alert("Select item rows on the Inventory tab first.");
    return;
  }

  // v2.7.1: Use getActiveRangeList() to support non-contiguous selections (Ctrl+click)
  var rangeList = ss.getActiveRangeList();
  if (!rangeList) {
    ui.alert("Select one or more item rows on the Inventory tab.");
    return;
  }
  var ranges = rangeList.getRanges();
  if (!ranges || !ranges.length || ranges[0].getRow() < 2) {
    ui.alert("Select one or more item rows on the Inventory tab.");
    return;
  }

  var invMap = getHeaderMap_(activeSheet);
  var itemIdCol = invMap["Item ID"];
  if (!itemIdCol) { ui.alert("Item ID column not found."); return; }

  // Collect selected items from all selected ranges (supports Ctrl+click multi-select)
  var selectedItems = [];
  var seenItemIds = {};

  for (var ri = 0; ri < ranges.length; ri++) {
    var range = ranges[ri];
    var startRow = range.getRow();
    var numRows = range.getNumRows();
    if (startRow < 2) continue;

    for (var i = 0; i < numRows; i++) {
      var row = startRow + i;
      var rowData = activeSheet.getRange(row, 1, 1, activeSheet.getLastColumn()).getValues()[0];
      var itemId = String(getCellByHeader_(rowData, invMap, "Item ID") || "").trim();
      var status = String(getCellByHeader_(rowData, invMap, "Status") || "").trim();
      if (!itemId) continue;
      if (seenItemIds[itemId]) continue; // skip duplicates from overlapping selections
      if (status === INVENTORY_STATUS.RELEASED) {
        ui.alert("Item " + itemId + " is already Released. Remove it from your selection.");
        return;
      }
      seenItemIds[itemId] = true;
      selectedItems.push({
        itemId: itemId,
        qty: getCellByHeader_(rowData, invMap, "Qty") || 1,
        vendor: getCellByHeader_(rowData, invMap, "Vendor") || "",
        description: getCellByHeader_(rowData, invMap, "Description") || "",
        itemClass: getCellByHeader_(rowData, invMap, "Class") || "",
        location: getCellByHeader_(rowData, invMap, "Location") || "",
        sidemark: getCellByHeader_(rowData, invMap, "Sidemark") || "",
        room: getCellByHeader_(rowData, invMap, "Room") || ""
      });
    }
  }

  if (!selectedItems.length) {
    ui.alert("No valid items selected.");
    return;
  }

  // Check for items already on active will calls
  var wcItemsSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  if (wcItemsSh && wcSh && wcItemsSh.getLastRow() >= 2 && wcSh.getLastRow() >= 2) {
    var wcData = wcSh.getDataRange().getValues();
    var wcHdrMap = {};
    wcData[0].forEach(function(h, idx) { wcHdrMap[String(h || "").trim()] = idx; });
    var activeWcNums = {};
    for (var w = 1; w < wcData.length; w++) {
      var wSt = String(wcData[w][wcHdrMap["Status"]] || "").trim();
      if (wSt === WC_STATUS.PENDING || wSt === WC_STATUS.SCHEDULED) {
        activeWcNums[String(wcData[w][wcHdrMap["WC Number"]] || "").trim()] = true;
      }
    }
    var wciData = wcItemsSh.getDataRange().getValues();
    var wciHdrMap = {};
    wciData[0].forEach(function(h, idx) { wciHdrMap[String(h || "").trim()] = idx; });
    for (var wi = 1; wi < wciData.length; wi++) {
      var wiWcNum = String(wciData[wi][wciHdrMap["WC Number"]] || "").trim();
      var wiItemId = String(wciData[wi][wciHdrMap["Item ID"]] || "").trim();
      if (activeWcNums[wiWcNum]) {
        for (var si = 0; si < selectedItems.length; si++) {
          if (selectedItems[si].itemId === wiItemId) {
            ui.alert("Item " + wiItemId + " is already on active will call " + wiWcNum + ".\nRemove it from your selection or cancel that will call first.");
            return;
          }
        }
      }
    }
  }

  // Calculate WC fees (with client discount)
  var totalFee = 0;
  for (var fi = 0; fi < selectedItems.length; fi++) {
    var fee = lookupRateByCodeAndClass_(ss, "WC", selectedItems[fi].itemClass);
    if (fee > 0) fee = applyClientDiscount_(ss, fee, "Whse Services");
    selectedItems[fi].wcFee = fee;
    totalFee += fee;
  }

  // Store selected items in script properties for the dialog callback
  PropertiesService.getScriptProperties().setProperty("WC_PENDING_ITEMS", JSON.stringify(selectedItems));
  PropertiesService.getScriptProperties().setProperty("WC_PENDING_TOTAL_FEE", String(totalFee));

  // Detect current user email (empty for non-Google / anonymous editors)
  var currentUserEmail = "";
  try { currentUserEmail = Session.getActiveUser().getEmail() || ""; } catch (e) { currentUserEmail = ""; }

  // Build dialog HTML
  var itemsListHtml = "";
  for (var di = 0; di < selectedItems.length; di++) {
    var it = selectedItems[di];
    itemsListHtml += '<tr>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + esc_(it.itemId) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + esc_(it.description) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + esc_(it.itemClass) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">$' + Number(it.wcFee).toFixed(2) + '</td>' +
      '</tr>';
  }

  var dialogHtml =
    '<style>' +
    'body{font-family:Arial,sans-serif;margin:16px;color:#1E293B;}' +
    'label{display:block;font-size:12px;font-weight:700;color:#64748B;margin-top:10px;margin-bottom:3px;}' +
    'input,textarea{width:100%;padding:6px 8px;border:1px solid #E2E8F0;border-radius:4px;font-size:13px;box-sizing:border-box;}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:12px;}' +
    'th{padding:4px 8px;font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase;border-bottom:2px solid #E2E8F0;text-align:left;}' +
    '.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;}' +
    'button{padding:8px 16px;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #E2E8F0;}' +
    '.btn-primary{background:#E85D2D;color:#fff;border-color:#E85D2D;}' +
    '.cod-row{display:none;margin-top:6px;}' +
    '#loadingOverlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.85);z-index:9999;justify-content:center;align-items:center;flex-direction:column;}' +
    '.spinner{width:40px;height:40px;border:4px solid #E2E8F0;border-top:4px solid #E85D2D;border-radius:50%;animation:spin 0.8s linear infinite;}' +
    '@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}' +
    '</style>' +
    '<div id="loadingOverlay"><div class="spinner"></div><div style="margin-top:12px;font-size:13px;font-weight:600;color:#64748B;">Creating Will Call...</div></div>' +
    '<div style="font-size:15px;font-weight:800;margin-bottom:10px;">Create Will Call — ' + selectedItems.length + ' item(s)</div>' +
    '<table><tr><th>Item ID</th><th>Description</th><th>Class</th><th>WC Fee</th></tr>' +
    itemsListHtml + '</table>' +
    '<div style="text-align:right;font-size:13px;font-weight:700;margin-bottom:12px;">Total WC Fee: $' + totalFee.toFixed(2) + '</div>' +
    '<label>Pickup Party / Release To *</label><input id="pickupParty" />' +
    '<label>Pickup Phone</label><input id="pickupPhone" />' +
    '<label>Requested By</label><input id="requestedBy" />' +
    '<label>Created By (your email)</label><input id="createdBy" value="' + esc_(currentUserEmail) + '" />' +
    '<label>Estimated Pickup Date</label><input id="estDate" type="date" />' +
    '<label>Notes</label><textarea id="notes" rows="2"></textarea>' +
    '<div style="margin-top:10px;">' +
    '<label style="display:inline;"><input type="checkbox" id="cod" onchange="document.getElementById(\'codRow\').style.display=this.checked?\'block\':\'none\'"> COD (Collect on Delivery)</label>' +
    '</div>' +
    '<div id="codRow" class="cod-row">' +
    '<label>COD Amount</label><input id="codAmount" type="number" step="0.01" value="' + totalFee.toFixed(2) + '" />' +
    '</div>' +
    '<div class="actions">' +
    '<button onclick="google.script.host.close()">Cancel</button>' +
    '<button class="btn-primary" onclick="submitWC()">Create Will Call</button>' +
    '</div>' +
    '<script>' +
    'function submitWC(){' +
    'var btn=document.querySelector(".btn-primary");if(btn.disabled)return;btn.disabled=true;btn.textContent="Creating...";' +
    'var pp=document.getElementById("pickupParty").value.trim();' +
    'if(!pp){alert("Pickup Party is required.");btn.disabled=false;btn.textContent="Create Will Call";return;}' +
    'document.getElementById("loadingOverlay").style.display="flex";' +
    'var data={' +
    'pickupParty:pp,' +
    'pickupPhone:document.getElementById("pickupPhone").value.trim(),' +
    'requestedBy:document.getElementById("requestedBy").value.trim(),' +
    'createdBy:document.getElementById("createdBy").value.trim(),' +
    'estDate:document.getElementById("estDate").value,' +
    'notes:document.getElementById("notes").value.trim(),' +
    'cod:document.getElementById("cod").checked,' +
    'codAmount:document.getElementById("codAmount").value' +
    '};' +
    'google.script.run.withSuccessHandler(function(){google.script.host.close();}).withFailureHandler(function(e){document.getElementById("loadingOverlay").style.display="none";btn.disabled=false;btn.textContent="Create Will Call";alert("Error: "+e.message);}).StrideCreateWillCallCallback(data);' +
    '}' +
    '</script>';

  var output = HtmlService.createHtmlOutput(dialogHtml)
    .setWidth(520)
    .setHeight(580);
  ui.showModalDialog(output, "Create Will Call");
}

/**
 * Callback from Create Will Call dialog. Creates the WC order, items, folder, and PDF.
 */
function StrideCreateWillCallCallback(formData) {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  var items = JSON.parse(props.getProperty("WC_PENDING_ITEMS") || "[]");
  var totalFee = Number(props.getProperty("WC_PENDING_TOTAL_FEE") || "0");
  props.deleteProperty("WC_PENDING_ITEMS");
  props.deleteProperty("WC_PENDING_TOTAL_FEE");

  if (!items.length) return; // Already processed or no items — exit silently

  var wcNumber = generateWcNumber_();
  var now = new Date();
  var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";

  // Create Drive folder
  var folderUrl = createWillCallFolder_(ss, wcNumber);

  // Determine initial status
  var status = WC_STATUS.PENDING;
  if (formData.estDate) status = WC_STATUS.SCHEDULED;

  var isCod = formData.cod === true || formData.cod === "true";
  // v2.6.5: Allow COD Amount of 0 (waived fees) — only fall back to totalFee if codAmount is blank/undefined
  var codAmtRaw = formData.codAmount;
  var codAmount = isCod ? (codAmtRaw !== "" && codAmtRaw !== null && codAmtRaw !== undefined ? Number(codAmtRaw) : totalFee) : 0;

  // Write to Will_Calls sheet
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  if (!wcSh) { wcSh = ensureSheet_(ss, CI_SH.WILL_CALLS); writeHeaders_(wcSh, WILL_CALL_HEADERS); }
  var wcMap = getHeaderMap_(wcSh);
  var wcRowValues = buildRowFromMap_(wcMap, {
    "WC Number": wcNumber,
    "Status": status,
    "Created Date": now,
    "Created By": formData.createdBy || "",
    "Pickup Party": formData.pickupParty || "",
    "Pickup Phone": formData.pickupPhone || "",
    "Requested By": formData.requestedBy || "",
    "Estimated Pickup Date": formData.estDate || "",
    "Actual Pickup Date": "",
    "Notes": formData.notes || "",
    "COD": isCod,
    "COD Amount": isCod ? codAmount : "",
    "Items Count": items.length,
    // v2.7.0: When COD is set with a custom amount, Total WC Fee reflects the COD amount
    "Total WC Fee": (isCod && codAmount !== totalFee) ? codAmount : totalFee
  });
  var wcInsertRow = getLastDataRow_(wcSh) + 1;
  wcSh.getRange(wcInsertRow, 1, 1, wcRowValues.length).setValues([wcRowValues]);

  // Set WC Number as hyperlink to folder
  if (folderUrl) {
    var wcNumCol = wcMap["WC Number"];
    if (wcNumCol) {
      var richText = SpreadsheetApp.newRichTextValue()
        .setText(wcNumber)
        .setLinkUrl(folderUrl)
        .build();
      wcSh.getRange(wcInsertRow, wcNumCol).setRichTextValue(richText);
    }
  }

  // Write to WC_Items sheet
  var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  if (!wciSh) { wciSh = ensureSheet_(ss, CI_SH.WC_ITEMS); writeHeaders_(wciSh, WC_ITEMS_HEADERS); }
  var wciMap = getHeaderMap_(wciSh);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var wciRow = buildRowFromMap_(wciMap, {
      "WC Number": wcNumber,
      "Item ID": it.itemId,
      "Qty": it.qty || 1,
      "Vendor": it.vendor || "",
      "Description": it.description || "",
      "Class": it.itemClass || "",
      "Location": it.location || "",
      "Sidemark": it.sidemark || "",
      "Room": it.room || "",
      "WC Fee": it.wcFee || 0,
      "Status": WC_STATUS.PENDING
    });
    var wciInsertRow = getLastDataRow_(wciSh) + 1;
    wciSh.getRange(wciInsertRow, 1, 1, wciRow.length).setValues([wciRow]);
    // v2.6.5: Hyperlink WC Number on WC_Items to match Will_Calls
    var wciWcCol = wciMap["WC Number"];
    if (wciWcCol && folderUrl) {
      var wciRt = SpreadsheetApp.newRichTextValue()
        .setText(wcNumber)
        .setLinkUrl(folderUrl)
        .build();
      wciSh.getRange(wciInsertRow, wciWcCol).setRichTextValue(wciRt);
    }
  }

  // PDF generation deferred to release time (v29.5.0) — items may change before pickup

  // v2.6.3: Send WILL_CALL_CREATED email notification
  try {
    var notif = getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS) || "";
    var clientEmail = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL) || "";
    var allRecipWcc = mergeEmails_(notif, clientEmail);
    if (allRecipWcc) {
      var wccItems = items.map(function(it) {
        return { itemId: it.itemId, description: it.description || "", itemClass: it.itemClass || "" };
      });
      // v4.4.0 — collect distinct Sidemarks across WC items (from Inventory)
      var _wccSidemarks = "";
      try {
        var _wccInv = ss.getSheetByName(CI_SH.INVENTORY);
        if (_wccInv && _wccInv.getLastRow() >= 2) {
          var _wccMapInv = getHeaderMapAtRow_(_wccInv, 1);
          var _wccItemIdCol = _wccMapInv["Item ID"];
          var _wccSmCol = _wccMapInv["Sidemark"];
          if (_wccItemIdCol && _wccSmCol) {
            var _wccData = _wccInv.getDataRange().getValues();
            var _wccIds = {};
            items.forEach(function(it) { if (it.itemId) _wccIds[String(it.itemId).trim()] = true; });
            var _wccSeen = {}; var _wccOut = [];
            for (var _wi = 1; _wi < _wccData.length; _wi++) {
              var _wid = String(_wccData[_wi][_wccItemIdCol - 1] || "").trim();
              if (!_wid || !_wccIds[_wid]) continue;
              var _wsm = String(_wccData[_wi][_wccSmCol - 1] || "").trim();
              if (_wsm && !_wccSeen[_wsm]) { _wccSeen[_wsm] = true; _wccOut.push(_wsm); }
            }
            _wccSidemarks = _wccOut.join(", ");
          }
        }
      } catch (_wccSmErr) { Logger.log("WC_CREATED sidemark collection non-fatal: " + _wccSmErr); }
      sendTemplateEmail_(ss, "WILL_CALL_CREATED", allRecipWcc, {
        "{{WC_NUMBER}}": wcNumber,
        "{{CLIENT_NAME}}": clientName,
        "{{PICKUP_PARTY}}": formData.pickupParty || "",
        "{{PICKUP_PHONE}}": formData.pickupPhone || "",
        "{{REQUESTED_BY}}": formData.requestedBy || "",
        "{{EST_PICKUP_DATE}}": formData.estDate || "Not scheduled",
        "{{NOTES}}": formData.notes || "",
        "{{ITEMS_TABLE}}": buildWcItemsEmailTable_(wccItems, ss),
        "{{ITEMS_COUNT}}": String(items.length),
        "{{TOTAL_WC_FEE}}": formatCurrency_(totalFee),
        "{{STATUS}}": status,
        "{{COD}}": isCod ? "Yes — " + formatCurrency_(codAmount) : "No",
        "{{CREATED_DATE}}": Utilities.formatDate(now, Session.getScriptTimeZone(), "MM/dd/yyyy"),
        "{{CREATED_BY}}": formData.createdBy || "",
        "{{PHOTOS_URL}}": folderUrl || "",
        "{{SIDEMARK}}": _wccSidemarks,
        "{{SIDEMARK_HEADER}}": buildSidemarkHeader_(_wccSidemarks),
        "__PDF_FOLDER_URL__": folderUrl || "",
        "{{APP_DEEP_LINK}}": "https://www.mystridehub.com/#/will-calls/" + encodeURIComponent(wcNumber)
      });
    }
  } catch (emailErr) {
    Logger.log("Will call created email error: " + emailErr);
  }

  SpreadsheetApp.getActive().toast("Will call " + wcNumber + " created with " + items.length + " item(s).", "Will Call Created", 5);
}

/**
 * MENU ACTION: Process Release
 * Staff checks items on WC_Items, then runs this to release them.
 */
function StrideProcessRelease() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);

  if (!wciSh || !wcSh) {
    ui.alert("Will_Calls or WC_Items sheet not found. Run Update Headers first.");
    return;
  }

  // v2.6.4: Must be on Will_Calls sheet
  var activeSheet = ss.getActiveSheet();
  if (activeSheet.getName() !== CI_SH.WILL_CALLS) {
    ui.alert("Select a will call row on the Will_Calls tab, then run Process Release.");
    return;
  }

  // Get WC number from selected row
  var wcMap = getHeaderMap_(wcSh);
  var wcNumCol = wcMap["WC Number"];
  var selRow = ss.getActiveRange().getRow();
  if (selRow < 2 || !wcNumCol) {
    ui.alert("Select a will call row on the Will_Calls tab.");
    return;
  }
  var wcNumber = String(wcSh.getRange(selRow, wcNumCol).getValue() || "").trim();
  if (!wcNumber) { ui.alert("Could not determine the Will Call number."); return; }

  // Verify WC status
  var wcMap2 = getHeaderMap_(wcSh);
  var wcData = wcSh.getDataRange().getValues();
  var wcRow = selRow;
  var currentStatus = String(wcData[wcRow - 1][wcMap2["Status"] - 1] || "").trim();
  if (currentStatus === WC_STATUS.RELEASED) { ui.alert("This will call is already fully released."); return; }
  if (currentStatus === WC_STATUS.CANCELLED) { ui.alert("This will call has been cancelled."); return; }

  // Get WC folder URL
  var folderUrl = "";
  if (wcNumCol) {
    var wcRt = wcSh.getRange(wcRow, wcNumCol).getRichTextValue();
    if (wcRt) folderUrl = wcRt.getLinkUrl() || "";
  }

  // Load unreleased items from WC_Items
  var wciMap2 = getHeaderMap_(wciSh);
  var wciData = wciSh.getDataRange().getValues();
  var allItems = [];
  var wciStatusCol = wciMap2["Status"];

  for (var wi = 1; wi < wciData.length; wi++) {
    if (String(wciData[wi][wciMap2["WC Number"] - 1] || "").trim() !== wcNumber) continue;
    var itemStatus = wciStatusCol ? String(wciData[wi][wciStatusCol - 1] || "").trim() : "";
    if (itemStatus === WC_STATUS.RELEASED) continue; // skip already released items
    allItems.push({
      row: wi + 1,
      itemId: String(wciData[wi][wciMap2["Item ID"] - 1] || "").trim(),
      wcFee: Number(wciData[wi][wciMap2["WC Fee"] - 1] || 0),
      itemClass: String(wciData[wi][wciMap2["Class"] - 1] || "").trim(),
      description: String(wciData[wi][wciMap2["Description"] - 1] || "").trim(),
      location: wciMap2["Location"] ? String(wciData[wi][wciMap2["Location"] - 1] || "").trim() : "",
      vendor: wciMap2["Vendor"] ? String(wciData[wi][wciMap2["Vendor"] - 1] || "").trim() : ""
    });
  }

  if (!allItems.length) { ui.alert("No unreleased items found for " + wcNumber + "."); return; }

  // Store items for the dialog callback
  PropertiesService.getScriptProperties().setProperty("WC_RELEASE_ITEMS", JSON.stringify(allItems));
  PropertiesService.getScriptProperties().setProperty("WC_RELEASE_NUMBER", wcNumber);
  PropertiesService.getScriptProperties().setProperty("WC_RELEASE_ROW", String(wcRow));

  // v2.6.4: Show dialog with item checkboxes for partial release
  // v4.0.3: Get COD amount from will call row
  var codAmountVal = wcMap2["COD Amount"] ? wcData[wcRow - 1][wcMap2["COD Amount"] - 1] : "";
  var codAmount = Number(codAmountVal || 0);

  var itemRows = "";
  for (var di = 0; di < allItems.length; di++) {
    itemRows += '<tr>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;text-align:center;">' +
        '<input type="checkbox" class="release-cb" data-idx="' + di + '" checked />' +
      '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:600;">' + esc_(allItems[di].itemId) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + esc_(allItems[di].location) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + esc_(allItems[di].vendor) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;">' + esc_(allItems[di].description) + '</td>' +
      '<td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:right;">$' + Number(allItems[di].wcFee).toFixed(2) + '</td>' +
      '</tr>';
  }

  var dialogHtml =
    '<style>' +
    'body{font-family:Arial,sans-serif;margin:16px;color:#1E293B;}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:12px;}' +
    'th{padding:4px 8px;font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase;border-bottom:2px solid #E2E8F0;text-align:left;}' +
    '.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;}' +
    'button{padding:8px 16px;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #E2E8F0;}' +
    '.btn-primary{background:#E85D2D;color:#fff;border-color:#E85D2D;}' +
    '.btn-select{padding:4px 10px;font-size:11px;margin-right:8px;background:#F1F5F9;}' +
    '#loadingOverlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.85);z-index:9999;justify-content:center;align-items:center;flex-direction:column;}' +
    '.spinner{width:40px;height:40px;border:4px solid #E2E8F0;border-top:4px solid #E85D2D;border-radius:50%;animation:spin 0.8s linear infinite;}' +
    '@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}' +
    '</style>' +
    '<div id="loadingOverlay"><div class="spinner"></div><div style="margin-top:12px;font-size:13px;font-weight:600;color:#64748B;">Processing Release...</div></div>' +
    '<div style="font-size:15px;font-weight:800;margin-bottom:4px;">Complete Will Call — ' + esc_(wcNumber) + '</div>' +
    '<div style="font-size:12px;color:#64748B;margin-bottom:6px;">Uncheck items for partial release. Remaining items will be moved to a new will call.</div>' +
    (codAmount > 0 ? '<div style="font-size:13px;font-weight:700;color:#E85D2D;margin-bottom:10px;">COD Amount: $' + codAmount.toFixed(2) + '</div>' : '') +
    '<div style="margin-bottom:8px;">' +
    '<button class="btn-select" onclick="toggleAll(true)">Select All</button>' +
    '<button class="btn-select" onclick="toggleAll(false)">Deselect All</button>' +
    '</div>' +
    '<table><tr><th style="text-align:center;width:40px;">Release</th><th>Item ID</th><th>Location</th><th>Vendor</th><th>Description</th><th style="text-align:right;">WC Fee</th></tr>' +
    itemRows + '</table>' +
    '<div id="summary" style="text-align:right;font-size:13px;font-weight:700;margin-bottom:12px;"></div>' +
    '<div class="actions">' +
    '<button onclick="google.script.host.close()">Cancel</button>' +
    '<button class="btn-primary" id="releaseBtn" onclick="submitRelease()">Release Selected</button>' +
    '</div>' +
    '<script>' +
    'function toggleAll(checked){var cbs=document.querySelectorAll(".release-cb");for(var i=0;i<cbs.length;i++)cbs[i].checked=checked;updateSummary();}' +
    'function updateSummary(){var cbs=document.querySelectorAll(".release-cb");var count=0;for(var i=0;i<cbs.length;i++)if(cbs[i].checked)count++;' +
    'document.getElementById("summary").textContent=count+" of "+cbs.length+" item(s) selected for release";}' +
    'document.querySelectorAll(".release-cb").forEach(function(cb){cb.addEventListener("change",updateSummary);});updateSummary();' +
    'function submitRelease(){' +
    'var btn=document.getElementById("releaseBtn");if(btn.disabled)return;btn.disabled=true;btn.textContent="Processing...";' +
    'var cbs=document.querySelectorAll(".release-cb");var selected=[];' +
    'for(var i=0;i<cbs.length;i++){if(cbs[i].checked)selected.push(parseInt(cbs[i].getAttribute("data-idx")));}' +
    'if(!selected.length){alert("Select at least one item to release.");btn.disabled=false;btn.textContent="Release Selected";return;}' +
    'document.getElementById("loadingOverlay").style.display="flex";' +
    'google.script.run.withSuccessHandler(function(){google.script.host.close();}).withFailureHandler(function(e){document.getElementById("loadingOverlay").style.display="none";btn.disabled=false;btn.textContent="Release Selected";alert("Error: "+e.message);}).StrideProcessReleaseCallback(selected);' +
    '}' +
    '</script>';

  var output = HtmlService.createHtmlOutput(dialogHtml).setWidth(560).setHeight(450);
  ui.showModalDialog(output, "Complete Will Call");
}

/**
 * Callback from Release dialog. Processes release for selected item indices.
 */
function StrideProcessReleaseCallback(selectedIndices) {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  var allItems = JSON.parse(props.getProperty("WC_RELEASE_ITEMS") || "[]");
  var wcNumber = props.getProperty("WC_RELEASE_NUMBER") || "";
  var wcRow = Number(props.getProperty("WC_RELEASE_ROW") || "0");
  props.deleteProperty("WC_RELEASE_ITEMS");
  props.deleteProperty("WC_RELEASE_NUMBER");
  props.deleteProperty("WC_RELEASE_ROW");

  if (!allItems.length || !wcNumber || !wcRow) return;

  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  var wcMap2 = getHeaderMap_(wcSh);
  var wciMap2 = getHeaderMap_(wciSh);
  var wcData = wcSh.getDataRange().getValues();

  // Split items into releasing vs remaining
  var releasingItems = [];
  var uncheckedItems = [];
  for (var i = 0; i < allItems.length; i++) {
    if (selectedIndices.indexOf(i) !== -1) {
      releasingItems.push(allItems[i]);
    } else {
      uncheckedItems.push(allItems[i]);
    }
  }

  var isPartial = uncheckedItems.length > 0;
  var totalCount = allItems.length;
  var releaseCount = releasingItems.length;
  var now = new Date();
  var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
  var isCod = truthy_(wcData[wcRow - 1][wcMap2["COD"] - 1]);

  // Get WC folder URL
  var folderUrl = "";
  var wcNumCol = wcMap2["WC Number"];
  if (wcNumCol) {
    var wcRt = wcSh.getRange(wcRow, wcNumCol).getRichTextValue();
    if (wcRt) folderUrl = wcRt.getLinkUrl() || "";
  }

  // 1. Set release date on Inventory for each released item
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  var invMap = getHeaderMap_(inv);
  var releaseDateCol = invMap["Release Date"];
  var invItemIdCol = invMap["Item ID"];
  if (inv && releaseDateCol && invItemIdCol) {
    var invData = inv.getRange(2, 1, inv.getLastRow() - 1, inv.getLastColumn()).getValues();
    for (var ri = 0; ri < releasingItems.length; ri++) {
      for (var ir = 0; ir < invData.length; ir++) {
        if (String(invData[ir][invItemIdCol - 1] || "").trim() === releasingItems[ri].itemId) {
          inv.getRange(ir + 2, releaseDateCol).setValue(now);
          var invStatusCol = invMap["Status"];
          if (invStatusCol) inv.getRange(ir + 2, invStatusCol).setValue(INVENTORY_STATUS.RELEASED);
          break;
        }
      }
    }
  }

  // 2. Create billing entries (if NOT COD)
  if (!isCod) {
    for (var bi = 0; bi < releasingItems.length; bi++) {
      var bItem = releasingItems[bi];
      writeBillingRow_({
        status: "Unbilled",
        invoiceNo: "",
        client: clientName,
        date: now,
        svcCode: "WC",
        svcName: lookupSvcNameByCode_(ss, "WC") || "Will Call",
        category: "Whse Services",
        itemId: bItem.itemId,
        description: bItem.description,
        itemClass: bItem.itemClass,
        qty: 1,
        rate: bItem.wcFee,
        total: bItem.wcFee,
        taskId: "",
        repairId: "",
        shipNo: wcNumber,
        notes: "",
        photosUrl: folderUrl || ""
      });
    }
  }

  // 2b. Update WC_Items status to Released
  var wciStatusCol = wciMap2["Status"];
  if (wciStatusCol) {
    for (var rmi = 0; rmi < releasingItems.length; rmi++) {
      wciSh.getRange(releasingItems[rmi].row, wciStatusCol).setValue(WC_STATUS.RELEASED);
    }
  }

  // 3. Update Will_Calls row
  var actualDateCol = wcMap2["Actual Pickup Date"];
  if (actualDateCol) wcSh.getRange(wcRow, actualDateCol).setValue(now);
  var wcStatusCol = wcMap2["Status"];

  if (isPartial) {
    // Set original to Partial
    if (wcStatusCol) wcSh.getRange(wcRow, wcStatusCol).setValue(WC_STATUS.PARTIAL);

    // Create new will call for remaining items
    var newWcNumber = generateWcNumber_();
    var newFolderUrl = createWillCallFolder_(ss, newWcNumber);
    var pickupParty = String(wcData[wcRow - 1][wcMap2["Pickup Party"] - 1] || "");
    var pickupPhone = String(wcData[wcRow - 1][wcMap2["Pickup Phone"] - 1] || "");
    var requestedBy = String(wcData[wcRow - 1][wcMap2["Requested By"] - 1] || "");
    var notes = String(wcData[wcRow - 1][wcMap2["Notes"] - 1] || "");
    var estDate = wcData[wcRow - 1][wcMap2["Estimated Pickup Date"] - 1] || "";

    // Recalculate remaining fee
    var remainingFee = 0;
    for (var uf = 0; uf < uncheckedItems.length; uf++) remainingFee += uncheckedItems[uf].wcFee;

    var newWcRow = buildRowFromMap_(wcMap2, {
      "WC Number": newWcNumber,
      "Status": estDate ? WC_STATUS.SCHEDULED : WC_STATUS.PENDING,
      "Created Date": now,
      "Pickup Party": pickupParty,
      "Pickup Phone": pickupPhone,
      "Requested By": requestedBy,
      "Estimated Pickup Date": estDate,
      "Actual Pickup Date": "",
      "Notes": notes + (notes ? " | " : "") + "Remaining items from " + wcNumber,
      "COD": isCod,
      "COD Amount": isCod ? remainingFee : "",
      "Items Count": uncheckedItems.length,
      "Total WC Fee": remainingFee
    });
    var newInsRow = getLastDataRow_(wcSh) + 1;
    wcSh.getRange(newInsRow, 1, 1, newWcRow.length).setValues([newWcRow]);

    if (newFolderUrl && wcMap2["WC Number"]) {
      var rtNew = SpreadsheetApp.newRichTextValue().setText(newWcNumber).setLinkUrl(newFolderUrl).build();
      wcSh.getRange(newInsRow, wcMap2["WC Number"]).setRichTextValue(rtNew);
    }

    // Move unchecked items to new WC and reset status
    for (var mi = 0; mi < uncheckedItems.length; mi++) {
      wciSh.getRange(uncheckedItems[mi].row, wciMap2["WC Number"]).setValue(newWcNumber);
      if (wciStatusCol) wciSh.getRange(uncheckedItems[mi].row, wciStatusCol).setValue(WC_STATUS.PENDING);
    }

    // Update items count on original
    var itemsCountCol = wcMap2["Items Count"];
    if (itemsCountCol) wcSh.getRange(wcRow, itemsCountCol).setValue(releaseCount);

    try { generateWillCallReleasePdf_(ss, newWcNumber, newFolderUrl); } catch (e) { Logger.log("New WC PDF error: " + e); }

  } else {
    if (wcStatusCol) wcSh.getRange(wcRow, wcStatusCol).setValue(WC_STATUS.RELEASED);
  }

  // 5. Generate release PDF (before email so we can attach it)
  var wcPdfBlob = null;
  try { wcPdfBlob = generateWillCallReleasePdf_(ss, wcNumber, folderUrl); } catch (e) { Logger.log("WC release PDF error: " + e); }

  // 4. Send release email
  try {
    var notif = getSetting_(ss, CI_SETTINGS_KEYS.NOTIFICATION_EMAILS);
    var clientEmail = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_EMAIL);
    var allRecip = mergeEmails_(notif, clientEmail);

    var emailItemsTable = buildWcItemsEmailTable_(releasingItems, ss);
    var wcFolderUrl = folderUrl;

    var partialNote = "";
    if (isPartial) {
      partialNote = '<div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:14px;margin-bottom:16px;font-size:13px;color:#9A3412;font-weight:600;">' +
        uncheckedItems.length + ' item(s) remain on new will call ' + esc_(newWcNumber) + '.</div>';
    }

    if (allRecip) {
      // v4.4.0 — collect distinct Sidemarks across items being released
      var _wcrSidemarks = "";
      try {
        var _wcrInv = ss.getSheetByName(CI_SH.INVENTORY);
        if (_wcrInv && _wcrInv.getLastRow() >= 2) {
          var _wcrMapInv = getHeaderMapAtRow_(_wcrInv, 1);
          var _wcrItemIdCol = _wcrMapInv["Item ID"];
          var _wcrSmCol = _wcrMapInv["Sidemark"];
          if (_wcrItemIdCol && _wcrSmCol) {
            var _wcrInvData = _wcrInv.getDataRange().getValues();
            var _wcrIds = {};
            releasingItems.forEach(function(it) { if (it && it.itemId) _wcrIds[String(it.itemId).trim()] = true; });
            var _wcrSeen = {}; var _wcrOut = [];
            for (var _wri = 1; _wri < _wcrInvData.length; _wri++) {
              var _wrid = String(_wcrInvData[_wri][_wcrItemIdCol - 1] || "").trim();
              if (!_wrid || !_wcrIds[_wrid]) continue;
              var _wrsm = String(_wcrInvData[_wri][_wcrSmCol - 1] || "").trim();
              if (_wrsm && !_wcrSeen[_wrsm]) { _wcrSeen[_wrsm] = true; _wcrOut.push(_wrsm); }
            }
            _wcrSidemarks = _wcrOut.join(", ");
          }
        }
      } catch (_wcrSmErr) { Logger.log("WC_RELEASE sidemark collection non-fatal: " + _wcrSmErr); }
      sendTemplateEmail_(ss, "WILL_CALL_RELEASE", allRecip, {
        "{{WC_NUMBER}}": wcNumber,
        "{{CLIENT_NAME}}": clientName,
        "{{PICKUP_PARTY}}": String(wcData[wcRow - 1][wcMap2["Pickup Party"] - 1] || ""),
        "{{PICKUP_DATE}}": Utilities.formatDate(now, Session.getScriptTimeZone(), "MM/dd/yyyy"),
        "{{ITEMS_TABLE}}": emailItemsTable,
        "{{ITEMS_COUNT}}": String(releaseCount),
        "{{PHOTOS_URL}}": wcFolderUrl,
        "{{PARTIAL_NOTE}}": partialNote,
        "{{NOTES}}": String(wcData[wcRow - 1][wcMap2["Notes"] - 1] || ""),
        "{{SIDEMARK}}": _wcrSidemarks,
        "{{SIDEMARK_HEADER}}": buildSidemarkHeader_(_wcrSidemarks),
        "{{APP_DEEP_LINK}}": "https://www.mystridehub.com/#/will-calls/" + encodeURIComponent(wcNumber)
      }, wcPdfBlob);
    }
  } catch (emailErr) {
    Logger.log("Will call release email error: " + emailErr);
  }

  var toastMsg = isPartial
    ? releaseCount + " of " + totalCount + " items released. New will call " + newWcNumber + " created for remaining " + uncheckedItems.length + " item(s)."
    : releaseCount + " item(s) released on " + wcNumber + ".";
  SpreadsheetApp.getActive().toast(toastMsg, "Release Processed", 7);
}

/**
 * Builds an HTML table of WC items for email notifications.
 */
/**
 * Build the items table HTML for WC Created / Completed / Release emails.
 * Columns (v4.7.0): Item ID, Vendor, Description, Reference.
 * Previously: Item ID, Description, Class (Class replaced with Vendor + Reference).
 *
 * @param {Array<{itemId,description,vendor?,itemClass?}>} items
 * @param {Spreadsheet} [ss]  Optional — when provided, missing vendor/reference
 *                            are backfilled from the Inventory sheet per Item ID.
 */
function buildWcItemsEmailTable_(items, ss) {
  // Build one-shot lookup from Inventory for vendor + reference backfill.
  var invLookup = {};
  try {
    if (ss) {
      var invSh = ss.getSheetByName(CI_SH.INVENTORY);
      if (invSh && invSh.getLastRow() >= 2) {
        var invMap = getHeaderMap_(invSh);
        var invItemCol = invMap["Item ID"];
        var invVendorCol = invMap["Vendor"];
        var invRefCol = invMap["Reference"];
        if (invItemCol) {
          var invData = invSh.getRange(2, 1, invSh.getLastRow() - 1, invSh.getLastColumn()).getValues();
          for (var k = 0; k < invData.length; k++) {
            var iid = String(invData[k][invItemCol - 1] || "").trim();
            if (!iid) continue;
            invLookup[iid] = {
              vendor: invVendorCol ? String(invData[k][invVendorCol - 1] || "").trim() : "",
              reference: invRefCol ? String(invData[k][invRefCol - 1] || "").trim() : ""
            };
          }
        }
      }
    }
  } catch (e) { /* Inventory missing / malformed — emit empty values rather than throw */ }

  var thStyle = 'padding:6px 8px;font-size:11px;color:#64748B;font-weight:800;text-transform:uppercase;border-bottom:2px solid #E2E8F0;text-align:left;';
  var tdStyle = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;';
  var html = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">' +
    '<tr>' +
      '<th style="' + thStyle + '">Item ID</th>' +
      '<th style="' + thStyle + '">Vendor</th>' +
      '<th style="' + thStyle + '">Description</th>' +
      '<th style="' + thStyle + '">Reference</th>' +
    '</tr>';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var inv = invLookup[String(it.itemId || "").trim()] || {};
    var vendor = it.vendor || inv.vendor || "";
    var reference = it.reference || inv.reference || "";
    html += '<tr>' +
      '<td style="' + tdStyle + 'font-weight:600;">' + esc_(it.itemId) + '</td>' +
      '<td style="' + tdStyle + '">' + esc_(vendor) + '</td>' +
      '<td style="' + tdStyle + '">' + esc_(it.description) + '</td>' +
      '<td style="' + tdStyle + '">' + esc_(reference) + '</td>' +
      '</tr>';
  }
  html += '</table>';
  return html;
}

/**
 * MENU ACTION: Regenerate Will Call Doc
 * Regenerates the release document PDF for the selected will call.
 */
function StrideRegenerateWillCallDoc() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var activeSheet = ss.getActiveSheet();
  var sheetName = activeSheet.getName();

  if (sheetName !== CI_SH.WILL_CALLS && sheetName !== CI_SH.WC_ITEMS) {
    ui.alert("Select a row on the Will_Calls or WC_Items tab first.");
    return;
  }

  var wcNumber = "";
  var map = getHeaderMap_(activeSheet);
  var wcNumCol = map["WC Number"];
  if (wcNumCol && ss.getActiveRange().getRow() >= 2) {
    wcNumber = String(activeSheet.getRange(ss.getActiveRange().getRow(), wcNumCol).getValue() || "").trim();
  }
  if (!wcNumber) { ui.alert("Could not determine WC number from selected row."); return; }

  // Get folder URL from hyperlink
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  var wcMap = getHeaderMap_(wcSh);
  var wcData = wcSh.getDataRange().getValues();
  var folderUrl = "";
  for (var w = 1; w < wcData.length; w++) {
    if (String(wcData[w][wcMap["WC Number"] - 1] || "").trim() === wcNumber) {
      var rt = wcSh.getRange(w + 1, wcMap["WC Number"]).getRichTextValue();
      if (rt) folderUrl = rt.getLinkUrl() || "";
      break;
    }
  }

  if (!folderUrl) {
    ui.alert("No folder found for " + wcNumber + ". The will call may not have a Drive folder.");
    return;
  }

  try {
    generateWillCallReleasePdf_(ss, wcNumber, folderUrl);
    SpreadsheetApp.getActive().toast("Release document regenerated for " + wcNumber + ".", "PDF Updated", 5);
  } catch (err) {
    ui.alert("Error generating PDF: " + err.message);
  }
}

/**
 * Generates the Will Call Release Document PDF and saves it to the WC folder.
 */
function generateWillCallReleasePdf_(ss, wcNumber, folderUrl) {
  var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
  var logoUrl = getSetting_(ss, CI_SETTINGS_KEYS.LOGO_URL) || "";

  // Read WC data
  var wcSh = ss.getSheetByName(CI_SH.WILL_CALLS);
  var wcMap = getHeaderMap_(wcSh);
  var wcData = wcSh.getDataRange().getValues();
  var wcRowData = null;
  for (var w = 1; w < wcData.length; w++) {
    if (String(wcData[w][wcMap["WC Number"] - 1] || "").trim() === wcNumber) {
      wcRowData = wcData[w];
      break;
    }
  }
  if (!wcRowData) throw new Error("Will call " + wcNumber + " not found.");

  var pickupParty = String(wcRowData[wcMap["Pickup Party"] - 1] || "");
  var pickupPhone = String(wcRowData[wcMap["Pickup Phone"] - 1] || "");
  var requestedBy = String(wcRowData[wcMap["Requested By"] - 1] || "");
  var estDate = wcRowData[wcMap["Estimated Pickup Date"] - 1] || "";
  var notes = String(wcRowData[wcMap["Notes"] - 1] || "");
  var status = String(wcRowData[wcMap["Status"] - 1] || "");
  var isCod = truthy_(wcRowData[wcMap["COD"] - 1]);
  var codAmount = Number(wcRowData[wcMap["COD Amount"] - 1] || 0);
  var totalFee = Number(wcRowData[wcMap["Total WC Fee"] - 1] || 0);
  var createdDate = wcRowData[wcMap["Created Date"] - 1] || new Date();

  var dateStr = (createdDate instanceof Date)
    ? Utilities.formatDate(createdDate, Session.getScriptTimeZone(), "MM/dd/yyyy")
    : String(createdDate);
  var estDateStr = "";
  if (estDate instanceof Date) estDateStr = Utilities.formatDate(estDate, Session.getScriptTimeZone(), "MM/dd/yyyy");
  else if (estDate) estDateStr = String(estDate);

  // Read WC items
  var wciSh = ss.getSheetByName(CI_SH.WC_ITEMS);
  var wciMap = getHeaderMap_(wciSh);
  var wciData = wciSh.getDataRange().getValues();
  var items = [];
  for (var wi = 1; wi < wciData.length; wi++) {
    if (String(wciData[wi][wciMap["WC Number"] - 1] || "").trim() !== wcNumber) continue;
    items.push({
      itemId: String(wciData[wi][wciMap["Item ID"] - 1] || ""),
      qty: wciData[wi][wciMap["Qty"] - 1] || 1,
      vendor: String(wciData[wi][wciMap["Vendor"] - 1] || ""),
      description: String(wciData[wi][wciMap["Description"] - 1] || ""),
      itemClass: String(wciData[wi][wciMap["Class"] - 1] || ""),
      location: String(wciData[wi][wciMap["Location"] - 1] || ""),
      sidemark: String(wciData[wi][wciMap["Sidemark"] - 1] || "")
    });
  }

  // Build HTML
  var e = esc_;
  var O  = "#E85D2D";
  var N  = "#1E293B";
  var GB = "#F1F5F9";
  var GR = "#E2E8F0";
  var GT = "#64748B";

  var itemsTableHtml = "";
  for (var ti = 0; ti < items.length; ti++) {
    var it = items[ti];
    var rowBg = ti % 2 === 0 ? "#fff" : "#FAFAFA";
    itemsTableHtml +=
      '<tr style="background:' + rowBg + ';">' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;text-align:center;font-weight:600;">' + (ti + 1) + '</td>' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;font-weight:700;">' + e(it.itemId) + '</td>' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;text-align:center;">' + e(String(it.qty)) + '</td>' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;">' + e(it.vendor) + '</td>' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;">' + e(it.description) + '</td>' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;text-align:center;">' + e(it.itemClass) + '</td>' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;">' + e(it.location) + '</td>' +
      '<td style="padding:5px 6px;border-bottom:1px solid ' + GR + ';font-size:11px;">' + e(it.sidemark) + '</td>' +
      '</tr>';
  }

  // --- Build tokens and resolve against template (Email_Templates lookup with embedded fallback) ---
  var wcTokens = {
    "{{LOGO_URL}}": e(logoUrl),
    "{{WC_NUMBER}}": e(wcNumber),
    "{{COD_BANNER_HTML}}": isCod ? '<div style="background:#DC2626;border:4px solid #991B1B;padding:20px 16px;margin-bottom:14px;text-align:center;">' +
      '<span style="font-size:28px;font-weight:900;color:#FFFFFF;letter-spacing:1px;">\u26A0 COD - PAYMENT DUE AT PICKUP: $' + codAmount.toFixed(2) + ' \u26A0</span></div>' : '',
    "{{CLIENT_NAME}}": e(clientName),
    "{{DATE}}": e(dateStr),
    "{{EST_PICKUP_ROW}}": estDateStr ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Est. Pickup</td><td style="font-size:12px;font-weight:600;">' + e(estDateStr) + '</td></tr>' : '',
    "{{REQUESTED_BY_ROW}}": requestedBy ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;">Requested By</td><td style="font-size:12px;">' + e(requestedBy) + '</td></tr>' : '',
    "{{ITEM_COUNT}}": String(items.length),
    "{{PICKUP_PARTY}}": e(pickupParty),
    "{{PICKUP_PHONE_HTML}}": pickupPhone ? '<div style="font-size:11px;color:#64748B;">' + e(pickupPhone) + '</div>' : '',
    "{{NOTES_HTML}}": notes ? '<div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:6px;padding:8px 12px;margin-bottom:10px;">' +
      '<div style="font-size:9px;color:#92400E;font-weight:800;text-transform:uppercase;margin-bottom:2px;letter-spacing:0.5px;">Notes</div>' +
      '<div style="font-size:11px;color:#78350F;">' + e(notes) + '</div></div>' : '',
    "{{ITEMS_TABLE_ROWS}}": itemsTableHtml,
    "{{TOTAL_ITEMS}}": String(items.length),
    "{{TOTAL_FEE}}": totalFee ? '$' + totalFee.toFixed(2) : ''
  };
  var wcTemplateResult = getDocTemplateHtml_(ss, "DOC_WILL_CALL_RELEASE");
  var html = resolveDocTokens_(wcTemplateResult ? wcTemplateResult.html : getDefaultDocHtml_("DOC_WILL_CALL_RELEASE"), wcTokens);

  // Create PDF with 0.25" margins
  var docTitle = "Will Call Release - " + wcNumber;
  var docId = createGoogleDocFromHtml_(docTitle, html);
  var pdfBlob = exportDocAsPdfBlob_(docId, "Will_Call_" + wcNumber + ".pdf", 0.25);

  // Save to WC folder
  var folderId = String(folderUrl).match(/[-\w]{25,}/);
  if (folderId) {
    var folder = DriveApp.getFolderById(folderId[0]);
    // Remove old PDF if regenerating
    var existingFiles = folder.getFilesByName("Will_Call_" + wcNumber + ".pdf");
    while (existingFiles.hasNext()) existingFiles.next().setTrashed(true);
    folder.createFile(pdfBlob);
  }

  // Clean up temp doc
  try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {}
  Logger.log("Will call release PDF generated: " + wcNumber);
  return pdfBlob;
}
