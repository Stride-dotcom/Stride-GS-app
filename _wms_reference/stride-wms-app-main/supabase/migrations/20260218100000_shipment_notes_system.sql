-- =============================================================================
-- Shipment Notes System (Public / Internal / Exception)
-- =============================================================================
-- Provides a shipment-level threaded notes system similar to item_notes:
-- - note_type: internal | public | exception
-- - exception notes are client-visible (visibility = 'public')
-- - supports per-exception-code notes (exception_code) for receiving exceptions
-- - supports chip-generated notes (is_chip_generated) for cleanup when a chip is removed
--
-- This is designed to be idempotent across environments where shipment_notes
-- may or may not already exist.

-- -----------------------------------------------------------------------------
-- Compatibility helpers (Client Portal)
-- -----------------------------------------------------------------------------
-- Some environments may not yet have the Client Portal helper functions that
-- many RLS policies rely on (e.g. older migration sets / partial deployments).
-- The shipment_notes RLS policies below reference these helpers, so we ensure
-- they exist here to avoid migration-time failures.

-- Helper function: returns the account_id for a client portal user, or NULL for staff
CREATE OR REPLACE FUNCTION public.client_portal_account_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_account_id UUID;
BEGIN
    SELECT account_id INTO v_account_id
    FROM public.client_portal_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
    LIMIT 1;

    RETURN v_account_id;
EXCEPTION
    WHEN undefined_table THEN
        -- Client portal not installed in this environment.
        RETURN NULL;
    WHEN OTHERS THEN
        RETURN NULL;
END;
$function$;

-- Helper function: check if current user is a client portal user
CREATE OR REPLACE FUNCTION public.is_client_user()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.client_portal_users
        WHERE auth_user_id = auth.uid()
          AND is_active = true
    );
EXCEPTION
    WHEN undefined_table THEN
        -- Client portal not installed in this environment.
        RETURN false;
    WHEN OTHERS THEN
        RETURN false;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Table
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.shipment_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES public.shipments(id) ON DELETE CASCADE,
  parent_note_id UUID REFERENCES public.shipment_notes(id),
  note TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'internal',
  visibility TEXT,
  exception_code TEXT,
  is_chip_generated BOOLEAN DEFAULT false,
  version INTEGER DEFAULT 1,
  is_current BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Ensure missing columns exist (older schemas / manual tables)
ALTER TABLE IF EXISTS public.shipment_notes
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS shipment_id UUID,
  ADD COLUMN IF NOT EXISTS parent_note_id UUID,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS note_type TEXT,
  ADD COLUMN IF NOT EXISTS visibility TEXT,
  ADD COLUMN IF NOT EXISTS exception_code TEXT,
  ADD COLUMN IF NOT EXISTS is_chip_generated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill tenant_id when possible
UPDATE public.shipment_notes sn
SET tenant_id = s.tenant_id
FROM public.shipments s
WHERE sn.tenant_id IS NULL
  AND sn.shipment_id = s.id;

-- Default visibility if missing
UPDATE public.shipment_notes
SET visibility = CASE
  WHEN note_type IN ('public', 'exception') THEN 'public'
  ELSE 'internal'
END
WHERE visibility IS NULL;

-- -----------------------------------------------------------------------------
-- Constraints (use NOT VALID to avoid breaking existing rows)
-- -----------------------------------------------------------------------------

ALTER TABLE public.shipment_notes
  DROP CONSTRAINT IF EXISTS shipment_notes_note_type_check;
ALTER TABLE public.shipment_notes
  ADD CONSTRAINT shipment_notes_note_type_check
  CHECK (note_type IN ('internal', 'public', 'exception')) NOT VALID;

ALTER TABLE public.shipment_notes
  DROP CONSTRAINT IF EXISTS shipment_notes_visibility_check;
ALTER TABLE public.shipment_notes
  ADD CONSTRAINT shipment_notes_visibility_check
  CHECK (visibility IS NULL OR visibility IN ('public', 'internal', 'private')) NOT VALID;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_shipment_notes_tenant_shipment
  ON public.shipment_notes (tenant_id, shipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipment_notes_shipment_created
  ON public.shipment_notes (shipment_id, created_at DESC);

-- Enforce "one chip-generated note per exception code" (soft delete aware)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_notes_chip_generated_unique
  ON public.shipment_notes (shipment_id, exception_code)
  WHERE is_chip_generated = true AND deleted_at IS NULL AND exception_code IS NOT NULL;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.shipment_notes ENABLE ROW LEVEL SECURITY;

-- Staff policies (tenant-wide)
DROP POLICY IF EXISTS "Staff can select shipment notes in their tenant" ON public.shipment_notes;
CREATE POLICY "Staff can select shipment notes in their tenant"
  ON public.shipment_notes FOR SELECT
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can insert shipment notes in their tenant" ON public.shipment_notes;
CREATE POLICY "Staff can insert shipment notes in their tenant"
  ON public.shipment_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can update shipment notes in their tenant" ON public.shipment_notes;
CREATE POLICY "Staff can update shipment notes in their tenant"
  ON public.shipment_notes FOR UPDATE
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  )
  WITH CHECK (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

DROP POLICY IF EXISTS "Staff can delete shipment notes in their tenant" ON public.shipment_notes;
CREATE POLICY "Staff can delete shipment notes in their tenant"
  ON public.shipment_notes FOR DELETE
  TO authenticated
  USING (
    NOT public.is_client_user()
    AND tenant_id = public.user_tenant_id()
  );

-- Client users: read ONLY public notes for shipments in their account
-- (This replaces the earlier broad policy name used in client portal migrations.)
DROP POLICY IF EXISTS "Client users can view shipment notes in their account" ON public.shipment_notes;
DROP POLICY IF EXISTS "Client users can view public shipment notes in their account" ON public.shipment_notes;
CREATE POLICY "Client users can view public shipment notes in their account"
  ON public.shipment_notes FOR SELECT
  TO authenticated
  USING (
    public.is_client_user()
    AND tenant_id = public.user_tenant_id()
    AND visibility = 'public'
    AND EXISTS (
      SELECT 1 FROM public.shipments s
      WHERE s.id = shipment_notes.shipment_id
        AND s.tenant_id = public.user_tenant_id()
        AND s.account_id = public.client_portal_account_id()
    )
  );

GRANT ALL ON TABLE public.shipment_notes TO authenticated;

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_shipment_notes_updated_at ON public.shipment_notes;
CREATE TRIGGER trg_shipment_notes_updated_at
  BEFORE UPDATE ON public.shipment_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

