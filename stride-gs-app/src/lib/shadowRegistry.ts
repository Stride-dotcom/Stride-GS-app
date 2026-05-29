/**
 * shadowRegistry — maps GAS apiPost action → audit-shape shadow Edge Function.
 *
 * The React app's `apiPost` (src/lib/api.ts) consults this registry after
 * every successful GAS call. If the action has an entry, a fire-and-forget
 * shadow invocation runs through `fireShadowLive` (src/lib/fireShadow.ts):
 *
 *   1. The shadow Edge Function is invoked with the same payload GAS got.
 *   2. The synthesized "GAS audit-shape" (what the GAS router would log
 *      to entity_audit_log.changes for this call) is hashed.
 *   3. The shadow's `.changes` field is hashed.
 *   4. A `parity_results` row records match / mismatch + durations.
 *
 * Project context: MIGRATION_STATUS.md — implements the live-traffic side
 * of MIG-007 layer 1 ("per-call state diff"). Pairs with the operator-run
 * `replay-shadow` Edge Function which exercises layer 2 (historical 90-day
 * replay against `gas_call_log` + `entity_audit_log`).
 *
 * Audit-shape derivation strategy:
 *
 *   • Most simple-write shadows (update-item-shadow, update-task-shadow,
 *     update-repair-shadow) mirror what the GAS router logs verbatim:
 *     `payload − {itemId, taskId, repairId, requestId, …}`. The default
 *     `toAuditShape` below produces exactly that, so these entries only
 *     need flagKey + ef.
 *
 *   • Fixed-shape shadows (startTask, startRepair, cancelRepair, etc.)
 *     return a constant dict regardless of payload contents. Those
 *     entries override `toAuditShape` to synthesize the same constant.
 *
 *   • Complex-shape shadows (completeTask, respondToRepairQuote, etc.)
 *     combine fixed status changes with payload-dependent fields. Those
 *     overrides are explicit.
 *
 *   • Shadows where we don't have source-side certainty about the exact
 *     shape (the 15 deployed-via-MCP shadows from 2026-05-19) start with
 *     the default. If those produce many parity mismatches, the registry
 *     gets refined in follow-up PRs as the team confirms each shape.
 *
 * Pairs with: src/lib/fireShadow.ts (helper), supabase/functions/replay-shadow
 * (replay harness's SHADOW_REGISTRY — keep these in sync as new shadows ship).
 */

export interface ShadowSpec {
  /** feature_flags.function_key. Drives routing + parity gating. */
  flagKey: string;
  /** Shadow Edge Function name (deployed). Matches what the GAS router would
   *  audit-log for this payload via its `.changes` return field. */
  ef: string;
  /** Synthesize the GAS audit-shape from the input payload. If omitted, the
   *  default (`payload − DEFAULT_IDENTIFIER_KEYS`) is used. */
  toAuditShape?: (payload: Record<string, unknown>) => Record<string, unknown>;
  /** Stable id used for parity_results.call_id (UNIQUE on function_key+call_id).
   *  Default: payload.requestId. Override when the natural entity id should
   *  dedupe retries (e.g. taskId for status changes). */
  toCallId?: (payload: Record<string, unknown>) => string | undefined;
  /** Human-readable one-liner shown on the Migration dashboard. */
  toSummary?: (payload: Record<string, unknown>) => string;
}

const DEFAULT_IDENTIFIER_KEYS: ReadonlySet<string> = new Set([
  'itemId', 'taskId', 'repairId', 'willCallNumber', 'wcNo', 'wcNumber',
  'shipmentId', 'shipmentNo', 'invoiceNo', 'invoiceNumber',
  'requestId', 'idempotencyKey', 'clientSheetId',
]);

function defaultAuditShape(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (DEFAULT_IDENTIFIER_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

// Helper: pull the first non-empty stringifiable id from a payload.
function firstId(p: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
  }
  return undefined;
}

export const SHADOW_REGISTRY: Record<string, ShadowSpec> = {
  // ─── P2 — simple writes ────────────────────────────────────────────
  // The GAS router audit-logs (payload − {itemId, requestId}) verbatim
  // for these. Default toAuditShape is the right derivation.
  updateInventoryItem: {
    flagKey: 'updateItem',
    ef:      'update-item-shadow',
    // update-item-shadow strips ONLY {itemId, requestId} per its source
    // (supabase/functions/update-item-shadow/index.ts:99-103). The default
    // strip set is broader (includes taskId, repairId, etc.) — for this
    // shadow specifically, narrow the strip to exactly match so a payload
    // carrying a stray taskId-shaped field doesn't false-positive.
    toAuditShape: (p) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (k === 'itemId' || k === 'requestId') continue;
        if (v === undefined) continue;
        out[k] = v;
      }
      return out;
    },
    toCallId: (p) => firstId(p, 'itemId', 'requestId'),
    toSummary: (p) => `updateItem: ${firstId(p, 'itemId') ?? '?'}`,
  },
  updateTaskNotes: {
    flagKey: 'updateTask',
    ef:      'update-task-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => `updateTaskNotes: ${firstId(p, 'taskId') ?? '?'}`,
  },
  updateTaskPriority: {
    flagKey: 'updateTask',
    ef:      'update-task-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => `updateTaskPriority: ${firstId(p, 'taskId') ?? '?'}`,
  },
  updateTaskDueDate: {
    flagKey: 'updateTask',
    ef:      'update-task-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => `updateTaskDueDate: ${firstId(p, 'taskId') ?? '?'}`,
  },
  updateTaskCustomPrice: {
    flagKey: 'updateTask',
    ef:      'update-task-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => `updateTaskCustomPrice: ${firstId(p, 'taskId') ?? '?'}`,
  },
  updateRepairNotes: {
    flagKey: 'updateRepair',
    ef:      'update-repair-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => `updateRepairNotes: ${firstId(p, 'repairId') ?? '?'}`,
  },

  // ─── P3 — status changes (fixed audit shape, in-source shadows) ───
  // GAS at StrideAPI.gs:8630 logs `{ status: { new: 'In Progress' } }`
  // regardless of payload. Shadow returns the same constant. The
  // payload-minus-identifiers default would NOT match this — explicit
  // override below.
  startTask: {
    flagKey: 'startTask',
    ef:      'start-task-shadow',
    toAuditShape: () => ({ status: { new: 'In Progress' } }),
    toCallId: (p) => firstId(p, 'taskId', 'requestId'),
    toSummary: (p) => `startTask: ${firstId(p, 'taskId') ?? '?'}`,
  },
  startRepair: {
    flagKey: 'startRepair',
    ef:      'start-repair-shadow',
    toAuditShape: () => ({ status: { new: 'In Progress' } }),
    toCallId: (p) => firstId(p, 'repairId', 'requestId'),
    toSummary: (p) => `startRepair: ${firstId(p, 'repairId') ?? '?'}`,
  },
  cancelRepair: {
    flagKey: 'cancelRepair',
    ef:      'cancel-repair-shadow',
    toAuditShape: () => ({ status: { new: 'Cancelled' } }),
    toCallId: (p) => firstId(p, 'repairId', 'requestId'),
    toSummary: (p) => `cancelRepair: ${firstId(p, 'repairId') ?? '?'}`,
  },
  sendRepairQuote: {
    flagKey: 'sendRepairQuote',
    ef:      'send-repair-quote-shadow',
    toAuditShape: () => ({ status: { old: 'Pending Quote', new: 'Quote Sent' } }),
    toCallId: (p) => firstId(p, 'repairId', 'requestId'),
    toSummary: (p) => `sendRepairQuote: ${firstId(p, 'repairId') ?? '?'}`,
  },
  respondToRepairQuote: {
    flagKey: 'respondRepairQuote',
    ef:      'respond-repair-quote-shadow',
    toAuditShape: (p) => {
      const decision = String(p.decision ?? '');
      const newStatus = decision === 'Approve' ? 'Approved'
                      : decision === 'Decline' ? 'Declined'
                      : '';
      return { decision, status: { new: newStatus } };
    },
    toCallId: (p) => firstId(p, 'repairId', 'requestId'),
    toSummary: (p) => `respondRepairQuote: ${firstId(p, 'repairId') ?? '?'} ${String(p.decision ?? '')}`,
  },
  requestRepairQuote: {
    flagKey: 'requestRepairQuote',
    ef:      'request-repair-quote-shadow',
    // Mirror request-repair-quote-shadow exactly (see its source at
    // supabase/functions/request-repair-quote-shadow/index.ts:41-60).
    // Format: GAS at StrideAPI.gs:7761 logs
    //   `Repair quote requested for items: ${JSON.stringify(itemIds).substring(0,200)}`
    // payload order preserved (NOT sorted) so this matches a JSON-array
    // round-trip from the React payload.
    toAuditShape: (p) => {
      const arr: string[] = Array.isArray(p.itemIds) ? p.itemIds.map(String)
                          : Array.isArray(p.items)   ? p.items.map(String)
                          : p.itemId !== undefined && p.itemId !== null
                            ? [String(p.itemId)]
                            : [];
      const summary = `Repair quote requested for items: ${JSON.stringify(arr).substring(0, 200)}`;
      return { summary };
    },
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: () => 'requestRepairQuote',
  },

  // ─── P4a — billing-core (in-source shadows) ───────────────────────
  // completeTask: GAS router at StrideAPI.gs:7987 logs
  //   `{ status: { old: 'In Progress', new: 'Completed' }, result: payload.resultValue || '' }`
  // React payload sends `result`, NOT `resultValue`, so the audit-log
  // result is always `""` for React-originated calls. Mirror that.
  completeTask: {
    flagKey: 'completeTask',
    ef:      'complete-task-shadow',
    toAuditShape: (p) => ({
      status: { old: 'In Progress', new: 'Completed' },
      result: String(p.resultValue ?? ''),
    }),
    toCallId: (p) => firstId(p, 'taskId', 'requestId'),
    // toSummary reads `result` (the field React sends — `resultValue` is
    // only echoed in the audit shape, blank for React-originated calls)
    // so the dashboard's one-liner reflects what the user actually picked.
    toSummary: (p) => `completeTask: ${firstId(p, 'taskId') ?? '?'} ${String(p.result ?? '')}`,
  },
  completeRepair: {
    flagKey: 'completeRepair',
    ef:      'complete-repair-shadow',
    // complete-repair-shadow REQUIRES `resultValue` (rejects otherwise)
    // and returns it verbatim. RepairDetailPanel sends `resultValue`,
    // not `result`. A `result`-only payload would have the shadow throw
    // INVALID_PARAMS (recorded as the 'ERROR' hash by runShadow); no
    // fallback to `result` here so the registry and shadow agree on what
    // the parity check expects.
    toAuditShape: (p) => ({
      status: { new: 'Complete' },
      result: String(p.resultValue ?? ''),
    }),
    toCallId: (p) => firstId(p, 'repairId', 'requestId'),
    toSummary: (p) => `completeRepair: ${firstId(p, 'repairId') ?? '?'} ${String(p.resultValue ?? '')}`,
  },

  // ─── P3/P4a — operational + billing (MCP-deployed shadows) ────────
  // Audit shapes for these are inferred from the action name + the
  // canonical "router audit-logs payload minus identifiers" pattern.
  // If parity mismatches surface, refine these in a follow-up PR with
  // the actual shadow source in hand.
  //
  // batchCreateTasks: the GAS dispatch at StrideAPI.gs:10186-10194 writes
  // ONE entity_audit_log row per created task id, each with
  //   changes: { summary: 'Task created', svcCodes: <payload.svcCodes joined with ','> }
  // The default `payload − identifiers` shape was never going to match
  // (`{tasks:[...], svcCodes:[...]}` vs `{summary, svcCodes:'…'}`) and
  // produced 0%/33% match rates surfaced as transport failures by the
  // audit-doc's LIKE '%Failed to send%' query (which catches both real
  // transport failures AND any non-empty mismatch_details). Override
  // matches what GAS actually logs.
  batchCreateTasks: {
    flagKey: 'createTask',
    ef:      'create-task-shadow',
    toAuditShape: (p) => ({
      summary: 'Task created',
      svcCodes: Array.isArray(p.svcCodes) ? p.svcCodes.join(',') : '',
    }),
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => {
      const tasks = Array.isArray(p.tasks) ? p.tasks.length : '?';
      return `batchCreateTasks: ${tasks} tasks`;
    },
  },
  createWillCall: {
    flagKey: 'createWillCall',
    ef:      'create-will-call-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: () => 'createWillCall',
  },
  processWcRelease: {
    flagKey: 'processWcRelease',
    ef:      'processWcRelease-shadow',
    toCallId: (p) => firstId(p, 'willCallNumber', 'wcNo', 'requestId'),
    toSummary: (p) => `processWcRelease: ${firstId(p, 'willCallNumber', 'wcNo') ?? '?'}`,
  },
  releaseItems: {
    flagKey: 'releaseItems',
    ef:      'release-items-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => {
      const items = Array.isArray(p.itemIds) ? p.itemIds.length : '?';
      return `releaseItems: ${items} items`;
    },
  },
  transferItems: {
    flagKey: 'transferItems',
    ef:      'transfer-items-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => {
      const items = Array.isArray(p.itemIds) ? p.itemIds.length : '?';
      return `transferItems: ${items} items`;
    },
  },
  commitStorageRows: {
    flagKey: 'commitStorageCharges',
    ef:      'commit-storage-charges-shadow',
    toCallId: (p) => firstId(p, 'idempotencyKey', 'requestId'),
    toSummary: () => 'commitStorageCharges',
  },
  reissueInvoice: {
    flagKey: 'reissueInvoice',
    ef:      'reissue-invoice-shadow',
    toCallId: (p) => firstId(p, 'invoiceNo', 'requestId'),
    toSummary: (p) => `reissueInvoice: ${firstId(p, 'invoiceNo') ?? '?'}`,
  },

  // ─── P5 — complex flows (MCP-deployed shadows) ────────────────────
  // Naming aliases: GAS action `completeShipment` is what fires the
  // receiving flow; the feature_flags row is named `receiveShipment`
  // (the user-facing operation). The shadow EF mirrors the flag name.
  //
  // completeShipment: the GAS dispatch at StrideAPI.gs:9533 writes one
  // entity_audit_log row with
  //   changes: { itemCount: (payload.items || []).length, carrier: payload.carrier || '' }
  // The default `payload − identifiers` shape gave the shadow side a
  // big `{items:[…], carrier, …}` object instead, which never matched
  // — every receiveShipment shadow run landed in mismatch_details and
  // got captured as a "transport failure" by the audit-doc's LIKE
  // '%Failed to send%' query (8/8 since the deploy).
  completeShipment: {
    flagKey: 'receiveShipment',
    ef:      'receive-shipment-shadow',
    toAuditShape: (p) => ({
      itemCount: Array.isArray(p.items) ? p.items.length : 0,
      carrier:   String(p.carrier ?? ''),
    }),
    toCallId: (p) => firstId(p, 'idempotencyKey', 'requestId'),
    toSummary: (p) => {
      const items = Array.isArray(p.items) ? p.items.length : '?';
      return `receiveShipment: ${items} items`;
    },
  },
  onboardClient: {
    flagKey: 'onboardClient',
    ef:      'onboard-client-shadow',
    toCallId: (p) => firstId(p, 'requestId'),
    toSummary: (p) => `onboardClient: ${String(p.clientName ?? p.name ?? '?')}`,
  },
};

/** Lookup helper. Returns undefined for actions with no shadow registered. */
export function getShadowSpec(gasAction: string): ShadowSpec | undefined {
  return SHADOW_REGISTRY[gasAction];
}

/** Resolve the audit shape for a payload, applying the spec's override or
 *  falling back to the default `payload minus identifiers`. */
export function resolveAuditShape(
  spec: ShadowSpec,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return spec.toAuditShape ? spec.toAuditShape(payload) : defaultAuditShape(payload);
}
