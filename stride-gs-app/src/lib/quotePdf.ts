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
 * Build the line-items rows as a single HTML string of <tr>...</tr>
 * blocks. Column order + cell classes match the invoice-derived quote
 * template's header row so visual styling (border colors, paddings,
 * cell widths) is inherited for free.
 *
 * Invoice-style column layout (7 cols, left→right):
 *   c33 — Service Date   (left blank for quotes)
 *   c32 — Service        (service name)
 *   c32 — Item ID        (service code, or blank)
 *   c41 — Notes          (class name or category fallback)
 *   c39 — Qty
 *   c27 — Rate
 *   c30 — Total
 */
function buildLineItemsRows(calc: CalcResult): string {
  if (calc.lineItems.length === 0) {
    // Empty state row so the table doesn't collapse to zero height.
    return (
      '<tr class="c11">' +
      '<td class="c33" colspan="7" rowspan="1"><p class="c7"><span class="c16">' +
      '(No line items selected — open the quote and choose services.)' +
      '</span></p></td>' +
      '</tr>'
    );
  }

  const cell = (cls: string, text: string, align?: 'right' | 'center') => {
    const pAttr = align === 'right' ? 'c10' : align === 'center' ? 'c18' : 'c7';
    return (
      '<td class="' + cls + '" colspan="1" rowspan="1">' +
      '<p class="' + pAttr + '"><span class="c16">' + text + '</span></p>' +
      '</td>'
    );
  };

  return calc.lineItems
    .map(li => {
      const notes = li.className ? escHtml(li.className) : escHtml(li.category || '');
      return (
        '<tr class="c11">' +
        cell('c33', '') +
        cell('c32', escHtml(li.serviceName)) +
        cell('c32', escHtml(li.serviceCode || '')) +
        cell('c41', notes) +
        cell('c39', String(li.qty), 'center') +
        cell('c27', fmt$(li.rate), 'right') +
        cell('c30', fmt$(li.amount), 'right') +
        '</tr>'
      );
    })
    .join('');
}

/**
 * Replace the whole placeholder <tr>…{{LINE_ITEMS_HTML}}…</tr> row with
 * the generated line-item rows. Inline string replace won't work here
 * because `{{LINE_ITEMS_HTML}}` lives inside a <td><p><span>…</span></p></td>
 * inside a <tr> — a plain substitution would leave that wrapper row in
 * place and insert our `<tr>` rows inside a `<td>`, which browsers
 * reject when parsing into a table.
 *
 * Strategy: find the token, walk backward to the nearest opening `<tr`
 * and forward to the nearest closing `</tr>`, then splice that entire
 * row out and replace with the generated rows.
 */
function replaceLineItemsRow(html: string, lineRowsHtml: string): string {
  const TOKEN = '{{LINE_ITEMS_HTML}}';
  const idx = html.indexOf(TOKEN);
  if (idx < 0) return html;
  const trStart = html.lastIndexOf('<tr', idx);
  const trEnd = html.indexOf('</tr>', idx);
  if (trStart < 0 || trEnd < 0) {
    // Couldn't find a wrapping <tr> — fall back to plain substitution.
    return html.split(TOKEN).join(lineRowsHtml);
  }
  return html.slice(0, trStart) + lineRowsHtml + html.slice(trEnd + '</tr>'.length);
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

  // Step 1: replace the line-items row (structural splice, not string sub).
  let html = replaceLineItemsRow(body, buildLineItemsRows(calc));

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
  const grouped: Record<string, typeof result.lineItems> = {};
  for (const li of result.lineItems) (grouped[li.category] ??= []).push(li);
  const covOption = catalog.coverageOptions.find(c => c.id === quote.coverage.typeId);

  let linesHtml = '';
  for (const [cat, items] of Object.entries(grouped)) {
    linesHtml += `<tr><td colspan="4" style="padding:8px 12px;font-weight:700;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;background:#F8FAFC;border-bottom:1px solid #E2E8F0">${escHtml(cat)}</td></tr>`;
    for (const li of items) {
      linesHtml += `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px">${escHtml(li.serviceName)}${li.className ? ` <span style="color:#94A3B8">(${escHtml(li.className)})</span>` : ''}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:center">${li.qty}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:right">${fmt$(li.rate)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;text-align:right;font-weight:600">${fmt$(li.amount)}</td>
      </tr>`;
    }
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
    <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Qty</th>
    <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Rate</th>
    <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748B;border-bottom:2px solid #E2E8F0;text-transform:uppercase;letter-spacing:0.5px">Amount</th>
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
