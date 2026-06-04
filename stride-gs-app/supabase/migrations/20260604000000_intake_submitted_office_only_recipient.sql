-- INTAKE_SUBMITTED recipient fix — office inbox only, NOT the full staff list.
--
-- Bug (reported 2026-06-04, traced to a send at 2026-06-03 17:29 PDT /
-- 2026-06-04 00:29:43 UTC, email_sends id a4209f93-3697-4780-84fb-d935dbaacfb9):
-- the client-intake completion alert was going to all 14 active admin+staff
-- profiles (neeko@, jon@, cel@, travis@, whse@, demitrie@, ken@, andrew@,
-- adielle@, evan@, dispatch@, kc@, info@, justin@stridenw.com).
--
-- Cause: migration 20260424090000 set this template's `recipients` column to
-- the canonical {{STAFF_EMAILS}} token "so it matches every other staff-alert
-- template." But STAFF_EMAILS expands (in send-email/index.ts → expandToken)
-- to `profiles WHERE role IN ('admin','staff') AND is_active` — the entire
-- warehouse roster. An intake-completion alert is an office/front-desk concern,
-- not a warehouse-floor one, so it should land in the office inbox only.
--
-- Fix: set recipients to the literal office address. This stays fully editable
-- from Settings → Email Templates (the recipients column is admin-facing), so
-- the office can add/swap addresses without a code change. A literal address
-- (rather than a new token) keeps the intended audience explicit and immune to
-- future profile role/seat churn re-inflating the list.
--
-- No paired code change required: useClientIntake.ts fires send-email with NO
-- `to`, so the edge function resolves this `recipients` column directly.

UPDATE public.email_templates
   SET recipients = 'info@stridenw.com',
       updated_at = now()
 WHERE template_key = 'INTAKE_SUBMITTED';
