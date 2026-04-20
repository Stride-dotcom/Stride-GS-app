-- Session 74: rebuild DOC_QUOTE with a clean browser-printable body.
-- The previous body was derived from DOC_INVOICE via regexp_replace on
-- the Google-Docs-exported HTML (class="c17" 500.2pt left cell,
-- class="c28" 75.8pt right cell, body max-width 576pt). That renders
-- fine through Google's DocumentApp→PDF pipeline but breaks in the
-- browser's window.print() output — the 75.8pt right column forced
-- "{{QUOTE_NUMBER}}" and the "Quote" title to wrap across 3 lines and
-- created a large unused right margin.
--
-- This rewrite uses modern flexbox + percentage table widths, a
-- proper @page declaration for PDF margins, and a clean <tbody>
-- insertion point for {{LINE_ITEMS_HTML}} (no structural-splice
-- workaround needed in quotePdf.ts — plain string substitution works).
--
-- Visual vocabulary still matches the invoice's brand system: bold
-- "Stride Logistics" with orange "WMS" accent, grey right-aligned
-- "QUOTE" title, Prepared-For block on the left, right-aligned
-- Quote Date / Expires meta on the right, dark-filled line-items
-- header, striped rows, right-aligned totals card with a grand-total
-- rule, notes callout, centered footer.
--
-- Table is 5 columns: Service | Class | Qty | Rate | Total.

UPDATE public.email_templates
SET
  subject = 'Quote {{QUOTE_NUMBER}}',
  body = $HTML$<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Quote {{QUOTE_NUMBER}}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0F172A; font-size: 11pt; margin: 0; padding: 0; }
  .brand-row { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0F172A; padding-bottom: 14px; margin-bottom: 22px; }
  .brand { font-size: 20pt; font-weight: 800; letter-spacing: 1.5px; line-height: 1.0; }
  .brand .wms { color: #F05A2D; }
  .brand .sub { display: block; font-size: 8pt; font-weight: 700; letter-spacing: 4px; color: #475569; margin-top: 6px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 22pt; color: #999999; margin: 0; font-weight: 800; letter-spacing: 2px; line-height: 1.0; }
  .doc-title .num { font-size: 11pt; font-weight: 600; margin-top: 6px; color: #334155; }
  .info { display: flex; justify-content: space-between; gap: 40px; margin-bottom: 22px; }
  .info .block { flex: 1; min-width: 0; }
  .info .block.right { text-align: right; }
  .info .label { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: 1.5px; color: #64748B; font-weight: 700; margin-bottom: 4px; }
  .info .name { font-size: 13pt; font-weight: 700; line-height: 1.2; }
  .info .meta-row { font-size: 10pt; line-height: 1.7; color: #334155; }
  .info .meta-row .k { display: inline-block; min-width: 80px; color: #64748B; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .items thead th { background: #0F172A; color: #FFFFFF; padding: 8px 10px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; text-align: left; }
  .items thead th.num { text-align: right; }
  .items tbody td { border-bottom: 1px solid #E2E8F0; padding: 7px 10px; font-size: 10pt; vertical-align: top; }
  .items tbody tr:nth-child(even) td { background: #F8FAFC; }
  .items tbody td.num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 10px; margin-left: auto; width: 280px; border-top: 2px solid #0F172A; padding-top: 8px; }
  .totals .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10pt; }
  .totals .row.grand { border-top: 1px solid #0F172A; margin-top: 6px; padding-top: 7px; font-size: 12pt; font-weight: 800; }
  .totals .row .k { color: #475569; }
  .notes { margin-top: 22px; padding: 12px 14px; background: #F1F5F9; border-left: 3px solid #0F172A; font-size: 10pt; color: #334155; }
  .notes .label { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: 1.5px; color: #64748B; font-weight: 700; margin-bottom: 3px; }
  .footer { margin-top: 26px; border-top: 1px solid #E2E8F0; padding-top: 10px; font-size: 8.5pt; color: #94A3B8; text-align: center; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <div class="brand-row">
    <div>
      <div class="brand">Stride Logistics <span class="wms">WMS</span><span class="sub">WAREHOUSE MANAGEMENT</span></div>
    </div>
    <div class="doc-title">
      <h1>QUOTE</h1>
      <div class="num">{{QUOTE_NUMBER}}</div>
    </div>
  </div>

  <div class="info">
    <div class="block">
      <span class="label">Prepared For</span>
      <div class="name">{{CLIENT_NAME}}</div>
    </div>
    <div class="block right">
      <div class="meta-row"><span class="k">Quote Date</span> {{QUOTE_DATE}}</div>
      <div class="meta-row"><span class="k">Expires</span> {{EXPIRATION_DATE}}</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:45%">Service</th>
        <th style="width:20%">Class</th>
        <th class="num" style="width:10%">Qty</th>
        <th class="num" style="width:12%">Rate</th>
        <th class="num" style="width:13%">Total</th>
      </tr>
    </thead>
    <tbody>
      {{LINE_ITEMS_HTML}}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span class="k">Subtotal</span><span>{{SUBTOTAL}}</span></div>
    <div class="row"><span class="k">Discount</span><span>{{DISCOUNT}}</span></div>
    <div class="row"><span class="k">Tax</span><span>{{TAX}}</span></div>
    <div class="row"><span class="k">Coverage</span><span>{{COVERAGE}}</span></div>
    <div class="row grand"><span>Total</span><span>{{GRAND_TOTAL}}</span></div>
  </div>

  <div class="notes">
    <span class="label">Notes</span>
    <div>{{NOTES}}</div>
  </div>

  <div class="footer">
    Stride Logistics &nbsp;·&nbsp; 19803 87th Ave S Kent, WA 98031 &nbsp;·&nbsp; 206.550.1848 &nbsp;·&nbsp; accounting@stridenw.com
  </div>
</body>
</html>$HTML$,
  notes = 'Quote PDF (browser-printable). Tokens: {{QUOTE_NUMBER}}, {{QUOTE_DATE}}, {{EXPIRATION_DATE}}, {{CLIENT_NAME}}, {{LINE_ITEMS_HTML}} (5-col tbody: Service/Class/Qty/Rate/Total), {{SUBTOTAL}}, {{DISCOUNT}}, {{TAX}}, {{COVERAGE}}, {{GRAND_TOTAL}}, {{NOTES}}. Rendered via window.print() from the Quote Tool.'
WHERE template_key = 'DOC_QUOTE';
