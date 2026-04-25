/**
 * dt-webhook-ingest — Supabase Edge Function
 *
 * Version: v5 (2026-04-25 PST)
 *   v5: Fuzzy account-name lookup now requires exactly one match — ambiguous
 *       hits (>1) quarantine instead of binding to the first row, preventing
 *       cross-tenant data writes. parseTimeStr now accepts "HH:MM AM/PM" in
 *       addition to 24h format. local_service_date is validated to YYYY-MM-DD
 *       before being written to the date column (unparseable strings are
 *       skipped rather than written raw).
 *   v4: Body parsing now honors Content-Type — JSON bodies are JSON.parsed,
 *       everything else falls back to x-www-form-urlencoded (previous
 *       versions silently produced an empty payload for JSON). Fuzzy
 *       account-name lookup now escapes ILIKE wildcards (%, _, \) so
 *       account names containing those characters no longer over-match.
 *       Retry-on-duplicate now distinguishes "already processed" (ack as
 *       duplicate, current behavior) from "previously failed" (clear the
 *       processing_error and retry the upsert) — fixes the case where a
 *       transient dt_orders error left the row stuck because DT's retry
 *       hit the idempotency key and was acked without re-running.
 *   v3: Corrected ALERT_TYPE_TO_STATUS_ID to match dt_statuses seed
 *       (Started=2, In_Transit=13, Unable_To_Start=4, Unable_To_Finish=5,
 *        Service_Route_Finished=3). Added auto-Collected transition
 *       (status 22) when Service_Route_Finished arrives on an already-paid
 *       order, with proper error handling on the update. Added error
 *       handling on quarantine insert and final mark-processed update.
 *   v2: Confirmed DT tag names (Customer_Name, Customer_Address,
 *       Customer_Primary_Phone, Customer_Email, Note); removed dead
 *       Pictures-URL handling (DT does not send photo URLs in webhooks).
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

// ── dt_statuses.id constants (must mirror dt_statuses seed) ──────────────
// 0=Pushed to DT, 1=Scheduled, 2=Started, 3=Completed, 4=Unable to Start,
// 5=Unable to Finish, 10=Pending Review, 11=Rejected, 12=Push Failed,
// 13=In Transit, 20=Billing Review, 21=In Ledger, 22=Collected.
const STATUS_COMPLETED = 3;
const STATUS_COLLECTED = 22;

// ── DT Alert_Type → dt_statuses.id map ───────────────────────────────────
const ALERT_TYPE_TO_STATUS_ID: Record<string, number> = {
  'Started':                2,                  // in_progress  (Started)
  'In_Transit':             13,                 // in_progress  (In Transit)
  'Unable_To_Start':        4,                  // exception    (Unable to Start)
  'Unable_To_Finish':       5,                  // exception    (Unable to Finish)
  'Service_Route_Finished': STATUS_COMPLETED,   // completed    (Completed)
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

/** Parse a DT time string into a Postgres time literal.
 *  Accepts "HH:MM" / "HH:MM:SS" (24h) or "HH:MM AM/PM" (12h).
 *  Unknown formats return null and the caller stores nothing for that field. */
function parseTimeStr(val: string | undefined): string | null {
  if (!val) return null;
  const cleaned = val.trim();
  // 12h with AM/PM
  const ampm = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2];
    const period = ampm[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}:00`;
  }
  // 24h
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleaned)) {
    return cleaned.length <= 5 ? cleaned + ':00' : cleaned;
  }
  return null;
}

/** Validate/normalize a service-date string to YYYY-MM-DD. Returns null when
 *  the input doesn't contain a parseable date — prevents writing raw DT
 *  strings (e.g. "Tuesday, April 16") into a date column. */
function parseServiceDate(val: string | undefined): string | null {
  if (!val) return null;
  const m = val.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  // Sanity check the components actually form a real date
  const yyyy = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const dd = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Safely coerce a string to an integer or null */
function toInt(val: string | undefined): number | null {
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

/** Escape PostgREST/PostgreSQL ILIKE wildcards so user input matches literally */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
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

  // ── 4. Parse body — JSON if Content-Type says so, else form-urlencoded ─
  // DT sends application/x-www-form-urlencoded today, but if the integration
  // ever flips to JSON we don't want to silently produce an empty payload.
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
  const payload: Record<string, string> = {};
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
          if (val == null) continue;
          payload[key] = typeof val === 'string' ? val : String(val);
        }
      } else {
        console.warn('[dt-webhook-ingest] JSON body was not a plain object — ignoring');
      }
    } catch (e) {
      console.warn(
        '[dt-webhook-ingest] Content-Type: application/json but JSON.parse failed:',
        (e as Error).message
      );
    }
  } else {
    const params = new URLSearchParams(rawBody);
    for (const [key, val] of params.entries()) {
      payload[key] = val;
    }
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
    // UNIQUE violation on idempotency_key → either a real duplicate delivery
    // (already processed; safe to ack) or a retry of a previously-failed
    // attempt (processed=false; we should re-run the pipeline).
    if (eventInsertErr.code === '23505') {
      const { data: existing, error: lookupErr } = await supabase
        .from('dt_webhook_events')
        .select('processed, processing_error')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (lookupErr) {
        console.error(
          '[dt-webhook-ingest] Idempotency conflict lookup failed:',
          lookupErr.message
        );
        return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
      }

      if (existing?.processed) {
        console.log('[dt-webhook-ingest] Duplicate event already processed — acking');
        return new Response(
          JSON.stringify({ ok: true, duplicate: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Previously-failed attempt — clear the prior error and fall through
      // to re-run the rest of the pipeline against the existing row.
      console.log(
        `[dt-webhook-ingest] Retrying previously-failed event (prior_error=${existing?.processing_error ?? 'none'})`
      );
      const { error: clearErr } = await supabase
        .from('dt_webhook_events')
        .update({ processing_error: null })
        .eq('idempotency_key', idempotencyKey);
      if (clearErr) {
        console.warn(
          '[dt-webhook-ingest] Failed to clear prior processing_error before retry:',
          clearErr.message
        );
      }
    } else {
      console.error('[dt-webhook-ingest] Failed to insert webhook event:', eventInsertErr.message);
      return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
    }
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

  // Pass 2: fuzzy ILIKE against inventory.client_name (fallback).
  // Only accept a match when there's exactly one distinct tenant — multiple
  // hits mean the account name is ambiguous and we'd risk binding the event
  // to the wrong tenant. Quarantine instead.
  let fuzzyAmbiguous = false;
  if (!tenantId && accountName) {
    const { data: invMatches } = await supabase
      .from('inventory')
      .select('tenant_id, client_name')
      .ilike('client_name', `%${escapeLike(accountName)}%`)
      .limit(2);
    const distinctTenants = new Set(
      (invMatches ?? [])
        .map((r: { tenant_id: string | null }) => r.tenant_id)
        .filter((t): t is string => !!t)
    );
    if (distinctTenants.size === 1) {
      tenantId = [...distinctTenants][0];
      console.log(`[dt-webhook-ingest] Fuzzy-matched account="${accountName}" → tenant_id=${tenantId} via inventory`);
    } else if (distinctTenants.size > 1) {
      fuzzyAmbiguous = true;
      console.warn(`[dt-webhook-ingest] Fuzzy match for account="${accountName}" was ambiguous (${distinctTenants.size} distinct tenants) — quarantining`);
    }
  }

  // ── 7. Quarantine if unmapped ──────────────────────────────────────────
  if (!tenantId) {
    const reason = fuzzyAmbiguous
      ? `ambiguous_fuzzy_match:${accountName}`
      : `unmapped_account:${accountName}`;
    console.warn(`[dt-webhook-ingest] ${reason} — quarantining`);
    const { error: quarantineErr } = await supabase.from('dt_orders_quarantine').insert({
      received_at:    receivedAt,
      dt_identifier:  dtIdentifier,
      dt_dispatch_id: dtDispatchId,
      raw_payload:    payload,
      mapping_hint:   { account_name: accountName, event_type: eventType, reason },
    });
    if (quarantineErr) {
      console.error('[dt-webhook-ingest] Quarantine insert error:', quarantineErr.message);
    }
    // Mark the webhook event with the mapping failure
    const { error: markErr } = await supabase
      .from('dt_webhook_events')
      .update({ processing_error: reason, processed: false })
      .eq('idempotency_key', idempotencyKey);
    if (markErr) {
      console.warn('[dt-webhook-ingest] Failed to mark event with mapping error:', markErr.message);
    }

    return new Response(
      JSON.stringify({ ok: true, quarantined: true, account: accountName, reason }),
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

  // Contact fields — CONFIRMED from DT Admin → Alerts → Started → Email template:
  //   {{Customer_Name}}, {{Customer_Address}}, {{Customer_Primary_Phone}},
  //   {{Customer_Secondary_Phone}}, {{Customer_Email}}
  // Note: Customer_Address is a combined string (no separate city/state/zip tags confirmed).
  // We parse city/state/zip from it if possible; otherwise store full address in contact_address.
  const custName    = payload['Customer_Name']    ?? payload['customer_name'];
  const custAddress = payload['Customer_Address'] ?? payload['customer_address'];
  const custPhone   = payload['Customer_Primary_Phone'] ?? payload['customer_phone'] ?? payload['Customer_Phone'];
  const custEmail   = payload['Customer_Email']   ?? payload['customer_email'];

  if (custName)    orderUpsert.contact_name    = custName;
  if (custAddress) orderUpsert.contact_address = custAddress;
  if (custPhone)   orderUpsert.contact_phone   = custPhone;
  if (custEmail)   orderUpsert.contact_email   = custEmail;

  // If DT sends separate city/state/zip tags (not confirmed yet — check first webhook payload):
  const custCity  = payload['Customer_City']  ?? payload['customer_city'];
  const custState = payload['Customer_State'] ?? payload['customer_state'];
  const custZip   = payload['Customer_Zip']   ?? payload['customer_zip'];
  if (custCity)  orderUpsert.contact_city  = custCity;
  if (custState) orderUpsert.contact_state = custState;
  if (custZip)   orderUpsert.contact_zip   = custZip;

  // Date / time window — tag names not yet confirmed from DT Admin Available Tags.
  // Common DT conventions tried; inspect first webhook payload JSONB to confirm.
  // local_service_date is a date column — validate before writing so a raw DT
  // string (e.g. "Tuesday, April 16") doesn't blow up the upsert.
  const serviceDateRaw = payload['Service_Date'] ?? payload['Requested_Date'] ?? payload['Delivery_Date'] ?? payload['service_date'];
  const serviceDate = parseServiceDate(serviceDateRaw);
  if (serviceDate) {
    orderUpsert.local_service_date = serviceDate;
  } else if (serviceDateRaw) {
    console.warn(`[dt-webhook-ingest] Unparseable service date "${serviceDateRaw}" — skipping local_service_date`);
  }

  const winStart = parseTimeStr(payload['Time_From'] ?? payload['Start_Time'] ?? payload['Window_Start'] ?? payload['window_start']);
  const winEnd   = parseTimeStr(payload['Time_To']   ?? payload['End_Time']   ?? payload['Window_End']   ?? payload['window_end']);
  if (winStart) orderUpsert.window_start_local = winStart;
  if (winEnd)   orderUpsert.window_end_local   = winEnd;

  // Reference fields — tag names not yet confirmed; common DT conventions tried.
  const poNum = payload['PO_Number'] ?? payload['PO'] ?? payload['po_number'];
  const sm    = payload['Sidemark']  ?? payload['sidemark'];
  const clRef = payload['Client_Reference'] ?? payload['Reference'] ?? payload['reference'];
  const det   = payload['Details']   ?? payload['details'];
  if (poNum) orderUpsert.po_number        = poNum;
  if (sm)    orderUpsert.sidemark         = sm;
  if (clRef) orderUpsert.client_reference = clRef;
  if (det)   orderUpsert.details          = det;

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

  // ── 9b. Auto-transition Completed → Collected when order is paid ──────
  // When DT reports Service_Route_Finished and the order has already been
  // marked paid in Stride (paid_at IS NOT NULL), move it directly from
  // Completed (3) to Collected (22) so the billing-review queue doesn't
  // have to chase a manual second click.
  if (eventType === 'Service_Route_Finished' && orderId) {
    const { data: paidCheck, error: paidCheckErr } = await supabase
      .from('dt_orders')
      .select('paid_at')
      .eq('id', orderId)
      .maybeSingle();
    if (paidCheckErr) {
      console.warn(
        `[dt-webhook-ingest] Auto-Collected: failed to read paid_at for order=${orderId}:`,
        paidCheckErr.message
      );
    } else if (paidCheck?.paid_at) {
      const { error: collectedErr } = await supabase
        .from('dt_orders')
        .update({ status_id: STATUS_COLLECTED })
        .eq('id', orderId);
      if (collectedErr) {
        console.error(
          `[dt-webhook-ingest] Auto-Collected update failed for order=${orderId} (${dtIdentifier}):`,
          collectedErr.message
        );
      } else {
        console.log(
          `[dt-webhook-ingest] Auto-marked order=${orderId} (${dtIdentifier}) as Collected (completed + paid)`
        );
      }
    }
  }

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
  // NOTE (confirmed by DT support 2026-04-16): Image/photo URLs are NOT
  // included in webhook alerts. Photos must be fetched via the Export API
  // in a separate polling job (Phase 2). The Pictures event fires to notify
  // that a photo was added, but the payload contains no URL. We log the
  // event (already stored in dt_webhook_events) but don't insert dt_order_photos.
  if (eventType === 'Pictures' && orderId) {
    console.log(`[dt-webhook-ingest] Pictures event for order=${dtIdentifier} — no photo URLs in webhook (use Export API)`);
  }

  // ── 12. Mark event processed ───────────────────────────────────────────
  const { error: processedErr } = await supabase
    .from('dt_webhook_events')
    .update({
      processed:    true,
      processed_at: receivedAt,
      tenant_id:    tenantId,
    })
    .eq('idempotency_key', idempotencyKey);
  if (processedErr) {
    console.warn('[dt-webhook-ingest] Failed to mark event processed:', processedErr.message);
  }

  console.log(`[dt-webhook-ingest] Done — order=${dtIdentifier} tenant=${tenantId} orderId=${orderId}`);

  return new Response(
    JSON.stringify({ ok: true, dt_identifier: dtIdentifier, order_id: orderId }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
