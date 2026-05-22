/**
 * send-will-call-emails-sb — SB-primary thin wrapper that fires either
 * the WILL_CALL_CREATED or WILL_CALL_RELEASE transactional email via
 * the canonical `send-email` Edge Function.
 *
 * GAS reference:
 *   • Created  — handleCreateWillCall_      (StrideAPI.gs:20344, email block ~20540)
 *                template key: WILL_CALL_CREATED
 *   • Released — handleProcessWcRelease_    (StrideAPI.gs:20788, email block ~21230)
 *                template key: WILL_CALL_RELEASE
 *
 *   NOTE: spec called these WC_CREATED / WC_RELEASED but the live GAS +
 *   email_templates rows use WILL_CALL_CREATED / WILL_CALL_RELEASE. We
 *   use the live keys so send-email's template lookup hits an existing
 *   row. Caller-side `phase` ('created' | 'released') keeps the React
 *   shape simple — translation happens here.
 *
 * Replacement strategy:
 *   1. Resolve phase → template key.
 *   2. Look up the will call in public.will_calls (by tenant + id).
 *      Spec passes `willCallId`; we accept either the row UUID/id OR
 *      the wc_number (string like 'WC-122526143015') and resolve
 *      whichever shape matches.
 *   3. Load public.will_call_items for the WC for ITEM_COUNT + summary.
 *   4. Load public.clients for name + email.
 *   5. Build the canonical token bundle.
 *   6. Invoke send-email.
 *   7. Write entity_audit_log (entity_type='will_call', action='send_email').
 *
 * Recipients: caller > clients.email (per "Notification-routing system"
 * backlog — do NOT default to staff distros).
 *
 * Auth: verify_jwt=true (default). SERVICE_ROLE for SB reads + send-email.
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

const APP_PORTAL_BASE = 'https://app.stridenw.com';

// Spec uses 'created'/'released' as phase values. Translate to the live
// template_key values in public.email_templates. The legacy short forms
// (WC_CREATED / WC_RELEASED) are NOT live templates — caller must use
// phase, not raw template keys, so this EF stays decoupled from any
// future template-key rename.
const PHASE_TO_TEMPLATE: Record<string, string> = {
  created:  'WILL_CALL_CREATED',
  released: 'WILL_CALL_RELEASE',
};

interface SendWcEmailBody {
  tenantId?: string;
  willCallId?: string;   // either a uuid/id OR a wc_number string
  phase?: string;        // 'created' | 'released'
  to?: string | string[];
  callerEmail?: string;
  requestId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let body: SendWcEmailBody;
  try { body = await req.json(); }
  catch (e) { return json({ ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const willCallId  = String(body.willCallId  ?? '').trim();
  const phaseRaw    = String(body.phase       ?? '').trim().toLowerCase();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId)   return json({ ok: false, error: 'tenantId is required' }, 400);
  if (!willCallId) return json({ ok: false, error: 'willCallId is required' }, 400);
  const templateKey = PHASE_TO_TEMPLATE[phaseRaw];
  if (!templateKey) {
    return json({ ok: false, error: `phase must be 'created' or 'released' (got: ${phaseRaw || '(empty)'})` }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[send-will-call-emails-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // 1. Will call row — try wc_number first (most common React payload
  //    is the human-readable WC-MMddyyHHmmss string); fall back to id
  //    if no row matches and the input looks like a uuid.
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(willCallId);
  let wcRow: WcRow | null = null;
  {
    const { data, error } = await sb
      .from('will_calls')
      .select('id, wc_number, status, pickup_party, pickup_phone, requested_by, estimated_pickup_date, created_date, released_at, cod, cod_amount, item_count, notes')
      .eq('tenant_id', tenantId)
      .eq('wc_number', willCallId)
      .maybeSingle();
    if (error) {
      console.error('[send-will-call-emails-sb] WC lookup by wc_number failed:', error.message);
      return json({ ok: false, error: `WC lookup failed: ${error.message}` }, 500);
    }
    wcRow = (data ?? null) as WcRow | null;
  }
  if (!wcRow && looksLikeUuid) {
    const { data, error } = await sb
      .from('will_calls')
      .select('id, wc_number, status, pickup_party, pickup_phone, requested_by, estimated_pickup_date, created_date, released_at, cod, cod_amount, item_count, notes')
      .eq('tenant_id', tenantId)
      .eq('id', willCallId)
      .maybeSingle();
    if (error) {
      console.error('[send-will-call-emails-sb] WC lookup by id failed:', error.message);
      return json({ ok: false, error: `WC lookup failed: ${error.message}` }, 500);
    }
    wcRow = (data ?? null) as WcRow | null;
  }
  if (!wcRow) return json({ ok: false, error: `Will call not found: ${willCallId}` }, 404);

  const wcNumber = String(wcRow.wc_number ?? '').trim() || willCallId;

  // 2. WC items — count + (for released phase) the just-released subset
  const { data: wciRowsRaw } = await sb
    .from('will_call_items')
    .select('item_id, status, qty')
    .eq('tenant_id', tenantId)
    .eq('wc_number', wcNumber);
  const wciRows = (wciRowsRaw ?? []) as Array<{ item_id: string; status: string | null; qty: number | null }>;
  const totalItems      = wciRows.length;
  const releasedItems   = wciRows.filter(r => String(r.status ?? '').trim() === 'Released').length;
  const remainingItems  = totalItems - releasedItems;

  // For the 'created' template ITEM_COUNT is total; for 'released' it
  // reflects the count of items now Released. Mirrors GAS token usage
  // at email blocks 20572 (created → enrichedItems.length) and 21187
  // (released → releasingItems.length).
  const itemCountForToken = phaseRaw === 'released' ? releasedItems : totalItems;

  // 3. Client
  const { data: clientRow } = await sb
    .from('clients')
    .select('name, email')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const clientName  = (clientRow as { name?: string }  | null)?.name?.trim()  || 'Client';
  const clientEmail = (clientRow as { email?: string } | null)?.email?.trim() || '';

  // 4. Recipients — caller > clients.email
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
      error: `No recipients resolved (clients.email empty for tenant ${tenantId} and no 'to' override provided)`,
    }, 400);
  }

  // 5. Tokens
  const portalLink = `${APP_PORTAL_BASE}/#/will-calls/${encodeURIComponent(wcNumber)}`;
  const isCod   = !!wcRow.cod;
  const codAmt  = Number(wcRow.cod_amount ?? 0);

  // PICKUP_DATE token meaning differs across the two phases (GAS
  // convention): created → estimated_pickup_date; released → release date
  // (today / released_at). We surface both as separate tokens AND set
  // PICKUP_DATE / READY_DATE to phase-appropriate values so legacy
  // templates that reference either name keep working.
  const estDate      = String(wcRow.estimated_pickup_date ?? '').trim();
  const releasedDate = String(wcRow.released_at ?? '').slice(0, 10);
  const phaseDate    = phaseRaw === 'released' ? (releasedDate || estDate) : estDate;

  const tokens: Record<string, string> = {
    CLIENT_NAME:      clientName,
    WC_NUMBER:        wcNumber,
    ITEM_COUNT:       String(itemCountForToken),
    TOTAL_ITEMS:      String(totalItems),
    RELEASED_ITEMS:   String(releasedItems),
    REMAINING_ITEMS:  String(remainingItems),
    PICKUP_PARTY:     String(wcRow.pickup_party ?? ''),
    PICKUP_PHONE:     String(wcRow.pickup_phone ?? ''),
    REQUESTED_BY:     String(wcRow.requested_by ?? ''),
    EST_PICKUP_DATE:  estDate || 'Not scheduled',
    PICKUP_DATE:      phaseDate,
    READY_DATE:       phaseDate,
    DATE:             phaseDate,
    CREATED_DATE:     String(wcRow.created_date ?? '').slice(0, 10),
    STATUS:           String(wcRow.status ?? ''),
    COD:              isCod ? `Yes — $${codAmt.toFixed(2)}` : 'No',
    NOTES:            String(wcRow.notes ?? ''),
    PORTAL_LINK:      portalLink,
    INVENTORY_URL:    portalLink,
  };

  // 6. Invoke send-email
  const idempotencyKey = `${templateKey}:${tenantId}:${wcNumber}:${requestId}`;
  const send = await invokeSendEmail(supabaseUrl, serviceKey, {
    templateKey,
    to:                toList,
    tokens,
    idempotencyKey,
    relatedEntityType: 'will_call',
    relatedEntityId:   wcNumber,
    tenantId,
  });
  if (!send.ok) {
    return json({ ok: false, error: send.error ?? 'send-email failed' }, 502);
  }

  // 7. Audit
  await sb.from('entity_audit_log').insert({
    entity_type:   'will_call',
    entity_id:     wcNumber,
    tenant_id:     tenantId,
    action:        'send_email',
    changes:       { templateKey, phase: phaseRaw, recipientCount: toList.length, deduped: !!send.deduped, emailSendId: send.id ?? null },
    performed_by:  callerEmail || 'send-will-call-emails-sb',
    source:        'supabase',
  }).then(() => {}, () => { /* non-fatal */ });

  return json({
    success:        true,
    emailSendId:    send.id ?? null,
    templateKey,
    recipientCount: toList.length,
    deduped:        !!send.deduped,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

interface WcRow {
  id: string;
  wc_number: string | null;
  status: string | null;
  pickup_party: string | null;
  pickup_phone: string | null;
  requested_by: string | null;
  estimated_pickup_date: string | null;
  created_date: string | null;
  released_at: string | null;
  cod: boolean | null;
  cod_amount: number | null;
  item_count: number | null;
  notes: string | null;
}

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
