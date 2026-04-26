/**
 * dt-sync-statuses — Supabase Edge Function — v8 2026-04-25 PST
 *
 * v8: Look up DT orders by `dt_identifier` instead of `dt_dispatch_id`.
 *     Two reasons:
 *       1. `dt-push-order` doesn't capture a dispatch ID from DT's
 *          add_order response (DT returns only <success>...</success>),
 *          so app-pushed orders have dt_dispatch_id IS NULL forever.
 *          Until v7 they were filtered out and stayed "Awaiting DT
 *          Sync" indefinitely.
 *       2. The DT XML spec for /orders/api/export.xml takes
 *          `service_order_id={Order_Number}` — that's the human
 *          identifier (e.g. "MRS-00002"), not the numeric dispatch ID.
 *          We always have dt_identifier on every row.
 *     Filter: `pushed_to_dt_at IS NOT NULL` (instead of dt_dispatch_id).
 *     URL: `service_order_id=${dt_identifier}`.
 *
 * v7:
 * v7: Switched from the code-only `/orders/api/get_order_status` endpoint
 *     to the rich `/orders/api/export.xml?service_order_id=…` per-order
 *     endpoint. We now mirror the full DT completion payload back into
 *     the cache instead of only the status code:
 *       • dt_orders top-level: status, started_at, finished_at,
 *         scheduled_at, driver, truck, service_unit, stop_number,
 *         actual_service_time_minutes, payment_collected, payment_notes,
 *         cod_amount, signature_captured_at, dt_status_code,
 *         dt_export_payload (raw parsed JSON for debugging).
 *       • dt_order_items (matched by dt_item_code): delivered,
 *         delivered_quantity, item_note, checked_quantity, location,
 *         return_codes.
 *       • dt_order_history: replace-on-sync per order with the events
 *         DT returns (date/time/lat/lng/code/description/owner).
 *       • dt_order_notes: replace-on-sync for source='dt_export' so
 *         driver/dispatcher-added DT-side notes flow back without
 *         clobbering app-authored ones.
 *     Backwards-compat: the same auto-Collected branch fires when DT
 *     reports completion on an already-paid order.
 *
 * v6 (prior): missing-credentials path returns ok:false; statuses fetched once.
 * v5 (prior): api_key query param auth; terminal-category filter; same-status guard.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STATUS_COLLECTED = 22;

interface SyncBody {
  scope?: 'active' | 'all';
  orderId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let body: SyncBody = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const scope = body.scope || 'active';
  const singleOrderId = body.orderId;

  const { data: cred, error: credErr } = await supabase
    .from('dt_credentials').select('*').limit(1).maybeSingle();
  if (credErr) return json({ ok: false, error: `Credentials read failed: ${credErr.message}` }, 500);
  const haveCreds = !!(cred?.auth_token_encrypted && cred?.api_base_url);

  const { data: statusRows } = await supabase
    .from('dt_statuses').select('id, code, category');
  const allStatuses = (statusRows || []) as Array<{ id: number; code: string | null; category: string }>;
  const statusByCode = new Map<string, { id: number; category: string }>();
  for (const s of allStatuses) {
    if (s.code) statusByCode.set(String(s.code).toUpperCase(), { id: s.id, category: s.category });
  }

  // Active orders = ones we've pushed to DT. We previously required
  // dt_dispatch_id to be set, but app-pushed orders never have one
  // (DT's add_order response doesn't return it), so that filter
  // skipped every order created in-app. Keying off pushed_to_dt_at
  // covers both app-pushed AND webhook-imported rows.
  let query = supabase
    .from('dt_orders')
    .select('id, dt_identifier, dt_dispatch_id, status_id, last_synced_at, tenant_id, paid_at')
    .not('pushed_to_dt_at', 'is', null);

  if (singleOrderId) {
    query = query.eq('id', singleOrderId);
  } else if (scope === 'active') {
    const terminalIds = allStatuses
      .filter(s => s.category === 'completed' || s.category === 'cancelled' || s.category === 'exception' || s.category === 'billing')
      .map(s => s.id);
    if (terminalIds.length > 0) {
      query = query.or(`status_id.is.null,status_id.not.in.(${terminalIds.join(',')})`);
    }
  }

  const { data: orders, error: fetchErr } = await query;
  if (fetchErr) return json({ ok: false, error: `Order fetch failed: ${fetchErr.message}` }, 500);

  const result = {
    ok: true,
    checked: orders?.length ?? 0,
    updated: 0,
    completed: 0,
    errors: [] as string[],
    note: '',
  };

  if (!orders || orders.length === 0) {
    result.note = 'No pushed orders need syncing.';
    return json(result);
  }

  if (!haveCreds) {
    const nowIso = new Date().toISOString();
    const ids = orders.map(o => o.id);
    const { error: touchErr } = await supabase.from('dt_orders').update({ last_synced_at: nowIso }).in('id', ids);
    if (touchErr) result.errors.push(`Timestamp update failed: ${touchErr.message}`);
    result.ok = false;
    result.note = 'DT credentials not configured.';
    return json(result, 503);
  }

  const baseUrl = String(cred!.api_base_url).replace(/\/+$/, '');
  const apiKey  = String(cred!.auth_token_encrypted);

  for (const o of orders) {
    try {
      // DT's `service_order_id` parameter accepts the Order_Number
      // (human identifier) per the XML API spec. Prefer dt_identifier;
      // fall back to dt_dispatch_id for legacy webhook rows that may
      // only have the numeric ID.
      const lookupId = o.dt_identifier || (o.dt_dispatch_id != null ? String(o.dt_dispatch_id) : '');
      if (!lookupId) { result.errors.push(`${o.id}: no dt_identifier or dt_dispatch_id`); continue; }
      const url = `${baseUrl}/orders/api/export.xml?code=expressinstallation&api_key=${encodeURIComponent(apiKey)}&service_order_id=${encodeURIComponent(lookupId)}`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Accept': 'application/xml' } });
      if (!resp.ok) { result.errors.push(`${o.dt_identifier}: HTTP ${resp.status}`); continue; }
      const xml = await resp.text();
      const parsed = parseExportOrder(xml);
      if (!parsed) { result.errors.push(`${o.dt_identifier}: empty/invalid export response`); continue; }

      // ── status code → status_id resolution ───────────────────────────
      const dtStatusCode = (parsed.status || '').toUpperCase();
      let finalStatusId: number | null = null;
      let category: string | null = null;
      if (dtStatusCode) {
        const match = statusByCode.get(dtStatusCode);
        if (match) {
          finalStatusId = match.id;
          category = match.category;
          if (category === 'completed' && o.paid_at) {
            finalStatusId = STATUS_COLLECTED;
          }
        } else {
          result.errors.push(`${o.dt_identifier}: unknown DT status "${dtStatusCode}"`);
        }
      }

      // ── update dt_orders row ────────────────────────────────────────
      const patch: Record<string, unknown> = {
        last_synced_at:               new Date().toISOString(),
        dt_status_code:               dtStatusCode || null,
        dt_export_payload:            parsed,
        scheduled_at:                 toIso(parsed.scheduled_at),
        started_at:                   toIso(parsed.started_at),
        finished_at:                  toIso(parsed.finished_at),
        actual_service_time_minutes:  parsed.service_time,
        driver_id:                    parsed.driver?.id ?? null,
        driver_name:                  parsed.driver?.name ?? null,
        truck_id:                     parsed.truck?.id ?? null,
        truck_name:                   parsed.truck?.name ?? null,
        service_unit:                 parsed.service_unit,
        stop_number:                  parsed.stop_number,
        payment_collected:            parsed.payment_collected,
        payment_notes:                parsed.payment_notes,
        cod_amount:                   parsed.cod_amount,
        signature_captured_at:        toIso(parsed.signature_captured_at),
      };
      if (finalStatusId != null && finalStatusId !== o.status_id) {
        patch.status_id = finalStatusId;
        if (category === 'completed') result.completed += 1;
      }

      const { error: updErr } = await supabase.from('dt_orders').update(patch).eq('id', o.id);
      if (updErr) { result.errors.push(`${o.dt_identifier}: ${updErr.message}`); continue; }
      result.updated += 1;

      // ── dt_order_items (match by dt_item_code) ──────────────────────
      if (parsed.items.length > 0) {
        for (const it of parsed.items) {
          if (!it.item_id) continue;
          await supabase.from('dt_order_items').update({
            delivered:          it.delivered,
            delivered_quantity: it.delivered_quantity,
            item_note:          it.item_note,
            checked_quantity:   it.checked_quantity,
            location:           it.location,
            return_codes:       it.return_codes,
            last_synced_at:     new Date().toISOString(),
          }).eq('dt_order_id', o.id).eq('dt_item_code', it.item_id);
        }
      }

      // ── dt_order_history : replace source='dt_export' rows ──────────
      // Build the insert payload first; only delete if the new payload is
      // valid (else we'd nuke the cache when DT returns one bad timestamp).
      // happened_at is NOT NULL in the schema, so rows that don't normalize
      // to ISO are dropped rather than blocking the whole batch.
      const historyRows = parsed.history
        .map(h => ({
          dt_order_id: o.id,
          code:        h.code,
          description: h.description,
          happened_at: toIso(h.happened_at),
          owner_id:    h.owner_id,
          owner_name:  h.owner_name,
          owner_type:  h.owner_type,
          lat:         h.lat,
          lng:         h.lng,
          source:      'dt_export',
        }))
        .filter(r => r.happened_at != null);
      await supabase.from('dt_order_history').delete()
        .eq('dt_order_id', o.id).eq('source', 'dt_export');
      if (historyRows.length > 0) {
        const { error: histErr } = await supabase.from('dt_order_history').insert(historyRows);
        if (histErr) result.errors.push(`${o.dt_identifier} history: ${histErr.message}`);
      }

      // ── dt_order_notes : replace source='dt_export' rows ────────────
      const noteRows = parsed.notes.map(n => ({
        dt_order_id:   o.id,
        body:          n.body,
        author_name:   n.author,
        author_type:   inferAuthorType(n.author),
        visibility:    'public',
        created_at_dt: toIso(n.created_at),
        source:        'dt_export',
      }));
      await supabase.from('dt_order_notes').delete()
        .eq('dt_order_id', o.id).eq('source', 'dt_export');
      if (noteRows.length > 0) {
        const { error: noteErr } = await supabase.from('dt_order_notes').insert(noteRows);
        if (noteErr) result.errors.push(`${o.dt_identifier} notes: ${noteErr.message}`);
      }
    } catch (e) {
      result.errors.push(`${o.dt_identifier}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  return json(result);
});

// ─── XML parsing ─────────────────────────────────────────────────────────
//
// Deno doesn't ship a DOMParser by default, so we use targeted regex
// extractors. This is safe-ish here because the DT export.xml schema is
// stable and well-formed; we only pull the fields we know about and
// tolerate missing tags. Any unexpected nesting just produces null/[] and
// the writer handles that gracefully.

interface ParsedHistoryEvent {
  code: number | null;
  description: string | null;
  happened_at: string | null;
  owner_id: number | null;
  owner_name: string | null;
  owner_type: string | null;
  lat: number | null;
  lng: number | null;
}

interface ParsedNote {
  body: string;
  author: string | null;
  created_at: string | null;
  note_type: string | null;
}

interface ParsedItem {
  item_id: string | null;
  delivered: boolean | null;
  delivered_quantity: number | null;
  item_note: string | null;
  checked_quantity: number | null;
  location: string | null;
  return_codes: unknown;
}

interface ParsedExport {
  status: string | null;
  service_unit: string | null;
  stop_number: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  service_time: number | null;
  payment_collected: boolean | null;
  payment_notes: string | null;
  cod_amount: number | null;
  signature_captured_at: string | null;
  truck: { id: number | null; name: string | null } | null;
  driver: { id: number | null; name: string | null } | null;
  items: ParsedItem[];
  notes: ParsedNote[];
  history: ParsedHistoryEvent[];
}

function parseExportOrder(xml: string): ParsedExport | null {
  const orderXml = section(xml, 'service_order');
  if (!orderXml) return null;

  return {
    status:                tag(orderXml, 'status'),
    service_unit:          tag(orderXml, 'service_unit'),
    stop_number:           toInt(tag(orderXml, 'stop_number')),
    scheduled_at:          tag(orderXml, 'scheduled_at'),
    started_at:            tag(orderXml, 'started_at'),
    finished_at:           tag(orderXml, 'finished_at'),
    service_time:          toInt(tag(orderXml, 'service_time')),
    payment_collected:     toBool(tag(orderXml, 'payment_collected')),
    payment_notes:         tag(orderXml, 'payment_notes'),
    cod_amount:            toNum(tag(orderXml, 'cod_amount')),
    signature_captured_at: signatureCreatedAt(orderXml),
    truck:                 parseTruck(orderXml),
    driver:                parseFirstDriver(orderXml),
    items:                 parseItems(orderXml),
    notes:                 parseNotes(orderXml),
    history:               parseHistory(orderXml),
  };
}

function section(xml: string, tagName: string): string | null {
  const m = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(xml);
  return m ? m[1] : null;
}
function allSections(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
function attrs(xml: string, tagName: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  // Match either self-closing or with body — we only want the open-tag attrs
  const re = new RegExp(`<${tagName}\\b([^>]*?)\\/?>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrStr = m[1] || '';
    const a: Record<string, string> = {};
    const ar = /(\w[\w\-_]*)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = ar.exec(attrStr)) !== null) a[am[1]] = xmlDecode(am[2]);
    out.push(a);
  }
  return out;
}
function tag(xml: string, name: string): string | null {
  const inner = section(xml, name);
  if (inner == null) return null;
  return xmlDecode(stripCdata(inner)).trim() || null;
}
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
function xmlDecode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function toInt(s: string | null): number | null {
  if (s == null) return null;
  const n = parseInt(s, 10); return Number.isFinite(n) ? n : null;
}
function toNum(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
function toBool(s: string | null): boolean | null {
  if (s == null) return null;
  const v = s.toLowerCase().trim();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return null;
}

function signatureCreatedAt(xml: string): string | null {
  // Two possible shapes: <signature created_at="..."/> or
  // <signature><created_at>...</created_at></signature>
  const sig = section(xml, 'signature');
  if (sig != null) {
    const inner = tag(sig, 'created_at');
    if (inner) return inner;
  }
  const a = attrs(xml, 'signature');
  for (const o of a) if (o.created_at) return o.created_at;
  return null;
}

function parseTruck(xml: string): { id: number | null; name: string | null } | null {
  const inner = section(xml, 'truck');
  if (inner != null) {
    return {
      id:   toInt(tag(inner, 'id')),
      name: tag(inner, 'name'),
    };
  }
  const a = attrs(xml, 'truck');
  for (const o of a) {
    if (o.id || o.name) return { id: toInt(o.id || null), name: o.name || null };
  }
  return null;
}

function parseFirstDriver(xml: string): { id: number | null; name: string | null } | null {
  const driversBlock = section(xml, 'drivers');
  const scope = driversBlock ?? xml;
  const driverInners = allSections(scope, 'driver');
  if (driverInners.length > 0) {
    const inner = driverInners[0];
    const id = toInt(tag(inner, 'id'));
    const name = tag(inner, 'name');
    if (id != null || name != null) return { id, name };
  }
  const a = attrs(scope, 'driver');
  if (a.length > 0 && (a[0].id || a[0].name)) {
    return { id: toInt(a[0].id || null), name: a[0].name || null };
  }
  return null;
}

function parseItems(xml: string): ParsedItem[] {
  const itemsBlock = section(xml, 'items') ?? '';
  const inners = allSections(itemsBlock, 'item');
  return inners.map((inner) => ({
    item_id:            tag(inner, 'item_id'),
    delivered:          toBool(tag(inner, 'delivered')),
    delivered_quantity: toNum(tag(inner, 'delivered_quantity')),
    item_note:          tag(inner, 'item_note'),
    checked_quantity:   toNum(tag(inner, 'checked_quantity')),
    location:           tag(inner, 'location'),
    return_codes:       parseReturnCodes(inner),
  }));
}
function parseReturnCodes(itemXml: string): unknown {
  const block = section(itemXml, 'return_codes');
  if (block == null) return null;
  const codes = allSections(block, 'return_code').map(c => xmlDecode(stripCdata(c)).trim()).filter(Boolean);
  if (codes.length > 0) return codes;
  const flat = xmlDecode(stripCdata(block)).trim();
  return flat || null;
}

function parseNotes(xml: string): ParsedNote[] {
  const notesBlock = section(xml, 'notes') ?? '';
  // <note created_at="..." author="..." note_type="...">body</note>
  const re = /<note\b([^>]*)>([\s\S]*?)<\/note>/gi;
  const out: ParsedNote[] = [];
  let m;
  while ((m = re.exec(notesBlock)) !== null) {
    const a: Record<string, string> = {};
    const ar = /(\w[\w\-_]*)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = ar.exec(m[1])) !== null) a[am[1]] = xmlDecode(am[2]);
    const body = xmlDecode(stripCdata(m[2])).trim();
    if (!body) continue;
    out.push({ body, author: a.author || null, created_at: a.created_at || null, note_type: a.note_type || null });
  }
  return out;
}

// Normalize a DT-emitted timestamp to ISO so Postgres timestamptz always
// parses cleanly. DT can return ISO already, "YYYY-MM-DD HH:MM:SS" without
// timezone, or empty/garbage. We coerce defensively — anything unparseable
// returns null instead of nuking a batch insert.
function toIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (!trimmed) return null;
  // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed)
    ? trimmed.replace(' ', 'T')
    : trimmed;
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function parseHistory(xml: string): ParsedHistoryEvent[] {
  const block = section(xml, 'order_history') ?? '';
  const events: ParsedHistoryEvent[] = [];
  // Self-closing <event .../> form
  const reSelf = /<event\b([^>]*?)\/>/gi;
  let m;
  while ((m = reSelf.exec(block)) !== null) {
    events.push(eventFromAttrs(m[1]));
  }
  // Open-body <event ...>...</event> form (e.g. with nested description)
  const reOpen = /<event\b([^>]*)>([\s\S]*?)<\/event>/gi;
  while ((m = reOpen.exec(block)) !== null) {
    const ev = eventFromAttrs(m[1]);
    const innerDesc = tag(m[2], 'description');
    if (innerDesc) ev.description = innerDesc;
    events.push(ev);
  }
  return events;
}
function eventFromAttrs(attrStr: string): ParsedHistoryEvent {
  const a: Record<string, string> = {};
  const ar = /(\w[\w\-_]*)\s*=\s*"([^"]*)"/g;
  let am;
  while ((am = ar.exec(attrStr)) !== null) a[am[1]] = xmlDecode(am[2]);
  // DT often returns date+time as separate attrs; combine into ISO.
  let happened: string | null = null;
  if (a.happened_at) happened = a.happened_at;
  else if (a.date && a.time) happened = `${a.date}T${a.time}`;
  else if (a.date) happened = a.date;
  return {
    code:        toInt(a.code || null),
    description: a.description || null,
    happened_at: happened,
    owner_id:    toInt(a.owner_id || null),
    owner_name:  a.owner_name || null,
    owner_type:  a.owner_type || null,
    lat:         toNum(a.lat || null),
    lng:         toNum(a.lng || null),
  };
}

function inferAuthorType(author: string | null): 'driver' | 'dispatcher' | 'app_user' | 'system' {
  if (!author) return 'system';
  const a = author.toLowerCase();
  if (a.includes('driver')) return 'driver';
  if (a.includes('strideapp') || a === 'stride') return 'app_user';
  return 'dispatcher';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } as Record<string, string>;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
