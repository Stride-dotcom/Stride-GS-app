/**
 * create-stax-invoices-sb — [MIGRATION-P6] SHADOW for `createStaxInvoices`.
 *
 * GAS answer key: handleCreateStaxInvoices_ (StrideAPI.gs:36460),
 * doPost action "createStaxInvoices". Returns { created, skippedDupe,
 * skippedNoCustomer, skippedInvalid, apiErrors, total, summary }.
 *
 * Shadow contract: COMPUTE the Stax invoice payloads (customer, line
 * items, subtotal, tax, total, due_at) for every PENDING row that WOULD
 * be pushed — never POST /invoice, never write the sheet, never mirror
 * to Supabase. Returns the computed payloads + the headline stats for
 * parity comparison.
 *
 * State source: reads `public.stax_invoices` (mirror of the Stax
 * Invoices sheet) for the candidate rows and `public.clients` (mirror
 * of CB Clients) for payment terms.
 *
 * STRUCTURAL OMISSIONS (documented for the parity reviewer — these are
 * not bugs, they are steps that only exist behind the Stax API):
 *  - `skippedDupe` is always 0. GAS detects duplicates via a live
 *    GET /invoice?memo= call (stax_checkDuplicate_); a shadow cannot
 *    know Stax-side state, so rows that GAS would dedup-link are
 *    classified `would_create` here. Expected divergence on the
 *    skippedDupe / created split when a dupe exists in Stax.
 *  - `apiErrors` is always 0 — no POST is made, so no API error path.
 *  - The post-create "Auto Charge default from CB Clients" sheet write
 *    and the past-due safety buffer are sheet mutations with no payload
 *    output; out of scope for the compute-only shadow.
 *
 * MIG-008: no Stax / QBO / Resend client is constructed —
 * EXTERNAL_PAYMENT_CALLS = false. The only client is the read-only
 * Supabase service-role mirror reader.
 *
 * Request:  POST { invoiceNos?: string[], requestId?: string }
 * Response: { ok, created, skippedDupe, skippedNoCustomer,
 *             skippedInvalid, apiErrors, total, summary, computed }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  staxNormalizeName,
  staxParseDateForStax,
  staxBuildLineItems,
  type StaxLineItem,
} from '../_shared/stax-iif-shadow.ts';

const EXTERNAL_PAYMENT_CALLS = false; // MIG-008 invariant — never flip.
const PAY_URL_BASE_DEFAULT = 'https://app.staxpayments.com/#/bill/';

interface StaxApiPayload {
  customer_id: string;
  total: number;
  url: string;
  due_at?: string;
  meta: {
    subtotal: number;
    tax: number;
    memo: string;
    reference: string;
    invoiceNumber: string;
    lineItems: StaxLineItem[];
  };
}

interface ComputedRow {
  docNum: string;
  classification: 'would_create' | 'no_customer' | 'invalid_amount';
  payload?: StaxApiPayload;
  reason?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let payload: { invoiceNos?: unknown };
  try {
    payload = await req.json();
  } catch (e) {
    return json({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  // GAS v38.10.0 selective push.
  let selectiveNos: Record<string, true> | null = null;
  if (payload && Array.isArray(payload.invoiceNos) && payload.invoiceNos.length > 0) {
    selectiveNos = {};
    for (const n of payload.invoiceNos) selectiveNos[String(n).trim()] = true;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Server misconfigured (no Supabase mirror access)' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Payment-terms lookup (GAS reads CB Clients QB_CUSTOMER_NAME / CLIENT
  // NAME / STAX CUSTOMER ID → PAYMENT TERMS).
  const paymentTermsByQbName: Record<string, string> = {};
  const paymentTermsByStaxId: Record<string, string> = {};
  try {
    const { data: clients, error } = await sb
      .from('clients')
      .select('name,qb_customer_name,stax_customer_id,payment_terms')
      .eq('active', true);
    if (error) throw error;
    for (const c of clients ?? []) {
      const pt = String(c.payment_terms ?? '').trim();
      if (!pt) continue;
      const qbName = String(c.qb_customer_name ?? '').trim();
      const cName = String(c.name ?? '').trim();
      const sId = String(c.stax_customer_id ?? '').trim();
      if (qbName) paymentTermsByQbName[staxNormalizeName(qbName)] = pt;
      if (cName) paymentTermsByQbName[staxNormalizeName(cName)] = pt;
      if (sId) paymentTermsByStaxId[sId] = pt;
    }
  } catch (e) {
    console.log(`create-stax-invoices-sb paymentTerms load failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  // Candidate rows = mirror of the Stax Invoices sheet.
  let invRows: Array<Record<string, unknown>> = [];
  try {
    const { data, error } = await sb
      .from('stax_invoices')
      .select('qb_invoice_no,customer,stax_customer_id,invoice_date,due_date,amount,line_items_json,stax_id,status');
    if (error) throw error;
    invRows = data ?? [];
  } catch (e) {
    return json({ ok: false, error: `stax_invoices read failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  const stats = {
    total: 0,
    created: 0,
    skippedDupe: 0,        // structurally 0 in shadow (see header)
    skippedNoCustomer: 0,
    skippedInvalid: 0,
    apiErrors: 0,          // structurally 0 in shadow (no POST)
  };
  const computed: ComputedRow[] = [];

  for (const r of invRows) {
    const status = String(r.status ?? '').trim().toUpperCase();
    const existingStaxId = String(r.stax_id ?? '').trim();

    // Gate: only PENDING without a Stax Invoice ID (GAS lines 36568-69).
    if (status !== 'PENDING') continue;
    if (existingStaxId) continue;

    const docNum = String(r.qb_invoice_no ?? '').trim();
    if (selectiveNos && !selectiveNos[docNum]) continue;

    stats.total++;
    const custName = String(r.customer ?? '').trim();
    const staxCustId = String(r.stax_customer_id ?? '').trim();
    const invDate = r.invoice_date;
    const dueDate = r.due_date;
    const totalRaw = r.amount;
    const lineItemsRaw = String(r.line_items_json ?? '');

    if (!staxCustId) {
      stats.skippedNoCustomer++;
      computed.push({ docNum, classification: 'no_customer' });
      continue;
    }

    const total = parseFloat(String(totalRaw));
    if (isNaN(total) || total <= 0) {
      stats.skippedInvalid++;
      computed.push({ docNum, classification: 'invalid_amount', reason: `total=${String(totalRaw)}` });
      continue;
    }

    // Due date — honor client payment terms when Due Date is blank.
    let dueDateFormatted = staxParseDateForStax(dueDate);
    if (!dueDateFormatted) {
      const invDateParsed = staxParseDateForStax(invDate);
      if (invDateParsed) {
        const termsForClient =
          paymentTermsByStaxId[staxCustId] ||
          paymentTermsByQbName[staxNormalizeName(custName)] ||
          'Net 30';
        const termsMatch = String(termsForClient).toUpperCase().match(/NET\s*(\d+)/);
        const daysToAdd = termsMatch ? parseInt(termsMatch[1], 10) : 0;
        // invDateParsed is yyyy-MM-dd; add days as a pure calendar shift
        // (UTC math avoids TZ skew, then re-emit yyyy-MM-dd).
        const [y, m, d] = invDateParsed.split('-').map((x) => parseInt(x, 10));
        const dDue = new Date(Date.UTC(y, m - 1, d));
        if (daysToAdd > 0) dDue.setUTCDate(dDue.getUTCDate() + daysToAdd);
        const yy = dDue.getUTCFullYear();
        const mm = String(dDue.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(dDue.getUTCDate()).padStart(2, '0');
        dueDateFormatted = `${yy}-${mm}-${dd}`;
      }
    }

    const lineItems = staxBuildLineItems(lineItemsRaw, total, docNum);

    // GAS v38.149.0: refKey is the bare invoice number.
    const refKey = String(docNum).trim();
    const memo = 'QB #' + docNum + ' - ' + custName;

    let subtotal = 0;
    for (const li of lineItems) subtotal += li.quantity * li.price;
    const tax = total - subtotal;

    const apiPayload: StaxApiPayload = {
      customer_id: staxCustId,
      total: total,
      url: PAY_URL_BASE_DEFAULT,
      meta: {
        subtotal,
        tax,
        memo,
        reference: refKey,
        invoiceNumber: docNum,
        lineItems,
      },
    };
    if (dueDateFormatted) apiPayload.due_at = dueDateFormatted + ' 00:00:00';

    // Shadow cannot run stax_checkDuplicate_ (live Stax GET). Classify as
    // would_create; the skippedDupe/created split is a documented
    // structural divergence.
    stats.created++;
    computed.push({ docNum, classification: 'would_create', payload: apiPayload });
  }

  const summary =
    `${stats.created} created, ${stats.skippedDupe} dupes, ` +
    `${stats.skippedNoCustomer} no customer, ${stats.skippedInvalid} invalid, ` +
    `${stats.apiErrors} API errors (of ${stats.total} pending)`;

  return json({
    ok: true,
    externalPaymentCalls: EXTERNAL_PAYMENT_CALLS,
    created: stats.created,
    skippedDupe: stats.skippedDupe,
    skippedNoCustomer: stats.skippedNoCustomer,
    skippedInvalid: stats.skippedInvalid,
    apiErrors: stats.apiErrors,
    total: stats.total,
    summary,
    computed,
  });
});
