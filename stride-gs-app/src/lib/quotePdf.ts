/**
 * quotePdf — generate a branded Quote PDF.
 *
 * Primary path (v2): fetch the `DOC_QUOTE` template from Supabase
 * (`public.email_templates`), inject line-item rows + scalar tokens,
 * then open the result in a new window and trigger `window.print()`
 * so the user can Save-as-PDF from the browser dialog. This makes the
 * Quote PDF use the SAME branded HTML shell as the Invoice PDF
 * (Stride header, logo, grey right-aligned title, Bill-To block,
 * line-items table, totals, centered footer) — edits in
 * Settings → Documents flow through automatically.
 *
 * Fallback path (legacy): if Supabase is unreachable or the template
 * row is missing/empty, fall back to the original inline HTML that
 * shipped with the Quote Tool. That keeps the button working offline
 * and if the row is ever accidentally deleted.
 *
 * Session 74 — swap from hardcoded HTML to template-driven.
 */
import type { Quote, QuoteCatalog, QuoteStoreSettings, CalcResult } from './quoteTypes';
import { calcQuote } from './quoteCalc';
import { supabase } from './supabase';

// ─── Formatting helpers ────────────────────────────────────────────────────

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Supabase template loader ──────────────────────────────────────────────

async function loadQuoteTemplateBody(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('email_templates')
      .select('body')
      .eq('template_key', 'DOC_QUOTE')
      .single();
    if (error) {
      console.warn('[quotePdf] DOC_QUOTE fetch error:', error.message);
      return null;
    }
    return data?.body ?? null;
  } catch (err) {
    console.warn('[quotePdf] DOC_QUOTE fetch threw:', err);
    return null;
  }
}

// ─── Line items table generator ────────────────────────────────────────────

/**
 * Build the PDF's <tbody> content as two stacked sections inside the
 * same 5-column table the template provides. Matches the approved
 * sample Quote_EST-00018.pdf layout:
 *
 *   Section A — "Item Quantities by Size Class"
 *     one row per class with a qty (from quote.classLines). Class ID
 *     only ("XS" / "S" / "M" / etc.) — NEVER the expanded name
 *     ("Extra Small" / "Small") because customers only see the ID in
 *     the Pricing Matrix. Plus a "Total Items" row summing all qtys.
 *
 *   Section B — "Services"
 *     one row per (service × class) combination that was selected in
 *     the Pricing Matrix + Storage sections. Each row shows the full
 *     per-class detail (Class ID, Rate for that class, Qty, Total) so
 *     the customer sees how each charge broke out. This is the
 *     intentional difference vs. the on-screen Quote Summary which
 *     aggregates by service — the PDF is the itemized record.
 */
function buildLineItemsRows(calc: CalcResult, quote: Quote): string {
  if (calc.lineItems.length === 0) {
    return (
      '<tr><td colspan="5" style="padding:12px;text-align:center;color:#94A3B8;font-size:10pt;">' +
      '(No line items selected — open the quote and choose services.)' +
      '</td></tr>'
    );
  }

  const sectionHeaderStyle =
    'background:#F1F5F9;color:#334155;font-weight:700;font-size:9pt;letter-spacing:1px;text-transform:uppercase;padding:7px 10px;';

  const parts: string[] = [];

  // Section A — class totals (from quote.classLines, ordered by class.order)
  // Classes are stored in quote.classLines in the order they came from
  // catalog.classes — already sorted by class.order at creation time —
  // so native array iteration gives the right visual order (XS, S, M, L,
  // XL, XXL). No `sort()` here because ClassLine doesn't carry `order`.
  const classRows = quote.classLines.filter(cl => (cl.qty || 0) > 0);
  if (classRows.length > 0) {
    parts.push(
      '<tr><td colspan="5" style="' + sectionHeaderStyle + '">Item Quantities by Size Class</td></tr>'
    );
    let totalItems = 0;
    for (const cl of classRows) {
      totalItems += cl.qty;
      parts.push(
        '<tr>' +
        '<td style="padding-left:20px;font-weight:600;">' + escHtml(cl.classId) + '</td>' +
        '<td colspan="3" style="color:#64748B;">Size class ' + escHtml(cl.classId) + '</td>' +
        '<td class="num">' + String(cl.qty) + '</td>' +
        '</tr>'
      );
    }
    parts.push(
      '<tr>' +
      '<td colspan="4" style="padding-left:20px;font-weight:700;border-top:1px solid #0F172A;">Total Items</td>' +
      '<td class="num" style="font-weight:700;border-top:1px solid #0F172A;">' + String(totalItems) + '</td>' +
      '</tr>'
    );
  }

  // Section B — aggregate by serviceId. One row per service with the
  // summed qty and summed total. User explicitly asked for the service
  // summary (not per-class rows): the previous sample only appeared to
  // show per-class rows because every charge was on XS; for a real
  // multi-class quote (XS+S+M) the per-class expansion read as noise.
  // Class + Rate cells are blank on aggregated rows since neither has
  // a single value across sizes — the detail still lives in the
  // per-class qty breakdown under "Item Quantities by Size Class".
  interface Agg { id: string; name: string; code: string; category: string; qty: number; amount: number; }
  const byService = new Map<string, Agg>();
  for (const li of calc.lineItems) {
    const prev = byService.get(li.serviceId);
    if (prev) { prev.qty += li.qty; prev.amount += li.amount; }
    else byService.set(li.serviceId, {
      id: li.serviceId, name: li.serviceName, code: li.serviceCode, category: li.category,
      qty: li.qty, amount: li.amount,
    });
  }
  // Session 74: duration label for storage rows. Non-storage rows show
  // the plain summed qty; storage rows show "N items × 30 days" (or
  // months when the quote is entered as whole months) so the customer
  // can't misread "Storage × 21" as a 21-day term.
  const months = quote.storage.months;
  const days = quote.storage.days;
  const showMonths = months > 0 && days === 0;
  const durationLabel = showMonths
    ? `${months} ${months === 1 ? 'month' : 'months'}`
    : `${months * 30 + days} days`;

  parts.push(
    '<tr><td colspan="5" style="' + sectionHeaderStyle + '">Services</td></tr>'
  );
  for (const agg of byService.values()) {
    const isStorage = agg.category === 'Storage';
    const itemLabel = agg.qty === 1 ? 'item' : 'items';
    const qtyCell = isStorage
      ? `${agg.qty} ${itemLabel} × ${durationLabel}`
      : String(agg.qty);
    parts.push(
      '<tr>' +
      '<td>' + escHtml(agg.name) + (agg.code ? ' <span style="color:#94A3B8;font-size:9pt;">' + escHtml(agg.code) + '</span>' : '') + '</td>' +
      '<td></td>' +
      '<td class="num"></td>' +
      '<td class="num">' + escHtml(qtyCell) + '</td>' +
      '<td class="num" style="font-weight:600;">' + fmt$(agg.amount) + '</td>' +
      '</tr>'
    );
  }

  return parts.join('');
}

// ─── Scalar token substitution ─────────────────────────────────────────────

function substituteScalars(html: string, tokens: Record<string, string>): string {
  let out = html;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split('{{' + key + '}}').join(value);
  }
  return out;
}

// ─── Primary template-driven generator ─────────────────────────────────────

async function generateFromTemplate(
  quote: Quote,
  catalog: QuoteCatalog,
  settings: QuoteStoreSettings,
): Promise<string | null> {
  const body = await loadQuoteTemplateBody();
  if (!body) return null;
  const calc = calcQuote(quote, catalog.services, catalog.classes, catalog.coverageOptions);

  // Step 1: inject line-item rows into the template's <tbody>. The new
  // DOC_QUOTE body has `{{LINE_ITEMS_HTML}}` as a direct tbody child,
  // so plain string substitution is valid and browser-parseable.
  let html = body.split('{{LINE_ITEMS_HTML}}').join(buildLineItemsRows(calc, quote));

  // Step 2: scalar tokens. All other {{TOKEN}}s are plain text slots.
  const covOption = catalog.coverageOptions.find(c => c.id === quote.coverage.typeId);
  const scalars: Record<string, string> = {
    QUOTE_NUMBER:    escHtml(quote.number),
    CLIENT_NAME:     escHtml(quote.client || 'N/A'),
    PROJECT:         escHtml(quote.project || ''),
    ADDRESS:         escHtml(quote.address || ''),
    QUOTE_DATE:      escHtml(quote.date),
    EXPIRATION_DATE: escHtml(quote.expiration),
    SUBTOTAL:        fmt$(calc.subtotal),
    DISCOUNT:        calc.discountAmount > 0 ? '-' + fmt$(calc.discountAmount) : fmt$(0),
    TAX:             fmt$(calc.taxAmount),
    COVERAGE:        fmt$(calc.coverageCost),
    GRAND_TOTAL:     fmt$(calc.grandTotal),
    NOTES:           escHtml(quote.customerNotes || ''),
    CLIENT_EMAIL:    '',  // not modeled on Quote yet
    CLIENT_ADDRESS:  escHtml(quote.address || ''),
    // Legacy invoice-derived tokens kept in case any older quote template
    // body hasn't been migrated yet: map them to quote equivalents so the
    // user never sees literal {{INV_NO}} on a quote PDF.
    INV_NO:          escHtml(quote.number),
    INV_DATE:        escHtml(quote.date),
    DUE_DATE:        escHtml(quote.expiration),
    PAYMENT_TERMS:   escHtml(settings.companyName || ''),
  };
  // Coverage label appended into NOTES area if the quote has one selected
  if (covOption) {
    scalars.COVERAGE_LABEL = escHtml(covOption.name);
  }
  html = substituteScalars(html, scalars);
  return html;
}

// ─── Fallback (legacy hardcoded) generator ─────────────────────────────────

function generateFallbackHtml(
  quote: Quote,
  catalog: QuoteCatalog,
  settings: QuoteStoreSettings,
): string {
  const result = calcQuote(quote, catalog.services, catalog.classes, catalog.coverageOptions);
  const covOption = catalog.coverageOptions.find(c => c.id === quote.coverage.typeId);

  // Session 74 (fallback path): mirror the primary template — class
  // counts block at top, then per-class service rows. Class IDs only
  // (XS/S/M/L/XL/XXL). Column order matches the primary table and the
  // approved sample: Service | Class | Rate | Qty | Total.
  const classRowsFb = quote.classLines.filter(cl => (cl.qty || 0) > 0);

  let linesHtml = '';
  if (classRowsFb.length > 0) {
    linesHtml += `<tr><td colspan="5" style="padding:8px 12px;font-weight:700;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;background:#F8FAFC;border-bottom:1px solid #E2E8F0">Item Quantities by Size Class</td></tr>`;
    let totalItemsFb = 0;
    for (const cl of classRowsFb) {
      totalItemsFb += cl.qty;
      linesHtml += `<tr>
        <td style="padding:6px 12px 6px 24px;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:600">${escHtml(cl.classId)}</td>
        <td colspan="3" style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B">Size class ${escHtml(cl.classId)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:right;font-weight:600">${cl.qty}</td>
      </tr>`;
    }
    linesHtml += `<tr>
      <td colspan="4" style="padding:6px 12px 6px 24px;border-top:1px solid #0F172A;font-size:12px;font-weight:700">Total Items</td>
      <td style="padding:6px 12px;border-top:1px solid #0F172A;font-size:12px;text-align:right;font-weight:700">${totalItemsFb}</td>
    </tr>`;
  }

  // Aggregate by service in the fallback too — user wants one line per
  // service (Receiving / Inspection / Pull Prep / Storage / ...), never
  // per-class rows.
  interface FbAgg2 { id: string; name: string; code: string; category: string; qty: number; amount: number; }
  const byServiceFb = new Map<string, FbAgg2>();
  for (const li of result.lineItems) {
    const prev = byServiceFb.get(li.serviceId);
    if (prev) { prev.qty += li.qty; prev.amount += li.amount; }
    else byServiceFb.set(li.serviceId, {
      id: li.serviceId, name: li.serviceName, code: li.serviceCode, category: li.category,
      qty: li.qty, amount: li.amount,
    });
  }
  // Session 74: same duration disambiguation as the primary path.
  const monthsFb = quote.storage.months;
  const daysFb = quote.storage.days;
  const showMonthsFb = monthsFb > 0 && daysFb === 0;
  const durationLabelFb = showMonthsFb
    ? `${monthsFb} ${monthsFb === 1 ? 'month' : 'months'}`
    : `${monthsFb * 30 + daysFb} days`;

  linesHtml += `<tr><td colspan="5" style="padding:8px 12px;font-weight:700;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;background:#F8FAFC;border-bottom:1px solid #E2E8F0">Services</td></tr>`;
  for (const agg of byServiceFb.values()) {
    const isStorageFb = agg.category === 'Storage';
    const itemLabelFb = agg.qty === 1 ? 'item' : 'items';
    const qtyCellFb = isStorageFb
      ? `${agg.qty} ${itemLabelFb} × ${durationLabelFb}`
      : String(agg.qty);
    linesHtml += `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px">${escHtml(agg.name)}${agg.code ? ` <span style="color:#94A3B8">${escHtml(agg.code)}</span>` : ''}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px"></td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:right"></td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:right">${escHtml(qtyCellFb)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:right;font-weight:600">${fmt$(agg.amount)}</td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Estimate ${escHtml(quote.number)}</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; color: #1E293B; font-size: 13px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 30px; }
  .logo { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; }
  .logo span { color: #E85D2D; }
  .quote-num { font-size: 28px; font-weight: 800; color: #E85D2D; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
  .info-box { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px; }
  .info-label { font-size: 10px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .info-value { font-size: 13px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  .totals { margin-top: 20px; margin-left: auto; width: 280px; }
  .totals tr td { padding: 6px 0; font-size: 13px; }
  .totals .grand { font-size: 18px; font-weight: 800; border-top: 2px solid #1E293B; padding-top: 10px; }
  .grand .amt { color: #E85D2D; }
  .notes { margin-top: 30px; padding: 14px; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; font-size: 12px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 14px; }
</style></head><body>
<div class="header">
  <div>
    <div class="logo">Stride <span>Logistics</span></div>
    <div style="font-size:12px;color:#64748B;margin-top:4px">${escHtml(settings.companyAddress)}</div>
    <div style="font-size:12px;color:#64748B">${escHtml(settings.companyPhone)} · ${escHtml(settings.companyEmail)}</div>
  </div>
  <div style="text-align:right">
    <div class="quote-num">${escHtml(quote.number)}</div>
    <div style="font-size:12px;color:#64748B;margin-top:4px">ESTIMATE</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-box">
    <div class="info-label">Client</div>
    <div class="info-value">${escHtml(quote.client || 'N/A')}</div>
    ${quote.project ? `<div style="font-size:12px;color:#64748B;margin-top:4px">${escHtml(quote.project)}</div>` : ''}
    ${quote.address ? `<div style="font-size:12px;color:#64748B">${escHtml(quote.address)}</div>` : ''}
  </div>
  <div class="info-box">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div><div class="info-label">Date</div><div class="info-value">${escHtml(quote.date)}</div></div>
      <div><div class="info-label">Valid Until</div><div class="info-value">${escHtml(quote.expiration)}</div></div>
      <div><div class="info-label">Status</div><div class="info-value" style="text-transform:capitalize">${escHtml(quote.status)}</div></div>
      ${covOption ? `<div><div class="info-label">Coverage</div><div class="info-value">${escHtml(covOption.name)}</div></div>` : ''}
    </div>
  </div>
</div>

<table>
  <thead><tr>
    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Service</th>
    <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Class</th>
    <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Rate</th>
    <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Qty</th>
    <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Total</th>
  </tr></thead>
  <tbody>${linesHtml}</tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td style="text-align:right;font-weight:600">${fmt$(result.subtotal)}</td></tr>
  ${result.discountAmount > 0 ? `<tr style="color:#15803D"><td>Discount${quote.discount.type === 'percent' ? ` (${quote.discount.value}%)` : ''}</td><td style="text-align:right;font-weight:600">-${fmt$(result.discountAmount)}</td></tr>` : ''}
  ${result.taxAmount > 0 ? `<tr><td>Tax (${quote.taxRate}%)</td><td style="text-align:right;font-weight:600">${fmt$(result.taxAmount)}</td></tr>` : ''}
  ${result.coverageCost > 0 ? `<tr><td>Coverage</td><td style="text-align:right;font-weight:600">${fmt$(result.coverageCost)}</td></tr>` : ''}
  <tr class="grand"><td>Total</td><td class="amt" style="text-align:right">${fmt$(result.grandTotal)}</td></tr>
</table>

${quote.customerNotes ? `<div class="notes"><strong>Notes:</strong> ${escHtml(quote.customerNotes)}</div>` : ''}

<div class="footer">
  ${escHtml(settings.companyName)} · ${escHtml(settings.companyAddress)} · ${escHtml(settings.companyPhone)}
</div>
</body></html>`;
}

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Generate and open the Quote PDF in a new window. The window then
 * auto-invokes `print()` so the user gets the Save-as-PDF dialog.
 * Async because the template fetch crosses the network; callers can
 * fire-and-forget or await.
 */
export async function generateQuotePdf(
  quote: Quote,
  catalog: QuoteCatalog,
  settings: QuoteStoreSettings,
): Promise<void> {
  let html: string | null = null;
  try {
    html = await generateFromTemplate(quote, catalog, settings);
  } catch (err) {
    console.warn('[quotePdf] template generation threw; using fallback:', err);
  }
  if (!html) {
    html = generateFallbackHtml(quote, catalog, settings);
  }

  const win = window.open('', '_blank');
  if (!win) {
    console.warn('[quotePdf] popup blocked — cannot open PDF window');
    return;
  }
  win.document.write(html);
  win.document.close();
  // Give the browser a beat to paint before invoking the print dialog.
  setTimeout(() => { try { win.print(); } catch (_e) { /* noop */ } }, 300);
}
