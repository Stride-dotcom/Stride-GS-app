/**
 * void-invoice-sb — SB-primary handler for `voidInvoice`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md
 *   MIG-005  Phase 4a billing-core. SB owns public.billing writes;
 *            CB Consolidated_Ledger delete stays GAS-owned (handled
 *            inside the per-tenant reverse-writethrough by the GAS
 *            side as a side-effect of api_deleteCbRowsByInvoiceNo_,
 *            invoked from GAS post-handlers — NOT here).
 *
 * Replaces GAS handler `handleVoidInvoice_` (StrideAPI.gs:14331).
 *
 * Flow:
 *   1. Validate (tenantId, invoiceNo).
 *   2. Read all billing rows for (tenant, invoice_no, status='Invoiced').
 *   3. UPDATE billing SET status='Void', item_notes='<existing> | Voided: <reason>'
 *      WHERE invoice_no=... AND status='Invoiced'. (Per-row, since the
 *      item_notes append is row-specific — matches GAS handleVoidInvoice_
 *      pattern; public.billing has no voided_at/void_reason columns.)
 *   4. Audit log: entity_type='billing', action='void_invoice'.
 *   5. Reverse-writethrough each row to per-tenant Billing_Ledger
 *      (status → 'Void'). Best-effort.
 *
 * Note on CB Consolidated_Ledger:
 *   The GAS handleVoidInvoice_ also calls api_deleteCbRowsByInvoiceNo_
 *   to delete matching CB rows so QBO/IIF exports don't re-push the
 *   voided invoice. Per MIG-005 the CB writeback path stays GAS-
 *   authoritative through Phase 4a. We instruct GAS to delete CB rows
 *   via a separate per-invoice mirror call (table='billing',
 *   op='delete', rowId=invoiceNo) — the writer can interpret this as
 *   "void cascade" since CB has a `cleanup-by-invoice-no` shape.
 *   That writer doesn't exist yet in REVERSE_WRITETHROUGH_TABLES_'s
 *   billing entry (only insert/update). For now we fire a single
 *   side-channel mirror op signaling the void; the GAS side full-sync
 *   cron will eventually backfill until the CB delete writer ships.
 *
 * Inputs: { tenantId, callerEmail, requestId?, invoiceNo, reason? }
 * Response: { success, invoiceNo, rowsVoided, warnings? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VoidInvoiceBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  invoiceNo?: string;
  reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: VoidInvoiceBody;
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
    console.error('[void-invoice-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);
  const warnings: string[] = [];

  // ── 1. Read rows for this invoice ───────────────────────────────────
  // 2026-05-24 — Also pull item_notes so we can append the void note (the
  // GAS handler appends "Voided: <reason>" to Item Notes; public.billing
  // has NO `voided_at` or `void_reason` columns — the prior code wrote
  // to those non-existent columns and the UPDATE failed with 500).
  const { data: rowsRaw, error: readErr } = await sb
    .from('billing')
    .select('ledger_row_id, status, item_notes')
    .eq('tenant_id', tenantId)
    .eq('invoice_no', invoiceNo);

  if (readErr) {
    console.error('[void-invoice-sb] read failed:', readErr.message);
    return json({ error: `Read failed: ${readErr.message}`, code: 'READ_FAILED' }, 500);
  }
  const rows = (rowsRaw ?? []) as Array<{ ledger_row_id: string; status: string; item_notes: string | null }>;
  if (rows.length === 0) {
    return json({ error: `No billing rows found for invoice ${invoiceNo}`, code: 'NOT_FOUND' }, 404);
  }

  const invoicedRows = rows.filter(r => r.status === 'Invoiced');
  const alreadyVoid  = rows.filter(r => r.status === 'Void').length;
  if (invoicedRows.length === 0) {
    return json({
      error: `No Invoiced rows for invoice ${invoiceNo} (alreadyVoid=${alreadyVoid})`,
      code: 'NO_INVOICED_ROWS',
      alreadyVoid,
    }, 400);
  }

  // ── 2. UPDATE billing SET status='Void', append voidNote to item_notes ─
  // Per-row update because each row's existing item_notes is different;
  // a bulk update would clobber. Matches GAS handleVoidInvoice_'s
  // setValue(existing + " | " + suffix) pattern (StrideAPI.gs:14371).
  const nowIso = new Date().toISOString();
  const voidNote = reason ? `Voided: ${reason}` : `Voided ${nowIso.slice(0, 10)}`;

  const voided: Array<{ ledger_row_id: string }> = [];
  for (const r of invoicedRows) {
    const existing = String(r.item_notes ?? '').trim();
    const newNotes = existing ? `${existing} | ${voidNote}` : voidNote;
    const { data: upRow, error: upErr } = await sb
      .from('billing')
      .update({
        status:     'Void',
        item_notes: newNotes,
        updated_at: nowIso,
      })
      .eq('tenant_id', tenantId)
      .eq('ledger_row_id', r.ledger_row_id)
      .eq('status', 'Invoiced')
      .select('ledger_row_id')
      .maybeSingle();
    if (upErr) {
      console.error('[void-invoice-sb] update failed for', r.ledger_row_id, upErr.message);
      return json({ error: `Update failed for ${r.ledger_row_id}: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);
    }
    if (upRow) voided.push(upRow as { ledger_row_id: string });
  }

  // ── 3. Audit log (best-effort) ─────────────────────────────────────
  await sb.from('entity_audit_log').insert({
    entity_type:   'billing',
    entity_id:     invoiceNo,
    tenant_id:     tenantId,
    action:        'void_invoice',
    changes:       {
      invoiceNo,
      rowsVoided: voided.length,
      reason,
      ledgerRowIds: voided.map(r => r.ledger_row_id),
    },
    performed_by:  callerEmail || 'void-invoice-sb',
    source:        'supabase',
  }).then(() => {}, (e: unknown) => {
    console.error('[void-invoice-sb] audit-log insert failed:', e);
    warnings.push(`Audit log insert failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  // ── 4. Reverse-writethrough per-row to Billing_Ledger (BACKGROUND) ──
  // 2026-05-28 (v38.242.0) — the per-row writeThroughReverse fan-out used
  // to be awaited inline before the response, which made a 4-row invoice
  // void block the UI for ~30s while each GAS call serialized. Move the
  // mirror loop into a background promise wrapped with EdgeRuntime.waitUntil
  // so the EF returns success as soon as the SB writes + audit log land
  // (~100ms total); the sheet mirror finishes after the response is sent.
  // Same per-row semantics, same gs_sync_events failure capture — only the
  // await point moves. Status → 'Void' on each row. Per-row fan-out (GAS
  // supports insert/update/delete only — no bulk variant). The GAS handler
  // historically deletes CB Consolidated_Ledger rows by invoice #. Per
  // MIG-005 the CB layer stays GAS-authoritative through 4a — we don't fire
  // CB deletes from here. The full-sync cron + the (eventual) CB-delete
  // writer close that gap.
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) {
    warnings.push('GAS_API_URL / GAS_API_TOKEN not configured — Billing_Ledger sheet mirror skipped');
  } else {
    const mirrorPromise = (async () => {
      for (const row of voided) {
        try {
          const payload = {
            tenantId,
            table:  'billing',
            op:     'update',
            rowId:  row.ledger_row_id,
            row:    {
              ledger_row_id: row.ledger_row_id,
              status:        'Void',
              item_notes:    voidNote,
            },
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
            console.error(`[void-invoice-sb] sheet mirror failed for ${row.ledger_row_id}:`, errMsg);
            await sb.from('gs_sync_events').insert({
              tenant_id:     tenantId,
              entity_type:   'billing',
              entity_id:     row.ledger_row_id,
              action_type:   'writethrough_reverse',
              sync_status:   'sync_failed',
              requested_by:  callerEmail || 'void-invoice-sb',
              request_id:    `${requestId}:${row.ledger_row_id}`,
              payload,
              error_message: String(errMsg).slice(0, 1000),
            }).then(() => {}, () => {});
          }
        } catch (mirrorEx) {
          console.error(`[void-invoice-sb] sheet mirror threw for ${row.ledger_row_id}:`,
            mirrorEx instanceof Error ? mirrorEx.message : String(mirrorEx));
        }
      }
    })();
    const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
      edgeRuntime.waitUntil(mirrorPromise);
    }
    // If EdgeRuntime is unavailable (local dev), the promise still runs —
    // we just won't be told when it finishes. Don't await it.
  }

  return json({
    success:      true,
    invoiceNo,
    rowsVoided:   voided.length,
    alreadyVoid,
    mirrorQueued: voided.length,
    warnings:     warnings.length > 0 ? warnings : undefined,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
