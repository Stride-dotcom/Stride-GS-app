-- Repair quotes — multi-line + tax model.
--
-- Today a Repair carries a single `quote_amount` number. The customer
-- email shows that one number; on completion we write one billing row
-- at that amount; QB applies its own sales tax based on the REPAIR
-- service definition.
--
-- That breaks down when:
--   • A repair job needs Repair charge + add-ons (prep, restocking,
--     pallet, fuel surcharge, etc.) — currently impossible to itemise.
--   • The customer wants to see a tax-inclusive grand total on the
--     quote — currently impossible (no tax math anywhere in the
--     repair quote path).
--
-- We're adding line-items + tax fields. The customer-facing quote
-- becomes a tax-INCLUSIVE total. The QB billing rows that the
-- completion handler writes stay PRE-tax (one per line) so QB doesn't
-- double-tax. As long as Stride's quoted tax rate matches QB's
-- configured rate, the QB invoice total matches the quoted total
-- within rounding.
--
-- Back-compat: existing repairs in flight have `quote_lines_json` =
-- NULL. The completion handler falls back to the legacy single-row
-- behaviour when the JSON is empty.

ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS quote_lines_json       jsonb,
  -- jsonb so we can index per-line later if needed; structure is:
  -- [{ "svcCode": "REPAIR", "svcName": "Repair", "qty": 1,
  --    "rate": 250.00, "taxable": true }, ...]

  -- Snapshotted totals — recomputed and re-stored on every Send Quote
  -- write so the customer email and the persisted record always agree.
  ADD COLUMN IF NOT EXISTS quote_subtotal         numeric(12,2),
  ADD COLUMN IF NOT EXISTS quote_taxable_subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS quote_tax_area_id      uuid,
  ADD COLUMN IF NOT EXISTS quote_tax_area_name    text,
  ADD COLUMN IF NOT EXISTS quote_tax_rate         numeric(6,3),
  ADD COLUMN IF NOT EXISTS quote_tax_amount       numeric(12,2),
  ADD COLUMN IF NOT EXISTS quote_grand_total      numeric(12,2);

COMMENT ON COLUMN public.repairs.quote_lines_json IS
  'Array of repair quote line items. NULL on legacy repairs predating multi-line support; completion handler falls back to a single REPAIR row at quote_amount when this is NULL.';

COMMENT ON COLUMN public.repairs.quote_grand_total IS
  'Tax-inclusive total shown to the customer on the quote email. The QB invoice computes its own tax independently and may differ by rounding.';

-- Realtime: repairs is already in supabase_realtime publication; the
-- new columns ride along automatically. No publication change needed.
