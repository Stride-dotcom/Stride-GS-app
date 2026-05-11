#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Dist referential-integrity check.
 *
 * Walks every <script src="…"> and <link href="…"> in dist/index.html
 * that points at /assets/… (or a relative assets/… path) and verifies
 * the file is actually present on disk. Optionally also verifies the
 * file is tracked/staged in the dist/ git index when called with
 * --check-git.
 *
 * Why this exists:
 *   On 2026-05-11 a deploy shipped an index.html referencing
 *   /assets/index-Dow4zmFT.js — but that JS file was never committed
 *   to the dist/ repo. Result: every page load 404'd on the main
 *   script and the site went dark for all users. The build's
 *   module-count / bundle-size checks couldn't catch this because
 *   they only verified vite produced *some* output, not that the
 *   output was internally consistent.
 *
 *   This script catches the failure mode by reading the HTML the
 *   server would actually serve and confirming every referenced
 *   asset path exists. Two integration points:
 *
 *     1. build.js end-of-build  — catches disk-level corruption
 *        (vite output partially written, manual deletes, etc.)
 *     2. deploy.js pre-push     — catches staging-level corruption
 *        (git add missed a file, .gitignore swallowed an asset, a
 *        prior deploy left an inconsistent tree, etc.) by re-running
 *        the same check against the post-commit working tree.
 *
 * Limits — what this DOES NOT check:
 *   • Dynamic imports referenced only from inside the JS bundle
 *     (not from HTML). Vite's modulepreload <link> covers most
 *     code-split chunks, but a runtime fetch('/assets/foo.json')
 *     would slip through. That class of bug has never bitten us;
 *     widen the regex or walk the bundle if it ever does.
 *   • Non-/assets/* URLs (CDN, external scripts) — not our concern.
 *
 * Exit codes:
 *   0 — every referenced asset exists (and is tracked, if --check-git)
 *   1 — at least one reference is broken — message lists which
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT  = resolve(__dirname, '..');
const DIST_DIR  = join(APP_ROOT, 'dist');
const INDEX_HTML = join(DIST_DIR, 'index.html');

const checkGit = process.argv.includes('--check-git');
const divider  = '─'.repeat(70);

function fail(messages) {
  console.error('');
  console.error(divider);
  console.error('[verify-dist] DIST INTEGRITY CHECK FAILED');
  console.error(divider);
  console.error('');
  for (const m of messages) console.error('  ' + m);
  console.error('');
  console.error('  This is the 2026-05-11 failure mode: index.html references');
  console.error('  a JS/CSS file that is not present in dist/. Deploying this');
  console.error('  state would 404 every page load and take the site down.');
  console.error('');
  console.error('  Remediation:');
  console.error('    1. rm -rf dist/assets && npm run build');
  console.error('    2. Inspect dist/.gitignore — it should NOT exclude assets/');
  console.error('    3. If --check-git failed, run `git status` in dist/ to');
  console.error('       see what is untracked, then `git add -A` and retry.');
  console.error('');
  console.error(divider);
  process.exit(1);
}

if (!existsSync(INDEX_HTML)) {
  fail(['dist/index.html does not exist — did vite build run?']);
}

const html = readFileSync(INDEX_HTML, 'utf8');

// Pull every src="…" and href="…" that points at the assets folder.
// We accept both absolute "/assets/foo.js" and relative "assets/foo.js"
// to cover any future base-path config drift. Single capture group
// holds the assets/-relative path (no leading slash).
const refRegex = /(?:src|href)\s*=\s*["']\/?(assets\/[^"']+)["']/g;
const references = new Set();
let m;
while ((m = refRegex.exec(html)) !== null) {
  references.add(m[1]);
}

if (references.size === 0) {
  // index.html that doesn't reference any /assets/* file is suspicious —
  // every real vite build emits at least one entry script. Flag it but
  // don't fail; some edge-case test HTML might intentionally have none.
  console.warn('[verify-dist] WARNING: no /assets/* references found in index.html');
  console.log('[verify-dist] OK (no asset references to verify)');
  process.exit(0);
}

console.log(`[verify-dist] checking ${references.size} asset reference(s) in dist/index.html`);

const missingOnDisk = [];
const missingInGit = [];

for (const ref of references) {
  // Path-traversal guard. The HTML is our own build output so this is
  // belt-and-suspenders, but a malicious or just buggy ref like
  // "assets/../../etc/passwd" would otherwise let `existsSync` poke
  // outside dist/ and false-pass the check.
  const full = resolve(DIST_DIR, ref);
  if (!full.startsWith(DIST_DIR)) {
    missingOnDisk.push(`${ref}  (path escapes dist/ — rejected)`);
    continue;
  }
  if (!existsSync(full)) {
    missingOnDisk.push(ref);
    continue;
  }
  if (checkGit) {
    // Verify the file is tracked OR staged in dist/.git. An untracked
    // file in the working tree would survive the disk check but get
    // skipped by `git push`, reproducing the 2026-05-11 failure.
    // `git ls-files --error-unmatch` exits non-zero if the path isn't
    // in the index; we also accept staged-but-uncommitted files.
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', ref], {
        cwd: DIST_DIR,
        stdio: 'ignore',
      });
    } catch (_) {
      missingInGit.push(ref);
    }
  }
}

if (missingOnDisk.length === 0 && missingInGit.length === 0) {
  console.log(`[verify-dist] OK — all ${references.size} asset reference(s) resolved` +
              (checkGit ? ' AND tracked in dist/.git' : ''));
  process.exit(0);
}

const errors = [];
if (missingOnDisk.length > 0) {
  errors.push(`${missingOnDisk.length} asset reference(s) NOT FOUND on disk:`);
  for (const r of missingOnDisk) errors.push(`    • ${r}`);
}
if (missingInGit.length > 0) {
  errors.push(`${missingInGit.length} asset reference(s) on disk but NOT TRACKED in dist/.git:`);
  for (const r of missingInGit) errors.push(`    • ${r}`);
}
fail(errors);
