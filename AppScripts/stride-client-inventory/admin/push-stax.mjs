/**
 * push-stax.mjs
 * Pushes the Stax Auto Pay script to its Apps Script project.
 * Run from: stride-client-inventory/ directory
 * Usage: node admin/push-stax.mjs
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');

// Stax Auto Pay Apps Script project ID (from CLAUDE.md)
const SCRIPT_ID = '1n_AkHhTB1ijUxLdfH8qCcYitHHBD30gCz2FKB1-q33wkJrXLiCpVqmt4';

// Stax is a single file
const LOCAL_FILE = join(__dirname, '..', '..', 'stax-auto-pay', 'StaxAutoPay.gs');

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

  // Read local file
  console.log('Reading Stax Auto Pay script...');
  const source = readFileSync(LOCAL_FILE, 'utf8');
  console.log(`  StaxAutoPay.gs → Code (${(source.length / 1024).toFixed(1)} KB)`);

  // Fetch current project to preserve appsscript.json
  console.log('\nFetching current project manifest...');
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

  const newFiles = [
    updatedManifest,
    { name: 'Code', type: 'SERVER_JS', source },
  ];

  console.log('\nPushing to Apps Script...');
  const result = await scriptApi.projects.updateContent({
    scriptId: SCRIPT_ID,
    requestBody: { files: newFiles },
  });

  console.log('✅ Push complete. Status:', result.status);
  console.log('Files pushed:', result.data.files?.map(f => f.name).join(', '));
  console.log('');
  console.log('URL: https://script.google.com/u/0/home/projects/' + SCRIPT_ID + '/edit');
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
