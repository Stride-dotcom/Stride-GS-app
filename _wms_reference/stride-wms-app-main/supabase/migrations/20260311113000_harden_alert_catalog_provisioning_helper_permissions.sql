-- Harden internal helper privileges to prevent direct cross-tenant mutation.
-- These helpers are SECURITY DEFINER and should only be reachable via
-- privileged admin/service RPC flows and triggers, not direct client RPC.

REVOKE ALL ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) FROM anon;
REVOKE ALL ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_catalog_trigger_for_all_tenants(text) TO service_role;

REVOKE ALL ON FUNCTION public._trg_sync_catalog_trigger_to_tenants() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._trg_sync_catalog_trigger_to_tenants() FROM anon;
REVOKE ALL ON FUNCTION public._trg_sync_catalog_trigger_to_tenants() FROM authenticated;
