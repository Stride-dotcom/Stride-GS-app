/**
 * push-master.mjs
 * Pushes the Master Price List script to its Apps Script project.
 * Run from: stride-client-inventory/ directory (has googleapis installed)
 * Usage: node admin/push-master.mjs
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');
const MASTER_SCRIPT_PATH = join(__dirname, '..', '..', 'Master Price list script.txt');

// Master Price List Apps Script project ID (from CLAUDE.md)
const SCRIPT_ID = '10ToAAlw-OYm0GDfy4xVwAX72hIPb6ZeDNrP1_qIxZv3BhG4Z2Hb_cZHc';

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

  console.log('Reading Master Price list script.txt...');
  const code = readFileSync(MASTER_SCRIPT_PATH, 'utf8');
  console.log(`File size: ${(code.length / 1024).toFixed(1)} KB`);

  // Fetch current project to preserve appsscript.json
  console.log('Fetching current project manifest...');
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

  const newFiles = [updatedManifest, { name: 'Code', type: 'SERVER_JS', source: code }];

  console.log('Pushing to Apps Script...');
  const result = await scriptApi.projects.updateContent({
    scriptId: SCRIPT_ID,
    requestBody: { files: newFiles },
  });

  console.log('✅ Push complete. Status:', result.status);
  console.log('Files pushed:', result.data.files?.map(f => f.name).join(', '));
  console.log('');
  console.log('Next: Open Master Price List Apps Script editor — no deploy step needed for bound scripts.');
  console.log('URL: https://script.google.com/u/0/home/projects/' + SCRIPT_ID + '/edit');
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
