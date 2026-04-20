/**
 * sync-web-app-urls.mjs — Syncs client Web App URLs from clients.json
 * to the CB Clients sheet "Web App URL" column.
 *
 * Run after: npm run deploy-clients
 * Usage: node admin/sync-web-app-urls.mjs
 *
 * Prerequisites:
 *   - CB Clients sheet must have a "Web App URL" column header
 *   - clients.json must be up to date (npm run sync)
 */

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENTS_PATH = join(__dirname, 'clients.json');
const CRED_PATH = join(__dirname, '.credentials.json');

// CB Spreadsheet ID — same one used by StrideAPI
const CB_SPREADSHEET_ID = '16Yqap3i-nuBWTL9yQGjpuDNEybKCaE8IlM2mb9VJTq8';

const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
const clientsJson = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8')).clients;

// Build spreadsheetId → webAppUrl map
const urlMap = {};
for (const c of clientsJson) {
  if (c.spreadsheetId && c.webAppUrl && c.enabled !== false) {
    urlMap[c.spreadsheetId] = c.webAppUrl;
  }
}

console.log(`\n  Syncing ${Object.keys(urlMap).length} Web App URLs to CB Clients sheet...\n`);

const auth = new google.auth.OAuth2();
auth.setCredentials(creds);
const sheets = google.sheets({ version: 'v4', auth });

try {
  // Read the Clients sheet
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: CB_SPREADSHEET_ID,
    range: 'Clients',
  });

  const rows = resp.data.values || [];
  if (rows.length < 2) {
    console.log('  ❌ No client rows found in CB Clients sheet');
    process.exit(1);
  }

  const headers = rows[0].map(h => String(h).trim());
  const ssIdIdx = headers.indexOf('Client Spreadsheet ID');
  const nameIdx = headers.indexOf('Client Name');
  let webAppIdx = headers.indexOf('Web App URL');

  if (ssIdIdx < 0) {
    console.log('  ❌ "Client Spreadsheet ID" column not found');
    process.exit(1);
  }

  if (webAppIdx < 0) {
    console.log('  ⚠️  "Web App URL" column not found — please add it to the CB Clients sheet header row first.');
    process.exit(1);
  }

  // Build updates
  const updates = [];
  let updated = 0;
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const ssId = String(row[ssIdIdx] || '').trim();
    const name = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
    const currentUrl = String(row[webAppIdx] || '').trim();
    const newUrl = urlMap[ssId] || '';

    if (!ssId) continue;

    if (newUrl && newUrl !== currentUrl) {
      // A1 notation for this cell: column letter + row number
      const colLetter = String.fromCharCode(65 + webAppIdx); // works for A-Z
      const cellRef = `Clients!${colLetter}${r + 1}`;
      updates.push({
        range: cellRef,
        values: [[newUrl]],
      });
      console.log(`  ✓ ${name || ssId}: ${newUrl.substring(0, 60)}...`);
      updated++;
    } else if (!newUrl) {
      console.log(`  - ${name || ssId}: no URL in clients.json`);
      skipped++;
    } else {
      skipped++;
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: CB_SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });
    console.log(`\n  ✅ Done. ${updated} URL(s) updated, ${skipped} unchanged.\n`);
  } else {
    console.log(`\n  ✅ All URLs already up to date (${skipped} checked).\n`);
  }
} catch (err) {
  console.error('  ❌ Error:', err.message);
  process.exit(1);
}
