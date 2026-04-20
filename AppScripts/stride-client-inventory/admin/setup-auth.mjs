/* ===================================================
   setup-auth.mjs — v3.2.0 — 2026-03-30 12:00 AM PST
   =================================================== */
/**
 * One-time OAuth2 credential setup for Apps Script API access.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/
 *   2. Enable "Apps Script API" and "Google Sheets API"
 *   3. Create OAuth 2.0 credentials (Desktop App type)
 *   4. Download the JSON file (client_secret_*.json)
 *
 * Usage:
 *   node admin/setup-auth.mjs
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');

// Must be a superset of the scopes declared in src/appsscript.json
// so the Execution API can call script functions without "no permission" errors.
const SCOPES = [
  'https://www.googleapis.com/auth/script.projects',         // push/read script content
  'https://www.googleapis.com/auth/script.external_request', // script UrlFetchApp calls
  'https://www.googleapis.com/auth/script.scriptapp',        // ScriptApp (triggers, etc.)
  'https://www.googleapis.com/auth/spreadsheets',            // SpreadsheetApp
  'https://www.googleapis.com/auth/drive',                   // DriveApp + Drive advanced service
  'https://www.googleapis.com/auth/documents',               // DocumentApp (invoice/doc templates)
  'https://www.googleapis.com/auth/gmail.send',              // GmailApp.sendEmail
  'https://www.googleapis.com/auth/gmail.settings.basic',    // Gmail settings
  'https://www.googleapis.com/auth/userinfo.email',          // Session.getActiveUser
];

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openBrowser(url) {
  // Windows
  exec(`start "" "${url}"`);
}

async function main() {
  console.log('=== Stride Client Inventory — OAuth2 Setup ===\n');

  // Check if credentials already exist
  if (existsSync(CRED_PATH)) {
    const overwrite = await prompt('.credentials.json already exists. Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // Auto-detect client_secret.json in the admin folder, otherwise prompt
  const defaultSecretPath = join(__dirname, 'client_secret.json');
  let secretPath;
  if (existsSync(defaultSecretPath)) {
    console.log('Using client_secret.json found in admin folder.\n');
    secretPath = defaultSecretPath;
  } else {
    secretPath = await prompt(
      'Path to downloaded client_secret_*.json from Google Cloud Console:\n> '
    );
    if (!existsSync(secretPath)) {
      console.error('ERROR: File not found: ' + secretPath);
      process.exit(1);
    }
  }

  let secrets;
  try {
    const raw = JSON.parse(readFileSync(secretPath, 'utf8'));
    secrets = raw.installed || raw.web;
    if (!secrets || !secrets.client_id || !secrets.client_secret) {
      throw new Error('Missing client_id or client_secret');
    }
  } catch (err) {
    console.error('ERROR: Could not parse client secret file:', err.message);
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    secrets.client_id,
    secrets.client_secret,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('\nOpening browser for authorization...');
  console.log('If it doesn\'t open, visit this URL:\n');
  console.log(authUrl + '\n');
  openBrowser(authUrl);

  const code = await prompt('Paste the authorization code here:\n> ');

  if (!code) {
    console.error('ERROR: No authorization code provided.');
    process.exit(1);
  }

  let tokens;
  try {
    const response = await oauth2Client.getToken(code);
    tokens = response.tokens;
  } catch (err) {
    console.error('ERROR: Failed to exchange code for tokens:', err.message);
    process.exit(1);
  }

  const credentials = {
    client_id: secrets.client_id,
    client_secret: secrets.client_secret,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    token_type: tokens.token_type || 'Bearer',
    expiry_date: tokens.expiry_date
  };

  writeFileSync(CRED_PATH, JSON.stringify(credentials, null, 2));
  console.log('\nCredentials saved to admin/.credentials.json');
  console.log('Setup complete. You can now run: npm run rollout:dry');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
