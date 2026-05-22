/**
 * apiRouter — GAS→Supabase routing layer for apiPost.
 *
 * Consulted by `apiPost` (src/lib/api.ts) before every write. Resolves a
 * GAS action name to either:
 *   • the existing GAS web-app endpoint (default), OR
 *   • a Supabase Edge Function (when `feature_flags.<key>.active_backend`
 *     resolves to 'supabase' for the caller's tenant).
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *   - MIG-007  three-layer verification (per-call diff → 90d replay → canary)
 *   - MIG-010  per-tenant scope semantics for feature_flags
 *   - MIG-013  live-shadow firing in apiPost (audit-shape parity)
 *   - MIG-015  Justin Demo Account canary override of MIG-007 (this session)
 *
 * ── Why this is a sibling module, not inline in api.ts ─────────────────
 * api.ts is 5,400+ lines. The router needs (1) a static map every team
 * member can scan for routing coverage, (2) the SB-path wrapper that
 * builds the same ApiResponse<T> shape callers expect, (3) the EF-error
 * normalization. Pulling these into a sibling keeps api.ts readable +
 * makes the routing surface grep-able from one place.
 *
 * ── Routing rule (read carefully) ─────────────────────────────────────
 *  1. Look up the action in GAS_TO_SB_MAP. If absent, route GAS.
 *  2. Resolve `feature_flags.<flagKey>` against the caller's tenant via
 *     FeatureFlagContext.getActiveBackendForKey — module-level snapshot
 *     so this works outside React.
 *  3. backend === 'supabase' AND map has an ef → SB Edge Function.
 *     backend === 'gas'  OR  no SB ef registered → GAS web-app.
 *
 * ── Error handling (intentional) ──────────────────────────────────────
 * On SB-path error: surface the error to the caller. DO NOT silently
 * fall back to GAS — that would mask bugs in the SB handler and produce
 * confusing dual-write behavior. The flag flip is the operator's choice;
 * if the SB handler is broken, they revert the flag.
 *
 * ── fireShadow interaction ────────────────────────────────────────────
 * apiPost fires the shadow ONLY on the GAS path (the shadow's job is
 * audit-shape parity vs. the live GAS write; with the SB handler IS the
 * canonical path, there's nothing to shadow). The SB path therefore
 * skips fireShadow.
 */

import { supabase } from './supabase';
import { getActiveBackendForKey } from '../contexts/FeatureFlagContext';
import { getCallerEmail } from './api';
import type { ApiResponse } from './api';

// ── Map: GAS action name → SB Edge Function slug + feature_flag key ─────
//
// `flagKey` is the value used in `feature_flags.function_key` AND in
// `parity_results.function_key`. It usually matches the GAS action name
// minus any prefix (`updateInventoryItem` → `updateItem`); see
// FUNCTION_INVENTORY.md and the seed in
// supabase/migrations/20260509000001_migration_parity_substrate.sql.
//
// `ef` is the Supabase Edge Function slug (kebab-case, '-sb' suffix for
// SB-primary handlers per the established naming convention).
//
// ── Entries below ───────────────────────────────────────────────────────
// Add an entry ONLY when its real SB-primary EF is deployed AND the
// feature_flag row exists in public.feature_flags. An entry without a
// deployed EF would route the SB path into 404 on flag flip; an entry
// without a feature_flag row would resolve to 'gas' fallback silently —
// but new SB EFs would have nowhere to be tested. Both are bugs, this
// table is the place to grep for them.
export interface RouteEntry {
  ef: string;
  flagKey: string;
}

export const GAS_TO_SB_MAP: Record<string, RouteEntry> = {
  // P2 — simple writes
  updateInventoryItem: { ef: 'update-item-sb', flagKey: 'updateItem' },

  // The following actions have flag rows seeded (parity-on shadow handlers
  // exist) but NO SB-primary EF deployed yet. Adding them here would
  // route flag-flips to 404. Build their real -sb EF first, then add
  // here in the same PR as the deploy.
  //
  //   updateTask:           updateTask flag, no update-task-sb EF yet
  //   updateRepair:         updateRepair flag, no update-repair-sb EF yet
  //   updateShipment:       updateShipment flag, no update-shipment-sb EF
  //   startTask:            startTask flag, no start-task-sb EF
  //   startRepair:          startRepair flag, no start-repair-sb EF
  //   createBatchTasks:     createTask flag, no create-task-sb EF
  //   createWillCall:       createWillCall flag, no create-will-call-sb EF
  //   releaseItems:         releaseItems flag, no release-items-sb EF
  //   transferItems:        transferItems flag, no transfer-items-sb EF
  //   completeTask:         completeTask flag, no complete-task-sb EF
  //   completeRepair:       completeRepair flag, no complete-repair-sb EF
  //                         (handler exists in worktree, not yet merged)
  //   processWcRelease:     processWcRelease flag
  //   commitStorageCharges: commitStorageCharges flag
  //   createInvoice:        createInvoice flag
  //   voidInvoice:          voidInvoice flag
  //   reissueInvoice:       reissueInvoice flag
  //   receiveShipment:      receiveShipment flag
  //   onboardClient:        onboardClient flag
  //   qboCreateInvoice:     qboCreateInvoice flag
  //   createStaxInvoices:   createStaxInvoices flag
  //   runStaxCharges:       runStaxCharges flag
  //   sendShipmentEmail:    sendShipmentEmail flag
  //   sendWillCallEmails:   sendWillCallEmails flag
};

/**
 * Resolve a GAS action to its route. Returns null if the action has no
 * routing entry (callers should route to GAS in that case).
 *
 * Pure — safe to call from anywhere. Uses the module-level flag snapshot
 * from FeatureFlagContext so it does NOT need to be inside a React tree.
 */
export function resolveRoute(
  action: string,
  callerTenantId: string | null,
): { backend: 'gas' } | { backend: 'supabase'; ef: string; flagKey: string } {
  const entry = GAS_TO_SB_MAP[action];
  if (!entry) return { backend: 'gas' };

  const backend = getActiveBackendForKey(entry.flagKey, callerTenantId);
  if (backend !== 'supabase') return { backend: 'gas' };

  return { backend: 'supabase', ef: entry.ef, flagKey: entry.flagKey };
}

// ── Supabase-path invoke ────────────────────────────────────────────────

/**
 * Invoke the SB Edge Function with the same payload + extras the GAS
 * path would receive, normalize the response into ApiResponse<T>.
 *
 * The EF is expected to return the same JSON body GAS returned for this
 * action (e.g. { success: true, itemId, updated, … } for updateItem) so
 * downstream callers — typed via apiPost<T>'s generic — work unchanged.
 *
 * EF-error normalization:
 *   • supabase.functions.invoke returns {data, error}. `error` is set on
 *     transport / 5xx / non-2xx HTTP — surface that as `ApiResponse.error`.
 *   • The EF body itself may also carry `{error: "..."}` — surface that
 *     too. Same shape GAS uses for handler-level errors.
 *
 * Auth: supabase-js v2 attaches the current session JWT automatically
 * when verify_jwt=true on the EF (the default for all our SB-primary
 * handlers). Anonymous sessions get the anon key, which the EF can
 * reject via `auth.uid()` checks if needed.
 *
 * Timeout: supabase-js doesn't expose an abort signal here as of v2.50;
 * Edge Functions have a hard 60s cap (Supabase platform limit) so the
 * effective timeout is platform-side. If we add tenant-side timeouts in
 * the future, plumb AbortSignal here via the request `signal` option
 * once supabase-js supports it.
 */
export async function invokeSupabaseHandler<T>(
  ef: string,
  body: Record<string, unknown>,
  extraParams: Record<string, string> | undefined,
  requestId: string,
): Promise<ApiResponse<T> & { requestId: string }> {
  // Thread callerEmail + clientSheetId into the body. GAS receives them
  // as query params; SB EFs receive them in the body for symmetry with
  // the rest of the SB-side codebase.
  const callerEmail = getCallerEmail();
  const efBody: Record<string, unknown> = {
    ...body,
    requestId,
    ...(callerEmail ? { callerEmail } : {}),
    ...(extraParams?.clientSheetId ? { tenantId: extraParams.clientSheetId } : {}),
  };

  let data: unknown;
  let error: { message?: string; name?: string } | null = null;
  try {
    const r = await supabase.functions.invoke<unknown>(ef, { body: efBody });
    data = r.data;
    error = r.error as { message?: string } | null;
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : String(err),
      ok: false,
      requestId,
    };
  }

  if (error) {
    return {
      data: null,
      error: error.message || `Edge Function ${ef} failed`,
      ok: false,
      requestId,
    };
  }

  // EF body shape: either { success: true, ... } / { ...payload } OR
  // { error: "..." }. Surface body-level error the same way GAS does.
  if (data && typeof data === 'object' && 'error' in data) {
    const errMsg = (data as { error?: unknown }).error;
    if (errMsg) {
      return { data: null, error: String(errMsg), ok: false, requestId };
    }
  }

  return { data: data as T, ok: true, error: null, requestId };
}
