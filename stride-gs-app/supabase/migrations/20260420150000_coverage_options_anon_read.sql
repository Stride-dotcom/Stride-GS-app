-- coverage_options — anon-read policy so the public intake wizard can
-- interpolate live coverage rate notes into the signed T&C at signing
-- time. Restricted to active=true. Mirrors the same pattern as
-- service_catalog and delivery_zones anon reads.

DROP POLICY IF EXISTS "coverage_options_anon_read" ON public.coverage_options;
CREATE POLICY "coverage_options_anon_read" ON public.coverage_options
  FOR SELECT TO anon USING (active = true);
