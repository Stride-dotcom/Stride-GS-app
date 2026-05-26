/**
 * Trigger oneshotFixStorageAuditCorrections via the Stride API Web App.
 *
 * Uses the same Bearer-token + redirect:'manual' pattern as run-remote.mjs
 * because Google Apps Script Web Apps require this to preserve the POST
 * body across the 302 redirect that the macros.execute URL issues.
 *
 * Auth: dual — Bearer OAuth token (so the request reaches Apps Script
 * with the script-owner identity), plus the API_TOKEN as a URL param
 * (so the doPost guard accepts it).
 *
 * Usage: node admin/trigger-oneshot-via-webapp.mjs
 */
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');
const API_TOKEN = process.env.API_TOKEN || 'stride-prod-2026';
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz7v3wu3bXAR3mXSako_DcSDzcT9WZZ0wvcX06OeGmxd-gT1P1w-nSTNx0aF3Z2KNbq/exec';
const ACTION = 'oneshotFixStorageAuditCorrections';

function getAuthClient() {
  if (!existsSync(CRED_PATH)) {
    throw new Error('No .credentials.json — run: npm run setup');
  }
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  oauth2.setCredentials({
    refresh_token: creds.refresh_token,
    access_token: creds.access_token,
    token_type: creds.token_type || 'Bearer',
    expiry_date: creds.expiry_date,
  });
  return oauth2;
}

async function main() {
  const auth = getAuthClient();
  const { token } = await auth.getAccessToken();

  const url = `${WEB_APP_URL}?token=${encodeURIComponent(API_TOKEN)}&action=${encodeURIComponent(ACTION)}`;
  const body = JSON.stringify({ requestId: 'oneshot-2026-05-25-storage-audit' });

  console.log(`POST ${url.substring(0, 80)}...`);
  const start = Date.now();

  let res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body,
    redirect: 'manual',
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) {
      console.log(`Redirect ${res.status} -> following with Bearer...`);
      res = await fetch(loc, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        redirect: 'follow',
      });
    }
  }

  const ms = Date.now() - start;
  const text = await res.text();
  console.log(`HTTP ${res.status} in ${ms}ms`);
  console.log(`Body (first 500 chars): ${text.substring(0, 500)}`);

  if (!text.startsWith('{') && !text.startsWith('[')) {
    console.error('Non-JSON response — aborting');
    process.exit(1);
  }

  const json = JSON.parse(text);
  if (json.error) {
    console.error('SCRIPT ERROR:', json.error);
    process.exit(1);
  }
  const r = json.result || json;
  console.log('\n=== SUMMARY ===');
  console.log(`totalAttempted:       ${r?.totalAttempted}`);
  console.log(`sheetEditsApplied:    ${r?.sheetEditsApplied}`);
  console.log(`sheetNoops:           ${r?.sheetNoops}`);
  console.log(`itemsNotFound:        ${r?.itemsNotFound}`);
  console.log(`sbPatchesSucceeded:   ${r?.sbPatchesSucceeded}`);
  console.log(`errorCount:           ${r?.errorCount}`);
  if (r?.errors?.length) {
    console.log('\n=== ERRORS ===');
    for (const e of r.errors) console.log(`  - ${e}`);
  }
  if (r?.perItemLog?.length) {
    console.log('\n=== PER-ITEM LOG ===');
    for (const line of r.perItemLog) console.log(`  ${line}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
