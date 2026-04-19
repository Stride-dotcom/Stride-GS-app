-- =====================================================================
-- expected_shipments — user-authored "we're expecting this delivery"
-- entries surfaced on the Shipments → Expected calendar tab.
--
-- Previously stored in per-user localStorage (ephemeral, not shareable).
-- Moving to Supabase so a shipment Justin logs is visible to everyone
-- on his team, and so the list survives device/browser changes.
--
-- RLS follows the same pattern as locations / move_history / dt_orders:
--   admin + staff         → see + write everything
--   client (role=client)  → see + write rows for their own tenant_id
--                           (tenant_id === auth.jwt user_metadata clientSheetId)
--   service_role          → full access (for write-through from GAS if
--                           we ever mirror an expected shipment to the
--                           Google Sheet, which we don't today)
--
-- Soft delete: cancelled = status='cancelled'. No hard DELETE from the
-- React app; that way restoring an accidentally-cancelled shipment is
-- a cheap status flip. When a shipment actually arrives, status flips
-- to 'received' (not implemented yet in the UI, but reserved).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.expected_shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,           -- clientSheetId of the client the shipment is for
  client_name     text,                    -- denormalized for display; may drift, refresh on read
  vendor          text,
  carrier         text,
  tracking        text,
  expected_date   date NOT NULL,
  pieces          integer,
  notes           text,
  status          text NOT NULL DEFAULT 'expected'
                  CHECK (status IN ('expected', 'received', 'cancelled')),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.expected_shipments IS
  'Session 72: user-authored upcoming-delivery entries for the Shipments → Expected calendar. Replaces the per-user localStorage store from the session 72 Expected calendar feature.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expected_shipments_tenant
  ON public.expected_shipments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_expected_shipments_date
  ON public.expected_shipments (expected_date);
CREATE INDEX IF NOT EXISTS idx_expected_shipments_active
  ON public.expected_shipments (tenant_id, expected_date) WHERE status = 'expected';

-- Auto-bump updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.expected_shipments_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expected_shipments_updated_at ON public.expected_shipments;
CREATE TRIGGER expected_shipments_updated_at
  BEFORE UPDATE ON public.expected_shipments
  FOR EACH ROW EXECUTE FUNCTION public.expected_shipments_touch_updated_at();

-- Realtime publication (matches pattern used by locations / move_history)
ALTER TABLE public.expected_shipments REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'expected_shipments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expected_shipments;
  END IF;
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.expected_shipments ENABLE ROW LEVEL SECURITY;

-- Staff / admin: full read
DROP POLICY IF EXISTS "expected_shipments_select_staff" ON public.expected_shipments;
CREATE POLICY "expected_shipments_select_staff" ON public.expected_shipments
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Client: read rows for their own tenant
DROP POLICY IF EXISTS "expected_shipments_select_client" ON public.expected_shipments;
CREATE POLICY "expected_shipments_select_client" ON public.expected_shipments
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

-- Staff / admin: full insert
DROP POLICY IF EXISTS "expected_shipments_insert_staff" ON public.expected_shipments;
CREATE POLICY "expected_shipments_insert_staff" ON public.expected_shipments
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Client: insert for their own tenant
DROP POLICY IF EXISTS "expected_shipments_insert_client" ON public.expected_shipments;
CREATE POLICY "expected_shipments_insert_client" ON public.expected_shipments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

-- Staff / admin: update any
DROP POLICY IF EXISTS "expected_shipments_update_staff" ON public.expected_shipments;
CREATE POLICY "expected_shipments_update_staff" ON public.expected_shipments
  FOR UPDATE TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Client: update rows for their own tenant (e.g. mark received, cancel)
DROP POLICY IF EXISTS "expected_shipments_update_client" ON public.expected_shipments;
CREATE POLICY "expected_shipments_update_client" ON public.expected_shipments
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'))
  WITH CHECK (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

-- Staff / admin: full delete (hard delete still allowed for cleanups even
-- though app uses soft delete)
DROP POLICY IF EXISTS "expected_shipments_delete_staff" ON public.expected_shipments;
CREATE POLICY "expected_shipments_delete_staff" ON public.expected_shipments
  FOR DELETE TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- service_role: full access (matches pattern from other tables)
DROP POLICY IF EXISTS "expected_shipments_service_all" ON public.expected_shipments;
CREATE POLICY "expected_shipments_service_all" ON public.expected_shipments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
