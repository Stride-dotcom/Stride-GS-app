/**
 * reauth.mjs — one-time reauthorization with full scope set
 * Run: node admin/reauth.mjs
 */
import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');

const SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/userinfo.email',
];

const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, 'urn:ietf:wg:oauth:2.0:oob');

const url = oauth2.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

console.log('\nOpening browser — authorize ALL requested permissions...\n');
exec(`start "" "${url}"`);
console.log('If browser did not open:\n' + url + '\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the authorization code:\n> ', async code => {
  rl.close();
  const { tokens } = await oauth2.getToken(code.trim());
  writeFileSync(CRED_PATH, JSON.stringify({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    token_type: tokens.token_type || 'Bearer',
    expiry_date: tokens.expiry_date,
  }, null, 2));
  console.log('\nDone. Credentials updated with full scope set.');
});
