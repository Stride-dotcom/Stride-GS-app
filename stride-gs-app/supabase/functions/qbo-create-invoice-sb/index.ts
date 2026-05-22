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
 *     lines:          [{description, amount, qty?}]  // required, ≥1
 *     dueDate?:       string  "YYYY-MM-DD"       // optional; today if missing
 *     callerEmail?:   string                     // for audit log
 *     requestId?:     string
 *     autoAssignDocNumber?: boolean              // default true (GAS v38.121.0)
 *   }
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

interface QboLine {
  description?: string;
  amount?: number | string;
  qty?: number | string;
  itemRef?: string;       // optional QBO ItemRef.value
}

interface Body {
  tenantId?: string;
  invoiceNo?: string;
  customerId?: string;
  lines?: QboLine[];
  dueDate?: string;
  callerEmail?: string;
  requestId?: string;
  autoAssignDocNumber?: boolean;
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
  const lines       = Array.isArray(body.lines) ? body.lines : [];
  const autoAssign  = body.autoAssignDocNumber !== false;

  if (!tenantId)  return jsonResponse({ error: 'tenantId is required',  code: 'INVALID_PARAMS' }, 400);
  if (!invoiceNo) return jsonResponse({ error: 'invoiceNo is required', code: 'INVALID_PARAMS' }, 400);
  if (lines.length === 0) {
    return jsonResponse({ error: 'lines[] required (≥1 line item)', code: 'INVALID_PARAMS' }, 400);
  }

  const sb = createClient(supabaseUrl, serviceKey);

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
  // If the caller passes itemRef on a line, use it; otherwise fall through
  // to a generic Service item lookup (STUB — we just use Id=1 which most
  // QBO companies have as "Services". Operators should set per-line
  // itemRef from the React side, where item-map resolution is already
  // implemented for the GAS path.)
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueDate  = String(body.dueDate ?? '').trim() || todayIso;

  const qboLines = lines.map((ln, i) => {
    const qty       = Number(ln.qty ?? 1) || 1;
    const unitPrice = Number(ln.amount ?? 0);
    const amount    = qty * unitPrice;
    const itemRef   = String(ln.itemRef ?? '1').trim() || '1';  // STUB fallback
    const desc      = String(ln.description ?? `Line ${i + 1}`);
    return {
      Amount:     Math.round(amount * 100) / 100,
      DetailType: 'SalesItemLineDetail',
      Description: desc,
      SalesItemLineDetail: {
        ItemRef:  { value: itemRef },
        Qty:      qty,
        UnitPrice: Math.round(unitPrice * 100) / 100,
      },
    };
  });

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
    return jsonResponse({
      success: false,
      error:   `QBO POST threw: ${msg}`,
      code:    'QBO_FETCH_FAILED',
    }, 502);
  }

  // ── Stamp public.invoice_tracking.qbo_pushed_at ─────────────────────
  // GAS path writes qbo_pushed_at via a PATCH at StrideAPI.gs:43257.
  // We do the same. Best-effort — the QBO write is committed already.
  try {
    const { error: itErr } = await sb
      .from('invoice_tracking')
      .update({ qbo_pushed_at: new Date().toISOString() })
      .eq('invoice_no', invoiceNo);
    if (itErr) console.error('[qbo-create-invoice-sb] invoice_tracking stamp failed:', itErr.message);
  } catch (e) {
    console.error('[qbo-create-invoice-sb] invoice_tracking stamp threw:', e);
  }

  // ── Audit log ───────────────────────────────────────────────────────
  // No qbo_invoice_id column on billing/invoice_tracking — we record it
  // here as the durable cross-reference instead. Schema: entity_type=
  // 'billing', entity_id=invoiceNo, action='qbo_push'.
  await writeAudit(sb, tenantId, invoiceNo, callerEmail, 'qbo_push',
    { qboInvoiceId, qboDocNumber, qboInvoiceUrl, lines: lines.length });

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
