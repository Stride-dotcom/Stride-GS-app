/* ===================================================
   verify-triggers.mjs — v3.0.0 — 2026-03-25 10:00 PM
   =================================================== */
/**
 * Reads _TRIGGER_STATE from each client's Settings sheet via Sheets API.
 * Reports trigger health, staleness, and "never reported" clients.
 *
 * IMPORTANT: This reads *reported* trigger state, not live ScriptApp state.
 * Each client must have run verifyTriggers() from the menu at least once.
 *
 * Usage:
 *   node admin/verify-triggers.mjs
 *   node admin/verify-triggers.mjs --client=ClientA
 *   node admin/verify-triggers.mjs --group=pilot
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENTS_PATH = join(__dirname, 'clients.json');
const CRED_PATH = join(__dirname, '.credentials.json');

const EXPECTED_TRIGGERS = [
  'onClientEdit',
  'onTaskEdit_',
  'onRepairEdit_',
  'onShipmentEdit_',
  'onWillCallEdit_'
];

// --- Auth ---

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

// --- Client loading ---

function loadClients() {
  const args = process.argv.slice(2);
  let clientFilter = null;
  let groupFilter = null;

  for (const arg of args) {
    if (arg.startsWith('--client=')) clientFilter = arg.split('=')[1];
    if (arg.startsWith('--group=')) groupFilter = arg.split('=')[1];
  }

  const { clients } = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8'));
  let filtered = clients.filter(c => c.enabled !== false);

  if (clientFilter) {
    filtered = filtered.filter(c => c.name.toLowerCase() === clientFilter.toLowerCase());
  } else if (groupFilter) {
    filtered = filtered.filter(c => c.group === groupFilter);
  }

  return filtered;
}

// --- Verify single client ---

async function verifyClient(sheets, client) {
  try {
    // Read Settings sheet
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: client.spreadsheetId,
      range: 'Settings!A:B'
    });

    const rows = res.data.values || [];
    let triggerState = null;

    for (const row of rows) {
      if (row[0] && String(row[0]).trim() === '_TRIGGER_STATE') {
        try {
          triggerState = JSON.parse(row[1]);
        } catch {
          triggerState = null;
        }
        break;
      }
    }

    if (!triggerState) {
      return {
        client: client.name,
        status: 'NEVER_REPORTED',
        message: 'No _TRIGGER_STATE found — run verifyTriggers() from menu',
        ok: false
      };
    }

    // Check trigger count
    const handlerNames = (triggerState.triggers || []).map(t => t.fn);
    const missingTriggers = EXPECTED_TRIGGERS.filter(fn => !handlerNames.includes(fn));
    const extraTriggers = handlerNames.filter(fn => !EXPECTED_TRIGGERS.includes(fn));

    // Check staleness (older than 7 days)
    const reportedAt = new Date(triggerState.timestamp);
    const ageMs = Date.now() - reportedAt.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const stale = ageDays > 7;

    const ok = missingTriggers.length === 0 && !stale;

    return {
      client: client.name,
      status: ok ? 'HEALTHY' : 'ISSUES',
      version: triggerState.version,
      triggerCount: triggerState.triggerCount,
      missingTriggers,
      extraTriggers: extraTriggers.length > 0 ? extraTriggers : undefined,
      reportedAt: triggerState.timestamp,
      ageDays,
      stale,
      ok
    };
  } catch (err) {
    return {
      client: client.name,
      status: 'ERROR',
      message: err.message,
      ok: false
    };
  }
}

// --- Main ---

async function main() {
  console.log('\n=== Stride Client Inventory — Trigger Verification ===\n');

  const clients = loadClients();
  if (clients.length === 0) {
    console.log('No clients to verify.');
    process.exit(0);
  }

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`Checking ${clients.length} client(s)...\n`);

  const results = [];
  for (const client of clients) {
    process.stdout.write(`  ${client.name}... `);
    const result = await verifyClient(sheets, client);
    results.push(result);

    if (result.ok) {
      console.log(`HEALTHY (v${result.version}, ${result.triggerCount} triggers, ${result.ageDays}d ago)`);
    } else if (result.status === 'NEVER_REPORTED') {
      console.log('NEVER REPORTED — needs verifyTriggers() run');
    } else if (result.status === 'ERROR') {
      console.log(`ERROR: ${result.message}`);
    } else {
      const issues = [];
      if (result.missingTriggers?.length) issues.push(`missing: ${result.missingTriggers.join(', ')}`);
      if (result.stale) issues.push(`stale (${result.ageDays}d)`);
      console.log(`ISSUES: ${issues.join('; ')}`);
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Summary
  const healthy = results.filter(r => r.ok).length;
  const issues = results.filter(r => !r.ok && r.status === 'ISSUES').length;
  const neverReported = results.filter(r => r.status === 'NEVER_REPORTED').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  console.log(`\n--- Summary ---`);
  console.log(`Total: ${results.length} | Healthy: ${healthy} | Issues: ${issues} | Never Reported: ${neverReported} | Errors: ${errors}`);

  if (neverReported > 0) {
    console.log(`\nClients needing verifyTriggers() run:`);
    results.filter(r => r.status === 'NEVER_REPORTED').forEach(r => {
      console.log(`  - ${r.client}`);
    });
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
