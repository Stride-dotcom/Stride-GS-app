-- =============================================================================
-- Alert queue provider send-log fields
-- -----------------------------------------------------------------------------
-- Adds provider-level observability for email send logs so the UI can show:
-- - which provider actually sent each message
-- - provider message id
-- - whether fallback routing was used
-- =============================================================================

ALTER TABLE public.alert_queue
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean NOT NULL DEFAULT false;

ALTER TABLE public.alert_queue
  DROP CONSTRAINT IF EXISTS alert_queue_provider_check;

ALTER TABLE public.alert_queue
  ADD CONSTRAINT alert_queue_provider_check
  CHECK (provider IS NULL OR provider IN ('resend', 'postmark'));

CREATE INDEX IF NOT EXISTS idx_alert_queue_sent_at ON public.alert_queue (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_queue_status_sent_at ON public.alert_queue (status, sent_at DESC);

