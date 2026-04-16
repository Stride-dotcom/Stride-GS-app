-- =====================================================
-- Seed Default Billable Services for All Tenants
-- =====================================================
-- This migration seeds a standard set of billable services
-- for all existing tenants and creates a trigger function
-- to auto-seed services for new tenants.

-- First, create a function to seed default billable services for a tenant
CREATE OR REPLACE FUNCTION public.seed_default_billable_services(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Item Services
  INSERT INTO billable_services (tenant_id, code, name, description, category, charge_unit, is_taxable, sort_order)
  VALUES
    (p_tenant_id, 'RECV', 'Receiving', 'Standard receiving and intake of items', 'item_service', 'per_item', false, 1),
    (p_tenant_id, 'PICK', 'Picking', 'Picking items for orders or shipments', 'item_service', 'per_item', false, 2),
    (p_tenant_id, 'PACK', 'Packing', 'Packing items for shipment', 'item_service', 'per_item', false, 3),
    (p_tenant_id, 'SHIP', 'Shipping', 'Shipping and dispatch of items', 'item_service', 'per_item', false, 4),
    (p_tenant_id, 'INSP', 'Inspection', 'Item inspection and condition assessment', 'item_service', 'per_item', false, 5),
    (p_tenant_id, 'ASSY', 'Assembly', 'Furniture or item assembly', 'item_service', 'per_item', false, 6),
    (p_tenant_id, 'DISP', 'Disposal', 'Item disposal and removal', 'item_service', 'per_item', false, 7),
    (p_tenant_id, 'MOVE', 'Internal Move', 'Moving items between locations', 'item_service', 'per_item', false, 8)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Storage Services
  INSERT INTO billable_services (tenant_id, code, name, description, category, charge_unit, is_taxable, sort_order)
  VALUES
    (p_tenant_id, 'STORAGE', 'Storage', 'Daily storage charge', 'storage', 'per_cubic_foot', false, 10),
    (p_tenant_id, 'STOR-ITEM', 'Item Storage', 'Per-item daily storage', 'storage', 'per_item', false, 11),
    (p_tenant_id, 'STOR-PALLET', 'Pallet Storage', 'Pallet position storage', 'storage', 'per_day', false, 12)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Labor Services
  INSERT INTO billable_services (tenant_id, code, name, description, category, charge_unit, is_taxable, sort_order)
  VALUES
    (p_tenant_id, 'LABOR', 'General Labor', 'General warehouse labor', 'labor', 'per_hour', true, 20),
    (p_tenant_id, 'LABOR-OT', 'Overtime Labor', 'Overtime warehouse labor', 'labor', 'per_hour', true, 21),
    (p_tenant_id, 'REPAIR', 'Repair Labor', 'Furniture or item repair work', 'labor', 'per_hour', true, 22),
    (p_tenant_id, 'TOUCHUP', 'Minor Touch-up', 'Minor repairs and touch-ups', 'labor', 'per_item', true, 23)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Accessorial Services
  INSERT INTO billable_services (tenant_id, code, name, description, category, charge_unit, is_taxable, sort_order)
  VALUES
    (p_tenant_id, 'PHOTO', 'Photography', 'Item photography service', 'accessorial', 'per_item', true, 30),
    (p_tenant_id, 'SPECIAL-HANDLE', 'Special Handling', 'Special handling for fragile/oversize items', 'accessorial', 'per_event', true, 31),
    (p_tenant_id, 'RUSH', 'Rush Service', 'Expedited processing', 'accessorial', 'flat', true, 32),
    (p_tenant_id, 'AFTER-HOURS', 'After Hours', 'After hours service fee', 'accessorial', 'per_hour', true, 33)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Add-on Charges
  INSERT INTO billable_services (tenant_id, code, name, description, category, charge_unit, is_taxable, sort_order)
  VALUES
    (p_tenant_id, 'NO-ID', 'Received Without ID', 'Item received without identification', 'addon', 'per_item', false, 40),
    (p_tenant_id, 'RESTOCK', 'Restocking Fee', 'Restocking fee for returned items', 'addon', 'per_item', true, 41),
    (p_tenant_id, 'CUSTOM-PKG', 'Custom Packaging', 'Custom packaging materials', 'addon', 'per_item', true, 42)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$;

-- Add unique constraint to prevent duplicate service codes per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'billable_services_tenant_code_unique'
  ) THEN
    ALTER TABLE billable_services 
    ADD CONSTRAINT billable_services_tenant_code_unique 
    UNIQUE (tenant_id, code);
  END IF;
END $$;

-- Seed services for all existing tenants
DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM tenants LOOP
    PERFORM public.seed_default_billable_services(tenant_record.id);
  END LOOP;
END $$;

-- Create trigger to auto-seed services for new tenants
CREATE OR REPLACE FUNCTION public.auto_seed_tenant_billable_services()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_billable_services(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_seed_billable_services ON tenants;
CREATE TRIGGER trigger_seed_billable_services
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_seed_tenant_billable_services();