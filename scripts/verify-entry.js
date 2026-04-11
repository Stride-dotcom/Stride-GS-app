#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Pre-build safety check — verifies stride-gs-app/index.html is a valid
 * SOURCE entry point, not a built asset reference.
 *
 * HISTORY
 * -------
 * The source index.html was silently overwritten once (around commit 8441ff3,
 * session 58) with vite's built output. The built version contains a hashed
 * <script src="/assets/index-XXXXXX.js"> tag pointing at a compiled bundle;
 * the source version should contain <script src="/src/main.tsx">.
 *
 * Once the built version replaced the source, every subsequent `npm run build`
 * happily bundled the already-compiled asset as its entry — transforming 6
 * modules (HTML + linked script + linked CSS) instead of ~1,875 — and produced
 * a no-op echo of the previous bundle. The build reported success, exit 0,
 * no errors. React source changes from three sessions (sessions 57, 58, 59)
 * never reached production.
 *
 * This script exists to make that failure mode impossible to recur silently.
 * Runs before `tsc -b && vite build`. If the entry is corrupted, the build
 * aborts with a loud, actionable error.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, '..', 'index.html');

let html;
try {
  html = readFileSync(INDEX_HTML, 'utf8');
} catch (err) {
  console.error('[verify-entry] FAIL: could not read ' + INDEX_HTML);
  console.error('[verify-entry] ' + err.message);
  process.exit(1);
}

// Reject any <script> that references a built /assets/ bundle.
// The source index.html must never contain /assets/ script tags — those only
// exist in dist/index.html after vite has written its output.
const BUILT_ASSET_RE = /<script[^>]*\ssrc\s*=\s*["']\/assets\//i;

// Require the React source entry point script tag. Vite reads index.html as
// the build input, so this <script src="/src/main.tsx"> is literally the
// thing that causes vite to traverse the React module graph.
const SOURCE_ENTRY_RE = /<script[^>]*\ssrc\s*=\s*["']\/src\/main\.tsx["']/i;

const divider = '\u2500'.repeat(70);

if (BUILT_ASSET_RE.test(html)) {
  console.error('');
  console.error(divider);
  console.error('[verify-entry] BUILD ABORTED \u2014 index.html is corrupted');
  console.error(divider);
  console.error('');
  console.error('  stride-gs-app/index.html contains a <script src="/assets/..."> tag.');
  console.error('  That is a BUILT bundle reference, not a source entry point.');
  console.error('');
  console.error('  When vite sees this, it treats the built asset as the entry and');
  console.error('  produces a no-op bundle (~6 modules transformed instead of ~1875).');
  console.error('  Every subsequent npm run build silently echoes the previous bundle,');
  console.error('  and your source changes never reach production.');
  console.error('');
  console.error('  This is the session-58 \u2192 session-59 regression. See');
  console.error('  Docs/Archive/Session_History.md session 59 for the full story.');
  console.error('');
  console.error('  FIX: replace the offending <script> line in index.html with:');
  console.error('');
  console.error('      <script type="module" src="/src/main.tsx"></script>');
  console.error('');
  console.error('  (place it inside <body>, after the <div id="root"></div>).');
  console.error('');
  console.error(divider);
  process.exit(1);
}

if (!SOURCE_ENTRY_RE.test(html)) {
  console.error('');
  console.error(divider);
  console.error('[verify-entry] BUILD ABORTED \u2014 index.html missing source entry');
  console.error(divider);
  console.error('');
  console.error('  stride-gs-app/index.html does not contain the expected');
  console.error('  <script type="module" src="/src/main.tsx"></script> entry tag.');
  console.error('');
  console.error('  Without it, vite has no React entry point to bundle.');
  console.error('');
  console.error('  FIX: add this line inside <body>, after <div id="root"></div>:');
  console.error('');
  console.error('      <script type="module" src="/src/main.tsx"></script>');
  console.error('');
  console.error(divider);
  process.exit(1);
}

console.log('[verify-entry] OK \u2014 index.html points to /src/main.tsx');
