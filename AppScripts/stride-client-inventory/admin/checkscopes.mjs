import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(join(__dirname, '.credentials.json'), 'utf8'));

// Google tokeninfo endpoint shows the actual scopes granted to this access_token
const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${creds.access_token}`);
const data = await res.json();

if (data.error) {
  console.log('Access token expired or invalid — checking via refresh_token...');
  console.log('(Token expiry was:', new Date(creds.expiry_date).toISOString(), ')');
} else {
  console.log('Email:', data.email);
  console.log('Scopes granted:');
  data.scope.split(' ').forEach(s => console.log(' ', s));
}
