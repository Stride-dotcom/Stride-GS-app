/**
 * commit-storage-charges-sb — SB-primary handler for `generateStorageCharges`
 *                             AND `commitStorageRows`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md
 *   MIG-005  Phase 4a billing-core. SB writes public.billing directly;
 *            per-tenant Billing_Ledger sheet mirrored best-effort.
 *
 * Replaces GAS handlers:
 *   • `handleGenerateStorageCharges_` (StrideAPI.gs:22808) — compute + insert
 *     STOR rows for every active client in a [startDate, endDate] window.
 *   • `handleCommitStorageRows_`      (StrideAPI.gs:23223) — commit a
 *     pre-computed set of rows (operator may have edited the preview).
 *
 * TWO paths, chosen by whether the body carries a `rows[]` array:
 *
 *   1. COMMIT (commitStorageRows) — body has `rows[]`. This is the operator's
 *      EDITED preview: ONLY the checked rows, with inline rate/qty edits. The
 *      commit MUST write exactly these rows; it must NOT re-derive from
 *      inventory (that would re-bill rows the operator unchecked, e.g. comped
 *      storage — the billing-checkbox bug). Proxies to GAS
 *      handleCommitStorageRows_, the canonical commit (per-tenant +
 *      per-sidemark summarization, finalized-summary fence,
 *      storage_billing_items dedup, transfer-backfill protection, sheet +
 *      public.billing write-through, multi-tenant fan-out). Byte-identical to
 *      the GAS path real clients run on.
 *
 *   2. RECOMPUTE (generateStorageCharges) — no `rows[]`. Single-tenant sweep
 *      that derives the full storage set from inventory via
 *      `public.generate_storage_charges(tenant_id, sidemark, period_start,
 *      period_end)` RPC. As of migration 20260528120000 the RPC aggregates
 *      per-item charges into ONE public.billing row per tenant per commit
 *      (ledger_row_id = STOR-SUMMARY-<tenantId>-<YYYYMMDD>-<YYYYMMDD>),
 *      description = "Monthly Storage", total = SUM. The per-item dedup pass +
 *      delete-stale-Unbilled pass + finalized-summary fence are all inside the
 *      Postgres transaction. This handler stays a thin orchestrator: validate
 *      input, call RPC, read back the new summary row(s), mirror to per-tenant
 *      sheets, audit-log.
 *
 * Inputs:
 *   COMMIT:    { rows[], periodStart, periodEnd, callerEmail }
 *   RECOMPUTE: { tenantId, callerEmail, requestId?, billingMonth?, startDate?, endDate?, sidemark? }
 *
 *   - `billingMonth` (YYYY-MM): convenience — expands to
 *     startDate=first-of-month, endDate=last-of-month. If not provided,
 *     caller must supply startDate AND endDate (YYYY-MM-DD).
 *   - `tenantId` REQUIRED — multi-tenant fleet sweep is operator-only via
 *     the GAS path. The SB EF refuses unscoped sweeps to avoid an
 *     accidentally-fleet-wide commit when one tenant misconfigures a flag.
 *   - `sidemark` (optional) — narrow to a single sidemark group.
 *
 * Response:
 *   { success, rowsCreated, total, clientsAffected, rows: [...],
 *     mirroredCount, warnings? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { gasProxy } from '../_shared/gas-proxy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CommitStorageBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  billingMonth?: string;   // YYYY-MM
  startDate?: string;      // YYYY-MM-DD
  endDate?: string;        // YYYY-MM-DD
  sidemark?: string;
  // ── commitStorageRows path ──────────────────────────────────────────
  // The React commit (`commitStorageRows`) POSTs the operator's EDITED
  // preview: periodStart/periodEnd + a `rows[]` array of ONLY the checked
  // rows (with any inline rate/qty edits). This is a COMMIT, not a
  // recompute — see the commit branch in Deno.serve.
  periodStart?: string;    // YYYY-MM-DD (commitStorageRows)
  periodEnd?: string;      // YYYY-MM-DD (commitStorageRows)
  rows?: unknown[];        // operator-selected per-item rows (commitStorageRows)
}

interface BillingRow {
  ledger_row_id: string;
  status: string;
  client_name: string | null;
  date: string | null;
  svc_code: string | null;
  item_id: string | null;
  description: string | null;
  item_class: string | null;
  qty: number | null;
  rate: number | null;
  total: number | null;
  task_id: string | null;
  sidemark: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: CommitStorageBody;
  try { body = await req.json(); }
  catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  // ── COMMIT path (commitStorageRows) ──────────────────────────────────
  // When the caller sends a `rows[]` array it is the React commit handler
  // shipping the operator's EDITED preview: ONLY the checked rows, with any
  // inline rate/qty edits. Committing MUST write exactly these rows — it must
  // NEVER re-derive the full storage set from inventory (the recompute path
  // below), because re-deriving silently re-bills rows the operator unchecked
  // (e.g. comped storage) and folds them into the monthly summary. That is the
  // billing-checkbox bug this EF was on the wrong side of: the recompute path
  // throws the operator's selection away.
  //
  // The canonical commit logic — per-tenant + per-sidemark summarization, the
  // finalized-summary fence, storage_billing_items dedup, transfer-backfill
  // protection, and the Billing_Ledger sheet + public.billing write-through —
  // lives in GAS handleCommitStorageRows_. Proxy to it so the SB-routed commit
  // is byte-identical to the GAS path real clients run on, and so GAS owns the
  // multi-tenant fan-out (the recompute path below is single-tenant only). GAS
  // mirrors each committed summary to public.billing, so the React
  // Supabase-read report reflects the commit.
  if (Array.isArray(body.rows)) {
    const periodStart = String(body.periodStart ?? '').trim();
    const periodEnd   = String(body.periodEnd   ?? '').trim();
    const commitRows  = body.rows;
    if (commitRows.length === 0) {
      return json({ success: true, totalCreated: 0, clientsProcessed: 0, message: 'No rows to commit' });
    }
    if (!periodStart || !periodEnd) {
      return json({ error: 'periodStart and periodEnd are required for commitStorageRows', code: 'INVALID_PARAMS' }, 400);
    }
    const callerEmailForProxy = String(body.callerEmail ?? '').trim();
    const proxied = await gasProxy<Record<string, unknown>>('commitStorageRows', {
      periodStart,
      periodEnd,
      rows: commitRows,
      ...(callerEmailForProxy ? { callerEmail: callerEmailForProxy } : {}),
    });
    if (!proxied.ok) {
      // Surface GAS's own envelope when present (carries the operator-facing
      // error message); otherwise the proxy-level transport error.
      const gasBody = proxied.data as Record<string, unknown> | undefined;
      if (gasBody && typeof gasBody === 'object') {
        return json(gasBody, proxied.httpStatus ?? 502);
      }
      return json({ error: proxied.error ?? 'GAS commitStorageRows failed', code: 'GAS_PROXY_FAILED' }, 502);
    }
    return json(proxied.data ?? { success: true });
  }

  // ── RECOMPUTE path (generateStorageCharges) ──────────────────────────
  // No rows[] supplied: derive the full storage set for one tenant from
  // inventory via the generate_storage_charges RPC (preview/sweep).
  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const sidemark    = String(body.sidemark    ?? '').trim();
  const billingMonth = String(body.billingMonth ?? '').trim();

  if (!tenantId) return json({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);

  // Resolve date window. Prefer explicit start/end; fall back to
  // billingMonth → first-of-month..last-of-month.
  let startDate = String(body.startDate ?? '').trim();
  let endDate   = String(body.endDate   ?? '').trim();
  if (!startDate || !endDate) {
    if (!billingMonth) {
      return json({
        error: 'Provide either (billingMonth=YYYY-MM) or (startDate=YYYY-MM-DD, endDate=YYYY-MM-DD)',
        code:  'INVALID_PARAMS',
      }, 400);
    }
    const m = /^(\d{4})-(\d{2})$/.exec(billingMonth);
    if (!m) return json({ error: `Invalid billingMonth (expected YYYY-MM): ${billingMonth}`, code: 'INVALID_PARAMS' }, 400);
    const year  = Number(m[1]);
    const month = Number(m[2]); // 1-12
    if (!(year >= 2000 && year < 3000) || !(month >= 1 && month <= 12)) {
      return json({ error: `Out-of-range billingMonth: ${billingMonth}`, code: 'INVALID_PARAMS' }, 400);
    }
    const first = new Date(Date.UTC(year, month - 1, 1));
    // Last day of month = day-0 of next month.
    const last  = new Date(Date.UTC(year, month, 0));
    startDate = first.toISOString().slice(0, 10);
    endDate   = last.toISOString().slice(0, 10);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return json({ error: `Invalid startDate (expected YYYY-MM-DD): ${startDate}`, code: 'INVALID_PARAMS' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate))   return json({ error: `Invalid endDate (expected YYYY-MM-DD): ${endDate}`,     code: 'INVALID_PARAMS' }, 400);
    if (endDate < startDate) return json({ error: 'endDate must be on or after startDate', code: 'INVALID_PARAMS' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[commit-storage-charges-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);
  const warnings: string[] = [];

  // ── 1. Call generate_storage_charges RPC ────────────────────────────
  // Migration 20260502200000_storage_charges_postgres_function.sql.
  // Signature: generate_storage_charges(p_tenant_id, p_sidemark,
  //   p_period_start, p_period_end) → (total_created, total_amount,
  //   clients_affected). Internally:
  //   • deletes Unbilled STOR rows in the window for affected tenants
  //   • inserts fresh rows from _compute_storage_charges (which mirrors
  //     GAS's calculation byte-for-byte including the dedup-against-
  //     Invoiced/Billed/Void STOR rows pass)
  //   • idempotent on re-run with identical bounds.
  const rpcArgs = {
    p_tenant_id:    tenantId,
    p_sidemark:     sidemark || null,
    p_period_start: startDate,
    p_period_end:   endDate,
  };
  const { data: rpcDataRaw, error: rpcErr } = await sb.rpc('generate_storage_charges', rpcArgs);
  if (rpcErr) {
    console.error('[commit-storage-charges-sb] generate_storage_charges RPC failed:', rpcErr.message);
    return json({ error: `Storage charge RPC failed: ${rpcErr.message}`, code: 'RPC_ERROR' }, 500);
  }
  // RPC returns TABLE(total_created int, total_amount numeric, clients_affected int).
  // PostgREST surfaces this as an array with one row.
  const rpcData = Array.isArray(rpcDataRaw) ? rpcDataRaw[0] : rpcDataRaw;
  const rowsCreated      = Number((rpcData as { total_created?: number } | null)?.total_created ?? 0);
  const totalAmount      = Number((rpcData as { total_amount?: number } | null)?.total_amount ?? 0);
  const clientsAffected  = Number((rpcData as { clients_affected?: number } | null)?.clients_affected ?? 0);

  if (rowsCreated === 0) {
    return json({
      success:         true,
      rowsCreated:     0,
      total:           0,
      clientsAffected: 0,
      rows:            [],
      message:         'No new storage charges to create in this window (either no eligible inventory, or all rows already finalized).',
    });
  }

  // ── 2. Read back the newly inserted Unbilled STOR rows in the window.
  // The RPC doesn't return the row set — we re-fetch for mirroring + audit.
  const { data: rowsRaw, error: readErr } = await sb
    .from('billing')
    .select('ledger_row_id, status, client_name, date, svc_code, item_id, description, item_class, qty, rate, total, task_id, sidemark')
    .eq('tenant_id', tenantId)
    .eq('svc_code', 'STOR')
    .eq('status', 'Unbilled')
    .gte('date', startDate)
    .lte('date', endDate);

  if (readErr) {
    warnings.push(`Created rows but read-back for mirror failed: ${readErr.message}`);
  }
  const rows = (rowsRaw ?? []) as BillingRow[];

  // ── 3. Audit log (per-row best-effort) ──────────────────────────────
  // GAS audits storage commit at the batch level (no per-row entries).
  // We follow suit — one audit row summarizing the batch keeps audit
  // volume bounded for big monthly sweeps (hundreds of STOR rows).
  await sb.from('entity_audit_log').insert({
    entity_type:   'billing',
    entity_id:     `STOR-batch-${startDate}-to-${endDate}`,
    tenant_id:     tenantId,
    action:        'create',
    changes:       {
      summary:        'Storage charge batch',
      svcCode:        'STOR',
      periodStart:    startDate,
      periodEnd:      endDate,
      sidemark:       sidemark || null,
      rowsCreated,
      totalAmount,
    },
    performed_by:  callerEmail || 'commit-storage-charges-sb',
    source:        'supabase',
  }).then(() => {}, (e: unknown) => {
    console.error('[commit-storage-charges-sb] audit-log insert failed:', e);
    warnings.push(`Audit log insert failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  // ── 4. Reverse-writethrough each new row to per-tenant Billing_Ledger
  // Best-effort. Per-row fan-out (no bulk variant). MIG-005 / MIG-016
  // sheet-drift gap applies — full-sync cron picks up residual drift.
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  let mirroredCount = 0;
  if (!gasUrl || !gasToken) {
    warnings.push('GAS_API_URL / GAS_API_TOKEN not configured — Billing_Ledger sheet mirror skipped');
  } else {
    for (const row of rows) {
      try {
        const payload = {
          tenantId,
          table:  'billing',
          op:     'insert', // STOR rows are net-new
          rowId:  row.ledger_row_id,
          row,
          requestId: `${requestId}:${row.ledger_row_id}`,
        };
        const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        const text = await res.text();
        let parsed: { success?: boolean; error?: string } = {};
        try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
        if (!res.ok || !parsed.success) {
          const errMsg = parsed.error ?? `HTTP ${res.status}`;
          warnings.push(`Sheet mirror failed for ${row.ledger_row_id}: ${errMsg}`);
          await sb.from('gs_sync_events').insert({
            tenant_id:     tenantId,
            entity_type:   'billing',
            entity_id:     row.ledger_row_id,
            action_type:   'writethrough_reverse',
            sync_status:   'sync_failed',
            requested_by:  callerEmail || 'commit-storage-charges-sb',
            request_id:    `${requestId}:${row.ledger_row_id}`,
            payload,
            error_message: String(errMsg).slice(0, 1000),
          }).then(() => {}, () => {});
        } else {
          mirroredCount++;
        }
      } catch (mirrorEx) {
        warnings.push(`Sheet mirror threw for ${row.ledger_row_id}: ${mirrorEx instanceof Error ? mirrorEx.message : String(mirrorEx)}`);
      }
    }
  }

  return json({
    success:         true,
    rowsCreated,
    total:           totalAmount,
    clientsAffected,
    rows,
    mirroredCount,
    periodStart:     startDate,
    periodEnd:       endDate,
    warnings:        warnings.length > 0 ? warnings : undefined,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
