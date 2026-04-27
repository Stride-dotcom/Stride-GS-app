-- ============================================================
-- Add tax-rate to clients + tax fields to dt_orders.
--
-- Companion to 20260426160000 (clients.tax_exempt etc). Most clients
-- are wholesale resellers (tax_exempt=true) and never charge tax. For
-- the rare direct-to-consumer client, the DO modal needs:
--   • a per-customer tax rate (different addresses → different combined
--     state/local rates; user manages this manually for v1, no WA DOR
--     auto-lookup)
--   • snapshot fields on dt_orders so historical audit shows what
--     rate was applied at order-creation time, even if the customer's
--     rate changes later
--
-- For v1 (Task 8a — UI + persisted math only), tax is a single line
-- computed as subtotal × rate. Per-line service.taxable gating is
-- deferred to 8b when an actual billing-ledger writer is built.
--
-- Default rate 10.1% = WA Seattle-area combined retail sales tax
-- (state 6.5% + local 3.6%) circa 2026-04. Operators can edit
-- per-customer in OnboardClientModal (next session).
--
-- 2026-04-26 PST
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tax_rate_pct numeric(5,3) NOT NULL DEFAULT 10.1;

COMMENT ON COLUMN public.clients.tax_rate_pct IS
  'Sales-tax rate (percent) applied at the DO/quote level when this customer is NOT tax_exempt. Default 10.1 (Seattle combined). Edited per-customer in admin UI.';

ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS tax_amount         numeric(10,2),
  ADD COLUMN IF NOT EXISTS tax_rate_pct       numeric(5,3),
  ADD COLUMN IF NOT EXISTS customer_tax_exempt boolean;

COMMENT ON COLUMN public.dt_orders.tax_amount IS
  'Sales tax computed at order-creation. NULL for tax-exempt customers. order_total includes this amount.';
COMMENT ON COLUMN public.dt_orders.tax_rate_pct IS
  'Snapshot of the customer''s tax_rate_pct at order-creation time (audit).';
COMMENT ON COLUMN public.dt_orders.customer_tax_exempt IS
  'Snapshot of clients.tax_exempt at order-creation time. NULL on legacy rows.';

NOTIFY pgrst, 'reload schema';
