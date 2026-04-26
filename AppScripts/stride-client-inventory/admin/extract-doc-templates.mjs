/**
 * extract-doc-templates.mjs
 * One-off: extract DOC_* HTML strings from Emails.gs getDefaultDocHtml_() and
 * write them to Doc Templates/*.txt so push-templates.mjs can push them to the
 * Master Price List Email_Templates sheet.
 *
 * Usage: node admin/extract-doc-templates.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMAILS_GS = join(__dirname, '..', 'src', 'Emails.gs');
const OUT_DIR = join(__dirname, '..', '..', '..', 'Doc Templates');

const KEYS = [
  'DOC_RECEIVING',
  'DOC_TASK_WORK_ORDER',
  'DOC_REPAIR_WORK_ORDER',
  'DOC_WILL_CALL_RELEASE',
];

mkdirSync(OUT_DIR, { recursive: true });

const src = readFileSync(EMAILS_GS, 'utf8');

for (const key of KEYS) {
  // Match:  case "DOC_RECEIVING":\n      return '....';
  const re = new RegExp(`case "${key}":\\s*return\\s*'([\\s\\S]*?)';`, 'm');
  const m = src.match(re);
  if (!m) {
    console.error(`[!] ${key} — not found in Emails.gs`);
    process.exit(1);
  }
  const html = m[1];
  const out = join(OUT_DIR, `${key}.txt`);
  writeFileSync(out, html, 'utf8');
  console.log(`[ok] ${key} -> ${out} (${(html.length / 1024).toFixed(1)} KB) width-fix=${html.includes('width="60%"')}`);
}
