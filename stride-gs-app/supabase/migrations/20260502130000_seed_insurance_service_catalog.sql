-- ============================================================
-- Seed the missing INSURANCE row in service_catalog.
--
-- Background:
--   The 2026-05-01 insurance rate-change migration
--   (20260501175255_insurance_rate_per_10k) UPDATEs
--   service_catalog WHERE code='INSURANCE' — but no such row ever
--   existed. The closest is INSR (Insurance Surcharge, inactive,
--   $0). Result: that UPDATE was a silent no-op and INSURANCE
--   never appeared in the Master Price List or in any service
--   filter dropdown that reads from service_catalog (the Billing
--   page Service filter, the price list editor, etc.).
--
--   Meanwhile the Postgres cron `insurance_bill_due()` writes
--   billing rows with svc_code='INSURANCE' every month — those
--   land in the ledger fine, but they can't be filtered by name
--   in the Billing → Report tab.
--
--   This migration seeds the row idempotently. After it lands,
--   admins can edit copy / rate from Settings → Pricing the same
--   way they edit any other service. The cron + billing engine
--   continue to work unchanged.
--
-- 2026-05-02 PST
-- ============================================================

INSERT INTO public.service_catalog (
  code,
  name,
  category,
  billing,
  rates,
  flat_rate,
  unit,
  taxable,
  active,
  visible_to_client,
  display_order,
  billing_mode,
  description
)
SELECT
  'INSURANCE',
  'Stride Coverage (per $10K declared/month)',
  'Admin',
  'flat',
  '{}'::jsonb,
  30,            -- $30/mo per $10,000 declared (matches insurance_bill_due cron)
  'per_item',    -- nearest match in CHECK constraint {per_day|per_hour|per_item|per_task};
                 -- true semantic is per-$10K-declared-per-month — see description column
  false,         -- not taxable per policy
  true,
  true,          -- visible on client rate quotes / price list page
  30,            -- after the existing 3 admin services in display order
  'per_qty',     -- qty = declared/10000, rate = $30, total = qty × rate (cron does the math)
  'Optional Stride Logistics insurance coverage. Auto-billed monthly via the insurance_bill_due() Postgres cron at $30 per $10,000 declared value, with a $30 monthly minimum (per T&C §2.B). Each client opting into stride_coverage during intake gets one billing row per month under svc_code=''INSURANCE'' (qty = declared_value / 10000, rate = $30, total = qty × rate, floored at $30). Unit is recorded as per_item to satisfy the CHECK constraint; the true semantic is per-$10K-declared-per-month.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_catalog WHERE code = 'INSURANCE'
);

-- Refresh PostgREST schema cache so the new row is immediately
-- visible to API clients without waiting for the next reload.
NOTIFY pgrst, 'reload schema';
