-- Add optional SKU field to inventory items.
-- SKU is separate from Stride's internal item_code.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS sku TEXT;

COMMENT ON COLUMN public.items.sku IS 'Optional client/vendor SKU (separate from item_code)';

-- Helps lookups / filtering by SKU within a tenant.
CREATE INDEX IF NOT EXISTS idx_items_tenant_sku ON public.items (tenant_id, sku);

