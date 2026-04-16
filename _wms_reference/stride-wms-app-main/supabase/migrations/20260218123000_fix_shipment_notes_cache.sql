-- Ensure shipment_notes exists and refresh PostgREST schema cache.
-- This is intentionally idempotent and safe to run in environments where
-- 20260218100000_shipment_notes_system.sql may have been skipped or partially applied.

CREATE TABLE IF NOT EXISTS public.shipment_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  shipment_id UUID,
  parent_note_id UUID,
  note TEXT NOT NULL DEFAULT '',
  note_type TEXT NOT NULL DEFAULT 'internal',
  visibility TEXT,
  exception_code TEXT,
  is_chip_generated BOOLEAN DEFAULT false,
  version INTEGER DEFAULT 1,
  is_current BOOLEAN DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

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
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF to_regclass('public.shipment_notes') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.shipment_notes
        ADD CONSTRAINT shipment_notes_note_type_check
        CHECK (note_type IN ('internal', 'public', 'exception'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
