
-- Fix RLS policies on shipment_photos to use user_tenant_id() instead of JWT claim
DROP POLICY IF EXISTS "shipment_photos_select" ON public.shipment_photos;
DROP POLICY IF EXISTS "shipment_photos_insert" ON public.shipment_photos;
DROP POLICY IF EXISTS "shipment_photos_update" ON public.shipment_photos;
DROP POLICY IF EXISTS "shipment_photos_delete" ON public.shipment_photos;

CREATE POLICY "shipment_photos_select" ON public.shipment_photos
  FOR SELECT USING (tenant_id = user_tenant_id());

CREATE POLICY "shipment_photos_insert" ON public.shipment_photos
  FOR INSERT WITH CHECK (tenant_id = user_tenant_id());

CREATE POLICY "shipment_photos_update" ON public.shipment_photos
  FOR UPDATE USING (tenant_id = user_tenant_id())
  WITH CHECK (tenant_id = user_tenant_id());

CREATE POLICY "shipment_photos_delete" ON public.shipment_photos
  FOR DELETE USING (tenant_id = user_tenant_id());
