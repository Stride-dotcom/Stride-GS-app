-- ============================================================
-- Add taxable_subtotal snapshot to dt_orders.
--
-- Companion to 20260426190000 (tax_amount / tax_rate_pct /
-- customer_tax_exempt). That migration's v1 model taxed the entire
-- pre-tax subtotal (delivery fee + extra pieces + drive-out +
-- accessorials + coverage). That is wrong: only service_catalog
-- services flagged taxable=true (felt pads, fabric protection, …)
-- are taxable. Delivery labor, zone/base fee, the XTRA_PC extra-piece
-- fee (taxable=false), and the coverage charge are NOT.
--
-- The DO modal now computes tax = SUM(taxable accessorial subtotals)
-- × rate. This column snapshots that taxable base at order-creation
-- so the row is self-describing for audit and the eventual
-- billing-ledger writer can reconcile tax_amount without recomputing
-- against a possibly-changed live catalog.
--
-- NULL on legacy rows and on tax-exempt / unpriced orders (same
-- convention as tax_amount).
--
-- 2026-05-19 PST
-- ============================================================

ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS taxable_subtotal numeric(10,2);

COMMENT ON COLUMN public.dt_orders.taxable_subtotal IS
  'Snapshot of the order subtotal that sales tax was applied to (sum of service_catalog.taxable=true accessorial line subtotals) at order-creation. NULL when tax_amount is NULL (exempt/legacy/unpriced).';

NOTIFY pgrst, 'reload schema';
