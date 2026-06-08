-- ============================================================================
-- P2 hardening — function_search_path_mutable (the functions still missing a
-- pinned search_path; many recent ones already set it).
--
-- Pinning to `public, pg_temp` closes the mutable-search-path hijack vector
-- without changing resolution behavior. Verified safe for every function below:
-- a body scan found NO unqualified extension/uuid-ossp/pgcrypto calls
-- (risky_ext_use = false for all), so none rely on a schema outside
-- {public, pg_temp, pg_catalog}. The two RLS-critical ones were body-checked:
-- user_has_tenant_access / _storage are pure `auth.jwt()` (qualified) + jsonb
-- built-ins — zero search_path dependency. custom_access_token_hook is pure
-- jsonb. These are metadata-only changes (function bodies untouched).
-- 'reset' (advisor) lives outside public — not altered here.
-- ============================================================================

-- ── timestamp / resolve / log trigger functions (no args) ───────────────────
ALTER FUNCTION public.client_insurance_set_updated_at()      SET search_path = public, pg_temp;
ALTER FUNCTION public.documents_touch_updated_at()           SET search_path = public, pg_temp;
ALTER FUNCTION public.dt_order_items_resolve_inventory_id()  SET search_path = public, pg_temp;
ALTER FUNCTION public.email_templates_touch_updated_at()     SET search_path = public, pg_temp;
ALTER FUNCTION public.entity_notes_touch_updated_at()        SET search_path = public, pg_temp;
ALTER FUNCTION public.expected_shipments_touch_updated_at()  SET search_path = public, pg_temp;
ALTER FUNCTION public.feature_flags_touch_updated_at()       SET search_path = public, pg_temp;
ALTER FUNCTION public.item_photos_touch_updated_at()         SET search_path = public, pg_temp;
ALTER FUNCTION public.log_billing_parity()                   SET search_path = public, pg_temp;
ALTER FUNCTION public.log_client_settings_change()           SET search_path = public, pg_temp;
ALTER FUNCTION public.propagate_sidemark_to_billing()        SET search_path = public, pg_temp;
ALTER FUNCTION public.quotes_touch_updated_at()              SET search_path = public, pg_temp;
ALTER FUNCTION public.set_expected_shipments_updated_at()    SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()                       SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_storage_billing_items_touch()       SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_client_intake_draft_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_conversation_last_message_at()   SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_item_id_ledger_updated_at()      SET search_path = public, pg_temp;
ALTER FUNCTION public.update_address_book_timestamp()        SET search_path = public, pg_temp;
ALTER FUNCTION public.user_view_prefs_touch_updated_at()     SET search_path = public, pg_temp;

-- ── scalar / util / RPC functions ───────────────────────────────────────────
ALTER FUNCTION public._parse_stor_summary_period(text)       SET search_path = public, pg_temp;
ALTER FUNCTION public._parse_stor_task_range(text)           SET search_path = public, pg_temp;
ALTER FUNCTION public._test_dollar()                         SET search_path = public, pg_temp;
ALTER FUNCTION public.client_name_prefix(text)               SET search_path = public, pg_temp;
ALTER FUNCTION public.next_order_number()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.next_repair_id(text)                   SET search_path = public, pg_temp;
ALTER FUNCTION public.upsert_delivery_availability(text, jsonb) SET search_path = public, pg_temp;

-- ── auth / RLS critical (body-verified: no search_path dependency) ──────────
ALTER FUNCTION public.custom_access_token_hook(jsonb)        SET search_path = public, pg_temp;
ALTER FUNCTION public.user_has_tenant_access(text)           SET search_path = public, pg_temp;
ALTER FUNCTION public.user_has_tenant_access_storage(text)   SET search_path = public, pg_temp;
