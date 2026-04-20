/* ===================================================
   run-remote.mjs — v1.5.0 — 2026-03-31 10:00 AM PST
   =================================================== */
/**
 * Remotely executes a function on client Apps Script projects
 * via Web App HTTP POST endpoints (doPost in RemoteAdmin.gs).
 *
 * Usage:
 *   npm run health-check
 *   npm run update-headers
 *   npm run install-triggers
 *   npm run refresh-caches        (async — two-phase: caches + rate recalc)
 *   npm run sync-caches           (async — lightweight cache copy only)
 *   npm run sync-status           (check async operation status)
 *
 * Filters:
 *   npm run remote -- --fn=StrideRemoteHealthCheck_ --client="Brian"
 *   npm run remote -- --fn=StrideRemoteHealthCheck_ --group=pilot
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENTS_PATH = join(__dirname, 'clients.json');
const CRED_PATH = join(__dirname, '.credentials.json');

// ── Argument parsing ──────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { fn: null, client: null, group: null };
  for (const arg of args) {
    if (arg.startsWith('--fn=')) opts.fn = arg.split('=')[1];
    else if (arg.startsWith('--client=')) opts.client = arg.split('=')[1];
    else if (arg.startsWith('--group=')) opts.group = arg.split('=')[1];
    else console.warn('Unknown argument:', arg);
  }
  return opts;
}

// ── Auth ──────────────────────────────────────────────────────────────────

function getAuthClient() {
  if (!existsSync(CRED_PATH)) {
    console.error('ERROR: No credentials found. Run: npm run setup');
    process.exit(1);
  }
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  oauth2.setCredentials({
    refresh_token: creds.refresh_token,
    access_token: creds.access_token,
    token_type: creds.token_type || 'Bearer',
    expiry_date: creds.expiry_date
  });
  return oauth2;
}

// ── Client loading ────────────────────────────────────────────────────────

function loadClients(opts) {
  const { clients } = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8'));
  let filtered = clients.filter(c => c.enabled !== false);
  if (opts.client) {
    filtered = filtered.filter(c => c.name.toLowerCase().includes(opts.client.toLowerCase()));
  } else if (opts.group) {
    filtered = filtered.filter(c => c.group === opts.group);
  }
  return filtered;
}

// ── Token + action mapping ────────────────────────────────────────────────

const REMOTE_EXEC_TOKEN = 'stride-remote-exec-9f3a2';

const FN_TO_ACTION = {
  'StrideRemoteHealthCheck_':     'health_check',
  'StrideRemoteUpdateHeaders_':   'update_headers',
  'StrideRemoteInstallTriggers_': 'install_triggers',
  'StrideRemoteRefreshCaches_':   'refresh_caches',
  'StrideRemoteSyncCaches_':      'sync_caches',
  'StrideRemoteSyncStatus_':      'sync_status',
  'StrideRemoteAddNotificationEmail_': 'add_notification_email',
  'StrideRemoteBackfillImpFolders_':   'backfill_imp_folders',
};

// Human-readable labels for each action
const ACTION_LABELS = {
  'health_check':     'Health Check',
  'update_headers':   'Update Headers',
  'install_triggers': 'Install Triggers',
  'refresh_caches':   'Refresh Caches (full)',
  'sync_caches':      'Sync Caches (quick)',
  'sync_status':      'Sync Status',
  'add_notification_email': 'Add Warehouse Email to NOTIFICATION_EMAILS',
  'backfill_imp_folders':   'Backfill IMP Shipments-tab folder URLs',
};

// ── Formatting helpers ────────────────────────────────────────────────────

function formatTime(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (_) { return isoStr; }
}

function padEnd(str, len) {
  str = String(str);
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function statusIcon(status) {
  switch (status) {
    case 'success':  return '\x1b[32m\u2713\x1b[0m';  // green checkmark
    case 'pending':  return '\x1b[33m\u2713\x1b[0m';  // yellow checkmark
    case 'running':  return '\x1b[33m\u23F3\x1b[0m';  // yellow hourglass
    case 'failed':   return '\x1b[31m\u2717\x1b[0m';  // red X
    case 'error':    return '\x1b[31m\u2717\x1b[0m';  // red X
    default:         return '\x1b[90m\u2022\x1b[0m';  // gray bullet
  }
}

// ── Web App execution ─────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 120000;

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function executeViaWebApp(client, fnName) {
  const action = FN_TO_ACTION[fnName] || fnName;
  const payload = JSON.stringify({ token: REMOTE_EXEC_TOKEN, action });

  try {
    const auth = getAuthClient();
    const { token } = await auth.getAccessToken();
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    let res = await fetchWithTimeout(client.webAppUrl, {
      method: 'POST', headers, body: payload, redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) {
        res = await fetchWithTimeout(location, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          redirect: 'follow',
        });
      }
    }

    const text = await res.text();
    if (!text.startsWith('{') && !text.startsWith('[')) {
      return { client: client.name, status: 'ERROR', message: `Non-JSON (HTTP ${res.status})` };
    }

    const data = JSON.parse(text);
    if (data.error) return { client: client.name, status: 'ERROR', message: data.error, result: data };
    if (data.ok === false) return { client: client.name, status: 'ERROR', message: data.message || 'ok=false', result: data };
    return { client: client.name, status: 'SUCCESS', result: data };
  } catch (err) {
    return { client: client.name, status: 'ERROR', message: err.message || String(err) };
  }
}

async function executeOnClient(script, client, fnName) {
  if (client.webAppUrl) return executeViaWebApp(client, fnName);

  try {
    const res = await script.scripts.run({
      scriptId: client.scriptId,
      requestBody: { function: fnName, devMode: true }
    });
    if (res.data.error) {
      const errMsg = (res.data.error.details || []).map(d => d.errorMessage || JSON.stringify(d)).join('; ') || 'Unknown error';
      return { client: client.name, status: 'ERROR', message: errMsg };
    }
    const returnValue = res.data.response?.result ?? null;
    if (returnValue && typeof returnValue === 'object' && returnValue.ok === false) {
      return { client: client.name, status: 'ERROR', message: returnValue.message || 'ok=false', result: returnValue };
    }
    return { client: client.name, status: 'SUCCESS', result: returnValue };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || String(err);
    return { client: client.name, status: 'ERROR', message: msg };
  }
}

// ── Result formatting ─────────────────────────────────────────────────────

function formatResult(result, actionKey) {
  const r = result.result;

  if (result.status === 'ERROR') {
    return { icon: statusIcon('error'), detail: `\x1b[31m${result.message}\x1b[0m`, subline: null };
  }

  if (!r || typeof r !== 'object') {
    return { icon: statusIcon('success'), detail: 'OK', subline: null };
  }

  // sync_status — show sync state
  if (r.action === 'sync_status' && r.syncStatus) {
    const st = r.syncStatus;
    const time = st === 'success' || st === 'failed'
      ? formatTime(r.completedAt)
      : (st === 'pending' ? formatTime(r.queuedAt) : '');
    const timeStr = time && time !== '-' ? ` at ${time}` : '';
    return {
      icon: statusIcon(st),
      detail: `\x1b[1m${st}\x1b[0m${timeStr}`,
      subline: r.message ? `\x1b[90m${r.message}\x1b[0m` : null,
    };
  }

  // Async pending responses (sync_caches, refresh_caches)
  if (r.status === 'pending' && r.queuedAt) {
    return {
      icon: statusIcon('pending'),
      detail: `\x1b[33mpending\x1b[0m  queued ${formatTime(r.queuedAt)}`,
      subline: null,
    };
  }

  // health_check
  if (r.action === 'health_check' && r.details) {
    const d = r.details;
    const trigStr = `triggers: ${d.triggerCount}`;
    const reqStr = d.missingRequired?.length ? `\x1b[31mmissing: ${d.missingRequired.join(', ')}\x1b[0m` : '';
    const optStr = d.missingOptional?.length ? `\x1b[33moptional missing: ${d.missingOptional.join(', ')}\x1b[0m` : '';
    return {
      icon: statusIcon(r.ok ? 'success' : 'failed'),
      detail: trigStr,
      subline: [reqStr, optStr].filter(Boolean).join('  ') || null,
    };
  }

  // install_triggers
  if (r.action === 'install_triggers' && r.details) {
    return {
      icon: statusIcon('success'),
      detail: `${r.details.triggerCount} triggers installed`,
      subline: r.details.triggers?.length ? `\x1b[90m[${r.details.triggers.join(', ')}]\x1b[0m` : null,
    };
  }

  // update_headers (synchronous)
  if (r.message) {
    return { icon: statusIcon('success'), detail: r.message, subline: null };
  }

  return { icon: statusIcon('success'), detail: 'OK', subline: null };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!opts.fn) {
    console.log('\n  \x1b[1mStride Remote Admin\x1b[0m\n');
    console.log('  Quick commands (via npm run):');
    console.log('    health-check        Check required tabs, triggers, master ID');
    console.log('    update-headers      Update headers + validations on all tabs');
    console.log('    install-triggers    Reinstall all triggers');
    console.log('    \x1b[36msync-caches\x1b[0m         Quick sync: push prices, classes, emails, locations');
    console.log('    \x1b[36mrefresh-caches\x1b[0m      Full refresh: sync + recalculate unbilled rates');
    console.log('    \x1b[36msync-status\x1b[0m          Check status of last async operation');
    console.log('');
    console.log('  Filters:');
    console.log('    --client="Name"     Run on single client (partial match)');
    console.log('    --group=pilot       Run on group only');
    console.log('');
    process.exit(1);
  }

  const clients = loadClients(opts);
  if (clients.length === 0) {
    console.log('No matching clients found.');
    process.exit(0);
  }

  const actionKey = FN_TO_ACTION[opts.fn] || opts.fn;
  const actionLabel = ACTION_LABELS[actionKey] || opts.fn;
  const maxNameLen = Math.max(...clients.map(c => c.name.length), 20);

  // Header
  console.log('');
  console.log(`  \x1b[1m\x1b[36m${actionLabel}\x1b[0m  \x1b[90m(${clients.length} client${clients.length > 1 ? 's' : ''})\x1b[0m`);
  console.log(`  ${'─'.repeat(maxNameLen + 40)}`);

  const auth = getAuthClient();
  const script = google.script({ version: 'v1', auth });

  const results = [];
  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    process.stdout.write(`  \x1b[90m...\x1b[0m ${padEnd(client.name, maxNameLen)}  `);

    const result = await executeOnClient(script, client, opts.fn);
    results.push(result);

    const fmt = formatResult(result, actionKey);

    // Clear the line and rewrite with final result
    process.stdout.write('\r');
    process.stdout.write(`  ${fmt.icon}  ${padEnd(client.name, maxNameLen)}  ${fmt.detail}\n`);
    if (fmt.subline) {
      console.log(`       ${' '.repeat(maxNameLen)}${fmt.subline}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const success = results.filter(r => r.status === 'SUCCESS').length;
  const errors  = results.filter(r => r.status === 'ERROR').length;
  // For sync-status, count running separately
  const running = results.filter(r => r.result?.syncStatus === 'running').length;
  const failed  = results.filter(r => r.result?.syncStatus === 'failed').length;

  console.log(`  ${'─'.repeat(maxNameLen + 40)}`);

  if (actionKey === 'sync_status') {
    const suc = results.filter(r => r.result?.syncStatus === 'success').length;
    const nev = results.filter(r => r.result?.syncStatus === 'never').length;
    const parts = [];
    if (suc)     parts.push(`\x1b[32m${suc} success\x1b[0m`);
    if (running) parts.push(`\x1b[33m${running} running\x1b[0m`);
    if (failed)  parts.push(`\x1b[31m${failed} failed\x1b[0m`);
    if (nev)     parts.push(`\x1b[90m${nev} never\x1b[0m`);
    if (errors)  parts.push(`\x1b[31m${errors} error\x1b[0m`);
    console.log(`  Total: ${results.length}  |  ${parts.join('  |  ')}`);
  } else {
    const parts = [`Total: ${results.length}`];
    if (success) parts.push(`\x1b[32m${success} OK\x1b[0m`);
    if (errors)  parts.push(`\x1b[31m${errors} failed\x1b[0m`);
    console.log(`  ${parts.join('  |  ')}`);
  }

  if (errors > 0) {
    console.log('');
    results.filter(r => r.status === 'ERROR').forEach(r => {
      console.log(`  \x1b[31m\u2717\x1b[0m  ${r.client}: ${r.message}`);
    });
  }

  console.log('');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
