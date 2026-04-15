/* ===================================================
   ScannerBackend.gs — v2.4.0 — 2026-04-14 PST
   v2.4.0: Server injects API URL into Scanner + LabelPrinter templates so
           users no longer need to paste it on first load. Sourced from
           SCANNER_WEB_APP_URL script property if set, else auto-resolved
           via ScriptApp.getService().getUrl(). localStorage override still
           honored for dev / cross-deployment testing.
   v2.3.0: Scanner write mirrors to Supabase (PATCH inventory.location +
           updated_at), best-effort — matches arch invariant #20. Locations
           list cached via CacheService (10-min TTL) so autocomplete is
           instant on return visits. Requires SUPABASE_URL +
           SUPABASE_SERVICE_ROLE_KEY on this project's script properties.
   =================================================== */
/***************************************************************
 * QR Scanner — ScannerBackend.gs  v2.0.0  2026-04-01
 *
 * Deployed as a Web App from the Consolidated Billing sheet project.
 * Serves Scanner.html (?page=scanner, default) and LabelPrinter.html
 * (?page=labels).  All functions callable via google.script.run.
 *
 * Depends on:  IndexBuilder.gs (qrGetOrBuildIndex, qrRefreshIndex,
 *              qrBuildIndex), Code.gs (getActiveClients_)
 *
 * v1.1.0: QR_CONFIG, batch setValues, validateInventorySheet_, LockService
 * v1.2.0: Structured label response, debugLookup, build-failure surfacing
 * v1.3.0: Removed 5-digit filter, normalization helpers, bulk lookupItems
 * v1.4.0: Case-insensitive prefix strip, index.html fallback, auto-rebuild on miss
 *
 * v2.0.0:
 * - ADD: Move History logging — one row per item location change
 * - ADD: Auto-create "Move History" tab on client sheets if missing
 * - ADD: qrGetMoveHistory(sheetId, itemId) — read move history for an item
 * - ADD: "getMoveHistory" API route
 * - ADD: qrUpdateLocations reads FROM location before writing TO, logs moves
 * - ADD: "validateItems" API route for pre-commit validation
 ***************************************************************/

/* ============================================================
   CENTRAL CONFIG  (no hard-coded sheet/column names)
   ============================================================ */

var QR_CONFIG = {
  INVENTORY_SH:   "Inventory",    // sheet name on every client spreadsheet
  ITEM_ID_COL:    "ITEM ID",      // header — normalized to uppercase for matching
  LOCATION_COL:   "LOCATION",
  STATUS_COL:     "STATUS",       // only rows with Status="Active" are indexed
  LOCATIONS_SH:   "Locations",    // sheet on Consolidated Billing
  LOCATIONS_HDR:  "Location Code" // header row text in Locations sheet
};

var QR_BACKEND_V    = "v2.0.0";

var MOVE_HISTORY_SH   = "Move History";
var MOVE_HISTORY_HDRS = ["Timestamp", "User", "Item ID", "From Location", "To Location", "Type"];
var QR_LABEL_FIELDS = [
  "Item ID", "Client", "Sidemark", "Vendor",
  "Description", "Room", "Location", "Class"
];

/* ============================================================
   NORMALIZATION HELPERS  (Section E)
   Always trim, always keep as strings, preserve leading zeros.
   ============================================================ */

/**
 * Normalize a single scanned / input code value.
 * Strips ITEM: or LOC: prefix if present, then trims.
 * Never converts to Number — leading zeros are preserved.
 * @param {*} value
 * @returns {string}  Trimmed string, or '' if empty.
 */
function qrNormalizeScannedCode_(value) {
  var s = String(value == null ? '' : value).trim();
  var upper = s.toUpperCase();
  // Strip typed prefixes (ITEM: / LOC:) so bare IDs reach the index
  if (upper.indexOf('ITEM:') === 0) s = s.substring(5).trim();
  else if (upper.indexOf('LOC:') === 0) s = s.substring(4).trim();
  return s;
}

/**
 * Normalize a list of scanned codes: trim, dedupe, strip prefixes, drop empties.
 * @param {Array}  values
 * @returns {string[]}
 */
function qrNormalizeCodeList_(values) {
  if (!Array.isArray(values)) return [];
  var out  = [];
  var seen = {};
  for (var i = 0; i < values.length; i++) {
    var v = qrNormalizeScannedCode_(values[i]);
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  }
  return out;
}


/**
 * Return scanner page template, preferring Scanner.html but falling back to index.html.
 * This helps when the deployed web app uses index.html as the scanner shell.
 */
function qrCreateScannerTemplate_() {
  try {
    return HtmlService.createTemplateFromFile("Scanner");
  } catch (err) {
    return HtmlService.createTemplateFromFile("index");
  }
}

/**
 * If any requested IDs are missing from the current index, rebuild once and retry.
 * Returns the existing index when no retry is needed.
 * @param {Object} index
 * @param {string[]} ids
 * @returns {Object}
 */
function qrEnsureFreshIndexForIds_(index, ids) {
  if (!index || index.__buildFailed) return index;
  var needsRetry = false;
  for (var i = 0; i < ids.length; i++) {
    if (!index[ids[i]]) { needsRetry = true; break; }
  }
  if (!needsRetry) return index;
  Logger.log("qrEnsureFreshIndexForIds_: cache miss on lookup — rebuilding index");
  var rebuild = qrBuildIndex();
  if (!rebuild || rebuild.success === false) return { __buildFailed: true };
  return qrGetCachedIndex() || { __buildFailed: true };
}

/* ============================================================
   WEB APP ENTRY POINT
   doGet() handles both HTML page requests and API calls.
   API calls pass ?action=<name>&payload=<JSON> as GET params,
   avoiding the cross-origin redirect issue that affects POST.
   ============================================================ */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";

  // If action param exists this is an API call — return JSON (or JSONP if callback provided)
  if (action) {
    var callback = (e.parameter.callback) ? e.parameter.callback : '';
    var body = {};
    try {
      if (e.parameter.payload) {
        body = JSON.parse(e.parameter.payload);
      }
      body.action = action;
    } catch (err) {
      var errJson = JSON.stringify({ error: err.message });
      if (callback) {
        return ContentService
          .createTextOutput(callback + '(' + errJson + ')')
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService
        .createTextOutput(errJson)
        .setMimeType(ContentService.MimeType.JSON);
    }
    var result = handleApiCall_(body);
    if (callback) {
      var jsonBody = result.getContent();
      return ContentService
        .createTextOutput(callback + '(' + jsonBody + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return result;
  }

  // Otherwise serve the requested HTML page
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : "scanner";
  var tmpl = (page === "labels")
    ? HtmlService.createTemplateFromFile("LabelPrinter")
    : qrCreateScannerTemplate_();

  // v2.4.0: Inject the Web App URL so the frontend can auto-configure itself.
  // Templates read this via <?= INJECTED_API_URL ?> in an early <script>.
  tmpl.INJECTED_API_URL = qrResolveWebAppUrl_();

  return tmpl.evaluate()
    .setTitle(page === "labels" ? "Label Printer — GS Inventory" : "QR Scanner — GS Inventory")
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no")
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * v2.4.0: Resolve the Web App URL that the served HTML should call back to.
 * Priority order:
 *   1. SCANNER_WEB_APP_URL script property (explicit override for staging /
 *      non-default deployments).
 *   2. ScriptApp.getService().getUrl() — matches whatever the current user
 *      loaded; usually correct and requires zero configuration.
 *   3. Empty string — frontend keeps its existing modal-prompt fallback.
 * @returns {string}
 * @private
 */
function qrResolveWebAppUrl_() {
  try {
    var prop = PropertiesService.getScriptProperties().getProperty('SCANNER_WEB_APP_URL');
    if (prop) return String(prop).trim();
  } catch (_) {}
  try {
    var url = ScriptApp.getService().getUrl();
    if (url) return String(url).trim();
  } catch (_) {}
  return '';
}

/* ============================================================
   JSON API — doPost()
   Kept for backwards compatibility; delegates to handleApiCall_.
   ============================================================ */

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return handleApiCall_(body);
}

/* ============================================================
   SHARED API ROUTER  (called by both doGet and doPost)
   ============================================================ */

function handleApiCall_(body) {
  var result;
  try {
    var action = String(body.action || "");
    switch (action) {
      case "getLocations":
        result = qrGetLocations();
        break;
      case "updateLocations":
        result = qrUpdateLocations(body.itemIds, body.location);
        break;
      case "lookupItem":
        result = qrLookupItem(body.itemId);
        break;
      case "lookupItems":
        result = qrLookupItems(body.itemIds);
        break;
      case "getItemsForLabels":
        result = qrGetItemsForLabels(body.itemIds);
        break;
      case "getLabelConfig":
        result = qrGetLabelConfig(body.labelType);
        break;
      case "saveLabelConfig":
        result = qrSaveLabelConfig(body.config);
        break;
      case "rebuildIndex":
        result = qrBuildIndex();
        break;
      case "setupLocations":
        result = qrSetupLocationsSheet();
        break;
      case "debugLookup":
        result = qrDebugLookup(body.itemIds);
        break;
      case "validateItems":
        result = qrValidateItems(body.itemIds);
        break;
      case "getMoveHistory":
        result = qrGetMoveHistory(body.sheetId, body.itemId);
        break;
      case "upsertLocations":
        result = qrUpsertLocations(body.codes);
        break;
      default:
        result = { error: "Unknown action: " + action };
    }
  } catch (err) {
    result = { error: err.message };
    Logger.log("handleApiCall_ error [" + JSON.stringify(body) + "]: " + err);
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   VALIDATION HELPER
   Validates that an Inventory sheet exists and has required columns.
   Returns { inv, hMap, colLoc } on success; throws with a clear message.
   ============================================================ */

function validateInventorySheet_(css, clientName) {
  var inv = css.getSheetByName(QR_CONFIG.INVENTORY_SH);
  if (!inv) {
    throw new Error("Client '" + clientName + "': no sheet named '" + QR_CONFIG.INVENTORY_SH + "'");
  }
  if (inv.getLastRow() < 1) {
    throw new Error("Client '" + clientName + "': " + QR_CONFIG.INVENTORY_SH + " sheet is empty");
  }

  var hdrRow = inv.getRange(1, 1, 1, inv.getLastColumn()).getValues()[0];
  var hMap   = {};
  for (var h = 0; h < hdrRow.length; h++) {
    hMap[String(hdrRow[h]).trim().toUpperCase()] = h;
  }

  var colLoc = hMap[QR_CONFIG.LOCATION_COL];
  if (colLoc === undefined) {
    throw new Error(
      "Client '" + clientName + "': " + QR_CONFIG.INVENTORY_SH +
      " sheet is missing a '" + QR_CONFIG.LOCATION_COL + "' column"
    );
  }

  return { inv: inv, hMap: hMap, colLoc: colLoc };
}

/* ============================================================
   LABEL-SPECIFIC VALIDATOR
   Like validateInventorySheet_ but does NOT require Location column.
   If Location is absent, colLoc is returned as undefined.
   ============================================================ */

function validateInventorySheetForLabels_(css, clientName) {
  var inv = css.getSheetByName(QR_CONFIG.INVENTORY_SH);
  if (!inv) {
    throw new Error("Client '" + clientName + "': no sheet named '" + QR_CONFIG.INVENTORY_SH + "'");
  }
  if (inv.getLastRow() < 1) {
    throw new Error("Client '" + clientName + "': " + QR_CONFIG.INVENTORY_SH + " sheet is empty");
  }

  var hdrRow = inv.getRange(1, 1, 1, inv.getLastColumn()).getValues()[0];
  var hMap   = {};
  for (var h = 0; h < hdrRow.length; h++) {
    hMap[String(hdrRow[h]).trim().toUpperCase()] = h;
  }

  var colLoc = hMap[QR_CONFIG.LOCATION_COL]; // may be undefined

  return { inv: inv, hMap: hMap, colLoc: colLoc };
}

/* ============================================================
   LOCATIONS
   ============================================================ */

// v2.3.0: Script-level cache key + TTL for the Locations list. 10 minutes is
// long enough to absorb repeat scanner opens without serving data that's
// meaningfully stale — and qrUpdateLocations invalidates on any write anyway.
var QR_LOCATIONS_CACHE_KEY = 'qr:locations';
var QR_LOCATIONS_CACHE_TTL_S = 600;

function qrGetLocations() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(QR_LOCATIONS_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { /* fall through and re-read */ }
  }

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(QR_CONFIG.LOCATIONS_SH);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var out  = [];
  for (var i = 0; i < vals.length; i++) {
    var loc = String(vals[i][0] || "").trim();
    if (loc) out.push(loc);
  }
  // Serialized cache size limit is 100 KB — well clear of any realistic
  // location-list size (even 5000 codes × 20 chars = 100 KB).
  try { cache.put(QR_LOCATIONS_CACHE_KEY, JSON.stringify(out), QR_LOCATIONS_CACHE_TTL_S); } catch (_) {}
  return out;
}

/**
 * v2.3.0: invalidate the locations cache. Called from qrUpdateLocations when
 * the target location was novel, so autocomplete includes it on next fetch
 * (once operators add it to the Locations sheet).
 * @private
 */
function qrInvalidateLocationsCache_() {
  try { CacheService.getScriptCache().remove(QR_LOCATIONS_CACHE_KEY); } catch (_) {}
}

function qrSetupLocationsSheet() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(QR_CONFIG.LOCATIONS_SH)) {
    return { created: false, message: "Locations sheet already exists." };
  }
  var sh = ss.insertSheet(QR_CONFIG.LOCATIONS_SH);
  sh.getRange(1, 1).setValue(QR_CONFIG.LOCATIONS_HDR);
  sh.getRange(2, 1, 10, 1).setValues([
    ["WW1"], ["Rec-Dock"], ["A-01-01"], ["A-01-02"], ["A-01-03"],
    ["A1.1E"], ["A1.2E"], ["B-01-01"], ["B-01-02"], ["B-01-03"]
  ]);
  sh.setFrozenRows(1);
  return { created: true };
}

/* ============================================================
   SCAN — BATCH LOCATION UPDATE
   v1.3.0: 5-digit-only filter removed — any non-empty normalized ID is valid.
   Uses qrNormalizeCodeList_() for trimming, deduping, and prefix stripping.
   ============================================================ */

/**
 * Update the Location column for a list of item IDs.
 * Accepts any non-empty string ID (e.g. "1234", "01234", "AB-10027").
 * Also accepts typed payloads like "ITEM:01234" — prefix is stripped.
 *
 * @param {string[]} itemIds  - Array of item ID strings (bare or ITEM:-prefixed).
 * @param {string}   location - Target location code.
 * @returns {{ success, results: { updated[], notFound[], errors[] } }}
 */
function qrUpdateLocations(itemIds, location) {
  if (!itemIds || !itemIds.length) {
    return { success: false, message: "No items provided." };
  }
  location = String(location || "").trim();
  // Strip LOC: prefix if caller passed a typed location
  if (String(location).toUpperCase().indexOf('LOC:') === 0) location = String(location).substring(4).trim();
  if (!location) {
    return { success: false, message: "No location provided." };
  }

  /* Normalize: trim, dedupe, strip ITEM: prefix, drop empties */
  var cleanIds = qrNormalizeCodeList_(itemIds);
  if (!cleanIds.length) {
    return { success: false, message: "No valid item IDs after normalization." };
  }

  /* Acquire script lock (15-second wait) */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { success: false, message: "Another update is in progress. Please try again in a moment." };
  }

  try {
    var results = { updated: [], notFound: [], errors: [] };

    /* Build initial group; if any items miss, rebuild once & retry */
    var index   = qrEnsureFreshIndexForIds_(qrGetOrBuildIndex(), cleanIds);
    var bySheet = groupItemsBySheet_(cleanIds, index, results);

    /* If there are still unresolved items, do one rebuild and retry */
    if (results.notFound.length > 0) {
      Logger.log("qrUpdateLocations: " + results.notFound.length + " item(s) not in cache — rebuilding index");
      qrBuildIndex();
      var freshIndex = qrGetCachedIndex() || {};

      var retryIds    = results.notFound.slice();
      results.notFound = [];
      var retryGroups = groupItemsBySheet_(retryIds, freshIndex, results);

      var retryKeys = Object.keys(retryGroups);
      for (var rk = 0; rk < retryKeys.length; rk++) {
        var sid = retryKeys[rk];
        if (!bySheet[sid]) bySheet[sid] = [];
        bySheet[sid] = bySheet[sid].concat(retryGroups[sid]);
      }
    }

    /* Batch write: read full Location column, capture FROM, patch rows, write back, log moves */
    var userEmail = '';
    try { userEmail = Session.getActiveUser().getEmail() || ''; } catch (ue) {}

    var sheetIds = Object.keys(bySheet);
    for (var si = 0; si < sheetIds.length; si++) {
      var sheetId = sheetIds[si];
      var items   = bySheet[sheetId];
      if (!items.length) continue;

      try {
        var css      = SpreadsheetApp.openById(sheetId);
        var validated = validateInventorySheet_(css, items[0].clientName);
        var inv       = validated.inv;
        var colLoc    = validated.colLoc;

        var lastRow  = inv.getLastRow();
        var locRange = inv.getRange(1, colLoc + 1, lastRow, 1);
        var locVals  = locRange.getValues();

        var moveRows = []; // collect {itemId, fromLoc, toLoc} for history logging

        for (var ii = 0; ii < items.length; ii++) {
          var rowIdx = items[ii].row - 1;
          if (rowIdx >= 0 && rowIdx < locVals.length) {
            var fromLoc = String(locVals[rowIdx][0] || '').trim();
            locVals[rowIdx][0] = location;
            results.updated.push({ itemId: items[ii].itemId, clientName: items[ii].clientName });
            moveRows.push({ itemId: items[ii].itemId, fromLoc: fromLoc, toLoc: location });
          } else {
            results.errors.push({ itemId: items[ii].itemId, error: "Row index out of range: " + items[ii].row });
          }
        }

        locRange.setValues(locVals);
        SpreadsheetApp.flush();

        /* Log move history — best-effort, don't fail the move if logging fails */
        if (moveRows.length > 0) {
          try {
            qrLogMoveHistory_(css, moveRows, userEmail);
          } catch (logErr) {
            Logger.log("Move history logging failed for " + sheetId + ": " + logErr);
          }
        }

        /* v2.3.0: Supabase mirror write — best-effort, never fails the move.
           PATCH only location + updated_at so we don't touch any other column. */
        for (var mi = 0; mi < moveRows.length; mi++) {
          qrSupabasePatchLocation_(sheetId, moveRows[mi].itemId, moveRows[mi].toLoc);
        }

      } catch (sheetErr) {
        for (var fi = 0; fi < items.length; fi++) {
          results.errors.push({ itemId: items[fi].itemId, error: sheetErr.message });
        }
      }
    }

    // v2.3.0: if anything was actually moved, invalidate the cached Locations
    // list. The target location may be new (awaiting sheet registration) but
    // even if not, flushing on write is a cheap guarantee that autocomplete
    // won't go stale after back-office edits to the Locations tab.
    if (results.updated.length > 0) {
      qrInvalidateLocationsCache_();
    }

    return { success: true, results: results };

  } finally {
    lock.releaseLock();
  }
}

/**
 * Group a list of item IDs by sheetId using the provided index.
 * Items not found in the index are added to results.notFound.
 * @private
 */
function groupItemsBySheet_(ids, index, results) {
  var bySheet = {};
  for (var i = 0; i < ids.length; i++) {
    var entry = index[ids[i]];
    if (!entry) {
      results.notFound.push(ids[i]);
      continue;
    }
    if (!bySheet[entry.sheetId]) bySheet[entry.sheetId] = [];
    bySheet[entry.sheetId].push({ itemId: ids[i], row: entry.row, clientName: entry.clientName });
  }
  return bySheet;
}

/* ============================================================
   ITEM LOOKUP — single item
   ============================================================ */

function qrLookupItem(itemId) {
  itemId = qrNormalizeScannedCode_(itemId);
  if (!itemId) return null;

  var index = qrEnsureFreshIndexForIds_(qrGetOrBuildIndex(), [itemId]);
  if (!index || index.__buildFailed) {
    return { found: false, itemId: itemId, error: 'Index build failed — please try Rebuild Index.' };
  }
  var entry = index[itemId];
  if (!entry) return { found: false, itemId: itemId };

  try {
    var css       = SpreadsheetApp.openById(entry.sheetId);
    var validated = validateInventorySheet_(css, entry.clientName);
    var inv       = validated.inv;
    var hMap      = validated.hMap;
    var row       = inv.getRange(entry.row, 1, 1, inv.getLastColumn()).getDisplayValues()[0];

    function f(col) {
      var idx = hMap[col.toUpperCase()];
      return (idx !== undefined) ? String(row[idx] || "") : "";
    }

    return {
      found:           true,
      itemId:          itemId,
      clientName:      entry.clientName,
      vendor:          f("VENDOR"),
      description:     f("DESCRIPTION"),
      sidemark:        f("SIDEMARK"),
      room:            f("ROOM"),
      currentLocation: f(QR_CONFIG.LOCATION_COL),
      itemClass:       f("CLASS")
    };
  } catch (e) {
    return { found: false, itemId: itemId, clientName: entry.clientName, error: e.message };
  }
}

/* ============================================================
   ITEM LOOKUP — bulk  (Section G)
   Returns an object keyed by item ID for O(1) lookup on the client.
   Groups by sheet to minimize SpreadsheetApp.openById() calls.
   ============================================================ */

/**
 * Bulk lookup for multiple item IDs.
 * Accepts bare IDs or ITEM:-prefixed typed payloads.
 *
 * @param  {string[]} itemIds
 * @returns {{ [itemId]: { found, itemId, clientName?, vendor?, description?,
 *                         sidemark?, room?, currentLocation?, itemClass?, error? } }}
 */
function qrLookupItems(itemIds) {
  var cleanIds = qrNormalizeCodeList_(itemIds);
  if (!cleanIds.length) return {};

  var index   = qrEnsureFreshIndexForIds_(qrGetOrBuildIndex(), cleanIds);
  if (!index || index.__buildFailed) return { __buildFailed: true };
  var results = {};

  /* Initialise not-found entries */
  for (var i = 0; i < cleanIds.length; i++) {
    results[cleanIds[i]] = { found: false, itemId: cleanIds[i] };
  }

  /* Group found IDs by sheet */
  var bySheet = {};
  for (var j = 0; j < cleanIds.length; j++) {
    var id    = cleanIds[j];
    var entry = index[id];
    if (!entry) continue;
    if (!bySheet[entry.sheetId]) bySheet[entry.sheetId] = [];
    bySheet[entry.sheetId].push({ itemId: id, row: entry.row, clientName: entry.clientName });
  }

  /* Fetch rows, one open per sheet */
  var sheetIds = Object.keys(bySheet);
  for (var si = 0; si < sheetIds.length; si++) {
    var sheetId    = sheetIds[si];
    var sheetItems = bySheet[sheetId];
    try {
      var css       = SpreadsheetApp.openById(sheetId);
      var validated = validateInventorySheetForLabels_(css, sheetItems[0].clientName);
      var inv       = validated.inv;
      var hMap      = validated.hMap;
      var colLoc    = validated.colLoc;

      for (var ii = 0; ii < sheetItems.length; ii++) {
        var item = sheetItems[ii];
        try {
          var rowVals = inv.getRange(item.row, 1, 1, inv.getLastColumn()).getDisplayValues()[0];
          function getCol(col) {
            var idx = hMap[col.toUpperCase()];
            return (idx !== undefined) ? String(rowVals[idx] || '') : '';
          }
          results[item.itemId] = {
            found:           true,
            itemId:          item.itemId,
            clientName:      item.clientName,
            vendor:          getCol('VENDOR'),
            description:     getCol('DESCRIPTION'),
            sidemark:        getCol('SIDEMARK'),
            room:            getCol('ROOM'),
            currentLocation: (colLoc !== undefined) ? String(rowVals[colLoc] || '') : '',
            itemClass:       getCol('CLASS')
          };
        } catch (rowErr) {
          results[item.itemId] = { found: false, itemId: item.itemId, error: rowErr.message };
          Logger.log('qrLookupItems row error [' + item.itemId + ']: ' + rowErr);
        }
      }
    } catch (sheetErr) {
      for (var fi = 0; fi < sheetItems.length; fi++) {
        results[sheetItems[fi].itemId] = {
          found: false, itemId: sheetItems[fi].itemId, error: sheetErr.message
        };
      }
      Logger.log('qrLookupItems sheet error [' + sheetId + ']: ' + sheetErr);
    }
  }

  return results;
}

/* ============================================================
   MOVE HISTORY — logging + reading
   ============================================================ */

/**
 * Auto-create Move History tab on a client sheet if it doesn't exist.
 * Returns the sheet (existing or new).
 */
function qrEnsureMoveHistorySheet_(ss) {
  var sh = ss.getSheetByName(MOVE_HISTORY_SH);
  if (sh) return sh;
  sh = ss.insertSheet(MOVE_HISTORY_SH);
  sh.getRange(1, 1, 1, MOVE_HISTORY_HDRS.length).setValues([MOVE_HISTORY_HDRS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, MOVE_HISTORY_HDRS.length)
    .setFontWeight('bold')
    .setBackground('#f3f3f3');
  return sh;
}

/**
 * Log move history rows to the Move History tab on a client spreadsheet.
 * @param {Spreadsheet} ss - The client spreadsheet object (already open).
 * @param {Array<{itemId:string, fromLoc:string, toLoc:string}>} moveRows
 * @param {string} userEmail - The email of the person who performed the move.
 */
function qrLogMoveHistory_(ss, moveRows, userEmail) {
  if (!moveRows || !moveRows.length) return;
  var sh = qrEnsureMoveHistorySheet_(ss);
  var now = new Date();
  var rows = [];
  for (var i = 0; i < moveRows.length; i++) {
    rows.push([
      now,                           // Timestamp
      userEmail || '',               // User
      moveRows[i].itemId,            // Item ID
      moveRows[i].fromLoc || '',     // From Location
      moveRows[i].toLoc || '',       // To Location
      'Location'                     // Type
    ]);
  }
  var lastRow = sh.getLastRow();
  sh.getRange(lastRow + 1, 1, rows.length, MOVE_HISTORY_HDRS.length).setValues(rows);
}

/**
 * Read move history for a specific item from a client sheet.
 * @param {string} sheetId - Client spreadsheet ID.
 * @param {string} itemId - The item ID to filter by.
 * @returns {{ moves: Array<{timestamp, user, itemId, fromLocation, toLocation}> }}
 */
function qrGetMoveHistory(sheetId, itemId) {
  if (!sheetId) return { error: "No sheetId provided." };
  if (!itemId) return { error: "No itemId provided." };
  itemId = qrNormalizeScannedCode_(itemId);

  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheetByName(MOVE_HISTORY_SH);
    if (!sh || sh.getLastRow() < 2) return { moves: [] };

    var data = sh.getRange(2, 1, sh.getLastRow() - 1, MOVE_HISTORY_HDRS.length).getDisplayValues();
    var moves = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][2]).trim() === itemId) {
        moves.push({
          timestamp:    data[i][0],
          user:         data[i][1],
          itemId:       data[i][2],
          fromLocation: data[i][3],
          toLocation:   data[i][4],
          type:         data[i][5] || 'Location'
        });
      }
    }
    return { moves: moves };
  } catch (e) {
    return { error: e.message };
  }
}

/* ============================================================
   VALIDATE ITEMS — pre-commit validation for manual mode
   Returns lookup results so frontend can block on bad IDs.
   ============================================================ */

function qrValidateItems(itemIds) {
  var cleanIds = qrNormalizeCodeList_(itemIds);
  if (!cleanIds.length) return { valid: false, message: "No valid item IDs." };
  return qrLookupItems(cleanIds);
}

/* ============================================================
   LABEL PRINTER — DATA & CONFIG
   ============================================================ */

function qrGetItemsForLabels(itemIds) {
  var out = { items: [], notFound: [], errors: [] };
  if (!itemIds || !itemIds.length) return out;

  var index;
  try {
    index = qrGetOrBuildIndex();
  } catch (buildErr) {
    out.errors.push({ itemId: '*', error: 'Index build failed: ' + buildErr.message });
    return out;
  }
  if (!index || index.__buildFailed) {
    out.errors.push({ itemId: '*', error: 'Index build failed — please try Rebuild Index.' });
    return out;
  }

  /* Normalize IDs (strip ITEM: prefix if present) */
  var cleanIds = qrNormalizeCodeList_(itemIds);
  index = qrEnsureFreshIndexForIds_(index, cleanIds);
  if (!index || index.__buildFailed) {
    out.errors.push({ itemId: '*', error: 'Index build failed — please try Rebuild Index.' });
    return out;
  }

  var bySheet = {};
  for (var i = 0; i < cleanIds.length; i++) {
    var id    = cleanIds[i];
    var entry = index[id];
    if (!entry) {
      out.notFound.push(id);
      continue;
    }
    if (!bySheet[entry.sheetId]) bySheet[entry.sheetId] = [];
    bySheet[entry.sheetId].push({ itemId: id, row: entry.row, clientName: entry.clientName });
  }

  var sheetIds = Object.keys(bySheet);
  for (var si = 0; si < sheetIds.length; si++) {
    var sheetId    = sheetIds[si];
    var sheetItems = bySheet[sheetId];
    try {
      var css       = SpreadsheetApp.openById(sheetId);
      var validated = validateInventorySheetForLabels_(css, sheetItems[0].clientName);
      var inv       = validated.inv;
      var hMap      = validated.hMap;
      var colLoc    = validated.colLoc;

      for (var ii = 0; ii < sheetItems.length; ii++) {
        var item = sheetItems[ii];
        try {
          var rowVals = inv.getRange(item.row, 1, 1, inv.getLastColumn()).getDisplayValues()[0];
          var getCol  = function(hm, rv, col) {
            var idx = hm[col.toUpperCase()];
            return (idx !== undefined) ? String(rv[idx] || '') : '';
          };
          out.items.push({
            itemId:      item.itemId,
            clientName:  item.clientName,
            vendor:      getCol(hMap, rowVals, 'VENDOR'),
            description: getCol(hMap, rowVals, 'DESCRIPTION'),
            sidemark:    getCol(hMap, rowVals, 'SIDEMARK'),
            room:        getCol(hMap, rowVals, 'ROOM'),
            location:    (colLoc !== undefined) ? String(rowVals[colLoc] || '') : '',
            itemClass:   getCol(hMap, rowVals, 'CLASS')
          });
        } catch (rowErr) {
          out.errors.push({ itemId: item.itemId, error: rowErr.message });
          Logger.log('qrGetItemsForLabels row error [' + item.itemId + ']: ' + rowErr);
        }
      }
    } catch (sheetErr) {
      for (var fi = 0; fi < sheetItems.length; fi++) {
        out.errors.push({ itemId: sheetItems[fi].itemId, error: sheetErr.message });
      }
      Logger.log('qrGetItemsForLabels sheet error [' + sheetId + ']: ' + sheetErr);
    }
  }

  return out;
}

/* ============================================================
   DEBUG LOOKUP  (diagnostic, not used in production flow)
   Call via ?action=debugLookup&payload={"itemIds":["12345","67890"]}
   ============================================================ */

function qrDebugLookup(itemIds) {
  var index   = qrGetOrBuildIndex();
  var results = [];
  if (!itemIds || !itemIds.length) {
    return { indexSize: Object.keys(index).length, results: [] };
  }
  for (var i = 0; i < itemIds.length; i++) {
    var id    = qrNormalizeScannedCode_(itemIds[i]);
    var entry = index[id];
    var info  = { itemId: id, inIndex: !!entry };
    if (entry) {
      info.clientName = entry.clientName;
      info.sheetId    = entry.sheetId;
      info.row        = entry.row;
    }
    results.push(info);
  }
  return { indexSize: Object.keys(index).length, results: results };
}

/**
 * Get label config for a specific label type.
 * Supports dual config: item labels and location labels stored separately.
 * Backward-compatible: absent labelType defaults to 'item'; migrates legacy key on first read.
 * @param {string=} labelType  'item' (default) or 'location'
 */
function qrGetLabelConfig(labelType) {
  var type  = (labelType === 'location') ? 'location' : 'item';
  var props = PropertiesService.getUserProperties();
  var key   = (type === 'location') ? 'QR_LABEL_CONFIG_LOCATION' : 'QR_LABEL_CONFIG_ITEM';

  var stored = props.getProperty(key);
  if (stored) {
    return { config: JSON.parse(stored), availableFields: QR_LABEL_FIELDS };
  }

  // Item mode: migrate from legacy QR_LABEL_CONFIG if it exists
  if (type === 'item') {
    var legacy = props.getProperty("QR_LABEL_CONFIG");
    if (legacy) {
      var parsed = JSON.parse(legacy);
      // Copy to new key (one-time migration); legacy key preserved
      props.setProperty(key, legacy);
      return { config: parsed, availableFields: QR_LABEL_FIELDS };
    }
  }

  // Return type-appropriate defaults
  var defaultConfig;
  if (type === 'location') {
    defaultConfig = {
      labelType: 'location',
      labelSize: '3x2',
      fields: [
        { key: 'location', enabled: true, fontSize: 28 },
        { key: 'warehouse', enabled: false, fontSize: 14 },
        { key: 'zone', enabled: false, fontSize: 12 },
        { key: 'row', enabled: false, fontSize: 12 },
        { key: 'bay', enabled: false, fontSize: 12 },
        { key: 'level', enabled: false, fontSize: 12 },
        { key: 'notes', enabled: false, fontSize: 10 }
      ],
      qrSize:     110,
      showQr:     true,
      showBorder: true
    };
  } else {
    defaultConfig = {
      labelType: 'item',
      fields:   ["qr", "itemId", "client", "sidemark", "vendor", "description", "location"],
      qrSize:   120,
      fontSize: 10
    };
  }
  return { config: defaultConfig, availableFields: QR_LABEL_FIELDS };
}

/**
 * Save label config, routing to type-specific key based on config.labelType.
 * Backward-compatible: absent labelType defaults to 'item'.
 */
function qrSaveLabelConfig(config) {
  var type = (config && config.labelType === 'location') ? 'location' : 'item';
  var key  = (type === 'location') ? 'QR_LABEL_CONFIG_LOCATION' : 'QR_LABEL_CONFIG_ITEM';
  PropertiesService.getUserProperties()
    .setProperty(key, JSON.stringify(config));
  return { success: true };
}

/**
 * Upsert location codes into the Locations sheet.
 * Adds only codes that don't already exist (case-insensitive comparison).
 * @param {string[]} codes  Array of location code strings
 * @returns {{ success:boolean, added:string[], existed:string[], total:number }}
 */
function qrUpsertLocations(codes) {
  if (!codes || !Array.isArray(codes) || !codes.length) {
    return { success: false, error: "No location codes provided." };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, error: "Another update is in progress. Please try again." };
  }

  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(QR_CONFIG.LOCATIONS_SH);
    if (!sh) {
      // Auto-create if missing
      sh = ss.insertSheet(QR_CONFIG.LOCATIONS_SH);
      sh.getRange(1, 1).setValue(QR_CONFIG.LOCATIONS_HDR);
      sh.setFrozenRows(1);
    }

    // Read existing codes into a Set (uppercase for case-insensitive compare)
    var existingSet = {};
    if (sh.getLastRow() >= 2) {
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        var v = String(vals[i][0] || "").trim();
        if (v) existingSet[v.toUpperCase()] = true;
      }
    }

    var added   = [];
    var existed = [];
    for (var j = 0; j < codes.length; j++) {
      var code = String(codes[j] || "").trim();
      if (!code) continue;
      if (existingSet[code.toUpperCase()]) {
        existed.push(code);
      } else {
        added.push(code);
        existingSet[code.toUpperCase()] = true; // prevent dupes within batch
      }
    }

    // Append new codes
    if (added.length) {
      var rows = added.map(function (c) { return [c]; });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 1).setValues(rows);
    }

    return { success: true, added: added, existed: existed, total: added.length + existed.length };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
   v2.3.0: SUPABASE MIRROR WRITE (best-effort)
   Patches inventory.location + updated_at for a single item so the
   React app's Supabase read cache reflects scanner moves in seconds
   instead of waiting for the periodic full sync.
   Architectural invariant #20: never block the authoritative Sheets
   write on a Supabase failure. All errors are logged and swallowed.
   Requires script properties:
     - SUPABASE_URL                (e.g. https://xxx.supabase.co)
     - SUPABASE_SERVICE_ROLE_KEY   (service_role JWT — NEVER ship to browser)
   ============================================================ */
function qrSupabasePatchLocation_(tenantId, itemId, location) {
  try {
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty('SUPABASE_URL');
    var key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      // Only log once per execution — avoids spamming logs on every move.
      if (!qrSupabasePatchLocation_._warned) {
        Logger.log('qrSupabasePatchLocation_: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set on scanner project — skipping Supabase mirror');
        qrSupabasePatchLocation_._warned = true;
      }
      return;
    }

    var endpoint = url + '/rest/v1/inventory'
      + '?tenant_id=eq.' + encodeURIComponent(tenantId)
      + '&item_id=eq.'  + encodeURIComponent(itemId);

    var resp = UrlFetchApp.fetch(endpoint, {
      method: 'patch',
      headers: {
        'apikey':        key,
        'Authorization': 'Bearer ' + key,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal'
      },
      payload: JSON.stringify({
        location:   String(location || ''),
        updated_at: new Date().toISOString()
      }),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log('qrSupabasePatchLocation_ HTTP ' + code + ' for ' + tenantId + '/' + itemId + ': ' + resp.getContentText().substring(0, 200));
    }
  } catch (e) {
    Logger.log('qrSupabasePatchLocation_ error (non-fatal) for ' + tenantId + '/' + itemId + ': ' + e);
  }
}
