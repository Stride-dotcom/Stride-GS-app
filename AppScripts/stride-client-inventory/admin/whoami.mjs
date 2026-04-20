import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(join(__dirname, '.credentials.json'), 'utf8'));
const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret);
oauth2.setCredentials({ refresh_token: creds.refresh_token, access_token: creds.access_token });

const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
const { data } = await oauth2api.userinfo.get();
console.log('Token is authorized as:', data.email);
