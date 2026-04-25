/**
 * dt-push-order — Supabase Edge Function (Phase 2c) — v15 2026-04-25 PST
 * v15: Driver-facing <notes> block now falls back to dt_orders.details
 *      when order_notes is empty. Previously the modal's "Notes /
 *      Special Instructions" field wrote only to details, which
 *      surfaced in DT's dispatcher description but never reached
 *      the driver app's notes pane. With this fallback the same
 *      text appears in both views.
 * v14: Coverage now itemized in the <description> billing summary so the
 *      DT dispatcher sees what valuation the customer paid for. Reads
 *      coverage_option_id, coverage_charge, declared_value from
 *      dt_orders + joins coverage_options.name. Always shown when an
 *      option is selected (free Standard renders as "Included").
 * v13: Fee label in description now reads from order_type (not the legacy
 *      is_pickup boolean) so pickup-leg fees label correctly when the row
 *      was created via the new order_type pipeline. CDATA escaping is
 *      centralized in cdataEscape() instead of being repeated inline.
 *      Top-level error path no longer leaks stack traces to the response
 *      body — stack is logged only.
 * v12: Added <service_time> XML tag + paid status in description
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
  contact_phone2: string | null;
  contact_email: string | null;
  local_service_date: string | null;
  window_start_local: string | null;
  window_end_local: string | null;
  po_number: string | null;
  sidemark: string | null;
  client_reference: string | null;
  details: string | null;
  order_notes: string | null;
  service_time_minutes: number | null;
  review_status: string | null;
  pushed_to_dt_at: string | null;
  billing_method: string | null;
  order_total: number | null;
  base_delivery_fee: number | null;
  extra_items_count: number | null;
  extra_items_fee: number | null;
  accessorials_json: { code: string; quantity: number; rate: number; subtotal: number }[] | null;
  accessorials_total: number | null;
  // Valuation coverage — itemized in the description so the dispatcher
  // sees what the customer paid for. coverage_name comes from a join
  // server-side OR is left undefined here (description falls back to
  // "Coverage" label).
  coverage_option_id: string | null;
  coverage_charge: number | null;
  declared_value: number | null;
  coverage_name?: string;
  billing_review_status: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  paid_method: string | null;
}

interface DtOrderItemRow {
  id: string;
  dt_item_code: string | null;
  description: string | null;
  quantity: number | null;
  vendor: string | null;
  class_name: string | null;
  cubic_feet: number | null;
  extras: Record<string, unknown> | null;
}

function xmlEscape(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Escape any "]]>" sequences inside text that will sit between <![CDATA[ ... ]]>.
// "]]>" is the only sequence that prematurely terminates a CDATA section, so we
// split it across two CDATA sections to keep the payload literal-safe.
function cdataEscape(val: string): string {
  return val.replace(/]]>/g, ']]]]><![CDATA[>');
}

// Build a rich item description: "Vendor | Description | SM: Sidemark | Ref: Reference"
// For pickup legs, prefix with "PICK UP: "
function buildItemDesc(it: DtOrderItemRow, isPickupLeg: boolean, sidemark?: string, reference?: string): string {
  const parts: string[] = [];
  if (it.vendor) parts.push(it.vendor);
  if (it.description) parts.push(it.description);
  if (sidemark) parts.push(`SM: ${sidemark}`);
  if (reference) parts.push(`Ref: ${reference}`);
  const base = parts.join(' | ') || it.description || '';
  return isPickupLeg ? `PICK UP: ${base}` : base;
}

// Build the DT order description with billing info
function buildOrderDescription(
  order: DtOrderRow,
  accountName: string,
  crossRefIdent?: string,
  linkedDeliveryInfo?: { identifier: string; contactName?: string; address?: string; city?: string; state?: string; zip?: string },
): string {
  const orderType = order.order_type || (order.is_pickup ? 'pickup' : 'delivery');
  const descParts: string[] = [];

  // For pickup legs of a pickup_and_delivery pair: show linked delivery info
  if (orderType === 'pickup' && linkedDeliveryInfo) {
    descParts.push(`LINKED DELIVERY: ${linkedDeliveryInfo.identifier}`);
    const addrParts = [linkedDeliveryInfo.contactName, linkedDeliveryInfo.address,
      [linkedDeliveryInfo.city, linkedDeliveryInfo.state, linkedDeliveryInfo.zip].filter(Boolean).join(' ')
    ].filter(Boolean).join(', ');
    if (addrParts) descParts.push(`Deliver to: ${addrParts}`);
    descParts.push('');
    descParts.push(`Bill To: ${accountName}`);
    descParts.push('Charges Summary:');
    descParts.push('(no charges — billed on delivery leg)');
  } else {
    // Cross-reference for linked orders
    if (crossRefIdent) {
      descParts.push(`[LINKED ORDER: ${crossRefIdent}]`);
    }
    if (orderType === 'service_only') {
      descParts.push('[SERVICE-ONLY VISIT — NO ITEMS]');
    }

    // Billing info
    const billTo = order.billing_method === 'customer_collect'
      ? 'Collect from Customer'
      : `${accountName}`;
    descParts.push(`Bill To: ${billTo}`);
    descParts.push('Charges Summary:');

    // Itemized charges
    if (order.base_delivery_fee != null && order.base_delivery_fee > 0) {
      // Drive the label from order_type so rows created via the new pipeline
      // (which leaves is_pickup unset) still label pickup fees correctly.
      const feeLabel = orderType === 'pickup' ? 'Pickup' : 'Delivery';
      descParts.push(`${feeLabel} = $${Number(order.base_delivery_fee).toFixed(2)}`);
    }
    if (order.extra_items_fee != null && order.extra_items_fee > 0) {
      descParts.push(`Extra Items (${order.extra_items_count || 0}) = $${Number(order.extra_items_fee).toFixed(2)}`);
    }
    if (order.accessorials_json && Array.isArray(order.accessorials_json)) {
      for (const acc of order.accessorials_json) {
        descParts.push(`${acc.code}${acc.quantity > 1 ? ` x${acc.quantity}` : ''} = $${Number(acc.subtotal).toFixed(2)}`);
      }
    }
    // Valuation coverage — itemize alongside the other charges so the DT
    // dispatcher sees what the customer is paying for. Always shown when
    // the order has a coverage selection on file (even free Standard at
    // $0 — explicit confirmation that valuation is accounted for).
    if (order.coverage_option_id || order.coverage_charge != null) {
      const cvName = (order as DtOrderRow & { coverage_name?: string }).coverage_name || 'Coverage';
      const cvCharge = order.coverage_charge != null ? Number(order.coverage_charge) : 0;
      const dv = (order as DtOrderRow & { declared_value?: number | null }).declared_value;
      const dvSuffix = dv != null && Number(dv) > 0 ? ` (declared $${Number(dv).toLocaleString()})` : '';
      descParts.push(`Coverage: ${cvName}${dvSuffix} = ${cvCharge > 0 ? `$${cvCharge.toFixed(2)}` : 'Included'}`);
    }
    if (order.order_total != null) {
      descParts.push(`Total = $${Number(order.order_total).toFixed(2)}`);
    }
  }

  // Append paid status if collected during order entry
  if (order.paid_at && order.paid_amount != null) {
    const paidDate = new Date(order.paid_at);
    const mm = String(paidDate.getMonth() + 1).padStart(2, '0');
    const dd = String(paidDate.getDate()).padStart(2, '0');
    const yyyy = paidDate.getFullYear();
    const method = order.paid_method || 'Stax';
    descParts.push(`[PAID via ${method} — $${Number(order.paid_amount).toFixed(2)} collected ${mm}/${dd}/${yyyy}]`);
  }

  // Append any user-entered details
  if (order.details) {
    descParts.push('');
    descParts.push(order.details);
  }

  return cdataEscape(descParts.join('\n'));
}

function buildOrderXml(
  order: DtOrderRow,
  items: DtOrderItemRow[],
  accountName: string,
  crossRefIdent?: string,
  linkedDeliveryInfo?: { identifier: string; contactName?: string; address?: string; city?: string; state?: string; zip?: string },
): string {
  const nameParts = (order.contact_name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const winStart = order.window_start_local ? order.window_start_local.slice(0, 5) : '';
  const winEnd = order.window_end_local ? order.window_end_local.slice(0, 5) : '';
  const orderType = order.order_type || (order.is_pickup ? 'pickup' : 'delivery');
  const serviceType = orderType === 'pickup' ? 'Pickup'
    : orderType === 'pickup_and_delivery' ? 'Delivery'
    : orderType === 'service_only' ? 'Service'
    : 'Delivery';

  const isPickupLeg = orderType === 'pickup';

  const itemsXml = items.map((it) => {
    const qty = Math.abs(Number(it.quantity) || 1);
    const desc = buildItemDesc(it, isPickupLeg, order.sidemark || undefined, order.client_reference || undefined);
    const cubeVal = it.cubic_feet != null ? `\n      <cube>${it.cubic_feet}</cube>` : '';
    return `    <item>\n      <item_id>${xmlEscape(it.dt_item_code || it.id)}</item_id>\n      <description>${xmlEscape(desc)}</description>\n      <quantity>${qty}</quantity>${cubeVal}\n    </item>`;
  }).join('\n');

  const desc = buildOrderDescription(order, accountName, crossRefIdent, linkedDeliveryInfo);

  // Build notes XML. dt_orders has two free-text columns; both surface to DT:
  //   • details      → operator-facing detail text. Mirrored into the
  //                    <description> CDATA block so it shows on DT's
  //                    primary dispatcher view.
  //   • order_notes  → driver-facing public notes. Pushed as <notes>/<note>
  //                    with note_type="Public" so they render in the DT
  //                    driver app's notes pane.
  // The order modal currently only writes to `details`. To make sure the
  // driver still sees those instructions, we fall back to `details` when
  // `order_notes` is empty — same text ends up in both views.
  const driverNotes = order.order_notes || order.details || '';
  const notesXml = driverNotes ? `\n    <notes count="1">\n      <note created_at="${new Date().toISOString()}" author="StrideApp" note_type="Public">\n        <![CDATA[${cdataEscape(driverNotes)}]]>\n      </note>\n    </notes>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<service_orders>
  <service_order>
    <number>${xmlEscape(order.dt_identifier)}</number>
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
      <phone2>${xmlEscape(order.contact_phone2 || '')}</phone2>
      <email>${xmlEscape(order.contact_email || '')}</email>
    </customer>
    <delivery_date>${xmlEscape(order.local_service_date || '')}</delivery_date>
    <request_time_window_start>${xmlEscape(winStart)}</request_time_window_start>
    <request_time_window_end>${xmlEscape(winEnd)}</request_time_window_end>
    <description><![CDATA[${desc}]]></description>
    <amount>${order.order_total != null ? Number(order.order_total).toFixed(2) : '0.00'}</amount>${order.service_time_minutes != null && order.service_time_minutes > 0 ? `\n    <service_time>${order.service_time_minutes}</service_time>` : ''}
    <items>
${itemsXml}
    </items>${notesXml}
  </service_order>
</service_orders>`;
}

// Resolve DT account name from tenant_id (direct lookup in account_name_map: {sheetId → accountName})
function resolveAccountName(tenantId: string | null, acctMap: Record<string, string>): string {
  if (!tenantId) return '';
  return acctMap[tenantId] || '';
}

// Push a single order to DT. Returns {ok, body}.
async function pushSingleOrder(
  order: DtOrderRow,
  items: DtOrderItemRow[],
  accountName: string,
  postUrl: string,
  crossRefIdent?: string,
  linkedDeliveryInfo?: { identifier: string; contactName?: string; address?: string; city?: string; state?: string; zip?: string },
): Promise<{ ok: boolean; body: string; errMsg?: string }> {
  const xml = buildOrderXml(order, items, accountName, crossRefIdent, linkedDeliveryInfo);
  console.log(`[dt-push-order] POST order=${order.dt_identifier} type=${order.order_type || 'delivery'} items=${items.length} account=${accountName}${crossRefIdent ? ` crossRef=${crossRefIdent}` : ''}`);
  console.log(`[dt-push-order] XML payload:\n${xml.slice(0, 800)}`);
  try {
    // DT API expects XML as a form-encoded "data" parameter (per API docs v8.1)
    const formBody = `data=${encodeURIComponent(xml)}`;
    const resp = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
    const body = await resp.text();
    console.log(`[dt-push-order] DT response status=${resp.status} body=${body.slice(0, 500)}`);
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

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let orderId: string;
  try {
    const body = await req.json();
    orderId = body.orderId;
    if (!orderId) throw new Error('orderId required');
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 400);
  }

  try { // Top-level catch — any unhandled error returns 500 with details

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── 1. Fetch primary order ────────────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('dt_orders')
    .select('id, tenant_id, dt_identifier, is_pickup, order_type, linked_order_id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email, local_service_date, window_start_local, window_end_local, po_number, sidemark, client_reference, details, order_notes, service_time_minutes, review_status, pushed_to_dt_at, billing_method, order_total, base_delivery_fee, extra_items_count, extra_items_fee, accessorials_json, accessorials_total, coverage_option_id, coverage_charge, declared_value, billing_review_status, paid_at, paid_amount, paid_method')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ ok: false, error: `Order not found: ${orderErr?.message || 'unknown'}` }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const orderTyped = order as DtOrderRow;

  // Resolve coverage option name for the description (separate fetch
  // because the FK isn't a PostgREST embedded relation in the cached
  // schema). Best-effort — if it fails, the description falls back to
  // the literal "Coverage" label.
  if (orderTyped.coverage_option_id) {
    try {
      const { data: cv } = await supabase
        .from('coverage_options')
        .select('name')
        .eq('id', orderTyped.coverage_option_id)
        .maybeSingle();
      if (cv && (cv as { name?: string }).name) orderTyped.coverage_name = (cv as { name?: string }).name;
    } catch (_) { /* leave coverage_name undefined → "Coverage" fallback */ }
  }
  const orderType = orderTyped.order_type || (orderTyped.is_pickup ? 'pickup' : 'delivery');

  // ── 2. Fetch items for primary order ──────────────────────────────────
  const { data: items, error: itemsErr } = await supabase
    .from('dt_order_items')
    .select('id, dt_item_code, description, quantity, vendor, class_name, cubic_feet, extras')
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

  if (!accountName) {
    return new Response(JSON.stringify({ ok: false, error: `No DT account mapped for tenant_id "${orderTyped.tenant_id}". Add an entry to dt_credentials.account_name_map.` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const postUrl = `${baseUrl}/orders/api/add_order?code=expressinstallation&api_key=${encodeURIComponent(apiKey)}`;

  // ── 4. Handle linked pickup (for pickup_and_delivery orders) ──────────
  // If this order is a delivery leg of a pickup_and_delivery pair AND the
  // pickup hasn't been pushed yet, push the pickup first.
  let linkedPushedIdentifier: string | undefined;

  if (orderType === 'pickup_and_delivery' && orderTyped.linked_order_id) {
    // Fetch the linked pickup order
    const { data: linkedOrder, error: linkedErr } = await supabase
      .from('dt_orders')
      .select('id, tenant_id, dt_identifier, is_pickup, order_type, linked_order_id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email, local_service_date, window_start_local, window_end_local, po_number, sidemark, client_reference, details, order_notes, service_time_minutes, review_status, pushed_to_dt_at, billing_method, order_total, base_delivery_fee, extra_items_count, extra_items_fee, accessorials_json, accessorials_total, billing_review_status, paid_at, paid_amount, paid_method')
      .eq('id', orderTyped.linked_order_id)
      .maybeSingle();

    if (!linkedErr && linkedOrder) {
      const linkedTyped = linkedOrder as DtOrderRow;
      // Only push if not already pushed
      if (!linkedTyped.pushed_to_dt_at) {
        const { data: linkedItems } = await supabase
          .from('dt_order_items')
          .select('id, dt_item_code, description, quantity, vendor, class_name, cubic_feet, extras')
          .eq('dt_order_id', linkedTyped.id);
        const linkedItemsTyped = (linkedItems || []) as DtOrderItemRow[];

        const linkedPush = await pushSingleOrder(
          linkedTyped, linkedItemsTyped, accountName, postUrl,
          orderTyped.dt_identifier, // cross-ref points to the delivery
          { // delivery info for the pickup leg's description
            identifier: orderTyped.dt_identifier,
            contactName: orderTyped.contact_name || undefined,
            address: orderTyped.contact_address || undefined,
            city: orderTyped.contact_city || undefined,
            state: orderTyped.contact_state || undefined,
            zip: orderTyped.contact_zip || undefined,
          },
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
  return json({
    ok: true,
    dt_identifier: orderTyped.dt_identifier,
    linked_identifier: linkedPushedIdentifier,
  });

  } catch (unhandled) {
    // Top-level catch — ensures we always return a JSON body, never a raw 500.
    // Stack trace is logged for ops debugging but never returned to the
    // caller, since the response can be surfaced directly to client UIs.
    const err = unhandled as Error;
    console.error(`[dt-push-order] Unhandled error for orderId=${orderId}:`, err);
    if (err?.stack) console.error(`[dt-push-order] Stack:`, err.stack);
    return json({
      ok: false,
      error: 'Internal error pushing order to DispatchTrack. Check function logs for details.',
    }, 500);
  }
});
