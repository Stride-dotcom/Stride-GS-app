/**
 * dt-push-order — Supabase Edge Function (Phase 2c)
 *
 * Pushes an approved order (and its linked pickup, if any) from dt_orders
 * to DispatchTrack via `POST /orders/api/add_order`. Called by the Review
 * Queue when staff clicks "Approve & Push".
 *
 * Request:   POST { orderId: uuid }
 * Response:  { ok: boolean, dt_identifier?: string, linked_identifier?: string, error?: string }
 *
 * Phase 2c changes:
 *   • Reads `order_type` column (delivery/pickup/pickup_and_delivery/service_only).
 *   • For pickup_and_delivery: pushes BOTH the delivery and the linked pickup
 *     to DT as two separate orders, with a cross-reference note in each.
 *   • Service-only orders push with zero items (a <description>-only order).
 *
 * DT API details (confirmed by Ashok, 2026-04-17):
 *   • POST /orders/api/add_order, XML, rate limit 1000/hr per key.
 *   • Response: <success>Imported given orders!</success> on success.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface DtOrderRow {
  id: string;
  tenant_id: string | null;
  dt_identifier: string;
  is_pickup: boolean | null;
  order_type: string | null;
  linked_order_id: string | null;
  contact_name: string | null;
  contact_address: string | null;
  contact_city: string | null;
  contact_state: string | null;
  contact_zip: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  local_service_date: string | null;
  window_start_local: string | null;
  window_end_local: string | null;
  po_number: string | null;
  sidemark: string | null;
  client_reference: string | null;
  details: string | null;
  service_time_minutes: number | null;
  review_status: string | null;
  pushed_to_dt_at: string | null;
}

interface DtOrderItemRow {
  id: string;
  dt_item_code: string | null;
  description: string | null;
  quantity: number | null;
  extras: Record<string, unknown> | null;
}

function xmlEscape(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildOrderXml(order: DtOrderRow, items: DtOrderItemRow[], accountName: string, crossRefIdent?: string): string {
  const nameParts = (order.contact_name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const winStart = order.window_start_local ? order.window_start_local.slice(0, 5) : '';
  const winEnd = order.window_end_local ? order.window_end_local.slice(0, 5) : '';
  const orderType = order.order_type || (order.is_pickup ? 'pickup' : 'delivery');
  const serviceType = orderType === 'pickup' ? 'Pick Up'
    : orderType === 'pickup_and_delivery' ? 'Delivery'
    : orderType === 'service_only' ? 'Service'
    : 'Delivery';

  const itemsXml = items.map((it) => {
    const qty = Number(it.quantity) || 1;
    return `    <item>\n      <item_id>${xmlEscape(it.dt_item_code || it.id)}</item_id>\n      <description>${xmlEscape(it.description || '')}</description>\n      <quantity>${qty}</quantity>\n    </item>`;
  }).join('\n');

  // Build description with optional cross-reference note for linked pairs
  const descParts: string[] = [];
  if (crossRefIdent) {
    descParts.push(`[LINKED ORDER: ${crossRefIdent}]`);
  }
  if (orderType === 'service_only') {
    descParts.push('[SERVICE-ONLY VISIT — NO ITEMS]');
  }
  if (order.details) {
    descParts.push(order.details);
  }
  const desc = descParts.join('\n\n').replace(/]]>/g, ']]]]><![CDATA[>');

  return `<?xml version="1.0" encoding="UTF-8"?>
<orders>
  <order>
    <order_number>${xmlEscape(order.dt_identifier)}</order_number>
    <account>${xmlEscape(accountName)}</account>
    <service_type>${xmlEscape(serviceType)}</service_type>
    <customer>
      <first_name>${xmlEscape(firstName)}</first_name>
      <last_name>${xmlEscape(lastName)}</last_name>
      <address1>${xmlEscape(order.contact_address || '')}</address1>
      <city>${xmlEscape(order.contact_city || '')}</city>
      <state>${xmlEscape(order.contact_state || '')}</state>
      <zip>${xmlEscape(order.contact_zip || '')}</zip>
      <phone1>${xmlEscape(order.contact_phone || '')}</phone1>
      <email>${xmlEscape(order.contact_email || '')}</email>
    </customer>
    <request_date>${xmlEscape(order.local_service_date || '')}</request_date>
    <request_window_start_time>${xmlEscape(winStart)}</request_window_start_time>
    <request_window_end_time>${xmlEscape(winEnd)}</request_window_end_time>
    <description><![CDATA[${desc}]]></description>
    <po_number>${xmlEscape(order.po_number || '')}</po_number>
    <sidemark>${xmlEscape(order.sidemark || '')}</sidemark>
    <items>
${itemsXml}
    </items>
  </order>
</orders>`;
}

// Resolve DT account name from tenant_id. As of migration
// 20260424070000_dt_account_map_invert the map is keyed by tenant_id, so this
// is a direct lookup. Clients with no explicit mapping fall back to the
// DT_DEFAULT_ACCOUNT constant — that way the push to DispatchTrack never
// fails for "unmapped tenant", it just lands under the house account and
// operations can reconcile from there.
const DT_DEFAULT_ACCOUNT = 'STRIDE LOGISTICS';

function resolveAccountName(tenantId: string | null, acctMap: Record<string, string>): string {
  if (!tenantId) return DT_DEFAULT_ACCOUNT;
  const explicit = acctMap[tenantId];
  return (explicit && explicit.trim()) || DT_DEFAULT_ACCOUNT;
}

// Push a single order to DT. Returns {ok, body}.
async function pushSingleOrder(
  order: DtOrderRow,
  items: DtOrderItemRow[],
  accountName: string,
  postUrl: string,
  crossRefIdent?: string,
): Promise<{ ok: boolean; body: string; errMsg?: string }> {
  const xml = buildOrderXml(order, items, accountName, crossRefIdent);
  console.log(`[dt-push-order] POST order=${order.dt_identifier} type=${order.order_type || 'delivery'} items=${items.length}${crossRefIdent ? ` crossRef=${crossRefIdent}` : ''}`);
  try {
    const resp = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });
    const body = await resp.text();
    const isSuccess = /<success>/i.test(body) && resp.ok;
    if (!isSuccess) {
      const errMatch = body.match(/<error[^>]*>([\s\S]*?)<\/error>/i) || body.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
      const errMsg = errMatch ? errMatch[1].trim() : `HTTP ${resp.status}: ${body.slice(0, 300)}`;
      return { ok: false, body, errMsg };
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, body: '', errMsg: `Network error: ${(err as Error).message}` };
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let orderId: string;
  try {
    const body = await req.json();
    orderId = body.orderId;
    if (!orderId) throw new Error('orderId required');
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── 1. Fetch primary order ────────────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('dt_orders')
    .select('id, tenant_id, dt_identifier, is_pickup, order_type, linked_order_id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_email, local_service_date, window_start_local, window_end_local, po_number, sidemark, client_reference, details, service_time_minutes, review_status, pushed_to_dt_at')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ ok: false, error: `Order not found: ${orderErr?.message || 'unknown'}` }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const orderTyped = order as DtOrderRow;
  const orderType = orderTyped.order_type || (orderTyped.is_pickup ? 'pickup' : 'delivery');

  // ── 2. Fetch items for primary order ──────────────────────────────────
  const { data: items, error: itemsErr } = await supabase
    .from('dt_order_items')
    .select('id, dt_item_code, description, quantity, extras')
    .eq('dt_order_id', orderId);

  if (itemsErr) {
    return new Response(JSON.stringify({ ok: false, error: `Items fetch failed: ${itemsErr.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const itemsTyped = (items || []) as DtOrderItemRow[];
  // service_only is allowed to have no items. All other types require at least one.
  if (itemsTyped.length === 0 && orderType !== 'service_only') {
    return new Response(JSON.stringify({ ok: false, error: 'Order has no items — cannot push to DT' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ── 3. Fetch DT credentials + resolve account name ────────────────────
  const { data: creds, error: credsErr } = await supabase
    .from('dt_credentials')
    .select('api_base_url, auth_token_encrypted, account_name_map')
    .maybeSingle();

  if (credsErr || !creds) {
    return new Response(JSON.stringify({ ok: false, error: 'DT credentials not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const apiKey = creds.auth_token_encrypted as string;
  const baseUrl = (creds.api_base_url as string || 'https://expressinstallation.dispatchtrack.com').replace(/\/$/, '');
  const acctMap = (creds.account_name_map || {}) as Record<string, string>;
  const accountName = resolveAccountName(orderTyped.tenant_id, acctMap);
  // resolveAccountName is guaranteed non-empty (falls back to DT_DEFAULT_ACCOUNT),
  // so we no longer error out on missing mapping — the house account absorbs
  // anything unmapped and operators can reassign in DT's UI if needed.

  const postUrl = `${baseUrl}/orders/api/add_order?code=expressinstallation&api_key=${encodeURIComponent(apiKey)}`;

  // ── 4. Handle linked pickup (for pickup_and_delivery orders) ──────────
  // If this order is a delivery leg of a pickup_and_delivery pair AND the
  // pickup hasn't been pushed yet, push the pickup first.
  let linkedPushedIdentifier: string | undefined;

  if (orderType === 'pickup_and_delivery' && orderTyped.linked_order_id) {
    // Fetch the linked pickup order
    const { data: linkedOrder, error: linkedErr } = await supabase
      .from('dt_orders')
      .select('id, tenant_id, dt_identifier, is_pickup, order_type, linked_order_id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_email, local_service_date, window_start_local, window_end_local, po_number, sidemark, client_reference, details, service_time_minutes, review_status, pushed_to_dt_at')
      .eq('id', orderTyped.linked_order_id)
      .maybeSingle();

    if (!linkedErr && linkedOrder) {
      const linkedTyped = linkedOrder as DtOrderRow;
      // Only push if not already pushed
      if (!linkedTyped.pushed_to_dt_at) {
        const { data: linkedItems } = await supabase
          .from('dt_order_items')
          .select('id, dt_item_code, description, quantity, extras')
          .eq('dt_order_id', linkedTyped.id);
        const linkedItemsTyped = (linkedItems || []) as DtOrderItemRow[];

        const linkedPush = await pushSingleOrder(
          linkedTyped, linkedItemsTyped, accountName, postUrl,
          orderTyped.dt_identifier, // cross-ref points to the delivery
        );

        if (!linkedPush.ok) {
          return new Response(JSON.stringify({
            ok: false,
            error: `Linked pickup push failed: ${linkedPush.errMsg}`,
            responseBody: linkedPush.body.slice(0, 500),
          }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        await supabase
          .from('dt_orders')
          .update({
            pushed_to_dt_at: new Date().toISOString(),
            source: 'app',
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', linkedTyped.id);

        linkedPushedIdentifier = linkedTyped.dt_identifier;
      } else {
        linkedPushedIdentifier = linkedTyped.dt_identifier;
      }
    }
  }

  // ── 5. Push the primary (delivery/pickup/service) order ───────────────
  const primaryPush = await pushSingleOrder(
    orderTyped, itemsTyped, accountName, postUrl,
    linkedPushedIdentifier, // include cross-ref if we pushed a linked pickup
  );

  if (!primaryPush.ok) {
    console.error(`[dt-push-order] DT rejected primary order=${orderTyped.dt_identifier}: ${primaryPush.errMsg}`);
    return new Response(JSON.stringify({
      ok: false,
      error: `DT API error: ${primaryPush.errMsg}`,
      responseBody: primaryPush.body.slice(0, 500),
      linked_identifier: linkedPushedIdentifier,  // caller knows pickup may have already pushed
    }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ── 6. Update pushed_to_dt_at for primary ─────────────────────────────
  const { error: updateErr } = await supabase
    .from('dt_orders')
    .update({
      pushed_to_dt_at: new Date().toISOString(),
      source: 'app',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (updateErr) console.warn(`[dt-push-order] DT push ok but local update failed: ${updateErr.message}`);

  console.log(`[dt-push-order] Success order=${orderTyped.dt_identifier}${linkedPushedIdentifier ? ` + linked=${linkedPushedIdentifier}` : ''}`);
  return new Response(JSON.stringify({
    ok: true,
    dt_identifier: orderTyped.dt_identifier,
    linked_identifier: linkedPushedIdentifier,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
