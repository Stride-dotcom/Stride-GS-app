/**
 * push-stride-api.mjs
 * Pushes StrideAPI.gs to the standalone Stride API Apps Script project.
 * Run from: stride-client-inventory/ directory (has googleapis installed)
 * Usage: node admin/push-stride-api.mjs
 */
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');
const API_GS_PATH = join(__dirname, '..', '..', 'stride-api', 'StrideAPI.gs');

// Stride API standalone project ID (from CLAUDE.md)
const SCRIPT_ID = '134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M';

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

  console.log('Reading StrideAPI.gs...');
  const code = readFileSync(API_GS_PATH, 'utf8');
  console.log(`File size: ${(code.length / 1024).toFixed(1)} KB`);

  // Fetch current project to preserve appsscript.json
  console.log('Fetching current project content...');
  const current = await scriptApi.projects.getContent({ scriptId: SCRIPT_ID });
  const files = current.data.files || [];
  const manifest = files.find(f => f.name === 'appsscript');

  // Merge required scopes into existing manifest (adds script.scriptapp for Execution API calls)
  const REQUIRED_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/script.deployments',  // v38.13.0: auto-deploy Web App during onboarding
    'https://www.googleapis.com/auth/userinfo.email',
  ];
  const manifestJson = manifest ? JSON.parse(manifest.source) : { timeZone: 'America/Los_Angeles', exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8' };
  const existingScopes = manifestJson.oauthScopes || [];
  manifestJson.oauthScopes = [...new Set([...existingScopes, ...REQUIRED_SCOPES])];
  const updatedManifest = { ...(manifest || { name: 'appsscript', type: 'JSON' }), source: JSON.stringify(manifestJson, null, 2) };

  // Build new files array: manifest + Code
  const newFiles = [updatedManifest];
  newFiles.push({ name: 'Code', type: 'SERVER_JS', source: code });

  console.log('Pushing to Apps Script...');
  const result = await scriptApi.projects.updateContent({
    scriptId: SCRIPT_ID,
    requestBody: { files: newFiles },
  });

  console.log('✅ Push complete. Status:', result.status);
  console.log('Files pushed:', result.data.files?.map(f => f.name).join(', '));
  console.log('');
  console.log('Next: Go to Apps Script editor → Deploy → Manage deployments → pencil → New version → Deploy');
  console.log('URL: https://script.google.com/home/projects/' + SCRIPT_ID + '/edit');
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
