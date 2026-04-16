/**
 * dt-webhook-ingest — Supabase Edge Function
 *
 * Receives real-time order event POSTs from DispatchTrack, validates the
 * shared-secret token, persists the raw event to dt_webhook_events, resolves
 * the DT account name to a Stride tenant_id, then upserts to dt_orders (or
 * quarantines if the account cannot be mapped).
 *
 * Auth:   Shared-secret token in URL query param: ?token=<WEBHOOK_SECRET>
 *         Secret is stored in dt_credentials.webhook_secret
 *
 * Payload: DT sends application/x-www-form-urlencoded body where each key is
 *          the tag name (e.g. "Alert_Type", "Account", "Service_Order_Number")
 *          and the value is the resolved tag value from DT's template.
 *
 * Event types (Alert_Type values confirmed from DT Admin console):
 *   Started, Unable_To_Start, Unable_To_Finish, In_Transit,
 *   Notes, Pictures, Service_Route_Finished
 *
 * Deployment:
 *   supabase functions deploy dt-webhook-ingest --project-ref uqplppugeickmamycpuz
 *
 * Env vars injected by Supabase automatically:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── DT status → dt_statuses.id map (mirrors Phase 1a seed) ───────────────
const ALERT_TYPE_TO_STATUS_ID: Record<string, number> = {
  'Started':               1,  // in_transit
  'In_Transit':            1,  // in_transit
  'Unable_To_Start':       8,  // exception
  'Unable_To_Finish':      8,  // exception
  'Service_Route_Finished': 7, // arrived
  // 'Notes' and 'Pictures' events don't change status — no entry here
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** SHA-256 hex of a string — used as idempotency key */
async function sha256hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Parse a DT time string "HH:MM" or "HH:MM:SS" into a Postgres time literal */
function parseTimeStr(val: string | undefined): string | null {
  if (!val) return null;
  // Accept "HH:MM", "HH:MM AM", "H:MM PM", "HH:MM:SS", etc.
  // Normalise to "HH:MM:SS" for PG time column
  const cleaned = val.trim();
  // Try simple "HH:MM" or "HH:MM:SS"
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleaned)) {
    return cleaned.length <= 5 ? cleaned + ':00' : cleaned;
  }
  return null; // unknown format — let caller store null
}

/** Safely coerce a string to an integer or null */
function toInt(val: string | undefined): number | null {
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// ── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  // ── 1. Read + hash the raw body first (before consuming the stream) ────
  const rawBody = await req.text();
  const idempotencyKey = await sha256hex(rawBody);

  // ── 2. Init Supabase service-role client ───────────────────────────────
  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase     = createClient(supabaseUrl, serviceKey);

  // ── 3. Validate shared-secret token ───────────────────────────────────
  const reqUrl    = new URL(req.url);
  const token     = reqUrl.searchParams.get('token');

  const { data: creds, error: credsError } = await supabase
    .from('dt_credentials')
    .select('webhook_secret, account_name_map')
    .maybeSingle();

  if (credsError) {
    console.error('[dt-webhook-ingest] Failed to fetch dt_credentials:', credsError.message);
    return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
  }

  if (!creds || !creds.webhook_secret) {
    console.warn('[dt-webhook-ingest] No dt_credentials row or webhook_secret not configured');
    return new Response('Service Unavailable', { status: 503, headers: corsHeaders });
  }

  if (!token || token !== creds.webhook_secret) {
    console.warn('[dt-webhook-ingest] Rejected — invalid token');
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  // ── 4. Parse form-encoded body ─────────────────────────────────────────
  const params = new URLSearchParams(rawBody);
  // Flatten into a plain object for JSONB storage
  const payload: Record<string, string> = {};
  for (const [key, val] of params.entries()) {
    payload[key] = val;
  }

  const receivedAt   = new Date().toISOString();
  const eventType    = payload['Alert_Type']?.trim() ?? 'unknown';
  const accountName  = payload['Account']?.trim() ?? '';
  const dtIdentifier = payload['Service_Order_Number']?.trim() ?? '';
  const dtDispatchId = toInt(payload['dispatch_id'] ?? payload['Dispatch_ID']);

  console.log(`[dt-webhook-ingest] event=${eventType} order=${dtIdentifier} account=${accountName}`);

  // ── 5. Persist raw event with idempotency ──────────────────────────────
  const { error: eventInsertErr } = await supabase
    .from('dt_webhook_events')
    .insert({
      event_type:        eventType,
      idempotency_key:   idempotencyKey,
      payload:           payload,
      received_at:       receivedAt,
      // tenant_id resolved later; we update this row after mapping
    });

  if (eventInsertErr) {
    // UNIQUE violation on idempotency_key → duplicate delivery; safe to ack
    if (eventInsertErr.code === '23505') {
      console.log('[dt-webhook-ingest] Duplicate event (idempotency_key conflict) — acking');
      return new Response(
        JSON.stringify({ ok: true, duplicate: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.error('[dt-webhook-ingest] Failed to insert webhook event:', eventInsertErr.message);
    return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
  }

  // If there's no order number we can't do anything useful — ack and move on
  if (!dtIdentifier) {
    console.warn('[dt-webhook-ingest] No Service_Order_Number in payload — skipping order upsert');
    return new Response(
      JSON.stringify({ ok: true, skipped: 'no_order_id' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── 6. Resolve tenant_id from account name ────────────────────────────
  let tenantId: string | null = null;

  // Pass 1: exact match in account_name_map (admin-configured)
  if (creds.account_name_map && accountName) {
    const map = creds.account_name_map as Record<string, string>;
    tenantId = map[accountName] ?? map[accountName.toLowerCase()] ?? null;
  }

  // Pass 2: fuzzy ILIKE against inventory.client_name (fallback)
  if (!tenantId && accountName) {
    const { data: invMatch } = await supabase
      .from('inventory')
      .select('tenant_id, client_name')
      .ilike('client_name', `%${accountName}%`)
      .limit(1)
      .maybeSingle();
    if (invMatch?.tenant_id) {
      tenantId = invMatch.tenant_id;
      console.log(`[dt-webhook-ingest] Fuzzy-matched account="${accountName}" → tenant_id=${tenantId} via inventory`);
    }
  }

  // ── 7. Quarantine if unmapped ──────────────────────────────────────────
  if (!tenantId) {
    console.warn(`[dt-webhook-ingest] Cannot map account="${accountName}" — quarantining`);
    await supabase.from('dt_orders_quarantine').insert({
      received_at:    receivedAt,
      dt_identifier:  dtIdentifier,
      dt_dispatch_id: dtDispatchId,
      raw_payload:    payload,
      mapping_hint:   { account_name: accountName, event_type: eventType },
    });
    // Mark the webhook event with the mapping failure
    await supabase
      .from('dt_webhook_events')
      .update({ processing_error: `unmapped_account:${accountName}`, processed: false })
      .eq('idempotency_key', idempotencyKey);

    return new Response(
      JSON.stringify({ ok: true, quarantined: true, account: accountName }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ── 8. Build dt_orders upsert payload ─────────────────────────────────
  // Field names below reflect the confirmed {{Tag}} names from the DT Admin
  // console (Parameters field). Unknown tags are collected in payload JSONB
  // on dt_webhook_events for later extraction once DT confirms tag names.
  const orderUpsert: Record<string, unknown> = {
    tenant_id:      tenantId,
    dt_identifier:  dtIdentifier,
    source:         'dt_webhook',
    last_synced_at: receivedAt,
  };

  if (dtDispatchId !== null) orderUpsert.dt_dispatch_id = dtDispatchId;

  // Status from event type (not present for Notes/Pictures)
  const newStatusId = ALERT_TYPE_TO_STATUS_ID[eventType];
  if (newStatusId !== undefined) orderUpsert.status_id = newStatusId;

  // Contact fields — tag names TBD pending DT support confirmation
  // Using the most common DT webhook tag naming convention seen in v8.1 docs
  if (payload['customer_name'])    orderUpsert.contact_name    = payload['customer_name'];
  if (payload['Customer_Name'])    orderUpsert.contact_name    = payload['Customer_Name'];
  if (payload['customer_address']) orderUpsert.contact_address = payload['customer_address'];
  if (payload['Customer_Address']) orderUpsert.contact_address = payload['Customer_Address'];
  if (payload['customer_city'])    orderUpsert.contact_city    = payload['customer_city'];
  if (payload['Customer_City'])    orderUpsert.contact_city    = payload['Customer_City'];
  if (payload['customer_state'])   orderUpsert.contact_state   = payload['customer_state'];
  if (payload['Customer_State'])   orderUpsert.contact_state   = payload['Customer_State'];
  if (payload['customer_zip'])     orderUpsert.contact_zip     = payload['customer_zip'];
  if (payload['Customer_Zip'])     orderUpsert.contact_zip     = payload['Customer_Zip'];
  if (payload['customer_phone'])   orderUpsert.contact_phone   = payload['customer_phone'];
  if (payload['Customer_Phone'])   orderUpsert.contact_phone   = payload['Customer_Phone'];
  if (payload['customer_email'])   orderUpsert.contact_email   = payload['customer_email'];
  if (payload['Customer_Email'])   orderUpsert.contact_email   = payload['Customer_Email'];

  // Date / time window
  const serviceDate = payload['service_date'] ?? payload['Service_Date'] ?? payload['Delivery_Date'];
  if (serviceDate) orderUpsert.local_service_date = serviceDate;

  const winStart = parseTimeStr(payload['window_start'] ?? payload['Window_Start'] ?? payload['Time_From']);
  const winEnd   = parseTimeStr(payload['window_end']   ?? payload['Window_End']   ?? payload['Time_To']);
  if (winStart) orderUpsert.window_start_local = winStart;
  if (winEnd)   orderUpsert.window_end_local   = winEnd;

  // Reference fields
  if (payload['po_number'] ?? payload['PO_Number'])      orderUpsert.po_number       = payload['po_number'] ?? payload['PO_Number'];
  if (payload['sidemark']  ?? payload['Sidemark'])       orderUpsert.sidemark        = payload['sidemark']  ?? payload['Sidemark'];
  if (payload['reference'] ?? payload['Client_Reference']) orderUpsert.client_reference = payload['reference'] ?? payload['Client_Reference'];
  if (payload['details']   ?? payload['Details'])        orderUpsert.details         = payload['details']   ?? payload['Details'];

  // ── 9. Upsert into dt_orders ───────────────────────────────────────────
  const { data: orderRow, error: orderErr } = await supabase
    .from('dt_orders')
    .upsert(orderUpsert, {
      onConflict:        'tenant_id,dt_identifier',
      ignoreDuplicates:  false,  // always update fields
    })
    .select('id')
    .maybeSingle();

  if (orderErr) {
    console.error('[dt-webhook-ingest] dt_orders upsert error:', orderErr.message);
    await supabase
      .from('dt_webhook_events')
      .update({ processing_error: orderErr.message })
      .eq('idempotency_key', idempotencyKey);
    return new Response(
      JSON.stringify({ ok: false, error: orderErr.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const orderId = orderRow?.id ?? null;

  // ── 10. Handle Notes event ─────────────────────────────────────────────
  if (eventType === 'Notes' && orderId) {
    const noteBody = payload['Note'] ?? payload['note'] ?? payload['Driver_Note'] ?? '';
    if (noteBody) {
      const { error: noteErr } = await supabase.from('dt_order_notes').insert({
        dt_order_id:   orderId,
        body:          noteBody,
        author_type:   'driver',
        visibility:    'public',
        source:        'dt_webhook',
        created_at_dt: receivedAt,
      });
      if (noteErr) {
        console.warn('[dt-webhook-ingest] Note insert error:', noteErr.message);
      }
    }
  }

  // ── 11. Handle Pictures event ──────────────────────────────────────────
  if (eventType === 'Pictures' && orderId) {
    // DT may send multiple picture URLs; field names TBD.
    // We collect any key whose value looks like an http(s) URL.
    const photoUrls: string[] = [];
    for (const [key, val] of Object.entries(payload)) {
      if (
        (key.toLowerCase().includes('photo') ||
         key.toLowerCase().includes('picture') ||
         key.toLowerCase().includes('image') ||
         key.toLowerCase().includes('signature') ||
         key === 'Picture_URL' || key === 'photo_url') &&
        val.startsWith('http')
      ) {
        photoUrls.push(val);
      }
    }
    for (const photoUrl of photoUrls) {
      const kind = photoUrl.toLowerCase().includes('signature') ? 'signature' : 'pod';
      const { error: photoErr } = await supabase.from('dt_order_photos').insert({
        dt_order_id:      orderId,
        dt_url:           photoUrl,
        kind,
        visible_in_portal: true,
        fetch_attempts:   0,
      });
      if (photoErr) {
        console.warn('[dt-webhook-ingest] Photo insert error:', photoErr.message);
      }
    }
  }

  // ── 12. Mark event processed ───────────────────────────────────────────
  await supabase
    .from('dt_webhook_events')
    .update({
      processed:    true,
      processed_at: receivedAt,
      tenant_id:    tenantId,
    })
    .eq('idempotency_key', idempotencyKey);

  console.log(`[dt-webhook-ingest] Done — order=${dtIdentifier} tenant=${tenantId} orderId=${orderId}`);

  return new Response(
    JSON.stringify({ ok: true, dt_identifier: dtIdentifier, order_id: orderId }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
