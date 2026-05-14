-- Lock the door: CASCADE FK from repair_items → repairs
-- =======================================================
-- On 2026-05-14 we found 15 orphan repair_items rows for Seva Home
-- (tenant_id 1_E5xG0PZR8pGxxFVudrRDLU8NyLYDIXkG4rbPcBfj0s) — parent
-- public.repairs rows had been manually deleted during PR #397
-- (multi-item repair) testing on 2026-05-13, but the child rows in
-- public.repair_items survived because the join columns
-- (tenant_id, repair_id) were never bound by a foreign key.
-- The 9 ghost orphans were deleted; one (RPR-63280-1778715634749)
-- had its parent restored. This migration prevents a repeat.
--
-- Pre-conditions expected (per the cleanup operator + tracked schema
-- — NOT live-checked at authoring time; the runtime guards below
-- enforce them at apply time):
--   • Zero orphan repair_items rows remain (manual cleanup today).
--   • repair_items has zero existing FK constraints.
--   • public.repairs uses a uuid `id` as its primary key — there is
--     no UNIQUE/PK covering (tenant_id, repair_id) in the tracked
--     migration history, so this migration adds one defensively
--     (idempotent — skipped if a matching constraint already exists).
--     Note: Guard 2 inspects pg_constraint only, not bare unique
--     indexes (`CREATE UNIQUE INDEX` without a backing constraint).
--     This is correct — Postgres requires a UNIQUE/PK *constraint*
--     to satisfy an FK reference; a bare unique index won't.
--
-- Why ON DELETE CASCADE (not RESTRICT):
--   Repair items have no meaning without their parent repair. The
--   parent owns the lifecycle; children should never outlive it.
--   This mirrors the will_call_items relationship to will_calls.

-- ── Guard 1: assert zero orphans ──────────────────────────────────────
-- A clearer error than "violates foreign key constraint" if cleanup
-- regressed between authoring and apply. Re-running after a true
-- cleanup is safe — this query is read-only.
DO $$
DECLARE
  v_orphan_count int;
BEGIN
  SELECT COUNT(*) INTO v_orphan_count
  FROM public.repair_items ri
  LEFT JOIN public.repairs r
    ON r.tenant_id = ri.tenant_id
   AND r.repair_id = ri.repair_id
  WHERE r.repair_id IS NULL;

  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add repair_items_parent_fk: % orphan repair_items row(s) found. Clean up (delete orphans or restore parent repairs rows) before running this migration.',
      v_orphan_count;
  END IF;
END $$;

-- ── Guard 2: ensure repairs has UNIQUE (tenant_id, repair_id) ─────────
-- The FK needs a matching unique/PK on its referenced columns. Idempotent
-- via pg_constraint introspection — skipped if any UNIQUE or PRIMARY KEY
-- already covers exactly those two columns (regardless of constraint name
-- or column order).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class      t ON c.conrelid     = t.oid
    JOIN pg_namespace  n ON n.oid          = t.relnamespace
    JOIN LATERAL (
      -- Cast attname (pg_catalog `name`) to text so the array compare
      -- below resolves — Postgres has no implicit name[] = text[]
      -- operator. Without the cast Guard 2 raises 42883 at apply time.
      SELECT array_agg(a.attname::text ORDER BY a.attname::text) AS cols
      FROM unnest(c.conkey) AS u(num)
      JOIN pg_attribute a
        ON a.attrelid = t.oid AND a.attnum = u.num
    ) k ON TRUE
    WHERE n.nspname  = 'public'
      AND t.relname  = 'repairs'
      AND c.contype IN ('p', 'u')
      AND k.cols     = ARRAY['repair_id', 'tenant_id']::text[]  -- alphabetical
  ) THEN
    ALTER TABLE public.repairs
      ADD CONSTRAINT repairs_tenant_repair_unique
        UNIQUE (tenant_id, repair_id);
  END IF;
END $$;

-- ── Add the CASCADE FK ────────────────────────────────────────────────
-- Wrapped in a DO block for idempotency parity with the guards above —
-- Supabase's apply_migration dedupes by version so this won't bite the
-- normal path, but a manual `psql -f` replay or wiped migrations table
-- would otherwise fail with "constraint already exists".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname  = 'repair_items_parent_fk'
      AND conrelid = 'public.repair_items'::regclass
  ) THEN
    ALTER TABLE public.repair_items
      ADD CONSTRAINT repair_items_parent_fk
        FOREIGN KEY (tenant_id, repair_id)
        REFERENCES   public.repairs (tenant_id, repair_id)
        ON DELETE CASCADE;

    COMMENT ON CONSTRAINT repair_items_parent_fk ON public.repair_items IS
      'CASCADE FK to public.repairs — prevents orphan child rows. Added '
      '2026-05-14 after orphan-cleanup incident traced to manual parent '
      'deletion during PR #397 multi-item repair testing.';
  END IF;
END $$;
