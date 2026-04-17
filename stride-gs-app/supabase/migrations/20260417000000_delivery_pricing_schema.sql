-- ============================================================
-- Stride GS App — Delivery Pricing Schema (Phase 2a)
--
-- Creates the pricing engine for delivery/pickup orders:
--   • delivery_zones          — ZIP → zone → base/pickup rate (seeded from PLT sheet)
--   • delivery_accessorials   — add-on rate card (sleeper sofa, priority, detention, etc.)
--   • fabric_protection_rates — per-item-type fabric treatment rates
--
-- Adds pricing + review-workflow columns to dt_orders so orders can be
-- auto-priced from destination ZIP and carry a staff-review state when
-- created by clients via the React app.
--
-- Locked decisions (session 68):
--   - Base rate covers 3 items; $25 per extra item beyond that
--   - Pickup rate < delivery rate (per-zone)
--   - No client-level discounts currently
--   - "Call for quote" zips use null rate + manual override
--   - Client-created orders land in review_status='pending_review',
--     reviewed by staff before push to DT
-- ============================================================

-- ── 1. delivery_zones ────────────────────────────────────────
-- ZIP code → zone → rate lookup. Seeded from PLT_PRICE_LISTS_v2.
-- Rate is null for "CALL FOR QUOTE" zips (manual override on order).

CREATE TABLE IF NOT EXISTS public.delivery_zones (
  zip_code     text PRIMARY KEY,
  city         text NOT NULL,
  zone         text NOT NULL,                -- '1'-'8' or 'out_of_area'
  base_rate    numeric,                      -- null = "call for quote"
  pickup_rate  numeric,                      -- null = "call for quote"
  service_days text,                         -- e.g. "MON - FRI", "TUE / THUR"
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_zones_zone ON public.delivery_zones(zone);
CREATE INDEX IF NOT EXISTS idx_delivery_zones_city ON public.delivery_zones(city);


-- ── 2. delivery_accessorials ─────────────────────────────────
-- Add-on service rate card (sleeper sofa, priority, detention, etc.)

CREATE TABLE IF NOT EXISTS public.delivery_accessorials (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  rate          numeric,                      -- null = call for quote
  rate_unit     text NOT NULL CHECK (rate_unit IN ('flat','per_mile','per_15min','plus_base','per_item')),
  description   text,
  display_order int DEFAULT 0,
  active        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);


-- ── 3. fabric_protection_rates ───────────────────────────────
-- Per-item-type fabric/carpet treatment pricing.

CREATE TABLE IF NOT EXISTS public.fabric_protection_rates (
  item_type     text PRIMARY KEY,
  rate          numeric NOT NULL,
  rate_unit     text NOT NULL CHECK (rate_unit IN ('flat','per_sqft','each')),
  min_charge    numeric,                      -- e.g. $149 for on-site service
  display_order int DEFAULT 0,
  active        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);


-- ── 4. Pricing columns on dt_orders ──────────────────────────

ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS base_delivery_fee       numeric;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS extra_items_count       int DEFAULT 0;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS extra_items_fee         numeric DEFAULT 0;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS accessorials_json       jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS accessorials_total      numeric DEFAULT 0;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS fabric_protection_total numeric DEFAULT 0;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS order_total             numeric;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS pricing_override        boolean DEFAULT false;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS pricing_notes           text;

COMMENT ON COLUMN public.dt_orders.base_delivery_fee     IS 'Zone-based rate looked up from delivery_zones by contact_zip';
COMMENT ON COLUMN public.dt_orders.extra_items_count     IS 'Count of items beyond the 3 included in base rate';
COMMENT ON COLUMN public.dt_orders.extra_items_fee       IS 'extra_items_count * accessorial rate for EXTRA_ITEM code';
COMMENT ON COLUMN public.dt_orders.accessorials_json     IS 'Array of applied accessorials: [{code, quantity, rate, subtotal}, ...]';
COMMENT ON COLUMN public.dt_orders.accessorials_total    IS 'Sum of all accessorial subtotals';
COMMENT ON COLUMN public.dt_orders.fabric_protection_total IS 'Sum of fabric protection line items';
COMMENT ON COLUMN public.dt_orders.order_total           IS 'base_delivery_fee + extra_items_fee + accessorials_total + fabric_protection_total';
COMMENT ON COLUMN public.dt_orders.pricing_override      IS 'True when staff manually set order_total (e.g. call-for-quote zips)';


-- ── 5. Review workflow columns on dt_orders ──────────────────

ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS review_status   text
  DEFAULT 'not_required';

-- Need to add the CHECK constraint separately to avoid failing on
-- existing rows with NULL review_status values during the ADD COLUMN
-- (DEFAULT handles new rows; existing rows were already populated with
-- the default, but the CHECK must tolerate both cases).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dt_orders_review_status_check'
  ) THEN
    ALTER TABLE public.dt_orders
      ADD CONSTRAINT dt_orders_review_status_check
      CHECK (review_status IN ('not_required','pending_review','approved','rejected','revision_requested'));
  END IF;
END $$;

ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS review_notes      text;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS reviewed_by       uuid;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS reviewed_at       timestamptz;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS created_by_user   uuid;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS created_by_role   text;
ALTER TABLE public.dt_orders ADD COLUMN IF NOT EXISTS pushed_to_dt_at   timestamptz;

COMMENT ON COLUMN public.dt_orders.review_status     IS 'not_required | pending_review | approved | rejected | revision_requested';
COMMENT ON COLUMN public.dt_orders.created_by_role   IS 'Role of user who created order in app: client | staff | admin';
COMMENT ON COLUMN public.dt_orders.pushed_to_dt_at   IS 'Timestamp of successful POST to DT /orders/api/add_order';

-- Backfill: all 39 existing DT-imported orders get review_status='not_required'
UPDATE public.dt_orders SET review_status = 'not_required' WHERE review_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_dt_orders_review_status
  ON public.dt_orders (review_status)
  WHERE review_status <> 'not_required';


-- ── 6. Triggers for updated_at ───────────────────────────────

CREATE OR REPLACE TRIGGER delivery_zones_updated_at
  BEFORE UPDATE ON public.delivery_zones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER delivery_accessorials_updated_at
  BEFORE UPDATE ON public.delivery_accessorials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER fabric_protection_rates_updated_at
  BEFORE UPDATE ON public.fabric_protection_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 7. Enable RLS ────────────────────────────────────────────

ALTER TABLE public.delivery_zones            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_accessorials     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fabric_protection_rates   ENABLE ROW LEVEL SECURITY;


-- ── 8. RLS Policies ──────────────────────────────────────────
-- Public reference data — any authenticated user may read.
-- Admin may INSERT/UPDATE (for future Settings → Delivery Rates editor).
-- service_role always full access.

-- delivery_zones
DROP POLICY IF EXISTS "delivery_zones_select_all" ON public.delivery_zones;
CREATE POLICY "delivery_zones_select_all" ON public.delivery_zones
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "delivery_zones_admin_write" ON public.delivery_zones;
CREATE POLICY "delivery_zones_admin_write" ON public.delivery_zones
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

DROP POLICY IF EXISTS "delivery_zones_service_all" ON public.delivery_zones;
CREATE POLICY "delivery_zones_service_all" ON public.delivery_zones
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- delivery_accessorials
DROP POLICY IF EXISTS "delivery_accessorials_select_all" ON public.delivery_accessorials;
CREATE POLICY "delivery_accessorials_select_all" ON public.delivery_accessorials
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "delivery_accessorials_admin_write" ON public.delivery_accessorials;
CREATE POLICY "delivery_accessorials_admin_write" ON public.delivery_accessorials
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

DROP POLICY IF EXISTS "delivery_accessorials_service_all" ON public.delivery_accessorials;
CREATE POLICY "delivery_accessorials_service_all" ON public.delivery_accessorials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- fabric_protection_rates
DROP POLICY IF EXISTS "fabric_protection_rates_select_all" ON public.fabric_protection_rates;
CREATE POLICY "fabric_protection_rates_select_all" ON public.fabric_protection_rates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "fabric_protection_rates_admin_write" ON public.fabric_protection_rates;
CREATE POLICY "fabric_protection_rates_admin_write" ON public.fabric_protection_rates
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

DROP POLICY IF EXISTS "fabric_protection_rates_service_all" ON public.fabric_protection_rates;
CREATE POLICY "fabric_protection_rates_service_all" ON public.fabric_protection_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── 9. Seed: delivery_accessorials ───────────────────────────

INSERT INTO public.delivery_accessorials (code, name, rate, rate_unit, description, display_order) VALUES
  ('EXTRA_ITEM',   'Extra Item (beyond 3 included)', 25,    'per_item',  'Per additional item beyond the 3 included in base rate', 1),
  ('SLEEPER_SOFA', 'Sleeper Sofa Fee',               125,   'plus_base', 'Added for sleeper sofas weighing over 275 lbs (added on top of base delivery rate)', 2),
  ('PRIORITY',     'Priority Reservation',           125,   'flat',      'Select your own 2-hour arrival time window between 9:30AM - 6:00PM', 3),
  ('DETENTION',    'Detention Time',                 62.50, 'per_15min', 'Delays outside Stride control (elevator delays, site not ready, customer running late, etc.)', 4),
  ('OUT_OF_AREA',  'Out of Area Delivery',           4,     'per_mile',  'Deliveries not covered by our flat rate schedule. Per mile round trip.', 5),
  ('DRIVE_OUT',    'Drive Out Fee',                  NULL,  'flat',      'Local travel fee with no delivery of product. Rates vary based on ZIP code — call for quote.', 6)
ON CONFLICT (code) DO NOTHING;


-- ── 10. Seed: fabric_protection_rates ────────────────────────

INSERT INTO public.fabric_protection_rates (item_type, rate, rate_unit, min_charge, display_order) VALUES
  ('Sectional per pc',             199,  'each',     149, 1),
  ('Sofa',                         199,  'flat',     149, 2),
  ('Loveseat',                     179,  'flat',     149, 3),
  ('Throw Pillows / Cushions',     20,   'each',     149, 4),
  ('Chair',                        169,  'flat',     149, 5),
  ('Ottoman / Bench',              159,  'flat',     149, 6),
  ('Dining Chair',                 139,  'each',     149, 7),
  ('Headboard',                    199,  'flat',     149, 8),
  ('Bed Frame',                    149,  'flat',     149, 9),
  ('Wall to Wall Carpet',          2.99, 'per_sqft', 149, 10),
  ('Area Rug',                     2.99, 'per_sqft', 149, 11)
ON CONFLICT (item_type) DO NOTHING;


-- ── Done ──────────────────────────────────────────────────────
-- Next: seed delivery_zones with ~399 rows from PLT_PRICE_LISTS_v2
-- via a separate data migration (executed via MCP after this DDL
-- migration is applied).
