-- Session 65 — Clients read-cache mirror table.
--
-- Motivation: `handleGetClients_` in StrideAPI.gs has no server-side cache and
-- reads the full CB Clients sheet on every call. Cold-start GAS + full sheet
-- read was causing 120-240s dropdown load times after login (known landmine
-- from session 64). This table is the 7th mirror (joins inventory, tasks,
-- repairs, will_calls, shipments, billing). StrideAPI.gs writes through via
-- `sbClientRow_` + `resyncEntityToSupabase_("clients", ...)` on every
-- client-modifying write. React reads via `fetchClientsFromSupabase` (~50ms)
-- with GAS fallback for degraded-mode resilience.
--
-- Per CLAUDE.md decision #20: Supabase is a read cache, not authority. GAS
-- writes are authority; Supabase mirrors via best-effort write-through. A
-- Supabase fetch that returns [] is treated as cache-miss, not "no clients."

CREATE TABLE IF NOT EXISTS public.clients (
  id                        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                 text        NOT NULL,  -- same as spreadsheet_id; each client is its own tenant
  name                      text        NOT NULL,
  spreadsheet_id            text        NOT NULL UNIQUE,
  email                     text,
  contact_name              text,
  phone                     text,
  folder_id                 text,
  photos_folder_id          text,
  invoice_folder_id         text,
  free_storage_days         int         DEFAULT 0,
  discount_storage_pct      numeric     DEFAULT 0,
  discount_services_pct     numeric     DEFAULT 0,
  payment_terms             text        DEFAULT 'NET 30',
  enable_receiving_billing  boolean     DEFAULT false,
  enable_shipment_email     boolean     DEFAULT false,
  enable_notifications      boolean     DEFAULT false,
  auto_inspection           boolean     DEFAULT false,
  separate_by_sidemark      boolean     DEFAULT false,
  auto_charge               boolean     DEFAULT false,
  web_app_url               text,
  qb_customer_name          text,
  stax_customer_id          text,
  parent_client             text,
  notes                     text,
  shipment_note             text,
  active                    boolean     DEFAULT true,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_tenant_id     ON public.clients (tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_spreadsheet_id ON public.clients (spreadsheet_id);
CREATE INDEX IF NOT EXISTS idx_clients_active        ON public.clients (active) WHERE active = true;

-- Realtime: replica identity full so Supabase Realtime sends the row on updates.
-- Matches the 6 other mirror tables (session 48 Phase 4).
ALTER TABLE public.clients REPLICA IDENTITY FULL;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Staff + admin see every client row. Role is synced into user_metadata during
-- AuthContext.handleSession (session 60).
DROP POLICY IF EXISTS "clients_select_staff" ON public.clients;
CREATE POLICY "clients_select_staff" ON public.clients
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Client-tier users see only their own tenant. Parent users (one-level
-- hierarchy, decision #17) with children may see only their primary
-- clientSheetId here; the GAS fallback backfills the rest when needed.
DROP POLICY IF EXISTS "clients_select_own" ON public.clients;
CREATE POLICY "clients_select_own" ON public.clients
  FOR SELECT TO authenticated
  USING (spreadsheet_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

-- Service role (StrideAPI.gs) bypasses RLS for writes.
DROP POLICY IF EXISTS "clients_service_all" ON public.clients;
CREATE POLICY "clients_service_all" ON public.clients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.clients IS 'Session 65: read-cache mirror of CB Clients sheet. StrideAPI.gs is authoritative; Supabase mirrors via write-through in handleUpdateClient_, handleOnboardClient_, handleFinishClientSetup_. React uses fetchClientsFromSupabase (fast path, ~50ms) with GAS fallback.';
