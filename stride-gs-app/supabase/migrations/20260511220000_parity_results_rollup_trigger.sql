-- 2026-05-11 — Rollup trigger: parity_results → feature_flags.mismatch_count_7d
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md. Implements the
-- last piece of P1.7's pipeline. When the replay-shadow Edge Function
-- inserts a row to public.parity_results, this trigger updates the
-- corresponding feature_flags row's:
--   - mismatch_count_7d: rolling 7-day count of match=false rows for this function_key
--   - last_parity_check: latest parity_results.created_at for this function_key
--
-- That makes the Settings → Migration tab's "Mismatches (7d)" and
-- "Last check" columns surface real data the moment the harness runs.
--
-- Performance note: re-counting last-7-days on every insert is O(N) per
-- insert. For our corpus today (~200 calls per function in 7 days) this
-- is negligible. If volume grows past ~10k results/day per function,
-- swap to an incremental delta + a daily reconciliation cron.

CREATE OR REPLACE FUNCTION public.rollup_parity_results_to_feature_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count_7d integer;
  v_last_at  timestamptz;
BEGIN
  -- Compute rolling 7-day mismatch count for this function_key.
  SELECT
    COUNT(*) FILTER (WHERE match = false),
    MAX(created_at)
  INTO v_count_7d, v_last_at
  FROM public.parity_results
  WHERE function_key = NEW.function_key
    AND created_at >= NOW() - interval '7 days';

  -- Update the matching feature_flags row. If no row exists for this
  -- function_key (shouldn't happen — seeded in P1.1 for the 25 known
  -- functions — but defensive), skip silently.
  UPDATE public.feature_flags
  SET
    mismatch_count_7d = COALESCE(v_count_7d, 0),
    last_parity_check = COALESCE(v_last_at, last_parity_check)
  WHERE function_key = NEW.function_key;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rollup_parity_results_to_feature_flags() IS
  'AFTER-INSERT trigger on parity_results. Rolls up mismatch_count_7d + last_parity_check into feature_flags for the same function_key. Drives the Settings → Migration tab dashboard.';

REVOKE ALL ON FUNCTION public.rollup_parity_results_to_feature_flags() FROM PUBLIC;

DROP TRIGGER IF EXISTS parity_results_rollup_to_feature_flags ON public.parity_results;
CREATE TRIGGER parity_results_rollup_to_feature_flags
  AFTER INSERT ON public.parity_results
  FOR EACH ROW
  EXECUTE FUNCTION public.rollup_parity_results_to_feature_flags();

-- Also bump our own function_key mapping: the call_log action
-- 'updateInventoryItem' maps to feature_flags.function_key='updateItem'.
-- The inventory only seeded 'updateItem' (P2 simple-writes group) per the
-- migration plan, so this is the row that needs to land. Re-seed defensively
-- in case the row was renamed.
INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES ('updateInventoryItem', 'gas', false, 'P2 — alias entry for the gas_call_log action name. Same handler as updateItem; harness writes parity_results under this key.')
ON CONFLICT (function_key) DO NOTHING;
