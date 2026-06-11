/**
 * update-client-sb — SB-primary handler for `updateClient`.
 *
 * Mirrors GAS handleUpdateClient_ (StrideAPI.gs:28504). Updates an editable
 * subset of fields on a public.clients row keyed by spreadsheet_id. The GAS
 * handler also fans out to CB Clients sheet + client Settings tab + Drive
 * folder bookkeeping; the SB-primary path writes the canonical row and
 * fires reverse-writethrough so the GAS-side mirrors stay current via the
 * existing __writeThroughReverseClients_ writer (v38.224.0).
 *
 * Editable fields (any subset; at least one required):
 *   clientName → name
 *   clientEmail → email
 *   contactName, phone
 *   folderId, photosFolderId, invoiceFolderId
 *   freeStorageDays, discountStoragePct, discountServicesPct
 *   paymentTerms
 *   enableReceivingBilling, enableShipmentEmail, enableNotifications
 *   autoInspection, separateBySidemark, autoCharge
 *   webAppUrl, qbCustomerName, staxCustomerId, parentClient
 *   notes, shipmentNote, active
 *
 * Payload:  { spreadsheetId, callerEmail?, requestId?, <fields...> }
 * Response: { success, spreadsheetId, updated }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIELD_MAP: Record<string, string> = {
  clientName:              'name',
  clientEmail:             'email',
  contactName:             'contact_name',
  phone:                   'phone',
  folderId:                'folder_id',
  photosFolderId:          'photos_folder_id',
  invoiceFolderId:         'invoice_folder_id',
  freeStorageDays:         'free_storage_days',
  discountStoragePct:      'discount_storage_pct',
  discountServicesPct:     'discount_services_pct',
  paymentTerms:            'payment_terms',
  enableReceivingBilling:  'enable_receiving_billing',
  enableShipmentEmail:     'enable_shipment_email',
  enableNotifications:     'enable_notifications',
  autoInspection:          'auto_inspection',
  separateBySidemark:      'separate_by_sidemark',
  autoCharge:              'auto_charge',
  webAppUrl:               'web_app_url',
  qbCustomerName:          'qb_customer_name',
  staxCustomerId:          'stax_customer_id',
  parentClient:            'parent_client',
  notes:                   'notes',
  shipmentNote:            'shipment_note',
  active:                  'active',
  // Supabase-only client settings (no CB Clients column). Previously React
  // Settings wrote these via a SEPARATE direct supabase.update() after
  // postUpdateClient — a second write path that clobbered
  // end_customer_pays_storage to false whenever the form didn't carry the
  // field (the flag-gated COD toggle), and that the EF's mirror never saw.
  // Routing them through this EF makes it the single client-settings write
  // path: partial semantics (absent field = untouched) + audit + mirror.
  billingContactName:      'billing_contact_name',
  billingEmail:            'billing_email',
  billingAddress:          'billing_address',
  paymentMethodRequired:   'payment_method_required',
  endCustomerPaysStorage:  'end_customer_pays_storage',
};

const BOOL_FIELDS = new Set([
  'enable_receiving_billing', 'enable_shipment_email', 'enable_notifications',
  'auto_inspection', 'separate_by_sidemark', 'auto_charge', 'active',
  'payment_method_required', 'end_customer_pays_storage',
]);
const NUM_FIELDS = new Set(['free_storage_days', 'discount_storage_pct', 'discount_services_pct']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const body = await req.json().catch(() => ({}));
  const spreadsheetId = String(body.spreadsheetId ?? body.tenantId ?? '').trim();
  const callerEmail   = String(body.callerEmail   ?? '').trim();
  const requestId     = String(body.requestId     ?? '').trim() || crypto.randomUUID();

  if (!spreadsheetId) return json({ success: false, error: 'spreadsheetId is required', code: 'MISSING_PARAM' }, 400);

  const updates: Record<string, unknown> = {};
  const echoUpdated: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) continue;
    let val = body[key];
    if (BOOL_FIELDS.has(col)) val = val === true || val === 'true' || val === 'TRUE';
    else if (NUM_FIELDS.has(col)) val = val === null || val === '' ? null : Number(val);
    else val = val === null ? null : String(val);
    updates[col] = val;
    echoUpdated[key] = val;
  }
  if (Object.keys(updates).length === 0) {
    return json({ success: false, error: 'No editable fields provided', code: 'INVALID_PARAMS' }, 400);
  }
  updates.updated_at = new Date().toISOString();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: existing, error: prevErr } = await sb
    .from('clients')
    .select('id, spreadsheet_id')
    .eq('spreadsheet_id', spreadsheetId)
    .maybeSingle();
  if (prevErr) return json({ success: false, error: `Read failed: ${prevErr.message}` }, 500);
  if (!existing) return json({ success: false, error: `Client not found: ${spreadsheetId}`, code: 'NOT_FOUND' }, 404);

  const { error: upErr } = await sb
    .from('clients')
    .update(updates)
    .eq('spreadsheet_id', spreadsheetId);
  if (upErr) return json({ success: false, error: `Update failed: ${upErr.message}` }, 500);

  await sb.from('entity_audit_log').insert({
    entity_type:  'client',
    entity_id:    spreadsheetId,
    tenant_id:    spreadsheetId,
    action:       'update',
    changes:      echoUpdated,
    performed_by: callerEmail || 'update-client-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  // GAS-side mirror handles CB Clients tab + per-tenant Settings tab via
  // __writeThroughReverseClients_ (v38.224.0).
  void mirror(spreadsheetId, updates, requestId, callerEmail, sb);

  return json({ success: true, spreadsheetId, updated: echoUpdated });
});

async function mirror(
  spreadsheetId: string, row: Record<string, unknown>,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId: spreadsheetId, table: 'clients', op: 'update', rowId: spreadsheetId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: spreadsheetId, entity_type: 'client', entity_id: spreadsheetId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'update-client-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[update-client-sb] mirror threw:', e); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
