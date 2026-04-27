/**
 * notify-public-request — Supabase Edge Function
 *
 * Fires after a public service request has been INSERTed into
 * dt_orders + dt_order_items via the anon-INSERT RLS path. Sends:
 *   1. PUBLIC_REQUEST_CONFIRMATION → submitter (resolved from order
 *      contact_email)
 *   2. PUBLIC_REQUEST_ALERT        → public_form_settings.alert_emails
 *
 * Both templates live in email_templates and the actual mail send is
 * delegated to GAS sendRawEmail (same pattern as notify-new-order /
 * notify-order-revision). The function uses the service role to read
 * the order, items, and settings — anon RLS prevents the form's own
 * client from doing this.
 *
 * Request:  POST { orderId: string }
 * Response: { ok: boolean, sent?: { confirmation: boolean, alert: boolean }, error?: string }
 *
 * Required secrets:
 *   GAS_API_URL    — StrideAPI.gs Web App URL
 *   GAS_API_TOKEN  — API_TOKEN Script Property value
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

    if (!orderId) {
      return json({ ok: false, error: 'orderId required' }, 400);
    }

    const gasApiUrl   = Deno.env.get('GAS_API_URL') ?? '';
    const gasApiToken = Deno.env.get('GAS_API_TOKEN') ?? '';

    if (!gasApiUrl || !gasApiToken) {
      console.error('[notify-public-request] Missing GAS_API_URL or GAS_API_TOKEN');
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order, error: orderErr } = await supabase
      .from('dt_orders')
      .select([
        'id', 'dt_identifier', 'tenant_id', 'source', 'review_status',
        'contact_name', 'contact_company', 'contact_email', 'contact_phone',
        'contact_address', 'contact_city', 'contact_state', 'contact_zip',
        'local_service_date', 'details',
      ].join(','))
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return json({ ok: false, error: `Order not found: ${orderErr?.message ?? 'unknown'}` }, 404);
    }

    if (order.source !== 'public_form') {
      return json({ ok: false, error: 'Order is not a public_form submission' }, 400);
    }

    const { count: itemCount } = await supabase
      .from('dt_order_items')
      .select('id', { count: 'exact', head: true })
      .eq('dt_order_id', orderId);

    const { data: settings } = await supabase
      .from('public_form_settings')
      .select('alert_emails, reply_to_email')
      .eq('id', 1)
      .single();

    const alertEmails: string[] = Array.isArray(settings?.alert_emails)
      ? (settings!.alert_emails as string[]).filter(Boolean)
      : [];
    const replyTo: string | null = settings?.reply_to_email ?? null;

    const { data: templates } = await supabase
      .from('email_templates')
      .select('template_key, subject, body')
      .in('template_key', ['PUBLIC_REQUEST_CONFIRMATION', 'PUBLIC_REQUEST_ALERT'])
      .eq('active', true);

    const confirmTpl = templates?.find(t => t.template_key === 'PUBLIC_REQUEST_CONFIRMATION');
    const alertTpl   = templates?.find(t => t.template_key === 'PUBLIC_REQUEST_ALERT');

    const serviceAddr = [
      order.contact_address, order.contact_city, order.contact_state, order.contact_zip,
    ].filter(Boolean).join(', ');

    // Public submissions have tenant_id=NULL (staff assigns on triage),
    // so link straight to the Orders page where pending_review rows
    // surface. The `/orders` route is the staff review queue.
    const reviewLink =
      `https://www.mystridehub.com/#/orders?open=${order.dt_identifier}`;

    const tokens: Record<string, string> = {
      '{{REQUEST_ID}}':       String(order.dt_identifier ?? ''),
      '{{CONTACT_NAME}}':     String(order.contact_name ?? ''),
      '{{CONTACT_COMPANY}}':  String(order.contact_company || '—'),
      '{{CONTACT_PHONE}}':    String(order.contact_phone ?? ''),
      '{{CONTACT_EMAIL}}':    String(order.contact_email ?? ''),
      '{{SERVICE_DATE}}':     String(order.local_service_date ?? '—'),
      '{{SERVICE_ADDRESS}}':  serviceAddr || '—',
      '{{ITEM_COUNT}}':       String(itemCount ?? 0),
      '{{NOTES}}':            String(order.details || '—'),
      '{{REVIEW_LINK}}':      reviewLink,
      '{{APP_URL}}':          'https://www.mystridehub.com/#',
    };

    const tokenPattern = new RegExp(
      Object.keys(tokens).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g'
    );
    const replaceTokens = (s: string) => s.replace(tokenPattern, m => tokens[m] ?? m);

    let confirmationSent = false;
    if (confirmTpl?.body && order.contact_email) {
      const subject  = replaceTokens(confirmTpl.subject as string);
      const htmlBody = replaceTokens(confirmTpl.body as string);
      const r = await sendViaGas(gasApiUrl, gasApiToken, {
        to: order.contact_email,
        subject,
        htmlBody,
        replyTo: replyTo || undefined,
      });
      confirmationSent = r.ok;
      if (!r.ok) {
        console.error('[notify-public-request] confirmation send failed:', r.detail);
      }
    } else if (!order.contact_email) {
      console.warn('[notify-public-request] no contact_email — skipping confirmation');
    } else {
      console.warn('[notify-public-request] PUBLIC_REQUEST_CONFIRMATION template missing/inactive');
    }

    let alertSent = false;
    if (alertTpl?.body && alertEmails.length > 0) {
      const subject  = replaceTokens(alertTpl.subject as string);
      const htmlBody = replaceTokens(alertTpl.body as string);
      const r = await sendViaGas(gasApiUrl, gasApiToken, {
        to: alertEmails.join(','),
        subject,
        htmlBody,
        replyTo: order.contact_email || undefined,
      });
      alertSent = r.ok;
      if (!r.ok) {
        console.error('[notify-public-request] alert send failed:', r.detail);
      }
    } else if (alertEmails.length === 0) {
      console.warn('[notify-public-request] public_form_settings.alert_emails is empty — alert skipped');
    } else {
      console.warn('[notify-public-request] PUBLIC_REQUEST_ALERT template missing/inactive');
    }

    return json({
      ok: true,
      sent: { confirmation: confirmationSent, alert: alertSent },
    });

  } catch (err) {
    console.error('[notify-public-request] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

async function sendViaGas(
  url: string,
  token: string,
  payload: { to: string; subject: string; htmlBody: string; replyTo?: string },
): Promise<{ ok: boolean; detail?: unknown }> {
  try {
    const res = await fetch(
      `${url}?token=${encodeURIComponent(token)}&action=sendRawEmail`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: !!j.success, detail: j };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
