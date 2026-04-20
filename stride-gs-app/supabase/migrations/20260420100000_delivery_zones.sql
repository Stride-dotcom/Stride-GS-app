-- delivery_zones — extend the pre-existing Quote Tool table (from
-- 20260417000000_delivery_pricing_schema.sql) with the editorial columns
-- the Price List "Zip Codes" category needs.
--
-- Original schema: zip_code (pk), city, zone, base_rate, pickup_rate,
-- service_days, created_at, updated_at. We keep those untouched (legacy
-- Quote Tool readers still reference base_rate) and bolt on the columns
-- below. base_rate IS the "current effective rate" — we back-populate
-- updated_rate from it so the new UI has a fully-populated canonical
-- column on day one; the hook writes to BOTH columns on save to keep
-- them coherent.
--
-- Seeded from the "PLT 2025 ZIP CODE LIST (ACTIVE)" CSV at session 75
-- time (398 rows): current_rate = 2024 rate, updated_rate = 2025 rate,
-- call_for_quote = true where the source cell reads "CALL FOR QUOTE",
-- out_of_area = true where source zone contained "OUT OF AREA" or
-- service-days read "NON COVERAGE AREA" / "DO NOT SERVICE".

ALTER TABLE public.delivery_zones
  ADD COLUMN IF NOT EXISTS id             uuid        DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS current_rate   numeric     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_rate   numeric     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS out_of_area    boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS call_for_quote boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS active         boolean     DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes          text;

-- Backfill updated_rate from base_rate since they carry the same meaning.
UPDATE public.delivery_zones
   SET updated_rate = base_rate
 WHERE (updated_rate IS NULL OR updated_rate = 0)
   AND base_rate IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_zones_city   ON public.delivery_zones(city);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_zone   ON public.delivery_zones(zone);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_active ON public.delivery_zones(active);

-- RLS: authenticated read for everyone; write restricted to admin role
-- (matches the RoleGuard on the Price List page).
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "delivery_zones_read"        ON public.delivery_zones;
DROP POLICY IF EXISTS "delivery_zones_admin_write" ON public.delivery_zones;

CREATE POLICY "delivery_zones_read" ON public.delivery_zones
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "delivery_zones_admin_write" ON public.delivery_zones
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- Realtime: so the Price List page sees edits from other admins without
-- a manual refresh. Wrapped in a guard so the migration is idempotent
-- across environments where the publication may or may not already
-- include the table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='delivery_zones'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_zones';
  END IF;
END $$;
