/**
 * push-cb.mjs
 * Pushes all Consolidated Billing scripts to the CB Apps Script project.
 * Run from: stride-client-inventory/ directory (has googleapis installed)
 * Usage: node admin/push-cb.mjs
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');
const CB_DIR = join(__dirname, '..', '..', 'Consolidated Billing Sheet');

// Consolidated Billing Apps Script project ID (from CLAUDE.md)
const SCRIPT_ID = '1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ';

// Maps local file → { scriptTabName, type }
const FILES = [
  { local: 'Code.gs.js',                  name: 'Code',                  type: 'SERVER_JS' },
  { local: 'Invoice Commit.js',            name: 'Invoice Commit',        type: 'SERVER_JS' },
  { local: 'CB13_Preview_Core.js',         name: 'CB13_Preview_Core',     type: 'SERVER_JS' },
  { local: 'CB13 Unbilled Reports.js',     name: 'CB13 Unbilled Reports', type: 'SERVER_JS' },
  { local: 'CB13_UI.html.txt',             name: 'CB13_UI',               type: 'HTML'      },
  { local: 'CB13 Config.js',               name: 'CB13 Config',           type: 'SERVER_JS' },
  { local: 'CB13 Schema Migration.js',     name: 'CB13 Schema Migration', type: 'SERVER_JS' },
  { local: 'Client_Onboarding.js',         name: 'Client_Onboarding',     type: 'SERVER_JS' },
  { local: 'Billing Logs.js',              name: 'Billing Logs',          type: 'SERVER_JS' },
  { local: 'QB_Export.js',                 name: 'QB_Export',             type: 'SERVER_JS' },
  { local: 'Claims.gs.js',                 name: 'Claims',                type: 'SERVER_JS' },
];

async function main() {
  console.log('Reading credentials...');
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));

  const auth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  auth.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    token_type: creds.token_type,
  });

  const scriptApi = google.script({ version: 'v1', auth });

  // Read all local files
  console.log('Reading CB source files...');
  const fileSources = FILES.map(f => {
    const source = readFileSync(join(CB_DIR, f.local), 'utf8');
    console.log(`  ${f.local} → ${f.name} (${(source.length / 1024).toFixed(1)} KB)`);
    return { name: f.name, type: f.type, source };
  });

  // Fetch current project to preserve appsscript.json AND any files we don't
  // own (e.g., QR Scanner files pushed via push-scanner.mjs). Previously this
  // only preserved the manifest — which silently wiped scanner files whenever
  // push-cb ran. Root cause of QR scanner regressions after CB pushes.
  console.log('\nFetching current project manifest + preserving non-CB files...');
  const current = await scriptApi.projects.getContent({ scriptId: SCRIPT_ID });
  const files = current.data.files || [];
  const manifest = files.find(f => f.name === 'appsscript');

  const manifestJson = manifest
    ? JSON.parse(manifest.source)
    : { timeZone: 'America/Los_Angeles', exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8' };
  const updatedManifest = {
    ...(manifest || { name: 'appsscript', type: 'JSON' }),
    source: JSON.stringify(manifestJson, null, 2),
  };

  // Preserve every existing file that isn't the manifest and isn't being
  // overwritten by this push. This keeps QR Scanner files intact.
  const cbFileNames = new Set(fileSources.map(f => f.name));
  const preserved = files.filter(
    f => f.name !== 'appsscript' && !cbFileNames.has(f.name)
  );
  if (preserved.length) {
    console.log('Preserving ' + preserved.length + ' non-CB file(s):',
      preserved.map(f => f.name).join(', '));
  }

  const newFiles = [updatedManifest, ...fileSources, ...preserved];

  console.log('\nPushing to Apps Script...');
  const result = await scriptApi.projects.updateContent({
    scriptId: SCRIPT_ID,
    requestBody: { files: newFiles },
  });

  console.log('✅ Push complete. Status:', result.status);
  console.log('Files pushed:', result.data.files?.map(f => f.name).join(', '));
  console.log('');
  console.log('Next: Open CB Apps Script editor → Save is automatic, no deploy step needed for bound scripts.');
  console.log('URL: https://script.google.com/u/0/home/projects/' + SCRIPT_ID + '/edit');
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
