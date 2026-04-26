/**
 * notify-order-revision — Supabase Edge Function — v1 2026-04-26 PST
 *
 * Sends an ORDER_REVISION_REQUESTED or ORDER_REJECTED email when a
 * reviewer marks a delivery order. Recipients = office distro
 * (NOTIFICATION_EMAILS secret) + the order submitter (resolved from
 * dt_orders.created_by_user → profiles.email).
 *
 * Mirrors notify-new-order's pattern: template lookup from
 * email_templates → token substitution → GAS sendRawEmail. Email
 * sending is best-effort — a failure here doesn't roll back the
 * caller's review_status update; the caller has already persisted
 * the state change before invoking this.
 *
 * Request:  POST { orderId: string, action: 'revision_requested' | 'rejected',
 *                  reviewerName?: string, reviewNotes?: string }
 * Response: { ok: boolean, sent_to?: string[], error?: string }
 *
 * Required secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   NOTIFICATION_EMAILS  comma-separated office addresses
 *   GAS_API_URL          StrideAPI.gs Web App URL
 *   GAS_API_TOKEN        API_TOKEN Script Property
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action = 'revision_requested' | 'rejected';

const TEMPLATE_KEY: Record<Action, string> = {
  revision_requested: 'ORDER_REVISION_REQUESTED',
  rejected:           'ORDER_REJECTED',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const orderId: string       = body.orderId ?? '';
    const action: Action        = body.action;
    const reviewerName: string  = body.reviewerName ?? 'Stride Reviewer';
    const reviewNotes: string   = (body.reviewNotes ?? '').trim();

    if (!orderId)                     return json({ ok: false, error: 'orderId required' }, 400);
    if (action !== 'revision_requested' && action !== 'rejected') {
      return json({ ok: false, error: 'action must be revision_requested or rejected' }, 400);
    }

    const gasApiUrl     = Deno.env.get('GAS_API_URL') ?? '';
    const gasApiToken   = Deno.env.get('GAS_API_TOKEN') ?? '';
    const officeEmails  = Deno.env.get('NOTIFICATION_EMAILS') ?? '';

    if (!gasApiUrl || !gasApiToken || !officeEmails) {
      console.error('[notify-order-revision] Missing GAS_API_URL / GAS_API_TOKEN / NOTIFICATION_EMAILS');
      return json({ ok: false, error: 'Server misconfigured — missing secrets' }, 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 1. Order ──────────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await supabase
      .from('dt_orders')
      .select([
        'id', 'dt_identifier', 'order_type', 'tenant_id', 'linked_order_id',
        'contact_name', 'contact_address', 'contact_city', 'contact_state', 'contact_zip',
        'local_service_date', 'order_total', 'pricing_override',
        'created_by_user', 'review_notes',
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
        .select('dt_identifier, contact_name')
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
        .from('clients').select('name').eq('tenant_id', order.tenant_id).single();
      if (client?.name) clientName = client.name;
    }

    // ── 5. Submitter email ────────────────────────────────────────────────
    // Resolve from dt_orders.created_by_user → profiles.email. Falls back
    // to office-only delivery if the order has no creator record (legacy
    // backfilled rows, system imports). Office is always copied so the
    // notification still reaches a human.
    let submitterEmail: string | null = null;
    if (order.created_by_user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', order.created_by_user)
        .single();
      if (profile?.email) submitterEmail = String(profile.email);
    }

    // ── 6. Template ───────────────────────────────────────────────────────
    const templateKey = TEMPLATE_KEY[action];
    const { data: tpl } = await supabase
      .from('email_templates')
      .select('subject, body')
      .eq('template_key', templateKey)
      .eq('active', true)
      .single();

    if (!tpl?.body) {
      return json({ ok: false, error: `${templateKey} template not found or inactive` }, 500);
    }

    // ── 7. Token substitution ─────────────────────────────────────────────
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

    const isCallForQuote = order.pricing_override === true;
    const orderTotalDisplay =
      !isCallForQuote && order.order_total != null
        ? `$${Number(order.order_total).toFixed(2)}`
        : 'Quote Required';

    // OrderPage deep-link — same hash-route shape as the other email CTAs.
    // The Order detail page already loads by id, so we send the UUID
    // rather than the dt_identifier (which would need a side-channel
    // lookup). `&client=` is included so RLS/client-scope hooks resolve
    // identically to email-deep-link clicks elsewhere.
    const orderLink = order.tenant_id
      ? `https://www.mystridehub.com/#/orders/${order.id}?client=${order.tenant_id}`
      : `https://www.mystridehub.com/#/orders/${order.id}`;

    // Reviewer notes fallback. The migration's HTML uses white-space:
    // pre-wrap so multi-line notes render correctly; we just emit "—"
    // when nothing was supplied so the cell isn't empty.
    const notesDisplay = reviewNotes || (order.review_notes ?? '') || '—';

    // HTML-escape every token value before substitution. Reviewer-supplied
    // notes (and to a lesser extent customer-name / address fields) flow
    // straight into the email body, so an unescaped `<` or `&` would
    // corrupt rendering at best and inject markup at worst. The link
    // value is kept escaped too — safe because the URL is constructed
    // server-side from a UUID + tenant_id, neither of which contain
    // angle brackets.
    const htmlEscape = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const tokens: Record<string, string> = {
      '{{ORDER_NUMBER}}':    htmlEscape(String(order.dt_identifier) + linkedLine),
      '{{ORDER_TYPE}}':      htmlEscape(orderTypeDisplay),
      '{{CLIENT_NAME}}':     htmlEscape(clientName),
      '{{CONTACT_NAME}}':    htmlEscape(order.contact_name ?? ''),
      '{{CONTACT_ADDRESS}}': htmlEscape(contactAddr),
      '{{SERVICE_DATE}}':    htmlEscape(order.local_service_date ?? ''),
      '{{ITEM_COUNT}}':      String(itemCount ?? 0),
      '{{ORDER_TOTAL}}':     htmlEscape(orderTotalDisplay),
      '{{REVIEWER_NAME}}':   htmlEscape(reviewerName),
      '{{REVIEW_NOTES}}':    htmlEscape(notesDisplay),
      '{{ORDER_LINK}}':      htmlEscape(orderLink),
      '{{APP_URL}}':         'https://www.mystridehub.com/#',
    };
    const tokenPattern = new RegExp(
      Object.keys(tokens).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g'
    );
    const replaceTokens = (s: string) => s.replace(tokenPattern, m => tokens[m] ?? m);
    const subject = replaceTokens(tpl.subject as string);
    const htmlBody = replaceTokens(tpl.body as string);

    // ── 8. Compose recipient list ─────────────────────────────────────────
    // Office is always copied. Submitter is added when we resolved an
    // email. Dedupe case-insensitively while preserving first-seen
    // casing so display names / mixed-case addresses look right in the
    // inbox.
    const officeList = officeEmails.split(',').map(s => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const addr of [...officeList, submitterEmail].filter(Boolean) as string[]) {
      const lower = addr.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      recipients.push(addr);
    }
    if (recipients.length === 0) {
      return json({ ok: false, error: 'No recipients resolved' }, 500);
    }

    // ── 9. Send ───────────────────────────────────────────────────────────
    const gasRes = await fetch(
      `${gasApiUrl}?token=${encodeURIComponent(gasApiToken)}&action=sendRawEmail`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipients.join(','), subject, htmlBody }),
      },
    );
    const gasJson = await gasRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!gasJson.success) {
      console.error('[notify-order-revision] GAS sendRawEmail failed:', JSON.stringify(gasJson));
      return json({ ok: false, error: 'Email send failed', detail: gasJson }, 502);
    }

    console.log(`[notify-order-revision] Sent ${templateKey} for order ${order.dt_identifier} to ${recipients.join(',')}`);
    return json({ ok: true, sent_to: recipients });

  } catch (err) {
    console.error('[notify-order-revision] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
