/**
 * onboard-client-sb — HYBRID handler for `onboardClient`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decision MIG-016.
 *
 * **This is a HYBRID handler.** The SB side writes the `public.clients` row;
 * GAS retains ownership of spreadsheet/folder provisioning because Edge
 * Functions have no Google Drive API access without an explicit OAuth
 * setup. Cutover to fully SB-primary requires resolving the Drive-API
 * gap (a Service Account with delegated domain-wide Drive scope + token
 * refresh, plus porting api_writeClientSettings_ + api_appendClientRow_).
 *
 * Replaces the SB-routable parts of GAS handler `handleOnboardClient_`
 * (StrideAPI.gs ~line 27016). The Drive folder + template-copy +
 * bound-script-discovery + Web-App-deploy steps stay on GAS.
 *
 * Flow:
 *   1. Validate inputs (clientName + clientEmail required; other client
 *      settings optional with sensible defaults).
 *   2. Check for an existing public.clients row with the same name
 *      (case-insensitive). Reject as DUPLICATE_CLIENT if found.
 *   3. INSERT a provisional public.clients row with `active=false` and a
 *      placeholder spreadsheet_id (a `PENDING-<uuid>` sentinel to satisfy
 *      the UNIQUE constraint without colliding with real client IDs).
 *      This lets us roll back cleanly if the GAS-side provisioning fails.
 *   4. Fire writeThroughReverse to GAS with table='clients' op='onboard'
 *      passing the full payload. GAS runs the Drive duplicate + folder
 *      creation + settings write + CB Clients row append + user upsert.
 *      Returns { spreadsheetId, clientFolderId, photosFolderId,
 *      invoicesFolderId, scriptId, webAppUrl?, warnings, existingUser? }.
 *   5. On GAS success: UPDATE the provisional clients row with the real
 *      spreadsheet_id (which is also the tenant_id by convention — see
 *      migration 20260415120000 line 18), plus the folder IDs and
 *      active=true. Return success.
 *   6. On GAS failure: best-effort DELETE the provisional clients row
 *      and return a clear error so the operator isn't left with a
 *      half-created tenant.
 *
 * Authorization: verify_jwt=true. Caller must be staff/admin (the
 *  feature_flags routing only enables this EF for staff-tier roles; an
 *  authenticated client-tier caller hitting this directly would still
 *  succeed at the EF layer but would be screened at the React layer).
 *
 * Response (success):
 *   { success: true, clientId, spreadsheetId, clientFolderId,
 *     photosFolderId, invoicesFolderId, scriptId, webAppUrl?,
 *     warnings: string[], existingUser? }
 *
 * Response (failure):
 *   { error: "...", code?: "..." }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OnboardBody {
  callerEmail?:           string;
  requestId?:             string;
  // Client identity
  clientName?:            string;
  clientEmail?:           string;
  contactName?:           string;
  phone?:                 string;
  // QBO/Stax linking
  qbCustomerName?:        string;
  staxCustomerId?:        string;
  // Billing config
  paymentTerms?:          string;     // default 'Net 30'
  freeStorageDays?:       number;
  discountStoragePct?:    number;
  discountServicesPct?:   number;
  enableReceivingBilling?: boolean;
  enableShipmentEmail?:   boolean;
  enableNotifications?:   boolean;
  autoInspection?:        boolean;
  separateBySidemark?:    boolean;
  autoCharge?:            boolean;
  // Notes
  notes?:                 string;
  shipmentNote?:          string;
  parentClient?:          string;
  // User conflict resolution (mirrors GAS userAction)
  userAction?:            'add_access' | 'skip' | '';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: OnboardBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const clientName  = String(body.clientName  ?? '').trim();
  const clientEmail = String(body.clientEmail ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!clientName)  return json({ error: 'clientName is required',  code: 'MISSING_PARAM' }, 400);
  if (!clientEmail) return json({ error: 'clientEmail is required', code: 'MISSING_PARAM' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[onboard-client-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const warnings: string[] = [];

  // ── 1. Duplicate-name check (case-insensitive) ─────────────────────────
  const { data: existing, error: dupErr } = await sb
    .from('clients')
    .select('id, name, active')
    .ilike('name', clientName);
  if (dupErr) {
    console.error('[onboard-client-sb] dup check failed:', dupErr.message);
    return json({ error: `Read failed: ${dupErr.message}`, code: 'READ_FAILED' }, 500);
  }
  if (existing && existing.length > 0) {
    return json({
      error: `Client '${clientName}' already exists`,
      code:  'DUPLICATE_CLIENT',
    }, 409);
  }

  // ── 2. INSERT provisional clients row ──────────────────────────────────
  // We need a placeholder spreadsheet_id to satisfy the UNIQUE NOT NULL
  // constraint without colliding with a real Google Sheets ID. Use a
  // PENDING-<uuid> sentinel that's distinguishable in audits.
  const pendingId = `PENDING-${crypto.randomUUID()}`;
  const nowIso    = new Date().toISOString();

  const provisionalRow: Record<string, unknown> = {
    tenant_id:                pendingId,   // updated to real spreadsheet_id after GAS succeeds
    name:                     clientName,
    spreadsheet_id:           pendingId,   // ditto
    email:                    clientEmail,
    contact_name:             String(body.contactName ?? ''),
    phone:                    String(body.phone ?? ''),
    qb_customer_name:         String(body.qbCustomerName ?? clientName),
    stax_customer_id:         String(body.staxCustomerId ?? ''),
    payment_terms:            String(body.paymentTerms ?? 'Net 30'),
    free_storage_days:        numberOrDefault(body.freeStorageDays, 0),
    discount_storage_pct:     numberOrDefault(body.discountStoragePct, 0),
    discount_services_pct:    numberOrDefault(body.discountServicesPct, 0),
    enable_receiving_billing: body.enableReceivingBilling !== false,
    enable_shipment_email:    body.enableShipmentEmail   !== false,
    enable_notifications:     body.enableNotifications   !== false,
    auto_inspection:          body.autoInspection        !== false,
    separate_by_sidemark:     body.separateBySidemark === true,
    auto_charge:              body.autoCharge === true,
    notes:                    String(body.notes ?? ''),
    shipment_note:            String(body.shipmentNote ?? ''),
    parent_client:            String(body.parentClient ?? ''),
    active:                   false,
    created_at:               nowIso,
    updated_at:               nowIso,
  };

  const { data: insRow, error: insErr } = await sb
    .from('clients')
    .insert(provisionalRow)
    .select('id')
    .maybeSingle();
  if (insErr || !insRow) {
    console.error('[onboard-client-sb] provisional insert failed:', insErr?.message);
    return json({ error: `Provisional insert failed: ${insErr?.message ?? 'unknown'}`, code: 'INSERT_FAILED' }, 500);
  }
  const clientId = String((insRow as { id: string }).id);

  // ── 3. Fire writeThroughReverse to GAS for the spreadsheet/folder work ─
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) {
    // Without GAS we can't provision. Roll back the provisional row.
    await sb.from('clients').delete().eq('id', clientId).then(() => {}, () => {});
    return json({
      error: 'GAS_API_URL / GAS_API_TOKEN not configured — cannot provision spreadsheet',
      code:  'CONFIG_ERROR',
    }, 500);
  }

  const onboardPayload = {
    tenantId:  pendingId,           // GAS uses this in audit; will become spreadsheet_id below
    table:     'clients',
    op:        'onboard',
    rowId:     clientName,
    row:       {
      clientName,
      clientEmail,
      contactName:           String(body.contactName ?? ''),
      phone:                 String(body.phone ?? ''),
      qbCustomerName:        String(body.qbCustomerName ?? clientName),
      staxCustomerId:        String(body.staxCustomerId ?? ''),
      paymentTerms:          String(body.paymentTerms ?? 'Net 30'),
      freeStorageDays:       numberOrDefault(body.freeStorageDays, 0),
      discountStoragePct:    numberOrDefault(body.discountStoragePct, 0),
      discountServicesPct:   numberOrDefault(body.discountServicesPct, 0),
      enableReceivingBilling: body.enableReceivingBilling !== false,
      enableShipmentEmail:   body.enableShipmentEmail   !== false,
      enableNotifications:   body.enableNotifications   !== false,
      autoInspection:        body.autoInspection        !== false,
      separateBySidemark:    body.separateBySidemark === true,
      autoCharge:            body.autoCharge === true,
      notes:                 String(body.notes ?? ''),
      shipmentNote:          String(body.shipmentNote ?? ''),
      parentClient:          String(body.parentClient ?? ''),
      userAction:            String(body.userAction ?? ''),
    },
    requestId,
    callerEmail,
  };

  type GasOnboardResp = {
    success?:           boolean;
    error?:             string;
    spreadsheetId?:     string;
    clientFolderId?:    string;
    photosFolderId?:    string;
    invoicesFolderId?:  string;
    scriptId?:          string | null;
    webAppUrl?:         string;
    warnings?:          string[];
    existingUser?:      { email: string; clientName?: string; role?: string };
  };

  let gasResp: GasOnboardResp;
  try {
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(onboardPayload),
    });
    const text = await res.text();
    try { gasResp = JSON.parse(text); }
    catch { gasResp = { success: false, error: `non-JSON response from GAS: ${text.slice(0, 300)}` }; }
    if (!res.ok) {
      gasResp.success = false;
      gasResp.error   = gasResp.error ?? `HTTP ${res.status} from GAS`;
    }
  } catch (e) {
    gasResp = { success: false, error: `GAS fetch threw: ${e instanceof Error ? e.message : String(e)}` };
  }

  // ── 4. Handle GAS response ─────────────────────────────────────────────
  if (!gasResp.success || !gasResp.spreadsheetId) {
    // Roll back the provisional clients row. Best-effort.
    const { error: rollbackErr } = await sb.from('clients').delete().eq('id', clientId);
    if (rollbackErr) {
      // Surface to the operator — they need to clean up manually.
      console.error('[onboard-client-sb] rollback DELETE failed:', rollbackErr.message);
      warnings.push(`Provisional clients row could not be auto-deleted: ${rollbackErr.message}. Manual cleanup: DELETE FROM public.clients WHERE id='${clientId}';`);
    }
    return json({
      error: `GAS provisioning failed: ${gasResp.error ?? 'unknown'}. Provisional SB row rolled back.`,
      code:  'GAS_PROVISIONING_FAILED',
      warnings,
    }, 502);
  }

  const spreadsheetId    = String(gasResp.spreadsheetId).trim();
  const clientFolderId   = String(gasResp.clientFolderId  ?? '').trim();
  const photosFolderId   = String(gasResp.photosFolderId  ?? '').trim();
  const invoicesFolderId = String(gasResp.invoicesFolderId ?? '').trim();
  const scriptId         = gasResp.scriptId ? String(gasResp.scriptId).trim() : null;
  const webAppUrl        = String(gasResp.webAppUrl ?? '').trim();
  if (Array.isArray(gasResp.warnings)) warnings.push(...gasResp.warnings);

  // ── 5. UPDATE provisional row with real IDs + activate ─────────────────
  const updateRow: Record<string, unknown> = {
    tenant_id:         spreadsheetId,   // tenant_id == spreadsheet_id per decision #20 (clients_mirror migration)
    spreadsheet_id:    spreadsheetId,
    folder_id:         clientFolderId,
    photos_folder_id:  photosFolderId,
    invoice_folder_id: invoicesFolderId,
    web_app_url:       webAppUrl,
    active:            true,
    updated_at:        new Date().toISOString(),
  };
  const { error: upErr } = await sb
    .from('clients')
    .update(updateRow)
    .eq('id', clientId);
  if (upErr) {
    // GAS already created the spreadsheet — don't tear that down. Surface
    // the SB-update failure as a warning so operator can repair manually.
    warnings.push(`Final SB clients row update failed: ${upErr.message}. The Google sheet exists at https://docs.google.com/spreadsheets/d/${spreadsheetId}; UPDATE public.clients SET tenant_id='${spreadsheetId}', spreadsheet_id='${spreadsheetId}' WHERE id='${clientId}' to repair.`);
  }

  // ── 6. Audit log ───────────────────────────────────────────────────────
  await sb.from('entity_audit_log').insert({
    entity_type:   'client',
    entity_id:     spreadsheetId,
    tenant_id:     spreadsheetId,
    action:        'create',
    changes:       {
      clientName,
      clientEmail,
      provisionedVia: 'hybrid (SB row + GAS spreadsheet)',
      gasScriptId:    scriptId,
      webAppUrl:      webAppUrl || null,
    },
    performed_by:  callerEmail || 'onboard-client-sb',
    source:        'supabase',
  }).then(() => {}, () => { /* non-fatal */ });

  return json({
    success:          true,
    clientId,
    spreadsheetId,
    spreadsheetUrl:   `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    clientFolderId,
    photosFolderId,
    invoicesFolderId,
    scriptId,
    webAppUrl:        webAppUrl || null,
    existingUser:     gasResp.existingUser ?? null,
    warnings,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function numberOrDefault(v: unknown, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
