/**
 * push-scanner.mjs — v1.0.0 — 2026-03-31
 * Pushes QR Scanner scripts (ScannerBackend.gs, IndexBuilder.gs, Scanner.html,
 * LabelPrinter.html, index.html) to the CB Apps Script project.
 *
 * These files are ADDED to the existing CB project files (not replacing them).
 * Run from: stride-client-inventory/ directory
 * Usage: node admin/push-scanner.mjs
 */
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');
const SCANNER_DIR = join(__dirname, '..', '..', 'QR Scanner');

// Same project as CB — scanner is deployed from the CB Apps Script project
const SCRIPT_ID = '1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ';

// Maps local file → { name in Apps Script, type }
const SCANNER_FILES = [
  { local: 'ScannerBackend.updated.gs',       name: 'ScannerBackend',  type: 'SERVER_JS' },
  { local: 'IndexBuilder.updated.gs',          name: 'IndexBuilder',    type: 'SERVER_JS' },
  { local: 'Scanner.fixed.html',               name: 'Scanner',         type: 'HTML' },
  { local: 'index.updated.html',               name: 'index',           type: 'HTML' },
  { local: 'LabelPrinter.updated (1).html',    name: 'LabelPrinter',   type: 'HTML' },
];

async function main() {
  console.log('--- push-scanner: QR Scanner → CB Apps Script Project ---\n');

  if (!existsSync(CRED_PATH)) {
    console.error('ERROR: No credentials found at', CRED_PATH);
    console.error('Run: npm run setup');
    process.exit(1);
  }

  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  auth.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    token_type: creds.token_type,
  });

  const scriptApi = google.script({ version: 'v1', auth });

  // Read scanner source files
  console.log('Reading scanner source files...');
  const scannerSources = [];
  for (const f of SCANNER_FILES) {
    const localPath = join(SCANNER_DIR, f.local);
    if (!existsSync(localPath)) {
      console.warn(`  WARN: ${f.local} not found — skipping`);
      continue;
    }
    const source = readFileSync(localPath, 'utf8');
    console.log(`  ${f.local} �� ${f.name} (${(source.length / 1024).toFixed(1)} KB)`);
    scannerSources.push({ name: f.name, type: f.type, source });
  }

  if (!scannerSources.length) {
    console.error('ERROR: No scanner files found in', SCANNER_DIR);
    process.exit(1);
  }

  // Fetch current CB project to preserve existing files
  console.log('\nFetching current CB project content...');
  const current = await scriptApi.projects.getContent({ scriptId: SCRIPT_ID });
  const existingFiles = current.data.files || [];

  // Build scanner file name set for replacement
  const scannerNames = new Set(scannerSources.map(f => f.name));

  // Keep all existing files that are NOT being replaced by scanner files
  const keptFiles = existingFiles.filter(f => !scannerNames.has(f.name));
  console.log(`  Existing files: ${existingFiles.length}, keeping: ${keptFiles.length}, replacing/adding: ${scannerSources.length}`);

  // Merge: kept existing + new scanner files
  const newFiles = [...keptFiles, ...scannerSources];

  console.log('\nPushing to Apps Script...');
  const result = await scriptApi.projects.updateContent({
    scriptId: SCRIPT_ID,
    requestBody: { files: newFiles },
  });

  console.log('Push complete. Status:', result.status);
  console.log('Total files in project:', result.data.files?.length);
  console.log('Scanner files pushed:', scannerSources.map(f => f.name).join(', '));
  console.log('');
  console.log('URL: https://script.google.com/u/0/home/projects/' + SCRIPT_ID + '/edit');
}

main().catch(err => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
