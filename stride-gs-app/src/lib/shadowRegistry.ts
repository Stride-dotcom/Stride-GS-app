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
    // Shadow synthesizes `{ summary }` where summary is a stringified
    // items list. The exact serialization depends on payload shape;
    // mirror the shadow's deterministic concat so hashes line up.
    toAuditShape: (p) => {
      const itemIds = Array.isArray(p.itemIds) ? p.itemIds
                    : Array.isArray(p.items)   ? p.items
                    : p.itemId !== undefined   ? [p.itemId]
                    : [];
      const summary = itemIds.map(String).sort().join(',');
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
    toSummary: (p) => `completeTask: ${firstId(p, 'taskId') ?? '?'} ${String(p.result ?? '')}`,
  },
  completeRepair: {
    flagKey: 'completeRepair',
    ef:      'complete-repair-shadow',
    // RepairDetailPanel DOES send resultValue (per shadow source).
    toAuditShape: (p) => ({
      status: { new: 'Complete' },
      result: String(p.resultValue ?? p.result ?? ''),
    }),
    toCallId: (p) => firstId(p, 'repairId', 'requestId'),
    toSummary: (p) => `completeRepair: ${firstId(p, 'repairId') ?? '?'}`,
  },

  // ─── P3/P4a — operational + billing (MCP-deployed shadows) ────────
  // Audit shapes for these are inferred from the action name + the
  // canonical "router audit-logs payload minus identifiers" pattern.
  // If parity mismatches surface, refine these in a follow-up PR with
  // the actual shadow source in hand.
  batchCreateTasks: {
    flagKey: 'createTask',
    ef:      'create-task-shadow',
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
  completeShipment: {
    flagKey: 'receiveShipment',
    ef:      'receive-shipment-shadow',
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
