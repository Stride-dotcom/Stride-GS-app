-- Polymorphic addons table — generalizes the task-shaped public.task_addons
-- into a single table that any entity (task, repair, will call, inventory)
-- can attach billable add-on services to.
--
-- Why: the task_addons table shipped 2026-05-02 was scoped to tasks, but
-- the same flow is wanted on repairs, will calls, and item detail pages.
-- Rather than copy-paste the schema + hook + materializer 3 more times,
-- we key on (parent_type, parent_id) and reuse one path everywhere.
--
-- Key shape decisions:
--
--   - parent_type is constrained to a known set so a stray INSERT with
--     a typo'd parent_type fails loud (matches the entity-id CHECK
--     constraint pattern from PR #229).
--
--   - parent_id is NOT NULL + non-empty (same reasoning).
--
--   - service_code, service_name, rate, item_class are SNAPSHOTTED at
--     add time. If the price list later changes, already-added addons
--     keep their original rate (parity with how billing rows snapshot
--     rate at write time).
--
--   - billed flag flips when the entity's GAS completion handler
--     materializes the addon to Billing_Ledger via
--     api_writeAddonsToLedger_. ledger_row_id captures the resulting
--     Ledger Row ID for traceback.
--
-- public.task_addons is empty in production (verified via execute_sql
-- before this migration). Dropping is safe.
--
-- RLS: staff + admin full access. Service role full access (StrideAPI
-- materializer). Clients have no access — addons are back-of-house.

DROP TABLE IF EXISTS public.task_addons;

CREATE TABLE IF NOT EXISTS public.addons (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  parent_type   text        NOT NULL CHECK (parent_type IN ('task','repair','will_call','inventory')),
  parent_id     text        NOT NULL CHECK (parent_id <> ''),
  service_code  text        NOT NULL,
  service_name  text        NOT NULL DEFAULT '',
  quantity      numeric     NOT NULL DEFAULT 1,
  rate          numeric,
  item_class    text,
  total         numeric,
  added_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  added_by_name text        NOT NULL DEFAULT '',
  billed        boolean     NOT NULL DEFAULT false,
  billed_at     timestamptz,
  ledger_row_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.addons
  IS 'Polymorphic billable add-on services attached to an entity (task / repair / will_call / inventory). Materialized to Billing_Ledger by api_writeAddonsToLedger_ on entity completion. Replaces public.task_addons.';

CREATE INDEX IF NOT EXISTS idx_addons_parent
  ON public.addons (tenant_id, parent_type, parent_id);

CREATE INDEX IF NOT EXISTS idx_addons_unbilled
  ON public.addons (tenant_id, parent_type, parent_id)
  WHERE billed = false;

CREATE INDEX IF NOT EXISTS idx_addons_created
  ON public.addons (created_at DESC);

ALTER TABLE public.addons REPLICA IDENTITY FULL;
ALTER TABLE public.addons ENABLE ROW LEVEL SECURITY;

-- Staff + admin full access (read/write/delete).
DROP POLICY IF EXISTS addons_staff ON public.addons;
CREATE POLICY addons_staff ON public.addons
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

-- Service role (StrideAPI completion materializer) full access.
DROP POLICY IF EXISTS addons_service ON public.addons;
CREATE POLICY addons_service ON public.addons
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.addons TO authenticated, service_role;

-- Realtime so the addons list updates live across tabs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'addons'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.addons';
  END IF;
END $$;
