-- dt_credentials.account_name_map — invert shape so multiple Stride
-- clients can share a single DispatchTrack account name.
--
-- BEFORE:  { [dtAccountName]: tenantId }   — DT name unique, one tenant each
-- AFTER :  { [tenantId]: dtAccountName }   — tenant unique, DT names reusable
--
-- Rationale: a single DT account (e.g. "ROCHE BOBOIS") in DispatchTrack
-- frequently receives deliveries scheduled by more than one Stride client
-- (the design firm + their client sub-accounts, or a parent + children).
-- The old shape disallowed that because the DT name was the jsonb key and
-- keys must be unique — setting a second client to the same DT name
-- silently overwrote the first.
--
-- The new shape makes tenant_id the key. Each Stride client has exactly
-- one DT account (still enforced by key uniqueness), but many tenants
-- can point at the same DT account string. Direct lookup for the common
-- paths (push-to-DT: tenant → DT name; Settings UI: tenant → DT name) is
-- now O(1). Webhook/backfill ingest (DT name → tenant) inverts the map
-- once on entry — O(N) on ~50 rows is immaterial.
--
-- Data preservation: every existing entry is re-written in place using
-- jsonb_object_agg(value, key). If two DT names were mistakenly mapped
-- to the same tenant (shouldn't happen — the old UI deduped — but
-- defensively), jsonb_object_agg keeps the last pair encountered.

UPDATE public.dt_credentials
SET account_name_map = COALESCE(
  (
    SELECT jsonb_object_agg(value, key)
    FROM jsonb_each_text(account_name_map)
  ),
  '{}'::jsonb
)
WHERE account_name_map IS NOT NULL
  AND account_name_map <> '{}'::jsonb;

COMMENT ON COLUMN public.dt_credentials.account_name_map IS
  'Tenant → DispatchTrack account name. Shape: { [tenantId]: dtAccountName }. '
  'Many tenants may map to the same DT account. Clients with no entry fall '
  'back to the "STRIDE LOGISTICS" default in the push-to-DT edge function.';
