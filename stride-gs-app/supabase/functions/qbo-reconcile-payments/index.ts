/**
 * qbo-reconcile-payments — SB-PRIMARY handler for GAS action
 * `qboReconcileInvoices`. NO GAS involvement.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md — Phase 6 payments
 *                  cluster. CALLS external QuickBooks Online API.
 *
 * Native Deno port of handleQboReconcileInvoices_ (StrideAPI.gs:45944,
 * v38.242.0). Pulls payment status back from QBO for every pushed invoice
 * in scope and writes it onto public.invoice_tracking. Closes the gap
 * between "Stride pushed the invoice to QBO" and "the customer has
 * actually paid it".
 *
 * Two QBO-side match strategies (used in order, same as GAS):
 *   1. Per-id GET /invoice/{id}  — for invoice_tracking rows that already
 *      have qbo_invoice_id stamped (the post-v38.240 happy path). One
 *      round-trip per invoice; always returns Balance + TotalAmt.
 *   2. Bulk Query API  — for rows WITHOUT qbo_invoice_id (historical /
 *      pre-fix backfill). Paginated `SELECT ... FROM Invoice WHERE TxnDate
 *      >= '<floor>' MAXRESULTS 1000 STARTPOSITION n`. Match key resolution
 *      is DocNumber → invoice_no first, then parse PrivateNote for
 *      "Stride INV# X" — covers both pre-v38.121.0 (DocNumber == our INV#)
 *      and post-v38.121.0 (QBO auto-assigns DocNumber, INV# in PrivateNote)
 *      push paths.
 *
 * Payload (all optional — defaults to "every pushed-but-unverified row"):
 *   {
 *     invoiceNos?:      string[]      // explicit subset (the visible list)
 *     sinceDate?:       "YYYY-MM-DD"  // date-bounded backfill
 *     includeUnpushed?: boolean       // include qbo_pushed_at IS NULL rows.
 *                                     // Default false (not in QBO by defn).
 *     limit?:           number        // safety cap per call. Default 500,
 *                                     // hard-capped at 2000.
 *   }
 *
 * Response:
 *   {
 *     success:  true,
 *     scanned:  number,    // rows pulled from invoice_tracking
 *     verified: number,    // rows matched to a QBO invoice
 *     paid:     number,    // matched + Balance == 0
 *     unpaid:   number,    // matched + Balance > 0
 *     missing:  number,    // pushed-per-Stride but no QBO match
 *     errors:   number,    // QBO-side failures (token / network / 5xx)
 *     results:  [{ invoiceNo, status, qboInvoiceId, qboDocNumber,
 *                  qboBalance, qboPaid, totalAmt, errorMessage }, ...]
 *   }
 *
 * Status values: 'verified' | 'missing' | 'error'.
 *
 * Auth: two accepted callers —
 *   (a) admin user JWT  — the React "Reconcile with QBO" button. We
 *       validate the bearer via auth.getUser and require role 'admin'
 *       (mirrors the GAS withAdminGuard_ on this action).
 *   (b) service-role key — the pg_cron daily sweep (see migration
 *       20260604xxxxxx_qbo_reconcile_cron.sql). Bearer == the EF's own
 *       SUPABASE_SERVICE_ROLE_KEY bypasses the user-role check.
 *
 * Required Edge Function secrets:
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * Optional:
 *   QBO_ENVIRONMENT — 'production' (default) | 'sandbox'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Body {
  invoiceNos?: string[];
  sinceDate?: string;
  includeUnpushed?: boolean;
  limit?: number;
  callerEmail?: string;
  requestId?: string;
}

interface ReconcileResult {
  invoiceNo: string;
  status: 'verified' | 'missing' | 'error';
  qboInvoiceId: string | null;
  qboDocNumber: string | null;
  qboBalance: number | null;
  qboPaid: boolean;
  totalAmt: number | null;
  errorMessage: string | null;
}

// invoice_tracking row shape (only the columns we read).
interface ItRow {
  invoice_no: string;
  tenant_id: string | null;
  client_name: string | null;
  total: number | null;
  qbo_invoice_id: string | null;
  qbo_doc_number: string | null;
  qbo_pushed_at: string | null;
  qbo_last_verified_at: string | null;
}

// Raw QBO Invoice (only fields we touch).
interface QboInvoice {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
  PrivateNote?: string;
  TxnDate?: string;
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
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
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
      error: `QBO not configured on this Edge Function — set ${missing.join(', ')} via supabase secrets`,
      code:  'CONFIG_ERROR',
      missing,
    }, 200);
  }

  // ── Auth: admin user JWT OR service-role (cron) ─────────────────────
  const authHeader  = req.headers.get('Authorization') || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) {
    return jsonResponse({ error: 'Authorization header required', code: 'UNAUTHENTICATED' }, 401);
  }
  let callerEmail = String(body.callerEmail ?? '').trim();
  const isServiceRole = callerToken === serviceKey;
  if (!isServiceRole) {
    // User-JWT path — must be an admin (matches GAS withAdminGuard_).
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: authErr } = await authClient.auth.getUser(callerToken);
    if (authErr || !userData?.user) {
      return jsonResponse({ error: 'Invalid token', code: 'UNAUTHENTICATED' }, 401);
    }
    const callerRole = String((userData.user.user_metadata as { role?: string })?.role ?? '').toLowerCase();
    if (callerRole !== 'admin') {
      return jsonResponse({ error: 'admin role required', code: 'FORBIDDEN' }, 403);
    }
    if (!callerEmail) callerEmail = String(userData.user.email ?? '').trim();
  } else if (!callerEmail) {
    callerEmail = 'qbo-reconcile-cron';
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // ── Resolve the set of invoice_tracking rows to reconcile ───────────
  const explicitInvoiceNos = Array.isArray(body.invoiceNos)
    ? body.invoiceNos.map((n) => String(n ?? '').trim()).filter(Boolean)
    : null;
  const sinceDate = String(body.sinceDate ?? '').trim();
  const includeUnpushed = body.includeUnpushed === true;
  const limit = Math.max(1, Math.min(2000, Number(body.limit) || 500));

  const COLS = 'invoice_no,tenant_id,client_name,total,qbo_invoice_id,qbo_doc_number,qbo_pushed_at,qbo_last_verified_at';
  let query = sb.from('invoice_tracking').select(COLS);
  if (explicitInvoiceNos && explicitInvoiceNos.length > 0) {
    query = query.in('invoice_no', explicitInvoiceNos);
  } else if (sinceDate) {
    query = query.gte('invoice_date', sinceDate);
    if (!includeUnpushed) query = query.not('qbo_pushed_at', 'is', null);
  } else {
    // Default: every pushed row, oldest-unverified first.
    query = query
      .not('qbo_pushed_at', 'is', null)
      .order('qbo_last_verified_at', { ascending: true, nullsFirst: true });
  }
  query = query.limit(limit);

  const { data: itData, error: itErr } = await query;
  if (itErr) {
    return jsonResponse({ success: false, error: `invoice_tracking read failed: ${itErr.message}`, code: 'IT_READ_FAILED' }, 500);
  }
  const rows = (itData ?? []) as unknown as ItRow[];
  if (rows.length === 0) {
    return jsonResponse({ success: true, scanned: 0, verified: 0, paid: 0, unpaid: 0, missing: 0, errors: 0, results: [] }, 200);
  }

  // Index by invoice_no for fast lookups on persist.
  const rowByInvoiceNo: Record<string, ItRow> = {};
  for (const r of rows) rowByInvoiceNo[String(r.invoice_no)] = r;

  // ── Refresh QBO access token ────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await refreshQboAccessToken(qboClientId, qboSecret, qboRefresh);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[qbo-reconcile-payments] token refresh failed:', msg);
    return jsonResponse({ success: false, error: `QBO OAuth refresh failed: ${msg}`, code: 'QBO_AUTH_FAILED' }, 502);
  }

  const qboBase = qboEnv === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

  const results: Record<string, ReconcileResult> = {};
  const withId    = rows.filter((r) => String(r.qbo_invoice_id ?? '').trim() !== '');
  const withoutId = rows.filter((r) => String(r.qbo_invoice_id ?? '').trim() === '');
  const nowIso = new Date().toISOString();

  // ── Phase 1: per-id GET for rows with qbo_invoice_id stamped ────────
  for (let wi = 0; wi < withId.length; wi++) {
    const row  = withId[wi];
    const invNo = String(row.invoice_no);
    const qboId = String(row.qbo_invoice_id);
    try {
      const resp = await qboApiGet(qboBase, qboRealmId, `invoice/${encodeURIComponent(qboId)}`, accessToken);
      if (resp.ok && resp.data?.Invoice) {
        results[invNo] = buildResult(invNo, resp.data.Invoice as QboInvoice);
      } else if (resp.status === 404 || /not\s*found|ResourceNotFound/i.test(resp.errorText)) {
        results[invNo] = {
          invoiceNo: invNo, status: 'missing', qboInvoiceId: qboId,
          qboDocNumber: row.qbo_doc_number || null, qboBalance: null, qboPaid: false,
          totalAmt: null, errorMessage: `QBO reports no invoice with Id ${qboId}`,
        };
      } else {
        results[invNo] = {
          invoiceNo: invNo, status: 'error', qboInvoiceId: qboId,
          qboDocNumber: row.qbo_doc_number || null, qboBalance: null, qboPaid: false,
          totalAmt: null, errorMessage: resp.errorText || `QBO GET failed (${resp.status})`,
        };
      }
    } catch (e) {
      results[invNo] = {
        invoiceNo: invNo, status: 'error', qboInvoiceId: qboId,
        qboDocNumber: row.qbo_doc_number || null, qboBalance: null, qboPaid: false,
        totalAmt: null, errorMessage: e instanceof Error ? e.message : String(e),
      };
    }
    // Light rate-limit nudge. QBO production allows ~500 req/min.
    if (wi < withId.length - 1) await sleep(50);
  }

  // ── Phase 2: bulk Query API for rows without qbo_invoice_id ─────────
  let fetched = 0;
  let floorDate = sinceDate;
  if (withoutId.length > 0) {
    // Compute a TxnDate floor. Caller sinceDate wins; else earliest
    // qbo_pushed_at minus 7 days; else 90 days back.
    if (!floorDate) {
      let minPushedAt: string | null = null;
      for (const r of withoutId) {
        const ts = r.qbo_pushed_at;
        if (ts && (!minPushedAt || ts < minPushedAt)) minPushedAt = ts;
      }
      const base = minPushedAt ? new Date(minPushedAt) : new Date();
      base.setDate(base.getDate() - (minPushedAt ? 7 : 90));
      floorDate = base.toISOString().slice(0, 10);
    }

    const byInvoiceNo: Record<string, ItRow> = {};
    for (const r of withoutId) byInvoiceNo[String(r.invoice_no)] = r;

    const pageSize = 1000;
    let pageStart = 1;
    const maxPages = 10; // 10,000-invoice ceiling — Stride is far below this.
    for (let pg = 0; pg < maxPages; pg++) {
      const sql = `select Id, DocNumber, TotalAmt, Balance, PrivateNote, TxnDate from Invoice ` +
                  `where TxnDate >= '${floorDate}' MAXRESULTS ${pageSize} STARTPOSITION ${pageStart}`;
      let pageResp: QboGetResult;
      try {
        pageResp = await qboApiGet(qboBase, qboRealmId, `query?query=${encodeURIComponent(sql)}`, accessToken);
      } catch (qe) {
        console.error(`[qbo-reconcile-payments] bulk page ${pg} threw:`, qe instanceof Error ? qe.message : String(qe));
        break;
      }
      const qr = pageResp.data?.QueryResponse as { Invoice?: QboInvoice[] } | undefined;
      if (!pageResp.ok || !qr) {
        console.error(`[qbo-reconcile-payments] bulk page ${pg} no QueryResponse:`, pageResp.errorText);
        break;
      }
      const pageInvoices = qr.Invoice ?? [];
      if (pageInvoices.length === 0) break;
      fetched += pageInvoices.length;

      for (const qInv of pageInvoices) {
        const qDoc  = String(qInv.DocNumber ?? '').trim();
        const qNote = String(qInv.PrivateNote ?? '');
        let matchedInvNo: string | null = null;
        if (qDoc && byInvoiceNo[qDoc]) matchedInvNo = qDoc;
        if (!matchedInvNo && qNote) {
          const m = qNote.match(/Stride\s+(?:Ref|INV#?)\s*:?\s*(INV-\d+)/i);
          if (m && byInvoiceNo[m[1]]) matchedInvNo = m[1];
        }
        if (matchedInvNo && !results[matchedInvNo]) {
          results[matchedInvNo] = buildResult(matchedInvNo, qInv);
        }
      }

      if (pageInvoices.length < pageSize) break;
      pageStart += pageSize;
    }

    // Any withoutId row not matched is "missing".
    for (const uRow of withoutId) {
      const uInvNo = String(uRow.invoice_no);
      if (!results[uInvNo]) {
        results[uInvNo] = {
          invoiceNo: uInvNo, status: 'missing', qboInvoiceId: null,
          qboDocNumber: uRow.qbo_doc_number || null, qboBalance: null, qboPaid: false,
          totalAmt: null,
          errorMessage: `Pushed per Stride but no matching QBO invoice (searched DocNumber + PrivateNote since ${floorDate}, ${fetched} invoices scanned)`,
        };
      }
    }
  }

  // ── Persist results to invoice_tracking + entity_audit_log ──────────
  let verified = 0, paid = 0, unpaid = 0, missingCount = 0, errorCount = 0;
  const resultList: ReconcileResult[] = [];

  for (const invNo of Object.keys(results)) {
    const r = results[invNo];
    resultList.push(r);
    const srcRow = rowByInvoiceNo[invNo] || ({} as ItRow);

    if (r.status === 'verified') {
      verified++;
      if (r.qboPaid) paid++; else unpaid++;
      const { error: upErr } = await sb.from('invoice_tracking').update({
        qbo_invoice_id:       r.qboInvoiceId || srcRow.qbo_invoice_id || null,
        qbo_doc_number:       r.qboDocNumber || srcRow.qbo_doc_number || null,
        qbo_balance:          r.qboBalance,
        qbo_paid:             !!r.qboPaid,
        qbo_last_verified_at: nowIso,
      }).eq('invoice_no', invNo);
      if (upErr) console.error(`[qbo-reconcile-payments] update ${invNo} failed:`, upErr.message);
    } else if (r.status === 'missing') {
      missingCount++;
      // Don't clear qbo_pushed_at (that's the operator's signal Stride
      // thought it was pushed). Stamp verified_at so it drops out of the
      // next pass's "never verified" bucket, and audit-log the discrepancy.
      const { error: upErr } = await sb.from('invoice_tracking')
        .update({ qbo_last_verified_at: nowIso })
        .eq('invoice_no', invNo);
      if (upErr) console.error(`[qbo-reconcile-payments] missing-stamp ${invNo} failed:`, upErr.message);
      // Surface the discrepancy in the Billing Activity feed (same table
      // + action the GAS handler wrote via api_logBillingActivity_).
      await logBillingActivity(sb, {
        tenant_id:      String(srcRow.tenant_id ?? ''),
        client_name:    srcRow.client_name ?? null,
        action:         'qbo_push_failed',
        status:         'failure',
        invoice_no:     invNo,
        qbo_invoice_id: r.qboInvoiceId,
        qbo_doc_number: r.qboDocNumber,
        summary:        `QBO reconcile: invoice ${invNo} marked pushed in Stride but QBO has no record`,
        error_message:  r.errorMessage || 'QBO has no matching invoice',
        details:        { source: 'qboReconcileInvoices', verifiedAt: nowIso },
        performed_by:   callerEmail || 'qbo-reconcile-payments',
      });
    } else {
      errorCount++;
    }
  }

  return jsonResponse({
    success:  true,
    scanned:  rows.length,
    verified,
    paid,
    unpaid,
    missing:  missingCount,
    errors:   errorCount,
    results:  resultList,
  }, 200);
});

// ─── Helpers ─────────────────────────────────────────────────────────

interface QboGetResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  errorText: string;
}

/**
 * GET against the QBO API with a small retry on 429 / 5xx (QBO throttles
 * aggressive bursts). minorversion=65 matches qbo-create-invoice-sb.
 */
async function qboApiGet(
  base: string,
  realmId: string,
  path: string,
  accessToken: string,
): Promise<QboGetResult> {
  const url = `${base}/v3/company/${encodeURIComponent(realmId)}/${path}` +
              `${path.includes('?') ? '&' : '?'}minorversion=65`;
  const backoffs = [400, 1000];
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept':        'application/json',
      },
    });
    const text = await res.text();
    if (res.ok) {
      let data: Record<string, unknown> | null = null;
      try { data = JSON.parse(text); } catch { data = null; }
      return { ok: true, status: res.status, data, errorText: '' };
    }
    // Retry transient throttle / server errors only.
    if ((res.status === 429 || res.status >= 500) && attempt < backoffs.length) {
      await sleep(backoffs[attempt]);
      continue;
    }
    return { ok: false, status: res.status, data: null, errorText: text.slice(0, 500) };
  }
  return { ok: false, status: 0, data: null, errorText: 'exhausted retries' };
}

/**
 * Build a normalized verified result from a raw QBO Invoice. Balance == 0
 * means fully paid. Mirrors qbo_reconcileBuildResult_ in GAS.
 */
function buildResult(invoiceNo: string, qboInvoice: QboInvoice): ReconcileResult {
  const balance  = Number(qboInvoice.Balance != null ? qboInvoice.Balance : 0);
  const totalAmt = Number(qboInvoice.TotalAmt != null ? qboInvoice.TotalAmt : 0);
  return {
    invoiceNo,
    status:       'verified',
    qboInvoiceId: String(qboInvoice.Id ?? ''),
    qboDocNumber: String(qboInvoice.DocNumber ?? '') || null,
    qboBalance:   balance,
    qboPaid:      balance === 0,
    totalAmt,
    errorMessage: null,
  };
}

/**
 * QBO OAuth2 refresh-token grant. Returns a fresh access_token (1h life).
 * Identical to qbo-create-invoice-sb's helper. Token rotation is not
 * persisted (STUB — acceptable until the configured refresh_token nears
 * its ~100-day inactivity expiry).
 */
async function refreshQboAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const auth = btoa(`${clientId}:${clientSecret}`);
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
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

/**
 * Insert a billing_activity_log row. Used for the "missing in QBO"
 * discrepancy so it surfaces in the Billing Activity feed (parity with
 * the GAS handler's api_logBillingActivity_).
 */
async function logBillingActivity(
  sb: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from('billing_activity_log').insert(row);
  } catch (e) {
    console.error('[qbo-reconcile-payments] billing_activity_log insert failed:', e);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
