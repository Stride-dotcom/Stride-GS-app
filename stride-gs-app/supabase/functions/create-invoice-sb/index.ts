/**
 * create-invoice-sb — SB-primary handler for `createInvoice`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md
 *   MIG-005  Phase 4a billing-core — SB writes public.billing directly,
 *            with reverse-writethrough to per-tenant Billing_Ledger sheet.
 *            CB Consolidated_Ledger writeback stays GAS-owned until 4b.
 *   MIG-016  Sheet-drift gap accepted on canary: best-effort per-row
 *            reverse-writethrough; full-sync cron catches residual drift.
 *
 * Replaces GAS handler `handleCreateInvoice_` (StrideAPI.gs:25857).
 *
 * Architectural call:
 *   • The PDF is intentionally NOT generated here. The React caller renders
 *     it via jsPDF after a successful response. The GAS path's heavy
 *     Doc→PDF copy+export step (~2-5s/invoice) is one of the largest wins
 *     of the migration — pulling it out of the EF lets multiple invoices
 *     batch at concurrency>1 without bottlenecking on the Master Doc API.
 *   • Invoice numbering uses the atomic Postgres SEQUENCE
 *     `public.next_invoice_no()` (migration 20260504220000) which
 *     eliminates the Master-RPC read-then-write race that produced the
 *     INV-000131 duplicate on 2026-05-03.
 *   • CB Consolidated_Ledger write-back is NOT done here. That layer is
 *     scoped for Phase 4b (CB sheet retirement); MIG-005 explicitly says
 *     the CB writeback continues from the GAS side via the existing
 *     full-sync flow. We only update public.billing + reverse-write to
 *     the per-tenant Billing_Ledger.
 *
 * Core flow:
 *   1. Validate inputs (tenantId, client, ledgerRowIds non-empty).
 *   2. Read candidate billing rows (status='Unbilled', matching client,
 *      optional sidemark, ledger_row_id IN (...)). Reject if none.
 *   3. Call public.next_invoice_no() RPC for atomic invoice #.
 *   4. UPDATE public.billing SET invoice_no, status='Invoiced',
 *      invoiced_at WHERE ledger_row_id IN (...) AND status='Unbilled'.
 *   5. Audit log: entity_type='billing', action='create_invoice'.
 *   6. Reverse-writethrough each updated row to per-tenant Billing_Ledger
 *      (table='billing', op='update', rowId=ledger_row_id). Best-effort.
 *   7. Return { success, invoiceNo, rowsInvoiced, total, rows }.
 *
 * Inputs (matches GAS handleCreateInvoice_ caller shape):
 *   { tenantId, callerEmail, requestId?, client, sidemark?,
 *     ledgerRowIds: string[] }
 *
 * Response:
 *   { success: true, invoiceNo, rowsInvoiced, total, rows: [...],
 *     warnings?: string[] }
 *   { error, code }   on failure
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateInvoiceBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  client?: string;
  sidemark?: string;
  ledgerRowIds?: string[];
  /**
   * 2026-05-23 — full row payload from the React caller, in display sort
   * order (service date asc, svc code asc, item id asc). When provided we
   * derive ledgerRowIds from it AND return updated rows in this same order
   * so downstream consumers (PDF render, QBO push) see the report's order
   * instead of the arbitrary Postgres scan order. Matches the GAS
   * handleCreateInvoice_ payload shape so React can send one body that
   * works for either backend.
   */
  rows?: Array<{
    ledgerRowId?: string;
    client?: string;
    sidemark?: string;
    date?: string;
    svcCode?: string;
    svcName?: string;
    itemId?: string;
    description?: string;
    itemClass?: string;
    qty?: number;
    rate?: number;
    total?: number;
    notes?: string;
    taskId?: string;
    repairId?: string;
    shipmentNo?: string;
    category?: string;
    sourceSheetId?: string;
  }>;
}

interface BillingRow {
  ledger_row_id: string;
  status: string;
  invoice_no: string | null;
  client_name: string | null;
  date: string | null;
  svc_code: string | null;
  svc_name: string | null;
  category: string | null;
  item_id: string | null;
  description: string | null;
  item_class: string | null;
  qty: number | null;
  rate: number | null;
  total: number | null;
  task_id: string | null;
  repair_id: string | null;
  shipment_number: string | null;
  item_notes: string | null;
  sidemark: string | null;
  reference: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: CreateInvoiceBody;
  try { body = await req.json(); }
  catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const client      = String(body.client      ?? '').trim();
  const sidemark    = String(body.sidemark    ?? '').trim();

  // 2026-05-23 — accept either `rows` (preferred, carries display sort
  // order) OR `ledgerRowIds`. When both present, rows wins and we derive
  // ledgerRowIds from it. The ordered-id list is what we use to sort the
  // SELECT/UPDATE results so the returned `rows` carry the same order the
  // caller sent — needed end-to-end for the PDF + QBO line ordering.
  const payloadRows = Array.isArray(body.rows) ? body.rows : [];
  const ledgerRowIds: string[] = payloadRows.length > 0
    ? payloadRows.map(r => String(r?.ledgerRowId ?? '').trim()).filter(Boolean)
    : (body.ledgerRowIds ?? []).map(s => String(s).trim()).filter(Boolean);
  // Lookup: ledger_row_id → 0-based caller order. Used to sort the final
  // updated array so order survives the SELECT/UPDATE round-trip.
  const orderByLedgerId: Record<string, number> = {};
  ledgerRowIds.forEach((id, i) => { orderByLedgerId[id] = i; });

  if (!tenantId) return json({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!client)   return json({ error: 'client is required',   code: 'INVALID_PARAMS' }, 400);
  if (ledgerRowIds.length === 0) {
    return json({ error: 'rows[] or ledgerRowIds[] is required and must be non-empty', code: 'INVALID_PARAMS' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[create-invoice-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);
  const warnings: string[] = [];

  // ── 1. Read candidate Unbilled rows ─────────────────────────────────
  // Filter on tenant + client_name + (optional) sidemark + Unbilled
  // status. This mirrors the GAS handler's row-set filter: the caller
  // (Billing.tsx) groups rows by (client, sidemark) BEFORE invoking the
  // action, so the ledgerRowIds list should already match a single
  // (tenant, client[, sidemark]) tuple. We re-assert here as a guard.
  let q = sb
    .from('billing')
    .select('ledger_row_id, status, invoice_no, client_name, date, svc_code, svc_name, category, item_id, description, item_class, qty, rate, total, task_id, repair_id, shipment_number, item_notes, sidemark, reference')
    .eq('tenant_id', tenantId)
    .in('ledger_row_id', ledgerRowIds);

  const { data: candidatesRaw, error: readErr } = await q;
  if (readErr) {
    console.error('[create-invoice-sb] billing read failed:', readErr.message);
    return json({ error: `Read failed: ${readErr.message}`, code: 'READ_FAILED' }, 500);
  }
  const candidates = (candidatesRaw ?? []) as BillingRow[];
  if (candidates.length === 0) {
    return json({ error: 'No billing rows found for the given ledgerRowIds on this tenant', code: 'NOT_FOUND' }, 404);
  }

  // Defensive: skip rows that are already Invoiced/Void — those would
  // produce a half-write (some rows flipped, some not). Surface them
  // in `warnings` rather than failing the whole batch.
  const eligible: BillingRow[] = [];
  for (const row of candidates) {
    if (row.status === 'Unbilled') {
      eligible.push(row);
    } else {
      warnings.push(`Skipped ledger_row_id=${row.ledger_row_id} (status=${row.status}, not Unbilled)`);
    }
  }
  if (eligible.length === 0) {
    return json({ error: 'No Unbilled rows in the provided ledgerRowIds set', code: 'NO_UNBILLED_ROWS', warnings }, 400);
  }

  // Client + sidemark consistency check. Single-client/sidemark per
  // invoice is invariant on the React side; reject if the row set is
  // mixed so a hand-crafted payload can't bypass it.
  const distinctClients = new Set(eligible.map(r => String(r.client_name ?? '').trim()).filter(Boolean));
  if (distinctClients.size > 1) {
    return json({
      error: `Mixed client_name in row set: ${JSON.stringify([...distinctClients])}. All rows must share the same client.`,
      code: 'MIXED_CLIENTS',
    }, 400);
  }
  if (sidemark) {
    const distinctSidemarks = new Set(eligible.map(r => String(r.sidemark ?? '').trim()));
    if (distinctSidemarks.size > 1) {
      // Caller asked for a single-sidemark invoice but rows disagree.
      warnings.push(
        `Mixed sidemarks in row set (${JSON.stringify([...distinctSidemarks])}) but caller specified single sidemark=${JSON.stringify(sidemark)}. Proceeding — caller is responsible for grouping.`,
      );
    }
  }

  // ── 2. Allocate invoice number via atomic Postgres SEQUENCE ─────────
  // public.next_invoice_no() returns 'INV-XXXXXX'. Race-free per
  // migration 20260504220000 (replaces the Master-RPC counter that had
  // the read-then-write race producing INV-000131 dup on 2026-05-03).
  const { data: invNoData, error: invErr } = await sb.rpc('next_invoice_no');
  if (invErr || !invNoData) {
    console.error('[create-invoice-sb] next_invoice_no failed:', invErr?.message);
    return json({ error: `Invoice number allocation failed: ${invErr?.message ?? 'no data returned'}`, code: 'RPC_ERROR' }, 500);
  }
  const invoiceNo = String(invNoData).trim();
  if (!invoiceNo) {
    return json({ error: 'next_invoice_no returned empty', code: 'RPC_ERROR' }, 500);
  }

  // ── 3. UPDATE billing SET invoice_no, status='Invoiced', invoiced_at
  // Filter on status='Unbilled' so concurrent commits can't double-flip.
  const nowIso = new Date().toISOString();
  const eligibleIds = eligible.map(r => r.ledger_row_id);
  const { data: updatedRaw, error: upErr } = await sb
    .from('billing')
    .update({
      invoice_no:  invoiceNo,
      status:      'Invoiced',
      invoiced_at: nowIso,
      updated_at:  nowIso,
    })
    .eq('tenant_id', tenantId)
    .in('ledger_row_id', eligibleIds)
    .eq('status', 'Unbilled')
    .select('ledger_row_id, status, invoice_no, client_name, date, svc_code, svc_name, category, item_id, description, item_class, qty, rate, total, task_id, repair_id, shipment_number, item_notes, sidemark, reference');

  if (upErr) {
    console.error('[create-invoice-sb] billing update failed:', upErr.message);
    return json({ error: `Update failed: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);
  }
  const updatedUnsorted = (updatedRaw ?? []) as BillingRow[];
  if (updatedUnsorted.length === 0) {
    // The Unbilled rows were sniped between read + update. Surface that.
    return json({ error: 'No rows updated (concurrent invoice may have grabbed them)', code: 'NO_ROWS_UPDATED' }, 409);
  }

  // 2026-05-23 — preserve caller's display sort order on the response.
  // Postgres returns the UPDATE's RETURNING in arbitrary scan order, so a
  // 50-row invoice would round-trip rows in a scrambled order vs. what
  // the caller sent. Sort by the orderByLedgerId map built from the
  // caller's `rows` (or `ledgerRowIds`) so the React PDF render +
  // downstream QBO push see (date, svc, item) ascending. Unknown ids
  // fall to the end (shouldn't happen — they were just used to filter).
  const updated = [...updatedUnsorted].sort((a, b) => {
    const ai = orderByLedgerId[a.ledger_row_id];
    const bi = orderByLedgerId[b.ledger_row_id];
    const an = ai === undefined ? Number.MAX_SAFE_INTEGER : ai;
    const bn = bi === undefined ? Number.MAX_SAFE_INTEGER : bi;
    return an - bn;
  });

  const total = updated.reduce((acc, r) => acc + Number(r.total ?? 0), 0);

  // ── 4. Audit log (best-effort) ─────────────────────────────────────
  await sb.from('entity_audit_log').insert({
    entity_type:   'billing',
    entity_id:     invoiceNo,
    tenant_id:     tenantId,
    action:        'create_invoice',
    changes:       {
      invoiceNo,
      client,
      sidemark: sidemark || null,
      rowsInvoiced: updated.length,
      total,
      ledgerRowIds: updated.map(r => r.ledger_row_id),
    },
    performed_by:  callerEmail || 'create-invoice-sb',
    source:        'supabase',
  }).then(() => {}, (e: unknown) => {
    console.error('[create-invoice-sb] audit-log insert failed:', e);
    warnings.push(`Audit log insert failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  // ── 5. Reverse-writethrough each row to per-tenant Billing_Ledger ──
  // GAS handleWriteThroughReverse_ only supports insert/update/delete
  // ops (no bulk variant), so we fan out per-row. MIG-016 explicitly
  // permits this latency for canary tenant; full-sync cron picks up
  // any residual drift. Failures land in gs_sync_events for the
  // FailedOperationsDrawer.
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  let mirroredCount = 0;
  if (!gasUrl || !gasToken) {
    warnings.push('GAS_API_URL / GAS_API_TOKEN not configured — Billing_Ledger sheet mirror skipped');
  } else {
    for (const row of updated) {
      try {
        const payload = {
          tenantId,
          table:  'billing',
          op:     'update',
          rowId:  row.ledger_row_id,
          row:    {
            ledger_row_id: row.ledger_row_id,
            status:        'Invoiced',
            invoice_no:    invoiceNo,
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
          warnings.push(`Sheet mirror failed for ${row.ledger_row_id}: ${errMsg}`);
          await sb.from('gs_sync_events').insert({
            tenant_id:     tenantId,
            entity_type:   'billing',
            entity_id:     row.ledger_row_id,
            action_type:   'writethrough_reverse',
            sync_status:   'sync_failed',
            requested_by:  callerEmail || 'create-invoice-sb',
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
    success:      true,
    invoiceNo,
    rowsInvoiced: updated.length,
    total,
    mirroredCount,
    rows:         updated,
    warnings:     warnings.length > 0 ? warnings : undefined,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
