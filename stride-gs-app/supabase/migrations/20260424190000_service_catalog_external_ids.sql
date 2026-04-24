-- ============================================================
-- Add external catalog IDs to service_catalog
-- stax_item_id: Stax payment platform catalog item UUID
-- qb_item_id: QuickBooks Online service item ID
-- Both populated by auto-sync on service create/update
-- ============================================================

ALTER TABLE public.service_catalog
  ADD COLUMN IF NOT EXISTS stax_item_id text,
  ADD COLUMN IF NOT EXISTS qb_item_id   text;

COMMENT ON COLUMN public.service_catalog.stax_item_id IS 'Stax catalog item UUID — auto-synced on save';
COMMENT ON COLUMN public.service_catalog.qb_item_id   IS 'QuickBooks Online service item ID — auto-synced on save';
