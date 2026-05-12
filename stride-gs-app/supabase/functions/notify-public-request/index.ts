/**
 * notify-public-request — Supabase Edge Function
 *
 * Fires after a public service request has been INSERTed into
 * dt_orders + dt_order_items via the anon-INSERT RLS path. Sends:
 *   1. PUBLIC_REQUEST_CONFIRMATION → submitter (resolved from order
 *      contact_email or bill_to_email)
 *   2. PUBLIC_REQUEST_ALERT        → public_form_settings.alert_emails
 *
 * Both sends delegate to the `send-email` edge function (Resend) —
 * no GAS involvement. The function uses the service role to read the
 * order, items, and settings — anon RLS prevents the form's own
 * client from doing this.
 *
 * Tokens exposed to the templates:
 *   Identity / contact: REQUEST_ID, CONTACT_NAME, CONTACT_COMPANY,
 *     CONTACT_PHONE, CONTACT_EMAIL, SERVICE_DATE, SERVICE_ADDRESS,
 *     ITEM_COUNT, NOTES, REVIEW_LINK, APP_URL.
 *   Bill-To: BILL_TO_NAME, BILL_TO_COMPANY, BILL_TO_EMAIL,
 *     BILL_TO_PHONE.
 *   Pricing estimate (formatted as $X.XX or "—" when zero/missing):
 *     ESTIMATED_BASE_FEE, ESTIMATED_EXTRA_ITEMS_FEE,
 *     ESTIMATED_EXTRA_ITEMS_COUNT, ESTIMATED_ACCESSORIALS,
 *     ESTIMATED_COVERAGE, ESTIMATED_TAX, ESTIMATED_TAX_RATE,
 *     ESTIMATED_TOTAL, ESTIMATE_DISCLAIMER.
 *
 * KEEP IN SYNC: when adding new pricing columns to dt_orders, mirror
 * them here so the customer-facing email can render the same numbers
 * the public form showed at submit time.
 *
 * Request:  POST { orderId: string }
 * Response: { ok: boolean, sent?: { confirmation: boolean, alert: boolean }, error?: string }
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceKey) {
      console.error('[notify-public-request] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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
        'bill_to_name', 'bill_to_company', 'bill_to_email', 'bill_to_phone',
        'local_service_date', 'details',
        // Pricing snapshot — surfaced as tokens so the
        // PUBLIC_REQUEST_CONFIRMATION template can render the estimated
        // total + disclaimer for the submitter. Public-form submissions
        // always set pricing_override=true so staff confirms before
        // anything bills, but the customer-facing email shows the same
        // numbers they saw on the form.
        'base_delivery_fee', 'extra_items_count', 'extra_items_fee',
        'accessorials_total', 'coverage_charge',
        'tax_amount', 'tax_rate_pct', 'order_total',
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

    const serviceAddr = [
      order.contact_address, order.contact_city, order.contact_state, order.contact_zip,
    ].filter(Boolean).join(', ');

    // Public submissions have tenant_id=NULL (staff assigns on triage),
    // so link straight to the Orders page where pending_review rows
    // surface. The `/orders` route is the staff review queue.
    const reviewLink =
      `https://www.mystridehub.com/#/orders?open=${order.dt_identifier}`;

    // Format a number as USD or "—" when null/zero/missing. Public-form
    // submissions store zeros (not nulls) for tax / accessorials when
    // the section is empty, so we treat zero as "skip" in the
    // customer-facing email — only the line items that actually apply
    // get rendered.
    const fmtUsd = (v: number | string | null | undefined, opts?: { zeroIsBlank?: boolean }): string => {
      if (v === null || v === undefined || v === '') return '—';
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isFinite(n)) return '—';
      if (opts?.zeroIsBlank && n === 0) return '—';
      return `$${n.toFixed(2)}`;
    };

    const tokens: Record<string, string> = {
      REQUEST_ID:       String(order.dt_identifier ?? ''),
      CONTACT_NAME:     String(order.contact_name ?? ''),
      CONTACT_COMPANY:  String(order.contact_company || '—'),
      CONTACT_PHONE:    String(order.contact_phone ?? ''),
      CONTACT_EMAIL:    String(order.contact_email ?? ''),
      SERVICE_DATE:     String(order.local_service_date ?? '—'),
      SERVICE_ADDRESS:  serviceAddr || '—',
      ITEM_COUNT:       String(itemCount ?? 0),
      NOTES:            String(order.details || '—'),
      REVIEW_LINK:      reviewLink,
      APP_URL:          'https://www.mystridehub.com/#',

      // Bill-To
      BILL_TO_NAME:     String(order.bill_to_name ?? order.contact_name ?? ''),
      BILL_TO_COMPANY:  String(order.bill_to_company || '—'),
      BILL_TO_EMAIL:    String(order.bill_to_email ?? order.contact_email ?? ''),
      BILL_TO_PHONE:    String(order.bill_to_phone ?? order.contact_phone ?? ''),

      // Estimated pricing — every line is rendered as USD or "—".
      // ORDER_TOTAL is the headline number; the rest are line items the
      // template can choose to show in a table. EXTRA_ITEMS_COUNT is the
      // piece count over the threshold (separate from ITEM_COUNT above).
      ESTIMATED_BASE_FEE:          fmtUsd(order.base_delivery_fee),
      ESTIMATED_EXTRA_ITEMS_FEE:   fmtUsd(order.extra_items_fee, { zeroIsBlank: true }),
      ESTIMATED_EXTRA_ITEMS_COUNT: String(order.extra_items_count ?? 0),
      ESTIMATED_ACCESSORIALS:      fmtUsd(order.accessorials_total, { zeroIsBlank: true }),
      ESTIMATED_COVERAGE:          fmtUsd(order.coverage_charge, { zeroIsBlank: true }),
      ESTIMATED_TAX:               fmtUsd(order.tax_amount, { zeroIsBlank: true }),
      ESTIMATED_TAX_RATE:          order.tax_rate_pct != null ? `${Number(order.tax_rate_pct).toFixed(1)}%` : '—',
      ESTIMATED_TOTAL:             fmtUsd(order.order_total),

      // Disclaimer — used by the customer-facing template so the
      // estimate is never mistaken for a confirmed price. The internal
      // alert template can ignore this token.
      ESTIMATE_DISCLAIMER:
        'This is an estimated price only. Stride will review your request and confirm the final pricing before any work begins. Add-on charges and delivery rates may be adjusted for accuracy.',
    };

    let confirmationSent = false;
    if (order.contact_email) {
      const r = await invokeSendEmail(supabaseUrl, serviceKey, {
        templateKey: 'PUBLIC_REQUEST_CONFIRMATION',
        to: [order.contact_email],
        tokens,
        replyTo: replyTo || undefined,
        idempotencyKey: `public-request-confirm:${order.id}`,
        relatedEntityType: 'dt_order',
        relatedEntityId: order.id,
      });
      confirmationSent = r.ok;
      if (!r.ok) {
        console.error('[notify-public-request] confirmation send failed:', r.detail);
      }
    } else {
      console.warn('[notify-public-request] no contact_email — skipping confirmation');
    }

    let alertSent = false;
    if (alertEmails.length > 0) {
      const r = await invokeSendEmail(supabaseUrl, serviceKey, {
        templateKey: 'PUBLIC_REQUEST_ALERT',
        to: alertEmails,
        tokens,
        replyTo: order.contact_email || undefined,
        idempotencyKey: `public-request-alert:${order.id}`,
        relatedEntityType: 'dt_order',
        relatedEntityId: order.id,
      });
      alertSent = r.ok;
      if (!r.ok) {
        console.error('[notify-public-request] alert send failed:', r.detail);
      }
    } else {
      console.warn('[notify-public-request] public_form_settings.alert_emails is empty — alert skipped');
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

async function invokeSendEmail(
  supabaseUrl: string,
  serviceKey: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; detail?: unknown }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: !!j.ok, detail: j };
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
