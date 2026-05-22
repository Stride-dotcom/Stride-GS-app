/**
 * send-shipment-email-sb — SB-primary thin wrapper that fires the
 * SHIPMENT_RECEIVED transactional email via the canonical `send-email`
 * Edge Function.
 *
 * GAS reference: handleCompleteShipment_ email branch at
 * StrideAPI.gs ~line 17400-17492 (template key `SHIPMENT_RECEIVED`,
 * via api_sendTemplateEmail_). The GAS flow merges
 * NOTIFICATION_EMAILS + CLIENT_EMAIL and computes a token bundle from
 * the per-tenant Sheet's Settings + Inventory rows.
 *
 * Replacement strategy: this thin EF does the SB-side equivalent —
 *   1. Look up the shipment in public.shipments (by tenant + shipmentNo).
 *   2. Look up the client in public.clients (by tenant_id) for name + email.
 *   3. Count items received in public.inventory for the shipment.
 *   4. Build the standard token bundle + a portal deep-link.
 *   5. Invoke `send-email` with templateKey=SHIPMENT_RECEIVED.
 *   6. Write entity_audit_log (entity_type='shipment', action='send_email').
 *
 * Per MIGRATION_STATUS.md "Notification-routing system" backlog, this
 * handler does NOT default to staff distros — recipient fallback is
 * strictly clients.email. Callers who want notif lists must pass `to`.
 *
 * Auth: verify_jwt=true (default). The body's tenantId is used directly;
 * the routing layer (src/lib/apiRouter.ts) only forwards SB-path when
 * the per-tenant feature flag resolves to 'supabase', so the JWT is
 * already authorized against this tenant. SERVICE_ROLE is used for
 * SB reads + the send-email invoke.
 *
 * Response shape:
 *   { success: true, emailSendId, templateKey, recipientCount, deduped? }
 *   { ok: false, error: "..." }   on failure (4xx)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TEMPLATE_KEY = 'SHIPMENT_RECEIVED';
const APP_PORTAL_BASE = 'https://app.stridenw.com';

interface SendShipmentEmailBody {
  tenantId?: string;
  shipmentNo?: string;
  to?: string | string[];
  callerEmail?: string;
  requestId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let body: SendShipmentEmailBody;
  try { body = await req.json(); }
  catch (e) { return json({ ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const shipmentNo  = String(body.shipmentNo  ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId)   return json({ ok: false, error: 'tenantId is required' }, 400);
  if (!shipmentNo) return json({ ok: false, error: 'shipmentNo is required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[send-shipment-email-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // 1. Shipment row
  const { data: shipRow, error: shipErr } = await sb
    .from('shipments')
    .select('shipment_number, vendor, carrier, tracking_number, received_date, notes')
    .eq('tenant_id', tenantId)
    .eq('shipment_number', shipmentNo)
    .maybeSingle();
  if (shipErr) {
    console.error('[send-shipment-email-sb] shipment lookup failed:', shipErr.message);
    return json({ ok: false, error: `Shipment lookup failed: ${shipErr.message}` }, 500);
  }
  if (!shipRow) return json({ ok: false, error: `Shipment not found: ${shipmentNo}` }, 404);
  const ship = shipRow as {
    shipment_number: string;
    vendor: string | null;
    carrier: string | null;
    tracking_number: string | null;
    received_date: string | null;
    notes: string | null;
  };

  // 2. Client row (name + email)
  const { data: clientRow } = await sb
    .from('clients')
    .select('name, email')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const clientName  = (clientRow as { name?: string } | null)?.name?.trim()  || 'Client';
  const clientEmail = (clientRow as { email?: string } | null)?.email?.trim() || '';

  // 3. Recipients — caller wins; else fall back to clients.email ONLY.
  //    Notification-routing backlog: do NOT default to staff distros.
  let toList: string[] = [];
  if (body.to) {
    toList = Array.isArray(body.to) ? body.to : [body.to];
  } else if (clientEmail) {
    toList = [clientEmail];
  }
  toList = toList.map(s => String(s ?? '').trim()).filter(Boolean);
  if (toList.length === 0) {
    return json({
      ok: false,
      error: `No recipients resolved (clients.email is empty for tenant ${tenantId} and no 'to' override provided)`,
    }, 400);
  }

  // 4. Item count from inventory
  const { count: itemCountRaw, error: invErr } = await sb
    .from('inventory')
    .select('item_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('shipment_number', shipmentNo);
  if (invErr) {
    console.warn('[send-shipment-email-sb] inventory count failed:', invErr.message);
  }
  const itemCount = Number(itemCountRaw ?? 0);

  // 5. Tokens — minimal canonical set. The template body owns the
  //    full layout; missing tokens collapse to '' in send-email.
  const portalLink = `${APP_PORTAL_BASE}/#/shipments/${encodeURIComponent(shipmentNo)}`;
  const tokens: Record<string, string> = {
    CLIENT_NAME:    clientName,
    SHIPMENT_NO:    shipmentNo,
    ITEM_COUNT:     String(itemCount),
    RECEIVED_DATE:  ship.received_date ?? '',
    VENDOR:         ship.vendor ?? '',
    CARRIER:        ship.carrier ?? '',
    TRACKING:       ship.tracking_number ?? '',
    PORTAL_LINK:    portalLink,
    INVENTORY_URL:  portalLink,
  };

  // 6. Invoke send-email
  const idempotencyKey = `${TEMPLATE_KEY}:${tenantId}:${shipmentNo}:${requestId}`;
  const send = await invokeSendEmail(supabaseUrl, serviceKey, {
    templateKey:       TEMPLATE_KEY,
    to:                toList,
    tokens,
    idempotencyKey,
    relatedEntityType: 'shipment',
    relatedEntityId:   shipmentNo,
    tenantId,
  });

  if (!send.ok) {
    return json({ ok: false, error: send.error ?? 'send-email failed' }, 502);
  }

  // 7. Audit
  await sb.from('entity_audit_log').insert({
    entity_type:   'shipment',
    entity_id:     shipmentNo,
    tenant_id:     tenantId,
    action:        'send_email',
    changes:       { templateKey: TEMPLATE_KEY, recipientCount: toList.length, deduped: !!send.deduped, emailSendId: send.id ?? null },
    performed_by:  callerEmail || 'send-shipment-email-sb',
    source:        'supabase',
  }).then(() => {}, () => { /* non-fatal */ });

  return json({
    success:        true,
    emailSendId:    send.id ?? null,
    templateKey:    TEMPLATE_KEY,
    recipientCount: toList.length,
    deduped:        !!send.deduped,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

interface SendEmailResult {
  ok: boolean;
  id?: string;
  resendEmailId?: string;
  deduped?: boolean;
  error?: string;
}

async function invokeSendEmail(
  supabaseUrl: string,
  serviceKey: string,
  payload: Record<string, unknown>,
): Promise<SendEmailResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':         serviceKey,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({})) as SendEmailResult;
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
