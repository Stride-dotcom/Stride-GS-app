-- 20260427010000_dt_credentials_house_tenant.sql
--
-- Adds dt_credentials.house_tenant_id — the Stride-internal tenant a
-- webhook event should bind to when the inbound DT account name
-- doesn't resolve to any specific client. Pairs with the push-side
-- "STRIDE LOGISTICS" account fallback (dt-push-order v16) so neither
-- direction of the integration ever produces a blocking error: a
-- push for an unmapped tenant lands on the DT house account, and a
-- webhook for an unmapped DT account lands on the Stride house
-- tenant. The admin sets this in Settings → DispatchTrack.
--
-- Nullable + no default: when null the webhook ingest falls back to
-- the historical quarantine behaviour, preserving today's semantics
-- until the admin opts in.

ALTER TABLE public.dt_credentials
  ADD COLUMN IF NOT EXISTS house_tenant_id text;

COMMENT ON COLUMN public.dt_credentials.house_tenant_id IS
  'Stride-internal tenant_id that catches webhook events whose Account name does not resolve to any specific client. Set via Settings → DispatchTrack. Null → fall back to quarantine.';
