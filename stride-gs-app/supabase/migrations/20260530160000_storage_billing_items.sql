-- 2026-05-30 — storage_billing_items: durable per-item storage-billing ledger.
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md (P4a billing core).
--
-- WHY THIS TABLE EXISTS
-- Storage charges are summarized to ONE ledger line per sidemark at commit
-- time (StrideAPI handleCommitStorageRows_, v38.239.0 + v38.250.0) so the
-- customer-facing invoice, Consolidated_Ledger, client Billing_Ledger sheet,
-- and public.billing each carry a single "Monthly Storage" line instead of N
-- per-item rows. That collapse is correct for the invoice but it ERASES the
-- per-item record of which items were billed — so there was no authoritative
-- way to answer "was item X's storage for May billed?" and the only dedup
-- guard was the coarse per-(tenant,sidemark,window) finalized-summary gate.
--
-- This table is the per-item source of truth that survives the summarization:
--   * Captured at commit time (a snapshot — immune to later inventory edits).
--   * Linked to the summary line via summary_ledger_row_id.
--   * status mirrors the summary's lifecycle: Unbilled → Invoiced → Void.
--   * The partial-unique index is the hard double-bill guard: an item cannot
--     have two non-Void rows for the same (tenant, item, period).
--
-- READ/WRITE MODEL
--   * Written by GAS (handleCommitStorageRows_ insert + dedup;
--     handleCreateInvoice_ / handleVoidInvoice_ stamp invoice_no/status)
--     via the service_role REST path while billing stays GAS-authoritative.
--   * Read by the React app (authenticated) for the "storage detail" view and
--     the "billed?" audit query — hence RLS mirroring public.billing.
--
-- parity_dryrun MIRROR (mandatory per MIGRATION_STATUS.md "parity_dryrun
-- schema-sync convention"): commitStorageCharges is a migrating P4a handler,
-- so its shadow may write this table. The mirror + reset()/row_counts/
-- check_drift() updates below keep the replay harness drift-free.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) public.storage_billing_items
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storage_billing_items (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              text        NOT NULL,
  sidemark               text        NOT NULL DEFAULT '',
  item_id                text        NOT NULL,
  description            text,
  period_start           date        NOT NULL,
  period_end             date        NOT NULL,
  billable_days          integer,
  rate                   numeric,
  amount                 numeric     NOT NULL DEFAULT 0,
  -- The deterministic STOR-SUMMARY ledger row id this per-item charge rolls
  -- into: STOR-SUMMARY-<tenant>[-<SIDEMARKSLUG>]-<YYYYMMDD>-<YYYYMMDD>.
  summary_ledger_row_id  text        NOT NULL,
  -- Unbilled → Invoiced (when the summary is invoiced) → Void (when voided,
  -- which frees the item to be re-billed). Mirrors the summary line's status.
  status                 text        NOT NULL DEFAULT 'Unbilled',
  invoice_no             text,
  invoice_date           date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.storage_billing_items IS
  'Per-item storage-billing ledger. One row per item per billing window, '
  'captured at commit time, rolled up into a single summary line on the '
  'invoice/Consolidated_Ledger/billing. Authoritative for storage dedup + '
  '"was this item billed?" audit. See MIGRATION_STATUS.md (P4a).';

-- Dedup lookup: "is item X already billed (non-Void) for a window overlapping
-- [start,end]?" — the query handleCommitStorageRows_ runs before inserting.
CREATE INDEX IF NOT EXISTS idx_sbi_dedup
  ON public.storage_billing_items (tenant_id, item_id, period_start, period_end);

-- Stamp-by-summary: handleCreateInvoice_/handleVoidInvoice_ update every item
-- sharing a summary_ledger_row_id when that summary is invoiced/voided.
CREATE INDEX IF NOT EXISTS idx_sbi_summary
  ON public.storage_billing_items (summary_ledger_row_id);

-- Reporting / "billed?" audit by tenant + status.
CREATE INDEX IF NOT EXISTS idx_sbi_tenant_status
  ON public.storage_billing_items (tenant_id, status);

-- INTEGRITY GUARD (not a PostgREST upsert target — it's partial). The table can
-- never physically hold two ACTIVE (non-Void) charges for the same (tenant,
-- item, period). The GAS commit path makes the normal flow conflict-free: it
-- deletes the Unbilled working set for the window first AND skips items already
-- finalized for an overlapping window, so it never re-inserts a colliding row.
-- The only way to hit this index is a concurrent double-commit of the same
-- window or a logic bug; in that case the duplicate INSERT is rejected (409)
-- and the EXISTING row stands — the idempotent, correct outcome (the customer
-- is never double-billed because the customer-facing guard is the sheet
-- summary + the per-item dedup skip, not this table). supabaseBatchUpsert_
-- logs the 409 per-row; it does NOT upsert here (storage_billing_items is
-- intentionally absent from its on_conflict map — a partial index cannot be a
-- clean ON CONFLICT target, and a full unique index would block the
-- legitimate re-bill-after-void path below). Void rows are excluded from the
-- index so a voided charge can be cleanly re-billed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sbi_active_item_period
  ON public.storage_billing_items (tenant_id, item_id, period_start, period_end)
  WHERE status <> 'Void';

-- keep updated_at fresh on UPDATE
CREATE OR REPLACE FUNCTION public.tg_storage_billing_items_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sbi_touch ON public.storage_billing_items;
CREATE TRIGGER trg_sbi_touch
  BEFORE UPDATE ON public.storage_billing_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_storage_billing_items_touch();

-- RLS — mirrors public.billing exactly.
ALTER TABLE public.storage_billing_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sbi_select_client  ON public.storage_billing_items;
DROP POLICY IF EXISTS sbi_select_staff   ON public.storage_billing_items;
DROP POLICY IF EXISTS sbi_service_all    ON public.storage_billing_items;

CREATE POLICY sbi_select_client ON public.storage_billing_items
  FOR SELECT TO authenticated
  USING (user_has_tenant_access(tenant_id));

CREATE POLICY sbi_select_staff ON public.storage_billing_items
  FOR SELECT TO authenticated
  USING ((((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff'])));

CREATE POLICY sbi_service_all ON public.storage_billing_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.storage_billing_items TO authenticated;
GRANT ALL    ON public.storage_billing_items TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) parity_dryrun mirror (schema-sync convention)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parity_dryrun.storage_billing_items
  (LIKE public.storage_billing_items INCLUDING DEFAULTS);

GRANT ALL ON parity_dryrun.storage_billing_items TO service_role;

-- reset(): add the new mirror to the truncate set.
CREATE OR REPLACE FUNCTION parity_dryrun.reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE TABLE
    parity_dryrun.inventory,
    parity_dryrun.tasks,
    parity_dryrun.repairs,
    parity_dryrun.shipments,
    parity_dryrun.will_calls,
    parity_dryrun.will_call_items,
    parity_dryrun.billing,
    parity_dryrun.addons,
    parity_dryrun.invoice_tracking,
    parity_dryrun.entity_notes,
    parity_dryrun.item_photos,
    parity_dryrun.clients,
    parity_dryrun.stax_invoices,
    parity_dryrun.stax_charges,
    parity_dryrun.storage_billing_items
  RESTART IDENTITY;
END;
$$;
REVOKE ALL ON FUNCTION parity_dryrun.reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parity_dryrun.reset() TO service_role;

-- row_counts: add the new mirror to the diagnostics view.
CREATE OR REPLACE VIEW parity_dryrun.row_counts AS
  SELECT 'inventory'        AS table_name, (SELECT COUNT(*) FROM parity_dryrun.inventory)        AS row_count
  UNION ALL SELECT 'tasks',                  (SELECT COUNT(*) FROM parity_dryrun.tasks)
  UNION ALL SELECT 'repairs',                (SELECT COUNT(*) FROM parity_dryrun.repairs)
  UNION ALL SELECT 'shipments',              (SELECT COUNT(*) FROM parity_dryrun.shipments)
  UNION ALL SELECT 'will_calls',             (SELECT COUNT(*) FROM parity_dryrun.will_calls)
  UNION ALL SELECT 'will_call_items',        (SELECT COUNT(*) FROM parity_dryrun.will_call_items)
  UNION ALL SELECT 'billing',                (SELECT COUNT(*) FROM parity_dryrun.billing)
  UNION ALL SELECT 'addons',                 (SELECT COUNT(*) FROM parity_dryrun.addons)
  UNION ALL SELECT 'invoice_tracking',       (SELECT COUNT(*) FROM parity_dryrun.invoice_tracking)
  UNION ALL SELECT 'entity_notes',           (SELECT COUNT(*) FROM parity_dryrun.entity_notes)
  UNION ALL SELECT 'item_photos',            (SELECT COUNT(*) FROM parity_dryrun.item_photos)
  UNION ALL SELECT 'clients',                (SELECT COUNT(*) FROM parity_dryrun.clients)
  UNION ALL SELECT 'stax_invoices',          (SELECT COUNT(*) FROM parity_dryrun.stax_invoices)
  UNION ALL SELECT 'stax_charges',           (SELECT COUNT(*) FROM parity_dryrun.stax_charges)
  UNION ALL SELECT 'storage_billing_items',  (SELECT COUNT(*) FROM parity_dryrun.storage_billing_items);
GRANT SELECT ON parity_dryrun.row_counts TO service_role;

-- check_drift(): add 'storage_billing_items' to the hardcoded mirror set so
-- future ALTERs on either side are caught. (CREATE OR REPLACE keeps the same
-- return shape, so no DROP needed.)
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
    'clients', 'stax_invoices', 'stax_charges',
    'storage_billing_items'
  ];
  v_target_tables text[];
BEGIN
  IF p_table IS NULL THEN
    v_target_tables := v_mirror_set;
  ELSIF p_table = ANY(v_mirror_set) THEN
    v_target_tables := ARRAY[p_table];
  ELSE
    RETURN QUERY SELECT
      p_table::text, '<table>'::text, 'not_in_mirror_set'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
    WITH pub_cols AS (
      SELECT
        c.table_name,
        c.column_name,
        format(
          'data_type=%s|udt=%s|max_len=%s|num_prec=%s|num_scale=%s|nullable=%s|default=%s|generated=%s',
          c.data_type, c.udt_name,
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
          c.data_type, c.udt_name,
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

-- Verify mirror is drift-free for the new table (should be silent).
DO $$
DECLARE drift_count int;
BEGIN
  SELECT COUNT(*) INTO drift_count FROM parity_dryrun.check_drift('storage_billing_items');
  IF drift_count > 0 THEN
    RAISE NOTICE 'parity_dryrun drift on storage_billing_items after migration: % rows', drift_count;
  END IF;
END$$;
