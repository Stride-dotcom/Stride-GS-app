-- ============================================================
-- Stride GS App — DT Phase 1c Webhook Prep
-- Applies BEFORE the dt-webhook-ingest Edge Function is deployed.
--
-- Changes:
--   1. Add 'dt_webhook' to dt_orders.source CHECK constraint
--      (live webhook upserts must set source = 'dt_webhook';
--       old constraint only allowed app/dt_ui/webhook_backfill/reconcile)
--   2. Add account_name_map JSONB column to dt_credentials
--      (maps DT account name → tenant_id clientSheetId;
--       e.g. {"Ahlers": "1BxiMVs0XRA5nFMdKvBdBZjgm..."})
-- ============================================================

-- 1. Drop + recreate source CHECK to include 'dt_webhook'
ALTER TABLE public.dt_orders
  DROP CONSTRAINT IF EXISTS dt_orders_source_check;

ALTER TABLE public.dt_orders
  ADD CONSTRAINT dt_orders_source_check
  CHECK (source IN ('app', 'dt_ui', 'webhook_backfill', 'reconcile', 'dt_webhook'));

-- 2. Add account_name_map to dt_credentials if it doesn't exist
ALTER TABLE public.dt_credentials
  ADD COLUMN IF NOT EXISTS account_name_map jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.dt_credentials.account_name_map IS
  'Maps DT account name (from {{Account}} webhook tag) to Stride tenant_id '
  '(= clientSheetId). Example: {"Ahlers": "1BxiMVs0...", "Smith": "1AbcDef..."}. '
  'Populated manually by admin or via the Settings → DT Accounts mapping UI.';
