-- Session 74: make DOC_QUOTE visually identical to DOC_INVOICE.
--
-- The original DOC_QUOTE seed was a hand-written clean template; the
-- user wants it to match the invoice doc (logo, "Stride Logistics WMS"
-- header with the orange WMS accent, grey right-aligned title, Bill-To
-- block, line-items table styling, totals, centered footer).
--
-- Rather than copy/paste the 20KB invoice HTML and hand-edit every
-- visible string, this migration rewrites DOC_QUOTE's body FROM the
-- current DOC_INVOICE body in-place via regexp_replace, substituting
-- only the quote-specific labels/tokens:
--
--   {{INV_NO}}            → {{QUOTE_NUMBER}}
--   {{INV_DATE}}          → {{QUOTE_DATE}}
--   {{DUE_DATE}}          → {{EXPIRATION_DATE}}
--   {{PLACEHOLDER}}       → {{LINE_ITEMS_HTML}}
--   "Payment Terms: ..."  row removed (not applicable for quotes)
--   "Due Date:"           → "Expires:"
--   "Total Due"           → "Total"
--   ">Invoice<"           → ">Quote<"   (title element)
--
-- Everything else — CSS classes, logo, colors, table structure, footer
-- — is inherited verbatim from DOC_INVOICE. If the invoice design
-- changes in the future and this migration is re-run, DOC_QUOTE gets
-- the new look too.

UPDATE public.email_templates AS q
SET
  subject = 'Quote {{QUOTE_NUMBER}}',
  body = (
    SELECT
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(i.body,
                        '\{\{INV_NO\}\}', '{{QUOTE_NUMBER}}', 'g'),
                      '\{\{INV_DATE\}\}', '{{QUOTE_DATE}}', 'g'),
                    '\{\{DUE_DATE\}\}', '{{EXPIRATION_DATE}}', 'g'),
                  '\{\{PLACEHOLDER\}\}', '{{LINE_ITEMS_HTML}}', 'g'),
                '<p class="c10"><span class="c16">Payment Terms:&nbsp;\{\{PAYMENT_TERMS\}\}</span></p>', '', 'g'),
              '<p class="c10"><span class="c16">Payment Terms: &nbsp;\{\{PAYMENT_TERMS\}\}</span></p>', '', 'g'),
            'Due Date:', 'Expires:', 'g'),
          'Total Due', 'Total', 'g'),
        '>Invoice<', '>Quote<', 'g')
    FROM public.email_templates AS i
    WHERE i.template_key = 'DOC_INVOICE'
  ),
  notes = 'Quote PDF — mirrors Invoice styling (logo, header, bill-to, line-items, totals, footer). Tokens: {{QUOTE_NUMBER}}, {{QUOTE_DATE}}, {{EXPIRATION_DATE}}, {{CLIENT_NAME}}, {{LINE_ITEMS_HTML}}, {{SUBTOTAL}}, {{GRAND_TOTAL}}.'
WHERE q.template_key = 'DOC_QUOTE';
