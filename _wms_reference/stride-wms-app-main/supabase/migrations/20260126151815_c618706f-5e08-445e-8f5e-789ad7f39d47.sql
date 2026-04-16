-- Drop existing triggers to allow re-creation
DROP TRIGGER IF EXISTS trg_generate_manifest_number ON public.stocktake_manifests;
DROP TRIGGER IF EXISTS trg_record_manifest_creation ON public.stocktake_manifests;
DROP TRIGGER IF EXISTS trg_record_manifest_update ON public.stocktake_manifests;
DROP TRIGGER IF EXISTS trg_record_manifest_item_added ON public.stocktake_manifest_items;
DROP TRIGGER IF EXISTS trg_record_manifest_item_removed ON public.stocktake_manifest_items;

-- Drop existing functions
DROP FUNCTION IF EXISTS public.generate_manifest_number() CASCADE;
DROP FUNCTION IF EXISTS public.record_manifest_creation() CASCADE;
DROP FUNCTION IF EXISTS public.record_manifest_update() CASCADE;
DROP FUNCTION IF EXISTS public.record_manifest_item_added() CASCADE;
DROP FUNCTION IF EXISTS public.record_manifest_item_removed() CASCADE;
DROP FUNCTION IF EXISTS public.record_manifest_scan(UUID, UUID, UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.start_manifest(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.complete_manifest(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_manifest(UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.add_manifest_items_bulk(UUID, UUID[], UUID) CASCADE;
DROP FUNCTION IF EXISTS public.remove_manifest_items_bulk(UUID, UUID[], UUID) CASCADE;

-- Drop view if exists
DROP VIEW IF EXISTS public.v_manifest_stats;

-- Drop policies if they exist
DROP POLICY IF EXISTS "Tenant isolation for manifests" ON public.stocktake_manifests;
DROP POLICY IF EXISTS "Tenant isolation via manifest for items" ON public.stocktake_manifest_items;
DROP POLICY IF EXISTS "Tenant isolation via manifest for history" ON public.stocktake_manifest_history;
DROP POLICY IF EXISTS "Tenant isolation via manifest for scans" ON public.stocktake_manifest_scans;

-- Re-create policies
CREATE POLICY "Tenant isolation for manifests"
ON public.stocktake_manifests FOR ALL
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation via manifest for items"
ON public.stocktake_manifest_items FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktake_manifests m
  WHERE m.id = stocktake_manifest_items.manifest_id
  AND m.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

CREATE POLICY "Tenant isolation via manifest for history"
ON public.stocktake_manifest_history FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktake_manifests m
  WHERE m.id = stocktake_manifest_history.manifest_id
  AND m.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));

CREATE POLICY "Tenant isolation via manifest for scans"
ON public.stocktake_manifest_scans FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.stocktake_manifests m
  WHERE m.id = stocktake_manifest_scans.manifest_id
  AND m.tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
));