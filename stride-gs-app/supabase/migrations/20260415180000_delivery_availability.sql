-- Session 65 — Delivery availability calendar.
-- Warehouse-wide calendar (tenant_id = 'stride' by convention) where admins
-- mark each future date as open / limited / closed. All authenticated users
-- can read; only admin role can write. Client-facing so delivery customers
-- can see available slots.

-- ============================================================
-- TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.delivery_availability (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     text        NOT NULL DEFAULT 'stride',
  date          date        NOT NULL,
  status        text        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'limited', 'closed')),
  updated_by    text,       -- email of the admin who last changed this row
  updated_at    timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now(),
  UNIQUE(tenant_id, date)
);

COMMENT ON TABLE public.delivery_availability
  IS 'Session 65: per-day delivery slot availability for the Stride warehouse calendar. Admin-editable, all-roles readable.';

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_delivery_availability_date
  ON public.delivery_availability (date);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.delivery_availability ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (calendar is public to logged-in users)
DROP POLICY IF EXISTS "da_select_all" ON public.delivery_availability;
CREATE POLICY "da_select_all" ON public.delivery_availability
  FOR SELECT TO authenticated
  USING (true);

-- Only admin can insert
DROP POLICY IF EXISTS "da_insert_admin" ON public.delivery_availability;
CREATE POLICY "da_insert_admin" ON public.delivery_availability
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- Only admin can update
DROP POLICY IF EXISTS "da_update_admin" ON public.delivery_availability;
CREATE POLICY "da_update_admin" ON public.delivery_availability
  FOR UPDATE TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- Only admin can delete
DROP POLICY IF EXISTS "da_delete_admin" ON public.delivery_availability;
CREATE POLICY "da_delete_admin" ON public.delivery_availability
  FOR DELETE TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- Service role bypass (for any backend writes)
DROP POLICY IF EXISTS "da_service_all" ON public.delivery_availability;
CREATE POLICY "da_service_all" ON public.delivery_availability
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- UPSERT FUNCTION (batch update multiple dates at once)
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_delivery_availability(
  p_tenant_id text,
  p_entries   jsonb   -- Array of { "date": "2026-04-14", "status": "open" }
)
RETURNS SETOF public.delivery_availability
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is admin via JWT metadata
  IF (auth.jwt()->'user_metadata'->>'role') <> 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  RETURN QUERY
  INSERT INTO public.delivery_availability (tenant_id, date, status, updated_by, updated_at)
  SELECT
    p_tenant_id,
    (entry->>'date')::date,
    entry->>'status',
    auth.jwt()->>'email',
    now()
  FROM jsonb_array_elements(p_entries) AS entry
  ON CONFLICT (tenant_id, date)
  DO UPDATE SET
    status     = EXCLUDED.status,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_delivery_availability(text, jsonb) TO authenticated;
