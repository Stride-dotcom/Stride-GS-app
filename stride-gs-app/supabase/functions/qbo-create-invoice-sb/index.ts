/**
 * qbo-create-invoice-sb — [MIGRATION-P6] SHADOW for `qboCreateInvoice`.
 *
 * GAS answer key: handleQboCreateInvoice_ (StrideAPI.gs:41609), doPost
 * action "qboCreateInvoice". Pushes Stride invoices to QuickBooks
 * Online. Ships as the P4b prerequisite (MIG-005). Returns { success,
 * pushedCount, skippedCount, failedCount, results[] }.
 *
 * Shadow contract: COMPUTE what WOULD be pushed to QBO — group the
 * Invoiced billing rows by invoice #, resolve the intended QBO customer
 * name + sub-job (sidemark), build the line items with the same
 * description rules, compute the invoice date / due date / total — and
 * RETURN that payload. Never call the QBO API, never write
 * Consolidated_Ledger / invoice_tracking, never mirror.
 *
 * State source (per MIG-005, the SB-side reads the mirror, not the CB
 * sheet): `public.billing` (Invoiced, has invoice_no, not Void) for the
 * requested ledger_row_ids, `public.clients` for QB customer name +
 * payment terms + separate-by-sidemark, `public.invoice_tracking` for
 * the already-pushed dedup check.
 *
 * STRUCTURAL OMISSIONS (documented for the parity reviewer — QBO-API or
 * sheet-only steps a shadow cannot perform):
 *  - QBO customer / sub-job ID resolution (qbo_resolveCustomerAndSubJob_)
 *    and per-line Item-ref resolution (qbo_buildInvoicePayload_) require
 *    live QBO. The shadow returns the *intended* customer NAME and
 *    sub-job NAME (the inputs to that resolution) + the priced line
 *    items, which is the parity-meaningful pre-API payload.
 *  - GAS's per-tenant Billing_Ledger sidemark fallback is unnecessary
 *    in SB: `public.billing.sidemark` is already the propagated value
 *    (propagate_sidemark_to_billing trigger). Documented reduction.
 *  - Tax: handleQboCreateInvoice_ sends no tax — QBO applies its own
 *    tax server-side. `tax` is reported as null to make that explicit.
 *
 * MIG-008: no QBO / Stax / Resend client is constructed —
 * EXTERNAL_PAYMENT_CALLS = false. The only client is the read-only
 * Supabase service-role mirror reader.
 *
 * Request:  POST { ledgerRowIds: string[], forceRePush?: boolean,
 *                   autoAssignDocNumber?: boolean, jobId?: string,
 *                   requestId?: string }
 * Response: { ok, pushedCount, skippedCount, failedCount, results }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formatDatePacific } from '../_shared/stax-iif-shadow.ts';

const EXTERNAL_PAYMENT_CALLS = false; // MIG-008 invariant — never flip.
const SCRIPT_TZ = 'America/Los_Angeles';

interface QboLineItem {
  svcCode: string;
  description: string;
  qty: number;
  rate: number;
  total: number;
}

interface ComputedInvoice {
  strideInvoiceNumber: string;
  customerName: string;
  subJobName: string | null;
  separateBySidemark: boolean;
  invoiceDate: string;
  dueDate: string;
  lineItems: QboLineItem[];
  total: number;
  tax: null; // QBO applies tax server-side; GAS sends none.
  ledgerRowIds: string[];
  wouldSkip: boolean;
  skipReason?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** GAS api_qbFmtDate_ — date → MM/dd/yyyy in the script timezone. */
function qbFmtDate(v: unknown): string {
  if (!v) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{8}$/.test(s)) {
    const y = parseInt(s.substring(0, 4), 10);
    const m = parseInt(s.substring(4, 6), 10) - 1;
    const dd = parseInt(s.substring(6, 8), 10);
    const d1 = new Date(Date.UTC(y, m, dd));
    if (!isNaN(d1.getTime())) {
      return `${String(m + 1).padStart(2, '0')}/${String(dd).padStart(2, '0')}/${y}`;
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SCRIPT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('month')}/${get('day')}/${get('year')}`;
  }
  return s;
}

/** today (PT) + n calendar days → yyyy-MM-dd (TZ-invariant shift). */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let payload: { ledgerRowIds?: unknown; forceRePush?: boolean };
  try {
    payload = await req.json();
  } catch (e) {
    return json({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  const ledgerRowIds = payload?.ledgerRowIds;
  if (!ledgerRowIds || !Array.isArray(ledgerRowIds) || ledgerRowIds.length === 0) {
    return json({ ok: false, error: 'ledgerRowIds array is required', errorCode: 'INVALID_PARAMS' }, 400);
  }
  const forceRePush = !!payload?.forceRePush;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'Server misconfigured (no Supabase mirror access)' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const filterIds = new Set(ledgerRowIds.map((id) => String(id).trim()).filter(Boolean));

  // Invoiced billing rows for the requested ledger ids (mirror of the
  // Consolidated_Ledger grouping pass: STATUS=INVOICED, has Invoice #,
  // not Void). public.billing.status is title-case ('Invoiced').
  let billingRows: Array<Record<string, unknown>> = [];
  try {
    const { data, error } = await sb
      .from('billing')
      .select('ledger_row_id,status,invoice_no,client_name,date,svc_code,qty,rate,total,description,sidemark,item_notes,item_id')
      .in('ledger_row_id', Array.from(filterIds))
      .neq('status', 'Void');
    if (error) throw error;
    billingRows = data ?? [];
  } catch (e) {
    return json({ ok: false, error: `billing read failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  // Client info: qb_customer_name, payment_terms, separate_by_sidemark.
  const clientInfoMap: Record<string, { qbCustomerName: string; terms: string; separateBySidemark: boolean }> = {};
  try {
    const { data: clients, error } = await sb
      .from('clients')
      .select('name,qb_customer_name,payment_terms,separate_by_sidemark')
      .eq('active', true);
    if (error) throw error;
    for (const c of clients ?? []) {
      const key = String(c.name ?? '').trim().toUpperCase();
      if (!key) continue;
      clientInfoMap[key] = {
        qbCustomerName: String(c.qb_customer_name ?? '').trim(),
        terms: String(c.payment_terms ?? '').trim(),
        separateBySidemark: c.separate_by_sidemark === true,
      };
    }
  } catch (e) {
    console.log(`qbo-create-invoice-sb client load failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  const todayIso = formatDatePacific(new Date()); // GAS: invoice date = today

  // Group by invoice #, mirroring handleQboCreateInvoice_'s loop.
  const invoiceGroups: Record<string, ComputedInvoice> = {};

  for (const r of billingRows) {
    const status = String(r.status ?? '').trim().toUpperCase();
    if (status !== 'INVOICED') continue;

    const lrid = String(r.ledger_row_id ?? '').trim();
    if (!lrid || !filterIds.has(lrid)) continue;

    const invNo = String(r.invoice_no ?? '').trim();
    const client = String(r.client_name ?? '').trim();
    if (!invNo || !client) continue;

    const rawSvc = r.svc_code;
    const svcCode = String(rawSvc ?? '').trim().toUpperCase();
    const dateVal = r.date;
    const qty = r.qty != null ? (Number(r.qty) || 1) : 1;
    const rate = r.rate != null ? Number(r.rate) || 0 : 0;
    const total = Number(r.total) || 0;
    const description = String(r.description ?? '').trim();
    const sidemark = String(r.sidemark ?? '').trim();
    const itemNotes = String(r.item_notes ?? '').trim();
    const itemId = String(r.item_id ?? '').trim();

    // Description build (GAS lines 41846-41890).
    let exportDesc = description;
    if (svcCode === 'STOR') {
      let periodStr = '';
      if (itemNotes) {
        const periodMatch = itemNotes.match(/(\d{2}\/\d{2}\/\d{2,4})\s+to\s+(\d{2}\/\d{2}\/\d{2,4})/);
        if (periodMatch) periodStr = periodMatch[1] + ' to ' + periodMatch[2];
      }
      const parts: string[] = [];
      if (periodStr) parts.push('Storage ' + periodStr);
      parts.push(qty + ' day(s)');
      if (description) parts.push(description);
      if (itemId) parts.push('Item ' + itemId);
      exportDesc = parts.join(' — ');
    } else {
      const descParts: string[] = [];
      if (sidemark) descParts.push(sidemark);
      if (itemId) descParts.push('Item ' + itemId);
      if (description) descParts.push(description);
      exportDesc = descParts.join(' — ');
    }

    const clientInfo = clientInfoMap[client.toUpperCase()] || { qbCustomerName: '', terms: '', separateBySidemark: false };
    const qbCustName = clientInfo.qbCustomerName || client;
    const payTerms = clientInfo.terms || '';

    const invDateStr = todayIso;
    let dueDateStr = invDateStr;
    const termsMatch = String(payTerms).toUpperCase().match(/NET\s*(\d+)/);
    if (termsMatch) dueDateStr = addDaysIso(invDateStr, parseInt(termsMatch[1], 10));

    if (svcCode !== 'STOR') {
      const billingDateStr = qbFmtDate(dateVal);
      if (billingDateStr && exportDesc && !exportDesc.includes(billingDateStr)) {
        exportDesc = exportDesc + ' — Billed ' + billingDateStr;
      }
    }

    if (!invoiceGroups[invNo]) {
      invoiceGroups[invNo] = {
        strideInvoiceNumber: invNo,
        customerName: qbCustName,
        subJobName: sidemark || null,
        separateBySidemark: clientInfo.separateBySidemark === true,
        invoiceDate: invDateStr,
        dueDate: dueDateStr,
        lineItems: [],
        total: 0,
        tax: null,
        ledgerRowIds: [],
        wouldSkip: false,
      };
    }
    invoiceGroups[invNo].lineItems.push({ svcCode, description: exportDesc, qty, rate, total });
    invoiceGroups[invNo].total += total;
    if (lrid) invoiceGroups[invNo].ledgerRowIds.push(lrid);
    // First non-empty sidemark wins (GAS line 41920).
    if (sidemark && !invoiceGroups[invNo].subJobName) {
      invoiceGroups[invNo].subJobName = sidemark;
    }
  }

  const invoiceNumbers = Object.keys(invoiceGroups);

  // Dedup check (mirror of qbo_checkDuplicatePush_): in SB the
  // already-pushed signal is invoice_tracking.qbo_pushed_at. GAS skips
  // when an existing QBO id is present and !forceRePush.
  if (invoiceNumbers.length > 0) {
    try {
      const { data: tracking, error } = await sb
        .from('invoice_tracking')
        .select('invoice_no,qb_invoice_no,qbo_pushed_at')
        .in('invoice_no', invoiceNumbers);
      if (error) throw error;
      const pushed = new Set<string>();
      for (const t of tracking ?? []) {
        if (t.qbo_pushed_at) {
          pushed.add(String(t.invoice_no ?? '').trim());
          pushed.add(String(t.qb_invoice_no ?? '').trim());
        }
      }
      for (const invNo of invoiceNumbers) {
        if (pushed.has(invNo) && !forceRePush) {
          invoiceGroups[invNo].wouldSkip = true;
          invoiceGroups[invNo].skipReason = 'Already pushed to QBO (invoice_tracking.qbo_pushed_at set). forceRePush=false.';
        }
      }
    } catch (e) {
      console.log(`qbo-create-invoice-sb invoice_tracking dedup read failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const results = invoiceNumbers.map((n) => invoiceGroups[n]);
  const skippedCount = results.filter((r) => r.wouldSkip).length;
  const pushedCount = results.length - skippedCount;

  return json({
    ok: true,
    externalPaymentCalls: EXTERNAL_PAYMENT_CALLS,
    pushedCount,
    skippedCount,
    failedCount: 0, // structurally 0 in shadow (no QBO POST → no failures)
    summary: `${pushedCount} would push, ${skippedCount} would skip (of ${results.length} grouped invoices)`,
    results,
  });
});
