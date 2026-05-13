-- Multi-item repair support
-- ==========================
-- Adds the repair_items join table so one repair can carry multiple
-- inventory items, mirroring the will_calls / will_call_items pattern.
-- Repair pricing stays at the parent level (quote_amount, quote_lines_json
-- etc on repairs are unchanged) — per-item rows here are for membership
-- + optional per-item pass/fail tracking, not billing.
--
-- Supabase-authoritative: future creation paths write to public.repairs +
-- public.repair_items via React/edge functions first, then mirror back to
-- the per-tenant Repairs sheet via the reverse-writethrough framework.
-- The existing GAS-authoritative single-item path keeps working untouched
-- since every existing repair has exactly one row in this new table after
-- the backfill below.

CREATE TABLE IF NOT EXISTS public.repair_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  repair_id    text NOT NULL,
  item_id      text NOT NULL,
  qty          numeric NOT NULL DEFAULT 1,
  item_result  text,
  item_notes   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, repair_id, item_id)
);

COMMENT ON TABLE public.repair_items IS
  'Join table — items belonging to a repair. One repair can have N items '
  '(like will_calls/will_call_items). Pricing stays at the parent level '
  '(repairs.quote_amount, quote_lines_json) — per-row item_result is '
  'informational only and does not affect billing.';

COMMENT ON COLUMN public.repair_items.item_result IS
  'Per-item pass/fail outcome — informational, does not affect billing or '
  'parent repair status. NULL = not yet resolved.';

CREATE INDEX IF NOT EXISTS idx_repair_items_repair_id
  ON public.repair_items (tenant_id, repair_id);

CREATE INDEX IF NOT EXISTS idx_repair_items_item_id
  ON public.repair_items (tenant_id, item_id);

-- ── RLS — mirror the parent repairs table ─────────────────────────────
-- service_role bypasses (used by edge functions + GAS REST writes).
-- staff/admin SELECT for visibility everywhere.
-- client SELECT scoped to their tenant via the shared helper.
-- No client INSERT/UPDATE/DELETE — those go through edge functions
-- (service_role) so atomicity with the parent repairs row is enforced
-- at the function level.
ALTER TABLE public.repair_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY repair_items_select_client
  ON public.repair_items
  FOR SELECT
  USING (user_has_tenant_access(tenant_id));

CREATE POLICY repair_items_select_staff
  ON public.repair_items
  FOR SELECT
  USING (
    ((auth.jwt() -> 'user_metadata'::text) ->> 'role'::text) = ANY
    (ARRAY['admin'::text, 'staff'::text])
  );

CREATE POLICY repair_items_service_all
  ON public.repair_items
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Realtime — same pattern as repairs / will_calls so the UI gets live
-- updates when items are added/removed/marked passed-failed.
ALTER PUBLICATION supabase_realtime ADD TABLE public.repair_items;

-- ── Backfill from existing single-item repairs ────────────────────────
-- Every existing repair (33 rows at migration time) has a non-null
-- item_id. Insert one repair_items row per repair so every repair
-- — old or new — has a uniform shape from this point forward. The
-- ON CONFLICT clause makes re-running this idempotent.
INSERT INTO public.repair_items (tenant_id, repair_id, item_id, qty, created_at, updated_at)
SELECT
  r.tenant_id,
  r.repair_id,
  r.item_id,
  1,
  COALESCE(r.created_at, now()),
  COALESCE(r.updated_at, now())
FROM public.repairs r
WHERE r.item_id IS NOT NULL AND r.item_id <> ''
ON CONFLICT (tenant_id, repair_id, item_id) DO NOTHING;
