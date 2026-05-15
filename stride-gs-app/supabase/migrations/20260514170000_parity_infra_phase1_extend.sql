-- ============================================================
-- Stride GS App — Parity infrastructure: Phase 1 extensions
--
-- Builds on the existing parity substrate (migration_parity_substrate
-- v38.199.0) that shipped feature_flags + parity_results + gas_call_log
-- in PR #310. Justin's Phase 1 build spec adds the missing pieces:
--
--   • feature_flags.total_checks         int        — lifetime checks
--   • feature_flags.mismatch_count       int        — lifetime mismatches
--                                                     (complements the
--                                                     existing 7-day
--                                                     rolling counter)
--   • feature_flags.match_rate           numeric    — GENERATED column
--                                                     so dashboards never
--                                                     drift from the raw
--                                                     counters
--
--   • parity_results.input_summary       text       — human-readable
--                                                     summary alongside
--                                                     the existing
--                                                     content-addressed
--                                                     input_hash
--   • parity_results → feature_flags FK             — enforces that every
--                                                     parity row references
--                                                     a known function key
--                                                     (catches typos at the
--                                                     write site)
--   • parity_results in supabase_realtime publication
--                                                   — Settings → Migration
--                                                     tab live-tails new
--                                                     parity rows without
--                                                     a poll
--   • parity_results authenticated INSERT policy    — the React-side
--                                                     shadowRunner runs as
--                                                     the operator's JWT
--                                                     (admin/staff), so it
--                                                     needs a write path
--                                                     that doesn't go
--                                                     through service_role
--
-- Seeds the 4 function_keys from Justin's canonical 24-function list
-- that don't yet have rows (releaseWillCall, generateStorageCharges,
-- sendTaskCompleteEmail) plus the two backend overrides he called out
-- (updateShipment → supabase, generateStorageCharges → supabase). All
-- other existing rows (cancelRepair, processWcRelease, etc.) are
-- preserved as-is because production GAS already references those keys;
-- the new keys live alongside as canonical aliases for new code.
-- ============================================================

-- ── 1. feature_flags: lifetime counters + generated match_rate ─────────
ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS total_checks   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mismatch_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.feature_flags.total_checks IS
  'Lifetime count of parity_results rows produced for this function. '
  'Bumped by shadowRunner / parity-replay harness; persists across the '
  '7-day rolling window so the dashboard always has a denominator.';

COMMENT ON COLUMN public.feature_flags.mismatch_count IS
  'Lifetime count of parity_results.match=false rows for this function. '
  'Complements mismatch_count_7d which decays as old rows roll out of '
  'the recent window.';

-- Computed match rate so the Settings UI doesn't have to recompute it
-- (and so a future direct PATCH to total_checks / mismatch_count can
-- never produce an out-of-sync rate). Returns NULL when there are no
-- checks yet so the UI can distinguish "no data" from "100% matches".
ALTER TABLE public.feature_flags
  DROP COLUMN IF EXISTS match_rate;
ALTER TABLE public.feature_flags
  ADD COLUMN match_rate numeric(5,2)
    GENERATED ALWAYS AS (
      CASE WHEN total_checks > 0
        THEN ROUND(((total_checks - mismatch_count)::numeric / total_checks) * 100, 2)
        ELSE NULL
      END
    ) STORED;

COMMENT ON COLUMN public.feature_flags.match_rate IS
  'Generated: 100 * (total_checks - mismatch_count) / total_checks. '
  'NULL until total_checks > 0. Stored so dashboards can filter / sort '
  'on it without a CASE expression at read time.';

-- ── 2. parity_results: input_summary + FK + authenticated write + realtime ─
ALTER TABLE public.parity_results
  ADD COLUMN IF NOT EXISTS input_summary text;

COMMENT ON COLUMN public.parity_results.input_summary IS
  'Human-readable one-liner summary of the input payload (e.g. '
  '"completeTask: TASK-12345"). input_hash stays the canonical '
  'content-addressed identifier; input_summary is for the Migration '
  'UI to render a list of recent runs without decoding hashes.';

-- FK gate: every parity_results row must reference an existing flag
-- key. ON UPDATE CASCADE so a future rename (Justin's spec lists a
-- couple of canonical names that differ from prod, e.g. releaseWillCall
-- vs processWcRelease — when we collapse them we'll rename the PK).
-- ON DELETE preserved as default RESTRICT — never lose audit rows by
-- dropping the flag row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parity_results_function_key_fkey'
      AND conrelid = 'public.parity_results'::regclass
  ) THEN
    ALTER TABLE public.parity_results
      ADD CONSTRAINT parity_results_function_key_fkey
      FOREIGN KEY (function_key) REFERENCES public.feature_flags(function_key)
      ON UPDATE CASCADE;
  END IF;
END $$;

-- Authenticated insert policy. The shadowRunner runs in the React app
-- under the operator's JWT (admin/staff). Without this policy it can
-- only write through an edge function under service_role — extra
-- latency on the shadow path that we don't want on the hot path.
-- Reads stay restricted to staff/admin (existing parity_results_staff).
DROP POLICY IF EXISTS "parity_results_authenticated_insert" ON public.parity_results;
CREATE POLICY "parity_results_authenticated_insert"
  ON public.parity_results
  FOR INSERT TO authenticated
  WITH CHECK (
    ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'staff'))
  );

-- Realtime publication. feature_flags is already in supabase_realtime
-- (FeatureFlagContext relies on it); parity_results was not. With this
-- the Settings → Migration tab can subscribe and watch the mismatch
-- counters update live during a canary push.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'parity_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.parity_results;
  END IF;
END $$;

-- ── 3. Seed the missing function_keys from Justin's canonical 24 ────────
-- ON CONFLICT DO NOTHING — preserves any active_backend decision already
-- in production. The two explicit overrides (updateShipment +
-- generateStorageCharges → supabase) get a separate UPDATE below.
INSERT INTO public.feature_flags (function_key, active_backend) VALUES
  ('startTask',               'gas'),
  ('completeTask',            'gas'),
  ('startRepair',             'gas'),
  ('completeRepair',          'gas'),
  ('createWillCall',          'gas'),
  ('releaseWillCall',         'gas'),
  ('releaseItems',            'gas'),
  ('createInvoice',           'gas'),
  ('transferItems',           'gas'),
  ('updateItem',              'gas'),
  ('updateTask',              'gas'),
  ('updateRepair',            'gas'),
  ('updateShipment',          'supabase'),
  ('createTask',              'gas'),
  ('receiveShipment',         'gas'),
  ('onboardClient',           'gas'),
  ('generateStorageCharges',  'supabase'),
  ('sendShipmentEmail',       'gas'),
  ('sendTaskCompleteEmail',   'gas'),
  ('sendRepairEmails',        'gas'),
  ('sendWillCallEmails',      'gas'),
  ('qboCreateInvoice',        'gas'),
  ('createStaxInvoices',      'gas'),
  ('runStaxCharges',          'gas')
ON CONFLICT (function_key) DO NOTHING;

-- Explicit backend overrides Justin called out. Idempotent — if the row
-- already exists at the desired backend, the UPDATE is a no-op.
UPDATE public.feature_flags
   SET active_backend = 'supabase', updated_at = now()
 WHERE function_key IN ('updateShipment', 'generateStorageCharges')
   AND active_backend <> 'supabase';
