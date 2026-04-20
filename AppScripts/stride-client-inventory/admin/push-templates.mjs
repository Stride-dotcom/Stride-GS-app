/**
 * push-templates.mjs
 * Pushes email template HTML from local corrected .txt files to the
 * Master Price List's Email_Templates sheet via Sheets API.
 *
 * Usage: node admin/push-templates.mjs
 *
 * Prerequisites:
 *   - .credentials.json with valid OAuth tokens (run setup if needed)
 *   - MASTER_SPREADSHEET_ID env var or --master=<id> flag
 *     (or hardcode below after first run)
 */
import { google } from 'googleapis';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');
const TEMPLATES_DIR = join(__dirname, '..', '..', '..', 'EMAIL TEMPLATES');
const DOC_TEMPLATES_DIR = join(__dirname, '..', '..', '..', 'Doc Templates');

// Master Price List spreadsheet ID — set via --master=<id> or hardcode here
const MASTER_ID_FLAG = process.argv.find(a => a.startsWith('--master='));
const MASTER_SPREADSHEET_ID = MASTER_ID_FLAG
  ? MASTER_ID_FLAG.split('=')[1]
  : process.env.MASTER_SPREADSHEET_ID
  || '1inonw5cd1YBaPA-dgkP-Rub9wOpqAgOlNE1sOJIdJPY';

// Map local filenames to template keys
const FILE_TO_KEY = {
  'SHIPMENT_RECEIVED_corrected.txt': 'SHIPMENT_RECEIVED',
  'INSP_EMAIL_corrected.txt': 'INSP_EMAIL',
  'TASK_COMPLETE_corrected.txt': 'TASK_COMPLETE',
  'REPAIR_QUOTE_corrected.txt': 'REPAIR_QUOTE',
  'REPAIR_QUOTE_REQUEST_corrected.txt': 'REPAIR_QUOTE_REQUEST',
  'REPAIR_COMPLETE_corrected.txt': 'REPAIR_COMPLETE',
  'REPAIR_APPROVED_corrected.txt': 'REPAIR_APPROVED',
  'REPAIR_DECLINED_corrected.txt': 'REPAIR_DECLINED',
  'WILL_CALL_CREATED_corrected.txt': 'WILL_CALL_CREATED',
  'WILL_CALL_RELEASE_corrected.txt': 'WILL_CALL_RELEASE',
  'WILL_CALL_CANCELLED_corrected.txt': 'WILL_CALL_CANCELLED',
  'TRANSFER_RECEIVED_corrected.txt': 'TRANSFER_RECEIVED',
  'CLAIM_RECEIVED_corrected.txt': 'CLAIM_RECEIVED',
  'CLAIM_STAFF_NOTIFY_corrected.txt': 'CLAIM_STAFF_NOTIFY',
  'CLAIM_MORE_INFO_corrected.txt': 'CLAIM_MORE_INFO',
  'CLAIM_DENIAL_corrected.txt': 'CLAIM_DENIAL',
  'CLAIM_SETTLEMENT_corrected.txt': 'CLAIM_SETTLEMENT',
  'WELCOME_EMAIL_corrected.txt': 'WELCOME_EMAIL',
  'ONBOARDING_EMAIL_corrected.txt': 'ONBOARDING_EMAIL',
  // Doc templates (PDFs attached to emails) — scanned from Doc Templates/ dir
  'DOC_RECEIVING.txt': 'DOC_RECEIVING',
  'DOC_TASK_WORK_ORDER.txt': 'DOC_TASK_WORK_ORDER',
  'DOC_REPAIR_WORK_ORDER.txt': 'DOC_REPAIR_WORK_ORDER',
  'DOC_WILL_CALL_RELEASE.txt': 'DOC_WILL_CALL_RELEASE',
  'DOC_SETTLEMENT.txt': 'DOC_SETTLEMENT',
};

async function main() {
  console.log('=== Push Email Templates to Master Price List ===\n');

  // Auth
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  auth.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    token_type: creds.token_type,
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Read current Email_Templates sheet
  console.log('Reading Email_Templates sheet...');
  let existing;
  try {
    existing = await sheets.spreadsheets.values.get({
      spreadsheetId: MASTER_SPREADSHEET_ID,
      range: 'Email_Templates!A:C',
    });
  } catch (err) {
    console.error('❌ Cannot read Email_Templates sheet:', err.message);
    console.error('   Check MASTER_SPREADSHEET_ID is correct:', MASTER_SPREADSHEET_ID);
    process.exit(1);
  }

  const rows = existing.data.values || [];
  if (rows.length < 2) {
    console.error('❌ Email_Templates sheet appears empty or has no header row');
    process.exit(1);
  }

  // Build header map
  const headers = rows[0];
  const keyCol = headers.findIndex(h => String(h).trim() === 'Template Key');
  const bodyCol = headers.findIndex(h => String(h).trim() === 'HTML Body');
  if (keyCol < 0 || bodyCol < 0) {
    console.error('❌ Missing "Template Key" or "HTML Body" column in headers:', headers);
    process.exit(1);
  }

  // Read local template files from both EMAIL TEMPLATES/ and Doc Templates/
  const emailFiles = readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('_corrected.txt'))
    .map(f => ({ name: f, dir: TEMPLATES_DIR }));
  let docFiles = [];
  try {
    docFiles = readdirSync(DOC_TEMPLATES_DIR)
      .filter(f => f.startsWith('DOC_') && f.endsWith('.txt'))
      .map(f => ({ name: f, dir: DOC_TEMPLATES_DIR }));
  } catch (_) {}
  const localFiles = emailFiles.concat(docFiles);
  console.log(`Found ${emailFiles.length} email + ${docFiles.length} doc template files\n`);

  // Match and prepare updates
  const updates = [];
  let matched = 0;
  let skipped = 0;

  for (const entry of localFiles) {
    const file = entry.name;
    const key = FILE_TO_KEY[file];
    if (!key) { skipped++; continue; }

    const html = readFileSync(join(entry.dir, file), 'utf8').trim();

    // Find matching row in sheet
    const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[keyCol] || '').trim() === key);
    if (rowIdx < 0) {
      console.log(`  ⚠ ${key} — not found in sheet, skipping`);
      skipped++;
      continue;
    }

    // Update HTML Body column (bodyCol is 0-indexed, sheet rows are 1-indexed)
    const cellRange = `Email_Templates!${colLetter(bodyCol)}${rowIdx + 1}`;
    updates.push({
      range: cellRange,
      values: [[html]],
    });
    matched++;
    console.log(`  ✓ ${key} → row ${rowIdx + 1} (${(html.length / 1024).toFixed(1)} KB)`);
  }

  if (updates.length === 0) {
    console.log('\nNo templates to update.');
    return;
  }

  // Batch update
  console.log(`\nPushing ${updates.length} template(s)...`);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: MASTER_SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });

  console.log(`\n✅ Done. ${matched} template(s) updated, ${skipped} skipped.`);
  console.log('\nNext: Run "npm run refresh-caches" to push updated templates to all client sheets.');
}

function colLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) {
    idx--;
    s = String.fromCharCode(65 + (idx % 26)) + s;
    idx = Math.floor(idx / 26);
  }
  return s;
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
