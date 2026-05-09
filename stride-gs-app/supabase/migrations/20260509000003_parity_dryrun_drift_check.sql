-- 2026-05-09 — parity_dryrun.check_drift() drift-detection function.
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md, the
-- "parity_dryrun schema-sync convention" section. P1.3 created the
-- parity_dryrun.* mirrors of public.* tables; the convention says every
-- future migration that ALTERs a public.* mirror member MUST also ALTER
-- the corresponding parity_dryrun.* mirror or the replay harness
-- produces silent state-hash mismatches. Until now, that rule was
-- honor-system. This function makes drift detectable in one query.
--
-- Returns one row per drift. Empty result set = no drift.
--
-- Drift categories:
--   missing_in_dryrun  — column exists in public.X but not in parity_dryrun.X
--   missing_in_public  — column exists in parity_dryrun.X but not in public.X
--   type_mismatch      — column exists in both but data_type differs
--
-- Usage (manual):
--   SELECT * FROM parity_dryrun.check_drift();          -- every drift, every table
--   SELECT * FROM parity_dryrun.check_drift('billing'); -- one table only
--
-- Future: the P1.7 replay harness will invoke this on every run and
-- abort if drift is detected, so a forgotten ALTER doesn't silently
-- produce diverged state hashes. A CI step could also run it on every
-- PR that touches supabase/migrations/.
--
-- Mirror set (must stay in sync with stride-gs-app/MIGRATION_STATUS.md
-- "parity_dryrun schema-sync convention" — 14 tables as of P1.3):
--   inventory, tasks, repairs, shipments, will_calls, will_call_items,
--   billing, addons, invoice_tracking, entity_notes, item_photos,
--   clients, stax_invoices, stax_charges
--
-- Hardcoding the mirror set inside the function keeps it self-contained
-- and means a new mirror table not added here will surface as drift on
-- the next run (the function won't check it, so a forgotten check is
-- itself a kind of drift the operator should catch when they review
-- this function alongside their schema change).

CREATE OR REPLACE FUNCTION parity_dryrun.check_drift(p_table text DEFAULT NULL)
RETURNS TABLE (
  table_name        text,
  column_name       text,
  status            text,
  public_data_type  text,
  dryrun_data_type  text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mirror_set text[] := ARRAY[
    'inventory', 'tasks', 'repairs', 'shipments',
    'will_calls', 'will_call_items', 'billing', 'addons',
    'invoice_tracking', 'entity_notes', 'item_photos',
    'clients', 'stax_invoices', 'stax_charges'
  ];
  v_target_tables text[];
BEGIN
  IF p_table IS NULL THEN
    v_target_tables := v_mirror_set;
  ELSIF p_table = ANY(v_mirror_set) THEN
    v_target_tables := ARRAY[p_table];
  ELSE
    -- Caller asked about a non-mirror table. Return one synthetic row
    -- so the caller sees their typo / missing-from-mirror-set issue
    -- rather than silently empty result.
    RETURN QUERY SELECT
      p_table::text,
      '<table>'::text,
      'not_in_mirror_set'::text,
      NULL::text,
      NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
    WITH pub_cols AS (
      SELECT
        c.table_name,
        c.column_name,
        c.data_type
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = ANY(v_target_tables)
    ),
    dry_cols AS (
      SELECT
        c.table_name,
        c.column_name,
        c.data_type
      FROM information_schema.columns c
      WHERE c.table_schema = 'parity_dryrun'
        AND c.table_name = ANY(v_target_tables)
    )
    SELECT
      COALESCE(p.table_name, d.table_name)::text AS table_name,
      COALESCE(p.column_name, d.column_name)::text AS column_name,
      CASE
        WHEN d.column_name IS NULL THEN 'missing_in_dryrun'
        WHEN p.column_name IS NULL THEN 'missing_in_public'
        WHEN p.data_type <> d.data_type THEN 'type_mismatch'
      END::text AS status,
      p.data_type::text AS public_data_type,
      d.data_type::text AS dryrun_data_type
    FROM pub_cols p
    FULL OUTER JOIN dry_cols d
      ON p.table_name = d.table_name
     AND p.column_name = d.column_name
    WHERE
      d.column_name IS NULL
      OR p.column_name IS NULL
      OR p.data_type <> d.data_type
    ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION parity_dryrun.check_drift(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parity_dryrun.check_drift(text) TO service_role;

COMMENT ON FUNCTION parity_dryrun.check_drift(text) IS
  'Drift-detection for the parity_dryrun mirror set. Returns one row per '
  'column drift. Empty result = no drift. Mirror set is hardcoded; keep '
  'in sync with MIGRATION_STATUS.md "parity_dryrun schema-sync convention".';
