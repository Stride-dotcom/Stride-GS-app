/* ===================================================
   sync-clients.mjs — v3.0.0 — 2026-03-25 10:00 PM
   =================================================== */
/**
 * Syncs clients.json from the Consolidated Billing Clients tab.
 * Reads client names + spreadsheet IDs from CB, then looks up
 * the bound Apps Script project ID for each via the Drive API.
 *
 * Usage:
 *   node admin/sync-clients.mjs
 *   node admin/sync-clients.mjs --cb=SPREADSHEET_ID
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENTS_PATH = join(__dirname, 'clients.json');
const CRED_PATH = join(__dirname, '.credentials.json');
const CONFIG_PATH = join(__dirname, '.sync-config.json');

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

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

// --- Get CB Spreadsheet ID ---

async function getCbSpreadsheetId() {
  // Check CLI arg
  const cbArg = process.argv.find(a => a.startsWith('--cb='));
  if (cbArg) return cbArg.split('=')[1];

  // Check saved config
  if (existsSync(CONFIG_PATH)) {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (config.cbSpreadsheetId) {
      console.log(`Using saved CB Spreadsheet ID: ${config.cbSpreadsheetId.substring(0, 12)}...`);
      return config.cbSpreadsheetId;
    }
  }

  // Prompt
  console.log('Consolidated Billing Spreadsheet ID needed.');
  console.log('(Open your CB spreadsheet — copy the ID from the URL)');
  console.log('URL format: docs.google.com/spreadsheets/d/{THIS_PART}/edit\n');
  const id = await prompt('CB Spreadsheet ID: ');
  if (!id) {
    console.error('ERROR: No ID provided.');
    process.exit(1);
  }

  // Save for next time
  writeFileSync(CONFIG_PATH, JSON.stringify({ cbSpreadsheetId: id }, null, 2));
  console.log('Saved to .sync-config.json for future runs.\n');
  return id;
}

// --- Read Clients tab ---

async function readClientsTab(sheets, cbId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cbId,
    range: 'Clients!A:Z'
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    console.error('ERROR: Clients tab has no data rows.');
    process.exit(1);
  }

  // Build header map from row 1
  const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
  const nameIdx = headers.indexOf('CLIENT NAME');
  const ssIdIdx = headers.indexOf('CLIENT SPREADSHEET ID');
  const activeIdx = headers.indexOf('ACTIVE');
  const scriptIdIdx = headers.indexOf('SCRIPT ID');
  const webAppUrlIdx = headers.indexOf('WEB APP URL');
  const deployIdIdx = headers.indexOf('DEPLOYMENT ID');

  if (nameIdx === -1 || ssIdIdx === -1) {
    console.error('ERROR: Clients tab missing required columns: Client Name, Client Spreadsheet ID');
    console.error('Found headers:', rows[0].join(', '));
    process.exit(1);
  }

  if (scriptIdIdx === -1) {
    console.log('NOTE: No "Script ID" column found in Clients tab. Add one for easier management.\n');
  }
  if (webAppUrlIdx === -1) {
    console.log('NOTE: No "Web App URL" column found in Clients tab. Add one for remote admin.\n');
  }

  const clients = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[nameIdx] || '').trim();
    const spreadsheetId = String(row[ssIdIdx] || '').trim();
    const active = activeIdx !== -1 ? String(row[activeIdx] || '').trim().toUpperCase() : 'TRUE';
    const scriptId = scriptIdIdx !== -1 ? String(row[scriptIdIdx] || '').trim() : '';
    const webAppUrl = webAppUrlIdx !== -1 ? String(row[webAppUrlIdx] || '').trim() : '';
    const deploymentId = deployIdIdx !== -1 ? String(row[deployIdIdx] || '').trim() : '';

    // Skip empty rows or rows without a spreadsheet ID
    if (!name || !spreadsheetId) continue;

    clients.push({
      name,
      spreadsheetId,
      scriptId,
      webAppUrl,
      deploymentId,
      active: active === 'TRUE' || active === 'YES'
    });
  }

  return clients;
}

// --- Look up script ID from client's Settings tab ---

async function getScriptIdFromSettings(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Settings!A:B'
    });
    const rows = res.data.values || [];
    for (const row of rows) {
      if (row[0] && String(row[0]).trim() === '_SCRIPT_ID') {
        const id = String(row[1] || '').trim();
        if (id) return id;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

// --- Fallback: look up bound script ID via Drive API ---

async function getScriptIdFromDrive(drive, spreadsheetId) {
  try {
    const res = await drive.files.list({
      q: `'${spreadsheetId}' in parents and mimeType = 'application/vnd.google-apps.script'`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// --- Best-effort: enumerate ALL accessible Apps Script projects once,
//     match by parent container. Container-bound scripts often have the
//     spreadsheet id in `parents` but DON'T show up in `'<sheetId>' in parents`
//     queries due to Drive indexing peculiarities. Listing all scripts and
//     matching client-side works around that. ---
let _allScriptsCache = null;
async function buildAllScriptsParentMap(drive) {
  if (_allScriptsCache) return _allScriptsCache;
  const map = new Map(); // spreadsheetId → [{ id, name }]
  try {
    let pageToken = undefined;
    let total = 0;
    do {
      const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.script' and trashed=false",
        fields: 'nextPageToken, files(id, name, parents)',
        pageSize: 1000,
        pageToken,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        corpora: 'allDrives'
      });
      const files = res.data.files || [];
      total += files.length;
      for (const f of files) {
        const parents = f.parents || [];
        for (const p of parents) {
          if (!map.has(p)) map.set(p, []);
          map.get(p).push({ id: f.id, name: f.name });
        }
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    console.log(`    (indexed ${total} accessible Apps Script projects across ${map.size} parents)`);
  } catch (err) {
    console.warn('    Warning: bulk script enumeration failed:', err.message);
  }
  _allScriptsCache = map;
  return map;
}

async function getScriptIdViaBulkDrive(drive, spreadsheetId, clientName) {
  const map = await buildAllScriptsParentMap(drive);
  const scripts = map.get(spreadsheetId);
  if (!scripts || scripts.length === 0) return null;
  if (scripts.length === 1) return scripts[0].id;
  // Multiple scripts share this parent — prefer the one whose name matches the client
  if (clientName) {
    const lc = clientName.toLowerCase();
    const match = scripts.find(s => (s.name || '').toLowerCase().includes(lc));
    if (match) return match.id;
  }
  return scripts[0].id; // last resort
}

// --- Main ---

async function main() {
  console.log('\n=== Stride Client Inventory — Sync Clients from CB ===\n');

  const auth = getAuthClient();

  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  const cbId = await getCbSpreadsheetId();

  // Read Clients tab
  console.log('Reading Clients tab from Consolidated Billing...\n');
  const cbClients = await readClientsTab(sheets, cbId);
  console.log(`Found ${cbClients.length} client(s) with spreadsheet IDs.\n`);

  // Load existing clients.json to preserve groups/notes
  let existingMap = {};
  if (existsSync(CLIENTS_PATH)) {
    const existing = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8'));
    for (const c of existing.clients || []) {
      existingMap[c.spreadsheetId] = c;
    }
  }

  // Look up script IDs
  console.log('Looking up script IDs...\n');
  const clients = [];
  let found = 0;
  let missing = 0;

  for (const cb of cbClients) {
    process.stdout.write(`  ${cb.name}... `);

    const existing = existingMap[cb.spreadsheetId];

    // v3.1.0 — Template row passthrough. When clients.json marks a row as
    // isTemplate: true, preserve its scriptId (normally the master template id,
    // which is blocked everywhere else as pollution) and force enabled=true
    // regardless of CB active state. Rollout pushes code to the template so
    // new clients created from it inherit current code. update-deployments.mjs
    // skips isTemplate rows (no Web App). Settings maintenance in the React app
    // skips the template via CB active=FALSE, which does NOT affect this flag.
    if (existing && existing.isTemplate === true && existing.scriptId) {
      console.log(`TEMPLATE (${existing.scriptId.substring(0, 12)}...)`);
      clients.push({
        name: cb.name,
        spreadsheetId: cb.spreadsheetId,
        scriptId: existing.scriptId,
        webAppUrl: '',           // template has no Web App
        isTemplate: true,
        group: existing.group || 'default',
        enabled: true,           // always include in rollout
        ...(existing.notes ? { notes: existing.notes } : {})
      });
      found++;
      continue;
    }

    // Resolve webAppUrl + deploymentId: CB column first, then cached clients.json
    const resolvedWebAppUrl = cb.webAppUrl || existing?.webAppUrl || '';
    const resolvedDeploymentId = cb.deploymentId || existing?.deploymentId || '';

    // Priority 1: Script ID from CB Clients tab column.
    // Guard: reject the MASTER TEMPLATE's scriptId — legacy onboarding copied
    // it into CB for many clients (44/50 at discovery time). Using it would
    // push every rollout to the template instead of the actual client,
    // silently skipping client updates. Fall through to Settings/Drive lookup.
    const MASTER_TEMPLATE_SCRIPT_ID = '1Pk2Oc0u7RRgMs3sQs96brKDBFNA9vCyKOHZA9jMmk4gkD2yNdTGRlI5T';
    if (cb.scriptId && cb.scriptId !== MASTER_TEMPLATE_SCRIPT_ID) {
      console.log(`from CB (${cb.scriptId.substring(0, 12)}...)`);
      clients.push({
        name: cb.name,
        spreadsheetId: cb.spreadsheetId,
        scriptId: cb.scriptId,
        webAppUrl: resolvedWebAppUrl,
        group: existing?.group || 'default',
        enabled: cb.active,
        ...(existing?.notes ? { notes: existing.notes } : {})
      });
      found++;
      continue;
    }
    if (cb.scriptId === MASTER_TEMPLATE_SCRIPT_ID) {
      // Note but don't use it — log that we're falling through
      process.stdout.write('CB has template id, looking up real script... ');
    }

    // Priority 2: Already cached in clients.json (but NOT the master template's id —
    // that's polluted cache from the previous sync bug; force a fresh lookup)
    if (existing && existing.scriptId && existing.scriptId !== 'PASTE_SCRIPT_ID_HERE' && existing.scriptId !== 'SCRIPT_ID_NOT_FOUND' && existing.scriptId !== MASTER_TEMPLATE_SCRIPT_ID) {
      console.log(`cached (${existing.scriptId.substring(0, 12)}...)`);
      clients.push({
        name: cb.name,
        spreadsheetId: cb.spreadsheetId,
        scriptId: existing.scriptId,
        webAppUrl: resolvedWebAppUrl,
        group: existing.group || 'default',
        enabled: cb.active,
        ...(existing.notes ? { notes: existing.notes } : {})
      });
      found++;
      continue;
    }

    // Priority 3: Read _SCRIPT_ID from client's Settings tab
    // Priority 4: Direct Drive parent-query (unreliable for container-bound)
    // Priority 5: Bulk Drive scan — enumerate all accessible scripts + match
    //            by parent. This is the ONLY reliable path for container-bound
    //            Apps Script projects that Drive doesn't index as parent-child.
    let scriptId = await getScriptIdFromSettings(sheets, cb.spreadsheetId);
    if (scriptId === MASTER_TEMPLATE_SCRIPT_ID) scriptId = null;
    if (!scriptId) scriptId = await getScriptIdFromDrive(drive, cb.spreadsheetId);
    if (scriptId === MASTER_TEMPLATE_SCRIPT_ID) scriptId = null;
    if (!scriptId) scriptId = await getScriptIdViaBulkDrive(drive, cb.spreadsheetId, cb.name);
    if (scriptId === MASTER_TEMPLATE_SCRIPT_ID) scriptId = null;
    if (scriptId) {
      console.log(`found (${scriptId.substring(0, 12)}...)`);
      clients.push({
        name: cb.name,
        spreadsheetId: cb.spreadsheetId,
        scriptId,
        webAppUrl: resolvedWebAppUrl,
        group: existing?.group || 'default',
        enabled: cb.active
      });
      found++;
    } else {
      console.log('NO SCRIPT FOUND — may need onboarding or manual script ID');
      clients.push({
        name: cb.name,
        spreadsheetId: cb.spreadsheetId,
        scriptId: 'SCRIPT_ID_NOT_FOUND',
        webAppUrl: resolvedWebAppUrl,
        group: existing?.group || 'default',
        enabled: false,
        notes: 'Script ID could not be auto-detected — add manually'
      });
      missing++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  // Preserve non-CB clients (e.g., Master Template) that were manually added
  const cbSpreadsheetIds = new Set(cbClients.map(c => c.spreadsheetId));
  for (const [ssId, existing] of Object.entries(existingMap)) {
    if (!cbSpreadsheetIds.has(ssId)) {
      clients.unshift(existing);  // Add to front
      console.log(`  ${existing.name}... preserved (not in CB)`);
      if (existing.scriptId && existing.scriptId !== 'SCRIPT_ID_NOT_FOUND') found++;
    }
  }

  // Write clients.json
  const output = { clients };
  writeFileSync(CLIENTS_PATH, JSON.stringify(output, null, 2));

  console.log(`\n--- Sync Complete ---`);
  console.log(`Total: ${clients.length} | Script IDs found: ${found} | Missing: ${missing}`);
  console.log(`\nclients.json updated at: ${CLIENTS_PATH}`);

  if (missing > 0) {
    console.log('\nClients with missing script IDs (disabled, need manual fix):');
    clients.filter(c => c.scriptId === 'SCRIPT_ID_NOT_FOUND').forEach(c => {
      console.log(`  - ${c.name}`);
    });
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
