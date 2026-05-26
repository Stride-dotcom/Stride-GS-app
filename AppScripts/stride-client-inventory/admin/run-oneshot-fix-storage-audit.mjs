/**
 * One-shot trigger for oneshot_2026_05_25_FixStorageBillingAuditCorrections_
 * Calls the Apps Script Execution API directly so the function runs as
 * the same script account that owns the per-tenant sheets.
 *
 * Usage: node admin/run-oneshot-fix-storage-audit.mjs
 *
 * Prereqs: .credentials.json must exist (npm run setup if not).
 * The OAuth2 client must have the script.scriptapp scope.
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');

const SCRIPT_ID = '134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M';
const FN_NAME = 'oneshot_2026_05_25_FixStorageBillingAuditCorrections_';

async function main() {
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  auth.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    token_type: creds.token_type || 'Bearer',
    expiry_date: creds.expiry_date,
  });

  const scriptApi = google.script({ version: 'v1', auth });

  console.log(`Calling ${FN_NAME} via Execution API...`);
  const start = Date.now();
  const resp = await scriptApi.scripts.run({
    scriptId: SCRIPT_ID,
    requestBody: {
      function: FN_NAME,
      parameters: [],
      devMode: false,
    },
  });

  const ms = Date.now() - start;
  console.log(`Returned in ${ms}ms. Status: ${resp.status}`);

  if (resp.data.error) {
    console.error('SCRIPT ERROR:');
    console.error(JSON.stringify(resp.data.error, null, 2));
    process.exit(1);
  }

  const result = resp.data.response?.result;
  console.log('SUMMARY:');
  console.log(`  totalAttempted:       ${result?.totalAttempted}`);
  console.log(`  sheetEditsApplied:    ${result?.sheetEditsApplied}`);
  console.log(`  sheetNoops:           ${result?.sheetNoops}`);
  console.log(`  itemsNotFound:        ${result?.itemsNotFound}`);
  console.log(`  sbPatchesSucceeded:   ${result?.sbPatchesSucceeded}`);
  console.log(`  errorCount:           ${result?.errorCount}`);
  if (result?.errors?.length) {
    console.log('ERRORS:');
    for (const e of result.errors) console.log(`  - ${e}`);
  }
  if (result?.perItemLog?.length) {
    console.log('PER-ITEM LOG:');
    for (const line of result.perItemLog) console.log(`  ${line}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  if (e?.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(1);
});
