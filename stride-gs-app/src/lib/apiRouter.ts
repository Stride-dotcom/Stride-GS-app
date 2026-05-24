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
  updateInventoryItem: { ef: 'update-item-sb',         flagKey: 'updateItem' },
  // 2026-05-24 — React fires 4 distinct task-update actions
  // (updateTaskNotes / updateTaskPriority / updateTaskDueDate /
  // updateTaskCustomPrice); GAS handles each separately. The legacy
  // single `updateTask` entry mapped a NAME no React caller ever sends,
  // so flipping `feature_flags.updateTask` was a silent no-op.
  // update-task-sb is a UNIFIED handler that accepts any of the 4 field
  // shapes — map all 4 React action names to it.
  updateTaskNotes:       { ef: 'update-task-sb',       flagKey: 'updateTask' },
  updateTaskPriority:    { ef: 'update-task-sb',       flagKey: 'updateTask' },
  updateTaskDueDate:     { ef: 'update-task-sb',       flagKey: 'updateTask' },
  updateTaskCustomPrice: { ef: 'update-task-sb',       flagKey: 'updateTask' },
  updateRepairNotes:   { ef: 'update-repair-sb',       flagKey: 'updateRepair' },

  // P3 — operational
  batchCreateTasks:    { ef: 'batch-create-tasks-sb',  flagKey: 'createTask' },
  releaseItems:        { ef: 'release-items-sb',       flagKey: 'releaseItems' },
  createWillCall:      { ef: 'create-will-call-sb',    flagKey: 'createWillCall' },
  processWcRelease:    { ef: 'process-wc-release-sb',  flagKey: 'processWcRelease' },
  transferItems:       { ef: 'transfer-items-sb',      flagKey: 'transferItems' },

  // P3 — status changes. SB-primary EFs were built pre-router (each
  // wired via per-component branching). Adding them here makes the
  // routing layer aware so a future refactor onto apiPost is cheap;
  // for any call site STILL using direct `supabase.functions.invoke(...)`
  // the entry is a no-op (the router only fires on `apiPost`).
  startTask:           { ef: 'start-task',             flagKey: 'startTask' },
  startRepair:         { ef: 'start-repair-sb',        flagKey: 'startRepair' },
  cancelRepair:        { ef: 'cancel-repair-sb',       flagKey: 'cancelRepair' },
  sendRepairQuote:     { ef: 'send-repair-quote-sb',   flagKey: 'sendRepairQuote' },
  respondToRepairQuote:{ ef: 'respond-repair-quote-sb',flagKey: 'respondRepairQuote' },
  requestRepairQuote:  { ef: 'request-repair-quote-sb',flagKey: 'requestRepairQuote' },

  // P3 — receiving / completion (new in this PR)
  completeShipment:    { ef: 'complete-shipment-sb',   flagKey: 'receiveShipment' },

  // P4a — billing-core
  completeTask:        { ef: 'complete-task',          flagKey: 'completeTask' },
  completeRepair:      { ef: 'complete-repair-sb',     flagKey: 'completeRepair' },
  // 2026-05-24 — React fires BOTH `generateStorageCharges` (preview) and
  // `commitStorageRows` (commit) — and commit-storage-charges-sb's source
  // explicitly documents handling both. Without the commit route entry,
  // flipping commitStorageCharges='supabase' only redirected the preview
  // path; the actual write stayed on GAS.
  generateStorageCharges: { ef: 'commit-storage-charges-sb', flagKey: 'commitStorageCharges' },
  commitStorageRows:      { ef: 'commit-storage-charges-sb', flagKey: 'commitStorageCharges' },
  createInvoice:       { ef: 'create-invoice-sb',      flagKey: 'createInvoice' },
  voidInvoice:         { ef: 'void-invoice-sb',        flagKey: 'voidInvoice' },
  reissueInvoice:      { ef: 'reissue-invoice-sb',     flagKey: 'reissueInvoice' },

  // P5 — onboarding. Sheet provisioning STAYS GAS (Apps Script-only API
  // for Sheets duplication); onboard-client-sb proxies the
  // sheet-creation step back to GAS and writes the SB row(s) itself.
  // Documented as a hybrid path on the EF.
  onboardClient:       { ef: 'onboard-client-sb',      flagKey: 'onboardClient' },

  // P6 — payments
  qboCreateInvoice:    { ef: 'qbo-create-invoice-sb',  flagKey: 'qboCreateInvoice' },
  createStaxInvoices:  { ef: 'create-stax-invoices-sb',flagKey: 'createStaxInvoices' },
  runStaxCharges:      { ef: 'run-stax-charges-sb',    flagKey: 'runStaxCharges' },
  importIIF:           { ef: 'import-iif-sb',          flagKey: 'importIIF' },

  // P3 — email handlers (thin wrappers around send-email EF).
  // Most current live traffic fires emails as server-side side-effects
  // from host handlers; the entries below cover the apiPost path used
  // by SB-primary host handlers and ad-hoc resend buttons.
  sendShipmentEmail:    { ef: 'send-shipment-email-sb',      flagKey: 'sendShipmentEmail' },
  sendTaskCompleteEmail:{ ef: 'send-task-complete-email-sb', flagKey: 'sendTaskCompleteEmail' },
  sendWillCallEmails:   { ef: 'send-will-call-emails-sb',    flagKey: 'sendWillCallEmails' },

  // Reports (read-only)
  generateUnbilledReport: { ef: 'generate-unbilled-report-sb', flagKey: 'generateUnbilledReport' },

  // High-traffic batch — top untracked action in gas_call_log (52 calls/7d)
  batchUpdateItemLocations: { ef: 'batch-update-item-locations-sb', flagKey: 'batchUpdateItemLocations' },

  // Task lifecycle — cancel + reopen + bulk cancel
  // (updateTaskNotes / updateTaskPriority / updateTaskDueDate /
  //  updateTaskCustomPrice are already mapped above to update-task-sb under
  //  flagKey 'updateTask' — see PR #519. The 4 per-action feature_flag rows
  //  this PR seeded are idle (unused by the router) and harmless.)
  cancelTask:        { ef: 'cancel-task-sb',         flagKey: 'cancelTask' },
  reopenTask:        { ef: 'reopen-task-sb',         flagKey: 'reopenTask' },
  batchCancelTasks:  { ef: 'batch-cancel-tasks-sb',  flagKey: 'batchCancelTasks' },
  batchCancelRepairs:{ ef: 'batch-cancel-repairs-sb',flagKey: 'batchCancelRepairs' },

  // Will Call lifecycle (single-WC)
  updateWillCall:           { ef: 'update-will-call-sb',           flagKey: 'updateWillCall' },
  cancelWillCall:           { ef: 'cancel-will-call-sb',           flagKey: 'cancelWillCall' },
  addItemsToWillCall:       { ef: 'add-items-to-will-call-sb',     flagKey: 'addItemsToWillCall' },
  removeItemsFromWillCall:  { ef: 'remove-items-from-will-call-sb',flagKey: 'removeItemsFromWillCall' },

  // Locations (warehouse-global) and Clients
  createLocation:    { ef: 'create-location-sb', flagKey: 'createLocation' },
  updateClient:      { ef: 'update-client-sb',   flagKey: 'updateClient' },

  // Billing-light handlers (no invoice manipulation — those stay on
  // create-invoice-sb / void-invoice-sb / reissue-invoice-sb).
  syncClientBilling: { ef: 'sync-client-billing-sb', flagKey: 'syncClientBilling' },
  addManualCharge:   { ef: 'add-manual-charge-sb',   flagKey: 'addManualCharge' },
  voidManualCharge:  { ef: 'void-manual-charge-sb',  flagKey: 'voidManualCharge' },
  updateBillingRow:  { ef: 'update-billing-row-sb',  flagKey: 'updateBillingRow' },
  voidUnbilledRows:  { ef: 'void-unbilled-rows-sb',  flagKey: 'voidUnbilledRows' },

  // Still gas-only — no SB-primary EF in this PR:
  //   updateShipment:       updateShipment flag, no update-shipment-sb EF
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
