/* ===================================================
   Tasks.gs — v4.4.0 — 2026-04-02 07:15 PM PST
   =================================================== */
/* v4.0.0: Menu-driven batch task creation + deferred Start Task
   - Removed heavy Drive/PDF work from task creation
   - Added StrideCreateInspectionTasks() and StrideCreateTasks() menu functions
   - Added startTask_() for deferred folder/PDF/hyperlink creation
   - upsertTaskFromInventoryRow_() now lightweight (row write only)
   - buildTaskRow_() unchanged
   - nextTaskCounter_() unchanged
   - generateTaskWorkOrderPdf_() unchanged
*/

/* ============================================================
TASKS
============================================================ */
/**
 * v2.6.4: Generates a unique sequential counter for Task IDs.
 * Scans existing Task IDs matching TYPE-ItemID-* and returns max+1.
 * @param {Sheet} tasksSheet  The Tasks sheet
 * @param {string} type       Task type code (e.g. "INSP", "ASM")
 * @param {string} itemId     Item ID
 * @param {Array} [pendingIds] Optional array of Task IDs being created in the same batch
 * @return {number} Next counter value (1-based)
 */
function nextTaskCounter_(tasksSheet, type, itemId, pendingIds) {
  var prefix = String(type).toUpperCase() + "-" + String(itemId) + "-";
  var maxN = 0;
  // Check existing rows in Tasks sheet
  if (tasksSheet && tasksSheet.getLastRow() > 1) {
    var idCol = getHeaderMap_(tasksSheet)["Task ID"] || 1;
    var ids = tasksSheet.getRange(2, idCol, tasksSheet.getLastRow() - 1, 1).getValues().flat().map(String);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i].indexOf(prefix) === 0) {
        var n = parseInt(ids[i].substring(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
  }
  // Check pending batch IDs (for bulk receiving)
  if (pendingIds && pendingIds.length) {
    for (var j = 0; j < pendingIds.length; j++) {
      if (String(pendingIds[j]).indexOf(prefix) === 0) {
        var n2 = parseInt(String(pendingIds[j]).substring(prefix.length), 10);
        if (!isNaN(n2) && n2 > maxN) maxN = n2;
      }
    }
  }
  return maxN + 1;
}

function buildTaskRow_(taskMap, type, itemId, shipNo, _unused, now, extras, taskId) {
var ex = extras || {};
return buildRowFromMap_(taskMap, {
"Task ID": taskId,
"Type": lookupSvcNameByCode_(SpreadsheetApp.getActive(), type),
"Status": "Open",
"Item ID": itemId,
"Vendor": ex.vendor || "",
"Description": ex.description || "",
"Location": ex.location || "",
"Sidemark": ex.sidemark || "",
"Shipment #": shipNo || "",
"Created": now,
"Item Notes": ex.itemNotes || "",
"Completed At": "",
"Cancelled At": "",
"Result": "",
"Task Notes": "",
"Svc Code": type,
"Billed": false,
"Assigned To": "",
"Start Task": false,
"Started At": ""
});
}

/* ============================================================
   LIGHTWEIGHT TASK CREATION (v4.0.0)
   No Drive folders, no PDFs, no heavy hyperlinks.
   Used by: batch menu functions, dock intake, reconciler.
   ============================================================ */
function upsertTaskFromInventoryRow_(type, enabled, payload) {
var ss = SpreadsheetApp.getActive();
var tasks = ss.getSheetByName(CI_SH.TASKS);
if (!tasks) return;
var map = getHeaderMap_(tasks);
var idCol = map["Task ID"] || 1;
var itemIdCol = map["Item ID"];
var statusCol = map["Status"] || 3;
var last = tasks.getLastRow();
// Idempotency: find existing OPEN task by Svc Code + Item ID
var existingRow = -1;
if (last > 1) {
  var taskData = tasks.getRange(2, 1, last - 1, tasks.getLastColumn()).getValues();
  for (var fi = 0; fi < taskData.length; fi++) {
    var rowType = String(taskData[fi][(map["Svc Code"] || 1) - 1] || "").trim().toUpperCase();
    var rowItemId = itemIdCol ? String(taskData[fi][itemIdCol - 1] || "").trim() : "";
    var rowStatus = statusCol ? String(taskData[fi][statusCol - 1] || "").trim().toLowerCase() : "";
    if (rowType === String(type).trim().toUpperCase() &&
        rowItemId === String(payload.itemId).trim() &&
        rowStatus === "open") {
      existingRow = fi + 2;
      break;
    }
  }
}
var now = new Date();
if (enabled) {
  if (existingRow !== -1) return; // Already exists — skip (idempotent)
  var taskId = type + "-" + payload.itemId + "-" + nextTaskCounter_(tasks, type, payload.itemId);
  var rowValues = buildRowFromMap_(map, {
    "Task ID": taskId,
    "Type": lookupSvcNameByCode_(SpreadsheetApp.getActive(), type),
    "Status": "Open",
    "Item ID": payload.itemId,
    "Vendor": payload.vendor || "",
    "Description": payload.description || "",
    "Location": payload.location || "",
    "Sidemark": payload.sidemark || "",
    "Shipment #": payload.shipNo || "",
    "Created": now,
    "Item Notes": payload.itemNotes || "",
    // v4.0.0: "Inventory Row" removed — unreliable with sorting. All lookups use Item ID.
    "Completed At": "",
    "Cancelled At": "",
    "Result": "",
    "Task Notes": "",
    "Svc Code": type,
    "Billed": false,
    "Assigned To": "",
    "Start Task": false,
    "Started At": ""
  });
  var insertRow = getLastDataRow_(tasks) + 1;
  tasks.getRange(insertRow, 1, 1, rowValues.length).setValues([rowValues]);
  // Update aggregated Task Notes on Inventory (lightweight)
  try { SH_updateInventoryTaskNotes_(ss, payload.itemId); } catch (_) {}
} else if (existingRow !== -1) {
  // Checkbox unchecked — cancel existing open task
  tasks.getRange(existingRow, statusCol).setValue("Cancelled");
  var cancelledAtCol = map["Cancelled At"];
  if (cancelledAtCol) tasks.getRange(existingRow, cancelledAtCol).setValue(now);
}
ensureTasksDefaultFilter_(tasks);
}

function ensureTasksDefaultFilter_(tasksSheet) {
try {
var map = getHeaderMap_(tasksSheet);
var statusCol = map["Status"];
if (!statusCol) return;
var filter = tasksSheet.getFilter();
if (!filter) {
tasksSheet.getDataRange().createFilter();
filter = tasksSheet.getFilter();
}
if (!filter) return;
var crit = SpreadsheetApp.newFilterCriteria()
.setHiddenValues(["Completed","Cancelled"])
.build();
filter.setColumnFilterCriteria(statusCol, crit);
} catch (err) {
Logger.log("ensureTasksDefaultFilter_ warning: " + err);
}
}

/* ============================================================
   BATCH TASK CREATION — MENU FUNCTIONS (v4.0.0)
   User highlights Inventory rows → menu action → lightweight batch create.
   ============================================================ */

/**
 * Builds a normalized lookup map of existing open tasks.
 * Key: "ITEMID|SVCCODE" (trimmed, uppercase). Value: true.
 * Excludes tasks with status: completed, cancelled, closed.
 */
function buildOpenTaskMap_(tasksSheet) {
  var openMap = {};
  var map = getHeaderMap_(tasksSheet);
  var last = tasksSheet.getLastRow();
  if (last < 2) return openMap;
  var data = tasksSheet.getRange(2, 1, last - 1, tasksSheet.getLastColumn()).getValues();
  var svcCol = (map["Svc Code"] || 1) - 1;
  var itemCol = (map["Item ID"] || 1) - 1;
  var statusCol = (map["Status"] || 1) - 1;
  var CLOSED = { "completed": true, "cancelled": true, "closed": true };
  for (var i = 0; i < data.length; i++) {
    var st = String(data[i][statusCol] || "").trim().toLowerCase();
    if (CLOSED[st]) continue;
    var itemId = String(data[i][itemCol] || "").trim();
    var svc = String(data[i][svcCol] || "").trim().toUpperCase();
    if (itemId && svc) openMap[itemId + "|" + svc] = true;
  }
  return openMap;
}

/**
 * Core batch task creation. Called by menu functions.
 * @param {string} svcCode  Service code (e.g. "INSP", "ASM")
 * @param {string} svcLabel Human-readable label for UI messages
 */
function batchCreateTasks_(svcCode, svcLabel) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var activeSheet = ss.getActiveSheet();

  // Validate active sheet
  if (activeSheet.getName() !== CI_SH.INVENTORY) {
    ui.alert("Please switch to the Inventory sheet first.");
    return;
  }

  // Get selection
  var selection = activeSheet.getActiveRange();
  if (!selection) {
    ui.alert("Please highlight one or more Inventory rows first.");
    return;
  }

  var startRow = selection.getRow();
  var numRows = selection.getNumRows();
  if (startRow < 2) { startRow = 2; numRows = numRows - 1; }
  if (numRows < 1) {
    ui.alert("No data rows selected. Please highlight Inventory rows (not the header).");
    return;
  }

  // Soft cap
  if (numRows > 200) {
    var confirmLarge = ui.alert(
      "Large Selection",
      "You selected " + numRows + " rows. This may take a moment. Continue?",
      ui.ButtonSet.YES_NO
    );
    if (confirmLarge !== ui.Button.YES) return;
  }

  // Read selected inventory rows
  var invMap = getHeaderMap_(activeSheet);
  var invItemIdCol = invMap["Item ID"];
  var invStatusCol = invMap["Status"];
  if (!invItemIdCol) {
    ui.alert("Inventory sheet missing 'Item ID' column.");
    return;
  }

  var invData = activeSheet.getRange(startRow, 1, numRows, activeSheet.getLastColumn()).getValues();

  // Build open task map for idempotency
  var tasksSheet = ss.getSheetByName(CI_SH.TASKS);
  if (!tasksSheet) {
    ui.alert("Tasks sheet not found. Run Setup first.");
    return;
  }
  var taskMap = getHeaderMap_(tasksSheet);
  var openTasks = buildOpenTaskMap_(tasksSheet);
  var svcNorm = String(svcCode).trim().toUpperCase();

  // Build batch
  var pendingTaskIds = [];
  var batchRows = [];
  var created = 0;
  var skipped = [];
  var now = new Date();

  for (var i = 0; i < invData.length; i++) {
    var rowNum = startRow + i;
    var row = invData[i];
    var itemId = String(row[invItemIdCol - 1] || "").trim();

    // Validate
    if (!itemId) {
      skipped.push("Row " + rowNum + ": Item ID is blank");
      continue;
    }
    if (invStatusCol) {
      var invStatus = String(row[invStatusCol - 1] || "").trim().toLowerCase();
      if (invStatus && invStatus !== "active") {
        skipped.push("Row " + rowNum + ": Status is '" + row[invStatusCol - 1] + "'");
        continue;
      }
    }

    // Idempotency check
    var key = itemId + "|" + svcNorm;
    if (openTasks[key]) {
      skipped.push("Row " + rowNum + ": open " + svcNorm + " task already exists");
      continue;
    }

    // Generate Task ID
    var counter = nextTaskCounter_(tasksSheet, svcCode, itemId, pendingTaskIds);
    var taskId = svcCode + "-" + itemId + "-" + counter;
    pendingTaskIds.push(taskId);

    // Build lightweight task row
    var taskRowValues = buildTaskRow_(taskMap, svcCode, itemId,
      invMap["Shipment #"] ? String(row[invMap["Shipment #"] - 1] || "") : "",
      rowNum, now, {
        vendor: invMap["Vendor"] ? String(row[invMap["Vendor"] - 1] || "") : "",
        description: invMap["Description"] ? String(row[invMap["Description"] - 1] || "") : "",
        location: invMap["Location"] ? String(row[invMap["Location"] - 1] || "") : "",
        sidemark: invMap["Sidemark"] ? String(row[invMap["Sidemark"] - 1] || "") : "",
        itemNotes: invMap["Item Notes"] ? String(row[invMap["Item Notes"] - 1] || "") : ""
      }, taskId);

    batchRows.push(taskRowValues);
    openTasks[key] = true; // prevent duplicates within same batch
    created++;
  }

  // Batch write all task rows at once
  if (batchRows.length > 0) {
    var insertStart = getLastDataRow_(tasksSheet) + 1;
    tasksSheet.getRange(insertStart, 1, batchRows.length, batchRows[0].length).setValues(batchRows);
    ensureTasksDefaultFilter_(tasksSheet);

    // Update Inventory Task Notes for affected items
    try {
      var uniqueItems = {};
      for (var u = 0; u < invData.length; u++) {
        var uid = String(invData[u][invItemIdCol - 1] || "").trim();
        if (uid && !uniqueItems[uid]) {
          uniqueItems[uid] = true;
          SH_updateInventoryTaskNotes_(ss, uid);
        }
      }
    } catch (_) {}
  }

  // Structured logging
  console.log(JSON.stringify({
    fn: "batchCreateTasks_",
    svcCode: svcCode,
    created: created,
    skipped: skipped.length,
    durationMs: Date.now() - now.getTime()
  }));

  // Report to user
  var msg = "Created " + created + " " + svcLabel + " task(s).";
  if (skipped.length > 0) {
    msg += "\n\nSkipped " + skipped.length + ":\n• " +
      skipped.slice(0, 20).join("\n• ");
    if (skipped.length > 20) msg += "\n• ... (" + (skipped.length - 20) + " more)";
  }
  ui.alert(msg);
}

/** Menu action: Create Inspection Task(s) for selected Inventory rows. */
function StrideCreateInspectionTasks() {
  batchCreateTasks_("INSP", "Inspection");
}

/** Menu action: Create Task(s) — HTML dialog with multi-select checkboxes. */
function StrideCreateTasks() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var activeSheet = ss.getActiveSheet();

  if (activeSheet.getName() !== CI_SH.INVENTORY) {
    ui.alert("Please switch to the Inventory sheet first.");
    return;
  }

  var selection = activeSheet.getActiveRange();
  if (!selection || selection.getRow() < 2) {
    ui.alert("Please highlight one or more Inventory rows first.");
    return;
  }

  var numRows = selection.getNumRows();
  var startRow = selection.getRow();
  if (startRow < 2) { startRow = 2; numRows = numRows - 1; }
  if (numRows < 1) { ui.alert("No data rows selected."); return; }

  // Store selection info for the callback
  PropertiesService.getScriptProperties().setProperty("CREATE_TASKS_START_ROW", String(startRow));
  PropertiesService.getScriptProperties().setProperty("CREATE_TASKS_NUM_ROWS", String(numRows));

  // Build list of service codes from Price_Cache
  var priceCache = ss.getSheetByName("Price_Cache");
  var svcOptions = [];
  if (priceCache && priceCache.getLastRow() > 1) {
    var pcMap = getHeaderMap_(priceCache);
    var pcCodeCol = pcMap["Service Code"] || pcMap["Svc Code"];
    var pcNameCol = pcMap["Service Name"] || pcMap["Svc Name"];
    if (pcCodeCol) {
      var pcData = priceCache.getRange(2, 1, priceCache.getLastRow() - 1, priceCache.getLastColumn()).getValues();
      var EXCLUDE = { "REPAIR": true, "RPR": true, "STOR": true, "RCVG": true, "WC": true, "INSP": true };
      for (var p = 0; p < pcData.length; p++) {
        var code = String(pcData[p][pcCodeCol - 1] || "").trim().toUpperCase();
        var name = pcNameCol ? String(pcData[p][pcNameCol - 1] || "").trim() : code;
        if (code && !EXCLUDE[code]) {
          svcOptions.push({ code: code, name: name });
        }
      }
    }
  }

  if (!svcOptions.length) {
    ui.alert("No task types found in Price_Cache. Run Refresh Price/Class Cache first.");
    return;
  }

  // Build HTML dialog with checkboxes
  var checkboxes = svcOptions.map(function(o) {
    return '<label style="display:block;padding:8px 12px;margin:4px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;font-size:14px;">' +
      '<input type="checkbox" name="svc" value="' + o.code + '" style="margin-right:10px;transform:scale(1.3);cursor:pointer;">' +
      '<b>' + o.name + '</b> <span style="color:#94A3B8;font-size:12px;">[' + o.code + ']</span></label>';
  }).join("");

  var html = '<div style="font-family:Arial,sans-serif;padding:16px;">' +
    '<div style="font-size:13px;color:#64748B;margin-bottom:12px;">' + numRows + ' item(s) selected. Choose task type(s):</div>' +
    '<div style="max-height:300px;overflow-y:auto;">' + checkboxes + '</div>' +
    '<div style="margin-top:16px;text-align:right;">' +
    '<button onclick="google.script.host.close()" style="padding:8px 16px;margin-right:8px;border:1px solid #CBD5E1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Cancel</button>' +
    '<button id="createBtn" onclick="submit()" style="padding:8px 20px;border:none;border-radius:6px;background:#E85D2D;color:#fff;font-weight:bold;cursor:pointer;font-size:13px;">Create Tasks</button>' +
    '</div>' +
    '<div id="spinner" style="display:none;text-align:center;padding:20px;">' +
    '<div style="display:inline-block;width:36px;height:36px;border:4px solid #E2E8F0;border-top:4px solid #E85D2D;border-radius:50%;animation:spin 1s linear infinite;"></div>' +
    '<div style="margin-top:10px;font-size:13px;color:#64748B;">Creating tasks...</div>' +
    '</div>' +
    '<div id="result" style="display:none;text-align:center;padding:20px;"></div>' +
    '<style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>' +
    '</div>' +
    '<script>' +
    'function submit(){' +
    '  var checks=document.querySelectorAll("input[name=svc]:checked");' +
    '  if(!checks.length){alert("Select at least one task type.");return;}' +
    '  var codes=[];for(var i=0;i<checks.length;i++)codes.push(checks[i].value);' +
    '  document.getElementById("createBtn").parentElement.style.display="none";' +
    '  document.querySelector("[style*=max-height]").style.display="none";' +
    '  document.getElementById("spinner").style.display="block";' +
    '  google.script.run.withSuccessHandler(function(msg){' +
    '    document.getElementById("spinner").style.display="none";' +
    '    var rd=document.getElementById("result");rd.style.display="block";' +
    '    rd.innerHTML=\'<div style="font-size:24px;color:#16A34A;margin-bottom:8px;">&#10003;</div>\'+' +
    '      \'<div style="font-size:14px;white-space:pre-wrap;">\'+msg+\'</div>\'+' +
    '      \'<button onclick="google.script.host.close()" style="margin-top:14px;padding:8px 20px;border:none;border-radius:6px;background:#E85D2D;color:#fff;font-weight:bold;cursor:pointer;font-size:13px;">Done</button>\';' +
    '  }).withFailureHandler(function(e){' +
    '    document.getElementById("spinner").style.display="none";' +
    '    var rd=document.getElementById("result");rd.style.display="block";' +
    '    rd.innerHTML=\'<div style="font-size:24px;color:#DC2626;margin-bottom:8px;">&#10007;</div>\'+' +
    '      \'<div style="font-size:14px;color:#DC2626;">\'+e.message+\'</div>\'+' +
    '      \'<button onclick="google.script.host.close()" style="margin-top:14px;padding:8px 16px;border:1px solid #CBD5E1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Close</button>\';' +
    '  }).StrideCreateTasksCallback(codes);' +
    '}' +
    '</script>';

  var output = HtmlService.createHtmlOutput(html)
    .setWidth(360)
    .setHeight(400);
  ui.showModalDialog(output, "Create Tasks");
}

/** Callback from Create Tasks dialog — creates tasks for each selected type. */
function StrideCreateTasksCallback(selectedCodes) {
  var props = PropertiesService.getScriptProperties();
  var startRow = parseInt(props.getProperty("CREATE_TASKS_START_ROW") || "0", 10);
  var numRows = parseInt(props.getProperty("CREATE_TASKS_NUM_ROWS") || "0", 10);
  props.deleteProperty("CREATE_TASKS_START_ROW");
  props.deleteProperty("CREATE_TASKS_NUM_ROWS");

  if (!startRow || !numRows || !selectedCodes || !selectedCodes.length) {
    return "No tasks created — selection expired. Please re-select rows and try again.";
  }

  var ss = SpreadsheetApp.getActive();
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv) return "Inventory sheet not found.";

  var invMap = getHeaderMap_(inv);
  var invItemIdCol = invMap["Item ID"];
  var invStatusCol = invMap["Status"];
  if (!invItemIdCol) return "Inventory missing Item ID column.";

  var tasksSheet = ss.getSheetByName(CI_SH.TASKS);
  if (!tasksSheet) return "Tasks sheet not found.";
  var taskMap = getHeaderMap_(tasksSheet);
  var openTasks = buildOpenTaskMap_(tasksSheet);

  var invData = inv.getRange(startRow, 1, numRows, inv.getLastColumn()).getValues();

  var allBatchRows = [];
  var totalCreated = 0;
  var totalSkipped = 0;
  var skippedReasons = [];
  var now = new Date();
  var pendingTaskIds = [];

  for (var si = 0; si < selectedCodes.length; si++) {
    var svcCode = String(selectedCodes[si]).trim().toUpperCase();
    var svcLabel = lookupSvcNameByCode_(ss, svcCode) || svcCode;

    for (var i = 0; i < invData.length; i++) {
      var rowNum = startRow + i;
      var row = invData[i];
      var itemId = String(row[invItemIdCol - 1] || "").trim();

      if (!itemId) {
        skippedReasons.push("Row " + rowNum + " [" + svcCode + "]: Item ID is blank");
        totalSkipped++;
        continue;
      }
      if (invStatusCol) {
        var invStatus = String(row[invStatusCol - 1] || "").trim().toLowerCase();
        if (invStatus && invStatus !== "active") {
          skippedReasons.push("Row " + rowNum + " [" + svcCode + "]: Status is '" + row[invStatusCol - 1] + "'");
          totalSkipped++;
          continue;
        }
      }

      var key = itemId + "|" + svcCode;
      if (openTasks[key]) {
        skippedReasons.push("Row " + rowNum + " [" + svcCode + "]: open task already exists");
        totalSkipped++;
        continue;
      }

      var counter = nextTaskCounter_(tasksSheet, svcCode, itemId, pendingTaskIds);
      var taskId = svcCode + "-" + itemId + "-" + counter;
      pendingTaskIds.push(taskId);

      var taskRowValues = buildTaskRow_(taskMap, svcCode, itemId,
        invMap["Shipment #"] ? String(row[invMap["Shipment #"] - 1] || "") : "",
        rowNum, now, {
          vendor: invMap["Vendor"] ? String(row[invMap["Vendor"] - 1] || "") : "",
          description: invMap["Description"] ? String(row[invMap["Description"] - 1] || "") : "",
          location: invMap["Location"] ? String(row[invMap["Location"] - 1] || "") : "",
          sidemark: invMap["Sidemark"] ? String(row[invMap["Sidemark"] - 1] || "") : "",
          itemNotes: invMap["Item Notes"] ? String(row[invMap["Item Notes"] - 1] || "") : ""
        }, taskId);

      allBatchRows.push(taskRowValues);
      openTasks[key] = true;
      totalCreated++;
    }
  }

  if (allBatchRows.length > 0) {
    var insertStart = getLastDataRow_(tasksSheet) + 1;
    tasksSheet.getRange(insertStart, 1, allBatchRows.length, allBatchRows[0].length).setValues(allBatchRows);
    ensureTasksDefaultFilter_(tasksSheet);
  }

  var msg = "Created " + totalCreated + " task(s) across " + selectedCodes.length + " type(s).";
  if (totalSkipped > 0) {
    msg += "\n\nSkipped " + totalSkipped + ":\n" +
      skippedReasons.slice(0, 15).join("\n");
    if (skippedReasons.length > 15) msg += "\n... (" + (skippedReasons.length - 15) + " more)";
  }
  return msg;
}

/* ============================================================
   RELEASE ITEMS — BATCH SET RELEASE DATE (v4.0.2)
   User highlights Inventory rows → menu → date picker → sets Release Date + Status=Released.
   ============================================================ */
function StrideSetReleaseDate() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var activeSheet = ss.getActiveSheet();

  if (activeSheet.getName() !== CI_SH.INVENTORY) {
    ui.alert("Please switch to the Inventory sheet first.");
    return;
  }

  var selection = activeSheet.getActiveRange();
  if (!selection || selection.getRow() < 2) {
    ui.alert("Please highlight one or more Inventory rows first.");
    return;
  }

  var startRow = selection.getRow();
  var numRows = selection.getNumRows();
  if (startRow < 2) { startRow = 2; numRows = numRows - 1; }
  if (numRows < 1) { ui.alert("No data rows selected."); return; }

  // Store selection for callback
  PropertiesService.getScriptProperties().setProperty("RELEASE_START_ROW", String(startRow));
  PropertiesService.getScriptProperties().setProperty("RELEASE_NUM_ROWS", String(numRows));

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var html = '<div style="font-family:Arial,sans-serif;padding:20px;text-align:center;">' +
    '<div style="font-size:14px;color:#1E293B;margin-bottom:4px;font-weight:bold;">Release Date</div>' +
    '<div style="font-size:13px;color:#64748B;margin-bottom:16px;">' + numRows + ' item(s) selected</div>' +
    '<input type="date" id="relDate" value="' + today + '" style="font-size:16px;padding:10px 14px;border:2px solid #CBD5E1;border-radius:8px;width:220px;text-align:center;">' +
    '<div style="margin-top:20px;">' +
    '<button onclick="google.script.host.close()" style="padding:8px 16px;margin-right:8px;border:1px solid #CBD5E1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Cancel</button>' +
    '<button id="relBtn" onclick="submit()" style="padding:8px 20px;border:none;border-radius:6px;background:#E85D2D;color:#fff;font-weight:bold;cursor:pointer;font-size:13px;">Set Release Date</button>' +
    '</div>' +
    '<div id="spinner" style="display:none;margin-top:16px;">' +
    '<div style="display:inline-block;width:28px;height:28px;border:3px solid #E2E8F0;border-top:3px solid #E85D2D;border-radius:50%;animation:spin 1s linear infinite;"></div>' +
    '<div style="margin-top:6px;font-size:12px;color:#64748B;">Processing...</div>' +
    '</div>' +
    '<div id="result" style="display:none;margin-top:16px;"></div>' +
    '<style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>' +
    '</div>' +
    '<script>' +
    'function submit(){' +
    '  var d=document.getElementById("relDate").value;' +
    '  if(!d){alert("Please select a date.");return;}' +
    '  document.getElementById("relBtn").parentElement.style.display="none";' +
    '  document.getElementById("spinner").style.display="block";' +
    '  google.script.run.withSuccessHandler(function(msg){' +
    '    document.getElementById("spinner").style.display="none";' +
    '    var rd=document.getElementById("result");rd.style.display="block";' +
    '    rd.innerHTML=\'<div style="font-size:20px;color:#16A34A;margin-bottom:6px;">&#10003;</div>\'+' +
    '      \'<div style="font-size:13px;white-space:pre-wrap;">\'+msg+\'</div>\'+' +
    '      \'<button onclick="google.script.host.close()" style="margin-top:12px;padding:8px 20px;border:none;border-radius:6px;background:#E85D2D;color:#fff;font-weight:bold;cursor:pointer;font-size:13px;">Done</button>\';' +
    '  }).withFailureHandler(function(e){' +
    '    document.getElementById("spinner").style.display="none";' +
    '    var rd=document.getElementById("result");rd.style.display="block";' +
    '    rd.innerHTML=\'<div style="color:#DC2626;font-size:13px;">\'+e.message+\'</div>\'+' +
    '      \'<button onclick="google.script.host.close()" style="margin-top:12px;padding:8px 16px;border:1px solid #CBD5E1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Close</button>\';' +
    '  }).StrideSetReleaseDateCallback(d);' +
    '}' +
    '</script>';

  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(320).setHeight(280), "Set Release Date");
}

/** Callback from Set Release Date dialog. */
function StrideSetReleaseDateCallback(dateStr) {
  var props = PropertiesService.getScriptProperties();
  var startRow = parseInt(props.getProperty("RELEASE_START_ROW") || "0", 10);
  var numRows = parseInt(props.getProperty("RELEASE_NUM_ROWS") || "0", 10);
  props.deleteProperty("RELEASE_START_ROW");
  props.deleteProperty("RELEASE_NUM_ROWS");

  if (!startRow || !numRows) return "Selection expired. Please re-select rows and try again.";

  // Parse yyyy-MM-dd from HTML date input
  var parts = String(dateStr).split("-");
  var releaseDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  if (isNaN(releaseDate.getTime())) return "Invalid date.";

  var ss = SpreadsheetApp.getActive();
  var inv = ss.getSheetByName(CI_SH.INVENTORY);
  if (!inv) return "Inventory sheet not found.";

  var invMap = getHeaderMap_(inv);
  var relDateCol = invMap["Release Date"];
  var statusCol = invMap["Status"];
  var itemIdCol = invMap["Item ID"];
  if (!relDateCol || !statusCol) return "Missing Release Date or Status column.";

  var updated = 0;
  var skipped = [];

  for (var i = 0; i < numRows; i++) {
    var rowNum = startRow + i;
    var itemId = itemIdCol ? String(inv.getRange(rowNum, itemIdCol).getValue() || "").trim() : "";

    if (!itemId) { skipped.push("Row " + rowNum + ": no Item ID"); continue; }

    var currentStatus = String(inv.getRange(rowNum, statusCol).getValue() || "").trim().toLowerCase();
    if (currentStatus === "released" || currentStatus === "transferred") {
      skipped.push("Row " + rowNum + ": already " + currentStatus);
      continue;
    }

    inv.getRange(rowNum, relDateCol).setValue(releaseDate);
    inv.getRange(rowNum, statusCol).setValue(INVENTORY_STATUS.RELEASED);
    updated++;
  }

  var displayDate = Utilities.formatDate(releaseDate, Session.getScriptTimeZone(), "MM/dd/yyyy");
  var msg = "Released " + updated + " item(s) with date " + displayDate + ".";
  if (skipped.length > 0) {
    msg += "\n\nSkipped " + skipped.length + ":\n" + skipped.slice(0, 15).join("\n");
  }
  return msg;
}

/* ============================================================
   START TASK — DEFERRED HEAVY WORK (v4.0.0)
   Called from onTaskEdit_ when "Start Task" checkbox is checked.
   Creates Drive folder, PDF work order, hyperlinks.
   Fully idempotent and retry-safe.
   ============================================================ */
function startTask_(ss, tasksSheet, taskRowNum, taskMap) {
  var start = Date.now();
  try {
    var rowData = tasksSheet.getRange(taskRowNum, 1, 1, tasksSheet.getLastColumn()).getValues()[0];
    var taskId = String(getCellByHeader_(rowData, taskMap, "Task ID") || "").trim();
    var itemId = String(getCellByHeader_(rowData, taskMap, "Item ID") || "").trim();
    var shipNo = String(getCellByHeader_(rowData, taskMap, "Shipment #") || "").trim();
    if (!taskId || !itemId) return;

    // GUARD: already fully started (Started At set AND folder URL exists)
    var startedAtCol = taskMap["Started At"];
    var startedAtVal = startedAtCol ? rowData[startedAtCol - 1] : null;
    var idCol = taskMap["Task ID"] || 1;
    var existingRt = tasksSheet.getRange(taskRowNum, idCol).getRichTextValue();
    var existingFolderUrl = (existingRt && existingRt.getLinkUrl()) ? existingRt.getLinkUrl() : "";
    if (startedAtVal && existingFolderUrl) return; // Fully complete — skip

    // v4.2.0: Flat folder structure — task folders go in Tasks/ subfolder (not nested in shipments)
    var taskFolderUrl = existingFolderUrl; // Reuse if partial run created it
    if (!taskFolderUrl) {
      var tasksParent = getOrCreateEntitySubfolder_(ss, "Tasks");
      if (tasksParent) {
        try {
          var it = tasksParent.getFoldersByName(taskId);
          var tf = it.hasNext() ? it.next() : tasksParent.createFolder(taskId);
          taskFolderUrl = tf.getUrl();
        } catch (tfErr) { Logger.log("startTask_ folder creation error: " + tfErr); }
      }
    }

    // 3. Hyperlink Task ID to folder
    if (taskFolderUrl && idCol) {
      var taskRt = SpreadsheetApp.newRichTextValue().setText(taskId).setLinkUrl(taskFolderUrl).build();
      tasksSheet.getRange(taskRowNum, idCol).setRichTextValue(taskRt);
    }

    // Task Work Order PDF removed (v4.3.0) — only repairs generate work order docs

    // v4.2.0: Shipment # hyperlink removed — task folder is now independent of shipment folder

    // 6. SUCCESS: stamp Started At, keep Start Task checked (v4.3.0: don't reset to FALSE), set Status to In Progress
    if (startedAtCol) {
      tasksSheet.getRange(taskRowNum, startedAtCol).setValue(new Date());
    }
    var startTaskCol = taskMap["Start Task"];
    if (startTaskCol) {
      tasksSheet.getRange(taskRowNum, startTaskCol).setValue(true); // v4.3.0: keep TRUE — signals task is started
    }
    // v4.1.0: Set Status to "In Progress" when starting a task
    var statusCol = taskMap["Status"];
    if (statusCol) {
      var currentStatus = String(rowData[statusCol - 1] || "").trim();
      if (currentStatus === "Open") {
        tasksSheet.getRange(taskRowNum, statusCol).setValue("In Progress");
      }
    }

    console.log(JSON.stringify({
      fn: "startTask_",
      taskId: taskId,
      itemId: itemId,
      folderCreated: !!taskFolderUrl,
      durationMs: Date.now() - start
    }));

  } catch (err) {
    Logger.log("startTask_ error: " + err + " | Stack: " + (err.stack || ""));
    try {
      SpreadsheetApp.getActive().toast(
        "Start Task failed: " + (err.message || err) + "\nLeave checkbox checked to retry.",
        "Error", 10
      );
    } catch (_) {}
    // Do NOT stamp Started At — leave checkbox checked for retry
  }
}

/* ============================================================
   TASK WORK ORDER PDF GENERATION
   ============================================================ */
/**
 * Generates a Task Work Order PDF and saves it to the task's photos folder.
 * Called from startTask_() when the task is started.
 */
function generateTaskWorkOrderPdf_(ss, taskRowData, taskMap, folderUrl) {
  try {
    var clientName = getSetting_(ss, CI_SETTINGS_KEYS.CLIENT_NAME) || "Client";
    var logoUrl    = getSetting_(ss, CI_SETTINGS_KEYS.LOGO_URL) || "";

    var taskId    = getCellByHeader_(taskRowData, taskMap, "Task ID") || "";
    var itemId    = getCellByHeader_(taskRowData, taskMap, "Item ID") || "";
    var taskType  = getCellByHeader_(taskRowData, taskMap, "Type") || "";
    var taskNotes = getCellByHeader_(taskRowData, taskMap, "Task Notes") || "";
    var status    = getCellByHeader_(taskRowData, taskMap, "Status") || "Open";
    var photosUrl = folderUrl || "";
    var createdDate = getCellByHeader_(taskRowData, taskMap, "Created") || new Date();

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

    // --- Build tokens and resolve against template ---
    var e = esc_;
    var taskTokens = {
      "{{LOGO_URL}}": e(logoUrl),
      "{{TASK_ID}}": e(taskId),
      "{{CLIENT_NAME}}": e(clientName),
      "{{DATE}}": e(dateStr),
      "{{SIDEMARK}}": e(sidemark),
      "{{SIDEMARK_ROW}}": sidemark ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">SIDEMARK</td><td style="font-size:12px;">' + e(sidemark) + '</td></tr>' : '',
      "{{STATUS}}": e(status),
      "{{TASK_TYPE}}": e(taskType),
      "{{NOTES_ROW}}": taskNotes ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Notes</td><td style="font-size:12px;">' + e(taskNotes) + '</td></tr>' : '',
      "{{PHOTOS_ROW}}": photosUrl ? '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">Photos</td><td style="font-size:12px;"><a href="' + e(photosUrl) + '" style="color:#E85D2D;text-decoration:underline;">View Photos</a></td></tr>' : '',
      "{{ITEM_ID}}": e(itemId),
      "{{ITEM_QTY}}": e(String(itemQty)),
      "{{ITEM_VENDOR}}": e(itemVendor),
      "{{ITEM_DESC}}": e(itemDesc),
      "{{ITEM_SIDEMARK}}": e(sidemark),
      "{{ITEM_ROOM}}": e(itemRoom),
      "{{RESULT_OPTIONS_HTML}}": '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Pass</span>' +
        '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Fail</span>' +
        '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Needs Repair</span>' +
        '<span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Other</span>'
    };
    var taskTemplateResult = getDocTemplateHtml_(ss, "DOC_TASK_WORK_ORDER");
    var html = resolveDocTokens_(taskTemplateResult ? taskTemplateResult.html : getDefaultDocHtml_("DOC_TASK_WORK_ORDER"), taskTokens);

    var docTitle = "Work Order - " + taskId;
    var docId    = createGoogleDocFromHtml_(docTitle, html);
    var pdfBlob  = exportDocAsPdfBlob_(docId, "Work_Order_" + taskId + ".pdf", 0.25);

    // Save to task photos folder
    var folderId = String(folderUrl).match(/[-\w]{25,}/);
    if (folderId) {
      DriveApp.getFolderById(folderId[0]).createFile(pdfBlob);
    }

    // Clean up temp Google Doc
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (_) {}
    Logger.log("Task work order PDF generated: " + taskId);
  } catch (err) {
    Logger.log("generateTaskWorkOrderPdf_ error: " + err + " | Stack: " + (err.stack || ""));
    try { SpreadsheetApp.getActive().toast("Task work order PDF failed: " + (err.message || err) + "\n\nEnable Advanced Drive Service: Apps Script → Services → Drive API", "PDF Warning", 10); } catch(_){}
  }
}
