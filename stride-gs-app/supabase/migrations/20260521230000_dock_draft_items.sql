-- 2026-05-21 — dock_draft_items table for the unified receiving flow
--
-- Why: the original 2-stage receiving workflow split dock intake (Stage 1)
-- from item entry (Stage 2) into two screens. Operators asked to merge
-- them into one continuous flow with a "Save for Later" button that
-- persists whatever items have been entered so far alongside the dock
-- metadata, so they can step away and come back without losing work. We
-- already persist the dock-level fields on the `shipments` row
-- (inbound_status='in_progress' + dock_*); the items themselves had no
-- persistence story until this table.
--
-- Lifecycle: a row in `dock_draft_items` is keyed by (tenant_id,
-- dock_shipment_number) and lives only while the parent shipment row has
-- inbound_status='in_progress'. On Complete Receiving, the existing GAS
-- `completeShipment` flow promotes these into real `inventory` rows; the
-- reconcile step (already in Receiving.tsx) then deletes the drafts.
-- Save for Later overwrites the draft set (DELETE + bulk INSERT) so the
-- UI grid always has a clean round-trip — order is preserved by
-- `display_order`.
--
-- Storage notes:
--   - `addons`, `auto_applied_addons`, `dismissed_addons` are JSONB string
--     arrays so the existing add-on rule machinery in Receiving.tsx
--     round-trips intact. If we ever change the catalog code shape, the
--     drafts table doesn't need a migration.
--   - `weight` is numeric (lbs) — null when not entered.
--   - `expanded` (UI bookkeeping for the add-ons accordion) is intentionally
--     NOT persisted — re-opens default to collapsed, which is the right
--     mobile/dock-floor default anyway.

CREATE TABLE IF NOT EXISTS public.dock_draft_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL,
  dock_shipment_number  text NOT NULL,
  display_order         integer NOT NULL DEFAULT 0,
  -- Item fields (mirror DockItem in Receiving.tsx)
  item_id               text,
  vendor                text,
  description           text,
  item_class            text,
  qty                   integer NOT NULL DEFAULT 1,
  location              text,
  sidemark              text,
  reference             text,
  room                  text,
  needs_inspection      boolean NOT NULL DEFAULT false,
  needs_assembly        boolean NOT NULL DEFAULT false,
  item_notes            text,
  weight                numeric,
  addons                jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_applied_addons   jsonb NOT NULL DEFAULT '[]'::jsonb,
  dismissed_addons      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dock_draft_items_lookup
  ON public.dock_draft_items (tenant_id, dock_shipment_number, display_order);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Mirror the shipments_*_staff pattern: admin/staff can do anything;
-- service_role bypasses (covers Edge Functions / backfill scripts);
-- client role gets no access (they don't run receiving).

ALTER TABLE public.dock_draft_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY dock_draft_items_service_all ON public.dock_draft_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY dock_draft_items_select_staff ON public.dock_draft_items
  FOR SELECT TO authenticated USING (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  );

CREATE POLICY dock_draft_items_insert_staff ON public.dock_draft_items
  FOR INSERT TO authenticated WITH CHECK (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  );

CREATE POLICY dock_draft_items_update_staff ON public.dock_draft_items
  FOR UPDATE TO authenticated
  USING (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  )
  WITH CHECK (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  );

CREATE POLICY dock_draft_items_delete_staff ON public.dock_draft_items
  FOR DELETE TO authenticated USING (
    (((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY (ARRAY['admin'::text, 'staff'::text]))
  );

-- Table-level grants required alongside RLS per the 2026-10-30 PostgREST
-- behavior change. RLS picks the rows; grants decide which verbs the role
-- can attempt at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_draft_items TO authenticated;
GRANT ALL ON public.dock_draft_items TO service_role;

COMMENT ON TABLE public.dock_draft_items IS
  'Per-shipment draft item rows captured during the "Save for Later" path of the unified receiving flow. Cleaned up when the parent shipments row transitions inbound_status to received (see Receiving.tsx Stage 2 reconcile).';
COMMENT ON COLUMN public.dock_draft_items.display_order IS
  'Row order in the receiving grid. The UI replaces the entire set on save (DELETE + bulk INSERT) so a strictly-increasing integer per save is sufficient.';
