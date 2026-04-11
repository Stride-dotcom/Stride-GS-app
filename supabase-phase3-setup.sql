-- ============================================================
-- Stride GS App — Supabase Phase 3 Setup (Read Cache / Full Mirror)
-- Run this entire script in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/uqplppugeickmamycpuz/editor
-- ============================================================

-- ── 1. Create inventory table ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inventory (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         text          NOT NULL,
  item_id           text          NOT NULL,
  description       text,
  vendor            text,
  sidemark          text,
  room              text,
  item_class        text,
  qty               integer       DEFAULT 1,
  location          text,
  status            text,
  receive_date      text,
  release_date      text,
  shipment_number   text,
  carrier           text,
  tracking_number   text,
  item_notes        text,
  reference         text,
  task_notes        text,
  item_folder_url   text,
  created_at        timestamptz   DEFAULT now(),
  updated_at        timestamptz   DEFAULT now(),
  UNIQUE(tenant_id, item_id)
);

-- ── 2. Create tasks table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tasks (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         text          NOT NULL,
  task_id           text          NOT NULL,
  item_id           text,
  type              text,
  status            text,
  result            text,
  description       text,
  task_notes        text,
  item_notes        text,
  custom_price      numeric,
  created           text,
  completed_at      text,
  assigned_to       text,
  location          text,
  task_folder_url   text,
  shipment_folder_url text,
  created_at        timestamptz   DEFAULT now(),
  updated_at        timestamptz   DEFAULT now(),
  UNIQUE(tenant_id, task_id)
);

-- ── 3. Create repairs table ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.repairs (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         text          NOT NULL,
  repair_id         text          NOT NULL,
  item_id           text,
  status            text,
  repair_result     text,
  quote_amount      numeric,
  final_amount      numeric,
  repair_vendor     text,
  repair_notes      text,
  task_notes        text,
  item_notes        text,
  completed_date    text,
  repair_folder_url text,
  shipment_folder_url text,
  task_folder_url   text,
  created_at        timestamptz   DEFAULT now(),
  updated_at        timestamptz   DEFAULT now(),
  UNIQUE(tenant_id, repair_id)
);

-- ── 4. Create will_calls table ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.will_calls (
  id                    uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             text          NOT NULL,
  wc_number             text          NOT NULL,
  status                text,
  carrier               text,
  pickup_party          text,
  estimated_pickup_date text,
  notes                 text,
  item_count            integer,
  wc_folder_url         text,
  shipment_folder_url   text,
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now(),
  UNIQUE(tenant_id, wc_number)
);

-- ── 5. Create shipments table ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shipments (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         text          NOT NULL,
  shipment_number   text          NOT NULL,
  receive_date      text,
  item_count        integer,
  carrier           text,
  tracking_number   text,
  notes             text,
  folder_url        text,
  created_at        timestamptz   DEFAULT now(),
  updated_at        timestamptz   DEFAULT now(),
  UNIQUE(tenant_id, shipment_number)
);

-- ── 6. Create billing table ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.billing (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         text          NOT NULL,
  ledger_row_id     text          NOT NULL,
  status            text,
  invoice_no        text,
  client_name       text,
  date              text,
  svc_code          text,
  svc_name          text,
  category          text,
  item_id           text,
  description       text,
  item_class        text,
  qty               numeric,
  rate              numeric,
  total             numeric,
  task_id           text,
  repair_id         text,
  shipment_number   text,
  item_notes        text,
  invoice_date      text,
  invoice_url       text,
  created_at        timestamptz   DEFAULT now(),
  updated_at        timestamptz   DEFAULT now(),
  UNIQUE(tenant_id, ledger_row_id)
);

-- ── 7. Indexes ───────────────────────────────────────────────

-- tenant_id indexes (every table)
CREATE INDEX IF NOT EXISTS idx_inventory_tenant    ON public.inventory (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant        ON public.tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_repairs_tenant      ON public.repairs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_will_calls_tenant   ON public.will_calls (tenant_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tenant    ON public.shipments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_tenant      ON public.billing (tenant_id);

-- item_id indexes (for cross-entity lookups)
CREATE INDEX IF NOT EXISTS idx_inventory_item_id   ON public.inventory (item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_item_id       ON public.tasks (item_id);
CREATE INDEX IF NOT EXISTS idx_repairs_item_id     ON public.repairs (item_id);

-- status indexes (for filtered queries)
CREATE INDEX IF NOT EXISTS idx_inventory_status    ON public.inventory (status);
CREATE INDEX IF NOT EXISTS idx_tasks_status        ON public.tasks (status);
CREATE INDEX IF NOT EXISTS idx_repairs_status      ON public.repairs (status);
CREATE INDEX IF NOT EXISTS idx_will_calls_status   ON public.will_calls (status);
CREATE INDEX IF NOT EXISTS idx_billing_status      ON public.billing (status);

-- ── 8. Updated_at triggers ───────────────────────────────────
-- (Reuses set_updated_at() function created in Phase 1)

CREATE OR REPLACE TRIGGER inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER repairs_updated_at
  BEFORE UPDATE ON public.repairs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER will_calls_updated_at
  BEFORE UPDATE ON public.will_calls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER shipments_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER billing_updated_at
  BEFORE UPDATE ON public.billing
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 9. Enable Row-Level Security ─────────────────────────────

ALTER TABLE public.inventory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repairs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.will_calls  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing     ENABLE ROW LEVEL SECURITY;

-- ── 10. RLS Policies ─────────────────────────────────────────
-- Pattern: staff/admin see all, client users see only their tenant_id
-- Service role (GAS write-through) bypasses RLS automatically

-- Helper: get the user's clientSheetId from user_metadata
-- (set during Supabase Auth signup: user_metadata.clientSheetId)

-- INVENTORY
CREATE POLICY "inventory_select_staff" ON public.inventory
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "inventory_select_client" ON public.inventory
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

CREATE POLICY "inventory_service_all" ON public.inventory
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- TASKS
CREATE POLICY "tasks_select_staff" ON public.tasks
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "tasks_select_client" ON public.tasks
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

CREATE POLICY "tasks_service_all" ON public.tasks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- REPAIRS
CREATE POLICY "repairs_select_staff" ON public.repairs
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "repairs_select_client" ON public.repairs
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

CREATE POLICY "repairs_service_all" ON public.repairs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- WILL_CALLS
CREATE POLICY "will_calls_select_staff" ON public.will_calls
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "will_calls_select_client" ON public.will_calls
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

CREATE POLICY "will_calls_service_all" ON public.will_calls
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- SHIPMENTS
CREATE POLICY "shipments_select_staff" ON public.shipments
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "shipments_select_client" ON public.shipments
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

CREATE POLICY "shipments_service_all" ON public.shipments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- BILLING
CREATE POLICY "billing_select_staff" ON public.billing
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "billing_select_client" ON public.billing
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

CREATE POLICY "billing_service_all" ON public.billing
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 11. Realtime: enable for all tables ──────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.repairs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.will_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shipments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing;

-- ── Done ─────────────────────────────────────────────────────
-- After running this script:
-- 1. Verify all 6 tables appear in Table Editor with RLS shield icon
-- 2. Run handleBulkSyncToSupabase_ from StrideAPI to populate initial data
-- 3. Test: SELECT count(*) FROM inventory; (should be 0 until bulk sync)
