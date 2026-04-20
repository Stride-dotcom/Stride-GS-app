/* ===================================================
   RemoteAdmin.gs — v1.9.0 — 2026-04-17 PST — backfill_imp_folders action
   v1.9.0: Add `backfill_imp_folders` action — rewrites IMP-* rows on the
           Shipments tab so their Shipment # hyperlink points at the real
           legacy photo URL (pulled from the matching Inventory row's
           Shipment # rich-text link) instead of the empty IMP folder that
           Import.gs v4.2.3 used to auto-create. Safe to re-run. Calls
           backfillImpShipmentFolderUrls_() in Import.gs.
   v1.8.0: Add `add_notification_email` action — idempotently appends
           whse@stridenw.com to the Settings!NOTIFICATION_EMAILS value on
           every client. Case-insensitive dedup; preserves existing emails.
   v1.7.0: Truthful update_headers response — returns actual headers added,
           post-write verification asserts Custom Price / required headers
           exist, REMOTE_ADMIN_VERSION stamp on every response, hasCustomPrice
           debug flag. Fixes "OK but nothing changed" silent failure.
   =================================================== */
/**
 * RemoteAdmin.gs
 * Wrapper functions for remote execution via npm run-remote.mjs.
 *
 * Execution path: HTTP POST to Web App (doPost) — does NOT use
 * scripts.run (blocked by Google Workspace org policy in this env).
 *
 * v1.4.0: All heavy operations (refresh_caches, update_headers, sync_caches)
 * are async — fire-and-forget via time-based triggers. Use sync_status to
 * check completion. Only health_check and install_triggers remain synchronous.
 *
 * Return shape: { ok, action, spreadsheetId, spreadsheetName, message?, status?, ... }
 *
 * Setup: deploy each client script as a Web App (Execute as: Me,
 * Anyone can access) and add the URL to clients.json as webAppUrl.
 */

// Shared token — must match REMOTE_EXEC_TOKEN in run-remote.mjs
var REMOTE_EXEC_TOKEN_ = 'stride-remote-exec-9f3a2';

// v1.7.0: Stamp on every remote response so Justin can verify which code
// version is actually live in the Web App snapshot. Bump this whenever
// RemoteAdmin.gs or functions it calls change in a way that matters.
var REMOTE_ADMIN_VERSION = '2026-04-17.1';

// v1.8.0: Internal warehouse email that should be on every client's
// NOTIFICATION_EMAILS. Hardcoded here so the npm one-shot is self-contained.
var WHSE_INTERNAL_EMAIL_ = 'whse@stridenw.com';

// ---------------------------------------------------------------------------
// Web App entry point (HTTP POST from run-remote.mjs)
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.token !== REMOTE_EXEC_TOKEN_) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var result;
    switch (payload.action) {
      case 'health_check':     result = StrideRemoteHealthCheck_();     break;
      case 'update_headers':   result = StrideRemoteUpdateHeaders_();   break;
      case 'install_triggers': result = StrideRemoteInstallTriggers_(); break;
      case 'refresh_caches':   result = StrideRemoteRefreshCaches_();   break;
      case 'sync_caches':      result = StrideRemoteSyncCaches_();      break;
      case 'sync_status':      result = StrideRemoteSyncStatus_();      break;
      case 'add_notification_email':
        result = StrideRemoteAddNotificationEmail_();                   break;
      case 'get_script_id':
        result = StrideRemoteGetScriptId_();                            break;
      case 'backfill_imp_folders':
        result = StrideRemoteBackfillImpFolders_();                    break;
      default:
        result = { ok: false, error: 'Unknown action: ' + payload.action };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ---------------------------------------------------------------------------
// Generic async helper — queues a trigger and writes SYNC_STATUS
// v1.4.0: Shared by refresh_caches, update_headers, and sync_caches
// ---------------------------------------------------------------------------

function queueAsyncAction_(action, triggerFnName) {
  var ss = SpreadsheetApp.getActive();
  var id   = ss ? ss.getId()   : '';
  var name = ss ? ss.getName() : '(unknown)';

  if (!ss) {
    return { ok: false, action: action, spreadsheetId: id, spreadsheetName: name, message: 'getActive() returned null' };
  }

  try {
    // Delete any stale trigger for this function
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === triggerFnName) {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }

    var now = new Date().toISOString();
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'pending');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_QUEUED_AT, now);
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, '');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, action + ' queued — trigger will fire in ~30s');

    ScriptApp.newTrigger(triggerFnName).timeBased().after(30 * 1000).create();

    return {
      ok: true, action: action, spreadsheetId: id, spreadsheetName: name,
      status: 'pending', queuedAt: now,
      message: action + ' queued — will run in ~30s. Use sync-status to check.'
    };
  } catch (err) {
    return { ok: false, action: action, spreadsheetId: id, spreadsheetName: name, message: String(err) };
  }
}

/**
 * Generic trigger runner — self-deletes trigger, writes status to Settings.
 * @param {string} triggerFnName  The trigger function name (for self-deletion)
 * @param {Function} workFn       The actual work function to call
 */
function runAsyncAction_(triggerFnName, workFn) {
  // Self-delete this trigger immediately
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === triggerFnName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  var ss = SpreadsheetApp.getActive();
  if (!ss) return;

  try {
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'running');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, triggerFnName.replace(/^StrideRun|_$/g, '') + ' running...');
    var result = workFn(ss);
    var now = new Date().toISOString();
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'success');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, now);
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, (result && result.message) || triggerFnName + ' completed');
  } catch (err) {
    var nowErr = new Date().toISOString();
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'failed');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, nowErr);
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Error: ' + String(err));
  }
}

// ---------------------------------------------------------------------------
// Health Check (synchronous — lightweight, always fast)
// ---------------------------------------------------------------------------

function StrideRemoteHealthCheck_() {
  var ss = SpreadsheetApp.getActive();
  var id   = ss ? ss.getId()   : '';
  var name = ss ? ss.getName() : '(unknown)';

  if (!ss) {
    return { ok: false, action: 'health_check', spreadsheetId: id, spreadsheetName: name,
             message: 'getActive() returned null — active container unavailable' };
  }

  var required = ['Inventory', 'Tasks', 'Repairs', 'Shipments',
                  'Will_Calls', 'WC_Items', 'Billing_Ledger', 'Settings'];
  var optional = ['Price_Cache', 'Class_Cache', 'Email_Template_Cache',
                  'Location_Cache', 'Autocomplete_DB'];

  var missingRequired = required.filter(function(n) { return !ss.getSheetByName(n); });
  var missingOptional = optional.filter(function(n) { return !ss.getSheetByName(n); });
  var triggers = ScriptApp.getProjectTriggers().map(function(t) { return t.getHandlerFunction(); });

  var masterId = '';
  try { masterId = String(ss.getSheetByName('Settings').getRange('B2').getValue() || ''); } catch (_) {}

  return {
    ok: missingRequired.length === 0,
    action: 'health_check',
    spreadsheetId: id,
    spreadsheetName: name,
    details: {
      missingRequired: missingRequired, missingOptional: missingOptional,
      triggerCount: triggers.length, triggers: triggers, hasMasterId: !!masterId
    }
  };
}

// ---------------------------------------------------------------------------
// Install Triggers (synchronous — fast, just trigger setup)
// ---------------------------------------------------------------------------

function StrideRemoteInstallTriggers_() {
  var ss = SpreadsheetApp.getActive();
  var id   = ss ? ss.getId()   : '';
  var name = ss ? ss.getName() : '(unknown)';

  if (!ss) {
    return { ok: false, action: 'install_triggers', spreadsheetId: id, spreadsheetName: name,
             message: 'getActive() returned null — active container unavailable' };
  }

  try {
    StrideClientInstallTriggers();
    var triggers = ScriptApp.getProjectTriggers().map(function(t) { return t.getHandlerFunction(); });
    return {
      ok: true, action: 'install_triggers', spreadsheetId: id, spreadsheetName: name,
      details: { triggerCount: triggers.length, triggers: triggers }
    };
  } catch (err) {
    return { ok: false, action: 'install_triggers', spreadsheetId: id, spreadsheetName: name, message: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Update Headers — SYNCHRONOUS (v1.5.0: reverted from async — range-based
// validation eliminates >500-item errors, so function completes quickly.
// Async triggers run against frozen Web App deployment snapshots, causing
// stale code execution after rollout. Synchronous avoids this issue.)
// ---------------------------------------------------------------------------

function StrideRemoteUpdateHeaders_() {
  var ss = SpreadsheetApp.getActive();
  var id   = ss ? ss.getId()   : '';
  var name = ss ? ss.getName() : '(unknown)';

  // v1.7.0: hasCustomPrice flag — is the deployed snapshot aware of this
  // header? If false, we know the Web App is stale and deploy-clients must run.
  var deployedKnowsCustomPrice = (typeof TASK_HEADERS !== 'undefined')
    ? (TASK_HEADERS.indexOf('Custom Price') !== -1)
    : false;

  var base = {
    action: 'update_headers',
    spreadsheetId: id,
    spreadsheetName: name,
    remoteAdminVersion: REMOTE_ADMIN_VERSION,
    deployedKnowsCustomPrice: deployedKnowsCustomPrice
  };

  if (!ss) {
    base.ok = false;
    base.message = 'getActive() returned null';
    return base;
  }

  // Capture Tasks sheet header row BEFORE the update so we can report diffs
  var tasksSheetPre = ss.getSheetByName('Tasks');
  var beforeHeaders = [];
  if (tasksSheetPre && tasksSheetPre.getLastColumn() > 0) {
    beforeHeaders = tasksSheetPre.getRange(1, 1, 1, tasksSheetPre.getLastColumn())
      .getValues()[0].map(function(h) { return String(h || '').trim(); }).filter(String);
  }

  try {
    StrideClientUpdateHeadersAndValidations();
    SpreadsheetApp.flush();

    // Post-write verification — re-read header row and report what's actually there
    var tasksSheetPost = ss.getSheetByName('Tasks');
    var afterHeaders = [];
    if (tasksSheetPost && tasksSheetPost.getLastColumn() > 0) {
      afterHeaders = tasksSheetPost.getRange(1, 1, 1, tasksSheetPost.getLastColumn())
        .getValues()[0].map(function(h) { return String(h || '').trim(); }).filter(String);
    }
    var added = afterHeaders.filter(function(h) { return beforeHeaders.indexOf(h) === -1; });
    var customPriceOnSheet = afterHeaders.indexOf('Custom Price') !== -1;

    // Hard fail if the deployed code knows about Custom Price but the column
    // still isn't on the sheet after the update — something is broken.
    if (deployedKnowsCustomPrice && !customPriceOnSheet) {
      base.ok = false;
      base.message = 'Custom Price column missing from Tasks sheet after update — verification failed';
      base.tasksHeadersAdded = added;
      base.tasksHeadersAfter = afterHeaders;
      return base;
    }

    base.ok = true;
    base.message = added.length
      ? 'Headers updated — added: ' + added.join(', ')
      : 'Headers already current — no changes needed';
    base.tasksHeadersAdded = added;
    base.tasksHasCustomPrice = customPriceOnSheet;
    return base;
  } catch (err) {
    base.ok = false;
    base.message = String(err);
    return base;
  }
}

/** Legacy trigger handler — kept for backwards compatibility with stale triggers */
function StrideRunUpdateHeaders_() {
  runAsyncAction_('StrideRunUpdateHeaders_', function(_ss) {
    StrideClientUpdateHeadersAndValidations();
    return { message: 'Headers + validations updated' };
  });
}

// ---------------------------------------------------------------------------
// Refresh Caches — ASYNC TWO-PHASE (v1.6.0)
//   Phase 1: Copy all cache tabs (fast, <2 min) + apply dropdowns
//   Phase 2: Recalculate unbilled billing rates (slow on big sheets)
// Each phase runs in its own trigger so neither exceeds 6-min limit.
// ---------------------------------------------------------------------------

function StrideRemoteRefreshCaches_() {
  return queueAsyncAction_('refresh_caches', 'StrideRunRefreshCaches_');
}

/** Phase 1 trigger: sync cache tabs + dropdowns, then queue Phase 2 */
function StrideRunRefreshCaches_() {
  // Self-delete this trigger
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'StrideRunRefreshCaches_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  var ss = SpreadsheetApp.getActive();
  if (!ss) return;

  try {
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'running');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Phase 1/2: syncing caches + dropdowns...');

    // --- Phase 1 work: cache copy + dropdowns (same as SyncCachesOnly + dropdowns) ---
    var result = StrideClientSyncCachesOnly_();
    if (result && result.ok === false) {
      setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'failed');
      setSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, new Date().toISOString());
      setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Phase 1 failed: ' + (result.message || 'unknown'));
      return;
    }

    // Apply dropdown validations (fast — range-based, no 500-item issue)
    try { applyClassDropdownValidationFromCache_(); } catch (_) {}
    try { applyLocationDropdownFromCache_(); } catch (_) {}
    try { applyDockIntakeLocationDropdown_(); } catch (_) {}

    // --- Queue Phase 2 (rate recalc) in 30s ---
    // Delete any stale Phase 2 trigger first
    var allTriggers = ScriptApp.getProjectTriggers();
    for (var j = 0; j < allTriggers.length; j++) {
      if (allTriggers[j].getHandlerFunction() === 'StrideRunRefreshCachesPhase2_') {
        ScriptApp.deleteTrigger(allTriggers[j]);
      }
    }

    ScriptApp.newTrigger('StrideRunRefreshCachesPhase2_').timeBased().after(30 * 1000).create();
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Phase 1 done (caches + dropdowns). Phase 2 queued (rate recalc)...');
  } catch (err) {
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'failed');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, new Date().toISOString());
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Phase 1 error: ' + String(err));
  }
}

/** Phase 2 trigger: recalculate unbilled billing rates */
function StrideRunRefreshCachesPhase2_() {
  // Self-delete this trigger
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'StrideRunRefreshCachesPhase2_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  var ss = SpreadsheetApp.getActive();
  if (!ss) return;

  try {
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Phase 2/2: recalculating unbilled rates...');

    var rateResult = recalcUnbilledRates_(ss);
    var rateMsg = rateResult.updated > 0
      ? rateResult.updated + ' of ' + rateResult.total + ' unbilled rates updated'
      : 'No unbilled rates to update';

    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'success');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, new Date().toISOString());
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Full refresh complete: caches + dropdowns synced, ' + rateMsg);
  } catch (err) {
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS, 'failed');
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT, new Date().toISOString());
    setSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE, 'Phase 2 error (rate recalc): ' + String(err));
  }
}

// ---------------------------------------------------------------------------
// Sync Caches — ASYNC (v1.3.0: fire-and-forget, lightweight, no rate recalc)
// ---------------------------------------------------------------------------

function StrideRemoteSyncCaches_() {
  return queueAsyncAction_('sync_caches', 'StrideRunSyncCaches_');
}

/** Trigger handler for async sync-caches */
function StrideRunSyncCaches_() {
  runAsyncAction_('StrideRunSyncCaches_', function(_ss) {
    var result = StrideClientSyncCachesOnly_();
    return { message: (result && result.message) || 'Caches synced' };
  });
}

// ---------------------------------------------------------------------------
// Sync Status — reads SYNC_* settings (synchronous — just reads 4 values)
// ---------------------------------------------------------------------------

function StrideRemoteSyncStatus_() {
  var ss = SpreadsheetApp.getActive();
  var id   = ss ? ss.getId()   : '';
  var name = ss ? ss.getName() : '(unknown)';

  if (!ss) {
    return { ok: false, action: 'sync_status', spreadsheetId: id, spreadsheetName: name, message: 'getActive() returned null' };
  }

  return {
    ok: true,
    action: 'sync_status',
    spreadsheetId: id,
    spreadsheetName: name,
    syncStatus:  getSetting_(ss, CI_SETTINGS_KEYS.SYNC_STATUS) || 'never',
    queuedAt:    getSetting_(ss, CI_SETTINGS_KEYS.SYNC_QUEUED_AT) || '',
    completedAt: getSetting_(ss, CI_SETTINGS_KEYS.SYNC_COMPLETED_AT) || '',
    message:     getSetting_(ss, CI_SETTINGS_KEYS.SYNC_MESSAGE) || ''
  };
}

// ---------------------------------------------------------------------------
// v1.8.0: Add warehouse email to NOTIFICATION_EMAILS
// Idempotent — reads the current value, splits on commas/semicolons/whitespace,
// appends WHSE_INTERNAL_EMAIL_ only if not already present (case-insensitive),
// and writes back a clean comma-separated list.
// ---------------------------------------------------------------------------

function StrideRemoteAddNotificationEmail_() {
  var ss = SpreadsheetApp.getActive();
  var id   = ss ? ss.getId()   : '';
  var name = ss ? ss.getName() : '(unknown)';

  if (!ss) {
    return { ok: false, action: 'add_notification_email', spreadsheetId: id, spreadsheetName: name,
             message: 'getActive() returned null — active container unavailable' };
  }

  var target = WHSE_INTERNAL_EMAIL_;
  var before = String(getSetting_(ss, 'NOTIFICATION_EMAILS') || '').trim();

  // Split on commas, semicolons, or whitespace runs — handles every historical format.
  var parts = before ? before.split(/[,;\s]+/).filter(function(s){ return s && s.indexOf('@') > 0; }) : [];
  var already = false;
  var targetLc = target.toLowerCase();
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase() === targetLc) { already = true; break; }
  }

  if (already) {
    return {
      ok: true, action: 'add_notification_email',
      spreadsheetId: id, spreadsheetName: name,
      changed: false, before: before, after: before,
      message: target + ' already present — no change'
    };
  }

  parts.push(target);
  var after = parts.join(', ');
  setSetting_(ss, 'NOTIFICATION_EMAILS', after);

  return {
    ok: true, action: 'add_notification_email',
    spreadsheetId: id, spreadsheetName: name,
    changed: true, before: before, after: after,
    message: 'Added ' + target + ' → "' + after + '"'
  };
}

/**
 * StrideRemoteGetScriptId_ — returns the bound script's own ID, persists to
 * Settings._SCRIPT_ID, AND writes to CB Clients SCRIPT ID column for this
 * sheet's row. Called via doPost action 'get_script_id'.
 *
 * v1.5.1: authoritative self-report path. The client's bound script knows
 * its own id via ScriptApp.getScriptId() and already has access to CB via
 * CONSOLIDATED_BILLING_SPREADSHEET_ID in Settings. Running this on all
 * clients populates CB in one pass — no guesswork from Drive searches.
 */
function StrideRemoteGetScriptId_() {
  try {
    var scriptId = ScriptApp.getScriptId();
    var ss = SpreadsheetApp.getActive();
    var ssId = ss ? ss.getId() : '';
    var ssName = ss ? ss.getName() : '(unknown)';
    var cbWriteStatus = 'skipped';

    // Persist to this sheet's Settings so future lookups find it locally
    if (ss && scriptId) {
      try { setSetting_(ss, '_SCRIPT_ID', scriptId); } catch (_) {}
    }

    // Write to CB Clients SCRIPT ID column — the real fix.
    if (ss && scriptId) {
      try {
        var cbId = getSetting_(ss, 'CONSOLIDATED_BILLING_SPREADSHEET_ID');
        if (cbId) {
          var cbSs = SpreadsheetApp.openById(cbId);
          var cbClients = cbSs.getSheetByName('Clients');
          if (cbClients) {
            var cbData = cbClients.getDataRange().getValues();
            var hdr = cbData[0];
            var sheetIdCol = -1, scriptIdCol = -1;
            for (var h = 0; h < hdr.length; h++) {
              var hk = String(hdr[h] || '').trim().toUpperCase();
              if (hk === 'CLIENT SPREADSHEET ID') sheetIdCol = h;
              if (hk === 'SCRIPT ID') scriptIdCol = h;
            }
            if (sheetIdCol >= 0 && scriptIdCol >= 0) {
              for (var r = 1; r < cbData.length; r++) {
                if (String(cbData[r][sheetIdCol] || '').trim() === ssId) {
                  cbClients.getRange(r + 1, scriptIdCol + 1).setValue(scriptId);
                  cbWriteStatus = 'written to CB row ' + (r + 1);
                  break;
                }
              }
              if (cbWriteStatus === 'skipped') cbWriteStatus = 'CB has no row for this sheetId';
            } else {
              cbWriteStatus = 'CB missing CLIENT SPREADSHEET ID or SCRIPT ID columns';
            }
          } else {
            cbWriteStatus = 'CB Clients tab not found';
          }
        } else {
          cbWriteStatus = 'CONSOLIDATED_BILLING_SPREADSHEET_ID not set in Settings';
        }
      } catch (cbErr) {
        cbWriteStatus = 'CB write failed: ' + String(cbErr);
      }
    }

    return {
      ok: true, action: 'get_script_id',
      spreadsheetId: ssId, spreadsheetName: ssName,
      scriptId: scriptId,
      cbWrite: cbWriteStatus,
      message: 'Script ID: ' + scriptId + ' | CB: ' + cbWriteStatus
    };
  } catch (err) {
    return { ok: false, action: 'get_script_id', error: String(err) };
  }
}

/**
 * StrideRemoteBackfillImpFolders_ — v1.9.0
 *
 * Walks the Shipments tab, finds every IMP-* row whose Shipment # cell is
 * hyperlinked to an empty Drive folder (created by Import.gs v4.2.3), and
 * rewrites the hyperlink to the real legacy photo URL collected on the
 * matching Inventory rows. Delegates to backfillImpShipmentFolderUrls_()
 * in Import.gs.
 *
 * Invoked via: npm run remote -- --fn=StrideRemoteBackfillImpFolders_
 */
function StrideRemoteBackfillImpFolders_() {
  var ss = SpreadsheetApp.getActive();
  var id   = ss ? ss.getId()   : '';
  var name = ss ? ss.getName() : '(unknown)';
  if (!ss) {
    return {
      ok: false, action: 'backfill_imp_folders',
      spreadsheetId: id, spreadsheetName: name,
      remoteAdminVersion: REMOTE_ADMIN_VERSION,
      message: 'getActive() returned null'
    };
  }
  try {
    var res = backfillImpShipmentFolderUrls_(false);
    return {
      ok: !!res.ok,
      action: 'backfill_imp_folders',
      spreadsheetId: id, spreadsheetName: name,
      remoteAdminVersion: REMOTE_ADMIN_VERSION,
      scanned: res.scanned || 0,
      updated: res.updated || 0,
      skippedAlreadyCorrect: res.skippedHadLink || 0,
      noSourceInInventory: res.noSourceInInventory || 0,
      examples: res.examples || [],
      message: res.message || ''
    };
  } catch (err) {
    return {
      ok: false,
      action: 'backfill_imp_folders',
      spreadsheetId: id, spreadsheetName: name,
      remoteAdminVersion: REMOTE_ADMIN_VERSION,
      error: String(err)
    };
  }
}
