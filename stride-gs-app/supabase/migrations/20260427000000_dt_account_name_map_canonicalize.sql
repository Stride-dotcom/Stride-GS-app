-- 20260427000000_dt_account_name_map_canonicalize.sql
--
-- The dt_credentials.account_name_map jsonb has been written in two
-- conflicting shapes over time:
--   • {tenant_id → account_name}   ← canonical; what dt-push-order
--                                    and dt-backfill-orders read
--   • {account_name → tenant_id}   ← inverted; what the Settings UI
--                                    was wrongly writing (fixed in
--                                    the same PR as this migration)
--
-- The inverted shape forces account_name to be unique, which blocks
-- the legitimate case of "many Stride clients billing to the same DT
-- account" (e.g. parent-child sheets that share a single DT account).
-- This migration drops every inverted entry, leaving only the
-- canonical shape.
--
-- Detection: tenant_ids are Google Drive Spreadsheet IDs — exactly
-- 44 chars from [A-Za-z0-9_-]. Account names contain spaces or are
-- short. Any entry whose KEY does NOT match the tenant_id regex is
-- considered inverted and removed.

UPDATE public.dt_credentials
SET account_name_map = (
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM jsonb_each_text(account_name_map)
  WHERE key ~ '^[A-Za-z0-9_-]{40,}$'
);
