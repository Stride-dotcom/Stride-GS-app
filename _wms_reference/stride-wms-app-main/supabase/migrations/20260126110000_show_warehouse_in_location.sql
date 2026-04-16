-- Migration: Add show_warehouse_in_location setting
-- This controls whether warehouse name is displayed alongside location code

ALTER TABLE public.tenant_preferences
ADD COLUMN IF NOT EXISTS show_warehouse_in_location boolean DEFAULT true;

COMMENT ON COLUMN public.tenant_preferences.show_warehouse_in_location IS 'When true, displays location as "CODE (Warehouse Name)". When false, displays only location code.';
