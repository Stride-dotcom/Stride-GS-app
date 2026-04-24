/**
 * dt-backfill-orders — Supabase Edge Function
 *
 * Pulls orders from the DispatchTrack Export API for a date range and upserts
 * them into dt_orders. Used to backfill historical/upcoming orders so the
 * Orders tab has data before webhooks start flowing.
 *
 * Call via POST with JSON body:
 *   { "start_date": "2026-04-14", "end_date": "2026-04-20" }
 *
 * Auth: requires ?token= matching dt_credentials.webhook_secret (same as webhook)
 *
 * The Export API returns XML. We parse it and upsert each order.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://esm.sh/@xmldom/xmldom@0.9.8';

// ── Status mapping from DT status strings to dt_statuses.id ────────────
const STATUS_STRING_TO_ID: Record<string, number> = {
  'entered':          0,
  'in transit':       1,
  'on delivery':      2,
  'assigned':         3,
  'on delivery out':  4,
  'arrived at place': 5,
  'transfer':         6,
  'arrived':          7,
  'finished':         7,  // Finished = Arrived/Completed
  'exception':        8,
  'deleted':          9,
  'locked':           10,
  'unlocked':         11,
};

function getStatusId(statusStr: string): number | null {
  if (!statusStr) return null;
  return STATUS_STRING_TO_ID[statusStr.toLowerCase().trim()] ?? null;
}

/** Get text content of a child element by tag name */
function getEl(parent: Element, tag: string): string {
  const el = parent.getElementsByTagName(tag)[0];
  if (!el) return '';
  return (el.textContent || '').trim();
}

/** Parse "HH:MM AM/PM" or "HH:MM:SS -ZZZZ" into PG time "HH:MM:SS" */
function parseTimeStr(val: string): string | null {
  if (!val) return null;
  // "10:00 AM" format
  const ampm = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2];
    const period = ampm[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}:00`;
  }
  // "2026-04-16 10:00:00 -0700" format — extract time part
  const full = val.match(/\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2})/);
  if (full) return full[1];
  // "HH:MM:SS" or "HH:MM"
  const simple = val.match(/^(\d{1,2}:\d{2}(:\d{2})?)$/);
  if (simple) return simple[1].length <= 5 ? simple[1] + ':00' : simple[1];
  return null;
}

/** Parse "2026-04-16 10:00:00 -0700" or "2026-04-16" into "2026-04-16" */
function parseDateStr(val: string): string | null {
  if (!val) return null;
  const m = val.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Add N days to a date string */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  const reqUrl = new URL(req.url);
  const token  = reqUrl.searchParams.get('token');

  const { data: creds } = await supabase
    .from('dt_credentials')
    .select('webhook_secret, api_base_url, auth_token_encrypted, account_name_map')
    .maybeSingle();

  if (!creds?.webhook_secret || !token || token !== creds.webhook_secret) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  // ── Parse request body ─────────────────────────────────────────────────
  const body = await req.json();
  const startDate = body.start_date; // "2026-04-14"
  const endDate   = body.end_date;   // "2026-04-20"

  if (!startDate) {
    return new Response(
      JSON.stringify({ error: 'start_date required (YYYY-MM-DD)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const apiKey   = creds.auth_token_encrypted; // the DT API key
  const baseUrl  = (creds.api_base_url || 'https://expressinstallation.dispatchtrack.com').replace(/\/$/, '');
  const acctMap  = (creds.account_name_map || {}) as Record<string, string>;

  // ── Fetch orders for each date in range ────────────────────────────────
  const results = { inserted: 0, updated: 0, quarantined: 0, errors: [] as string[], dates_processed: 0 };
  let currentDate = startDate;
  const finalDate = endDate || startDate;

  while (currentDate <= finalDate) {
    results.dates_processed++;
    const exportUrl = `${baseUrl}/orders/api/export?code=expressinstallation&api_key=${apiKey}&date=${currentDate}`;
    console.log(`[dt-backfill] Fetching ${currentDate}...`);

    try {
      const resp = await fetch(exportUrl);
      if (!resp.ok) {
        results.errors.push(`${currentDate}: HTTP ${resp.status}`);
        currentDate = addDays(currentDate, 1);
        continue;
      }

      const xml = await resp.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const orders = doc.getElementsByTagName('service_order');

      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const dtIdentifier = order.getAttribute('order_number') || order.getAttribute('id') || '';
        if (!dtIdentifier) continue;

        const accountName = getEl(order, 'account');
        const statusStr   = getEl(order, 'status');

        // Resolve tenant_id. Map shape (post 20260424070000_dt_account_map_invert):
        //   { [tenantId]: dtAccountName }. Backfill receives a DT account name
        //   from the Export XML and needs the reverse — iterate values.
        let tenantId: string | null = null;
        if (accountName) {
          const target = accountName.trim();
          const targetLc = target.toLowerCase();
          for (const [tid, dtName] of Object.entries(acctMap)) {
            if (!dtName) continue;
            if (dtName === target || dtName.toLowerCase() === targetLc) {
              tenantId = tid;
              break;
            }
          }
        }

        // Customer info
        const custEl = order.getElementsByTagName('customer')[0];
        const contactName = custEl
          ? `${getEl(custEl, 'first_name')} ${getEl(custEl, 'last_name')}`.trim()
          : '';
        const contactAddress = custEl ? getEl(custEl, 'address1') : '';
        const contactCity    = custEl ? getEl(custEl, 'city') : '';
        const contactState   = custEl ? getEl(custEl, 'state') : '';
        const contactZip     = custEl ? getEl(custEl, 'zip') : '';
        const contactPhone   = custEl ? getEl(custEl, 'phone1') : '';
        const contactEmail   = custEl ? getEl(custEl, 'email') : '';
        const contactLat     = custEl ? parseFloat(getEl(custEl, 'latitude')) || null : null;
        const contactLon     = custEl ? parseFloat(getEl(custEl, 'longitude')) || null : null;

        // Date / time
        const requestDate = parseDateStr(getEl(order, 'request_date'));
        const winStartRaw = getEl(order, 'request_window_start_time') || getEl(order, 'time_window_start');
        const winEndRaw   = getEl(order, 'request_window_end_time')   || getEl(order, 'time_window_end');
        const winStart    = parseTimeStr(winStartRaw);
        const winEnd      = parseTimeStr(winEndRaw);
        const serviceTime = parseInt(getEl(order, 'service_time')) || null;

        // Description / details
        const description = getEl(order, 'description');
        const serviceType = getEl(order, 'service_type');
        const isPickup    = serviceType?.toLowerCase().includes('pick up') || false;
        const pieces      = parseInt(getEl(order, 'pieces')) || null;

        // Build upsert
        const upsertRow: Record<string, unknown> = {
          dt_identifier:       dtIdentifier,
          source:              'reconcile',
          last_synced_at:      new Date().toISOString(),
          contact_name:        contactName || null,
          contact_address:     contactAddress || null,
          contact_city:        contactCity || null,
          contact_state:       contactState || null,
          contact_zip:         contactZip || null,
          contact_phone:       contactPhone || null,
          contact_email:       contactEmail || null,
          contact_latitude:    contactLat,
          contact_longitude:   contactLon,
          local_service_date:  requestDate,
          window_start_local:  winStart,
          window_end_local:    winEnd,
          timezone:            'America/Los_Angeles',
          service_time_minutes: serviceTime,
          is_pickup:           isPickup,
          details:             description || null,
          load:                pieces,
        };

        const statusId = getStatusId(statusStr);
        if (statusId !== null) upsertRow.status_id = statusId;

        if (tenantId) {
          upsertRow.tenant_id = tenantId;
          const { data: upsertedOrder, error } = await supabase
            .from('dt_orders')
            .upsert(upsertRow, { onConflict: 'tenant_id,dt_identifier', ignoreDuplicates: false })
            .select('id')
            .maybeSingle();
          if (error) {
            results.errors.push(`${dtIdentifier}: ${error.message}`);
          } else {
            results.inserted++;

            // ── Write line items ──────────────────────────────────────
            if (upsertedOrder?.id) {
              const itemsEl = order.getElementsByTagName('items')[0];
              if (itemsEl) {
                const itemEls = itemsEl.getElementsByTagName('item');
                // Delete existing items for this order (full replace on backfill)
                await supabase.from('dt_order_items').delete().eq('dt_order_id', upsertedOrder.id);
                for (let j = 0; j < itemEls.length; j++) {
                  const item = itemEls[j];
                  const desc     = getEl(item, 'description');
                  const skuNum   = getEl(item, 'serial_number');
                  const qty      = parseFloat(getEl(item, 'quantity')) || null;
                  const delQty   = parseFloat(getEl(item, 'delivered_quantity')) || null;
                  const origQty  = qty; // DT doesn't have a separate "original" in export
                  const unitAmt  = parseFloat(getEl(item, 'amount')) || null;
                  const itemNote = getEl(item, 'notes');

                  await supabase.from('dt_order_items').insert({
                    dt_order_id:        upsertedOrder.id,
                    dt_item_code:       skuNum || null,
                    description:        desc || null,
                    quantity:           qty,
                    original_quantity:  origQty,
                    delivered_quantity: delQty,
                    unit_price:         unitAmt,
                    extras:             itemNote ? { notes: itemNote } : null,
                  });
                }
              }
            }
          }
        } else {
          // No tenant_id — try upsert with null tenant (won't conflict on unique)
          // Insert into quarantine instead
          await supabase.from('dt_orders_quarantine').upsert({
            received_at:   new Date().toISOString(),
            dt_identifier: dtIdentifier,
            raw_payload:   { account: accountName, status: statusStr, date: currentDate, customer: contactName },
            mapping_hint:  { account_name: accountName, source: 'backfill' },
            status:        'pending',
          }, { onConflict: 'dt_identifier', ignoreDuplicates: true });
          results.quarantined++;
        }
      }
    } catch (err) {
      results.errors.push(`${currentDate}: ${(err as Error).message}`);
    }

    currentDate = addDays(currentDate, 1);
  }

  console.log(`[dt-backfill] Done: ${results.inserted} inserted/updated, ${results.quarantined} quarantined, ${results.errors.length} errors over ${results.dates_processed} days`);

  return new Response(
    JSON.stringify(results),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
