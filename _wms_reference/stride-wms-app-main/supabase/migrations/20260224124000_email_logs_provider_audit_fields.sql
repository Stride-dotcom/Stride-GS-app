-- =============================================================================
-- Email logs provider audit fields
-- -----------------------------------------------------------------------------
-- Adds provider observability for direct email sends (send-email / emailService):
-- - provider used
-- - provider message id
-- - whether fallback was used
-- Keeps legacy resend_id for backward compatibility.
-- =============================================================================

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean NOT NULL DEFAULT false;

ALTER TABLE public.email_logs
  DROP CONSTRAINT IF EXISTS email_logs_provider_check;

ALTER TABLE public.email_logs
  ADD CONSTRAINT email_logs_provider_check
  CHECK (provider IS NULL OR provider IN ('resend', 'postmark', 'test_mode'));

-- Best-effort backfill from legacy resend_id field.
UPDATE public.email_logs
SET
  provider = CASE
    WHEN resend_id = 'TEST_MODE' THEN 'test_mode'
    WHEN COALESCE(BTRIM(resend_id), '') <> '' THEN 'resend'
    ELSE provider
  END,
  provider_message_id = COALESCE(provider_message_id, resend_id)
WHERE provider IS NULL
   OR provider_message_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON public.email_logs (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status_sent_at ON public.email_logs (status, sent_at DESC);

