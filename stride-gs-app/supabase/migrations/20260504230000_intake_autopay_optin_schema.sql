-- Migration: schema additions for the intake autopay opt-in redesign.
--
-- Purely additive. No behavior change. The form code that fills these
-- columns ships in PR B-2; the reminder cron that reads
-- last_intake_body_sha256 ships in PR B-3. With this migration alone,
-- columns just sit empty / get default values.
--
-- Decisions referenced (from the conversation log):
--   #21 — body hash-tracking for T&C versioning (not named versions)
--   #22 — payment_method_required mirrors current state per client
--   #25 — reuse client_intakes; no separate consents table
--   #26 — clients gets payment_method_required + last_intake_* mirror cols
--   #28 — refresh-mode submissions auto-apply on submit
--   #35 — weekly reminder cadence with snooze override
--   #30 — Supabase-only writes; no GAS/CB Clients sheet round-trip

-- ── client_intakes: 5 new columns for the new model ──────────────────────────
ALTER TABLE client_intakes
  ADD COLUMN IF NOT EXISTS body_sha256 text,
  ADD COLUMN IF NOT EXISTS autopay_elected boolean,
  ADD COLUMN IF NOT EXISTS payment_method_required_snapshot boolean,
  ADD COLUMN IF NOT EXISTS acknowledged_3pct_cc_fee boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS submission_source text DEFAULT 'intake_full';

-- Submission source values:
--   'intake_full'              — new client onboarding flow
--   'intake_preference_update' — existing client refreshing prefs (auto-applied)
--   'staff_override'           — staff-initiated change via settings modal
ALTER TABLE client_intakes
  DROP CONSTRAINT IF EXISTS client_intakes_submission_source_check;
ALTER TABLE client_intakes
  ADD CONSTRAINT client_intakes_submission_source_check
  CHECK (submission_source IN ('intake_full', 'intake_preference_update', 'staff_override'));

-- ── clients: 3 new columns mirroring intake state ────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS payment_method_required boolean,
  ADD COLUMN IF NOT EXISTS last_intake_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_intake_body_sha256 text,
  -- Per-client override that pauses the weekly reminder cron until this date.
  -- NULL = no snooze. Past date = expired snooze (treated as no snooze).
  ADD COLUMN IF NOT EXISTS intake_reminder_snooze_until date,
  -- When the cron last sent the re-sign reminder. NULL = never sent (still due).
  ADD COLUMN IF NOT EXISTS last_intake_reminder_at timestamptz;

-- ── Migration: mirror current state per Decision #22 ─────────────────────────
-- payment_method_required is set TRUE for clients who already have a payment
-- method on file (proxy: stax_customer_id present), FALSE otherwise. This
-- preserves operational status quo and avoids forcing grandfathered clients
-- to add a card they've never needed.
UPDATE clients
SET payment_method_required = (stax_customer_id IS NOT NULL AND stax_customer_id <> '')
WHERE payment_method_required IS NULL;

-- New clients (post-migration) default to TRUE.
ALTER TABLE clients
  ALTER COLUMN payment_method_required SET DEFAULT true;

-- ── Backfill last_intake_* from the most recent activated intake per client ──
-- For existing clients who already submitted under the OLD T&C, stamp their
-- last_intake_body_sha256 to a sentinel that won't match the current hash —
-- this guarantees they show up on the reminder cron under the new model
-- (they need to re-sign the new §3). 'pre-v2-migration' is the sentinel.
UPDATE clients c
SET
  last_intake_submitted_at = ci.submitted_at,
  last_intake_body_sha256 = 'pre-v2-migration'
FROM (
  SELECT DISTINCT ON (client_spreadsheet_id) client_spreadsheet_id, submitted_at
  FROM client_intakes
  WHERE client_spreadsheet_id IS NOT NULL
    AND submitted_at IS NOT NULL
  ORDER BY client_spreadsheet_id, submitted_at DESC
) ci
WHERE c.spreadsheet_id = ci.client_spreadsheet_id
  AND c.last_intake_body_sha256 IS NULL;

-- ── INTAKE_RESIGN_REMINDER email template ────────────────────────────────────
-- Body matches the existing Stride voice (friendly, plain English, no
-- legalese). The reminder cron fills tokens from clients + the intake URL.
INSERT INTO email_templates (template_key, subject, body, notes, recipients, attach_doc, category, active)
VALUES (
  'INTAKE_RESIGN_REMINDER',
  'Quick reminder: please re-sign the Stride agreement',
  E'<p>Hey {{CONTACT_NAME}},</p>\n' ||
  E'<p>Just a nudge — we updated our service agreement and we''re collecting fresh signatures from every client. It takes about 3 minutes; mostly you''ll just be confirming your existing settings.</p>\n' ||
  E'<p><a href="{{INTAKE_URL}}" style="display:inline-block;background:#E8692A;color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;font-size:12px;">Open the form</a></p>\n' ||
  E'<p>Heads up: we''ll keep sending this once a week until it''s done. If you''ve got a question or need a hand, just reply — we''d rather walk you through it than spam you.</p>\n' ||
  E'<p>Thanks,<br>The Stride team</p>',
  E'Weekly re-sign reminder. Tokens: CONTACT_NAME, BUSINESS_NAME, INTAKE_URL.',
  '',
  '',
  'transactional',
  true
)
ON CONFLICT (template_key) DO NOTHING;

-- Indexes for the reminder cron's main filter.
CREATE INDEX IF NOT EXISTS clients_intake_reminder_due_idx
  ON clients (last_intake_reminder_at NULLS FIRST)
  WHERE last_intake_body_sha256 IS DISTINCT FROM NULL;

CREATE INDEX IF NOT EXISTS client_intakes_client_spreadsheet_id_idx
  ON client_intakes (client_spreadsheet_id) WHERE client_spreadsheet_id IS NOT NULL;
