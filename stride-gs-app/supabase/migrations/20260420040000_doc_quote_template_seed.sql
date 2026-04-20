-- Session 74: seed DOC_QUOTE template. Clean branded quote PDF template
-- matching the Stride doc style (header + client block + line items +
-- totals + notes + footer). Tokens resolved at generation time by GAS:
--   {{QUOTE_NUMBER}}, {{QUOTE_DATE}}, {{EXPIRATION_DATE}},
--   {{CLIENT_NAME}}, {{CLIENT_ADDRESS}}, {{CLIENT_EMAIL}},
--   {{LINE_ITEMS_HTML}}, {{SUBTOTAL}}, {{DISCOUNT}}, {{TAX}},
--   {{COVERAGE}}, {{GRAND_TOTAL}}, {{NOTES}}
-- ON CONFLICT DO NOTHING so re-running on envs where the key was seeded
-- out-of-band is safe.
INSERT INTO public.email_templates (template_key, subject, body, category, active, notes)
VALUES (
  'DOC_QUOTE',
  'Quote {{QUOTE_NUMBER}}',
  $HTML$<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Quote {{QUOTE_NUMBER}}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #0F172A; font-size: 11pt; margin: 0; padding: 32px 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0F172A; padding-bottom: 18px; margin-bottom: 24px; }
  .brand { font-weight: 800; font-size: 22pt; letter-spacing: 3px; line-height: 1.0; }
  .brand .sub { display: block; font-size: 10pt; letter-spacing: 4px; font-weight: 600; color: #475569; margin-top: 4px; }
  .docmeta { text-align: right; font-size: 10pt; color: #334155; }
  .docmeta .label { text-transform: uppercase; letter-spacing: 1.5px; font-size: 8pt; color: #64748B; }
  .docmeta h1 { font-size: 18pt; margin: 0 0 8px; letter-spacing: 1px; color: #0F172A; font-weight: 700; }
  .parties { display: flex; gap: 40px; margin-bottom: 24px; }
  .party { flex: 1; }
  .party .label { text-transform: uppercase; letter-spacing: 1.5px; font-size: 8pt; color: #64748B; margin-bottom: 6px; }
  .party .name { font-weight: 700; font-size: 12pt; }
  .party .lines { color: #334155; font-size: 10pt; line-height: 1.45; margin-top: 2px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  table.items thead th { background: #0F172A; color: #fff; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 1px; padding: 9px 10px; }
  table.items tbody td { border-bottom: 1px solid #E2E8F0; padding: 9px 10px; font-size: 10pt; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #F8FAFC; }
  table.items .num { text-align: right; white-space: nowrap; }
  .totals { width: 320px; margin-left: auto; border-top: 2px solid #0F172A; padding-top: 10px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 10pt; }
  .totals .row.grand { border-top: 1px solid #0F172A; margin-top: 6px; padding-top: 8px; font-size: 12pt; font-weight: 800; }
  .totals .label { color: #475569; }
  .notes { margin-top: 28px; padding: 14px 16px; background: #F1F5F9; border-left: 3px solid #0F172A; font-size: 10pt; color: #334155; }
  .notes .label { text-transform: uppercase; letter-spacing: 1.5px; font-size: 8pt; color: #64748B; margin-bottom: 4px; }
  .footer { margin-top: 36px; border-top: 1px solid #E2E8F0; padding-top: 12px; font-size: 9pt; color: #64748B; text-align: center; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">
      STRIDE
      <span class="sub">LOGISTICS</span>
    </div>
    <div class="docmeta">
      <h1>QUOTE</h1>
      <div><span class="label">Quote #</span> &nbsp;{{QUOTE_NUMBER}}</div>
      <div><span class="label">Date</span> &nbsp;{{QUOTE_DATE}}</div>
      <div><span class="label">Expires</span> &nbsp;{{EXPIRATION_DATE}}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="label">Prepared For</div>
      <div class="name">{{CLIENT_NAME}}</div>
      <div class="lines">{{CLIENT_ADDRESS}}<br />{{CLIENT_EMAIL}}</div>
    </div>
    <div class="party" style="text-align: right;">
      <div class="label">From</div>
      <div class="name">Stride Logistics</div>
      <div class="lines">20811 87th Ave S<br />Kent, WA 98031<br />billing@stridenw.com</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Service</th>
        <th>Class</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      {{LINE_ITEMS_HTML}}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span class="label">Subtotal</span><span>{{SUBTOTAL}}</span></div>
    <div class="row"><span class="label">Discount</span><span>{{DISCOUNT}}</span></div>
    <div class="row"><span class="label">Tax</span><span>{{TAX}}</span></div>
    <div class="row"><span class="label">Coverage</span><span>{{COVERAGE}}</span></div>
    <div class="row grand"><span>Total</span><span>{{GRAND_TOTAL}}</span></div>
  </div>

  <div class="notes">
    <div class="label">Notes</div>
    {{NOTES}}
  </div>

  <div class="footer">
    This quote is valid until {{EXPIRATION_DATE}}. &nbsp;·&nbsp; Stride Logistics &nbsp;·&nbsp; stridenw.com
  </div>
</body>
</html>$HTML$,
  'document',
  true,
  'Quote PDF template. Tokens: {{QUOTE_NUMBER}}, {{QUOTE_DATE}}, {{EXPIRATION_DATE}}, {{CLIENT_NAME}}, {{CLIENT_ADDRESS}}, {{CLIENT_EMAIL}}, {{LINE_ITEMS_HTML}} (one <tr> per item), {{SUBTOTAL}}, {{DISCOUNT}}, {{TAX}}, {{COVERAGE}}, {{GRAND_TOTAL}}, {{NOTES}}.'
)
ON CONFLICT (template_key) DO NOTHING;
