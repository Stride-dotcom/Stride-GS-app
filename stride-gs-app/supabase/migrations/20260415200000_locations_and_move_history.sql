-- Session 68 — Locations mirror + Move History table.
--
-- Motivation: Scanner & Labels pages are GAS-iframe-backed today. Location
-- dropdown reads CB Locations sheet (10-min CacheService, slow on miss).
-- Scanner has to rebuild a cross-tenant item-id index by reading every
-- client's Inventory sheet (47+ sheets) before each move — 20-60s for a
-- batch scan. This migration lays the Supabase foundation for a fully
-- native React Scanner + Labels UX:
--
--   • public.locations — mirror of CB Locations, all-roles read, staff+admin
--     write, Realtime-enabled for instant propagation of new locations.
--   • public.move_history — central move audit. Replaces per-client
--     Move History tabs for React-initiated moves. Retains tenant_id so
--     clients only see their own via RLS.
--
-- Fast item→tenant lookup is already in place via public.item_id_ledger
-- (session 63). The new batchUpdateItemLocations endpoint will use that
-- registry instead of scanning sheets → 50ms vs 20-60s.

-- ============================================================
-- LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.locations (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   text        NOT NULL DEFAULT 'stride',  -- warehouse-global by convention
  code        text        NOT NULL,
  notes       text,
  active      boolean     DEFAULT true,
  created_by  text,       -- email
  updated_by  text,       -- email
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(tenant_id, code)
);

COMMENT ON TABLE public.locations IS
  'Session 68: mirror of CB Locations sheet. All authenticated roles read; admin/staff write via RLS. Realtime-enabled so newly-added locations appear instantly in dropdowns everywhere.';

CREATE INDEX IF NOT EXISTS idx_locations_tenant_code ON public.locations (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_locations_active      ON public.locations (active) WHERE active = true;

ALTER TABLE public.locations REPLICA IDENTITY FULL;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- Everyone logged in can read
DROP POLICY IF EXISTS "locations_select_all" ON public.locations;
CREATE POLICY "locations_select_all" ON public.locations
  FOR SELECT TO authenticated USING (true);

-- Admin + staff can insert / update / delete
DROP POLICY IF EXISTS "locations_insert_staff" ON public.locations;
CREATE POLICY "locations_insert_staff" ON public.locations
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

DROP POLICY IF EXISTS "locations_update_staff" ON public.locations;
CREATE POLICY "locations_update_staff" ON public.locations
  FOR UPDATE TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

DROP POLICY IF EXISTS "locations_delete_staff" ON public.locations;
CREATE POLICY "locations_delete_staff" ON public.locations
  FOR DELETE TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Service role bypass (for GAS write-through)
DROP POLICY IF EXISTS "locations_service_all" ON public.locations;
CREATE POLICY "locations_service_all" ON public.locations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- MOVE HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.move_history (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     text        NOT NULL,                   -- client spreadsheet_id
  item_id       text        NOT NULL,
  from_location text,
  to_location   text        NOT NULL,
  moved_by      text,                                    -- email
  moved_at      timestamptz DEFAULT now(),
  source        text        DEFAULT 'scanner' CHECK (source IN ('scanner', 'react_scanner', 'manual', 'bulk_api', 'transfer')),
  notes         text,
  created_at    timestamptz DEFAULT now()
);

COMMENT ON TABLE public.move_history IS
  'Session 68: central audit trail for item location moves. RLS scopes clients to their own tenant; admin/staff see all. Supplements (does not replace) the per-client Move History sheet tab for back-compat.';

CREATE INDEX IF NOT EXISTS idx_move_history_tenant_item ON public.move_history (tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_move_history_item        ON public.move_history (item_id);
CREATE INDEX IF NOT EXISTS idx_move_history_moved_at    ON public.move_history (moved_at DESC);
CREATE INDEX IF NOT EXISTS idx_move_history_to_location ON public.move_history (to_location);

ALTER TABLE public.move_history REPLICA IDENTITY FULL;
ALTER TABLE public.move_history ENABLE ROW LEVEL SECURITY;

-- Staff + admin see everything
DROP POLICY IF EXISTS "move_history_select_staff" ON public.move_history;
CREATE POLICY "move_history_select_staff" ON public.move_history
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Clients see only their own tenant
DROP POLICY IF EXISTS "move_history_select_client" ON public.move_history;
CREATE POLICY "move_history_select_client" ON public.move_history
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

-- Admin + staff can insert (React scanner writes direct; GAS writes via service role)
DROP POLICY IF EXISTS "move_history_insert_staff" ON public.move_history;
CREATE POLICY "move_history_insert_staff" ON public.move_history
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Service role bypass
DROP POLICY IF EXISTS "move_history_service_all" ON public.move_history;
CREATE POLICY "move_history_service_all" ON public.move_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
