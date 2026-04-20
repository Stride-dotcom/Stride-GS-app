/**
 * dt-push-order — Supabase Edge Function (Phase 2b)
 *
 * Pushes an approved order from `dt_orders` to DispatchTrack via
 * `POST /orders/api/add_order`. Called by the Review Queue when staff
 * clicks "Approve & Push".
 *
 * Request:   POST { orderId: uuid }
 * Response:  { ok: boolean, dt_identifier?: string, error?: string }
 *
 * Auth: This function is invoked from the authenticated React app via
 * supabase-js `functions.invoke()`. The user must have an active session
 * (RLS on dt_orders enforces staff/admin for SELECT access to the order).
 * The function uses the service-role key internally to read the order +
 * items (bypassing RLS for the subsequent writes) and to update
 * `pushed_to_dt_at`.
 *
 * DT API details (confirmed by Ashok, DT support, 2026-04-17):
 *   - Endpoint: POST /orders/api/add_order
 *   - Format: XML
 *   - Required: order_number, ship name, ship address (city/state/zip),
 *     item description + quantity
 *   - Account assignment via <account> tag
 *   - Response: <success>Imported given orders!</success> on success
 *   - Update: re-POST same order_number → updates existing order
 *   - Rate limit: 1000 calls / hour per API key
 *   - No HMAC / no event ID
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface DtOrderRow {
  id: string;
  tenant_id: string | null;
  dt_identifier: string;
  is_pickup: boolean | null;
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

// ── XML escaping for DT payload ─────────────────────────────────────────
function xmlEscape(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Build <orders><order>...</order></orders> XML payload ───────────────
function buildOrderXml(
  order: DtOrderRow,
  items: DtOrderItemRow[],
  accountName: string,
): string {
  // Split contact_name into first/last at first space (DT expects split).
  const nameParts = (order.contact_name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  // Time windows: DT accepts "HH:MM AM" or 24h. We send 24h.
  const winStart = order.window_start_local ? order.window_start_local.slice(0, 5) : '';
  const winEnd = order.window_end_local ? order.window_end_local.slice(0, 5) : '';

  const itemsXml = items.map((it) => {
    const qty = Number(it.quantity) || 1;
    return `    <item>
      <item_id>${xmlEscape(it.dt_item_code || it.id)}</item_id>
      <description>${xmlEscape(it.description || '')}</description>
      <quantity>${qty}</quantity>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<orders>
  <order>
    <order_number>${xmlEscape(order.dt_identifier)}</order_number>
    <account>${xmlEscape(accountName)}</account>
    <service_type>${order.is_pickup ? 'Pick Up' : 'Delivery'}</service_type>
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
    <description><![CDATA[${(order.details || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]></description>
    <po_number>${xmlEscape(order.po_number || '')}</po_number>
    <sidemark>${xmlEscape(order.sidemark || '')}</sidemark>
    <items>
${itemsXml}
    </items>
  </order>
</orders>`;
}

// ── Main handler ──────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Parse body
  let orderId: string;
  try {
    const body = await req.json();
    orderId = body.orderId;
    if (!orderId) throw new Error('orderId required');
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Init Supabase service-role client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── 1. Fetch order + credentials ──────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('dt_orders')
    .select(`
      id, tenant_id, dt_identifier, is_pickup,
      contact_name, contact_address, contact_city, contact_state, contact_zip,
      contact_phone, contact_email,
      local_service_date, window_start_local, window_end_local,
      po_number, sidemark, client_reference, details,
      service_time_minutes, review_status, pushed_to_dt_at
    `)
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return new Response(
      JSON.stringify({ ok: false, error: `Order not found: ${orderErr?.message || 'unknown'}` }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const orderTyped = order as DtOrderRow;

  // ── 2. Fetch items ────────────────────────────────────────────────────
  const { data: items, error: itemsErr } = await supabase
    .from('dt_order_items')
    .select('id, dt_item_code, description, quantity, extras')
    .eq('dt_order_id', orderId);

  if (itemsErr) {
    return new Response(
      JSON.stringify({ ok: false, error: `Items fetch failed: ${itemsErr.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const itemsTyped = (items || []) as DtOrderItemRow[];
  if (itemsTyped.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Order has no items — cannot push empty order to DT' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── 3. Fetch DT credentials + resolve account name ────────────────────
  const { data: creds, error: credsErr } = await supabase
    .from('dt_credentials')
    .select('api_base_url, auth_token_encrypted, account_name_map')
    .maybeSingle();

  if (credsErr || !creds) {
    return new Response(
      JSON.stringify({ ok: false, error: 'DT credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const apiKey = creds.auth_token_encrypted as string;
  const baseUrl = (creds.api_base_url as string || 'https://expressinstallation.dispatchtrack.com').replace(/\/$/, '');
  const acctMap = (creds.account_name_map || {}) as Record<string, string>;

  // Reverse lookup: tenant_id → DT account name
  let accountName = '';
  for (const [key, val] of Object.entries(acctMap)) {
    if (val === orderTyped.tenant_id) {
      accountName = key;
      break;
    }
  }

  if (!accountName) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `No DT account mapped for this client. Add an entry to dt_credentials.account_name_map for tenant_id "${orderTyped.tenant_id}".`,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── 4. Build XML + POST to DT ─────────────────────────────────────────
  const xml = buildOrderXml(orderTyped, itemsTyped, accountName);
  const postUrl = `${baseUrl}/orders/api/add_order?code=expressinstallation&api_key=${encodeURIComponent(apiKey)}`;

  console.log(`[dt-push-order] POST to ${baseUrl}/orders/api/add_order — order=${orderTyped.dt_identifier} account=${accountName} items=${itemsTyped.length}`);

  let dtResponse: Response;
  let dtBody = '';
  try {
    dtResponse = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });
    dtBody = await dtResponse.text();
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: `DT API network error: ${(err as Error).message}` }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── 5. Parse response ─────────────────────────────────────────────────
  const isSuccess = /<success>/i.test(dtBody) && dtResponse.ok;
  if (!isSuccess) {
    // Try to extract an error message from the response
    const errMatch = dtBody.match(/<error[^>]*>([\s\S]*?)<\/error>/i) || dtBody.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
    const errMsg = errMatch ? errMatch[1].trim() : `HTTP ${dtResponse.status}: ${dtBody.slice(0, 300)}`;

    console.error(`[dt-push-order] DT rejected order=${orderTyped.dt_identifier}: ${errMsg}`);

    return new Response(
      JSON.stringify({ ok: false, error: `DT API error: ${errMsg}`, responseBody: dtBody.slice(0, 500) }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── 6. Update pushed_to_dt_at + source ────────────────────────────────
  const { error: updateErr } = await supabase
    .from('dt_orders')
    .update({
      pushed_to_dt_at: new Date().toISOString(),
      source: 'app',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (updateErr) {
    console.warn(`[dt-push-order] DT push succeeded but local update failed: ${updateErr.message}`);
  }

  console.log(`[dt-push-order] Success — order=${orderTyped.dt_identifier} pushed to DT`);

  return new Response(
    JSON.stringify({ ok: true, dt_identifier: orderTyped.dt_identifier }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
