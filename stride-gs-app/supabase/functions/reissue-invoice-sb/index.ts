/**
 * reissue-invoice-sb — SB-primary handler for `reissueInvoice`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md
 *   MIG-005  Phase 4a billing-core. SB owns public.billing writes;
 *            CB Consolidated_Ledger row deletes stay GAS-owned
 *            until Phase 4b.
 *
 * Replaces GAS handler `handleReissueInvoice_` (StrideAPI.gs:14462).
 *
 * Re-issue = "unwind an Invoiced or Void invoice back to Unbilled":
 *   • Flip billing.status from 'Invoiced'/'Void' → 'Unbilled'.
 *   • Clear invoice_no + invoice_date.
 *   • Operator then re-runs Create Invoices for a fresh invoice # /
 *     sidemark grouping. (The handler does NOT re-create automatically.)
 *
 * Flow:
 *   1. Validate (tenantId, invoiceNo).
 *   2. Read rows for (tenant, invoice_no, status IN ('Invoiced','Void')).
 *   3. UPDATE billing SET status='Unbilled', invoice_no='',
 *      invoice_date='' WHERE invoice_no=... AND status IN ('Invoiced','Void').
 *   4. Audit log: entity_type='billing', action='reissue_invoice'.
 *   5. Reverse-writethrough each row to per-tenant Billing_Ledger
 *      (status → 'Unbilled', clear invoice_no). Best-effort.
 *
 * Note on CB Consolidated_Ledger: GAS handleReissueInvoice_ also calls
 * api_deleteCbRowsByInvoiceNo_ to drop the CB-side rows so the next
 * Create Invoices run produces fresh CB rows under a new invoice #.
 * Per MIG-005 the CB delete stays GAS-authoritative through 4a — the
 * full-sync cron + (future) CB delete writer close that loop.
 *
 * Inputs: { tenantId, callerEmail, requestId?, invoiceNo, reason? }
 * Response: { success, invoiceNo, rowsReissued, ledgerRowIds[], warnings? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReissueInvoiceBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  invoiceNo?: string;
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: ReissueInvoiceBody;
  try { body = await req.json(); }
  catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const invoiceNo   = String(body.invoiceNo   ?? '').trim();
  const reason      = String(body.reason      ?? '').trim().slice(0, 500);

  if (!tenantId)  return json({ error: 'tenantId is required',  code: 'INVALID_PARAMS' }, 400);
  if (!invoiceNo) return json({ error: 'invoiceNo is required', code: 'INVALID_PARAMS' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[reissue-invoice-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);
  const warnings: string[] = [];

  // ── 1. Read all rows for this invoice ──────────────────────────────
  const { data: rowsRaw, error: readErr } = await sb
    .from('billing')
    .select('ledger_row_id, status, item_notes')
    .eq('tenant_id', tenantId)
    .eq('invoice_no', invoiceNo);

  if (readErr) {
    console.error('[reissue-invoice-sb] read failed:', readErr.message);
    return json({ error: `Read failed: ${readErr.message}`, code: 'READ_FAILED' }, 500);
  }
  const rows = (rowsRaw ?? []) as Array<{ ledger_row_id: string; status: string; item_notes: string | null }>;
  if (rows.length === 0) {
    return json({ error: `No billing rows found for invoice ${invoiceNo}`, code: 'NOT_FOUND' }, 404);
  }

  const eligible = rows.filter(r => r.status === 'Invoiced' || r.status === 'Void');
  const alreadyUnbilled = rows.filter(r => r.status === 'Unbilled').length;
  if (eligible.length === 0) {
    return json({
      error: `No Invoiced/Void rows for invoice ${invoiceNo} (alreadyUnbilled=${alreadyUnbilled})`,
      code: 'NO_REISSUABLE_ROWS',
      alreadyUnbilled,
    }, 400);
  }

  // ── 2. UPDATE billing → Unbilled ────────────────────────────────────
  // Clear invoice_no + invoice_date. The Item Notes append ("Re-issued via
  // UI YYYY-MM-DD: <reason>") is done per-row below because Item Notes is
  // per-row history, not uniform.
  // 2026-05-24 — public.billing has NO `invoiced_at`, `voided_at`, or
  // `void_reason` columns; the prior code wrote nulls to those non-existent
  // columns and the UPDATE failed with PostgREST PGRST204. Drop them.
  const nowIso = new Date().toISOString();
  const todayStr = nowIso.slice(0, 10);
  const noteSuffix = `Re-issued via UI ${todayStr}${reason ? `: ${reason}` : ''}`;
  const eligibleIds = eligible.map(r => r.ledger_row_id);

  // First update: clear status / invoice_no / invoice_date in bulk.
  const { data: reissuedRaw, error: upErr } = await sb
    .from('billing')
    .update({
      status:       'Unbilled',
      invoice_no:   '',
      invoice_date: '',
      updated_at:   nowIso,
    })
    .eq('tenant_id', tenantId)
    .in('ledger_row_id', eligibleIds)
    .in('status', ['Invoiced', 'Void'])
    .select('ledger_row_id, item_notes');

  if (upErr) {
    console.error('[reissue-invoice-sb] update failed:', upErr.message);
    return json({ error: `Update failed: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);
  }
  const reissued = (reissuedRaw ?? []) as Array<{ ledger_row_id: string; item_notes: string | null }>;

  // Second pass: append noteSuffix to each row's item_notes. Done
  // per-row to preserve existing per-row history (matches GAS sparse
  // setValue loop in handleReissueInvoice_).
  for (const r of reissued) {
    const existing = String(r.item_notes ?? '').trim();
    const combined = existing ? `${existing} | ${noteSuffix}` : noteSuffix;
    const { error: noteErr } = await sb
      .from('billing')
      .update({ item_notes: combined, updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .eq('ledger_row_id', r.ledger_row_id);
    if (noteErr) {
      warnings.push(`Note append failed for ${r.ledger_row_id}: ${noteErr.message}`);
    }
  }

  // ── 3. Audit log (best-effort) — matches GAS shape ─────────────────
  await sb.from('entity_audit_log').insert({
    entity_type:   'billing',
    entity_id:     invoiceNo,
    tenant_id:     tenantId,
    action:        'reissue_invoice',
    changes:       {
      invoiceNo,
      rowsReissued: reissued.length,
      ledgerRowIds: reissued.map(r => r.ledger_row_id),
      reason,
      alreadyUnbilledSkipped: alreadyUnbilled,
    },
    performed_by:  callerEmail || 'reissue-invoice-sb',
    source:        'supabase',
  }).then(() => {}, (e: unknown) => {
    console.error('[reissue-invoice-sb] audit-log insert failed:', e);
    warnings.push(`Audit log insert failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  // ── 4. Reverse-writethrough per-row to Billing_Ledger ──────────────
  // Flip Status='Unbilled', clear Invoice #. Note: the GAS billing
  // writer (__writeThroughReverseBilling_) guards against overwriting
  // rows whose sheet-side Status is 'Invoiced' — but the unwind
  // semantics we want here is explicitly "Invoiced → Unbilled", so
  // we accept that the writer may refuse to flip rows that
  // separately drift back to 'Invoiced' on the sheet between our SB
  // commit and the mirror. Surface those refusals as warnings; the
  // full-sync cron eventually reconciles.
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  let mirroredCount = 0;
  if (!gasUrl || !gasToken) {
    warnings.push('GAS_API_URL / GAS_API_TOKEN not configured — Billing_Ledger sheet mirror skipped');
  } else {
    for (const r of reissued) {
      try {
        const payload = {
          tenantId,
          table:  'billing',
          op:     'update',
          rowId:  r.ledger_row_id,
          row:    {
            ledger_row_id: r.ledger_row_id,
            status:        'Unbilled',
            invoice_no:    '',
          },
          requestId: `${requestId}:${r.ledger_row_id}`,
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
          warnings.push(`Sheet mirror failed for ${r.ledger_row_id}: ${errMsg}`);
          await sb.from('gs_sync_events').insert({
            tenant_id:     tenantId,
            entity_type:   'billing',
            entity_id:     r.ledger_row_id,
            action_type:   'writethrough_reverse',
            sync_status:   'sync_failed',
            requested_by:  callerEmail || 'reissue-invoice-sb',
            request_id:    `${requestId}:${r.ledger_row_id}`,
            payload,
            error_message: String(errMsg).slice(0, 1000),
          }).then(() => {}, () => {});
        } else {
          mirroredCount++;
        }
      } catch (mirrorEx) {
        warnings.push(`Sheet mirror threw for ${r.ledger_row_id}: ${mirrorEx instanceof Error ? mirrorEx.message : String(mirrorEx)}`);
      }
    }
  }

  return json({
    success:                true,
    invoiceNo,
    rowsReissued:           reissued.length,
    alreadyUnbilledSkipped: alreadyUnbilled,
    ledgerRowIds:           reissued.map(r => r.ledger_row_id),
    mirroredCount,
    message: `${reissued.length} row(s) released to Unbilled. Run Create Invoices to re-bill.`,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
