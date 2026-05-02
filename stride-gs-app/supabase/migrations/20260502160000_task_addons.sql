-- Session 91 — `task_addons` table for billable add-on services attached
-- to a task. Staff/admin can add extras (crate disposal, extra items,
-- etc.) to an open task; rows accumulate on this table until the task is
-- completed, at which point handleCompleteTask_ flushes them as
-- additional billing ledger rows alongside the primary service charge.
--
-- Key shape decisions:
--
--   - service_code + service_name + rate are SNAPSHOTTED at the time
--     the addon is added. If the price list later changes, already-added
--     addons keep their original rate (parity with how billing rows
--     snapshot rate at write time).
--
--   - item_class is captured for class-based services so the GAS flush
--     uses the same class for the billing row even if the inventory row
--     later changes class.
--
--   - total = quantity * rate, stored so the UI can show a running
--     total without re-running the math.
--
-- RLS: staff + admin full access. Clients have no access — addons are
-- a back-of-house billing concern, not customer-visible. Service role
-- (StrideAPI) full access for the completion flush.

CREATE TABLE IF NOT EXISTS public.task_addons (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL,
  task_id       text        NOT NULL,
  service_code  text        NOT NULL,
  service_name  text        NOT NULL,
  quantity      numeric     NOT NULL DEFAULT 1,
  rate          numeric,
  item_class    text,
  total         numeric,
  added_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  added_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.task_addons
  IS 'Session 91: extra billable services staff attach to a task. Flushed to Billing_Ledger by handleCompleteTask_ on completion.';

CREATE INDEX IF NOT EXISTS idx_task_addons_task    ON public.task_addons (tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_addons_created ON public.task_addons (created_at DESC);

ALTER TABLE public.task_addons REPLICA IDENTITY FULL;
ALTER TABLE public.task_addons ENABLE ROW LEVEL SECURITY;

-- Staff + admin full access (read/write/delete).
DROP POLICY IF EXISTS task_addons_staff ON public.task_addons;
CREATE POLICY task_addons_staff ON public.task_addons
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

-- Service role (StrideAPI completion flush) full access.
DROP POLICY IF EXISTS task_addons_service ON public.task_addons;
CREATE POLICY task_addons_service ON public.task_addons
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Realtime so the addons list updates live across tabs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'task_addons'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.task_addons';
  END IF;
END $$;
