/**
 * notify-pickup-completed — Supabase Edge Function
 *
 * Version: v2 (2026-05-13 PST)
 *   v2: After the email send, invoke the new
 *       stamp-pickup-on-linked-delivery helper for P+D pairs (when
 *       order has linked_order_id). Helper writes
 *       linked_pickup_finished_at + linked_pickup_driver_name on the
 *       delivery row and stamps picked_up_at on matching delivery items.
 *       Webhook fires before DT export.xml lag is resolved, so values
 *       start as (now()/null) and a later dt-sync-statuses run upgrades
 *       them to (real timestamp/real driver).
 *
 * Version: v1 (2026-05-11 PST)
 *   v1: Initial — staff email on Service_Route_Finished for pickup
 *       orders. PICKUP_COMPLETED template.
 *
 * Sends a PICKUP_COMPLETED email to staff in real time when a
 * DispatchTrack pickup leg fires Service_Route_Finished. Invoked
 * from dt-webhook-ingest after the order's status flips to
 * Completed (3). Email infrastructure: send-email (Resend) + the
 * email_templates row keyed PICKUP_COMPLETED. Recipients come from
 * the NOTIFICATION_EMAILS secret (comma-separated), matching the
 * other notify-* functions.
 *
 * Why fire-and-forget from the webhook instead of inlining the email
 * call: keeps dt-webhook-ingest's response path fast (DT retries on
 * slow acks), gives us an idempotency boundary (notify-pickup-completed
 * uses the order id as the dedup key, so DT redelivering the webhook
 * doesn't double-send the email), and matches the existing pattern
 * (notify-new-order, notify-public-request, notify-task-client-note).
 *
 * Request:  POST { orderId: string }
 * Response: { ok: boolean, error?: string }
 *
 * Required secrets:
 *   NOTIFICATION_EMAILS  — comma-separated recipient addresses
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — auto-injected
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { stampPickupOnLinkedDelivery } from '../_shared/stamp-pickup-on-linked-delivery.ts';

// CORS headers duplicated per-function — see notify-new-order for the
// rationale on why we don't use a shared module here.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrderRow {
  id: string;
  dt_identifier: string | null;
  order_type: string | null;
  tenant_id: string | null;
  linked_order_id: string | null;
  contact_name: string | null;
  contact_address: string | null;
  contact_city: string | null;
  contact_state: string | null;
  contact_zip: string | null;
  driver_name: string | null;
  finished_at: string | null;
  status_id: number | null;
}

// dt_statuses.id 3 = Completed, 22 = Collected. Mirror of
// dt-webhook-ingest's STATUS_COMPLETED constant. We gate on either
// terminal "pickup is done" status so an accidental invocation
// against an in-progress pickup doesn't fire a confusing email.
const PICKUP_DONE_STATUS_IDS = new Set([3, 22]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const orderId: string = body.orderId ?? '';
    if (!orderId) return json({ ok: false, error: 'orderId required' }, 400);

    const notifEmails = Deno.env.get('NOTIFICATION_EMAILS') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!notifEmails || !supabaseUrl || !serviceKey) {
      console.error('[notify-pickup-completed] Missing required secrets');
      return json({ ok: false, error: 'Server misconfigured — missing secrets' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Fetch the pickup order row ──────────────────────────────────────
    const { data: order, error: orderErr } = await supabase
      .from('dt_orders')
      .select([
        'id', 'dt_identifier', 'order_type', 'tenant_id', 'linked_order_id',
        'contact_name', 'contact_address', 'contact_city', 'contact_state', 'contact_zip',
        'driver_name', 'finished_at', 'status_id',
      ].join(', '))
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return json({ ok: false, error: `Order not found: ${orderErr?.message ?? 'unknown'}` }, 404);
    }

    const o = order as unknown as OrderRow;

    // Defensive gate — only send for pickup-type orders. The webhook
    // already gates on this but a misrouted manual invocation
    // shouldn't fire a confusing email for a delivery row.
    if (o.order_type !== 'pickup') {
      console.log(`[notify-pickup-completed] order ${o.dt_identifier} is order_type=${o.order_type} — not a pickup, skipping`);
      return json({ ok: true, skipped: 'not_a_pickup' });
    }

    // Second defensive gate — pickup must be in a terminal "done"
    // status. Catches the case where someone manually POSTs an orderId
    // for a pickup that hasn't actually completed yet (the webhook
    // path always satisfies this since it fires on Service_Route_Finished,
    // which writes status_id=3 in the upsert immediately above).
    if (o.status_id == null || !PICKUP_DONE_STATUS_IDS.has(o.status_id)) {
      console.log(`[notify-pickup-completed] order ${o.dt_identifier} status_id=${o.status_id} not in done set ${[...PICKUP_DONE_STATUS_IDS].join(',')} — skipping`);
      return json({ ok: true, skipped: 'not_completed' });
    }

    // ── 2. Linked delivery row (P+D pairs) ─────────────────────────────────
    let linkedDeliveryIdent: string | null = null;
    if (o.linked_order_id) {
      const { data: linked } = await supabase
        .from('dt_orders')
        .select('dt_identifier')
        .eq('id', o.linked_order_id)
        .maybeSingle();
      linkedDeliveryIdent = (linked as { dt_identifier?: string | null } | null)?.dt_identifier ?? null;
    }

    // ── 3. Item count on the pickup leg ────────────────────────────────────
    const { count: itemCount } = await supabase
      .from('dt_order_items')
      .select('id', { count: 'exact', head: true })
      .eq('dt_order_id', orderId)
      .is('removed_at', null);

    // ── 4. Client display name ─────────────────────────────────────────────
    // Fall back to "(unknown client)" rather than the raw tenant_id
    // UUID — operators read this email at a glance, a 36-char UUID
    // looks like a data bug.
    let clientName = '(unknown client)';
    if (o.tenant_id) {
      const { data: client } = await supabase
        .from('clients')
        .select('name')
        .eq('tenant_id', o.tenant_id)
        .maybeSingle();
      if (client && (client as { name?: string }).name) clientName = (client as { name: string }).name;
    }

    // ── 5. Token build ─────────────────────────────────────────────────────
    const orderTypeDisplay = o.linked_order_id ? 'Pickup & Delivery' : 'Standalone Pickup';

    const pickupAddress = [
      o.contact_name,
      o.contact_address,
      [o.contact_city, o.contact_state, o.contact_zip].filter(Boolean).join(' '),
    ].filter(Boolean).join(' · ');

    // finished_at + driver_name are populated by dt-sync-statuses pulling
    // export.xml from DT. The webhook fires before that poll runs, so on
    // the common real-time path both are NULL. Wording on the email
    // reflects that — "pending DT sync" is the expected steady state,
    // not an error condition.
    const completedAt = o.finished_at
      ? new Date(o.finished_at).toLocaleString('en-US', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles',
        })
      : new Date().toLocaleString('en-US', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles',
        }) + ' (just now — driver+timestamp details fill in after the next DT sync)';
    const driverName = o.driver_name && o.driver_name.trim()
      ? o.driver_name.trim()
      : 'pending DT sync';

    const appBase = 'https://www.mystridehub.com/#';
    const appLink = o.tenant_id
      ? `${appBase}/orders?open=${o.dt_identifier}&client=${o.tenant_id}`
      : '—';
    const deliveryLink = linkedDeliveryIdent && o.tenant_id
      ? `${appBase}/orders?open=${linkedDeliveryIdent}&client=${o.tenant_id}`
      : '—';

    const tokens: Record<string, string> = {
      ORDER_NUMBER:      String(o.dt_identifier ?? ''),
      LINKED_DELIVERY:   linkedDeliveryIdent ?? '—',
      ORDER_TYPE:        orderTypeDisplay,
      CLIENT_NAME:       clientName,
      PICKUP_ADDRESS:    pickupAddress || '—',
      ITEM_COUNT:        String(itemCount ?? 0),
      DRIVER_NAME:       driverName,
      COMPLETED_AT:      completedAt,
      APP_LINK:          appLink,
      DELIVERY_LINK:     deliveryLink,
    };

    // ── 6. Delegate send to send-email ─────────────────────────────────────
    // Idempotency key includes order id only — DT may push duplicate
    // Service_Route_Finished events on retry, and send-email's idempotency
    // table will block the second send so ops only sees one email per
    // pickup completion. Same pattern as notify-new-order.
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templateKey: 'PICKUP_COMPLETED',
        to: notifEmails.split(',').map(s => s.trim()).filter(Boolean),
        tokens,
        idempotencyKey: `pickup-completed:${o.id}`,
        relatedEntityType: 'dt_order',
        relatedEntityId: o.id,
        tenantId: o.tenant_id ?? undefined,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!sendJson.ok) {
      console.error('[notify-pickup-completed] send-email failed:', JSON.stringify(sendJson));
      return json({ ok: false, error: 'Email send failed', detail: sendJson }, 502);
    }

    console.log(`[notify-pickup-completed] Sent for pickup ${o.dt_identifier} (resend ${sendJson.resendEmailId ?? 'n/a'})`);

    // ── 7. Propagate pickup completion to the linked delivery row ─────────
    // Only fires when the pickup has linked_order_id (P+D pair). Standalone
    // pickups have no linked delivery to stamp. Helper is idempotent + never
    // throws, so failures here don't affect the email response we just sent.
    // The webhook path stamps linked_pickup_finished_at = now() as a
    // placeholder (DT export.xml lags the webhook); a later dt-sync-statuses
    // run replaces it with the real DT timestamp + populates driver_name.
    if (o.linked_order_id) {
      const stampRes = await stampPickupOnLinkedDelivery({
        supabase,
        pickupOrderId: o.id,
        source: 'webhook',
      });
      if (stampRes.fired) {
        console.log(
          `[notify-pickup-completed] Stamped linked delivery ${stampRes.linkedDeliveryId} for ${o.dt_identifier}: ` +
          `order-level=${stampRes.orderLevelStamped} items=${stampRes.itemsStamped}/${stampRes.itemsEligibleOnPickup}`,
        );
      } else {
        console.warn(
          `[notify-pickup-completed] Linked-delivery stamp skipped for ${o.dt_identifier}: ${stampRes.skippedReason}`,
        );
      }
    }

    return json({ ok: true });

  } catch (err) {
    console.error('[notify-pickup-completed] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
