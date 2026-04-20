-- Session 74: rename DOC_INVOICE line-items slot from {{PLACEHOLDER}} to
-- {{LINE_ITEMS_HTML}} so it matches the token GAS actually writes. The
-- original Drive-Doc template used PLACEHOLDER as a literal marker for
-- the line-items table, but StrideAPI.gs' handleCreateInvoice_
-- Supabase-first code path emits {{LINE_ITEMS_HTML}}. With the template
-- out of sync, invoices rendered via the Supabase HTML path were
-- showing a literal "{{PLACEHOLDER}}" string instead of the line items.
--
-- Ripple: DOC_QUOTE already uses {{LINE_ITEMS_HTML}} (and was built off
-- DOC_INVOICE). If the invoice-from-quote regen migration
-- (20260420050000) is ever re-run after this one, the quote template
-- stays correct — this rename is idempotent (regexp_replace on a body
-- with no PLACEHOLDER is a no-op).

UPDATE public.email_templates
SET body = regexp_replace(body, '\{\{PLACEHOLDER\}\}', '{{LINE_ITEMS_HTML}}', 'g')
WHERE template_key = 'DOC_INVOICE';
