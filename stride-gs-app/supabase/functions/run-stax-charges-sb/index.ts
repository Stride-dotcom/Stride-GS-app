/**
 * run-stax-charges-sb — [MIGRATION-P6] SHADOW for `runStaxCharges`.
 *
 * GAS answer key: handleRunStaxCharges_ (StrideAPI.gs:36817), doPost
 * action "runStaxCharges". The single highest-risk payment path in the
 * system ("MAXIMUM CARE — real money operations"). Returns { eligible,
 * paid, dryRunPassed, declined, noPaymentMethod, alreadyPaid, partial,
 * apiErrors, testMode, summary }.
 *
 * Shadow contract: COMPUTE which CREATED invoices WOULD be charged and
 * the amounts — apply every gate GAS applies up to the Stax API
 * boundary (status=CREATED, has Stax Invoice ID + Customer ID, due
 * date ≤ today PT, per-invoice Auto Charge, per-client Auto Charge),
 * then STOP. Never call GET /invoice, never call /charge, never write
 * the sheet. Returns the eligible set + counts for parity comparison.
 *
 * State source: `public.stax_invoices` (mirror of the Stax Invoices
 * sheet) + `public.clients` (per-client Auto Charge flag).
 *
 * STRUCTURAL OMISSIONS (documented for the parity reviewer — these are
 * money-moving / Stax-API-only steps a shadow cannot and must not
 * perform, so the counts stay 0):
 *  - paid / declined / partial / apiErrors — require POST /charge.
 *  - alreadyPaid — requires the pre-charge GET /invoice status check.
 *  - noPaymentMethod — requires GET /customer/{id}/payment-method.
 *  - dryRunPassed — GAS increments this only AFTER the live pre-flight
 *    (status + payment-method) passes; a shadow has no pre-flight, so
 *    it reports the eligible set instead. `eligible` and
 *    `skippedClientAutoCharge` ARE computed and parity-meaningful.
 *
 * MIG-008: no Stax / QBO / Resend client is constructed —
 * EXTERNAL_PAYMENT_CALLS = false. The only client is the read-only
 * Supabase service-role mirror reader. There is NO code path in this
 * file that can move money.
 *
 * Request:  POST { testMode?: boolean, requestId?: string }
 * Response: { ok, eligible, paid, dryRunPassed, declined,
 *             noPaymentMethod, alreadyPaid, partial, apiErrors,
 *             skippedClientAutoCharge, testMode, summary, computed }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { staxParseDateForStax, formatDatePacific } from '../_shared/stax-iif-shadow.ts';

const EXTERNAL_PAYMENT_CALLS = false; // MIG-008 invariant — never flip.

interface EligibleInvoice {
  docNum: string;
  staxInvoiceId: string;
  staxCustomerId: string;
  customer: string;
  amount: number;
  dueDate: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let payload: { testMode?: boolean };
  try {
    payload = await req.json();
  } catch (e) {
    return json({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
  const testMode = payload?.testMode === true;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Server misconfigured (no Supabase mirror access)' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Per-client Auto Charge map (GAS reads CB Clients CLIENT NAME → AUTO
  // CHARGE; only an explicit FALSE skips — not-found proceeds).
  const clientAutoChargeMap: Record<string, boolean> = {};
  try {
    const { data: clients, error } = await sb
      .from('clients')
      .select('name,auto_charge')
      .eq('active', true);
    if (error) throw error;
    for (const c of clients ?? []) {
      const cn = String(c.name ?? '').trim().toLowerCase();
      if (cn) clientAutoChargeMap[cn] = c.auto_charge === true;
    }
  } catch (e) {
    console.log(`run-stax-charges-sb client auto-charge load failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  let invRows: Array<Record<string, unknown>> = [];
  try {
    const { data, error } = await sb
      .from('stax_invoices')
      .select('qb_invoice_no,customer,stax_customer_id,due_date,amount,stax_id,status,auto_charge');
    if (error) throw error;
    invRows = data ?? [];
  } catch (e) {
    return json({ ok: false, error: `stax_invoices read failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  const today = formatDatePacific(new Date());

  const stats = {
    eligible: 0,
    paid: 0,                    // structurally 0 in shadow (no POST /charge)
    dryRunPassed: 0,            // structurally 0 in shadow (no pre-flight)
    declined: 0,                // structurally 0 in shadow
    noPaymentMethod: 0,         // structurally 0 in shadow
    alreadyPaid: 0,             // structurally 0 in shadow
    partial: 0,                 // structurally 0 in shadow
    apiErrors: 0,               // structurally 0 in shadow
    skippedClientAutoCharge: 0,
  };
  const eligibleInvoices: EligibleInvoice[] = [];

  for (const r of invRows) {
    const status = String(r.status ?? '').trim().toUpperCase();
    const staxInvId = String(r.stax_id ?? '').trim();
    const staxCustId = String(r.stax_customer_id ?? '').trim();
    const dueDate = r.due_date;
    const totalRaw = r.amount;
    const docNum = String(r.qb_invoice_no ?? '').trim();
    const custName = String(r.customer ?? '').trim();

    // Gate checks (GAS lines 36897-36914).
    if (status !== 'CREATED') continue;
    if (!staxInvId) continue;
    if (!staxCustId) continue;

    const dueDateFormatted = staxParseDateForStax(dueDate);
    if (!dueDateFormatted || dueDateFormatted > today) continue;

    // Per-invoice Auto Charge gate. GAS: skip when value is FALSE/NO/OFF
    // (and not testMode); empty/missing defaults TRUE. SB mirrors this
    // as a boolean — auto_charge === false ⇔ "FALSE"; null/true proceed.
    if (!testMode && r.auto_charge === false) continue;

    // Per-client Auto Charge gate. GAS: only an explicit FALSE skips
    // (and increments skippedClientAutoCharge); not-found proceeds.
    if (!testMode && custName) {
      const clientAC = clientAutoChargeMap[custName.toLowerCase()];
      if (clientAC === false) { stats.skippedClientAutoCharge++; continue; }
    }

    stats.eligible++;
    eligibleInvoices.push({
      docNum,
      staxInvoiceId: staxInvId,
      staxCustomerId: staxCustId,
      customer: custName,
      amount: Number(totalRaw) || 0,
      dueDate: dueDateFormatted,
    });
    // GAS continues into SAFEGUARD 1-3 + EXECUTE CHARGE here. The shadow
    // STOPS — no money movement, no API calls, no state mutation.
  }

  const summary = testMode
    ? `${stats.dryRunPassed} passed pre-flight (DRY RUN — no charges executed), ` +
      `${stats.noPaymentMethod} no PM, ${stats.alreadyPaid} already paid, ` +
      `${stats.apiErrors} API errors (of ${stats.eligible} eligible)`
    : `${stats.paid} paid, ${stats.declined} declined, ` +
      `${stats.noPaymentMethod} no PM, ${stats.alreadyPaid} already paid, ` +
      `${stats.partial} partial, ${stats.apiErrors} API errors (of ${stats.eligible} eligible)`;

  return json({
    ok: true,
    externalPaymentCalls: EXTERNAL_PAYMENT_CALLS,
    eligible: stats.eligible,
    paid: stats.paid,
    dryRunPassed: stats.dryRunPassed,
    declined: stats.declined,
    noPaymentMethod: stats.noPaymentMethod,
    alreadyPaid: stats.alreadyPaid,
    partial: stats.partial,
    apiErrors: stats.apiErrors,
    skippedClientAutoCharge: stats.skippedClientAutoCharge,
    testMode,
    summary,
    computed: { today, eligibleInvoices },
  });
});
