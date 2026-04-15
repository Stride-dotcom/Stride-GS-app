#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Full React deploy script — build → dist push → source commit+push
 *
 * Usage (from stride-gs-app/):
 *   npm run deploy -- "description of what changed"
 *
 * What it does:
 *   1. npm run build   (verify-entry → tsc → vite → sanity checks)
 *   2. dist/.git       git add -A && commit "Deploy: <msg>" && push origin main --force
 *   3. parent repo     git add -A && commit "deploy(react): <msg>" && push origin source
 *
 * Step 3 is the one that was always being skipped manually — baking it in here
 * makes it impossible to deploy to GitHub Pages without also committing source.
 */

import { execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir    = resolve(__dirname, '..');   // stride-gs-app/
const parentDir = resolve(appDir, '..');      // GS Inventory/  (parent repo root)
const distDir   = resolve(appDir, 'dist');

// ── Parse message ──────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
// Accept: npm run deploy -- "msg"  or  npm run deploy -- -m "msg"  or  --message "msg"
let message = '';
const mFlag = rawArgs.findIndex(a => a === '-m' || a === '--message');
if (mFlag >= 0 && rawArgs[mFlag + 1]) {
  message = rawArgs[mFlag + 1];
} else {
  message = rawArgs.filter(a => !a.startsWith('-')).join(' ').trim();
}

if (!message) {
  console.error('\n[deploy] ERROR: A deploy message is required.');
  console.error('[deploy] Usage:  npm run deploy -- "what you changed"');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function run(cmd, cwd) {
  console.log(`\n[deploy] $ ${cmd}  (in ${cwd.split(/[\\/]/).slice(-2).join('/')})`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function hasUncommittedChanges(cwd) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd }).toString().trim();
    return out.length > 0;
  } catch (_) {
    return false;
  }
}

function hasStagedChanges(cwd) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd }).toString().trim();
    return out.length > 0;
  } catch (_) {
    return false;
  }
}

// ── Step 1: Build ──────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════╗');
console.log('║  stride-gs-app deploy                    ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`\n[deploy] message: "${message}"`);
console.log('\n[deploy] ── step 1/3: build ──────────────────────────────────');
run('node scripts/build.js', appDir);

// ── Step 2: Push built bundle → origin/main (GitHub Pages) ────────────────
console.log('\n[deploy] ── step 2/3: push bundle → origin/main ─────────────');
run('git add -A', distDir);

// Commit only if there are staged changes (idempotent if nothing changed)
if (hasStagedChanges(distDir)) {
  run(`git commit -m "Deploy: ${message}"`, distDir);
  run('git push origin main --force', distDir);
  console.log('[deploy] ✓ bundle pushed to GitHub Pages (origin/main)');
} else {
  console.log('[deploy] bundle: nothing new to commit in dist/');
}

// ── Step 3: Commit + push source → origin/source ──────────────────────────
console.log('\n[deploy] ── step 3/3: commit source → origin/source ─────────');

if (hasUncommittedChanges(parentDir)) {
  // Stage everything under stride-gs-app/ and Docs/ — the two directories
  // that React sessions touch. AppScripts/ changes are staged intentionally
  // if present (those were already modified as part of the session).
  run('git add -A', parentDir);

  if (hasStagedChanges(parentDir)) {
    run(`git commit -m "deploy(react): ${message}"`, parentDir);
    run('git push origin source', parentDir);
    console.log('[deploy] ✓ source committed and pushed to origin/source');
  } else {
    console.log('[deploy] source: staged but nothing to commit (already clean)');
  }
} else {
  console.log('[deploy] source: nothing to commit (already clean)');

  // Still push in case local is ahead of remote (e.g. a prior commit wasn't pushed)
  try {
    const ahead = execFileSync(
      'git', ['rev-list', '--count', 'origin/source..HEAD'], { cwd: parentDir }
    ).toString().trim();
    if (parseInt(ahead, 10) > 0) {
      console.log(`[deploy] source: ${ahead} commit(s) ahead of origin — pushing`);
      run('git push origin source', parentDir);
    }
  } catch (_) { /* ignore */ }
}

console.log('\n[deploy] ✓ all steps complete');
console.log('[deploy]   GitHub Pages: https://www.mystridehub.com');
console.log('[deploy]   Source:       https://github.com/Stride-dotcom/Stride-GS-app/tree/source');
console.log('[deploy]   (Hard-refresh the app to confirm the new bundle hash)\n');
