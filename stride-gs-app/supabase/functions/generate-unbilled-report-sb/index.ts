/**
 * generate-unbilled-report-sb — [MIGRATION-P4a] SHADOW/parity handler for
 * `generateUnbilledReport`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md. Ports GAS
 * `handleGenerateUnbilledReport_` (StrideAPI.gs:24244) — the cross-tenant
 * Unbilled report that drives Billing → Report — so the parity harness can
 * diff the computed row-set against the GAS output.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ SHADOW MODE — ZERO mutations / external side effects. Does NOT       │
 * │ write the CB Unbilled_Report sheet (the GAS handler's only write —   │
 * │ a Sheets-mirror side effect, excluded from parity by definition).   │
 * │ The service-role client is used for READS ONLY.                     │
 * │ active_backend stays 'gas'; no production handler is cut over.       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Parity contract (MIG-007 layer 1): the caller diffs the returned
 * `parity.rows` against the GAS response `rows[]` for the same input.
 * GAS scans each active client's per-tenant Billing_Ledger sheet; the
 * shadow scans the public.billing mirror filtered by the same predicates.
 *
 * `stats` (matched/scanned/clientsOpened/clientsFailed) are GAS
 * sheet-scan-shaped counters that don't map 1:1 onto a set-based SQL
 * read — `matched` is parity-meaningful (== rows.length) but
 * scanned/clientsOpened are approximations and are EXCLUDED from the
 * strict parity surface. `rows` is the authoritative comparison target.
 *
 * Auth: verified caller email via supabase.auth.getUser.
 *
 * Request:  POST {
 *   endDate (YYYY-MM-DD, required), clientFilter?, svcFilter?,
 *   sidemarkFilter?, includeStorage? (default true)
 * }
 * Response: { ok, shadow:true, parity:{ rows, matched }, error?, errorCode? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PostgREST default caps unbounded selects; request an explicit large
// range so a big fleet-wide unbilled backlog isn't silently truncated.
// If a real corpus ever exceeds this the parity differ will surface a
// row-count gap (fail loud, not silent).
const MAX_ROWS = 50000;

interface BillingRow {
  tenant_id: string | null;
  client_name: string | null;
  status: string | null;
  date: string | null;
  svc_code: string | null;
  svc_name: string | null;
  item_id: string | null;
  description: string | null;
  item_class: string | null;
  qty: number | string | null;
  rate: number | string | null;
  total: number | string | null;
  item_notes: string | null;
  task_id: string | null;
  repair_id: string | null;
  shipment_number: string | null;
  sidemark: string | null;
  category: string | null;
  ledger_row_id: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const endDateStr = String(body.endDate ?? '').trim();
    const clientFilterRaw = String(body.clientFilter ?? '').trim().toLowerCase();
    const svcFilterRaw = String(body.svcFilter ?? '').trim().toUpperCase();
    const sidemarkFilterRaw = String(body.sidemarkFilter ?? '').trim().toLowerCase();
    const includeStorage = body.includeStorage !== false; // default true

    if (!endDateStr) return err('endDate is required (YYYY-MM-DD)', 'INVALID_PAYLOAD');
    const endYMD = normalizeToYMD(endDateStr);
    if (!endYMD) return err(`Invalid endDate: ${endDateStr}`, 'INVALID_PAYLOAD');

    const svcCodes = svcFilterRaw ? svcFilterRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const clientNames = clientFilterRaw ? clientFilterRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const sidemarkNames = sidemarkFilterRaw ? sidemarkFilterRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return err('Server misconfigured', 'CONFIG_ERROR', 500);
    }

    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }
    // READ-ONLY client. SHADOW MODE — no writes anywhere.
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Active clients (SB mirror of the CB Clients sheet scan) ──────
    const { data: clientsData, error: clientsErr } = await supabase
      .from('clients')
      .select('spreadsheet_id, name, active');
    if (clientsErr) {
      return err(`Failed to read clients: ${clientsErr.message}`, 'SERVER_ERROR', 500);
    }
    const activeClients = (clientsData ?? []).filter(c => {
      const name = String(c.name ?? '').trim();
      const id = String(c.spreadsheet_id ?? '').trim();
      if (!name || !id) return false;
      const a = c.active;
      if (a === false || a === 'FALSE' || a === 'No') return false;
      if (clientNames.length && clientNames.indexOf(name.toLowerCase()) < 0) return false;
      return true;
    });

    if (!activeClients.length) {
      return ok({
        parity: { rows: [], matched: 0 },
        response: { success: true, rows: [], stats: { matched: 0, scanned: 0, clientsOpened: 0 } },
      });
    }
    const tenantIds = activeClients.map(c => String(c.spreadsheet_id).trim());
    const clientNameByTenant: Record<string, string> = {};
    for (const c of activeClients) clientNameByTenant[String(c.spreadsheet_id).trim()] = String(c.name).trim();

    // ── Billing rows for those tenants ───────────────────────────────
    const { data: billData, error: billErr } = await supabase
      .from('billing')
      .select(
        'tenant_id, client_name, status, date, svc_code, svc_name, item_id, ' +
        'description, item_class, qty, rate, total, item_notes, task_id, ' +
        'repair_id, shipment_number, sidemark, category, ledger_row_id',
      )
      .in('tenant_id', tenantIds)
      .range(0, MAX_ROWS - 1);
    if (billErr) {
      return err(`Failed to read billing: ${billErr.message}`, 'SERVER_ERROR', 500);
    }
    const billRows = (billData ?? []) as BillingRow[];
    let scanned = 0;

    // First pass — collect (tenant,itemId) needing a sidemark fallback.
    const needSidemark: Record<string, Set<string>> = {};
    for (const row of billRows) {
      const sm = String(row.sidemark ?? '').trim();
      const itemId = String(row.item_id ?? '').trim();
      const tid = String(row.tenant_id ?? '').trim();
      if (!sm && itemId && tid) {
        (needSidemark[tid] ??= new Set()).add(itemId);
      }
    }

    // Inventory sidemark lookup, keyed tenant→itemId (mirrors GAS's
    // per-client Inventory scan fallback).
    const sidemarkByTenantItem: Record<string, Record<string, string>> = {};
    for (const tid of Object.keys(needSidemark)) {
      const ids = Array.from(needSidemark[tid]);
      if (!ids.length) continue;
      const { data: invData } = await supabase
        .from('inventory')
        .select('item_id, sidemark')
        .eq('tenant_id', tid)
        .in('item_id', ids);
      const map: Record<string, string> = {};
      for (const ir of invData ?? []) {
        const iid = String((ir as { item_id?: string }).item_id ?? '').trim();
        if (iid) map[iid] = String((ir as { sidemark?: string }).sidemark ?? '').trim();
      }
      sidemarkByTenantItem[tid] = map;
    }

    const outRows: Array<Record<string, unknown>> = [];

    for (const row of billRows) {
      scanned++;
      const tid = String(row.tenant_id ?? '').trim();

      const statusRaw = String(row.status == null ? '' : row.status).trim().toLowerCase();
      if (statusRaw && statusRaw !== 'unbilled') continue;

      const rowYMD = normalizeToYMD(row.date);
      if (!rowYMD) continue;
      if (rowYMD > endYMD) continue;

      const svcCode = String(row.svc_code ?? '').trim().toUpperCase();
      if (svcCodes.length > 0 && svcCodes.indexOf(svcCode) === -1) continue;
      if (!includeStorage && svcCode === 'STOR') continue;

      const itemId = String(row.item_id ?? '').trim();
      let sidemark = String(row.sidemark ?? '').trim();
      if (!sidemark && itemId) sidemark = sidemarkByTenantItem[tid]?.[itemId] ?? '';

      if (sidemarkNames.length && sidemarkNames.indexOf(sidemark.toLowerCase()) < 0) continue;

      outRows.push({
        client: String(row.client_name ?? '').trim() || (clientNameByTenant[tid] ?? ''),
        sidemark,
        date: rowYMD, // YYYYMMDD — same shape as api_formatYMD_
        svcCode,
        svcName: String(row.svc_name ?? ''),
        itemId,
        description: String(row.description ?? ''),
        itemClass: String(row.item_class ?? ''),
        qty: Number(row.qty) || 0,
        rate: Number(row.rate) || 0,
        total: Number(row.total) || 0,
        notes: String(row.item_notes ?? ''),
        taskId: String(row.task_id ?? ''),
        repairId: String(row.repair_id ?? ''),
        shipmentNo: String(row.shipment_number ?? ''),
        category: String(row.category ?? ''),
        ledgerRowId: String(row.ledger_row_id ?? ''),
        sourceSheetId: tid,
      });
    }

    // Sort by client asc, then date desc — identical to GAS.
    outRows.sort((a, b) => {
      const ac = String(a.client), bc = String(b.client);
      if (ac < bc) return -1;
      if (ac > bc) return 1;
      return String(b.date).localeCompare(String(a.date));
    });

    return ok({
      parity: {
        rows: outRows,
        matched: outRows.length,
        endDate: endYMD,
        filters: {
          clientNames, svcCodes, sidemarkNames, includeStorage,
        },
        callerEmail,
      },
      response: {
        success: true,
        rows: outRows,
        stats: {
          matched: outRows.length,
          scanned,
          clientsOpened: activeClients.length,
          clientsFailed: 0,
        },
      },
      excludedFromParity: ['stats.scanned', 'stats.clientsOpened', 'stats.clientsFailed'],
    });
  } catch (e) {
    console.error('[generate-unbilled-report-sb] Unexpected error:', e);
    return err(String(e), 'SERVER_ERROR', 500);
  }
});

// Mirror of api_normalizeDateToMidnight_ + api_formatYMD_ → "YYYYMMDD".
// Accepts Date-ish strings (ISO 'YYYY-MM-DD', 'MM/dd/yyyy', already-'YYYYMMDD').
// Returns null when unparseable (GAS `if (!rowDate) continue`).
function normalizeToYMD(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{8}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).replace(/-/g, '');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return `${m[3]}${mm}${dd}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

function ok(parity: unknown): Response {
  return new Response(JSON.stringify({ ok: true, shadow: true, ...(parity as object) }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(error: string, errorCode: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, shadow: true, error, errorCode }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
