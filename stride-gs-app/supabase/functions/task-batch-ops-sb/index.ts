/**
 * task-batch-ops-sb — grouped SB EF for task batch/extras actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * batchCreateTasks already has its own SB EF. This EF covers the remaining
 * task lifecycle extras that weren't part of the P3 work:
 *
 *   - batchReassignTasks       — bulk-set Assigned To on multiple tasks
 *   - batchRequestRepairQuote  — bulk-trigger requestRepairQuote on tasks
 *   - createSplitTask          — split one task into two (qty allocation)
 *   - completeSplitTask        — complete a split-task partially
 *   - generateTaskWorkOrder    — produce a task work-order PDF (Drive)
 *   - correctTaskResult        — admin correction of a completed task's result
 *
 * Most are per-tenant Tasks sheet mutations + cache resync.
 * generateTaskWorkOrder is Drive-bound. All proxy to GAS during the
 * migration window.
 *
 * Supported actions: batchReassignTasks, batchRequestRepairQuote,
 *   createSplitTask, completeSplitTask, generateTaskWorkOrder, correctTaskResult
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'batchReassignTasks',
  'batchRequestRepairQuote',
  'createSplitTask',
  'completeSplitTask',
  'generateTaskWorkOrder',
  'correctTaskResult',
  'batchCancelTasks',
  'batchCancelRepairs',
]);

interface DispatchBody {
  action?: string;
  callerEmail?: string;
  requestId?: string;
  tenantId?: string;
  clientSheetId?: string;
  [k: string]: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: DispatchBody;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const action = String(body.action ?? '').trim();
  if (!action) return jsonResponse({ error: 'action is required', code: 'INVALID_PARAMS' }, 400);
  if (!SUPPORTED_ACTIONS.has(action)) {
    return jsonResponse({ error: `Unsupported task action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'action') continue;
    if (k === 'tenantId' && !body.clientSheetId) {
      payload.clientSheetId = v;
      continue;
    }
    payload[k] = v;
  }

  const result = await gasProxy(action, payload, { timeoutMs: 55_000 });
  if (!result.ok) {
    return jsonResponse({
      error: result.error ?? 'GAS proxy failed',
      code:  'GAS_PROXY_FAILED',
      data:  result.data,
    }, result.httpStatus ?? 502);
  }

  const data = (result.data ?? {}) as Record<string, unknown>;
  if (typeof data === 'object' && data && !('success' in data) && !('error' in data)) {
    (data as Record<string, unknown>).success = true;
  }
  return jsonResponse(data, 200);
});
