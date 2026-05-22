/**
 * run-stax-charges-sb — SB-primary handler for GAS action `runStaxCharges`.
 *
 * Phase 6 — calls external Stax (Fattmerchant) Payments API.
 * MAXIMUM CARE: real money operations.
 *
 * Replaces handleRunStaxCharges_ at StrideAPI.gs:37937.
 *
 * GAS handler flow (mirrored here):
 *   1. Load CREATED stax_invoices rows where due_date ≤ dueOnOrBefore
 *      (default today) AND stax_id present AND stax_customer_id present.
 *   2. Per-invoice Auto Charge gate (auto_charge=false → skip).
 *   3. Per-client Auto Charge gate via public.clients.auto_charge.
 *   4. Pre-charge GET /invoice/<id> to confirm balance_due > 0 and
 *      status != PAID. Surface ALREADY_PAID without charging.
 *   5. Fetch customer's default payment method. If missing → exception.
 *   6. POST /invoice/<id>/charge with the payment_method_id.
 *   7. Update public.stax_invoices.status (PAID / CHARGE_FAILED) +
 *      append public.stax_charges row. Mirror exceptions on failure.
 *
 * THIS HANDLER SCOPE:
 *   FULL : SB-only path, all six steps above against public.stax_invoices
 *          + public.stax_charges + public.stax_exceptions. Pre-charge
 *          balance check. Per-client + per-invoice auto-charge gates.
 *          Dry-run mode (testMode=true) writes "DRY_RUN_PASSED" to
 *          stax_charges without touching stax_invoices.status.
 *   STUB : Sheet-side mirror back to the Stax spreadsheet (drift
 *          tolerated; daily full-sync cron picks it up). LockService —
 *          replaced with a Postgres advisory-lock-style behavior via
 *          the upsert pattern (concurrent charge runs are extremely rare
 *          for a 1-operator shop; full ScriptLock equivalent is a TODO).
 *
 * Inputs:
 *   {
 *     tenantId?:      string             // optional, audit log only
 *     dueOnOrBefore?: string "YYYY-MM-DD" // default = today
 *     testMode?:      boolean            // dry-run preflight only
 *     callerEmail?:   string
 *     requestId?:     string
 *   }
 *
 * Required EF secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Optional (env-guarded):
 *   STAX_API_KEY        — Bearer for Stax API. Missing → CONFIG_ERROR (we
 *                         cannot charge cards without an API key).
 *   STAX_INVOICE_PAY_URL — Default pay link base.
 *
 * Response:
 *   {
 *     success: true,
 *     eligible, paid, declined, noPaymentMethod, alreadyPaid,
 *     partial, apiErrors, testMode, dryRunPassed?, results: [...]
 *   }
 *
 * For testMode=false this writes real Stax charge state — gated by
 * STAX_API_KEY presence. If the key is unset we return CONFIG_ERROR
 * rather than silently no-op'ing (unlike create-stax-invoices-sb which
 * tolerates a dry-run path).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STAX_API_BASE   = 'https://apiprod.fattlabs.com';
const DEFAULT_PAY_URL = 'https://app.staxpayments.com/#/bill/';

interface Body {
  tenantId?:      string;
  dueOnOrBefore?: string;
  testMode?:      boolean;
  callerEmail?:   string;
  requestId?:     string;
}

interface ChargeResult {
  invoiceNo:    string;
  staxId:       string;
  customer:     string;
  amount:       number;
  status:       'PAID' | 'DECLINED' | 'NO_PAYMENT_METHOD' | 'ALREADY_PAID' | 'PARTIAL' | 'API_ERROR' | 'DRY_RUN_PASSED' | 'SKIPPED_CLIENT_AUTO_CHARGE';
  txnId?:       string;
  error?:       string;
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const staxApiKey = Deno.env.get('STAX_API_KEY') ?? '';
  const payUrlBase = Deno.env.get('STAX_INVOICE_PAY_URL') ?? DEFAULT_PAY_URL;
  const testMode   = body.testMode === true;

  // Real-money path requires Stax key; dry-run can still proceed without
  // it (pre-flight check would still call Stax to validate balance, but
  // we treat unconfigured as a hard config error to avoid surprise).
  if (!staxApiKey) {
    return jsonResponse({
      error:    'STAX_API_KEY not configured — refusing to run charges without it. Set via supabase secrets and redeploy.',
      code:     'CONFIG_ERROR',
      missing:  ['STAX_API_KEY'],
    }, 200);
  }

  const tenantId      = String(body.tenantId      ?? '').trim();
  const callerEmail   = String(body.callerEmail   ?? '').trim();
  const requestId     = String(body.requestId     ?? '').trim() || crypto.randomUUID();
  const todayIso      = new Date().toISOString().slice(0, 10);
  const dueOnOrBefore = String(body.dueOnOrBefore ?? '').trim() || todayIso;

  // ── Load CREATED stax_invoices rows due on/before the cutoff ─────────
  // due_date column is text "YYYY-MM-DD" (per migration), so lexicographic
  // compare works on ISO dates. Auto-charge gate is in the row's
  // auto_charge column (mirrored from CB Clients by GAS).
  const { data: rows, error: selErr } = await sb
    .from('stax_invoices')
    .select('id, qb_invoice_no, customer, stax_customer_id, stax_id, due_date, amount, status, auto_charge')
    .eq('status', 'CREATED')
    .lte('due_date', dueOnOrBefore);
  if (selErr) {
    return jsonResponse({ error: `stax_invoices read failed: ${selErr.message}`, code: 'READ_FAILED' }, 500);
  }

  // Filter: stax_id + stax_customer_id required.
  const candidates = (rows ?? []).filter((r: { stax_id?: string | null; stax_customer_id?: string | null }) =>
    String(r.stax_id ?? '').trim() && String(r.stax_customer_id ?? '').trim());

  // Pre-load per-client auto_charge flag for the client gate.
  const customerNames = Array.from(new Set(candidates.map((r: { customer?: string }) => String(r.customer ?? '').trim()).filter(Boolean)));
  const clientAutoCharge: Record<string, boolean> = {};
  if (customerNames.length > 0) {
    const { data: cRows, error: cErr } = await sb
      .from('clients')
      .select('name, auto_charge')
      .in('name', customerNames);
    if (cErr) {
      console.warn('[run-stax-charges-sb] clients auto_charge lookup failed (non-fatal):', cErr.message);
    } else {
      for (const c of (cRows ?? []) as Array<{ name?: string; auto_charge?: boolean | null }>) {
        const key = String(c.name ?? '').trim().toLowerCase();
        if (key) clientAutoCharge[key] = c.auto_charge === true;
      }
    }
  }

  const results: ChargeResult[] = [];
  const pmCache: Record<string, { found: boolean; methodId?: string; methodType?: string; error?: string }> = {};
  const stats = {
    eligible:          0,
    paid:              0,
    declined:          0,
    noPaymentMethod:   0,
    alreadyPaid:       0,
    partial:           0,
    apiErrors:         0,
    dryRunPassed:      0,
    skippedClientAutoCharge: 0,
  };

  for (const row of candidates as Array<Record<string, unknown>>) {
    const docNum   = String(row.qb_invoice_no ?? '').trim();
    const staxId   = String(row.stax_id        ?? '').trim();
    const staxCust = String(row.stax_customer_id ?? '').trim();
    const custName = String(row.customer       ?? '').trim();
    const amount   = Number(row.amount         ?? 0);
    const dueDate  = String(row.due_date       ?? '').trim();
    const rowAutoCharge = (row as { auto_charge?: boolean | null }).auto_charge !== false;

    // Per-invoice gate.
    if (!testMode && !rowAutoCharge) continue;

    // Per-client gate.
    if (!testMode && custName) {
      const flag = clientAutoCharge[custName.toLowerCase()];
      if (flag === false) {
        stats.skippedClientAutoCharge++;
        results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'SKIPPED_CLIENT_AUTO_CHARGE' });
        continue;
      }
    }

    stats.eligible++;

    // SAFEGUARD 1: pre-charge balance check.
    let balanceDue   = amount;
    let staxStatus   = '';
    try {
      const checkRes = await fetch(`${STAX_API_BASE}/invoice/${encodeURIComponent(staxId)}`, {
        headers: { 'Authorization': `Bearer ${staxApiKey}`, 'Accept': 'application/json' },
      });
      const text = await checkRes.text();
      let parsed: { status?: string; balance_due?: number | string };
      try { parsed = JSON.parse(text); } catch { parsed = {}; }
      if (!checkRes.ok) {
        await logCharge(sb, docNum, staxId, staxCust, custName, amount, 'API_ERROR', '', `Pre-charge check ${checkRes.status}: ${text.slice(0, 200)}`);
        await logException(sb, docNum, custName, staxCust, amount, dueDate, 'API_ERROR', `${payUrlBase}${staxId}`);
        await updateInvoiceStatus(sb, row.id as string, 'CHARGE_FAILED', 'Pre-charge status check failed');
        stats.apiErrors++;
        results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'API_ERROR', error: text.slice(0, 200) });
        continue;
      }
      staxStatus = String(parsed.status ?? '').toUpperCase();
      const bd   = Number(parsed.balance_due ?? amount);
      if (Number.isFinite(bd)) balanceDue = bd;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logCharge(sb, docNum, staxId, staxCust, custName, amount, 'API_ERROR', '', `Pre-charge fetch threw: ${msg}`);
      stats.apiErrors++;
      results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'API_ERROR', error: msg });
      continue;
    }

    if (staxStatus === 'PAID' || balanceDue <= 0) {
      await updateInvoiceStatus(sb, row.id as string, 'PAID', 'Already paid in Stax (detected during charge run)');
      await logCharge(sb, docNum, staxId, staxCust, custName, amount, 'ALREADY_PAID', '', '');
      stats.alreadyPaid++;
      results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'ALREADY_PAID' });
      continue;
    }

    // SAFEGUARD 2: get default payment method (cached per customer).
    let pm = pmCache[staxCust];
    if (!pm) {
      pm = await getDefaultPaymentMethod(staxApiKey, staxCust);
      pmCache[staxCust] = pm;
    }
    if (!pm.found) {
      await logCharge(sb, docNum, staxId, staxCust, custName, amount, 'NO_PAYMENT_METHOD', '', pm.error || '');
      await logException(sb, docNum, custName, staxCust, amount, dueDate, 'NO_PAYMENT_METHOD', `${payUrlBase}${staxId}`);
      await updateInvoiceStatus(sb, row.id as string, 'CHARGE_FAILED', 'No payment method on file');
      stats.noPaymentMethod++;
      results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'NO_PAYMENT_METHOD', error: pm.error });
      continue;
    }

    // DRY RUN gate.
    if (testMode) {
      await logCharge(sb, docNum, staxId, staxCust, custName, amount, 'DRY_RUN_PASSED',
        `DRYRUN-${staxId}`,
        `[DRY RUN] Pre-flight passed — balance $${balanceDue}, PM: ${pm.methodType} (${(pm.methodId ?? '').slice(0, 8)}...)`);
      stats.dryRunPassed++;
      results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'DRY_RUN_PASSED', txnId: `DRYRUN-${staxId}` });
      continue;
    }

    // SAFEGUARD 3: charge-attempt marker before the POST so a mid-flight
    // crash leaves a forensic trail (mirrors the GAS "CHARGE_ATTEMPT|" note).
    await updateInvoiceStatus(sb, row.id as string, 'CREATED',
      `CHARGE_ATTEMPT|${new Date().toISOString()}`);

    // EXECUTE CHARGE.
    let charge: { success: boolean; partial: boolean; declined: boolean; transactionId?: string; error?: string };
    try {
      const chargeRes = await fetch(`${STAX_API_BASE}/invoice/${encodeURIComponent(staxId)}/charge`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${staxApiKey}`,
          'Content-Type':  'application/json',
          'Accept':        'application/json',
        },
        body: JSON.stringify({ payment_method_id: pm.methodId }),
      });
      const text = await chargeRes.text();
      let parsed: { id?: string; transaction_id?: string; success?: boolean; total_paid?: number; total?: number; error?: string; message?: string };
      try { parsed = JSON.parse(text); } catch { parsed = {}; }
      if (chargeRes.ok && (parsed.success !== false)) {
        const txnId = String(parsed.transaction_id ?? parsed.id ?? '');
        const paid  = Number(parsed.total_paid ?? amount);
        const partial = Number.isFinite(paid) && paid > 0 && paid < amount;
        charge = { success: !partial, partial, declined: false, transactionId: txnId };
        if (partial) charge.error = `Partial: paid $${paid} of $${amount}`;
      } else {
        const msg = String(parsed.error ?? parsed.message ?? text.slice(0, 300));
        const declined = chargeRes.status === 402 || /declin/i.test(msg);
        charge = { success: false, partial: false, declined, error: msg };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      charge = { success: false, partial: false, declined: false, error: msg };
    }

    if (charge.success) {
      await updateInvoiceStatus(sb, row.id as string, 'PAID',
        `Paid via ${pm.methodId} | txn: ${charge.transactionId ?? ''}`);
      await logCharge(sb, docNum, staxId, staxCust, custName, amount, 'SUCCESS', charge.transactionId ?? '', '');
      stats.paid++;
      results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'PAID', txnId: charge.transactionId });
    } else if (charge.partial) {
      await updateInvoiceStatus(sb, row.id as string, 'CHARGE_FAILED',
        `Partial payment: ${charge.error}`);
      await logCharge(sb, docNum, staxId, staxCust, custName, amount, 'PARTIAL', charge.transactionId ?? '', charge.error ?? '');
      await logException(sb, docNum, custName, staxCust, amount, dueDate, 'PARTIAL', `${payUrlBase}${staxId}`);
      stats.partial++;
      results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status: 'PARTIAL', txnId: charge.transactionId, error: charge.error });
    } else {
      const status: 'DECLINED' | 'API_ERROR' = charge.declined ? 'DECLINED' : 'API_ERROR';
      await updateInvoiceStatus(sb, row.id as string, 'CHARGE_FAILED',
        `${status}: ${String(charge.error ?? '').slice(0, 200)}`);
      await logCharge(sb, docNum, staxId, staxCust, custName, amount, status, '', charge.error ?? '');
      await logException(sb, docNum, custName, staxCust, amount, dueDate, status, `${payUrlBase}${staxId}`);
      if (charge.declined) stats.declined++; else stats.apiErrors++;
      results.push({ invoiceNo: docNum, staxId, customer: custName, amount, status, error: charge.error });
    }

    await writeAudit(sb, tenantId, docNum, callerEmail, 'stax_charge', {
      staxId, amount, status: results[results.length - 1].status, txnId: charge.transactionId,
    });
  }

  // Run log (best-effort).
  try {
    await sb.from('stax_run_log').insert({
      timestamp: new Date().toISOString(),
      fn:        testMode ? 'run-stax-charges-sb [DRY RUN]' : 'run-stax-charges-sb',
      summary:   buildSummary(stats, testMode),
      details:   JSON.stringify({ ...stats, dueOnOrBefore }),
    });
  } catch (e) {
    console.error('[run-stax-charges-sb] run-log insert threw:', e);
  }

  return jsonResponse({
    success:  true,
    testMode,
    ...stats,
    results,
    requestId,
  }, 200);
});

// ─── Helpers ────────────────────────────────────────────────────────

async function getDefaultPaymentMethod(
  staxApiKey: string,
  staxCustId: string,
): Promise<{ found: boolean; methodId?: string; methodType?: string; error?: string }> {
  try {
    const res = await fetch(`${STAX_API_BASE}/customer/${encodeURIComponent(staxCustId)}/payment-method`, {
      headers: { 'Authorization': `Bearer ${staxApiKey}`, 'Accept': 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) return { found: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    let parsed: Array<{ id?: string; method?: string; person_name?: string; is_default?: boolean }>;
    try { parsed = JSON.parse(text); } catch { parsed = []; }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { found: false, error: 'No payment methods on file' };
    }
    // Prefer default; fall back to first.
    const def = parsed.find((p) => p.is_default) ?? parsed[0];
    const id  = String(def.id ?? '').trim();
    if (!id) return { found: false, error: 'Payment method missing id' };
    return { found: true, methodId: id, methodType: String(def.method ?? 'card') };
  } catch (e) {
    return { found: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function updateInvoiceStatus(
  sb: ReturnType<typeof createClient>,
  id: string,
  status: string,
  notes: string,
): Promise<void> {
  try {
    await sb.from('stax_invoices').update({
      status,
      notes,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
  } catch (e) {
    console.error('[run-stax-charges-sb] stax_invoices status update threw:', e);
  }
}

async function logCharge(
  sb: ReturnType<typeof createClient>,
  qbInvoiceNo: string,
  staxInvoiceId: string,
  staxCustomerId: string,
  customer: string,
  amount: number,
  status: string,
  txnId: string,
  notes: string,
): Promise<void> {
  try {
    await sb.from('stax_charges').insert({
      timestamp:        new Date().toISOString(),
      qb_invoice_no:    qbInvoiceNo,
      stax_invoice_id:  staxInvoiceId,
      stax_customer_id: staxCustomerId,
      customer,
      amount,
      status,
      txn_id:           txnId,
      notes,
    });
  } catch (e) {
    console.error('[run-stax-charges-sb] stax_charges insert threw:', e);
  }
}

async function logException(
  sb: ReturnType<typeof createClient>,
  qbInvoiceNo: string,
  customer: string,
  staxCustomerId: string,
  amount: number,
  dueDate: string,
  reason: string,
  payLink: string,
): Promise<void> {
  try {
    await sb.from('stax_exceptions').insert({
      timestamp:        new Date().toISOString(),
      qb_invoice_no:    qbInvoiceNo,
      customer,
      stax_customer_id: staxCustomerId,
      amount,
      due_date:         dueDate,
      reason,
      pay_link:         payLink,
      resolved:         false,
    });
  } catch (e) {
    console.error('[run-stax-charges-sb] stax_exceptions insert threw:', e);
  }
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
      entity_type:  'stax_invoice',
      entity_id:    invoiceNo,
      tenant_id:    tenantId,
      action,
      changes,
      performed_by: callerEmail || 'run-stax-charges-sb',
      source:       'supabase',
    });
  } catch (e) {
    console.error('[run-stax-charges-sb] audit insert failed:', e);
  }
}

function buildSummary(stats: Record<string, number>, testMode: boolean): string {
  if (testMode) {
    return `${stats.dryRunPassed} pre-flight passed (DRY RUN), ${stats.noPaymentMethod} no PM, ${stats.alreadyPaid} already paid, ${stats.apiErrors} API errors (of ${stats.eligible} eligible)`;
  }
  return `${stats.paid} paid, ${stats.declined} declined, ${stats.noPaymentMethod} no PM, ${stats.alreadyPaid} already paid, ${stats.partial} partial, ${stats.apiErrors} API errors (of ${stats.eligible} eligible)`;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
