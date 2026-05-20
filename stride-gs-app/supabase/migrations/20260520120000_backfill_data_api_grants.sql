-- Backfill explicit Data API role grants on every public.* table.
--
-- Why: Supabase begins enforcing explicit role grants on the PostgREST
-- (Data API) path on 2026-10-30. Today, any public table is reachable
-- through the Data API because the platform implicitly grants on it.
-- After 2026-10-30, a public table with no `GRANT … TO authenticated`
-- returns 404 / "permission denied for table" to the React app —
-- regardless of whether RLS policies are correctly set up.
--
-- This migration is a one-shot backfill. The CLAUDE.md / skill rule
-- now requires every NEW table migration to ship its own GRANTs
-- inline, so this file should be the last time we have to do this
-- en masse.
--
-- The check query Justin specified:
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public'
--     AND NOT EXISTS (
--       SELECT 1 FROM information_schema.role_table_grants
--       WHERE table_name = pg_tables.tablename
--         AND grantee   = 'authenticated'
--     );
-- This DO block runs the same logic and acts on every match, then
-- does the equivalent for service_role. Idempotent — re-running it
-- after a fresh table ships without grants will just heal that table.
--
-- Scope of grant chosen to match the new-table template in CLAUDE.md:
-- `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`. RLS policies
-- still gate which rows the role actually sees; the grant only
-- gates whether the role can attempt the verb at all.
--
-- Deliberately conservative on tables that already hold ANY authenticated
-- grant: if a table currently has only `GRANT SELECT TO authenticated`,
-- this backfill leaves it alone — Supabase's 2026-10-30 enforcement
-- requires reachability, not the full four verbs, and silently adding
-- INSERT/UPDATE/DELETE could widen access on a table that was
-- intentionally read-only. Per-verb gaps on partially-granted tables
-- must be fixed by the owning feature migration with explicit intent.
--
-- Anon grants are deliberately NOT touched. Anon access is an opt-in
-- carve-out per table (e.g. PublicServiceRequest.tsx); granting anon
-- across the board would be a cross-tenant exposure risk.

DO $$
DECLARE
  rec RECORD;
  authenticated_added int := 0;
  service_role_added  int := 0;
  no_rls_tables       text[] := ARRAY[]::text[];
  rls_no_policy       text[] := ARRAY[]::text[];
BEGIN
  -- 1. authenticated grants where none exist on the table.
  FOR rec IN
    SELECT t.tablename
      FROM pg_tables t
     WHERE t.schemaname = 'public'
       AND NOT EXISTS (
             SELECT 1
               FROM information_schema.role_table_grants g
              WHERE g.table_schema = 'public'
                AND g.table_name   = t.tablename
                AND g.grantee      = 'authenticated'
           )
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated',
      rec.tablename
    );
    authenticated_added := authenticated_added + 1;
    RAISE NOTICE '[grants-backfill] +authenticated  public.%', rec.tablename;
  END LOOP;

  -- 2. service_role grants where none exist on the table. Edge Functions
  --    and out-of-band backfills depend on these; RLS bypass alone
  --    isn't enough — PostgREST still checks the table grant.
  FOR rec IN
    SELECT t.tablename
      FROM pg_tables t
     WHERE t.schemaname = 'public'
       AND NOT EXISTS (
             SELECT 1
               FROM information_schema.role_table_grants g
              WHERE g.table_schema = 'public'
                AND g.table_name   = t.tablename
                AND g.grantee      = 'service_role'
           )
  LOOP
    EXECUTE format(
      'GRANT ALL ON public.%I TO service_role',
      rec.tablename
    );
    service_role_added := service_role_added + 1;
    RAISE NOTICE '[grants-backfill] +service_role   public.%', rec.tablename;
  END LOOP;

  -- 3. Surface tables with no RLS enabled. We do NOT auto-enable here
  --    because turning RLS on without a policy = deny-all to
  --    non-service roles, which would break the live app. The
  --    operator must follow up on each of these by hand: either
  --    enable RLS + add a policy, or document why it's safe without.
  FOR rec IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'           -- ordinary tables only
       AND c.relrowsecurity = false
  LOOP
    no_rls_tables := array_append(no_rls_tables, rec.tablename);
  END LOOP;

  -- 4. Surface RLS-enabled tables that have zero policies. With grants
  --    now in place, these will look readable to authenticated… until
  --    RLS bites and returns empty. Caller needs to add a policy.
  FOR rec IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity = true
       AND NOT EXISTS (
             SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public'
                AND p.tablename  = c.relname
           )
  LOOP
    rls_no_policy := array_append(rls_no_policy, rec.tablename);
  END LOOP;

  RAISE NOTICE '[grants-backfill] DONE. authenticated added on % table(s); service_role added on % table(s).',
    authenticated_added, service_role_added;

  IF array_length(no_rls_tables, 1) IS NOT NULL THEN
    RAISE NOTICE '[grants-backfill] FOLLOWUP — % public table(s) have NO RLS enabled (review each): %',
      array_length(no_rls_tables, 1), no_rls_tables;
  END IF;

  IF array_length(rls_no_policy, 1) IS NOT NULL THEN
    RAISE NOTICE '[grants-backfill] FOLLOWUP — % RLS-enabled public table(s) have ZERO policies (queries return empty): %',
      array_length(rls_no_policy, 1), rls_no_policy;
  END IF;
END
$$;
