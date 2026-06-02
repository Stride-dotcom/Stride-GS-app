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
  /**
   * If true, the original GAS action name is injected into the body as
   * `action` before forwarding to the EF. Set for GROUPED EFs that
   * dispatch on the action field (e.g. marketing-actions-sb,
   * stax-actions-sb). Single-action EFs leave this unset.
   */
  grouped?: boolean;
}

// Grouped EFs that handle multiple actions via internal dispatch. Each
// listed action maps to the same EF; `grouped: true` makes the router
// inject the original action name into the body so the EF can route.
//
// The grouped layout keeps the migration tractable — for a handler whose
// SB-side work is identical (proxy to GAS or trivial DB CRUD), bundling
// avoids 18 separate one-line EFs. When a future builder rewrites a
// specific action natively, they can split it out into its own -sb EF
// and update only the affected map entry; downstream call sites are
// unchanged because the GAS_TO_SB_MAP key — not the EF name — is the
// stable interface.
const GROUPED_MARKETING_ACTIONS = [
  'createMarketingCampaign', 'updateMarketingCampaign', 'activateCampaign',
  'pauseCampaign', 'completeCampaign', 'runCampaignNow', 'deleteCampaign',
  'createMarketingContact', 'importMarketingContacts', 'updateMarketingContact',
  'suppressContact', 'unsuppressContact', 'createMarketingTemplate',
  'updateMarketingTemplate', 'updateMarketingSettings', 'sendTestEmail',
  'previewTemplate', 'checkMarketingInbox',
] as const;

const GROUPED_CLAIM_ACTIONS = [
  'createClaim', 'addClaimItems', 'addClaimNote', 'requestMoreInfo',
  'sendClaimDenial', 'generateClaimSettlement', 'uploadSignedSettlement',
  'closeClaim', 'voidClaim', 'reopenClaim', 'firstReviewClaim', 'updateClaim',
] as const;

const GROUPED_STAX_ACTIONS = [
  'importIIFFromDrive', 'updateStaxConfig', 'saveStaxCustomerMapping',
  'autoMatchStaxCustomers', 'pullStaxCustomers', 'syncStaxCustomers',
  'createTestInvoice', 'updateStaxInvoice', 'deleteStaxInvoice',
  'staxRefreshCustomerIds', 'staxRefreshPaymentStatus', 'chargeSingleInvoice',
  'sendStaxPayLinks', 'sendStaxPayLink', 'voidStaxInvoice',
  'toggleAutoCharge', 'resetStaxInvoiceStatus', 'resolveStaxException',
  'batchVoidStaxInvoices', 'batchDeleteStaxInvoices', 'regenerateIifForBatch',
] as const;

const GROUPED_QB_ACTIONS = [
  'qbExport', 'qbExcelExport', 'qboDisconnect', 'qboSetupHeaders',
  'qboSyncCatalogItem', 'updateQboStatus', 'backfillDocsFromDrive',
] as const;

const GROUPED_REPAIR_EXTRAS = [
  'correctRepairResult', 'reopenRepair', 'voidRepairQuote',
] as const;

const GROUPED_WC_EXTRAS = [
  'generateWcDoc', 'batchCancelWillCalls', 'batchScheduleWillCalls',
] as const;

const GROUPED_TASK_BATCH_OPS = [
  'batchReassignTasks', 'batchRequestRepairQuote', 'createSplitTask',
  'completeSplitTask', 'generateTaskWorkOrder', 'correctTaskResult',
  'batchCancelTasks', 'batchCancelRepairs',
] as const;

// `commitStorageRows`, `syncClientBilling`, and `voidUnbilledRows` were
// previously in this list but each has its own SB-primary EF
// (commit-storage-charges-sb, sync-client-billing-sb, void-unbilled-rows-sb)
// gated by its own feature_flag (commitStorageCharges, syncClientBilling,
// voidUnbilledRows). The grouped spread at the bottom of GAS_TO_SB_MAP was
// silently overriding the direct entries (object-literal "last key wins"),
// proxying these actions back to GAS via billing-extras-sb instead of
// using the individual SB handlers. Removing them here lets the direct
// entries (lines below) stick — same fix pattern as updateClient before.
const GROUPED_BILLING_EXTRAS = [
  'markBillingActivityResolved', 'resendInvoiceEmail',
  'previewStorageCharges',
] as const;

const GROUPED_LOCATION_ACTIONS = [
  'updateLocation', 'deleteLocation',
] as const;

const GROUPED_ADMIN_USER_ACTIONS = [
  'adminSetUserPassword', 'ensureAuthUser', 'listMissingAuthUsers',
  'resyncUsers', 'resyncClients', 'sendWelcomeEmail', 'sendWelcomeToUsers',
] as const;

const GROUPED_EMAIL_TEMPLATE_ACTIONS = [
  'updateEmailTemplate', 'syncTemplatesToClients',
  'seedEmailTemplatesToSupabase',
] as const;

// `updateClient` was previously in this list but the grouped EF proxies
// every action straight back to GAS via gas-proxy.ts — for updateClient
// that means SB never gets the canonical write, the GAS handler writes
// only the CB Clients sheet, and the React app's Supabase read cache for
// `public.clients` stays stale (the bug Hyrel/Justin reported when
// stax_customer_id never propagated). The direct entry below
// (`updateClient: { ef: 'update-client-sb', flagKey: 'updateClient' }`)
// is the SB-primary path that writes public.clients and fires
// `__writeThroughReverseClients_` (StrideAPI.gs v38.224.0) to mirror the
// row back to both the per-tenant Settings tab and the CB Clients tab.
// Removing it here lets that direct entry stick instead of being
// silently overwritten by the later spread of grouped entries.
const GROUPED_CLIENT_SETUP_ACTIONS = [
  'finishClientSetup', 'syncSettings',
  'setClientWebAppDeployment', 'rediscoverAllScriptIds',
  'backfillScriptIdsViaWebApp', 'resolveOnboardUser',
] as const;

function buildGroupedEntries(
  actions: readonly string[],
  ef: string,
  flagKey: string,
): Record<string, RouteEntry> {
  const out: Record<string, RouteEntry> = {};
  for (const action of actions) {
    out[action] = { ef, flagKey, grouped: true };
  }
  return out;
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

  // ── Grouped EFs (P7 — fleet coverage) ────────────────────────────────
  // Each grouped action shares one EF that dispatches on the body.action
  // field. The router injects body.action automatically when
  // RouteEntry.grouped === true (see invokeSupabaseHandler).
  ...buildGroupedEntries(GROUPED_MARKETING_ACTIONS,      'marketing-actions-sb',    'marketingActions'),
  ...buildGroupedEntries(GROUPED_CLAIM_ACTIONS,          'claims-actions-sb',       'claimActions'),
  ...buildGroupedEntries(GROUPED_STAX_ACTIONS,           'stax-actions-sb',         'staxActions'),
  ...buildGroupedEntries(GROUPED_QB_ACTIONS,             'qb-actions-sb',           'qbActions'),
  ...buildGroupedEntries(GROUPED_REPAIR_EXTRAS,          'repair-extras-sb',        'repairExtras'),
  ...buildGroupedEntries(GROUPED_WC_EXTRAS,              'wc-extras-sb',            'wcExtras'),
  ...buildGroupedEntries(GROUPED_TASK_BATCH_OPS,         'task-batch-ops-sb',       'taskBatchOps'),
  ...buildGroupedEntries(GROUPED_BILLING_EXTRAS,         'billing-extras-sb',       'billingExtras'),
  ...buildGroupedEntries(GROUPED_LOCATION_ACTIONS,       'location-actions-sb',     'locationActions'),
  ...buildGroupedEntries(GROUPED_ADMIN_USER_ACTIONS,     'admin-users-sb',          'adminUsers'),
  ...buildGroupedEntries(GROUPED_EMAIL_TEMPLATE_ACTIONS, 'email-templates-sb',      'emailTemplates'),
  ...buildGroupedEntries(GROUPED_CLIENT_SETUP_ACTIONS,   'client-setup-sb',         'clientSetup'),

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
): { backend: 'gas' } | { backend: 'supabase'; ef: string; flagKey: string; grouped?: boolean; gasAction?: string } {
  const entry = GAS_TO_SB_MAP[action];
  if (!entry) return { backend: 'gas' };

  const backend = getActiveBackendForKey(entry.flagKey, callerTenantId);
  if (backend !== 'supabase') return { backend: 'gas' };

  return {
    backend: 'supabase',
    ef: entry.ef,
    flagKey: entry.flagKey,
    grouped: entry.grouped,
    gasAction: entry.grouped ? action : undefined,
  };
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
  groupedAction?: string,
): Promise<ApiResponse<T> & { requestId: string }> {
  // Thread callerEmail + clientSheetId into the body. GAS receives them
  // as query params; SB EFs receive them in the body for symmetry with
  // the rest of the SB-side codebase.
  //
  // For GROUPED EFs (marketing-actions-sb / claims-actions-sb / etc), the
  // original GAS action name is injected as body.action so the EF's
  // internal dispatcher can route. Single-action EFs ignore the field if
  // present.
  const callerEmail = getCallerEmail();
  const efBody: Record<string, unknown> = {
    ...body,
    requestId,
    ...(callerEmail ? { callerEmail } : {}),
    ...(extraParams?.clientSheetId ? { tenantId: extraParams.clientSheetId, clientSheetId: extraParams.clientSheetId } : {}),
    ...(groupedAction ? { action: groupedAction } : {}),
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
