-- Session 90 — `email_sends` audit / dedupe log for the new Resend
-- send-email edge function.
--
-- Every email the app sends through the Resend pipeline writes one row
-- here. The table serves three purposes:
--
--   1. Audit trail — staff/admin Settings → Notifications → "Sent
--      emails" tab can show what fired, when, to whom, with what tokens,
--      and whether Resend accepted it.
--
--   2. Idempotency — callers may pass an `idempotency_key`. If a row
--      with that key already has status='sent', the edge function
--      short-circuits and returns the existing send id instead of
--      double-sending. Lets retry/refresh paths be safe.
--
--   3. Failure visibility — when Resend errors (bad address, rate
--      limit, etc.) the row stays at status='failed' with the error
--      payload, so we can re-send manually from the dashboard without
--      digging through Resend's logs.
--
-- RLS: admin/staff see all sends. Clients see only sends scoped to
-- their tenant_id. Service role writes via the edge function. There is
-- no client-side INSERT path — sends only happen through the edge
-- function (which uses the service role key).

CREATE TABLE IF NOT EXISTS public.email_sends (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key         text        NOT NULL,
  to_emails            text[]      NOT NULL,
  cc_emails            text[],
  bcc_emails           text[],
  reply_to             text,
  subject              text,
  -- pending → set on initial insert before the Resend call
  -- sent    → Resend returned 200 + an email id
  -- failed  → Resend returned non-2xx, error_message holds the body
  status               text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','sent','failed')),
  resend_email_id      text,
  error_message        text,
  -- Tokens passed by the caller for {{KEY}} replacement; persisted so a
  -- failed send can be replayed without recomputing the inputs.
  tokens               jsonb       DEFAULT '{}'::jsonb,
  -- Caller-supplied dedupe key. UNIQUE so a duplicate idempotency_key
  -- with status='sent' short-circuits.
  idempotency_key      text        UNIQUE,
  triggered_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_by_email   text,
  related_entity_type  text,
  related_entity_id    text,
  tenant_id            text,
  sent_at              timestamptz,
  created_at           timestamptz DEFAULT now()
);

COMMENT ON TABLE public.email_sends
  IS 'Session 90: audit + dedupe log for Resend-sent emails. One row per send attempt. status=pending → sent | failed.';

CREATE INDEX IF NOT EXISTS idx_email_sends_template ON public.email_sends (template_key);
CREATE INDEX IF NOT EXISTS idx_email_sends_status   ON public.email_sends (status) WHERE status <> 'sent';
CREATE INDEX IF NOT EXISTS idx_email_sends_entity   ON public.email_sends (related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_sends_created  ON public.email_sends (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sends_tenant   ON public.email_sends (tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE public.email_sends REPLICA IDENTITY FULL;
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

-- Staff + admin see every send.
DROP POLICY IF EXISTS "email_sends_select_staff" ON public.email_sends;
CREATE POLICY "email_sends_select_staff" ON public.email_sends
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

-- Clients see sends scoped to their bound tenant.
DROP POLICY IF EXISTS "email_sends_select_own_tenant" ON public.email_sends;
CREATE POLICY "email_sends_select_own_tenant" ON public.email_sends
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

-- Service role (the edge function) does all writes.
DROP POLICY IF EXISTS "email_sends_service_all" ON public.email_sends;
CREATE POLICY "email_sends_service_all" ON public.email_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Realtime — so a future "Sent emails" admin tab updates live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'email_sends'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.email_sends';
  END IF;
END $$;
