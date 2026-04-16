-- =============================================================================
-- Phase 1.1: Inventory Foundation Cleanup (Additive Only)
--
-- A) Add inventory_units.dims_uom (unit of measure for dimensions)
-- B) Add shipments.updated_by (audit field — proven pattern on 10+ tables)
-- =============================================================================

-- A) inventory_units.dims_uom
ALTER TABLE public.inventory_units
  ADD COLUMN IF NOT EXISTS dims_uom text NULL
  CHECK (dims_uom IS NULL OR dims_uom IN ('in', 'cm'));

COMMENT ON COLUMN public.inventory_units.dims_uom IS 'Unit of measure for dims_l/w/h. NULL = unset; in = inches; cm = centimeters.';

-- B) shipments.updated_by — follows established pattern
--    (account_coverage_settings, invoice_templates, service_categories,
--     stocktake_manifests, tenant_alert_settings, tenant_company_settings,
--     tenant_email_layouts, tenant_legal_pages, inventory_units all have updated_by)
--    No auto-trigger; set by application code like all other updated_by columns.
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL;

COMMENT ON COLUMN public.shipments.updated_by IS 'User who last updated this shipment. Set by application code.';
