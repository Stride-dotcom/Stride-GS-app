/***************************************************************
 * QR Scanner — IndexBuilder.gs  v1.3.0
 * Builds & caches a global Item ID → {sheetId, clientName, row}
 * index across all active client Inventory sheets.
 *
 * Cache: CacheService (script scope), chunked at 90 KB/key, 6h TTL.
 * On cache miss, index is rebuilt automatically.
 *
 * Scheduled trigger target: qrScheduledIndexRebuild()
 *
 * v1.1.0:
 * - FIX: Duplicate Item ID detection (warns + keeps first occurrence)
 * - FIX: Index size safeguard (warns if large, fails gracefully if
 *        cache store is rejected)
 * - UPD: Uses QR_CONFIG for sheet/column names (defined in ScannerBackend.gs)
 *
 * v1.2.0:
 * - FIX: qrGetOrBuildIndex returns { __buildFailed: true } on any failure
 *        (previously returned {} which was indistinguishable from empty index)
 *
 * v1.3.0:
 * - FIX: qrBuildIndex now uses getDisplayValues() so displayed item IDs,
 *        including leading zeros, are preserved in the cache key
 ***************************************************************/

var IDX_PREFIX    = "QR_IDX_";
var IDX_CHUNK     = 90000;    // bytes — under CacheService 100 KB/key limit
var IDX_TTL       = 21600;    // 6 hours
var IDX_WARN_SIZE = 500000;   // 500 KB — log a warning above this threshold

/* Defensive fallback: QR_CONFIG is defined in ScannerBackend.gs (same project).
   If this file is ever run in isolation or loaded before ScannerBackend.gs,
   _QR provides safe defaults so qrBuildIndex() still works. */
var _QR = (typeof QR_CONFIG !== "undefined") ? QR_CONFIG : {
  INVENTORY_SH: "Inventory",
  ITEM_ID_COL:  "ITEM ID",
  LOCATION_COL: "LOCATION",
  STATUS_COL:   "STATUS"
};

/* ============================================================
   BUILD
   FIX #7: Duplicate detection
   FIX #8: Index size safeguard
   ============================================================ */

/**
 * Scan all active client Inventory sheets and build the index.
 * Returns {
 *   success: true,
 *   stats: { clients, items, duplicates[], errors[] }
 * }
 * On cache-store failure returns { success: false, message, stats }.
 */
function qrBuildIndex() {
  var clients = getActiveClients_();
  var index   = {};
  var stats   = { clients: 0, items: 0, duplicates: [], errors: [] };

  for (var ci = 0; ci < clients.length; ci++) {
    var client = clients[ci];
    try {
      var css = SpreadsheetApp.openById(client.id);
      /* use QR_CONFIG sheet name (defined in ScannerBackend.gs, same project scope) */
      var inv = css.getSheetByName(_QR.INVENTORY_SH);
      if (!inv || inv.getLastRow() < 2) continue;

      var lastRow = inv.getLastRow();
      var lastCol = inv.getLastColumn();
      if (lastCol < 1) continue;

      var vals = inv.getRange(1, 1, lastRow, lastCol).getDisplayValues();
      var hdr  = vals[0];

      /* find Item ID column */
      var colItemId = -1;
      for (var h = 0; h < hdr.length; h++) {
        if (String(hdr[h]).trim().toUpperCase() === _QR.ITEM_ID_COL) {
          colItemId = h;
          break;
        }
      }
      if (colItemId < 0) {
        Logger.log("qrBuildIndex: no '" + _QR.ITEM_ID_COL + "' column in " + client.name);
        continue;
      }

      /* find Status column (optional — if absent, index all rows) */
      var statusColName = (_QR.STATUS_COL || "STATUS").toUpperCase();
      var colStatus = -1;
      for (var h = 0; h < hdr.length; h++) {
        if (String(hdr[h]).trim().toUpperCase() === statusColName) {
          colStatus = h;
          break;
        }
      }

      /* index each row */
      for (var r = 1; r < vals.length; r++) {
        var itemId = String(vals[r][colItemId] || "").trim();
        if (!itemId) continue;

        /* skip non-Active items when Status column is present */
        if (colStatus >= 0) {
          var status = String(vals[r][colStatus] || "").trim().toLowerCase();
          if (status !== "active") continue;
        }

        /* FIX #7 — duplicate detection */
        if (index[itemId]) {
          var existing = index[itemId];
          var dupMsg   = "Item ID " + itemId + " found in both '" + existing.clientName +
                         "' (kept) and '" + client.name + "' (ignored)";
          stats.duplicates.push(dupMsg);
          Logger.log("qrBuildIndex DUPLICATE: " + dupMsg);
          /* keep first occurrence — do NOT overwrite */
          continue;
        }

        index[itemId] = {
          sheetId:    client.id,
          clientName: client.name,
          row:        r + 1     // 1-based sheet row
        };
        stats.items++;
      }
      stats.clients++;

    } catch (err) {
      stats.errors.push(client.name + ": " + err.message);
      Logger.log("qrBuildIndex error [" + client.name + "]: " + err);
    }
  }

  /* FIX #8 — size safeguard */
  var json      = JSON.stringify(index);
  var indexSize = json.length;

  if (indexSize > IDX_WARN_SIZE) {
    Logger.log("qrBuildIndex WARNING: index is " + indexSize + " bytes (" +
               Math.round(indexSize / 1024) + " KB). Consider archiving inactive items.");
  } else {
    Logger.log("qrBuildIndex: " + stats.items + " items, " + indexSize + " bytes");
  }

  /* attempt to store; return clear failure if cache rejects it */
  var stored = qrStoreIndex_(json);
  if (!stored) {
    var msg = "Index too large to cache (" + Math.round(indexSize / 1024) + " KB). " +
              "Try reducing active clients or archiving inventory rows.";
    Logger.log("qrBuildIndex FAILED: " + msg);
    return { success: false, message: msg, stats: stats };
  }

  return { success: true, stats: stats };
}

/* ============================================================
   CACHE — STORE / RETRIEVE
   ============================================================ */

/**
 * Store pre-serialized index JSON in CacheService, chunked.
 * Returns true on success, false if CacheService rejects.
 * @param {string} json  Already-serialized index.
 */
function qrStoreIndex_(json) {
  var chunks = [];
  for (var i = 0; i < json.length; i += IDX_CHUNK) {
    chunks.push(json.substring(i, i + IDX_CHUNK));
  }
  var cache = CacheService.getScriptCache();
  var puts  = {};
  puts[IDX_PREFIX + "COUNT"] = String(chunks.length);
  for (var c = 0; c < chunks.length; c++) {
    puts[IDX_PREFIX + c] = chunks[c];
  }
  try {
    cache.putAll(puts, IDX_TTL);
    /* verify the write succeeded by reading COUNT back */
    var verify = cache.get(IDX_PREFIX + "COUNT");
    return (verify === String(chunks.length));
  } catch (e) {
    Logger.log("qrStoreIndex_ cache error: " + e);
    return false;
  }
}

/**
 * Returns the cached index object, or null on miss/expiry.
 */
function qrGetCachedIndex() {
  var cache    = CacheService.getScriptCache();
  var countStr = cache.get(IDX_PREFIX + "COUNT");
  if (!countStr) return null;

  var count = parseInt(countStr, 10);
  var parts = [];
  for (var i = 0; i < count; i++) {
    var part = cache.get(IDX_PREFIX + i);
    if (part === null) return null;   // a chunk expired
    parts.push(part);
  }
  try {
    return JSON.parse(parts.join(""));
  } catch (e) {
    Logger.log("qrGetCachedIndex parse error: " + e);
    return null;
  }
}

/**
 * Returns the index, building it if not cached.
 * Returns { __buildFailed: true } if the build fails or throws,
 * so callers (qrGetItemsForLabels, qrDebugLookup) can surface the
 * failure rather than silently returning empty results.
 */
function qrGetOrBuildIndex() {
  try {
    var idx = qrGetCachedIndex();
    if (idx) return idx;
    var result = qrBuildIndex();
    if (!result.success) {
      Logger.log("qrGetOrBuildIndex: build failed — " + result.message);
      return { __buildFailed: true };
    }
    return qrGetCachedIndex() || { __buildFailed: true };
  } catch (e) {
    Logger.log("qrGetOrBuildIndex exception: " + e);
    return { __buildFailed: true };
  }
}

/* ============================================================
   PUBLIC — REFRESH & TRIGGER
   ============================================================ */

/**
 * Force a full rebuild (callable from Scanner UI).
 * Returns { success, stats } or { success: false, message, stats }.
 */
function qrRefreshIndex() {
  var cache    = CacheService.getScriptCache();
  var countStr = cache.get(IDX_PREFIX + "COUNT");
  if (countStr) {
    var count = parseInt(countStr, 10);
    var keys  = [IDX_PREFIX + "COUNT"];
    for (var i = 0; i < count; i++) keys.push(IDX_PREFIX + i);
    cache.removeAll(keys);
  }
  return qrBuildIndex();
}

/** Scheduled trigger target — runs every 6 hours. */
function qrScheduledIndexRebuild() {
  var result = qrBuildIndex();
  Logger.log("QR Index auto-rebuild: success=" + result.success +
             " items=" + (result.stats ? result.stats.items : "?"));
}

/** Install time-based trigger for index auto-refresh. */
function qrInstallIndexTrigger() {
  qrRemoveIndexTrigger();
  ScriptApp.newTrigger("qrScheduledIndexRebuild")
    .timeBased()
    .everyHours(6)
    .create();
  return { success: true };
}

/** Remove any existing index triggers. */
function qrRemoveIndexTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "qrScheduledIndexRebuild") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
