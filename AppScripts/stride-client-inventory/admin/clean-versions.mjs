/* ===================================================
   clean-versions.mjs — v1.0.0 — 2026-04-26 — List Apps Script versions to identify ones to delete
   =================================================== */
/**
 * Lists every saved Apps Script version on a project (default: Stride API)
 * sorted oldest → newest, so you can quickly identify which ones to delete
 * when you hit the 200-version cap.
 *
 * The Apps Script REST API does NOT expose a versions.delete endpoint —
 * deletion is only possible from the editor UI (Project History → ⋮ → Delete).
 * This script makes the cleanup pass tractable by:
 *   1. Counting how many versions you have.
 *   2. Listing the oldest N (default 50) with version#, date, description.
 *   3. Printing the editor URL to open and delete from.
 *
 * Usage:
 *   node admin/clean-versions.mjs                    # Stride API, list oldest 50
 *   node admin/clean-versions.mjs --project=cb       # CB / QR Scanner project
 *   node admin/clean-versions.mjs --keep=150         # show oldest = total-150 versions
 *   node admin/clean-versions.mjs --count=100        # show oldest 100 versions
 *
 * Aliases supported via --project:
 *   api  = Stride API (default)
 *   cb   = Consolidated Billing / QR Scanner
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRED_PATH = join(__dirname, '.credentials.json');

const PROJECTS = {
  api: {
    name: 'Stride API',
    scriptId: '134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M',
  },
  cb: {
    name: 'CB / QR Scanner',
    scriptId: '1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ',
  },
};

function parseArgs() {
  const out = { project: 'api', keep: null, count: 50 };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'project') out.project = m[2];
    else if (m[1] === 'keep') out.keep = parseInt(m[2], 10);
    else if (m[1] === 'count') out.count = parseInt(m[2], 10);
  }
  return out;
}

function getAuthClient() {
  if (!existsSync(CRED_PATH)) {
    console.error('ERROR: No credentials found. Run: npm run setup');
    process.exit(1);
  }
  const creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  oauth2.setCredentials({
    refresh_token: creds.refresh_token,
    access_token: creds.access_token,
    token_type: creds.token_type || 'Bearer',
    expiry_date: creds.expiry_date,
  });
  return oauth2;
}

async function listAllVersions(script, scriptId) {
  const all = [];
  let pageToken = undefined;
  do {
    const res = await script.projects.versions.list({
      scriptId,
      pageSize: 50,
      pageToken,
    });
    if (res.data.versions) all.push(...res.data.versions);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

function fmtDate(iso) {
  if (!iso) return '(unknown)';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

async function main() {
  const args = parseArgs();
  const proj = PROJECTS[args.project];
  if (!proj) {
    console.error(`ERROR: Unknown project "${args.project}". Use one of: ${Object.keys(PROJECTS).join(', ')}`);
    process.exit(1);
  }

  const auth = getAuthClient();
  const script = google.script({ version: 'v1', auth });

  console.log(`\n=== ${proj.name} — Apps Script Versions ===`);
  console.log(`Listing all versions… (this may take a minute on a 200-version project)`);

  const versions = await listAllVersions(script, proj.scriptId);
  versions.sort((a, b) => Number(a.versionNumber) - Number(b.versionNumber));

  console.log(`Total versions: ${versions.length} (limit: 200)\n`);

  let toShow;
  if (args.keep != null && Number.isFinite(args.keep)) {
    const dropCount = Math.max(0, versions.length - args.keep);
    toShow = versions.slice(0, dropCount);
    console.log(`Oldest ${toShow.length} version(s) to delete (keeping newest ${args.keep}):`);
  } else {
    toShow = versions.slice(0, args.count);
    console.log(`Oldest ${toShow.length} version(s):`);
  }

  if (!toShow.length) {
    console.log('(nothing to show)');
  } else {
    console.log('');
    console.log('  Version  Created           Description');
    console.log('  -------  ----------------  ' + '-'.repeat(60));
    for (const v of toShow) {
      const num = String(v.versionNumber).padStart(7);
      const date = fmtDate(v.createTime).padEnd(16);
      const desc = (v.description || '(no description)').slice(0, 60);
      console.log(`  ${num}  ${date}  ${desc}`);
    }
  }

  console.log('\n--- Manual cleanup ---');
  console.log('The Apps Script API does NOT expose versions.delete — you must delete in the editor UI:');
  console.log(`  https://script.google.com/home/projects/${proj.scriptId}/versions`);
  console.log('  → Click ⋮ next to a version → Delete. Bulk-select isn\'t supported, but page through');
  console.log('    the oldest entries shown above; each click takes ~1s.');
  console.log('');
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
