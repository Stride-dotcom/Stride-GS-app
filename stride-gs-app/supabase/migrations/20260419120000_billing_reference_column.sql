-- ============================================================
-- Billing: add `reference` column + backfill from inventory
--
-- Mirrors the sidemark pattern (see StrideAPI.gs v38.6.0):
-- Billing_Ledger sheet has no Reference column. React/export use
-- the value resolved from each item's Inventory row at write-time
-- (via api_buildInvFieldsByItemMap_). This migration:
--   1. Adds billing.reference (text, default '')
--   2. Backfills from inventory by matching (tenant_id, item_id)
-- ============================================================

ALTER TABLE public.billing
  ADD COLUMN IF NOT EXISTS reference text NOT NULL DEFAULT '';

-- Backfill from inventory (only rows that are currently blank)
UPDATE public.billing b
   SET reference = COALESCE(i.reference, '')
  FROM public.inventory i
 WHERE b.tenant_id = i.tenant_id
   AND b.item_id   = i.item_id
   AND (b.reference IS NULL OR b.reference = '')
   AND i.reference IS NOT NULL
   AND i.reference <> '';
