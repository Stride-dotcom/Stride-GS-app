/**
 * notify-new-order — Supabase Edge Function
 *
 * Sends an ORDER_REVIEW_REQUEST email to staff when a client submits
 * a new delivery order. Reads order data + template from Supabase,
 * then calls GAS sendRawEmail to send via GmailApp.
 *
 * Request:  POST { orderId: string, submittedBy?: string }
 * Response: { ok: boolean, error?: string }
 *
 * Required secrets (set in Supabase Dashboard → Edge Functions → Secrets):
 *   NOTIFICATION_EMAILS  — comma-separated recipient addresses
 *   GAS_API_URL          — StrideAPI.gs Web App URL
 *   GAS_API_TOKEN        — API_TOKEN Script Property value
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const gasApiUrl     = Deno.env.get('GAS_API_URL') ?? '';
    const gasApiToken   = Deno.env.get('GAS_API_TOKEN') ?? '';
    const notifEmails   = Deno.env.get('NOTIFICATION_EMAILS') ?? '';

    if (!gasApiUrl || !gasApiToken || !notifEmails) {
      console.error('[notify-new-order] Missing required secrets (GAS_API_URL / GAS_API_TOKEN / NOTIFICATION_EMAILS)');
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

    // ── 5. Email template ─────────────────────────────────────────────────
    const { data: tpl } = await supabase
      .from('email_templates')
      .select('subject, body')
      .eq('template_key', 'ORDER_REVIEW_REQUEST')
      .eq('active', true)
      .single();

    if (!tpl?.body) {
      return json({ ok: false, error: 'ORDER_REVIEW_REQUEST template not found or inactive' }, 500);
    }

    // ── 6. Token substitution ─────────────────────────────────────────────
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

    const tokens: Record<string, string> = {
      '{{ORDER_NUMBER}}':        String(order.dt_identifier) + linkedLine,
      '{{LINKED_ORDER_NUMBER}}': linkedOrder?.dt_identifier ?? '—',
      '{{ORDER_TYPE}}':          orderTypeDisplay,
      '{{CLIENT_NAME}}':         clientName,
      '{{CONTACT_NAME}}':        order.contact_name ?? '',
      '{{CONTACT_ADDRESS}}':     contactAddr,
      '{{PICKUP_CONTACT}}':      linkedOrder?.contact_name ?? '—',
      '{{PICKUP_ADDRESS}}':      pickupAddr || '—',
      '{{SERVICE_DATE}}':        order.local_service_date ?? '',
      '{{ITEM_COUNT}}':          String(itemCount ?? 0),
      '{{ORDER_TOTAL}}':         orderTotalDisplay,
      '{{SUBMITTED_BY}}':        submittedBy,
      '{{REVIEW_LINK}}':         `https://www.mystridehub.com/#/delivery?open=${order.dt_identifier}&client=${order.tenant_id || ''}`,
      '{{APP_URL}}':             'https://www.mystridehub.com/#',
    };

    let subject = tpl.subject as string;
    let htmlBody = tpl.body as string;
    for (const [k, v] of Object.entries(tokens)) {
      subject  = subject.split(k).join(v);
      htmlBody = htmlBody.split(k).join(v);
    }

    // ── 7. Call GAS sendRawEmail via POST ─────────────────────────────────
    const gasRes = await fetch(
      `${gasApiUrl}?token=${encodeURIComponent(gasApiToken)}&action=sendRawEmail`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: notifEmails, subject, htmlBody }),
      },
    );

    const gasJson = await gasRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!gasJson.success) {
      console.error('[notify-new-order] GAS sendRawEmail failed:', JSON.stringify(gasJson));
      return json({ ok: false, error: 'Email send failed', detail: gasJson }, 502);
    }

    console.log(`[notify-new-order] Sent for order ${order.dt_identifier} to ${notifEmails}`);
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
