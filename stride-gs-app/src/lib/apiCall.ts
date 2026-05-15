/**
 * apiCall — backend-routing wrapper for GAS↔Supabase migration calls.
 *
 * Every site in the React app that has both a legacy GAS path AND a
 * new Supabase Edge Function path wraps the two with apiCall(). The
 * wrapper:
 *
 *   1. Resolves the active backend from `feature_flags.active_backend`
 *      (per-tenant scope applied — see FeatureFlagContext) and routes
 *      to either `gasFn` or `sbFn`. Falls back to `gasFn` if `sbFn` is
 *      missing or the flag isn't loaded yet — 'gas' is the safe pre-
 *      migration default.
 *   2. AWAITS the chosen primary so the caller gets a real return value.
 *   3. If `parity_enabled=true` AND the flag has a `shadow_backend`,
 *      fires the OPPOSITE function in the background via shadowRunner.
 *      Non-blocking — the primary result has already returned by the
 *      time the shadow kicks off.
 *
 * Project context: MIGRATION_STATUS.md decision MIG-001 (feature_flags
 * is the single source of routing truth) + MIG-007 (three-layer
 * verification — apiCall is the React-side gate).
 *
 * Usage:
 *
 *   const result = await apiCall(
 *     'completeTask',
 *     () => postCompleteTask(payload),                       // gas
 *     () => supabase.functions.invoke('complete-task-sb', { body: payload }),
 *     { tenantId: user.clientSheetId, inputSummary: `completeTask: ${payload.taskId}` },
 *   );
 *
 * Callers that don't yet have an SB implementation pass `undefined`
 * for sbFn; the wrapper routes to GAS unconditionally and skips the
 * shadow path.
 */
import {
  getFeatureFlagSnapshot,
  getActiveBackendForKey,
} from '../contexts/FeatureFlagContext';
import { runShadow } from './shadowRunner';

export interface ApiCallOptions {
  /** Caller's tenant (auth user's clientSheetId). Used by both the
   *  per-tenant scope resolver and the shadow row. Pass `null` for
   *  fleet-wide / admin code paths. */
  tenantId?: string | null;
  /** One-liner shown on the Settings → Migration recent-runs list.
   *  Should identify the entity being acted on (e.g. "completeTask:
   *  TASK-12345"). Bounded at 240 chars by the runner. */
  inputSummary?: string;
  /** Content-addressed hash of the input payload. Optional — the
   *  caller computes it if they have one; runShadow doesn't try to
   *  derive it from arbitrary fn closures. */
  inputHash?: string;
  /** Stable correlation id (e.g. dt_order id, task id, will-call
   *  number). UNIQUE (function_key, call_id) on parity_results so a
   *  duplicate kept-pressed-the-button doesn't double-count. */
  callId?: string;
}

/**
 * Route a migration call through the configured backend and (optionally)
 * fire a shadow against the other side.
 *
 * `gasFn` and `sbFn` are zero-arg thunks the caller closes over the
 * actual payload — apiCall doesn't introspect inputs. Both should
 * return the same shape on success; the shadowRunner hashes the JSON
 * serialization of each result to decide match/mismatch.
 *
 * If the resolved backend is 'supabase' but `sbFn` wasn't provided
 * (the SB implementation hasn't shipped yet), apiCall falls back to
 * `gasFn` so a premature flag flip doesn't 500 every caller. The
 * fallback is logged once per call so the operator can spot the gap.
 */
export async function apiCall<T>(
  key: string,
  gasFn: () => Promise<T>,
  sbFn?: () => Promise<T>,
  options?: ApiCallOptions,
): Promise<T> {
  const tenantId  = options?.tenantId ?? null;
  const snapshot  = getFeatureFlagSnapshot();
  const flag      = snapshot ? snapshot[key] : undefined;
  const resolved  = getActiveBackendForKey(key, tenantId);

  // Pick the primary. If SB is configured but no implementation is
  // wired up, fall through to GAS rather than throwing.
  const useSb = resolved === 'supabase' && typeof sbFn === 'function';
  if (resolved === 'supabase' && !sbFn) {
    console.warn(
      `[apiCall] flag "${key}" is active_backend=supabase but no sbFn ` +
      'was provided — falling back to GAS. Wire the SB callable on this ' +
      'callsite before flipping the flag.'
    );
  }

  // Run the primary; capture duration for the shadow row.
  const primaryStart = performance.now();
  const primaryFn: () => Promise<T> = useSb ? (sbFn as () => Promise<T>) : gasFn;
  const result = await primaryFn();
  const primaryDuration = Math.round(performance.now() - primaryStart);

  // Decide whether to fire a shadow. We only fire when:
  //   • parity is enabled on this flag, AND
  //   • a shadow_backend is configured, AND
  //   • the OPPOSITE-side callable was actually provided.
  //
  // The opposite of GAS is SB and vice versa. shadowRunner reads the
  // primary's hash from `gasResult` regardless of which side actually
  // ran — the column name is historical and means "the side that
  // shipped first" rather than "literally GAS".
  if (flag && flag.parity_enabled && flag.shadow_backend) {
    const shadowFn = useSb ? gasFn : sbFn;
    if (typeof shadowFn === 'function') {
      // Fire-and-forget. void the promise so an awaiter doesn't
      // accidentally block on the shadow path. runShadow never
      // rejects (it catches internally).
      void runShadow({
        key,
        gasResult:     result,
        gasDurationMs: primaryDuration,
        sbInvoke:      shadowFn,
        inputSummary:  options?.inputSummary,
        inputHash:     options?.inputHash,
        tenantId,
        callId:        options?.callId,
      });
    }
  }

  return result;
}
