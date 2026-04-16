-- NVPC Phase 3: Receiving Execution Layer
-- Creates: receiving_discrepancies, shipment_photos tables
-- Adds: dock_intake_breakdown column to shipments

-- ============================================================
-- 1. receiving_discrepancies
-- ============================================================
CREATE TABLE IF NOT EXISTS public.receiving_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PIECES_MISMATCH','DAMAGE','WET','OPEN','MISSING_DOCS','REFUSED','OTHER')),
  details JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_receiving_discrepancies_shipment
  ON public.receiving_discrepancies(shipment_id);

CREATE INDEX IF NOT EXISTS idx_receiving_discrepancies_tenant_status
  ON public.receiving_discrepancies(tenant_id, status);

ALTER TABLE public.receiving_discrepancies ENABLE ROW LEVEL SECURITY;

-- RLS policies for receiving_discrepancies
CREATE POLICY "receiving_discrepancies_select"
  ON public.receiving_discrepancies FOR SELECT
  USING (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

CREATE POLICY "receiving_discrepancies_insert"
  ON public.receiving_discrepancies FOR INSERT
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

CREATE POLICY "receiving_discrepancies_update"
  ON public.receiving_discrepancies FOR UPDATE
  USING (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

CREATE POLICY "receiving_discrepancies_delete"
  ON public.receiving_discrepancies FOR DELETE
  USING (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

-- ============================================================
-- 2. shipment_photos (Stage 1 shipment-level photos)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shipment_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  category TEXT NOT NULL CHECK (category IN ('PAPERWORK','CONDITION','OTHER')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_photos_shipment
  ON public.shipment_photos(tenant_id, shipment_id);

ALTER TABLE public.shipment_photos ENABLE ROW LEVEL SECURITY;

-- RLS policies for shipment_photos
CREATE POLICY "shipment_photos_select"
  ON public.shipment_photos FOR SELECT
  USING (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

CREATE POLICY "shipment_photos_insert"
  ON public.shipment_photos FOR INSERT
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

CREATE POLICY "shipment_photos_update"
  ON public.shipment_photos FOR UPDATE
  USING (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

CREATE POLICY "shipment_photos_delete"
  ON public.shipment_photos FOR DELETE
  USING (tenant_id = (SELECT (auth.jwt()->>'tenant_id')::uuid));

-- ============================================================
-- 3. Additive column on shipments (only if missing)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shipments'
      AND column_name = 'dock_intake_breakdown'
  ) THEN
    ALTER TABLE public.shipments ADD COLUMN dock_intake_breakdown JSONB;
  END IF;
END
$$;
