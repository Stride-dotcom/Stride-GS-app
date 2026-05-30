-- 20260529120000_dt_pickup_links_phase1.sql
--
-- Multi-pickup → single-delivery Phase 1 schema.
--
-- Spec: DESIGN_multi_pickup.md (PR #576). Phase 1 ships:
--   1. dt_pickup_links join table to support N pickups per delivery
--      (today: scalar dt_orders.linked_order_id, max 1 pickup)
--   2. Per-leg notes split: dt_orders.pickup_notes (push to pickup leg)
--      and dt_orders.delivery_notes (push to delivery leg). Today a
--      single driver_notes pushes to both legs.
--   3. dt_pickup_links.pickup_completion_notes — driver-entered notes
--      captured from DT after the pickup finishes, relayed to the
--      delivery crew as a visible warning ("rug arrived wet", "missing
--      hardware", etc.).
--
-- Behaviour-neutral on existing single-pickup orders: the scalar
-- linked_order_id remains the primary pointer; the join table is
-- populated by backfill + dual-write so legacy callers keep working.
-- Per design spec §4.2 the existing column stays in place through
-- Phase 1 and is retired in a later phase.

-- ── 1. dt_pickup_links join table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dt_pickup_links (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Project pattern: tenant_id is text (= Google Sheets clientSheetId)
  -- and required for the client-RLS policy below. Mirrors dt_orders.
  tenant_id               text        NOT NULL,
  delivery_order_id       uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  pickup_order_id         uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  -- Free-text display label, defaulted from pickup contact name at
  -- create. Operator-editable from OrderPage ("Sarah's house").
  pickup_label            text,
  -- Per-leg operator/driver crosstalk. Surfaced on the delivery's
  -- OrderPage under each linked-pickup row. Distinct from the per-
  -- order pickup_notes column (which is the pickup leg's own driver-
  -- facing notes pushed to DT) — this is leg-routing context the
  -- delivery team should see ("elevator broken, take stairs").
  pickup_notes            text,
  -- Driver-entered notes captured AFTER the pickup completes (from
  -- DT export.xml driver notes). Relayed to the delivery's OrderPage
  -- as a warning section so the delivery crew sees pickup-leg surprises
  -- before they roll out ("rug arrived wet", "missing hardware").
  pickup_completion_notes text,
  -- 0-based ordering for display. The pickup identifier suffix is
  -- driven from this (sort_order=0 → "-P", 1 → "-P2", 2 → "-P3"…)
  -- per Justin's "don't rename the original -P" decision (spec §5).
  sort_order              int         NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dt_pickup_links_unique_pair   UNIQUE (delivery_order_id, pickup_order_id),
  -- A pickup belongs to exactly one delivery (no multi-tenant pickup
  -- sharing). Enforces the 1-pickup-to-N-delivery direction stays
  -- forbidden. Aligns with design spec §4.1.
  CONSTRAINT dt_pickup_links_unique_pickup UNIQUE (pickup_order_id)
);

CREATE INDEX IF NOT EXISTS idx_dt_pickup_links_delivery
  ON public.dt_pickup_links (delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_dt_pickup_links_pickup
  ON public.dt_pickup_links (pickup_order_id);

-- updated_at trigger so OrderPage edits stamp the row
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_dt_pickup_links ON public.dt_pickup_links;
CREATE TRIGGER set_updated_at_dt_pickup_links
  BEFORE UPDATE ON public.dt_pickup_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. RLS — mirror dt_orders policy shape exactly ────────────────────
ALTER TABLE public.dt_pickup_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dt_pickup_links_select_staff" ON public.dt_pickup_links;
CREATE POLICY "dt_pickup_links_select_staff" ON public.dt_pickup_links
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

DROP POLICY IF EXISTS "dt_pickup_links_select_client" ON public.dt_pickup_links;
CREATE POLICY "dt_pickup_links_select_client" ON public.dt_pickup_links
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

DROP POLICY IF EXISTS "dt_pickup_links_service_all" ON public.dt_pickup_links;
CREATE POLICY "dt_pickup_links_service_all" ON public.dt_pickup_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Split notes on dt_orders ───────────────────────────────────────
-- pickup_notes:   pushed as the DT Public <note> on the pickup leg
-- delivery_notes: pushed as the DT Public <note> on the delivery leg
--
-- Both nullable; dt-push-order falls back to the legacy driver_notes/
-- order_notes/details columns when the per-leg column is NULL so
-- existing rows behave identically to today. Once dual-write is in
-- the modal + OrderPage, new orders populate the per-leg columns
-- directly and the fallback is purely a back-compat path.
ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS pickup_notes   text,
  ADD COLUMN IF NOT EXISTS delivery_notes text;

COMMENT ON COLUMN public.dt_orders.pickup_notes IS
  'Driver-facing notes for the pickup leg, pushed as a Public DT note '
  'when this row is the pickup of a P+D pair. Falls back to driver_notes '
  'on push if NULL for back-compat with rows created pre-split.';

COMMENT ON COLUMN public.dt_orders.delivery_notes IS
  'Driver-facing notes for the delivery leg, pushed as a Public DT note '
  'when this row is the delivery of a P+D pair (or a standalone delivery). '
  'Falls back to driver_notes on push if NULL for back-compat.';

-- ── 4. Backfill existing P+D pairs into the join table ────────────────
-- Every delivery row that has linked_order_id pointing at a pickup gets
-- one dt_pickup_links row with sort_order=0 (= the original "-P" leg).
-- Idempotent: ON CONFLICT on the pair unique constraint.
INSERT INTO public.dt_pickup_links (
  tenant_id, delivery_order_id, pickup_order_id,
  pickup_label, sort_order
)
SELECT
  d.tenant_id,
  d.id                                AS delivery_order_id,
  d.linked_order_id                   AS pickup_order_id,
  p.contact_name                      AS pickup_label, -- default = pickup contact name
  0                                   AS sort_order
FROM public.dt_orders d
JOIN public.dt_orders p ON p.id = d.linked_order_id
WHERE d.order_type = 'pickup_and_delivery'
  AND d.linked_order_id IS NOT NULL
  AND p.order_type = 'pickup'
  AND d.tenant_id IS NOT NULL
ON CONFLICT (delivery_order_id, pickup_order_id) DO NOTHING;

-- ── 5. Verify no orphan/dangling tenant rows in the backfill ──────────
-- (Diagnostic — surfaces in psql output if anything misaligned. Will
--  be zero on a healthy backfill; non-zero would mean a dangling
--  linked_order_id pointer in dt_orders that we'd want to investigate
--  before flipping the OrderPage UI to read from the join table.)
DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT COUNT(*) INTO v_orphans
  FROM public.dt_orders d
  WHERE d.order_type = 'pickup_and_delivery'
    AND d.linked_order_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.dt_pickup_links l
      WHERE l.delivery_order_id = d.id
        AND l.pickup_order_id   = d.linked_order_id
    );
  IF v_orphans > 0 THEN
    RAISE NOTICE 'dt_pickup_links backfill: % delivery rows did not produce a join row (likely missing pickup row or null tenant_id). Phase 1 ships defensively (UI falls back to linked_order_id when no join row present).', v_orphans;
  END IF;
END
$$;
