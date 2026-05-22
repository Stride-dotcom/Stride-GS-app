/**
 * create-stax-invoices-sb — SB-primary handler for GAS action
 * `createStaxInvoices`. Phase 6 payments.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md — Phase 6 calls
 * external Stax (Fattmerchant) Payments API.
 *
 * Replaces handleCreateStaxInvoices_ at StrideAPI.gs:37580.
 *
 * What the GAS handler does (1–6 high level):
 *   1. Reads Stax spreadsheet Invoices tab, gates rows by status=PENDING
 *      AND empty Stax Invoice ID.
 *   2. Resolves missing Stax Customer IDs from CB Clients map.
 *   3. Computes due date from payment-terms when blank (Net N).
 *   4. Posts each invoice to Stax `POST /invoice`.
 *   5. Logs exceptions (NO_CUSTOMER / INVALID_PAYLOAD / API_ERROR) to
 *      the Stax sheet's Exceptions tab + mirrors to public.stax_exceptions.
 *   6. Mirrors row state to public.stax_invoices.
 *
 * THIS HANDLER SCOPE:
 *   FULL : SB-only path. Reads public.stax_invoices for PENDING rows
 *          matching the requested invoiceNos, resolves Stax Customer ID
 *          from public.clients, POSTs to Stax (if STAX_API_KEY set),
 *          updates the SB row's status + stax_id, writes
 *          public.stax_exceptions on failure, invoice_tracking stamp,
 *          audit log.
 *   STUB : Stax sheet write-back (the GAS sheet's Invoices tab — drift
 *          tolerated; the daily full-sync cron picks it up). Past-due
 *          safety buffer (v38.135.0). Auto-Charge default-from-client
 *          stamp (v38.14.0 — runs against the SB row's auto_charge col
 *          which already mirrors the client flag, so this is a no-op
 *          on the SB side).
 *
 * Inputs:
 *   {
 *     tenantId?:    string                // optional (used only for audit log)
 *     invoiceNos?:  string[]              // optional — selective push.
 *                                         // If omitted, all PENDING rows
 *                                         // without a stax_id are pushed.
 *     callerEmail?: string
 *     requestId?:   string
 *   }
 *
 * Required EF secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Optional (env-guarded — when missing we do an SB-only push, logging a
 * warning. Lets the operator dry-run before wiring real Stax credentials):
 *   STAX_API_KEY        — Bearer token for Stax API.
 *   STAX_INVOICE_PAY_URL — Default https://app.staxpayments.com/#/bill/
 *
 * Response:
 *   { success: true, created: N, skipped: M, errors: [...],
 *     staxInvoiceIds: string[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STAX_API_BASE   = 'https://apiprod.fattlabs.com';
const DEFAULT_PAY_URL = 'https://app.staxpayments.com/#/bill/';

interface Body {
  tenantId?:    string;
  invoiceNos?:  string[];
  callerEmail?: string;
  requestId?:   string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const staxApiKey = Deno.env.get('STAX_API_KEY') ?? '';
  const payUrlBase = Deno.env.get('STAX_INVOICE_PAY_URL') ?? DEFAULT_PAY_URL;
  const staxConfigured = !!staxApiKey;
  if (!staxConfigured) {
    console.warn('[create-stax-invoices-sb] STAX_API_KEY not set — SB-only push (no Stax API call). Stax-side rows will not be created.');
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const selectiveNos = Array.isArray(body.invoiceNos) && body.invoiceNos.length > 0
    ? body.invoiceNos.map((s) => String(s).trim()).filter(Boolean)
    : null;

  // Admin-only gate. `public.stax_invoices` is FLEET-WIDE by design
  // (no tenant_id column — mirrors the global Stax Auto Pay spreadsheet).
  // GAS path enforces via `withStaffGuard_`; mirror that here. Without
  // it any authenticated user with the anon key could push every tenant's
  // PENDING invoices to Stax. Real money — fail closed.
  const authHeader = req.headers.get('Authorization') || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) {
    return jsonResponse({ error: 'Authorization header required', code: 'UNAUTHENTICATED' }, 401);
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: authErr } = await authClient.auth.getUser(callerToken);
  if (authErr || !userData?.user) {
    return jsonResponse({ error: 'Invalid token', code: 'UNAUTHENTICATED' }, 401);
  }
  const callerRole = String((userData.user.user_metadata as { role?: string })?.role ?? '').toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'staff') {
    return jsonResponse({ error: 'admin/staff role required', code: 'FORBIDDEN' }, 403);
  }

  // ── Load candidate stax_invoices rows ────────────────────────────────
  // Gate: status='PENDING' AND stax_id IS NULL/empty.
  // NOTE: stax_invoices has no tenant_id by design — fleet-wide admin tool.
  let query = sb
    .from('stax_invoices')
    .select('id, qb_invoice_no, customer, stax_customer_id, invoice_date, due_date, amount, line_items_json, status, stax_id')
    .eq('status', 'PENDING');
  if (selectiveNos) {
    query = query.in('qb_invoice_no', selectiveNos);
  }
  const { data: rows, error: selErr } = await query;
  if (selErr) {
    return jsonResponse({ error: `stax_invoices read failed: ${selErr.message}`, code: 'READ_FAILED' }, 500);
  }

  const candidates = (rows ?? []).filter((r: { stax_id?: string | null }) => !String(r.stax_id ?? '').trim());
  if (candidates.length === 0) {
    return jsonResponse({
      success: true,
      created: 0,
      skipped: 0,
      errors:  [],
      staxInvoiceIds: [],
      summary: 'No PENDING rows without stax_id matched',
    }, 200);
  }

  // ── Pre-load client → stax_customer_id mapping from public.clients ──
  // Fills the gap when stax_invoices.stax_customer_id is blank (the GAS
  // path runs stax_lookupCustomerIds_ against CB Clients; we mirror it
  // against public.clients which already carries stax_customer_id per
  // the 2026-04-15 clients_mirror migration).
  const customerNames = Array.from(new Set(candidates.map((r: { customer?: string }) => String(r.customer ?? '').trim()).filter(Boolean)));
  const clientMap: Record<string, string> = {};   // upper(name) → stax_customer_id
  if (customerNames.length > 0) {
    // Fleet-wide clients lookup: stax_invoices.customer can reference
    // any tenant's client name (each public.clients row IS a tenant).
    const { data: clientRows, error: clientsErr } = await sb
      .from('clients')
      .select('name, stax_customer_id')
      .in('name', customerNames);
    if (clientsErr) {
      console.warn('[create-stax-invoices-sb] clients lookup failed (non-fatal):', clientsErr.message);
    } else {
      for (const c of (clientRows ?? []) as Array<{ name?: string; stax_customer_id?: string | null }>) {
        const key = String(c.name ?? '').trim().toUpperCase();
        const sid = String(c.stax_customer_id ?? '').trim();
        if (key && sid) clientMap[key] = sid;
      }
    }
  }

  const errors:         Array<{ invoiceNo: string; reason: string; detail?: string }> = [];
  const staxInvoiceIds: string[] = [];
  let createdCount = 0;
  let skippedCount = 0;

  for (const row of candidates as Array<Record<string, unknown>>) {
    const docNum   = String(row.qb_invoice_no ?? '').trim();
    const custName = String(row.customer      ?? '').trim();
    let   staxCust = String(row.stax_customer_id ?? '').trim();
    const invDate  = String(row.invoice_date ?? '').trim();
    const dueDate  = String(row.due_date     ?? '').trim();
    const amount   = Number(row.amount       ?? 0);
    const lineItemsJson = String(row.line_items_json ?? '');

    // Fall back to clients map if stax_invoices row has no Stax Customer ID
    if (!staxCust && custName) {
      staxCust = clientMap[custName.toUpperCase()] || '';
    }

    if (!staxCust) {
      await logException(sb, docNum, custName, '', amount, dueDate, 'NO_CUSTOMER',
        'No Stax Customer ID — set one on the client record and re-run.');
      errors.push({ invoiceNo: docNum, reason: 'NO_CUSTOMER' });
      skippedCount++;
      continue;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      await logException(sb, docNum, custName, staxCust, amount, dueDate, 'INVALID_PAYLOAD', 'amount ≤ 0');
      errors.push({ invoiceNo: docNum, reason: 'INVALID_PAYLOAD', detail: `amount=${amount}` });
      skippedCount++;
      continue;
    }

    // Build line items + Stax payload
    const lineItems = parseLineItems(lineItemsJson, amount, docNum);
    let subtotal = 0;
    for (const li of lineItems) subtotal += (li.quantity * li.price);
    const tax = Math.max(0, amount - subtotal);

    const refKey = docNum;                                  // v38.149.0 — bare invoice no
    const memo   = `QB #${docNum} - ${custName}`;

    const staxPayload: Record<string, unknown> = {
      customer_id: staxCust,
      total:       amount,
      url:         payUrlBase,
      meta: {
        subtotal,
        tax,
        memo,
        reference:     refKey,
        invoiceNumber: docNum,
        lineItems,
      },
    };
    if (dueDate) staxPayload.due_at = `${dueDate} 00:00:00`;

    if (!staxConfigured) {
      // SB-only mode: mark the row as a dry-run; do NOT mutate the
      // status. Operators flip the flag once STAX_API_KEY is configured.
      errors.push({ invoiceNo: docNum, reason: 'STAX_NOT_CONFIGURED' });
      skippedCount++;
      continue;
    }

    // ── POST to Stax ─────────────────────────────────────────────────
    let staxId = '';
    try {
      const res = await fetch(`${STAX_API_BASE}/invoice`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${staxApiKey}`,
          'Content-Type':  'application/json',
          'Accept':        'application/json',
        },
        body: JSON.stringify(staxPayload),
      });
      const text = await res.text();
      let parsed: { id?: string; message?: string };
      try { parsed = JSON.parse(text); } catch { parsed = {}; }
      if (res.ok && parsed.id) {
        staxId = String(parsed.id);
      } else {
        const errMsg = (parsed.message || text.slice(0, 300)) ?? `HTTP ${res.status}`;
        await logException(sb, docNum, custName, staxCust, amount, dueDate,
          `API_ERROR: ${String(errMsg).slice(0, 150)}`, '');
        errors.push({ invoiceNo: docNum, reason: 'API_ERROR', detail: String(errMsg) });
        skippedCount++;
        continue;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logException(sb, docNum, custName, staxCust, amount, dueDate, `API_ERROR: ${msg.slice(0, 150)}`, '');
      errors.push({ invoiceNo: docNum, reason: 'FETCH_FAILED', detail: msg });
      skippedCount++;
      continue;
    }

    // ── Update public.stax_invoices row ──────────────────────────────
    const { error: updErr } = await sb
      .from('stax_invoices')
      .update({
        stax_id:           staxId,
        status:            'CREATED',
        notes:             `Created via create-stax-invoices-sb at ${new Date().toISOString()}`,
        updated_at:        new Date().toISOString(),
        payment_method_status: null,
      })
      .eq('id', row.id as string);
    if (updErr) {
      console.error('[create-stax-invoices-sb] stax_invoices update failed for', docNum, ':', updErr.message);
      errors.push({ invoiceNo: docNum, reason: 'SB_UPDATE_FAILED', detail: updErr.message });
      continue;
    }

    staxInvoiceIds.push(staxId);
    createdCount++;

    // Stamp invoice_tracking.stax_pushed_at (best-effort).
    try {
      await sb.from('invoice_tracking')
        .update({ stax_pushed_at: new Date().toISOString() })
        .eq('invoice_no', docNum);
    } catch (e) {
      console.error('[create-stax-invoices-sb] invoice_tracking stamp threw:', e);
    }

    // Audit log.
    await writeAudit(sb, tenantId, docNum, callerEmail, 'stax_create',
      { staxId, amount, customer: custName });
  }

  // run-log mirror (best-effort).
  try {
    const summary = `${createdCount} created, ${skippedCount} skipped`;
    await sb.from('stax_run_log').insert({
      timestamp: new Date().toISOString(),
      fn:        'create-stax-invoices-sb',
      summary,
      details:   JSON.stringify({ createdCount, skippedCount, errorCount: errors.length, staxConfigured }),
    });
  } catch (e) {
    console.error('[create-stax-invoices-sb] run-log insert threw:', e);
  }

  return jsonResponse({
    success:        true,
    created:        createdCount,
    skipped:        skippedCount,
    errors,
    staxInvoiceIds,
    staxConfigured,
    requestId,
  }, 200);
});

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * line_items_json on stax_invoices is a serialized version of the array
 * the GAS path builds via stax_buildLineItems_. Schema per row:
 *   { code?, description?, quantity, price }
 * If parsing fails or the array is empty, fall back to a single line
 * with the full invoice total (matches the GAS fallback at
 * stax_buildLineItems_).
 */
function parseLineItems(json: string, totalFallback: number, docNum: string): Array<{ code?: string; description: string; quantity: number; price: number }> {
  try {
    const arr = JSON.parse(json || '[]');
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map((li: { code?: string; description?: string; quantity?: number | string; price?: number | string }) => ({
        code:        String(li.code ?? '').trim() || undefined,
        description: String(li.description ?? '').trim() || `Invoice ${docNum}`,
        quantity:    Number(li.quantity ?? 1) || 1,
        price:       Number(li.price ?? 0)    || 0,
      }));
    }
  } catch { /* fall through */ }
  return [{
    description: `Invoice ${docNum}`,
    quantity:    1,
    price:       totalFallback,
  }];
}

async function logException(
  sb: ReturnType<typeof createClient>,
  qbInvoiceNo: string,
  customer:    string,
  staxCustId:  string,
  amount:      number,
  dueDate:     string,
  reason:      string,
  detail:      string,
): Promise<void> {
  try {
    await sb.from('stax_exceptions').insert({
      timestamp:        new Date().toISOString(),
      qb_invoice_no:    qbInvoiceNo,
      customer,
      stax_customer_id: staxCustId,
      amount,
      due_date:         dueDate,
      reason:           reason + (detail ? ` — ${detail}` : ''),
      pay_link:         '',
      resolved:         false,
    });
  } catch (e) {
    console.error('[create-stax-invoices-sb] exception insert failed:', e);
  }
}

async function writeAudit(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  invoiceNo: string,
  callerEmail: string,
  action: string,
  changes: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from('entity_audit_log').insert({
      entity_type:  'stax_invoice',
      entity_id:    invoiceNo,
      tenant_id:    tenantId,
      action,
      changes,
      performed_by: callerEmail || 'create-stax-invoices-sb',
      source:       'supabase',
    });
  } catch (e) {
    console.error('[create-stax-invoices-sb] audit insert failed:', e);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
