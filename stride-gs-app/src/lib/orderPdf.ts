/**
 * orderPdf — generates a printable, branded PDF of a DispatchTrack
 * delivery order. Mirrors the intakePdf pattern: render a self-
 * contained HTML doc, open it in a new window, fire window.print()
 * so the user can save-as-PDF or send to a physical printer.
 *
 * No new deps — just DOM. The DtOrderForUI shape is the source of
 * truth; what we render here is exactly what's on-screen in
 * OrderPage's Details + Items tabs, restyled for an 8.5×11 page.
 */
import type { DtOrderForUI } from './supabaseQueries';

export function generateOrderPdf(order: DtOrderForUI): void {
  const html = buildOrderPrintShell(order);
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow pop-ups for this site, then try again.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Short delay lets the browser render before the print dialog fires
  setTimeout(() => {
    try { win.print(); } catch { /* user may have closed window */ }
  }, 450);
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return iso; }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US'); } catch { return iso; }
}

function fmtWindow(start: string, end: string, tz: string): string {
  if (!start && !end) return '—';
  const fmt = (t: string) => {
    const [hStr, m] = t.split(':');
    let h = parseInt(hStr);
    if (Number.isNaN(h)) return t;
    const p = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12; else if (h > 12) h -= 12;
    return `${h}:${m} ${p}`;
  };
  const timeStr = [start && fmt(start), end && fmt(end)].filter(Boolean).join(' – ');
  const tzShort = tz === 'America/Los_Angeles' ? ' PT' : tz ? ` (${tz})` : '';
  return timeStr + tzShort;
}

function esc(s: string | number | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label: string, value: string | null | undefined): string {
  if (!value || value === '—') return '';
  return `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
}

// ─── Body sections ───────────────────────────────────────────────────────────

function buildScheduleTable(order: DtOrderForUI): string {
  const window = fmtWindow(order.windowStartLocal, order.windowEndLocal, order.timezone);
  const rows = [
    row('Service Date', fmtDate(order.localServiceDate)),
    row('Time Window', window),
    row('Order Type', order.orderType ? order.orderType.replace(/_/g, ' ') : null),
    row('Scheduled', fmtDateTime(order.scheduledAt)),
    row('Started', fmtDateTime(order.startedAt)),
    row('Finished', fmtDateTime(order.finishedAt)),
  ].filter(Boolean).join('');
  if (!rows) return '';
  return `<section><h2>Schedule</h2><table class="kv">${rows}</table></section>`;
}

function buildContactTable(order: DtOrderForUI): string {
  const addressLine = [order.contactAddress, order.contactCity, order.contactState, order.contactZip]
    .filter(Boolean).join(', ');
  const rows = [
    row('Name', order.contactName),
    row('Address', addressLine),
    row('Phone', order.contactPhone),
    row('Email', order.contactEmail),
  ].filter(Boolean).join('');
  if (!rows) return '';
  return `<section><h2>${order.isPickup ? 'Pickup Contact' : 'Delivery Contact'}</h2><table class="kv">${rows}</table></section>`;
}

function buildOrderDetailsTable(order: DtOrderForUI): string {
  const rows = [
    row('PO Number', order.poNumber),
    row('Sidemark', order.sidemark),
    row('Client Reference', order.clientReference),
    row('Source', order.source),
    order.dtDispatchId != null ? row('Dispatch ID', String(order.dtDispatchId)) : '',
  ].filter(Boolean).join('');
  const detailsBlock = order.details
    ? `<div class="notes-block"><div class="notes-label">Details / Notes</div><div class="notes-body">${esc(order.details)}</div></div>`
    : '';
  if (!rows && !detailsBlock) return '';
  return `<section><h2>Order Details</h2>${rows ? `<table class="kv">${rows}</table>` : ''}${detailsBlock}</section>`;
}

function buildDriverTable(order: DtOrderForUI): string {
  const rows = [
    row('Driver', order.driverName),
    order.truckName ? row('Truck', order.truckName) : '',
    order.serviceUnit ? row('Service Unit', order.serviceUnit) : '',
    order.stopNumber != null ? row('Stop #', String(order.stopNumber)) : '',
    order.actualServiceTimeMinutes != null ? row('Service Time', `${order.actualServiceTimeMinutes} min`) : '',
    order.codAmount != null ? row('COD Amount', fmtCurrency(order.codAmount)) : '',
    order.signatureCapturedAt ? row('Signature Captured', fmtDateTime(order.signatureCapturedAt)) : '',
  ].filter(Boolean).join('');
  if (!rows) return '';
  return `<section><h2>Driver &amp; Route</h2><table class="kv">${rows}</table></section>`;
}

function buildItemsTable(order: DtOrderForUI): string {
  if (!order.items || order.items.length === 0) {
    return `<section><h2>Items</h2><div class="empty">No items on this order.</div></section>`;
  }
  const rows = order.items.map((it, idx) => {
    const qty = it.quantity != null ? String(it.quantity) : '—';
    const delivered = it.deliveredQuantity != null ? String(it.deliveredQuantity) : '';
    const amount = it.unitPrice != null && it.unitPrice > 0 ? fmtCurrency(it.unitPrice) : '';
    const meta: string[] = [];
    if (it.dtItemCode) meta.push(`SKU ${esc(it.dtItemCode)}`);
    if (it.vendor)     meta.push(`Vendor: ${esc(it.vendor)}`);
    if (it.sidemark)   meta.push(`Sidemark: ${esc(it.sidemark)}`);
    if (it.location)   meta.push(`Location: ${esc(it.location)}`);
    if (it.room)       meta.push(`Room: ${esc(it.room)}`);
    const metaLine = meta.length > 0 ? `<div class="item-meta">${meta.join(' · ')}</div>` : '';
    const noteLine = it.notes ? `<div class="item-note">${esc(it.notes)}</div>` : '';
    const driverNote = it.itemNote ? `<div class="item-driver-note"><strong>Driver note:</strong> ${esc(it.itemNote)}</div>` : '';
    return `
      <tr>
        <td class="num">${idx + 1}</td>
        <td>
          <div class="item-desc">${esc(it.description || '—')}</div>
          ${metaLine}
          ${noteLine}
          ${driverNote}
        </td>
        <td class="num">${qty}</td>
        <td class="num">${esc(delivered)}</td>
        <td class="num">${esc(amount)}</td>
      </tr>`;
  }).join('');
  return `<section>
    <h2>Items</h2>
    <table class="items">
      <thead>
        <tr><th class="num">#</th><th>Description</th><th class="num">Qty</th><th class="num">Delivered</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function buildPricingTable(order: DtOrderForUI): string {
  const hasPricing =
    order.baseDeliveryFee != null ||
    order.orderTotal != null ||
    (order.accessorials?.length ?? 0) > 0 ||
    order.extraItemsCount > 0 ||
    order.fabricProtectionTotal > 0;
  if (!hasPricing) return '';

  const lines: string[] = [];
  if (order.baseDeliveryFee != null) {
    lines.push(`<tr><td>${order.isPickup ? 'Base Pickup Fee' : 'Base Delivery Fee'}</td><td class="num">${fmtCurrency(order.baseDeliveryFee)}</td></tr>`);
  }
  if (order.extraItemsCount > 0) {
    lines.push(`<tr><td>Extra Items (${order.extraItemsCount} × $25)</td><td class="num">${fmtCurrency(order.extraItemsFee)}</td></tr>`);
  }
  if (order.accessorials?.length) {
    for (const a of order.accessorials) {
      const label = a.code + (a.quantity > 1 ? ` × ${a.quantity}` : '');
      lines.push(`<tr><td>${esc(label)}</td><td class="num">${fmtCurrency(a.subtotal)}</td></tr>`);
    }
  }
  if (order.fabricProtectionTotal > 0) {
    lines.push(`<tr><td>Fabric Protection</td><td class="num">${fmtCurrency(order.fabricProtectionTotal)}</td></tr>`);
  }
  const totalRow = order.orderTotal != null
    ? `<tr class="total-row"><td>Order Total${order.pricingOverride ? ' <span class="manual-badge">MANUAL</span>' : ''}</td><td class="num">${fmtCurrency(order.orderTotal)}</td></tr>`
    : '';
  const notes = order.pricingNotes
    ? `<div class="pricing-notes">${esc(order.pricingNotes)}</div>`
    : '';
  return `<section>
    <h2>Pricing</h2>
    <table class="totals">${lines.join('')}${totalRow}</table>
    ${notes}
  </section>`;
}

// ─── Print shell ─────────────────────────────────────────────────────────────

function buildOrderPrintShell(order: DtOrderForUI): string {
  const orderNumber = order.dtIdentifier || order.id.slice(0, 8).toUpperCase();
  const statusLabel = order.statusName || order.statusCode || '—';
  const generated = new Date().toLocaleString('en-US');
  const docTypeLabel = order.isPickup ? 'Pickup Order' : 'Delivery Order';

  const sections = [
    buildScheduleTable(order),
    buildContactTable(order),
    buildOrderDetailsTable(order),
    buildItemsTable(order),
    buildPricingTable(order),
    buildDriverTable(order),
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(docTypeLabel)} — ${esc(orderNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #fff;
      color: #1C1C1C;
      font-size: 12.5px;
      line-height: 1.55;
    }

    /* Printer-friendly header — white background, dark text, no
       ink-heavy block. Real Stride logo image (absolute URL so the
       about:blank popup can fetch it from GitHub Pages). */
    .print-header {
      background: #fff;
      color: #1C1C1C;
      padding: 18px 32px 14px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1C1C1C;
      max-width: 820px;
      margin: 0 auto;
    }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .header-logo {
      width: 44px; height: 44px;
      object-fit: contain;
      display: block;
    }
    .header-name { font-size: 16px; font-weight: 800; letter-spacing: 2.5px; color: #1C1C1C; }
    .header-sub  { font-size: 10px; letter-spacing: 1.5px; color: #64748B; margin-top: 2px; }
    .header-meta { text-align: right; font-size: 11px; color: #64748B; line-height: 1.5; }
    .header-meta strong { color: #1C1C1C; font-size: 13px; }
    .header-id { color: #E8692A; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }

    .doc-body { max-width: 820px; margin: 0 auto; padding: 28px 24px 48px; }

    .order-summary {
      background: #fff;
      border: 1px solid rgba(0,0,0,0.07);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .summary-block { flex: 1; min-width: 0; }
    .summary-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #94A3B8; margin-bottom: 4px; }
    .summary-value { font-size: 14px; font-weight: 600; color: #1C1C1C; word-break: break-word; }
    .summary-status {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 100px;
      background: #EFF6FF;
      color: #1D4ED8;
      font-size: 11px;
      font-weight: 600;
    }

    section {
      background: #fff;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 14px;
      border: 1px solid rgba(0,0,0,0.07);
    }
    h2 {
      font-size: 11px; font-weight: 700; color: #94A3B8;
      text-transform: uppercase; letter-spacing: 2px;
      margin-bottom: 12px; padding-bottom: 8px;
      border-bottom: 1px solid #F0ECE6;
    }

    table.kv { width: 100%; border-collapse: collapse; }
    table.kv th, table.kv td { padding: 5px 0; font-size: 12px; vertical-align: top; }
    table.kv th {
      width: 140px;
      text-align: left;
      font-weight: 500;
      color: #64748B;
      font-size: 11px;
    }
    table.kv td { color: #1C1C1C; font-weight: 500; }

    .notes-block { margin-top: 10px; padding: 10px 12px; background: #F8FAFC; border-radius: 8px; border-left: 3px solid #E8692A; }
    .notes-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #94A3B8; margin-bottom: 4px; }
    .notes-body { font-size: 12px; color: #334155; white-space: pre-wrap; }

    table.items { width: 100%; border-collapse: collapse; }
    table.items thead th {
      font-size: 9.5px;
      font-weight: 700;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1.5px solid #E2E8F0;
    }
    table.items td { padding: 8px; font-size: 12px; vertical-align: top; border-bottom: 1px solid #F1F5F9; }
    table.items tbody tr:last-child td { border-bottom: none; }
    table.items .num { text-align: right; white-space: nowrap; }
    table.items thead th.num { text-align: right; }
    .item-desc { font-weight: 600; color: #1C1C1C; margin-bottom: 2px; }
    .item-meta { font-size: 11px; color: #64748B; line-height: 1.45; }
    .item-note { font-size: 11px; color: #94A3B8; font-style: italic; margin-top: 3px; }
    .item-driver-note {
      font-size: 11px; color: #92400E;
      margin-top: 4px;
      padding: 5px 8px;
      background: #FFFBEB;
      border-left: 2px solid #F59E0B;
      border-radius: 4px;
    }

    table.totals { width: 100%; border-collapse: collapse; }
    table.totals td { padding: 5px 0; font-size: 12.5px; }
    table.totals td.num { text-align: right; font-weight: 600; }
    table.totals td:first-child { color: #475569; }
    table.totals .total-row td {
      padding-top: 10px;
      margin-top: 10px;
      border-top: 1.5px solid #E2E8F0;
      font-size: 14px;
      font-weight: 700;
      color: #1C1C1C;
    }
    .manual-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      background: #FEF3C7;
      color: #B45309;
      font-size: 9px;
      font-weight: 700;
      border-radius: 6px;
      vertical-align: middle;
    }
    .pricing-notes {
      font-size: 11px;
      color: #94A3B8;
      font-style: italic;
      margin-top: 8px;
    }
    .empty { font-size: 12px; color: #94A3B8; padding: 6px 0; }

    .print-footer {
      text-align: center; font-size: 10.5px; color: #94A3B8;
      margin-top: 24px; padding-top: 14px;
      border-top: 1px solid #E2E8F0; line-height: 1.6;
    }

    @media print {
      body { background: #fff; }
      section { break-inside: avoid; }
      table.items tr { break-inside: avoid; }
      @page { margin: 0.4in; size: letter; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <div class="header-brand">
      <img class="header-logo" src="https://www.mystridehub.com/stride-logo.png" alt="Stride Logistics" />
      <div>
        <div class="header-name">STRIDE</div>
        <div class="header-sub">LOGISTICS</div>
      </div>
    </div>
    <div class="header-meta">
      <div>${esc(docTypeLabel)}</div>
      <div class="header-id">${esc(orderNumber)}</div>
      <div>Generated ${esc(generated)}</div>
    </div>
  </div>
  <div class="doc-body">
    <div class="order-summary">
      <div class="summary-block">
        <div class="summary-label">Client</div>
        <div class="summary-value">${esc(order.clientName || '—')}</div>
      </div>
      <div class="summary-block">
        <div class="summary-label">Status</div>
        <div class="summary-value"><span class="summary-status">${esc(statusLabel)}</span></div>
      </div>
      <div class="summary-block" style="text-align:right;">
        <div class="summary-label">Service Date</div>
        <div class="summary-value">${esc(fmtDate(order.localServiceDate))}</div>
      </div>
    </div>
    ${sections}
    <div class="print-footer">
      Stride Logistics · Express Installation Services Inc, DBA Stride Logistics · 19803 87th Ave S, Kent, WA 98031<br>
      info@stridenw.com · mystridehub.com<br>
      ${esc(docTypeLabel)} ${esc(orderNumber)} — generated ${esc(generated)}
    </div>
  </div>
</body>
</html>`;
}
