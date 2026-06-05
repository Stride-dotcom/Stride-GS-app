/**
 * create-test-stax-invoice — 100% Supabase test-invoice creator. NO GAS.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md — Phase 6 payments.
 *
 * This is the Stax-migration proving ground: it validates that the Stax
 * (Fattmerchant) Payments API integration works end-to-end through a
 * Supabase Edge Function with zero Apps Script involvement. If a $1 test
 * invoice can be created here and pushed to Stax ready-to-charge, the path
 * for the remaining Stax handlers (createStaxInvoices / runStaxCharges) off
 * GAS is proven.
 *
 * Replaces the GAS round-trip the Payments page used before:
 *   React → apiPost('createTestInvoice') → GAS handleCreateTestInvoice_
 *           → Sheet append → api_sbResyncStaxInvoice_ mirror to SB
 * with a direct call:
 *   React → supabase.functions.invoke('create-test-stax-invoice')
 *           → insert public.stax_invoices → optional Stax POST /invoice
 *
 * What it does:
 *   1. MIG-017 admin/staff role gate (real-money surface; fleet-wide table).
 *   2. Resolves the Stax Customer ID for the named customer:
 *        a. uses body.staxCustomerId if the caller passed it (the UI does);
 *        b. else looks it up on public.clients (name / qb_customer_name /
 *           stax_customer_name, case-insensitive);
 *        c. else — when pushing to Stax — CREATES a Stax customer via
 *           POST /customer and persists the new id back onto public.clients.
 *   3. Inserts a public.stax_invoices row with is_test=true, status='PENDING',
 *      auto_charge=true (mirrors the GAS handler's row shape exactly so the
 *      existing Payments list + the batch create-stax-invoices-sb push EF
 *      both treat it identically).
 *   4. Optionally (pushToStax, default true) POSTs the invoice to Stax
 *      immediately so it shows up in Stax ready to charge, stamping
 *      stax_id + status='CREATED' on the row.
 *   5. Writes entity_audit_log + a stax_run_log mirror (best-effort).
 *
 * Idempotency / honesty:
 *   - Duplicate qb_invoice_no fails closed (DUPLICATE) — the table has a
 *     UNIQUE constraint on qb_invoice_no.
 *   - If the immediate push fails (Stax 4xx / fetch error / key missing) the
 *     PENDING row STILL EXISTS and is pushable later via the batch
 *     create-stax-invoices-sb EF (requirement: that flow keeps working). The
 *     response carries success:false + a real error in that case — never a
 *     green "pushed" on a zero-push (the #632 silent-failure trap).
 *
 * Inputs:
 *   {
 *     customer:        string             // required — client display name
 *     amount:          number             // required — 0.01 .. 100.00
 *     description?:    string             // optional — Stax line-item label
 *     qbInvoiceNo?:    string             // optional — auto TEST-… if blank
 *     dueDate?:        string             // optional — YYYY-MM-DD, else today
 *     staxCustomerId?: string             // optional — pre-resolved by the UI
 *     pushToStax?:     boolean            // optional — default true
 *     tenantId?:       string             // optional — audit only
 *     callerEmail?:    string             // optional — audit only
 *     requestId?:      string
 *   }
 *
 * Required EF secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SUPABASE_ANON_KEY (for the role gate). STAX_API_KEY required only when
 *   pushToStax is true.
 *
 * Auth: deploy with verify_jwt=true (default). supabase.functions.invoke
 *   attaches the caller's session JWT; the role gate reads user_metadata.role.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STAX_API_BASE   = 'https://apiprod.fattlabs.com';
const DEFAULT_PAY_URL  = 'https://app.staxpayments.com/#/bill/';
const TEST_NOTE        = 'Test invoice created from Stride Hub (Supabase)';

interface Body {
  customer?:        string;
  amount?:          number | string;
  description?:     string;
  qbInvoiceNo?:     string;
  dueDate?:         string;
  staxCustomerId?:  string;
  pushToStax?:      boolean;
  tenantId?:        string;
  callerEmail?:     string;
  requestId?:       string;
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

  // ── MIG-017 admin/staff gate ─────────────────────────────────────────
  // public.stax_invoices is FLEET-WIDE (no tenant_id) and a Stax POST is
  // real money. The anon key is bundled in every browser build, so an
  // explicit role check — not just a signed JWT — is the security boundary.
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

  // ── Validate inputs (mirror handleCreateTestInvoice_) ────────────────
  const customer = String(body.customer ?? '').trim();
  if (!customer) return jsonResponse({ error: 'Customer name is required', code: 'MISSING_PARAM' }, 200);

  let amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100) {
    return jsonResponse({ error: 'Amount must be between $0.01 and $100.00', code: 'INVALID_PAYLOAD' }, 200);
  }
  amount = Math.round(amount * 100) / 100;

  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim() || userData.user.email || '';
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const description = String(body.description ?? '').trim() || `Test invoice ${customer}`;
  const pushToStax  = body.pushToStax !== false;   // default true

  const staxApiKey = Deno.env.get('STAX_API_KEY') ?? '';
  const payUrlBase = Deno.env.get('STAX_INVOICE_PAY_URL') ?? DEFAULT_PAY_URL;
  const staxConfigured = !!staxApiKey;

  // ── Resolve the Stax Customer ID ─────────────────────────────────────
  // a) caller-supplied (the Payments UI only offers customers that already
  //    carry a staxId, and passes it through).
  // b) look up public.clients by name / qb_customer_name / stax_customer_name.
  // c) create a Stax customer (only when we're about to push) and persist.
  let staxCustId = String(body.staxCustomerId ?? '').trim();
  let clientRowId: string | null = null;
  let clientEmail = '';

  if (!staxCustId || (pushToStax && staxConfigured)) {
    // Always fetch the client row when we may need to create a customer, so
    // we have an email + a row id to write the new stax_customer_id back to.
    const { data: clientRows, error: clientsErr } = await sb
      .from('clients')
      .select('id, name, email, qb_customer_name, stax_customer_name, stax_customer_id')
      .or(
        `name.ilike.${escapeOr(customer)},` +
        `qb_customer_name.ilike.${escapeOr(customer)},` +
        `stax_customer_name.ilike.${escapeOr(customer)}`,
      )
      .limit(1);
    if (clientsErr) {
      console.warn('[create-test-stax-invoice] clients lookup failed (non-fatal):', clientsErr.message);
    } else if (clientRows && clientRows.length > 0) {
      const c = clientRows[0] as {
        id?: string; email?: string | null; stax_customer_id?: string | null;
      };
      clientRowId = String(c.id ?? '') || null;
      clientEmail = String(c.email ?? '').split(',')[0].trim();
      if (!staxCustId) staxCustId = String(c.stax_customer_id ?? '').trim();
    }
  }

  // c) create a Stax customer if still missing and we're going to push.
  if (!staxCustId && pushToStax && staxConfigured) {
    const created = await createStaxCustomer(staxApiKey, customer, clientEmail);
    if (created.id) {
      staxCustId = created.id;
      // Persist back onto public.clients so future invoices resolve directly.
      if (clientRowId) {
        try {
          await sb.from('clients')
            .update({ stax_customer_id: staxCustId, updated_at: new Date().toISOString() })
            .eq('id', clientRowId);
        } catch (e) {
          console.error('[create-test-stax-invoice] persist stax_customer_id failed:', e);
        }
      }
    } else {
      return jsonResponse({
        success: false,
        error: `Could not create a Stax customer for '${customer}': ${created.error || 'unknown error'}. `
             + `Set a Stax Customer ID on the client record and retry.`,
        code: 'STAX_CUSTOMER_CREATE_FAILED',
        requestId,
      }, 200);
    }
  }

  if (!staxCustId) {
    return jsonResponse({
      success: false,
      error: `Customer '${customer}' has no Stax Customer ID. `
           + `Set one on the client record (or enable push-to-Stax so one can be created) and retry.`,
      code: 'NO_CUSTOMER',
      requestId,
    }, 200);
  }

  // ── Generate / validate the QB Invoice # ─────────────────────────────
  const now = new Date();
  let qbInvoiceNo = String(body.qbInvoiceNo ?? '').trim();
  if (qbInvoiceNo) {
    const { data: dup, error: dupErr } = await sb
      .from('stax_invoices')
      .select('id')
      .eq('qb_invoice_no', qbInvoiceNo)
      .limit(1);
    if (dupErr) {
      return jsonResponse({ error: `stax_invoices read failed: ${dupErr.message}`, code: 'READ_FAILED' }, 500);
    }
    if (dup && dup.length > 0) {
      return jsonResponse({ success: false, error: `Invoice # '${qbInvoiceNo}' already exists`, code: 'DUPLICATE', requestId }, 200);
    }
  } else {
    qbInvoiceNo = `TEST-${laStamp(now)}`;
  }

  const today    = laDate(now);
  const dueDate  = String(body.dueDate ?? '').trim() || today;
  const nowIso   = now.toISOString();
  const lineItems = [{ description, quantity: 1, price: amount }];
  const lineItemsJson = JSON.stringify(lineItems);

  // ── Insert the PENDING stax_invoices row ─────────────────────────────
  const insertRow = {
    qb_invoice_no:    qbInvoiceNo,
    customer,
    stax_customer_id: staxCustId,
    invoice_date:     today,
    due_date:         dueDate,
    amount,
    line_items_json:  lineItemsJson,
    stax_id:          '',
    status:           'PENDING',
    created_at_sheet: laStamp2(now),
    notes:            TEST_NOTE,
    is_test:          true,
    auto_charge:      true,
    updated_at:       nowIso,
  };
  const { data: inserted, error: insErr } = await sb
    .from('stax_invoices')
    .insert(insertRow)
    .select('id')
    .single();
  if (insErr || !inserted) {
    // 23505 = unique_violation (race on qb_invoice_no).
    const dupRace = String(insErr?.code ?? '') === '23505';
    return jsonResponse({
      success: false,
      error: dupRace
        ? `Invoice # '${qbInvoiceNo}' already exists`
        : `Failed to create test invoice: ${insErr?.message ?? 'insert returned no row'}`,
      code: dupRace ? 'DUPLICATE' : 'INSERT_FAILED',
      requestId,
    }, 200);
  }
  const rowId = String((inserted as { id: string }).id);

  await writeAudit(sb, tenantId, qbInvoiceNo, callerEmail, 'stax_create_test',
    { amount, customer, staxCustomerId: staxCustId, isTest: true });

  // ── Optionally push to Stax immediately ──────────────────────────────
  let staxId = '';
  let pushed = false;
  let pushError: string | null = null;

  if (pushToStax) {
    if (!staxConfigured) {
      pushError = 'STAX_API_KEY is not configured on this Edge Function';
    } else {
      const subtotal = amount;            // single test line; tax 0
      const staxPayload: Record<string, unknown> = {
        customer_id: staxCustId,
        total:       amount,
        url:         payUrlBase,
        meta: {
          subtotal,
          tax: 0,
          memo: `Test ${qbInvoiceNo} - ${customer}`,
          reference: qbInvoiceNo,
          invoiceNumber: qbInvoiceNo,
          lineItems,
        },
      };
      if (dueDate) staxPayload.due_at = `${dueDate} 00:00:00`;

      try {
        const res = await fetch(`${STAX_API_BASE}/invoice`, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${staxApiKey}`,
            'Content-Type':  'application/json',
            'Accept':        'application/json',
          },
          body: JSON.stringify(staxPayload),
        });
        const text = await res.text();
        let parsed: { id?: string; message?: string };
        try { parsed = JSON.parse(text); } catch { parsed = {}; }
        if (res.ok && parsed.id) {
          staxId = String(parsed.id);
        } else {
          pushError = `Stax API error: ${(parsed.message || text.slice(0, 200)) || `HTTP ${res.status}`}`;
        }
      } catch (e) {
        pushError = `Stax request failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (staxId) {
      const { error: updErr } = await sb
        .from('stax_invoices')
        .update({
          stax_id:    staxId,
          status:     'CREATED',
          notes:      `${TEST_NOTE} — pushed to Stax at ${nowIso}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);
      if (updErr) {
        console.error('[create-test-stax-invoice] row update after push failed:', updErr.message);
        pushError = `Stax invoice ${staxId} created, but updating the Supabase row failed: ${updErr.message}`;
      } else {
        pushed = true;
        await writeAudit(sb, tenantId, qbInvoiceNo, callerEmail, 'stax_create',
          { staxId, amount, customer, isTest: true });
      }
    } else if (pushError) {
      // Push failed; row stays PENDING so the batch push EF can retry it.
      await logException(sb, qbInvoiceNo, customer, staxCustId, amount, dueDate,
        `API_ERROR: ${pushError.slice(0, 150)}`, '');
    }
  }

  const status = pushed ? 'CREATED' : 'PENDING';
  const summary = pushed
    ? `Test invoice ${qbInvoiceNo} created in Stax ($${amount.toFixed(2)}, ${customer})`
    : pushToStax
      ? `Test invoice ${qbInvoiceNo} staged as PENDING — Stax push failed: ${pushError}`
      : `Test invoice ${qbInvoiceNo} staged as PENDING ($${amount.toFixed(2)}, ${customer})`;

  // run-log mirror (best-effort).
  try {
    await sb.from('stax_run_log').insert({
      timestamp: new Date().toISOString(),
      fn:        'create-test-stax-invoice',
      summary,
      details:   JSON.stringify({ qbInvoiceNo, customer, amount, staxCustId, pushed, staxId, pushError }),
    });
  } catch (e) {
    console.error('[create-test-stax-invoice] run-log insert threw:', e);
  }

  // ── Response ──────────────────────────────────────────────────────────
  // When a push was requested but failed, surface success:false + error so
  // the UI never shows a false "pushed" (the #632 silent-failure guard). The
  // PENDING row still exists and is reported, so the operator can push it via
  // Create Stax Invoices.
  if (pushToStax && !pushed) {
    return jsonResponse({
      success:        false,
      error:          `Test invoice ${qbInvoiceNo} was staged (PENDING) but NOT pushed to Stax: ${pushError}. `
                    + `Use "Create Stax Invoices" to retry the push.`,
      code:           !staxConfigured ? 'STAX_NOT_CONFIGURED' : 'STAX_CREATE_FAILED',
      qbInvoiceNo,
      customer,
      amount,
      isTest:         true,
      staxCustomerId: staxCustId,
      staxId:         '',
      status,
      pushed:         false,
      summary,
      requestId,
    }, 200);
  }

  return jsonResponse({
    success:        true,
    qbInvoiceNo,
    customer,
    amount,
    isTest:         true,
    staxCustomerId: staxCustId,
    staxId,
    status,
    pushed,
    summary,
    requestId,
  }, 200);
});

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Create a customer in Stax via POST /customer. Returns { id } on success
 * or { error } on failure. Maps the Stride customer name into Stax's
 * firstname/company fields and the client email if we have one.
 */
async function createStaxCustomer(
  apiKey: string,
  name: string,
  email: string,
): Promise<{ id?: string; error?: string }> {
  try {
    const payload: Record<string, unknown> = {
      firstname: name,
      company:   name,
    };
    if (email) payload.email = email;
    const res = await fetch(`${STAX_API_BASE}/customer`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: { id?: string; message?: string };
    try { parsed = JSON.parse(text); } catch { parsed = {}; }
    if (res.ok && parsed.id) return { id: String(parsed.id) };
    return { error: (parsed.message || text.slice(0, 200)) || `HTTP ${res.status}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Escape a value for use inside a PostgREST `.or(...)` ilike filter. */
function escapeOr(v: string): string {
  // Commas and parens break the or() grammar; strip them and wrap in
  // wildcards for a forgiving match. PostgREST treats `*` as the ilike `%`.
  return `*${v.replace(/[,()]/g, ' ').trim()}*`;
}

/** YYYY-MM-DD in America/Los_Angeles (matches the GAS sheet date). */
function laDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** YYYYMMDD-HHmmss in America/Los_Angeles (matches the GAS TEST-… suffix). */
function laStamp(d: Date): string {
  const p = laParts(d);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

/** "YYYY-MM-DD HH:mm:ss" in America/Los_Angeles (matches GAS "Created At"). */
function laStamp2(d: Date): string {
  const p = laParts(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function laParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = part.value;
  // hour can come back as "24" at midnight under hour12:false on some runtimes
  if (out.hour === '24') out.hour = '00';
  return out;
}

async function logException(
  sb: ReturnType<typeof createClient>,
  qbInvoiceNo: string,
  customer:    string,
  staxCustId:  string,
  amount:      number,
  dueDate:     string,
  reason:      string,
  detail:      string,
): Promise<void> {
  try {
    await sb.from('stax_exceptions').insert({
      timestamp:        new Date().toISOString(),
      qb_invoice_no:    qbInvoiceNo,
      customer,
      stax_customer_id: staxCustId,
      amount,
      due_date:         dueDate,
      reason:           reason + (detail ? ` — ${detail}` : ''),
      pay_link:         '',
      resolved:         false,
    });
  } catch (e) {
    console.error('[create-test-stax-invoice] exception insert failed:', e);
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
      performed_by: callerEmail || 'create-test-stax-invoice',
      source:       'supabase',
    });
  } catch (e) {
    console.error('[create-test-stax-invoice] audit insert failed:', e);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
