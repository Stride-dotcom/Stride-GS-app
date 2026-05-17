/**
 * create-invoice-sb — [MIGRATION-P4a] SHADOW/parity handler for `createInvoice`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md. Ports the COMPUTE half
 * of GAS `handleCreateInvoice_` (StrideAPI.gs:25201) so the parity harness can
 * diff "what the invoice WOULD contain" against the GAS-produced invoice.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ SHADOW MODE — this function performs ZERO mutations and ZERO         │
 * │ external side effects. It does NOT:                                  │
 * │   • write CB Consolidated_Ledger / public.billing / invoice_tracking │
 * │   • flip client Billing_Ledger rows to Invoiced                      │
 * │   • generate or upload a PDF                                         │
 * │   • send the invoice email                                          │
 * │   • consume an invoice number (calling next_invoice_no() on every    │
 * │     parity run would burn the atomic counter — CLAUDE.md landmine).  │
 * │ The service-role client is used for READS ONLY (clients config).    │
 * │ active_backend stays 'gas'; no production handler is cut over.       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Parity contract (MIG-007 layer 1 — per-call live shadow, NOT layer-2
 * replay): the caller diffs the returned `parity` object against the GAS
 * `handleCreateInvoice_` JSON response for the same input. `invoiceNo` is
 * NON-DETERMINISTIC (Master-RPC counter) and is intentionally returned as
 * a fixed placeholder + EXCLUDED from the parity-meaningful surface. The
 * parity-meaningful fields are all data-derived and deterministic:
 *   lineItems, lineItemsHtml, subtotal/grandTotal, lineItemCount,
 *   docTitle, invoiceDate, paymentTerms, qbCustomerName, pdfTokens.
 *
 * Known parity caveat: GAS reads PAYMENT_TERMS from the per-tenant client
 * sheet Settings (runtime default "Due upon receipt"); the shadow reads
 * the public.clients.payment_terms mirror (column default "Net 30") and
 * falls back to "Due upon receipt" when null — same runtime default as
 * GAS when the Settings key is absent. Sunsets when client Settings move
 * to Supabase (post-P4a).
 *
 * Auth: verified caller email via supabase.auth.getUser (forgeable-token
 * defense carried through from the cancelRepair code review — never trust
 * a bare atob decode).
 *
 * Request:  POST {
 *   rows: UnbilledReportRow[], client, sidemark?, sourceSheetId,
 *   skipPdf?, skipEmail?, requestId?
 * }
 * Response: { ok, shadow:true, parity:{...}, error?, errorCode? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_BASE_URL = 'https://www.mystridehub.com/#';
// Placeholder — see header. The real number comes from the atomic
// Master-RPC counter at GAS commit time and must not be consumed here.
const INVOICE_NO_PLACEHOLDER = 'SHADOW-NOT-ASSIGNED';

interface InvoiceRow {
  ledgerRowId?: string;
  sourceSheetId?: string;
  svcCode?: string;
  svcName?: string;
  sidemark?: string;
  itemId?: string;
  date?: string;
  qty?: number | string;
  rate?: number | string;
  total?: number | string;
  notes?: string;
  taskId?: string;
  repairId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const rows: InvoiceRow[] = Array.isArray(body.rows) ? body.rows : [];
    const client: string = String(body.client ?? '').trim();
    const sidemark: string = String(body.sidemark ?? '').trim();
    const sourceSheetId: string = String(body.sourceSheetId ?? '').trim();
    const skipPdf: boolean = body.skipPdf === true;
    const skipEmail: boolean = body.skipEmail === true;

    // ── Validation — mirror handleCreateInvoice_ exactly ─────────────
    if (!rows.length) return err('No rows provided', 'INVALID_PAYLOAD');
    if (!client) return err('Missing client name', 'INVALID_PAYLOAD');
    if (!sourceSheetId) return err('Missing sourceSheetId', 'INVALID_PAYLOAD');

    for (let i = 0; i < rows.length; i++) {
      const rowSheetId = String(rows[i].sourceSheetId ?? '').trim();
      if (rowSheetId && rowSheetId !== sourceSheetId) {
        return err(
          'BLOCKED: rows from multiple clients detected — all rows must belong to the same sourceSheetId',
          'MIXED_CLIENTS',
        );
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return err('Server misconfigured', 'CONFIG_ERROR', 500);
    }

    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }
    // READ-ONLY client. SHADOW MODE: no .insert/.update/.delete/.upsert
    // or write RPCs anywhere in this function.
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Client config from public.clients (SB-native source) ─────────
    const { data: clientRow, error: clientErr } = await supabase
      .from('clients')
      .select('separate_by_sidemark, qb_customer_name, payment_terms, name')
      .eq('spreadsheet_id', sourceSheetId)
      .maybeSingle();

    // Fail OPEN on read error — mirrors GAS's "Supabase outage shouldn't
    // block invoicing" posture. React grouping is the primary defense.
    const separateBySidemark = clientErr ? false : (clientRow?.separate_by_sidemark === true);

    // ── Sidemark consistency assertion (Bug #3 / Phase C3 parity) ────
    if (separateBySidemark) {
      const distinct = Array.from(new Set(rows.map(r => String(r.sidemark ?? '').trim())));
      if (distinct.length > 1) {
        return err(
          `SIDEMARK_VIOLATION: client ${client} has separate_by_sidemark=true but the invoice ` +
          `payload contains ${distinct.length} distinct sidemarks: ${JSON.stringify(distinct)}. ` +
          `Split this batch by sidemark on the React side and resubmit one invoice per sidemark group.`,
          'SIDEMARK_VIOLATION',
        );
      }
      const rowSm = distinct[0] || '';
      if (rowSm && sidemark && rowSm !== sidemark) {
        return err(
          `SIDEMARK_VIOLATION: client ${client} has separate_by_sidemark=true but the payload-level ` +
          `sidemark (${JSON.stringify(sidemark)}) doesn't match the row sidemark ` +
          `(${JSON.stringify(rowSm)}). Re-send with matching sidemark.`,
          'SIDEMARK_VIOLATION',
        );
      }
    }

    // ── Compute line items + totals (port of api_buildInvoiceLineItems_) ─
    const li = buildInvoiceLineItems(rows);
    const grandTotal = li.subtotal;

    // ── Invoice date — today, PST, MM/dd/yyyy (matches GAS v38.122.0) ─
    const invDateStr = formatDatePST(new Date());

    // ── Payment terms — see header caveat ────────────────────────────
    const paymentTerms = (clientRow?.payment_terms && String(clientRow.payment_terms).trim())
      ? String(clientRow.payment_terms).trim()
      : 'Due upon receipt';

    // ── QB customer name (parity of the QBO/CB customer string) ──────
    const qbCustomerName = (clientRow?.qb_customer_name && String(clientRow.qb_customer_name).trim())
      ? String(clientRow.qb_customer_name).trim()
      : client;

    const docTitle = `Invoice ${INVOICE_NO_PLACEHOLDER} — ${client}${sidemark ? ' — ' + sidemark : ''}`;
    const lineItemsHtml = buildInvoiceLineItemsHtml(li.rows);

    // PDF token map — exactly the tokens handleCreateInvoice_ substitutes
    // into DOC_INVOICE. INV_NO is the placeholder (excluded from parity).
    const pdfTokens = {
      INV_NO: INVOICE_NO_PLACEHOLDER,
      CLIENT_NAME: client,
      INV_DATE: invDateStr,
      PAYMENT_TERMS: paymentTerms,
      DUE_DATE: invDateStr,
      SUBTOTAL: money(li.subtotal),
      GRAND_TOTAL: money(grandTotal),
      LINE_ITEMS_HTML: lineItemsHtml,
      DISCOUNT_ROWS: '',
      INVOICE_NOTES_BLOCK: '',
    };

    // Shadow invoice URL — when skipPdf the GAS path points at the React
    // invoice page; mirror that shape (with the placeholder no.) so the
    // URL-construction logic is itself parity-checked.
    const invoiceUrl = skipPdf
      ? `${APP_BASE_URL}/invoices/${encodeURIComponent(INVOICE_NO_PLACEHOLDER)}?client=${encodeURIComponent(sourceSheetId)}`
      : null; // real path returns a Drive URL only known after PDF gen
    const emailStatus = (skipEmail || skipPdf) ? 'Skipped' : 'Sent';

    return ok({
      // Mirrors handleCreateInvoice_'s success response shape so the
      // parity differ can compare field-for-field. invoiceNo is the
      // documented placeholder and must be excluded by the comparator.
      response: {
        success: true,
        invoiceNo: INVOICE_NO_PLACEHOLDER,
        invoiceDate: invDateStr,
        invoiceUrl,
        emailStatus,
        grandTotal,
        lineItemCount: rows.length,
      },
      // Parity-meaningful, deterministic surface.
      parity: {
        client,
        sidemark,
        sourceSheetId,
        separateBySidemark,
        qbCustomerName,
        paymentTerms,
        invoiceDate: invDateStr,
        docTitle,
        subtotal: round2(li.subtotal),
        storageSubtotal: round2(li.storageSubtotal),
        servicesSubtotal: round2(li.servicesSubtotal),
        grandTotal: round2(grandTotal),
        lineItemCount: rows.length,
        lineItems: li.rows,
        lineItemsHtml,
        pdfTokens,
        callerEmail,
      },
      excludedFromParity: ['invoiceNo', 'invoiceUrl(driveUrl)'],
    });
  } catch (e) {
    console.error('[create-invoice-sb] Unexpected error:', e);
    return err(String(e), 'SERVER_ERROR', 500);
  }
});

// ─── Ported computation helpers (byte-faithful to StrideAPI.gs) ──────

// api_money_ (StrideAPI.gs:24558)
function money(v: unknown): string {
  const n = Number(v);
  return Number.isNaN(n) ? '$0.00' : '$' + n.toFixed(2);
}

function round2(n: number): number {
  return Number((Number(n) || 0).toFixed(2));
}

// api_buildInvoiceLineItems_ (StrideAPI.gs:24569). STOR rows grouped by
// sidemark into one summary line; non-STOR rows individual. 7-col rows:
// [Service Date, Service, Item ID, Notes, Qty, Rate, Total].
function buildInvoiceLineItems(rows: InvoiceRow[]): {
  rows: string[][]; subtotal: number; storageSubtotal: number; servicesSubtotal: number;
} {
  let subtotal = 0, storageSubtotal = 0, servicesSubtotal = 0;
  const outRows: string[][] = [];

  function fmtDate(d: unknown): string {
    if (!d) return '';
    const s = String(d);
    if (/^\d{8}$/.test(s)) return s.substring(4, 6) + '/' + s.substring(6, 8) + '/' + s.substring(0, 4);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const p = s.split('-'); return p[1] + '/' + p[2] + '/' + p[0];
    }
    return s;
  }

  interface StorGrp {
    sidemark: string; totalCuFt: number; total: number;
    minDate: string | null; maxDate: string | null; itemCount: number;
  }
  const storageByKey: Record<string, StorGrp> = {};
  const storageOrder: string[] = [];
  const nonStorageRows: InvoiceRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const svcCode = String(r.svcCode ?? '').trim().toUpperCase();
    if (svcCode === 'STOR') {
      const sm = String(r.sidemark ?? '').trim() || '(No Sidemark)';
      if (!storageByKey[sm]) {
        storageByKey[sm] = { sidemark: sm, totalCuFt: 0, total: 0, minDate: null, maxDate: null, itemCount: 0 };
        storageOrder.push(sm);
      }
      const grp = storageByKey[sm];
      grp.total += Number(r.total) || 0;
      grp.totalCuFt += Number(r.qty) || 0;
      grp.itemCount++;
      const dStr = String(r.date ?? '');
      if (dStr) {
        if (!grp.minDate || dStr < grp.minDate) grp.minDate = dStr;
        if (!grp.maxDate || dStr > grp.maxDate) grp.maxDate = dStr;
      }
    } else {
      nonStorageRows.push(r);
    }
  }

  for (let s = 0; s < storageOrder.length; s++) {
    const grp = storageByKey[storageOrder[s]];
    let period = '';
    if (grp.minDate && grp.maxDate && grp.minDate !== grp.maxDate) {
      period = fmtDate(grp.minDate) + ' - ' + fmtDate(grp.maxDate);
    } else if (grp.minDate) {
      period = fmtDate(grp.minDate);
    }
    const storNoteParts: string[] = [];
    if (grp.sidemark && grp.sidemark !== '(No Sidemark)') storNoteParts.push(grp.sidemark);
    if (period) storNoteParts.push(period);
    storNoteParts.push(grp.itemCount + ' items' + (grp.totalCuFt ? ', ' + grp.totalCuFt.toFixed(2) + ' cuFt' : ''));
    subtotal += grp.total; storageSubtotal += grp.total;
    outRows.push([period, 'Storage', '', storNoteParts.join(' — '), '', '', money(grp.total)]);
  }

  for (let j = 0; j < nonStorageRows.length; j++) {
    const r = nonStorageRows[j];
    const total = Number(r.total) || 0;
    subtotal += total; servicesSubtotal += total;
    const noteParts: string[] = [];
    const sm = String(r.sidemark ?? '').trim();
    if (sm) noteParts.push(sm);
    let refId = String(r.taskId ?? '').trim() || String(r.repairId ?? '').trim() || '';
    if (!refId) {
      const noteStr = String(r.notes ?? '').trim();
      if (/^WC-/i.test(noteStr)) refId = noteStr;
      else if (noteStr) noteParts.push(noteStr);
    }
    if (refId) noteParts.push(refId);
    outRows.push([
      fmtDate(r.date ?? ''),
      String(r.svcName ?? ''),
      String(r.itemId ?? ''),
      noteParts.join(' — '),
      String(r.qty !== undefined && r.qty !== null ? r.qty : 1),
      money(r.rate),
      money(total),
    ]);
  }

  return { rows: outRows, subtotal, storageSubtotal, servicesSubtotal };
}

// api_buildInvoiceLineItemsHtml_ (StrideAPI.gs:18110)
function buildInvoiceLineItemsHtml(rows: string[][]): string {
  if (!rows || !rows.length) return '';
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out.push('<tr>');
    for (let c = 0; c < r.length; c++) {
      const align = c >= 4 ? 'right' : 'left';
      const val = String(r[c] == null ? '' : r[c]);
      out.push('<td style="padding:4px 6px;border:1px solid #ddd;text-align:' + align + ';font-size:10pt;">' + esc(val) + '</td>');
    }
    out.push('</tr>');
  }
  return out.join('');
}

// api_esc_ (StrideAPI.gs:28877) — HTML-escape. Byte-faithful: GAS uses
// String(s || "") (falsy → "") and escapes ONLY [&<>"] — it does NOT
// escape the single quote. Adding &#39; here would false-mismatch every
// invoice line carrying an apostrophe (O'Brien, Children's, etc.).
function esc(s: unknown): string {
  return String(s || '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>
  )[c]);
}

// GAS uses Utilities.formatDate(d, "America/Los_Angeles", "MM/dd/yyyy").
function formatDatePST(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit', day: '2-digit', year: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('month')}/${get('day')}/${get('year')}`;
}

function ok(parity: unknown): Response {
  return new Response(JSON.stringify({ ok: true, shadow: true, ...(parity as object) }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(error: string, errorCode: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, shadow: true, error, errorCode }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
