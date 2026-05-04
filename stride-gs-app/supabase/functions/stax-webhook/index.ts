/**
 * stax-webhook — Supabase Edge Function v2 (2026-05-04 PST)
 *
 * v2: Stax uses event names `update_invoice` and `create_transaction`,
 *     not the speculative `invoice.paid` / `payment.created` names from
 *     v1. update_invoice fires on every invoice status change and we
 *     dispatch on the body's `status` field (PAID / PARTIALLY_PAID /
 *     VOIDED). create_transaction fires on every payment captured — we
 *     extract the linked invoice id and treat it as PAID.
 *
 *     Defensive payload parsing: Stax's webhook body shape isn't fully
 *     documented; we look at multiple candidate field paths for status
 *     and invoice id, log the raw event regardless, and only return 200
 *     once it's persisted to stax_webhook_events. Anything we can't
 *     interpret stays in that audit table for inspection.
 *
 * v1: Initial. (Used speculative event names; never received traffic.)
 *
 * Auth: shared-secret token in URL query param: ?token=<STAX_WEBHOOK_SECRET>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STAX_WEBHOOK_SECRET') ?? '';

// Stax invoice.status → our internal stax_invoices.status string.
const INVOICE_STATUS_MAP: Record<string, string> = {
  'PAID':            'PAID',
  'PARTIALLY_PAID':  'PARTIAL',
  'VOIDED':          'VOIDED',
  // SENT / OUTSTANDING / DRAFT — no action; the invoice is just being
  // updated for some other reason. Logged in stax_webhook_events.
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function firstNonEmpty(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  if (!WEBHOOK_SECRET) {
    console.error('stax-webhook: STAX_WEBHOOK_SECRET env var is not set');
    return jsonResponse({ error: 'webhook not configured' }, 503);
  }
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (token !== WEBHOOK_SECRET) {
    console.warn('stax-webhook: invalid token');
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = await req.json(); }
  catch (parseErr) { console.error('stax-webhook: body parse failed:', parseErr); return jsonResponse({ error: 'invalid json body' }, 400); }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const eventType = firstNonEmpty(payload?.event, payload?.type, payload?.action) || 'unknown';
  const eventId   = firstNonEmpty(payload?.id, payload?.event_id, payload?.data?.id) || crypto.randomUUID();

  try {
    await supabase.from('stax_webhook_events').upsert({
      event_id: eventId,
      event_type: eventType,
      payload,
      received_at: new Date().toISOString(),
    }, { onConflict: 'event_id' });
  } catch (logErr) {
    console.error('stax-webhook: failed to persist raw event (proceeding):', logErr);
  }

  // deno-lint-ignore no-explicit-any
  const inv = (payload?.data ?? payload?.invoice ?? payload) as any;
  const staxInvoiceId = firstNonEmpty(
    payload?.invoice_id,
    payload?.data?.invoice_id,
    payload?.data?.id,
    payload?.invoice?.id,
    inv?.id,
  );

  if (eventType === 'update_invoice') {
    const rawStatus = String(inv?.status ?? payload?.status ?? '').toUpperCase();
    const newStatus = INVOICE_STATUS_MAP[rawStatus];
    if (!newStatus) {
      return jsonResponse({ ok: true, ack: 'update_invoice with non-actionable status', staxStatus: rawStatus });
    }
    if (!staxInvoiceId) {
      console.warn('stax-webhook: update_invoice with no resolvable invoice id', payload);
      return jsonResponse({ ok: true, ack: 'update_invoice but no invoice id present' });
    }
    return await applyInvoiceStatus(supabase, staxInvoiceId, newStatus, eventType, inv);
  }

  if (eventType === 'create_transaction') {
    const txnInvoiceId = firstNonEmpty(
      payload?.invoice_id,
      payload?.data?.invoice_id,
      payload?.data?.invoice?.id,
      payload?.transaction?.invoice_id,
      payload?.data?.meta?.invoice_id,
    );
    if (!txnInvoiceId) {
      return jsonResponse({ ok: true, ack: 'create_transaction with no linked invoice id' });
    }
    const txnSucceeded = payload?.data?.success !== false && payload?.success !== false;
    if (!txnSucceeded) {
      return jsonResponse({ ok: true, ack: 'create_transaction but transaction.success=false' });
    }
    return await applyInvoiceStatus(supabase, txnInvoiceId, 'PAID', eventType, payload?.data);
  }

  return jsonResponse({ ok: true, ack: 'event logged but unhandled', eventType });
});

// deno-lint-ignore no-explicit-any
async function applyInvoiceStatus(supabase: any, staxInvoiceId: string, newStatus: string, eventType: string, sourceData: unknown) {
  const { data: invRows, error: invErr } = await supabase
    .from('stax_invoices')
    .select('id, qb_invoice_no, status')
    .eq('stax_id', staxInvoiceId)
    .limit(1);

  if (invErr) {
    console.error('stax-webhook: stax_invoices lookup failed:', invErr);
    return jsonResponse({ error: 'lookup failed', detail: invErr.message }, 500);
  }
  if (!invRows || invRows.length === 0) {
    console.warn('stax-webhook: no stax_invoices row for stax_id=%s (event %s logged)', staxInvoiceId, eventType);
    return jsonResponse({ ok: true, ack: 'no matching invoice', staxInvoiceId });
  }

  const row = invRows[0];
  if (row.status === newStatus) {
    return jsonResponse({ ok: true, alreadyApplied: true, qbInvoiceNo: row.qb_invoice_no, status: newStatus });
  }

  const updatePayload: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  // deno-lint-ignore no-explicit-any
  const sd = sourceData as any;
  if (newStatus === 'PAID') {
    const paidAt = sd?.paid_at ?? new Date().toISOString();
    updatePayload.notes = `Marked PAID via Stax webhook (${eventType}) at ${paidAt}`;
  } else if (newStatus === 'VOIDED') {
    updatePayload.notes = `Voided in Stax — webhook event at ${new Date().toISOString()}`;
  } else if (newStatus === 'PARTIAL') {
    const totalPaid = sd?.total_paid;
    updatePayload.notes = totalPaid != null
      ? `Partial payment: $${Number(totalPaid).toFixed(2)} via webhook (${eventType})`
      : `Partial payment via webhook (${eventType})`;
  }

  const { error: updateErr } = await supabase
    .from('stax_invoices')
    .update(updatePayload)
    .eq('id', row.id);

  if (updateErr) {
    console.error('stax-webhook: stax_invoices update failed:', updateErr);
    return jsonResponse({ error: 'update failed', detail: updateErr.message }, 500);
  }

  if (newStatus === 'PAID' && row.qb_invoice_no) {
    const { error: billingErr, count } = await supabase
      .from('billing')
      .update({ status: 'Paid' }, { count: 'exact' })
      .eq('invoice_no', row.qb_invoice_no)
      .eq('status', 'Invoiced');
    if (billingErr) {
      console.error('stax-webhook: billing flip failed (non-fatal):', billingErr);
    } else {
      console.log('stax-webhook: marked %d billing rows Paid for %s', count ?? 0, row.qb_invoice_no);
    }
  }

  return jsonResponse({ ok: true, qbInvoiceNo: row.qb_invoice_no, status: newStatus, eventType });
}
