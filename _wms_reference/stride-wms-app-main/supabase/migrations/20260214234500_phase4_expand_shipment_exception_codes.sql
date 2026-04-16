-- =============================================================================
-- Phase 4 Batch B
-- Expand shipment_exceptions.code taxonomy to include mismatch-oriented codes
-- while preserving existing condition-oriented codes used in production flows.
-- =============================================================================

-- Some environments may not have this table yet (older tenant DBs / partial migration history).
-- Create it if missing so this taxonomy expansion can run safely.
CREATE TABLE IF NOT EXISTS public.shipment_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
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
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'shipment_exceptions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%code IN (%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.shipment_exceptions DROP CONSTRAINT IF EXISTS %I',
      v_constraint.conname
    );
  END LOOP;
END
$$;

ALTER TABLE IF EXISTS public.shipment_exceptions
  DROP CONSTRAINT IF EXISTS shipment_exceptions_code_allowed;

ALTER TABLE IF EXISTS public.shipment_exceptions
  ADD CONSTRAINT shipment_exceptions_code_allowed
  CHECK (
    code IN (
      'PIECES_MISMATCH',
      'VENDOR_MISMATCH',
      'DESCRIPTION_MISMATCH',
      'SIDEMARK_MISMATCH',
      'SHIPPER_MISMATCH',
      'TRACKING_MISMATCH',
      'REFERENCE_MISMATCH',
      'SHORTAGE',
      'OVERAGE',
      'MIS_SHIP',
      'DAMAGE',
      'WET',
      'OPEN',
      'MISSING_DOCS',
      'REFUSED',
      'CRUSHED_TORN_CARTONS',
      'OTHER'
    )
  );
