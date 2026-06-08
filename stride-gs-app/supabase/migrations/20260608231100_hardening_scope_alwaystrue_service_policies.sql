-- ============================================================================
-- P1 hardening — rls_policy_always_true (the "_service_*_all TO public" subset)
--
-- These 10 policies are `FOR ALL TO public USING(true) WITH CHECK(true)` — named
-- "service role all" but actually granted to PUBLIC (anon + authenticated), an
-- always-true escape hatch. Scope each to `service_role` so anon/authenticated
-- fall back to the table's PROPER scoped policies.
--
-- Verified safe before tightening:
--   • Each table has a separate scoped read policy the app uses (e.g.
--     claims_select_admin_staff / claims_select_client_own,
--     repair_items_select_staff/_client, *_select_admin_staff, profiles_read_all
--     + profiles_update_own, parity_log_admin_read, pickup_links_select_staff
--     + pickup_links_modify_staff, cb_users_select_admin_staff).
--   • The browser does NOT write these tables directly except dt_pickup_links,
--     which is covered by pickup_links_modify_staff — confirmed by grepping
--     `.from('<table>').insert|update|upsert|delete` across src.
--   • All other writes go through GAS / Edge Functions / triggers using the
--     service-role key (service_role has BYPASSRLS, so it is unaffected).
-- Net: removes the anon/authenticated always-true ALL grant; reads + scoped
-- writes keep working; service-role keeps full access.
--
-- INTENTIONALLY LEFT (documented, not bugs):
--   • client_intake_drafts.drafts_anon_all + client_intakes.intakes_public_insert
--     — the public (anon) intake form depends on these.
--   • email_templates_audit insert/select (authenticated), in_app_notifications
--     insert (authenticated) — authenticated audit/notification writes.
--   • profiles_read_all (authenticated SELECT true) — useProfiles reads the
--     directory; tightening risks the staff-assignment UI. Tracked separately.
-- ============================================================================

ALTER POLICY "parity_log_service_write"             ON public.billing_parity_log   TO service_role;
ALTER POLICY "cb_users_service_role_all"            ON public.cb_users             TO service_role;
ALTER POLICY "claims_service_role_all"              ON public.claims               TO service_role;
ALTER POLICY "pickup_links_service_all"             ON public.dt_pickup_links      TO service_role;
ALTER POLICY "marketing_campaigns_service_role_all" ON public.marketing_campaigns  TO service_role;
ALTER POLICY "marketing_contacts_service_role_all"  ON public.marketing_contacts   TO service_role;
ALTER POLICY "marketing_settings_service_role_all"  ON public.marketing_settings   TO service_role;
ALTER POLICY "marketing_templates_service_role_all" ON public.marketing_templates  TO service_role;
ALTER POLICY "profiles_service_all"                 ON public.profiles             TO service_role;
ALTER POLICY "repair_items_service_all"             ON public.repair_items         TO service_role;
