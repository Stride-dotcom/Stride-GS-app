-- Stage A mirror drift cleanup
-- Adds genuinely missing fields that handleGetXxx_ returns but sbXxxRow_ never mirrored.
-- Excludes inv-overlay fields per Invariant #27 (Inventory is single source of truth;
-- React overlays via _fetchInvFieldMap on Supabase-first reads).
--
-- Also introduces will_call_items to eliminate the WC detail GAS-fallback path.

-- ─── Shipments ────────────────────────────────────────────────────────────
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS photos_url  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_url TEXT NOT NULL DEFAULT '';

-- ─── Will Calls ───────────────────────────────────────────────────────────
ALTER TABLE public.will_calls
  ADD COLUMN IF NOT EXISTS created_by          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pickup_phone        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requested_by        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS actual_pickup_date  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS total_wc_fee        NUMERIC;

-- ─── Repairs ──────────────────────────────────────────────────────────────
-- Genuine repair-owned fields only. Inv-overlay fields (description, vendor,
-- location, sidemark, room, reference, class, carrier, tracking, photo URLs)
-- intentionally excluded — React overlays them from the inventory row at
-- read time per Invariant #27.
ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS source_task_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS parts_cost     NUMERIC,
  ADD COLUMN IF NOT EXISTS labor_hours    NUMERIC,
  ADD COLUMN IF NOT EXISTS invoice_id     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS billed         BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── will_call_items ──────────────────────────────────────────────────────
-- Mirror of the WC_Items sheet tab. Tenant-scoped, composite PK, RLS-gated.
-- GAS writes via sbWillCallItemRow_ on every WC create / release / cancel.
-- Inv-overlay fields (vendor, description, location, etc.) excluded per
-- Invariant #27.
CREATE TABLE IF NOT EXISTS public.will_call_items (
  tenant_id   TEXT        NOT NULL,
  wc_number   TEXT        NOT NULL,
  item_id     TEXT        NOT NULL,
  qty         NUMERIC     NOT NULL DEFAULT 1,
  wc_fee      NUMERIC,
  status      TEXT        NOT NULL DEFAULT '',
  released    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, wc_number, item_id)
);

CREATE INDEX IF NOT EXISTS idx_will_call_items_tenant_wc
  ON public.will_call_items (tenant_id, wc_number);

CREATE INDEX IF NOT EXISTS idx_will_call_items_tenant_item
  ON public.will_call_items (tenant_id, item_id);

ALTER TABLE public.will_call_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.will_call_items REPLICA IDENTITY FULL;

-- RLS mirrors the pattern used on expected_shipments/will_calls/etc:
-- JWT-claim-based tenant check, separate staff/client policies, service-role
-- bypass for GAS write-through. All mutations come from GAS via service key;
-- authenticated users only read.
DROP POLICY IF EXISTS "will_call_items_select_staff" ON public.will_call_items;
CREATE POLICY "will_call_items_select_staff" ON public.will_call_items
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

DROP POLICY IF EXISTS "will_call_items_select_client" ON public.will_call_items;
CREATE POLICY "will_call_items_select_client" ON public.will_call_items
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

DROP POLICY IF EXISTS "will_call_items_service_all" ON public.will_call_items;
CREATE POLICY "will_call_items_service_all" ON public.will_call_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Publish for Realtime so any INSERT/UPDATE fans out to open browsers.
ALTER PUBLICATION supabase_realtime ADD TABLE public.will_call_items;
