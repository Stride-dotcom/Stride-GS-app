-- Add Reference to autocomplete_db field whitelist + backfill from
-- public.inventory.reference and public.billing.reference (mirroring
-- the sidemark/vendor/description backfill from earlier today).
--
-- Backfill stats (2026-05-03):
--   440 references / 26 tenants seeded.

-- 1. Replace the CHECK constraint on field to allow 'Reference'.
ALTER TABLE public.autocomplete_db DROP CONSTRAINT IF EXISTS autocomplete_db_field_check;
ALTER TABLE public.autocomplete_db
  ADD CONSTRAINT autocomplete_db_field_check
  CHECK (field IN ('Sidemark', 'Vendor', 'Description', 'Reference'));

-- 2. Backfill from inventory + billing. Idempotent via PK.
INSERT INTO public.autocomplete_db (tenant_id, field, value)
SELECT DISTINCT i.tenant_id, 'Reference', TRIM(i.reference)
  FROM public.inventory i
 WHERE NULLIF(TRIM(i.reference), '') IS NOT NULL
ON CONFLICT (tenant_id, field, value) DO NOTHING;

INSERT INTO public.autocomplete_db (tenant_id, field, value)
SELECT DISTINCT b.tenant_id, 'Reference', TRIM(b.reference)
  FROM public.billing b
 WHERE NULLIF(TRIM(b.reference), '') IS NOT NULL
ON CONFLICT (tenant_id, field, value) DO NOTHING;

NOTIFY pgrst, 'reload schema';
