-- ============================================================================
-- P1 hardening — anon_security_definer_function_executable (the non-public subset)
--
-- 18 SECURITY DEFINER functions were anon-executable. 4 are genuinely public
-- (submit_public_request, get_public_order, find_public_order_id,
-- is_fresh_public_form_order) and 1 low-risk read (get_default_tax_rate) — LEFT
-- as-is (the public delivery/intake forms call them with the anon key).
--
-- The remaining 13 should NOT be anon-callable:
--   • 9 are TRIGGER functions — triggers fire as the table owner regardless of
--     EXECUTE grant, so revoking ALL direct EXECUTE is safe (no caller needs it).
--   • 1 is an internal billing helper (_insurance_charge_for_period) called by
--     the insurance cron / definer functions → keep service_role only.
--   • 3 are authenticated app RPCs (set_cod_storage, mark_cod_storage_collected,
--     rpc_complete_split_task) — keep authenticated + service_role, drop anon.
-- ============================================================================

-- ── 9 trigger functions: no direct caller needs EXECUTE ─────────────────────
REVOKE EXECUTE ON FUNCTION public.apply_cod_storage_on_receive()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_client_settings_change()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_coverage_change()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_admins_on_intake_submit()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.propagate_clients_to_sheet()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tasks_auto_stamp_due_date()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_autocomplete_db_from_billing()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_autocomplete_db_from_inventory()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_conversation_last_message_at()    FROM PUBLIC, anon, authenticated;

-- ── internal billing helper: service_role only ─────────────────────────────
REVOKE EXECUTE ON FUNCTION public._insurance_charge_for_period(text, numeric, numeric, date, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._insurance_charge_for_period(text, numeric, numeric, date, date) TO service_role;

-- ── authenticated app RPCs: keep authenticated + service_role, drop anon ────
REVOKE EXECUTE ON FUNCTION public.set_cod_storage(text, text[], boolean, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_cod_storage(text, text[], boolean, date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.mark_cod_storage_collected(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_cod_storage_collected(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_complete_split_task(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_complete_split_task(text, text, text) TO authenticated, service_role;
