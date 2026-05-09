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
--   type_mismatch      — column exists in both but any of:
--                          data_type, character_maximum_length,
--                          numeric_precision, numeric_scale, is_nullable,
--                          column_default, is_generated, udt_name
--                        differs. Wider than v1 (which compared data_type
--                        only); covers the realistic failure modes for
--                        an ALTER COLUMN that public.* drifts away from
--                        parity_dryrun.*.
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
--
-- TODO (P1.7 follow-up): the mirror set is currently duplicated in
-- THREE places — this function, parity_dryrun.reset() (P1.3), and the
-- "parity_dryrun schema-sync convention" section in MIGRATION_STATUS.md.
-- A small `parity_dryrun.mirror_tables(table_name text PRIMARY KEY)`
-- reference table consumed by both functions would centralize the
-- list. Defer until P1.7's harness is the 4th consumer.

-- DROP first because the OUT column names changed from the original
-- attempt (data_type → signature). Postgres won't change return-type
-- shape via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS parity_dryrun.check_drift(text);

CREATE OR REPLACE FUNCTION parity_dryrun.check_drift(p_table text DEFAULT NULL)
RETURNS TABLE (
  table_name        text,
  column_name       text,
  status            text,
  public_signature  text,
  dryrun_signature  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
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

  -- Build a column-signature string per (schema, table, column) that
  -- captures every property an ALTER COLUMN could change. Drift is
  -- detected when the two signatures differ (or one is missing).
  RETURN QUERY
    WITH pub_cols AS (
      SELECT
        c.table_name,
        c.column_name,
        format(
          'data_type=%s|udt=%s|max_len=%s|num_prec=%s|num_scale=%s|nullable=%s|default=%s|generated=%s',
          c.data_type,
          c.udt_name,
          COALESCE(c.character_maximum_length::text, ''),
          COALESCE(c.numeric_precision::text, ''),
          COALESCE(c.numeric_scale::text, ''),
          c.is_nullable,
          COALESCE(c.column_default, ''),
          COALESCE(c.is_generated, '')
        ) AS sig
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = ANY(v_target_tables)
    ),
    dry_cols AS (
      SELECT
        c.table_name,
        c.column_name,
        format(
          'data_type=%s|udt=%s|max_len=%s|num_prec=%s|num_scale=%s|nullable=%s|default=%s|generated=%s',
          c.data_type,
          c.udt_name,
          COALESCE(c.character_maximum_length::text, ''),
          COALESCE(c.numeric_precision::text, ''),
          COALESCE(c.numeric_scale::text, ''),
          c.is_nullable,
          COALESCE(c.column_default, ''),
          COALESCE(c.is_generated, '')
        ) AS sig
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
        WHEN p.sig <> d.sig THEN 'type_mismatch'
      END::text AS status,
      p.sig::text AS public_signature,
      d.sig::text AS dryrun_signature
    FROM pub_cols p
    FULL OUTER JOIN dry_cols d
      ON p.table_name = d.table_name
     AND p.column_name = d.column_name
    WHERE
      d.column_name IS NULL
      OR p.column_name IS NULL
      OR p.sig <> d.sig
    ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION parity_dryrun.check_drift(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parity_dryrun.check_drift(text) TO service_role;

COMMENT ON FUNCTION parity_dryrun.check_drift(text) IS
  'Drift-detection for the parity_dryrun mirror set. Returns one row per '
  'column drift. Empty result = no drift. Mirror set is hardcoded; keep '
  'in sync with MIGRATION_STATUS.md "parity_dryrun schema-sync convention".';
