/* ===================================================
   bulk-resync-stax-catalog.mjs — v1.0.0 — 2026-04-26
   =================================================== */
/**
 * One-shot bulk resync: pushes every service_catalog row that already
 * has a stax_item_id back through the stax-catalog-sync edge function
 * so Stax's catalog reflects the latest service_catalog state.
 *
 * Used after a bulk SQL update that changed `taxable` on all rows —
 * the per-save sync only fires when an operator edits a service in
 * the React UI, so the in-place SQL change doesn't propagate to Stax
 * without this.
 *
 * Usage:
 *   node admin/bulk-resync-stax-catalog.mjs               # dry run
 *   node admin/bulk-resync-stax-catalog.mjs --execute     # actually call the edge function
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
 * admin/.supabase-env.json (gitignored, see refresh-auth.mjs for the
 * same pattern). If the file is missing, prints the env-var values
 * needed and exits 1.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '.supabase-env.json');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

function loadEnv() {
  if (existsSync(ENV_PATH)) {
    return JSON.parse(readFileSync(ENV_PATH, 'utf8'));
  }
  // Fall back to process env so this is also runnable in CI / GitHub Actions.
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  }
  console.error('ERROR: missing admin/.supabase-env.json and no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars set.');
  console.error('Create admin/.supabase-env.json with:');
  console.error('  { "SUPABASE_URL": "https://<project>.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "..." }');
  process.exit(1);
}

async function main() {
  const env = loadEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

  // Pull every service_catalog row with a Stax catalog id.
  const listResp = await fetch(
    `${SUPABASE_URL}/rest/v1/service_catalog?select=id,code,name,taxable,stax_item_id&stax_item_id=not.is.null`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    }
  );
  if (!listResp.ok) {
    console.error(`Supabase list failed: HTTP ${listResp.status}`);
    console.error(await listResp.text());
    process.exit(1);
  }
  const services = await listResp.json();
  console.log(`Found ${services.length} service_catalog rows already in the Stax catalog.`);

  if (!EXECUTE) {
    console.log('\nDRY RUN — pass --execute to actually call the edge function.\n');
    for (const s of services.slice(0, 5)) {
      console.log(`  ${s.code.padEnd(10)} taxable=${s.taxable}  stax_item_id=${s.stax_item_id}`);
    }
    if (services.length > 5) console.log(`  ... and ${services.length - 5} more`);
    return;
  }

  console.log('Pushing each row through stax-catalog-sync...\n');
  let ok = 0, fail = 0;
  for (const s of services) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/stax-catalog-sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ serviceId: s.id }),
      });
      const result = await resp.json();
      if (resp.ok && result.ok) {
        ok++;
        console.log(`  ✓ ${s.code.padEnd(10)} ${result.action || 'synced'}`);
      } else {
        fail++;
        console.error(`  ✗ ${s.code.padEnd(10)} ${result.error || ('HTTP ' + resp.status)}`);
      }
    } catch (e) {
      fail++;
      console.error(`  ✗ ${s.code.padEnd(10)} ${e.message}`);
    }
  }
  console.log(`\nDone. ${ok} ok, ${fail} failed (of ${services.length}).`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
