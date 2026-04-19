-- ============================================================
-- Quote Catalog extensions — classes, tax areas, coverage options
--
-- Completes the migration of the Quote Tool off localStorage. After
-- this ships, every piece of catalog data (services, classes, tax
-- areas, coverage options) lives in Supabase. Quotes themselves + the
-- per-user Quote Tool settings (prefix, expiration days, etc.) stay
-- in localStorage by design.
-- ============================================================

-- ── 1. item_classes ──────────────────────────────────────────
-- XS … XXL. String IDs so quoteTypes.ClassDef.id matches directly.

CREATE TABLE IF NOT EXISTS public.item_classes (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  display_order integer NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_classes_order ON public.item_classes (display_order);


-- ── 2. tax_areas ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tax_areas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  rate          numeric NOT NULL,  -- percent, e.g. 10.4
  active        boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_areas_order ON public.tax_areas (display_order);
CREATE INDEX IF NOT EXISTS idx_tax_areas_active ON public.tax_areas (active) WHERE active = true;

CREATE OR REPLACE TRIGGER tax_areas_updated_at
  BEFORE UPDATE ON public.tax_areas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 3. coverage_options ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coverage_options (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  calc_type     text NOT NULL CHECK (calc_type IN ('per_lb', 'percent_declared', 'flat')),
  rate          numeric NOT NULL,
  taxable       boolean NOT NULL DEFAULT false,
  note          text,
  active        boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coverage_options_order ON public.coverage_options (display_order);


-- ── 4. RLS ───────────────────────────────────────────────────

ALTER TABLE public.item_classes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_areas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_options ENABLE ROW LEVEL SECURITY;

-- item_classes
DROP POLICY IF EXISTS "item_classes_select_all" ON public.item_classes;
CREATE POLICY "item_classes_select_all" ON public.item_classes
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "item_classes_admin_write" ON public.item_classes;
CREATE POLICY "item_classes_admin_write" ON public.item_classes
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');
DROP POLICY IF EXISTS "item_classes_service_all" ON public.item_classes;
CREATE POLICY "item_classes_service_all" ON public.item_classes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- tax_areas
DROP POLICY IF EXISTS "tax_areas_select_all" ON public.tax_areas;
CREATE POLICY "tax_areas_select_all" ON public.tax_areas
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "tax_areas_admin_write" ON public.tax_areas;
CREATE POLICY "tax_areas_admin_write" ON public.tax_areas
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');
DROP POLICY IF EXISTS "tax_areas_service_all" ON public.tax_areas;
CREATE POLICY "tax_areas_service_all" ON public.tax_areas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- coverage_options
DROP POLICY IF EXISTS "coverage_options_select_all" ON public.coverage_options;
CREATE POLICY "coverage_options_select_all" ON public.coverage_options
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "coverage_options_admin_write" ON public.coverage_options;
CREATE POLICY "coverage_options_admin_write" ON public.coverage_options
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');
DROP POLICY IF EXISTS "coverage_options_service_all" ON public.coverage_options;
CREATE POLICY "coverage_options_service_all" ON public.coverage_options
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── 5. Realtime ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'item_classes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.item_classes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tax_areas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tax_areas;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'coverage_options') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_options;
  END IF;
END $$;
