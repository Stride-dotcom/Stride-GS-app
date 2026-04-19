-- ============================================================
-- Service Catalog (Unified Price List — Phase 1)
--
-- One authoritative table for every service Stride offers. Powers:
--   • /price-list page (admin CRUD, category sidebar, edit panel)
--   • Quote Tool catalog (via useServiceCatalog, Phase 2+)
--   • Receiving add-on toggles (OVER300, NO_ID_SHIPMENT — Phase 2+)
--   • Task type dropdowns (INSP, 60MA, 1HRO, etc. — Phase 2+)
--   • Delivery service picker (Phase 2+)
--
-- Billing remains server-side in Apps Script. React never calculates
-- billing — this table is for display, configuration, and rate lookup.
-- ============================================================

-- ── 1. service_catalog ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.service_catalog (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                            text UNIQUE NOT NULL,
  name                            text NOT NULL,
  category                        text NOT NULL,
  billing                         text NOT NULL,
  rates                           jsonb NOT NULL DEFAULT '{}'::jsonb,
  flat_rate                       numeric NOT NULL DEFAULT 0,
  unit                            text NOT NULL,
  taxable                         boolean NOT NULL DEFAULT true,
  active                          boolean NOT NULL DEFAULT true,
  show_in_matrix                  boolean NOT NULL DEFAULT false,
  show_as_task                    boolean NOT NULL DEFAULT false,
  show_as_delivery_service        boolean NOT NULL DEFAULT false,
  show_as_receiving_addon         boolean NOT NULL DEFAULT false,
  auto_apply_rule                 text,
  default_sla_hours               integer,
  default_priority                text,
  has_dedicated_page              boolean NOT NULL DEFAULT false,
  display_order                   integer NOT NULL DEFAULT 999,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_catalog_category_check CHECK (
    category IN ('Warehouse','Storage','Shipping','Assembly','Repair','Labor','Admin','Delivery')
  ),
  CONSTRAINT service_catalog_billing_check CHECK (billing IN ('class_based','flat')),
  CONSTRAINT service_catalog_unit_check CHECK (
    unit IN ('per_item','per_day','per_task','per_hour')
  ),
  CONSTRAINT service_catalog_auto_apply_check CHECK (
    auto_apply_rule IS NULL
    OR auto_apply_rule IN ('overweight','no_id','fragile','oversized')
  ),
  CONSTRAINT service_catalog_default_priority_check CHECK (
    default_priority IS NULL OR default_priority IN ('Normal','High')
  )
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_category   ON public.service_catalog (category);
CREATE INDEX IF NOT EXISTS idx_service_catalog_active     ON public.service_catalog (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_service_catalog_matrix     ON public.service_catalog (show_in_matrix) WHERE show_in_matrix = true;
CREATE INDEX IF NOT EXISTS idx_service_catalog_task_flag  ON public.service_catalog (show_as_task) WHERE show_as_task = true;
CREATE INDEX IF NOT EXISTS idx_service_catalog_order      ON public.service_catalog (display_order);


-- ── 2. service_catalog_audit ─────────────────────────────────
-- One row per field change. Populated by React when admin saves an
-- edit (the useServiceCatalog hook diffs before/after and inserts
-- N audit rows for N changed fields).

CREATE TABLE IF NOT EXISTS public.service_catalog_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       uuid NOT NULL REFERENCES public.service_catalog(id) ON DELETE CASCADE,
  field_changed    text NOT NULL,
  old_value        text,
  new_value        text,
  changed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name  text,
  changed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_svc_audit_service ON public.service_catalog_audit (service_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_svc_audit_time    ON public.service_catalog_audit (changed_at DESC);


-- ── 3. updated_at trigger ────────────────────────────────────

CREATE OR REPLACE TRIGGER service_catalog_updated_at
  BEFORE UPDATE ON public.service_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 4. RLS ───────────────────────────────────────────────────

ALTER TABLE public.service_catalog       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog_audit ENABLE ROW LEVEL SECURITY;

-- service_catalog: all authenticated read, admin-only write
DROP POLICY IF EXISTS "service_catalog_select_all" ON public.service_catalog;
CREATE POLICY "service_catalog_select_all" ON public.service_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_catalog_admin_write" ON public.service_catalog;
CREATE POLICY "service_catalog_admin_write" ON public.service_catalog
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

DROP POLICY IF EXISTS "service_catalog_service_all" ON public.service_catalog;
CREATE POLICY "service_catalog_service_all" ON public.service_catalog
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- service_catalog_audit: all authenticated read, anyone authenticated can insert
-- (audit rows are never updated or deleted by clients — only inserted).
DROP POLICY IF EXISTS "service_catalog_audit_select_all" ON public.service_catalog_audit;
CREATE POLICY "service_catalog_audit_select_all" ON public.service_catalog_audit
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service_catalog_audit_insert_any" ON public.service_catalog_audit;
CREATE POLICY "service_catalog_audit_insert_any" ON public.service_catalog_audit
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "service_catalog_audit_service_all" ON public.service_catalog_audit;
CREATE POLICY "service_catalog_audit_service_all" ON public.service_catalog_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── 5. Realtime ──────────────────────────────────────────────
-- Live updates across admin sessions when someone edits a rate.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'service_catalog'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_catalog;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'service_catalog_audit'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.service_catalog_audit;
  END IF;
END $$;
