import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(join(__dirname, '.credentials.json'), 'utf8'));

const scriptId = '1VCUX78qfQbWddlX2-3H-jvsuI4u3BuBtVrYMkGjpdZ6VQ7-aUc_-kXkn';

console.log('Calling scripts.run directly with Bearer token...');
const res = await fetch(`https://script.googleapis.com/v1/scripts/${scriptId}:run`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${creds.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ function: 'StrideRemoteHealthCheck_', devMode: true }),
});

const data = await res.json();
console.log('HTTP Status:', res.status);
console.log('Response:', JSON.stringify(data, null, 2));
