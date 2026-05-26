/**
 * Probe: read Release Date + updated_at from public.inventory + audit log for
 * the 12 items the one-shot couldn't resolve from the sheet.
 *
 * Uses the SUPABASE_SERVICE_ROLE_KEY via the same env the GAS script uses.
 * Read-only.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '..', '..', 'stride-gs-app', '.env');

function loadEnv() {
  const txt = readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const SUPABASE_URL = env.VITE_SUPABASE_URL;
  const ANON = env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !ANON) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
    process.exit(1);
  }

  const targets = [
    { client: 'Modern Design Sofa', tenant: '1NQkbtHn730pKrFupC9HSN4q-FhPhhWF3kAnpm2p9Om8',
      itemIds: ['62315','62316','62317','62322','62323','62324','62325','62332'] },
    { client: 'MR. Studio', tenant: '1CUPSkPEXYzhWKcoWdmCWasBfiESVWRHg1ihIVJVfya0',
      itemIds: ['62210','62211','62213'] },
    { client: 'Nip Tuck Remodeling', tenant: '1_CINtvpNLs1pSD7kkh5-dbccM-jF7s1B4vQBkjA5eUc',
      itemIds: ['61936'] },
  ];

  for (const t of targets) {
    console.log(`\n=== ${t.client} ===`);
    const inList = '(' + t.itemIds.map((id) => `"${id}"`).join(',') + ')';
    const url = `${SUPABASE_URL}/rest/v1/inventory?tenant_id=eq.${encodeURIComponent(t.tenant)}&item_id=in.${encodeURIComponent(inList)}&select=item_id,status,release_date,receive_date,updated_at`;
    const res = await fetch(url, {
      headers: { 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
    });
    if (!res.ok) {
      console.log(`  HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
      continue;
    }
    const rows = await res.json();
    rows.sort((a, b) => String(a.item_id).localeCompare(String(b.item_id)));
    for (const r of rows) {
      console.log(`  ${r.item_id}: status=${r.status} release_date=${r.release_date || 'NULL'} receive=${r.receive_date} updated_at=${r.updated_at}`);
    }
    if (rows.length === 0) console.log('  (no rows)');

    // Also check entity_audit_log for these items
    const auditUrl = `${SUPABASE_URL}/rest/v1/entity_audit_log?tenant_id=eq.${encodeURIComponent(t.tenant)}&entity_type=eq.inventory&entity_id=in.${encodeURIComponent(inList)}&select=entity_id,action_type,performed_at,details&order=performed_at.desc`;
    const ares = await fetch(auditUrl, {
      headers: { 'apikey': ANON, 'Authorization': `Bearer ${ANON}` },
    });
    if (ares.ok) {
      const arows = await ares.json();
      console.log(`  Audit entries: ${arows.length}`);
      const byId = {};
      for (const a of arows) {
        const id = String(a.entity_id);
        if (!byId[id]) byId[id] = [];
        byId[id].push(a);
      }
      for (const id of Object.keys(byId)) {
        console.log(`    ${id}:`);
        for (const a of byId[id].slice(0, 3)) {
          const details = a.details ? JSON.stringify(a.details).substring(0, 100) : '';
          console.log(`      ${a.performed_at} ${a.action_type} ${details}`);
        }
      }
    }
  }
}

main().catch((e) => { console.error('FATAL:', e?.message || e); process.exit(1); });
