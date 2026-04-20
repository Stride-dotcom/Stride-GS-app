/**
 * refresh-auth.mjs
 * Re-authorizes OAuth token with expanded scopes using existing credentials.
 * No client_secret JSON download needed — reads client_id/secret from .credentials.json.
 * Run from: stride-client-inventory/ directory
 * Usage: node admin/refresh-auth.mjs
 */
import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');

const SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function main() {
  console.log('=== Stride — Expand OAuth Scopes ===\n');

  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const { client_id, client_secret } = creds;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('Opening browser for re-authorization with expanded scopes...');
  console.log('If it does not open automatically, visit this URL:\n');
  console.log(authUrl + '\n');
  exec(`start "" "${authUrl}"`);

  const code = await prompt('Paste the authorization code here:\n> ');
  if (!code) { console.error('No code provided.'); process.exit(1); }

  const { tokens } = await oauth2Client.getToken(code);

  const updated = {
    client_id,
    client_secret,
    refresh_token: tokens.refresh_token || creds.refresh_token,
    access_token: tokens.access_token,
    token_type: tokens.token_type || 'Bearer',
    expiry_date: tokens.expiry_date,
  };

  writeFileSync(CRED_PATH, JSON.stringify(updated, null, 2));
  console.log('\n✅ Credentials updated with expanded scopes.');
  console.log('You can now run: npm run refresh-caches');
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
