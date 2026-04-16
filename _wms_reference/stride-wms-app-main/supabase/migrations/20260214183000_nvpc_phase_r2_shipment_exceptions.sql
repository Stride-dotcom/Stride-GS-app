-- =============================================================================
-- NVPC Phase R2 v1.1: Shipment Exceptions (condition-level, shipment scope)
-- - Adds shipment_exceptions table with tenant RLS and audit fields
-- - Conditionally drops legacy receiving_discrepancies only if empty
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shipment_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (
    code IN (
      'DAMAGE',
      'WET',
      'OPEN',
      'MISSING_DOCS',
      'REFUSED',
      'CRUSHED_TORN_CARTONS',
      'OTHER'
    )
  ),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.users(id),
  reopened_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipment_exceptions_required_note_for_codes
    CHECK (code NOT IN ('REFUSED', 'OTHER') OR btrim(COALESCE(note, '')) <> ''),
  CONSTRAINT shipment_exceptions_required_resolution_note
    CHECK (status <> 'resolved' OR btrim(COALESCE(resolution_note, '')) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_exceptions_open_unique
  ON public.shipment_exceptions (shipment_id, code)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_shipment_exceptions_tenant_shipment
  ON public.shipment_exceptions (tenant_id, shipment_id);

CREATE INDEX IF NOT EXISTS idx_shipment_exceptions_tenant_status
  ON public.shipment_exceptions (tenant_id, status);

ALTER TABLE public.shipment_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_exceptions_tenant_select" ON public.shipment_exceptions;
CREATE POLICY "shipment_exceptions_tenant_select"
  ON public.shipment_exceptions FOR SELECT
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "shipment_exceptions_tenant_insert" ON public.shipment_exceptions;
CREATE POLICY "shipment_exceptions_tenant_insert"
  ON public.shipment_exceptions FOR INSERT
  WITH CHECK (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "shipment_exceptions_tenant_update" ON public.shipment_exceptions;
CREATE POLICY "shipment_exceptions_tenant_update"
  ON public.shipment_exceptions FOR UPDATE
  USING (tenant_id = public.user_tenant_id())
  WITH CHECK (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "shipment_exceptions_tenant_delete" ON public.shipment_exceptions;
CREATE POLICY "shipment_exceptions_tenant_delete"
  ON public.shipment_exceptions FOR DELETE
  USING (tenant_id = public.user_tenant_id());

GRANT ALL ON TABLE public.shipment_exceptions TO authenticated;

DROP TRIGGER IF EXISTS trg_shipment_exceptions_updated_at ON public.shipment_exceptions;
CREATE TRIGGER trg_shipment_exceptions_updated_at
  BEFORE UPDATE ON public.shipment_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE
  v_legacy_count BIGINT := -1;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'receiving_discrepancies'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.receiving_discrepancies' INTO v_legacy_count;

    IF v_legacy_count = 0 THEN
      DROP TABLE public.receiving_discrepancies;
    ELSE
      RAISE NOTICE 'Skipping drop of receiving_discrepancies; % rows found', v_legacy_count;
    END IF;
  END IF;
END
$$;
