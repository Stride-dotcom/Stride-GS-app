#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Build orchestrator with post-build sanity checks.
 *
 * Replaces the old "tsc -b && vite build" chain. Runs, in order:
 *
 *   1. scripts/verify-entry.js       (pre-flight: index.html must be a source entry)
 *   2. tsc -b                         (type check + project references)
 *   3. vite build                     (bundle, with stdout captured so we can parse it)
 *   4. Post-build sanity checks:
 *      - module-count check           (catches the session-58 no-op echo bundle failure)
 *      - bundle-size check            (catches empty / stub bundles)
 *
 * If any check fails, the build exits non-zero with a clear, actionable
 * remediation message. No more silent stale builds.
 *
 * Thresholds are deliberately conservative so normal code churn never
 * triggers false positives:
 *   MIN_MODULES       = 500       (real build: ~1,875)
 *   MIN_BUNDLE_BYTES  = 500 KB    (real bundle: ~1.4 MB)
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST_ASSETS = join(ROOT, 'dist', 'assets');

const MIN_MODULES = 500;
const MIN_BUNDLE_BYTES = 500 * 1024;

const divider = '\u2500'.repeat(70);

/** Spawn a child process synchronously. On Windows, the `tsc` / `vite` bins
 *  are actually `.cmd` shims in node_modules/.bin, so invoking them requires
 *  spawn with `shell:true`. Node warns (DEP0190) about passing args with
 *  shell:true because they're concatenated unescaped \u2014 we avoid that by
 *  pre-joining args into the command string, which is the documented
 *  safe-by-construction pattern for fully-controlled commands.
 *
 *  When opts.capture is true, stdout/stderr are buffered and returned
 *  instead of streamed directly to the parent terminal. */
function run(cmd, args, opts = {}) {
  const useShell = opts.shell !== false;
  if (useShell) {
    // Pre-join to avoid DEP0190. Our args here never contain user input \u2014
    // they are static literals ("tsc", "-b", "vite", "build", etc.).
    const joined = [cmd, ...args].join(' ');
    return spawnSync(joined, {
      cwd: ROOT,
      stdio: opts.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      shell: true,
      env: process.env,
    });
  }
  return spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    shell: false,
    env: process.env,
  });
}

function fail(step, msg, remediation) {
  console.error('');
  console.error(divider);
  console.error('[build] BUILD ABORTED at step: ' + step);
  console.error(divider);
  console.error('');
  console.error('  ' + msg);
  if (remediation) {
    console.error('');
    console.error('  ' + remediation.split('\n').join('\n  '));
  }
  console.error('');
  console.error(divider);
  process.exit(1);
}

// ── Step 1 — pre-flight entry guard ─────────────────────────────────────────
console.log('[build] step 1/4: verify index.html entry point');
{
  // `node` is a native executable, no shell shim needed — skip shell:true
  // so we don't trip DEP0190 and avoid any theoretical shell-escaping issue.
  const entry = run('node', ['scripts/verify-entry.js'], { shell: false });
  if (entry.status !== 0) {
    process.exit(entry.status || 1);
  }
}

// ── Step 2 — TypeScript project check ───────────────────────────────────────
console.log('[build] step 2/4: tsc -b');
{
  const tsc = run('tsc', ['-b']);
  if (tsc.status !== 0) {
    fail('tsc -b', 'TypeScript project check failed (see errors above).');
  }
}

// ── Step 3 — vite build with captured output ────────────────────────────────
console.log('[build] step 3/4: vite build');
const viteOutput = { stdout: '', stderr: '' };
{
  const vite = run('vite', ['build'], { capture: true });
  viteOutput.stdout = vite.stdout ? vite.stdout.toString() : '';
  viteOutput.stderr = vite.stderr ? vite.stderr.toString() : '';
  // Stream vite's output to the user so they still see the build log.
  process.stdout.write(viteOutput.stdout);
  process.stderr.write(viteOutput.stderr);
  if (vite.status !== 0) {
    fail('vite build', 'vite build exited with code ' + vite.status + '.');
  }
}

// ── Step 4 — post-build sanity checks ───────────────────────────────────────
console.log('[build] step 4/4: post-build sanity checks');

// ── Check A — module count from vite stdout ───
// Vite prints a line like "\u2713 1875 modules transformed." after the transform
// phase. We parse the number and reject any build that looks like a no-op
// echo (< MIN_MODULES). The session-58 regression produced 6 modules here.
{
  const combined = viteOutput.stdout + '\n' + viteOutput.stderr;
  const moduleMatch = combined.match(/(\d+)\s+modules?\s+transformed/i);
  if (!moduleMatch) {
    console.warn('[build] WARNING: could not parse "N modules transformed" from vite output');
    console.warn('[build] WARNING: skipping module-count check');
  } else {
    const moduleCount = parseInt(moduleMatch[1], 10);
    console.log('[build] modules transformed: ' + moduleCount.toLocaleString());
    if (moduleCount < MIN_MODULES) {
      fail(
        'module-count check',
        'vite only transformed ' + moduleCount + ' modules. A real build of this app ' +
          'should produce ~1,875 modules. Threshold: ' + MIN_MODULES + '.',
        'This is the signature of the session-58 no-op build failure.\n' +
          'Most likely causes:\n' +
          '  1. index.html references a built asset (should have been caught by\n' +
          '     verify-entry.js \u2014 check if the regex escaped a new pattern)\n' +
          '  2. A vite plugin is stripping the module graph\n' +
          '  3. Stale vite cache \u2014 try: rm -rf node_modules/.vite && npm run build'
      );
    }
  }
}

// ── Check B — bundle size ───
// Find the biggest .js file under dist/assets/ and confirm it's a reasonable
// React bundle, not a stub. The echo bundle was actually ~1.4 MB (it was a
// full copy of the previous real bundle), so size alone can't distinguish
// echo from real \u2014 but it CAN catch empty / broken / stub outputs.
if (!existsSync(DIST_ASSETS)) {
  fail('bundle-size check', 'dist/assets/ does not exist after vite build.');
}

let biggestJs = null;
for (const f of readdirSync(DIST_ASSETS)) {
  if (!f.endsWith('.js')) continue;
  const full = join(DIST_ASSETS, f);
  const size = statSync(full).size;
  if (!biggestJs || size > biggestJs.size) {
    biggestJs = { name: f, size, full };
  }
}

if (!biggestJs) {
  fail('bundle-size check', 'No .js files found in dist/assets/.');
}

console.log(
  '[build] bundle: ' + biggestJs.name + ' (' + biggestJs.size.toLocaleString() + ' bytes)'
);

if (biggestJs.size < MIN_BUNDLE_BYTES) {
  fail(
    'bundle-size check',
    biggestJs.name + ' is ' + biggestJs.size.toLocaleString() + ' bytes. ' +
      'Minimum expected: ' + MIN_BUNDLE_BYTES.toLocaleString() + ' bytes.',
    'Either a lot of dependencies are missing, or the bundle is a stub.\n' +
      'Try: rm -rf node_modules/.vite dist && npm install && npm run build'
  );
}

console.log('[build] OK \u2014 all sanity checks passed');
