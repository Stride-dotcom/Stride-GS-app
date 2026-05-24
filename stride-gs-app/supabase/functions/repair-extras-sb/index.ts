/**
 * repair-extras-sb — grouped SB EF for the secondary repair lifecycle actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * The high-traffic repair actions (cancelRepair, startRepair, completeRepair,
 * sendRepairQuote, respondToRepairQuote, requestRepairQuote) already have
 * dedicated `-sb` EFs. This EF covers the remaining tail:
 *
 *   - correctRepairResult — admin correction of a completed repair's outcome
 *   - reopenRepair        — flip a Completed/Failed/Cancelled repair back to
 *                            an actionable status; existing reopenTask /
 *                            reopenWillCall actions follow the same pattern.
 *   - voidRepairQuote     — mark a Quote Sent quote as voided
 *
 * All three handlers mutate the per-tenant Repairs sheet + Supabase
 * public.repairs mirror + may emit emails. Proxy to GAS preserves the
 * existing handler logic during the migration window.
 *
 * Supported actions: correctRepairResult, reopenRepair, voidRepairQuote
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'correctRepairResult',
  'reopenRepair',
  'voidRepairQuote',
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
    return jsonResponse({ error: `Unsupported repair action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

  // Map tenantId → clientSheetId for the GAS handler (which reads it from
  // params, not body). Pass through everything else.
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
