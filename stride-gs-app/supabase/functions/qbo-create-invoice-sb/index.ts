/**
 * qbo-create-invoice-sb — SB-primary handler for GAS action `qboCreateInvoice`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md — Phase 6 payments
 *                  cluster. CALLS external QuickBooks Online API.
 *
 * Replaces handleQboCreateInvoice_ at StrideAPI.gs:42729. The GAS handler
 * is an ~800-line beast that:
 *   1. Pre-reconciles CB Consolidated_Ledger from public.billing
 *   2. Loads QBO item cache + client info from CB + Supabase
 *   3. Groups requested ledger_row_ids into invoices
 *   4. For each invoice: resolves customer/sub-job, builds payload, POSTs
 *      to QBO /v3/company/{realmId}/invoice, writes ID back to sheet +
 *      stamps invoice_tracking.qbo_pushed_at.
 *
 * THIS HANDLER (SKELETON SCOPE — see "Status" block below):
 *   FULL : OAuth refresh + invoice POST + invoice_tracking stamp +
 *          audit-log + env config-guard.
 *   STUB : CB-side pre-reconcile, item-cache preload, sub-job
 *          (Customer:Sidemark) resolution, parent-customer BillEmail
 *          inheritance, qbo_push_jobs progress patching, batch progress
 *          checkpointing every 5 invoices, payment-terms-aware due date.
 *          These are GAS-only paths driven by Google Sheets reads — they
 *          stay on GAS until P6 ships a CB-equivalent Supabase view.
 *          Documented at each call site below.
 *
 * Inputs (confirmed from GAS handler + the input contract described in
 * the build prompt):
 *   {
 *     tenantId:       string                     // required for audit log
 *     invoiceNo:      string                     // required — Stride INV#
 *     customerId?:    string                     // optional QBO customer id; if
 *                                                // omitted we look up via
 *                                                // public.clients.qb_customer_name
 *     dueDate?:       string  "YYYY-MM-DD"       // optional; today if missing
 *     callerEmail?:   string                     // for audit log
 *     requestId?:     string
 *     autoAssignDocNumber?: boolean              // default true (GAS v38.121.0)
 *   }
 *
 * NOTE: line items are NOT accepted from the caller — they are read live
 * from public.billing (status != 'Void') keyed by invoiceNo. This matches
 * GAS handleQboCreateInvoice_ behavior (StrideAPI.gs:44225) and prevents
 * a stale caller payload from over/under-billing on a real-money path.
 *
 * Required Edge Function secrets:
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   QBO_ENVIRONMENT  — 'production' (default) or 'sandbox' (switches the
 *                      API base URL between quickbooks.api.intuit.com and
 *                      sandbox-quickbooks.api.intuit.com).
 *
 * If any required QBO secret is missing, returns:
 *   { error: "...", code: "CONFIG_ERROR", missing: [...] }   (200)
 *
 * Response (success):
 *   { success: true, qboInvoiceId, qboInvoiceUrl, qboDocNumber }
 * Response (failure):
 *   { success: false, error, code }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Body {
  tenantId?: string;
  invoiceNo?: string;
  customerId?: string;
  dueDate?: string;
  callerEmail?: string;
  requestId?: string;
  autoAssignDocNumber?: boolean;
}

// Per-line shape after we build from public.billing. Description is
// the formatted QBO line description (STOR vs non-STOR), `amount` is
// the live billing row total, qty + rate come straight from billing.
interface QboLine {
  description: string;
  amount:      number;
  qty:         number;
  rate:        number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  // ── Config guard ────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const qboClientId = Deno.env.get('QBO_CLIENT_ID') ?? '';
  const qboSecret   = Deno.env.get('QBO_CLIENT_SECRET') ?? '';
  const qboRefresh  = Deno.env.get('QBO_REFRESH_TOKEN') ?? '';
  const qboRealmId  = Deno.env.get('QBO_REALM_ID') ?? '';
  const qboEnv      = (Deno.env.get('QBO_ENVIRONMENT') ?? 'production').toLowerCase();

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing', code: 'CONFIG_ERROR' }, 500);
  }
  const missing: string[] = [];
  if (!qboClientId) missing.push('QBO_CLIENT_ID');
  if (!qboSecret)   missing.push('QBO_CLIENT_SECRET');
  if (!qboRefresh)  missing.push('QBO_REFRESH_TOKEN');
  if (!qboRealmId)  missing.push('QBO_REALM_ID');
  if (missing.length > 0) {
    return jsonResponse({
      error:   `QBO not configured on this Edge Function — set ${missing.join(', ')} via supabase secrets`,
      code:    'CONFIG_ERROR',
      missing,
    }, 200);
  }

  // ── Input validation ────────────────────────────────────────────────
  const tenantId    = String(body.tenantId    ?? '').trim();
  const invoiceNo   = String(body.invoiceNo   ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const autoAssign  = body.autoAssignDocNumber !== false;

  if (!tenantId)  return jsonResponse({ error: 'tenantId is required',  code: 'INVALID_PARAMS' }, 400);
  if (!invoiceNo) return jsonResponse({ error: 'invoiceNo is required', code: 'INVALID_PARAMS' }, 400);

  const sb = createClient(supabaseUrl, serviceKey);

  // Admin-only gate. QBO push is a real money path; GAS enforces via
  // `withStaffGuard_`. Without an explicit role check the anon-key
  // bundled in every browser build would be enough to push invoices.
  const authHeader = req.headers.get('Authorization') || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) {
    return jsonResponse({ error: 'Authorization header required', code: 'UNAUTHENTICATED' }, 401);
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: authErr } = await authClient.auth.getUser(callerToken);
  if (authErr || !userData?.user) {
    return jsonResponse({ error: 'Invalid token', code: 'UNAUTHENTICATED' }, 401);
  }
  const callerRole = String((userData.user.user_metadata as { role?: string })?.role ?? '').toLowerCase();
  if (callerRole !== 'admin' && callerRole !== 'staff') {
    return jsonResponse({ error: 'admin/staff role required', code: 'FORBIDDEN' }, 403);
  }

  // ── Resolve QBO customerId ──────────────────────────────────────────
  // GAS path: qbo_resolveCustomerAndSubJob_ does a search by name, then
  // creates the customer if missing, then optionally creates a
  // Customer:Sidemark sub-job. SKELETON SCOPE: accept caller-supplied
  // customerId; if missing, look up public.clients.qb_customer_id (or
  // qb_customer_name → search QBO). The sub-job split is STUBBED.
  let customerId = String(body.customerId ?? '').trim();
  if (!customerId) {
    // Try a Supabase-side mapping first. The clients table doesn't have a
    // qb_customer_id column today (CB Clients stores QB_CUSTOMER_NAME as
    // text, no QBO Id), so we'd need to query QBO for the Id. That's a
    // separate round-trip — defer to the operator/UI to pass customerId
    // explicitly for now.
    return jsonResponse({
      error: 'customerId is required (QBO customer Id lookup-by-name not implemented in SB handler yet — pass customerId from the React caller, which already resolves it for the existing GAS path)',
      code:  'CUSTOMER_LOOKUP_NOT_IMPLEMENTED',
    }, 400);
  }

  // ── Load live line items from public.billing ────────────────────────
  // Source of truth is public.billing (post-MIG-005 authority). The
  // GAS path at StrideAPI.gs:44225-44515 reads from Supabase billing
  // (filter status != 'Void', order by date/svc_code/item_id) and falls
  // back to CB Consolidated_Ledger only if Supabase is unreachable. SB
  // path has direct DB access so we go straight to billing — never
  // trust caller-supplied line totals on a real-money path.
  const { data: billingRows, error: billingErr } = await sb
    .from('billing')
    .select('ledger_row_id,invoice_no,client_name,date,svc_code,svc_name,item_id,description,qty,rate,total,item_notes,sidemark')
    .eq('invoice_no', invoiceNo)
    .neq('status', 'Void')
    .order('date',     { ascending: true })
    .order('svc_code', { ascending: true })
    .order('item_id',  { ascending: true });
  if (billingErr) {
    return jsonResponse({
      success: false,
      error:   `billing read failed: ${billingErr.message}`,
      code:    'BILLING_READ_FAILED',
    }, 500);
  }
  const liveLines: QboLine[] = (billingRows ?? []).map((r) => {
    const row        = r as Record<string, unknown>;
    const svcCode    = String(row.svc_code    ?? '').trim().toUpperCase();
    const dateVal    = String(row.date        ?? '').trim();
    const qty        = Number(row.qty         ?? 1) || 1;
    const rate       = Number(row.rate        ?? 0);
    const total      = Number(row.total       ?? 0);
    const descRaw    = String(row.description ?? '').trim();
    const itemNotes  = String(row.item_notes  ?? '').trim();
    const itemId     = String(row.item_id     ?? '').trim();
    const sidemark   = String(row.sidemark    ?? '').trim();

    // Build description — mirrors GAS at StrideAPI.gs:44438-44482.
    // STOR (storage) lines: "Storage <period> — N day(s) — <description> — Item <id>"
    // Other lines: "<sidemark> — Item <id> — <description> — Billed <date>"
    let exportDesc = descRaw;
    if (svcCode === 'STOR') {
      let periodStr = '';
      if (itemNotes) {
        const m = itemNotes.match(/(\d{2}\/\d{2}\/\d{2,4})\s+to\s+(\d{2}\/\d{2}\/\d{2,4})/);
        if (m) periodStr = `${m[1]} to ${m[2]}`;
      }
      const parts: string[] = [];
      if (periodStr) parts.push(`Storage ${periodStr}`);
      parts.push(`${qty} day(s)`);
      if (descRaw) parts.push(descRaw);
      if (itemId)  parts.push(`Item ${itemId}`);
      exportDesc = parts.join(' — ');
    } else {
      const parts: string[] = [];
      if (sidemark) parts.push(sidemark);
      if (itemId)   parts.push(`Item ${itemId}`);
      if (descRaw)  parts.push(descRaw);
      exportDesc = parts.join(' — ');
      if (dateVal && exportDesc && exportDesc.indexOf(dateVal) === -1) {
        exportDesc = `${exportDesc} — Billed ${dateVal}`;
      }
    }
    return { description: exportDesc || `Invoice ${invoiceNo}`, amount: total, qty, rate };
  });
  if (liveLines.length === 0) {
    return jsonResponse({
      success: false,
      error:   `No non-Void billing rows for invoice ${invoiceNo} — refusing to push empty invoice to QBO.`,
      code:    'NO_BILLING_ROWS',
    }, 400);
  }
  const liveTotal = Math.round(liveLines.reduce((acc, ln) => acc + ln.amount, 0) * 100) / 100;

  // ── Refresh access token via OAuth ──────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await refreshQboAccessToken(qboClientId, qboSecret, qboRefresh);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[qbo-create-invoice-sb] token refresh failed:', msg);
    return jsonResponse({
      error: `QBO OAuth refresh failed: ${msg}`,
      code:  'QBO_AUTH_FAILED',
    }, 502);
  }

  // ── Build QBO Invoice payload ───────────────────────────────────────
  // QBO requires Line[].DetailType='SalesItemLineDetail' with ItemRef.
  // ItemRef is STUB '1' (generic Services Id) — per-svc_code mapping via
  // qbo_loadItemMap_ is GAS-only today (CB Items lookup). Operators can
  // remap on the QBO side after push; the line description + amount are
  // what matter for billing parity.
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueDate  = String(body.dueDate ?? '').trim() || todayIso;

  const qboLines = liveLines.map((ln) => ({
    Amount:      Math.round(ln.amount * 100) / 100,
    DetailType:  'SalesItemLineDetail',
    Description: ln.description,
    SalesItemLineDetail: {
      ItemRef:   { value: '1' },
      Qty:       ln.qty,
      UnitPrice: Math.round(ln.rate * 100) / 100,
    },
  }));

  const invoicePayload: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line:        qboLines,
    TxnDate:     todayIso,
    DueDate:     dueDate,
    // PrivateNote carries the Stride INV# for cross-reference even when
    // QBO auto-assigns DocNumber (v38.121.0 default).
    PrivateNote: `Stride INV# ${invoiceNo}`,
  };
  if (!autoAssign) {
    // Caller wants Stride INV# to be the QBO DocNumber. QBO will reject
    // if Custom Transaction Numbers is OFF (the common Stride setup).
    invoicePayload.DocNumber = invoiceNo;
  }

  // ── POST to QBO ─────────────────────────────────────────────────────
  const qboBase = qboEnv === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
  const qboUrl = `${qboBase}/v3/company/${encodeURIComponent(qboRealmId)}/invoice?minorversion=65`;

  let qboInvoiceId   = '';
  let qboDocNumber   = '';
  let qboInvoiceUrl  = '';
  try {
    const res = await fetch(qboUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify(invoicePayload),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[qbo-create-invoice-sb] QBO API error:', res.status, text.slice(0, 500));
      // Audit log the failure best-effort.
      await writeAudit(sb, tenantId, invoiceNo, callerEmail, 'qbo_push_failed',
        { error: text.slice(0, 1000), status: res.status });
      return jsonResponse({
        success: false,
        error:   `QBO API ${res.status}: ${text.slice(0, 500)}`,
        code:    'QBO_API_ERROR',
      }, 502);
    }
    let parsed: { Invoice?: { Id?: string; DocNumber?: string } };
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    qboInvoiceId = String(parsed.Invoice?.Id ?? '');
    qboDocNumber = String(parsed.Invoice?.DocNumber ?? '');
    if (!qboInvoiceId) {
      await writeAudit(sb, tenantId, invoiceNo, callerEmail, 'qbo_push_failed',
        { error: 'QBO returned 200 but no Invoice.Id in body', code: 'QBO_BAD_RESPONSE' });
      return jsonResponse({
        success: false,
        error:   'QBO returned 200 but no Invoice.Id in body',
        code:    'QBO_BAD_RESPONSE',
      }, 502);
    }
    // The QBO web UI URL for the invoice. Useful for the React toast deep-link.
    qboInvoiceUrl = `https://app.qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(qboInvoiceId)}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[qbo-create-invoice-sb] QBO POST threw:', msg);
    await writeAudit(sb, tenantId, invoiceNo, callerEmail, 'qbo_push_failed',
      { error: msg.slice(0, 1000), code: 'QBO_FETCH_FAILED' });
    return jsonResponse({
      success: false,
      error:   `QBO POST threw: ${msg}`,
      code:    'QBO_FETCH_FAILED',
    }, 502);
  }

  // ── Stamp public.invoice_tracking with confirmed QBO IDs ────────────
  // 2026-05-28 — v38.240.0 companion. Pre-fix this UPDATE wrote only
  // qbo_pushed_at and dropped the captured QBO Id / DocNumber on the
  // floor (the audit log was the only durable cross-reference, but
  // that's not where the Billing report looks). The migration
  // 20260528150000_invoice_tracking_qbo_id_columns.sql adds qbo_invoice_id
  // + qbo_doc_number columns; we now stamp all three together so the
  // Billing report can render the actual QBO Id as proof of confirmation
  // and flag the silent-failure case (qbo_pushed_at SET + qbo_invoice_id
  // NULL) for operator audit.
  //
  // Ordering note: this UPDATE only runs after the QBO POST returned 2xx
  // with a non-empty Invoice.Id (the earlier qboInvoiceId guard at
  // ~line 331 returns 502 if QBO sent 200 with no Id). So qbo_pushed_at
  // is never written without qbo_invoice_id alongside it.
  //
  // invoice_no is the primary key (globally unique via next_invoice_no()
  // atomic sequence) so collision across tenants is impossible by design,
  // but we add the tenant_id filter as defense-in-depth.
  try {
    const { error: itErr } = await sb
      .from('invoice_tracking')
      .update({
        qbo_pushed_at:  new Date().toISOString(),
        qbo_invoice_id: qboInvoiceId,
        qbo_doc_number: qboDocNumber || null,
      })
      .eq('invoice_no', invoiceNo)
      .eq('tenant_id', tenantId);
    if (itErr) console.error('[qbo-create-invoice-sb] invoice_tracking stamp failed:', itErr.message);
  } catch (e) {
    console.error('[qbo-create-invoice-sb] invoice_tracking stamp threw:', e);
  }

  // ── Audit log ───────────────────────────────────────────────────────
  // qbo_invoice_id now lives on invoice_tracking too (v38.240.0); the
  // audit row remains the immutable record of what was returned at push
  // time. Schema: entity_type='billing', entity_id=invoiceNo,
  // action='qbo_push'.
  await writeAudit(sb, tenantId, invoiceNo, callerEmail, 'qbo_push',
    { qboInvoiceId, qboDocNumber, qboInvoiceUrl, lines: liveLines.length, total: liveTotal });

  return jsonResponse({
    success:      true,
    invoiceNo,
    qboInvoiceId,
    qboDocNumber: qboDocNumber || null,
    qboInvoiceUrl,
  }, 200);
});

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * QBO OAuth2 refresh-token grant. Returns a fresh access_token (1 hour
 * lifetime). The refresh_token rotates ~every 24 hours per Intuit's docs;
 * persisting the rotated token is a follow-up (the GAS path stores it in
 * Script Properties — SB equivalent would be a `secrets` row that this
 * function writes to). For now we just use the configured refresh token
 * — admins re-authorize via the existing QBO OAuth flow if it expires.
 *
 * STUB SCOPE: token rotation not persisted. Acceptable until the configured
 * refresh_token nears expiry (~100 days of inactivity per Intuit).
 */
async function refreshQboAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const auth = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens', {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${text.slice(0, 300)}`);
  let parsed: { access_token?: string };
  try { parsed = JSON.parse(text); } catch { throw new Error(`OAuth non-JSON: ${text.slice(0, 200)}`); }
  if (!parsed.access_token) throw new Error('OAuth: no access_token in response');
  return parsed.access_token;
}

async function writeAudit(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  invoiceNo: string,
  callerEmail: string,
  action: string,
  changes: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from('entity_audit_log').insert({
      entity_type:  'billing',
      entity_id:    invoiceNo,
      tenant_id:    tenantId,
      action,
      changes,
      performed_by: callerEmail || 'qbo-create-invoice-sb',
      source:       'supabase',
    });
  } catch (e) {
    console.error('[qbo-create-invoice-sb] audit insert failed:', e);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
