-- 2026-05-09 — GAS→Supabase migration parity substrate (P1.1).
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md, decisions
--   MIG-006 (entity_audit_log + gas_call_log is the answer key) and
--   MIG-007 (three-layer verification: per-call diff + 90d replay + canary).
--
-- Adds the four pieces the parity framework needs to start operating:
--   1. public.feature_flags  — per-function backend selector with optional
--      per-tenant scope; consulted by both React app and SB Edge Functions.
--   2. public.parity_results — per-call match record between the active
--      backend (GAS) and the shadow backend (SB), output of the replay
--      harness shipping in P1.7.
--   3. public.gas_call_log   — raw input payload for every doPost_ call
--      into StrideAPI, redacted, hash + correlation_id stamped. Together
--      with entity_audit_log (already populated, gets a new correlation_id
--      column below) this is the historical-replay corpus.
--   4. public.entity_audit_log.correlation_id — links each state change
--      back to the gas_call_log row that produced it.
--
-- Plus seed feature_flags rows for every function in the migration
-- inventory at active_backend='gas' (today's reality). Future PRs flip
-- shadow_backend / parity_enabled / active_backend per the per-function
-- state machine in MIGRATION_STATUS.md.
--
-- This migration is non-disruptive: no existing handler reads or writes
-- these tables yet. The schema simply has to exist before P1.2 (GAS-side
-- input capture) and P1.7 (replay harness) can land.

-- ------------------------------------------------------------------
-- 1. feature_flags
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feature_flags (
  function_key       text PRIMARY KEY,
  active_backend     text NOT NULL DEFAULT 'gas'
                       CHECK (active_backend IN ('gas', 'supabase')),
  shadow_backend     text
                       CHECK (shadow_backend IS NULL
                              OR shadow_backend IN ('gas', 'supabase')),
  parity_enabled     boolean NOT NULL DEFAULT false,
  tenant_scope       text[],     -- NULL = fleet-wide; non-null = only listed tenant_ids
  last_parity_check  timestamptz,
  mismatch_count_7d  integer NOT NULL DEFAULT 0,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_flags_active_backend_idx
  ON public.feature_flags (active_backend);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- Authenticated users can READ all flags (the React app needs to resolve
-- routing decisions client-side). Only admin can write.
DROP POLICY IF EXISTS feature_flags_read_authenticated ON public.feature_flags;
CREATE POLICY feature_flags_read_authenticated ON public.feature_flags
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

DROP POLICY IF EXISTS feature_flags_write_admin ON public.feature_flags;
CREATE POLICY feature_flags_write_admin ON public.feature_flags
  FOR ALL
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'admin'
    OR auth.role() = 'service_role'
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.feature_flags_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feature_flags_touch_updated_at ON public.feature_flags;
CREATE TRIGGER feature_flags_touch_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.feature_flags_touch_updated_at();

-- Realtime so the Settings → Migration tab can reflect operator flips
-- across browser sessions instantly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'feature_flags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_flags;
  END IF;
END
$$;

-- Seed every function in the migration inventory at gas-primary.
-- Source: stride-gs-app/MIGRATION_STATUS.md "Per-function migration table".
-- Future PRs UPDATE individual rows as functions move through the state
-- machine; never insert duplicates.
INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES
  ('updateItem',          'gas', false, 'P2 — simple write. Field-level inventory edits.'),
  ('updateTask',          'gas', false, 'P2 — simple write. Notes / priority / due / assigned.'),
  ('updateRepair',        'gas', false, 'P2 — simple write. Notes / scheduled date.'),
  ('updateShipment',      'gas', false, 'P2 — simple write. Carrier / tracking / notes.'),
  ('startTask',           'gas', false, 'P3 — status only.'),
  ('startRepair',         'gas', false, 'P3 — status only.'),
  ('createTask',          'gas', false, 'P3 — batch task creation.'),
  ('createWillCall',      'gas', false, 'P3 — creates WC + WC_Items + email.'),
  ('releaseItems',        'gas', false, 'P3 — bulk Released-state flip on inventory rows.'),
  ('completeTask',        'gas', false, 'P4a — atomic with billing + addons + email (MIG-004).'),
  ('completeRepair',      'gas', false, 'P4a — atomic with billing + email (MIG-004).'),
  ('processWcRelease',    'gas', false, 'P4a — atomic with billing + addons + email (MIG-004).'),
  ('commitStorageCharges','gas', false, 'P4a — writes Billing_Ledger from calculate_storage_charges RPC output.'),
  ('createInvoice',       'gas', false, 'P4a — per-tenant + SB mirror + invoice_tracking. CB writethrough still fires (P4b retires CB).'),
  ('voidInvoice',         'gas', false, 'P4a — three-layer void; CB symmetry from v38.193 must survive (MIG-005).'),
  ('reissueInvoice',      'gas', false, 'P4a — releases rows back to Unbilled across all three layers.'),
  ('transferItems',       'gas', false, 'P5 — cross-tenant; builds on session-92 inventory_live + provenance.'),
  ('receiveShipment',     'gas', false, 'P5 — multi-entity (inventory + RCVG billing + auto-INSP + email).'),
  ('onboardClient',       'gas', false, 'P5 — last to migrate; new clients SB-only post-cutover.'),
  ('qboCreateInvoice',    'gas', false, 'P6 — QBO OAuth + invoice push. Ships first as P4b prerequisite.'),
  ('createStaxInvoices',  'gas', false, 'P6 — Stax invoice creation.'),
  ('runStaxCharges',      'gas', false, 'P6 — auto-pay daily. StaxAutoPay.gs becomes scheduled Edge Function.'),
  ('sendShipmentEmail',   'gas', false, 'P3 — move to send-email Edge Function (Resend).'),
  ('sendWillCallEmails',  'gas', false, 'P3 — created/released/cancelled emails.'),
  ('sendRepairEmails',    'gas', false, 'P3 (non-terminal) / P4 (complete) — quote/approved/declined now; complete bundled with completeRepair.')
ON CONFLICT (function_key) DO NOTHING;

-- ------------------------------------------------------------------
-- 2. parity_results
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.parity_results (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_key      text NOT NULL,
  tenant_id         text,
  call_id           text,            -- references gas_call_log.correlation_id; nullable for synthetic / fixture runs
  fixture_id        text,            -- non-null for parity-fixtures runs
  input_hash        text,
  gas_state_hash    text,
  sb_state_hash     text,
  match             boolean NOT NULL,
  gas_duration_ms   integer,
  sb_duration_ms    integer,
  mismatch_details  jsonb,           -- structured diff: { added: [...], removed: [...], modified: [...] }
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parity_results_function_idx
  ON public.parity_results (function_key, created_at DESC);
CREATE INDEX IF NOT EXISTS parity_results_match_idx
  ON public.parity_results (function_key, match, created_at DESC)
  WHERE match = false;
CREATE INDEX IF NOT EXISTS parity_results_call_idx
  ON public.parity_results (call_id);
CREATE INDEX IF NOT EXISTS parity_results_tenant_idx
  ON public.parity_results (tenant_id, created_at DESC);

ALTER TABLE public.parity_results ENABLE ROW LEVEL SECURITY;

-- staff/admin read; service_role for the replay harness writes.
DROP POLICY IF EXISTS parity_results_staff ON public.parity_results;
CREATE POLICY parity_results_staff ON public.parity_results
  FOR SELECT
  USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS parity_results_service_write ON public.parity_results;
CREATE POLICY parity_results_service_write ON public.parity_results
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- 3. gas_call_log
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gas_call_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id     text NOT NULL UNIQUE,
  action             text NOT NULL,
  input_redacted     jsonb,
  input_hash         text,
  tenant_id          text,
  user_id            uuid,
  gas_duration_ms    integer,
  status             text NOT NULL DEFAULT 'started'
                       CHECK (status IN ('started', 'success', 'error')),
  error_message      text,
  called_at          timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS gas_call_log_action_idx
  ON public.gas_call_log (action, called_at DESC);
CREATE INDEX IF NOT EXISTS gas_call_log_tenant_idx
  ON public.gas_call_log (tenant_id, called_at DESC);
CREATE INDEX IF NOT EXISTS gas_call_log_called_at_idx
  ON public.gas_call_log (called_at DESC);

ALTER TABLE public.gas_call_log ENABLE ROW LEVEL SECURITY;

-- staff/admin read; service_role for GAS writethrough writes.
DROP POLICY IF EXISTS gas_call_log_staff ON public.gas_call_log;
CREATE POLICY gas_call_log_staff ON public.gas_call_log
  FOR SELECT
  USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS gas_call_log_service_write ON public.gas_call_log;
CREATE POLICY gas_call_log_service_write ON public.gas_call_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ------------------------------------------------------------------
-- 4. entity_audit_log.correlation_id
-- ------------------------------------------------------------------
-- Ties each state change to the gas_call_log row that produced it. The
-- replay harness joins entity_audit_log → gas_call_log on this column to
-- reconstruct the (input, output) pairs the SB-side rewrite must match.

ALTER TABLE public.entity_audit_log
  ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS entity_audit_log_correlation_idx
  ON public.entity_audit_log (correlation_id)
  WHERE correlation_id IS NOT NULL;
