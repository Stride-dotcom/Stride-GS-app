-- ============================================================
-- Stride GS App — Supabase Phase 1 Setup
-- Run this entire script in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/uqplppugeickmamycpuz/editor
-- ============================================================

-- ── 1. Create gs_sync_events table ───────────────────────────

CREATE TABLE IF NOT EXISTS public.gs_sync_events (
  id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     text          NOT NULL,           -- clientSheetId (Google Sheet ID)
  entity_type   text          NOT NULL,           -- 'task' | 'repair' | 'will_call' | 'inventory' | 'shipment'
  entity_id     text          NOT NULL,           -- e.g. 'INSP-12345', 'WC-00123'
  action_type   text          NOT NULL,           -- e.g. 'complete_task', 'start_task', 'process_wc_release'
  sync_status   text          NOT NULL DEFAULT 'sync_failed', -- 'pending_sync' | 'confirmed' | 'sync_failed' | 'resolved'
  requested_by  text          NOT NULL,           -- user email
  request_id    text          NOT NULL UNIQUE,    -- UUID idempotency token
  payload       jsonb,                            -- full request payload for retry
  error_message text,                             -- what went wrong
  created_at    timestamptz   DEFAULT now(),
  updated_at    timestamptz   DEFAULT now(),
  confirmed_at  timestamptz                       -- set when Apps Script confirms (Phase 2)
);

-- ── 2. Indexes ────────────────────────────────────────────────

-- Fast failure queries per tenant
CREATE INDEX IF NOT EXISTS gs_sync_events_tenant_status
  ON public.gs_sync_events (tenant_id, sync_status);

-- Fast per-user queries
CREATE INDEX IF NOT EXISTS gs_sync_events_requested_by_status
  ON public.gs_sync_events (requested_by, sync_status);

-- ── 3. Updated_at trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER gs_sync_events_updated_at
  BEFORE UPDATE ON public.gs_sync_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. Enable Row-Level Security ──────────────────────────────

ALTER TABLE public.gs_sync_events ENABLE ROW LEVEL SECURITY;

-- ── 5. RLS Policies ───────────────────────────────────────────

-- INSERT: any authenticated user can insert their own events
--   (requested_by must match their auth email)
CREATE POLICY "users_insert_own_events"
  ON public.gs_sync_events
  FOR INSERT
  TO authenticated
  WITH CHECK (requested_by = auth.email());

-- SELECT: users see their own events;
--   admin/staff (role stored in user_metadata by the React app) see all
CREATE POLICY "users_read_own_events"
  ON public.gs_sync_events
  FOR SELECT
  TO authenticated
  USING (
    requested_by = auth.email()
    OR (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

-- UPDATE: users can resolve/dismiss their own events
--   (to mark sync_status = 'resolved')
CREATE POLICY "users_update_own_events"
  ON public.gs_sync_events
  FOR UPDATE
  TO authenticated
  USING (requested_by = auth.email())
  WITH CHECK (requested_by = auth.email());

-- Service role (used by Apps Script in Phase 2) bypasses RLS automatically.
-- No additional policy needed for service role.

-- ── 6. Realtime: enable for this table ───────────────────────
-- Run this to allow Supabase Realtime subscriptions on gs_sync_events:

ALTER PUBLICATION supabase_realtime ADD TABLE public.gs_sync_events;

-- ── Done ─────────────────────────────────────────────────────
-- After running this script, verify in Table Editor that
-- gs_sync_events appears with RLS enabled (shield icon).
