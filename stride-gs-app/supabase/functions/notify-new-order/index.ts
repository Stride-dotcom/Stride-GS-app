/**
 * notify-new-order — Supabase Edge Function
 *
 * Sends an ORDER_REVIEW_REQUEST email to staff when a client submits
 * a new delivery order. Reads order data from Supabase, computes
 * tokens, then calls the `send-email` edge function (Resend) to
 * actually deliver the mail. No GAS involvement.
 *
 * Request:  POST { orderId: string, submittedBy?: string }
 * Response: { ok: boolean, error?: string }
 *
 * Required secrets (set in Supabase Dashboard → Edge Functions → Secrets):
 *   NOTIFICATION_EMAILS  — comma-separated recipient addresses
 *   (RESEND_API_KEY consumed downstream by send-email — not needed here)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers are deliberately duplicated across each Edge Function rather
// than imported from a shared module. Supabase Edge Functions bundle each
// function as a self-contained Deno deployment — `supabase functions deploy
// <name>` only ships files reachable from the function's own directory, so a
// `_shared/cors.ts` next to functions/ would not get included unless we added
// build tooling. Until we do, copy-paste is the path that keeps deploys
// reliable. See dt-push-order, dt-sync-statuses, dt-backfill-orders,
// dt-webhook-ingest for the matching block.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const orderId: string = body.orderId ?? '';
    const submittedBy: string = body.submittedBy ?? 'Unknown';

    if (!orderId) {
      return json({ ok: false, error: 'orderId required' }, 400);
    }

    const notifEmails   = Deno.env.get('NOTIFICATION_EMAILS') ?? '';
    const supabaseUrl   = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!notifEmails || !supabaseUrl || !serviceKey) {
      console.error('[notify-new-order] Missing required secrets (NOTIFICATION_EMAILS / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
      return json({ ok: false, error: 'Server misconfigured — missing secrets' }, 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 1. Primary order ──────────────────────────────────────────────────
    const { data: order, error: orderErr } = await supabase
      .from('dt_orders')
      .select([
        'id', 'dt_identifier', 'order_type', 'tenant_id', 'linked_order_id',
        'contact_name', 'contact_address', 'contact_city', 'contact_state', 'contact_zip',
        'local_service_date', 'order_total', 'pricing_override',
      ].join(', '))
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return json({ ok: false, error: `Order not found: ${orderErr?.message ?? 'unknown'}` }, 404);
    }

    // ── 2. Linked pickup row (P+D only) ───────────────────────────────────
    let linkedOrder: Record<string, string | null> | null = null;
    if (order.linked_order_id) {
      const { data: linked } = await supabase
        .from('dt_orders')
        .select('dt_identifier, contact_name, contact_address, contact_city, contact_state, contact_zip')
        .eq('id', order.linked_order_id)
        .single();
      linkedOrder = linked ?? null;
    }

    // ── 3. Item count ─────────────────────────────────────────────────────
    const { count: itemCount } = await supabase
      .from('dt_order_items')
      .select('id', { count: 'exact', head: true })
      .eq('dt_order_id', orderId);

    // ── 4. Client name ────────────────────────────────────────────────────
    let clientName = order.tenant_id ?? '';
    if (order.tenant_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('name')
        .eq('tenant_id', order.tenant_id)
        .single();
      if (client?.name) clientName = client.name;
    }

    // ── 5. Token computation ──────────────────────────────────────────────
    const isPickupAndDelivery = !!order.linked_order_id;
    const orderTypeDisplay =
      isPickupAndDelivery               ? 'Pickup & Delivery'
      : order.order_type === 'pickup'      ? 'Pickup'
      : order.order_type === 'service_only'? 'Service Only'
      : 'Delivery';

    const contactAddr = [
      order.contact_address, order.contact_city, order.contact_state, order.contact_zip,
    ].filter(Boolean).join(', ');

    const linkedLine = isPickupAndDelivery && linkedOrder
      ? ` (Pickup leg: ${linkedOrder.dt_identifier})`
      : '';

    const pickupAddr = isPickupAndDelivery && linkedOrder
      ? [
          linkedOrder.contact_address, linkedOrder.contact_city,
          linkedOrder.contact_state, linkedOrder.contact_zip,
        ].filter(Boolean).join(', ')
      : '';

    const isCallForQuote = order.pricing_override === true;
    const orderTotalDisplay =
      !isCallForQuote && order.order_total != null
        ? `$${Number(order.order_total).toFixed(2)}`
        : 'Quote Required';

    // The review-deep-link only opens the panel correctly when both
    // ?open= and &client= are present. If tenant_id is missing on the
    // order row (e.g. an unmapped account that snuck through) we surface a
    // visible warning in place of the link so the recipient knows to open
    // the order manually rather than landing on a broken page.
    // Route is /orders (the React App.tsx Route path); /delivery was a
    // historical typo that left the link landing on a no-match page.
    const reviewLink = order.tenant_id
      ? `https://www.mystridehub.com/#/orders?open=${order.dt_identifier}&client=${order.tenant_id}`
      : '⚠ NO REVIEW LINK — order has no tenant mapping. Open the Review Queue manually.';

    const tokens: Record<string, string> = {
      ORDER_NUMBER:        String(order.dt_identifier) + linkedLine,
      LINKED_ORDER_NUMBER: linkedOrder?.dt_identifier ?? '—',
      ORDER_TYPE:          orderTypeDisplay,
      CLIENT_NAME:         clientName,
      CONTACT_NAME:        order.contact_name ?? '',
      CONTACT_ADDRESS:     contactAddr,
      PICKUP_CONTACT:      linkedOrder?.contact_name ?? '—',
      PICKUP_ADDRESS:      pickupAddr || '—',
      SERVICE_DATE:        order.local_service_date ?? '',
      ITEM_COUNT:          String(itemCount ?? 0),
      ORDER_TOTAL:         orderTotalDisplay,
      SUBMITTED_BY:        submittedBy,
      REVIEW_LINK:         reviewLink,
      APP_URL:             'https://www.mystridehub.com/#',
    };

    // ── 6. Delegate send to send-email edge function (Resend) ─────────────
    // send-email handles template lookup, token substitution, idempotency,
    // and the `email_sends` audit row. We just hand off recipients +
    // tokens. Idempotency by orderId prevents double-sends if the React
    // caller retries.
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateKey: 'ORDER_REVIEW_REQUEST',
        to: notifEmails.split(',').map(s => s.trim()).filter(Boolean),
        tokens,
        idempotencyKey: `order-review-request:${order.id}`,
        relatedEntityType: 'dt_order',
        relatedEntityId: order.id,
        tenantId: order.tenant_id ?? undefined,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!sendJson.ok) {
      console.error('[notify-new-order] send-email failed:', JSON.stringify(sendJson));
      return json({ ok: false, error: 'Email send failed', detail: sendJson }, 502);
    }

    console.log(`[notify-new-order] Sent for order ${order.dt_identifier} (resend ${sendJson.resendEmailId})`);
    return json({ ok: true });

  } catch (err) {
    console.error('[notify-new-order] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
