/**
 * generate-unbilled-report-sb — SB-primary handler for `generateUnbilledReport`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decision MIG-016.
 *
 * Replaces GAS handler `handleGenerateUnbilledReport_` (StrideAPI.gs ~line 24900).
 * Read-only — no writes.
 *
 * The GAS handler walks every active client spreadsheet's Billing_Ledger
 * tab and aggregates unbilled rows. Since public.billing is already the
 * authoritative cross-tenant ledger (all per-tenant Billing_Ledger sheets
 * mirror into it), this EF queries a single Postgres table and returns
 * either per-row detail or grouped summaries.
 *
 * Inputs (all optional):
 *   tenantId?:     string                 — restrict to one tenant
 *   endDate?:      YYYY-MM-DD             — only include rows date <= endDate
 *   clientFilter?: string | string[]      — comma-list, case-insensitive
 *   svcFilter?:    string | string[]      — comma-list of svc_codes, uppercase
 *   sidemarkFilter?: string | string[]    — comma-list, case-insensitive
 *   includeStorage?: boolean              — default true; false skips STOR
 *   groupBy?:      'detail' | 'sidemark'  — default 'detail'
 *                  'detail'    → per-row output (matches GAS shape)
 *                  'sidemark'  → aggregated by (tenantId, client, sidemark)
 *
 * Response:
 *   { success: true,
 *     rows: [
 *       // when groupBy='detail' (GAS-shape; one per billing row)
 *       { client, sidemark, date (YYYYMMDD), svcCode, svcName, itemId,
 *         description, itemClass, qty, rate, total, notes, taskId,
 *         repairId, shipmentNo, category, ledgerRowId, tenantId }
 *       // when groupBy='sidemark'
 *       { tenantId, client, sidemark, rowCount, total }
 *     ],
 *     grandTotal: number,
 *     stats: { matched, scanned, tenantsCovered },
 *     message?
 *   }
 *
 * Authorization: verify_jwt=true (default). Service role used to read
 * public.billing; staff-tier callers via the routing layer.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UnbilledBody {
  tenantId?:        string;
  callerEmail?:     string;
  requestId?:       string;
  endDate?:         string;            // YYYY-MM-DD
  clientFilter?:    string | string[];
  svcFilter?:       string | string[];
  sidemarkFilter?:  string | string[];
  includeStorage?:  boolean;           // default true
  groupBy?:         'detail' | 'sidemark';
}

interface BillingRowDb {
  tenant_id:       string;
  ledger_row_id:   string;
  status:          string;
  client_name:     string | null;
  date:            string | null;
  svc_code:        string | null;
  svc_name:        string | null;
  category:        string | null;
  item_id:         string | null;
  description:     string | null;
  item_class:      string | null;
  qty:             number | null;
  rate:            number | null;
  total:           number | null;
  task_id:         string | null;
  repair_id:       string | null;
  shipment_number: string | null;
  item_notes:      string | null;
  sidemark:        string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: UnbilledBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId       = String(body.tenantId    ?? '').trim();
  const endDateRaw     = String(body.endDate     ?? '').trim();
  const includeStorage = body.includeStorage !== false;
  const groupBy        = body.groupBy === 'sidemark' ? 'sidemark' : 'detail';

  // Normalize comma-separated filters.
  const clientNames  = toLowerList(body.clientFilter);
  const svcCodes     = toUpperList(body.svcFilter);
  const sidemarks    = toLowerList(body.sidemarkFilter);

  // Validate endDate when provided.
  let endDateIso: string | null = null;
  if (endDateRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDateRaw)) {
      return json({ error: `Invalid endDate (expected YYYY-MM-DD): ${endDateRaw}`, code: 'INVALID_PAYLOAD' }, 400);
    }
    endDateIso = endDateRaw;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[generate-unbilled-report-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // ── Query public.billing ───────────────────────────────────────────────
  // Paginate to be safe against arbitrarily large unbilled backlogs. 1k
  // batch fits inside PostgREST's default limit.
  const PAGE_SIZE = 1000;
  const rows: BillingRowDb[] = [];
  let offset = 0;
  for (;;) {
    let q = sb
      .from('billing')
      .select('tenant_id, ledger_row_id, status, client_name, date, svc_code, svc_name, category, item_id, description, item_class, qty, rate, total, task_id, repair_id, shipment_number, item_notes, sidemark')
      .eq('status', 'Unbilled')
      .order('client_name', { ascending: true })
      .order('date',        { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (tenantId)     q = q.eq('tenant_id', tenantId);
    if (endDateIso)   q = q.lte('date', endDateIso);
    if (!includeStorage) q = q.neq('svc_code', 'STOR');
    if (svcCodes.length > 0) q = q.in('svc_code', svcCodes);
    // client_name + sidemark filters: PostgREST `in` is case-sensitive, so
    // we filter client-side after the query for parity with the GAS handler
    // (which does .toLowerCase() comparisons).

    const { data, error } = await q;
    if (error) {
      console.error('[generate-unbilled-report-sb] billing read failed:', error.message);
      return json({ error: `Read failed: ${error.message}`, code: 'READ_FAILED' }, 500);
    }
    const batch = (data ?? []) as BillingRowDb[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    // Safety cap — unbilled backlogs > 50k indicate a bigger problem.
    if (offset > 50000) break;
  }

  // ── Apply case-insensitive client + sidemark filters ───────────────────
  const filtered: BillingRowDb[] = [];
  for (const r of rows) {
    const cname = String(r.client_name ?? '').trim().toLowerCase();
    if (clientNames.length > 0 && !clientNames.includes(cname)) continue;
    const sm = String(r.sidemark ?? '').trim().toLowerCase();
    if (sidemarks.length > 0 && !sidemarks.includes(sm)) continue;
    filtered.push(r);
  }

  // ── Shape the response ─────────────────────────────────────────────────
  const tenantsCovered = new Set<string>();
  let grandTotal = 0;

  if (groupBy === 'sidemark') {
    type Key = string;
    const groups = new Map<Key, { tenantId: string; client: string; sidemark: string; rowCount: number; total: number }>();
    for (const r of filtered) {
      const tn  = String(r.tenant_id   ?? '');
      const cn  = String(r.client_name ?? '').trim() || 'Unknown';
      const sm  = String(r.sidemark    ?? '').trim();
      const key = `${tn}::${cn}::${sm}`;
      tenantsCovered.add(tn);
      let g = groups.get(key);
      if (!g) {
        g = { tenantId: tn, client: cn, sidemark: sm, rowCount: 0, total: 0 };
        groups.set(key, g);
      }
      g.rowCount += 1;
      const t = Number(r.total ?? 0);
      g.total += Number.isFinite(t) ? t : 0;
      grandTotal += Number.isFinite(t) ? t : 0;
    }
    const out = Array.from(groups.values()).sort((a, b) => {
      if (a.client !== b.client) return a.client < b.client ? -1 : 1;
      return a.sidemark < b.sidemark ? -1 : a.sidemark > b.sidemark ? 1 : 0;
    });
    return json({
      success:    true,
      rows:       out,
      grandTotal: round2(grandTotal),
      stats: {
        matched:        out.length,
        scanned:        rows.length,
        tenantsCovered: tenantsCovered.size,
      },
    });
  }

  // groupBy === 'detail' — GAS-shape rows
  const detail = filtered.map(r => {
    const tn = String(r.tenant_id ?? '');
    tenantsCovered.add(tn);
    const t = Number(r.total ?? 0);
    if (Number.isFinite(t)) grandTotal += t;
    return {
      tenantId:    tn,
      client:      String(r.client_name ?? '').trim(),
      sidemark:    String(r.sidemark    ?? '').trim(),
      date:        ymdFromIso(r.date),
      svcCode:     String(r.svc_code ?? '').toUpperCase(),
      svcName:     String(r.svc_name ?? ''),
      itemId:      String(r.item_id  ?? ''),
      description: String(r.description ?? ''),
      itemClass:   String(r.item_class ?? ''),
      qty:         Number(r.qty   ?? 0) || 0,
      rate:        Number(r.rate  ?? 0) || 0,
      total:       Number(r.total ?? 0) || 0,
      notes:       String(r.item_notes ?? ''),
      taskId:      String(r.task_id    ?? ''),
      repairId:    String(r.repair_id  ?? ''),
      shipmentNo:  String(r.shipment_number ?? ''),
      category:    String(r.category   ?? ''),
      ledgerRowId: String(r.ledger_row_id),
    };
  });

  // Sort by client ASC then date DESC (matches GAS).
  detail.sort((a, b) => {
    if (a.client !== b.client) return a.client < b.client ? -1 : 1;
    return b.date.localeCompare(a.date);
  });

  return json({
    success:    true,
    rows:       detail,
    grandTotal: round2(grandTotal),
    stats: {
      matched:        detail.length,
      scanned:        rows.length,
      tenantsCovered: tenantsCovered.size,
    },
    message: detail.length === 0 ? 'No unbilled rows match the filter' : undefined,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function toLowerList(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v.join(',') : String(v);
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function toUpperList(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v.join(',') : String(v);
  return raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

function ymdFromIso(d: string | null): string {
  if (!d) return '';
  // Accept either YYYY-MM-DD or full ISO timestamp.
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[1]}${m[2]}${m[3]}`; // YYYYMMDD for sort parity with GAS
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
