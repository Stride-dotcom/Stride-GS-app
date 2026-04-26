/**
 * build-doc-template-sql.mjs
 * One-off: read DOC_*.txt from Doc Templates/ and emit a single SQL UPDATE
 * batch that refreshes Supabase email_templates.body for the four DOC_* keys.
 *
 * Output: admin/update-doc-templates.sql (or override via argv[2])
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_DIR = join(__dirname, '..', '..', '..', 'Doc Templates');
const OUT = process.argv[2] || join(__dirname, 'update-doc-templates.sql');

const KEYS = [
  'DOC_RECEIVING',
  'DOC_TASK_WORK_ORDER',
  'DOC_REPAIR_WORK_ORDER',
  'DOC_WILL_CALL_RELEASE',
];

let sql = '-- Refresh DOC_* email_templates body with width-fix HTML from deployed Emails.gs v4.8.1\n';
sql += 'BEGIN;\n';
for (const key of KEYS) {
  let html = readFileSync(join(DOC_DIR, `${key}.txt`), 'utf8').trim();
  if (html.includes("'")) {
    console.error(`[!] ${key} contains an apostrophe — would break single-quoted SQL`);
    process.exit(1);
  }
  if (html.includes('$body$')) {
    console.error(`[!] ${key} contains the $body$ marker — would break dollar-quoted SQL`);
    process.exit(1);
  }
  // Use $body$ dollar-quoting to be safe even though no apostrophes are present
  sql += `UPDATE public.email_templates SET body = $body$${html}$body$, updated_at = now(), updated_by_name = 'admin/build-doc-template-sql.mjs' WHERE template_key = '${key}';\n`;
}
sql += 'COMMIT;\n';

writeFileSync(OUT, sql, 'utf8');
console.log(`[ok] wrote ${OUT} (${(sql.length / 1024).toFixed(1)} KB, ${KEYS.length} updates)`);
