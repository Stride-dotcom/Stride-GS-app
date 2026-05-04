/**
 * stax-webhook — Supabase Edge Function
 *
 * Version: v1 (2026-05-04 PST)
 *   v1: Initial. Receives Stax webhook events, writes paid/voided/etc.
 *       status back to public.stax_invoices and public.billing so the
 *       Stride app sees client-paid invoices without manual reconciliation.
 *
 * Receives real-time invoice/payment event POSTs from Stax, validates the
 * shared-secret token, persists the raw event to public.stax_webhook_events,
 * looks up the matching stax_invoices row by stax_id, updates status, and
 * mirrors the change to public.billing (rows with matching invoice_no flip
 * from Invoiced → Paid).
 *
 * Auth:   Shared-secret token in URL query param: ?token=<STAX_WEBHOOK_SECRET>
 *         Secret is stored in Edge Function secrets (set via dashboard or
 *         `supabase secrets set STAX_WEBHOOK_SECRET=...`).
 *
 * Stax event types we handle (per Stax docs — adjust as we discover what
 * actually fires from their dashboard):
 *   invoice.paid       — full payment received (the main event we care about)
 *   invoice.partial    — partial payment
 *   invoice.voided     — voided in Stax
 *   payment.created    — fallback if Stax sends payment events instead of
 *                        invoice events; we look up the invoice via
 *                        payload.invoice_id and treat as paid.
 *
 * Anything else is logged to stax_webhook_events but not acted on. The raw
 * event row gives us a re-runnable record if Stax adds a new event later.
 *
 * Idempotent: re-receiving the same Stax event ID is a no-op (already
 * marked paid → no further write). Stax retries on 5xx; we always 200
 * after persisting the raw event so retries don't pile up.
 *
 * Deployment:
 *   supabase functions deploy stax-webhook --project-ref uqplppugeickmamycpuz
 *
 * One-time setup AFTER deploy:
 *   1. supabase secrets set STAX_WEBHOOK_SECRET=<random-string>
 *   2. In Stax dashboard → Webhooks → Add endpoint:
 *        URL: https://uqplppugeickmamycpuz.supabase.co/functions/v1/stax-webhook?token=<STAX_WEBHOOK_SECRET>
 *        Events: invoice.paid, invoice.partial, invoice.voided, payment.created
 *   3. Test by paying a $1 test invoice via the customer portal — watch
 *      stax_webhook_events for the row, then stax_invoices for status=PAID.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STAX_WEBHOOK_SECRET') ?? '';

// Map Stax event type → the status string we write to stax_invoices.status.
// Same vocabulary as the Stride GAS side uses (PAID, VOIDED, etc.) so
// existing readers (Charges tab, billing flip below) work unchanged.
const EVENT_TO_STATUS: Record<string, string> = {
  'invoice.paid':     'PAID',
  'invoice.partial':  'PARTIAL',
  'invoice.voided':   'VOIDED',
  'payment.created':  'PAID',  // payments imply the invoice is paid
};

interface StaxWebhookPayload {
  // Stax payload shape varies slightly by event type; we extract the
  // common fields. Treat everything as optional and degrade gracefully.
  id?:           string;       // Stax event ID (used for idempotency)
  type?:         string;       // e.g. "invoice.paid"
  event?:        string;       // alt name some webhook sources use
  created_at?:   string;
  data?: {
    id?:               string; // invoice id OR payment id depending on event
    invoice_id?:       string; // explicit when payload is a payment
    status?:           string;
    total?:            number;
    total_paid?:       number;
    sent_at?:          string;
    paid_at?:          string;
    [k: string]: unknown;
  };
  // Top-level fields some Stax endpoints use instead of `data`:
  invoice_id?:   string;
  status?:       string;
  [k: string]: unknown;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  // Only POST is meaningful; ignore everything else with a clear 405 so
  // accidental browser GETs don't 500.
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  // Token check. Must be configured BEFORE the function is exposed to
  // Stax — without it any internet caller could write paid status.
  if (!WEBHOOK_SECRET) {
    console.error('stax-webhook: STAX_WEBHOOK_SECRET env var is not set; refusing to process events');
    return jsonResponse({ error: 'webhook not configured' }, 503);
  }
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (token !== WEBHOOK_SECRET) {
    console.warn('stax-webhook: invalid token (got first 8 chars: %s)', token.slice(0, 8));
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // Parse body. Stax sends JSON.
  let payload: StaxWebhookPayload;
  try {
    payload = (await req.json()) as StaxWebhookPayload;
  } catch (parseErr) {
    console.error('stax-webhook: body parse failed:', parseErr);
    return jsonResponse({ error: 'invalid json body' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Persist the raw event first, before any business logic. Even if we
  // can't act on it (unknown event type, missing invoice id, etc.), we
  // want the audit trail. Idempotency: id is unique → conflict on retry
  // is a no-op.
  const eventId   = payload.id ?? crypto.randomUUID();
  const eventType = payload.type ?? payload.event ?? 'unknown';
  try {
    await supabase.from('stax_webhook_events').upsert({
      event_id:   eventId,
      event_type: eventType,
      payload,
      received_at: new Date().toISOString(),
    }, { onConflict: 'event_id' });
  } catch (logErr) {
    // Log but proceed — losing the audit row shouldn't drop the actual
    // status update.
    console.error('stax-webhook: failed to persist raw event (proceeding):', logErr);
  }

  const newStatus = EVENT_TO_STATUS[eventType];
  if (!newStatus) {
    // Unknown event type. We logged it; Stax's retry timer is satisfied
    // by 200. If a new event type starts firing, we'll see it in the
    // stax_webhook_events table and can extend the map.
    return jsonResponse({ ok: true, ack: 'event logged but unhandled', eventType });
  }

  // Resolve which Stax invoice this event refers to. invoice.* events
  // carry the invoice ID at data.id; payment.* events carry it at
  // data.invoice_id (the payment ID is at data.id, which we don't need).
  const staxInvoiceId =
    payload.data?.invoice_id ??
    payload.data?.id ??
    payload.invoice_id ??
    '';
  if (!staxInvoiceId) {
    console.warn('stax-webhook: no invoice id resolvable for event', eventType, payload);
    return jsonResponse({ ok: true, ack: 'event logged but no invoice id present', eventType });
  }

  // Look up the stax_invoices row. We have it indexed by stax_id (the
  // Stax-assigned invoice ID, written when our auto-charge cron or the
  // React Push to Stax flow originally created the invoice).
  const { data: invRows, error: invErr } = await supabase
    .from('stax_invoices')
    .select('id, qb_invoice_no, status')
    .eq('stax_id', staxInvoiceId)
    .limit(1);

  if (invErr) {
    console.error('stax-webhook: stax_invoices lookup failed:', invErr);
    // 500 makes Stax retry, which we want — transient DB issues shouldn't
    // drop the event.
    return jsonResponse({ error: 'lookup failed', detail: invErr.message }, 500);
  }
  if (!invRows || invRows.length === 0) {
    console.warn('stax-webhook: no stax_invoices row for stax_id=%s (event %s logged)', staxInvoiceId, eventType);
    return jsonResponse({ ok: true, ack: 'no matching invoice', staxInvoiceId });
  }

  const row = invRows[0];
  // Idempotency: if we already wrote PAID, don't re-write or re-flip
  // billing rows. Stax retries the webhook on 5xx for ~24h.
  if (row.status === newStatus) {
    return jsonResponse({ ok: true, alreadyApplied: true, qbInvoiceNo: row.qb_invoice_no, status: newStatus });
  }

  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };
  // For PAID events, stamp a notes line so the Charges tab shows where
  // the payment came from (auto-charge cron vs customer-portal pay-link
  // vs manual Stax dashboard recording). Without this they all look the
  // same.
  if (newStatus === 'PAID') {
    const paidAt = payload.data?.paid_at ?? new Date().toISOString();
    updatePayload.notes = `Marked PAID via Stax webhook (${eventType}) at ${paidAt}`;
  } else if (newStatus === 'VOIDED') {
    updatePayload.notes = `Voided in Stax — webhook event at ${new Date().toISOString()}`;
  } else if (newStatus === 'PARTIAL') {
    const totalPaid = payload.data?.total_paid;
    updatePayload.notes = totalPaid != null
      ? `Partial payment: $${Number(totalPaid).toFixed(2)} via webhook`
      : `Partial payment via webhook`;
  }

  const { error: updateErr } = await supabase
    .from('stax_invoices')
    .update(updatePayload)
    .eq('id', row.id);

  if (updateErr) {
    console.error('stax-webhook: stax_invoices update failed:', updateErr);
    return jsonResponse({ error: 'update failed', detail: updateErr.message }, 500);
  }

  // Mirror the paid status to public.billing so the Billing Report and
  // Invoice Review pages flip from Invoiced → Paid without a manual
  // refresh. Match on invoice_no = qb_invoice_no. Only flip rows that are
  // currently 'Invoiced' — never overwrite Void or Unbilled.
  if (newStatus === 'PAID' && row.qb_invoice_no) {
    const { error: billingErr, count } = await supabase
      .from('billing')
      .update({ status: 'Paid' }, { count: 'exact' })
      .eq('invoice_no', row.qb_invoice_no)
      .eq('status', 'Invoiced');
    if (billingErr) {
      // Don't 5xx the webhook over a billing-mirror failure — the
      // authoritative stax_invoices row is already PAID; the billing
      // mirror is downstream and can be repaired by a manual sync.
      console.error('stax-webhook: billing flip failed (non-fatal):', billingErr);
    } else {
      console.log('stax-webhook: marked %d billing rows Paid for %s', count ?? 0, row.qb_invoice_no);
    }
  }

  return jsonResponse({
    ok: true,
    qbInvoiceNo: row.qb_invoice_no,
    status: newStatus,
    eventType,
  });
});
