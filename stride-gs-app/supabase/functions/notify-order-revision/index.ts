/**
 * notify-order-revision — Supabase Edge Function — v2 2026-05-02 PST
 *
 * Sends an ORDER_REVISION_REQUESTED or ORDER_REJECTED email when a
 * reviewer marks a delivery order. Recipients = office distro
 * (NOTIFICATION_EMAILS secret) + the order submitter (resolved from
 * dt_orders.created_by_user → profiles.email).
 *
 * Hands off to the `send-email` edge function (Resend) for the actual
 * delivery — no GAS involvement. Tokens are HTML-escaped here before
 * being passed; send-email does the substitution + audit logging via
 * `email_sends`. Idempotency by orderId+action prevents double-fires
 * if the React caller retries.
 *
 * Request:  POST { orderId: string, action: 'revision_requested' | 'rejected',
 *                  reviewerName?: string, reviewNotes?: string }
 * Response: { ok: boolean, sent_to?: string[], error?: string }
 *
 * Required secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   NOTIFICATION_EMAILS  comma-separated office addresses
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// v3 (2026-05-09) — added 'updated_by_client' to handle the client-edit
// resubmit flow. The CreateDeliveryOrderModal save-changes path on a
// non-draft order, when the actor is a client, flips review_status back
// to pending_review and posts here with this action. Recipients differ
// from the reviewer-side actions (office only — submitter IS the actor).
type Action = 'revision_requested' | 'rejected' | 'updated_by_client';

const TEMPLATE_KEY: Record<Action, string> = {
  revision_requested: 'ORDER_REVISION_REQUESTED',
  rejected:           'ORDER_REJECTED',
  updated_by_client:  'ORDER_UPDATED_BY_CLIENT',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const orderId: string       = body.orderId ?? '';
    const action: Action        = body.action;
    const reviewerName: string  = body.reviewerName ?? 'Stride Reviewer';
    const reviewNotes: string   = (body.reviewNotes ?? '').trim();
    // v3 — for actions that can repeat (updated_by_client: a client may
    // edit the same order multiple times), the caller passes a per-edit
    // suffix so the idempotency key changes between edits. Reviewer-side
    // actions (revision_requested / rejected) typically happen once per
    // order — the suffix is optional and falls through to no-op.
    const idempotencySuffix: string = String(body.idempotencySuffix ?? '').trim();

    if (!orderId)                     return json({ ok: false, error: 'orderId required' }, 400);
    if (action !== 'revision_requested' && action !== 'rejected' && action !== 'updated_by_client') {
      return json({ ok: false, error: 'action must be revision_requested, rejected, or updated_by_client' }, 400);
    }

    const officeEmails  = Deno.env.get('NOTIFICATION_EMAILS') ?? '';
    const supabaseUrl   = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!officeEmails || !supabaseUrl || !serviceKey) {
      console.error('[notify-order-revision] Missing NOTIFICATION_EMAILS / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
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
        'contact_name', 'contact_email',
        'contact_address', 'contact_city', 'contact_state', 'contact_zip',
        'local_service_date', 'order_total', 'pricing_override',
        'created_by_user', 'review_notes',
        // v7 2026-05-12 — source + contact_email feed the public-order
        // link branch in orderLink so public_form submitters get the
        // /p/order/:id route instead of the auth-walled /orders/:id.
        'source',
        // v6 — client-resubmit diff snapshot powers {{CHANGES_LIST}}.
        'last_resubmit_diff',
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

    // ── 6. Token computation ──────────────────────────────────────────────
    const templateKey = TEMPLATE_KEY[action];
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
    // Anonymous public-form submitters (no tenant) don't have an account
    // and would bounce off the auth wall on /orders/:id. Route them to
    // the public /p/order/:id viewer instead — gated by the
    // get_public_order RPC's (id, email) two-factor check.
    const isPublicSubmitter = order.source === 'public_form' || !order.tenant_id;
    const recipientEmail = String(order.contact_email ?? '').trim();
    const orderLink = isPublicSubmitter && recipientEmail
      ? `https://www.mystridehub.com/#/p/order/${order.id}?email=${encodeURIComponent(recipientEmail)}`
      : order.tenant_id
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

    // v6 — render last_resubmit_diff as an HTML <ul> for the
    // {{CHANGES_LIST}} slot in the ORDER_UPDATED_BY_CLIENT template.
    // Empty / missing → fallback "(no field-level changes recorded)"
    // so the slot doesn't render as a literal {{CHANGES_LIST}}. Field
    // labels mirror the OrderPage banner's RESUBMIT_FIELD_LABELS map.
    const FIELD_LABELS: Record<string, string> = {
      local_service_date:   'Service Date',
      window_start_local:   'Window Start',
      window_end_local:     'Window End',
      po_number:            'PO Number',
      sidemark:             'Sidemark',
      details:              'Order Details',
      driver_notes:         'Driver Notes',
      contact_name:         'Contact Name',
      contact_address:      'Contact Address',
      contact_city:         'Contact City',
      contact_state:        'Contact State',
      contact_zip:          'Contact ZIP',
      contact_phone:        'Contact Phone',
      contact_phone2:       'Contact Phone 2',
      contact_email:        'Contact Email',
      billing_method:       'Billing Method',
      service_time_minutes: 'Service Time (min)',
      order_type:           'Order Type',
      coverage_option_id:   'Coverage Option',
      declared_value:       'Declared Value',
      items:                'Items',
    };
    const formatVal = (v: unknown): string => {
      if (v === null || v === undefined || v === '') return '—';
      if (typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        if ('count' in obj) return `${obj.count} item(s)`;
        return JSON.stringify(obj);
      }
      return String(v);
    };
    const buildChangesHtml = (diff: unknown): string => {
      if (!diff || typeof diff !== 'object') return '<em>(no field-level changes recorded)</em>';
      const entries = Object.entries(diff as Record<string, { old?: unknown; new?: unknown }>);
      if (entries.length === 0) return '<em>(no field-level changes recorded)</em>';
      const rows = entries.map(([k, v]) => {
        const label = FIELD_LABELS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `<li style="margin: 4px 0; line-height: 1.5;">`
          + `<strong>${htmlEscape(label)}</strong>: `
          + `<span style="color:#991B1B; text-decoration:line-through;">${htmlEscape(formatVal(v.old))}</span> `
          + `→ <span style="color:#166534; font-weight:600;">${htmlEscape(formatVal(v.new))}</span>`
          + `</li>`;
      }).join('');
      return `<ul style="margin: 4px 0 0 0; padding-left: 18px; font-size: 13px;">${rows}</ul>`;
    };
    const changesList = action === 'updated_by_client'
      ? buildChangesHtml((order as { last_resubmit_diff?: unknown }).last_resubmit_diff)
      : '';

    // Token values are HTML-escaped here so send-email's plain-string
    // substitution can't inject markup from reviewer-supplied notes
    // (or customer-supplied address/contact fields). CHANGES_LIST is
    // already HTML (we built it ourselves with htmlEscape on each
    // user-supplied value), so it goes in raw.
    const tokens: Record<string, string> = {
      ORDER_NUMBER:    htmlEscape(String(order.dt_identifier) + linkedLine),
      ORDER_TYPE:      htmlEscape(orderTypeDisplay),
      CLIENT_NAME:     htmlEscape(clientName),
      CONTACT_NAME:    htmlEscape(order.contact_name ?? ''),
      CONTACT_ADDRESS: htmlEscape(contactAddr),
      SERVICE_DATE:    htmlEscape(order.local_service_date ?? ''),
      ITEM_COUNT:      String(itemCount ?? 0),
      ORDER_TOTAL:     htmlEscape(orderTotalDisplay),
      REVIEWER_NAME:   htmlEscape(reviewerName),
      REVIEW_NOTES:    htmlEscape(notesDisplay),
      ORDER_LINK:      htmlEscape(orderLink),
      CHANGES_LIST:    changesList, // already HTML-safe
      APP_URL:         'https://www.mystridehub.com/#',
    };

    // ── 7. Compose recipient list ─────────────────────────────────────────
    // Reviewer-side actions (revision_requested / rejected) cc the
    // submitter so the client knows their order needs attention. The
    // client-side action (updated_by_client) goes office-only — the
    // submitter IS the actor who just clicked Save Changes; no point
    // emailing them their own edit.
    const officeList = officeEmails.split(',').map(s => s.trim()).filter(Boolean);
    const includeSubmitter = action !== 'updated_by_client';
    const seen = new Set<string>();
    const recipients: string[] = [];
    const sources: (string | null)[] = includeSubmitter
      ? [...officeList, submitterEmail]
      : [...officeList];
    for (const addr of sources.filter(Boolean) as string[]) {
      const lower = addr.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      recipients.push(addr);
    }
    if (recipients.length === 0) {
      return json({ ok: false, error: 'No recipients resolved' }, 500);
    }

    // ── 8. Delegate send to send-email edge function (Resend) ─────────────
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateKey,
        to: recipients,
        tokens,
        idempotencyKey: idempotencySuffix
          ? `${action}:${order.id}:${idempotencySuffix}`
          : `${action}:${order.id}`,
        relatedEntityType: 'dt_order',
        relatedEntityId: order.id,
        tenantId: order.tenant_id ?? undefined,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!sendJson.ok) {
      console.error('[notify-order-revision] send-email failed:', JSON.stringify(sendJson));
      return json({ ok: false, error: 'Email send failed', detail: sendJson }, 502);
    }

    console.log(`[notify-order-revision] Sent ${templateKey} for order ${order.dt_identifier} (resend ${sendJson.resendEmailId})`);
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
