import type { Quote, QuoteCatalog, QuoteStoreSettings, CalcResult } from './quoteTypes';
import { calcQuote } from './quoteCalc';

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function generateQuotePdf(quote: Quote, catalog: QuoteCatalog, settings: QuoteStoreSettings): void {
  const result: CalcResult = calcQuote(quote, catalog.services, catalog.classes, catalog.coverageOptions);

  // Group line items by category
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

  const html = `<!DOCTYPE html>
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

  // Open in a new window and trigger print (Save as PDF)
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }
}
