/**
 * wc-extras-sb — grouped SB EF for Will Call lifecycle extras.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * The high-traffic Will Call actions (createWillCall, processWcRelease) have
 * dedicated SB-primary EFs. This EF covers the tail:
 *
 *   - generateWcDoc          — Doc template → PDF for a Will Call (Drive)
 *   - batchCancelWillCalls   — bulk cancel multiple WCs at once
 *   - batchScheduleWillCalls — bulk-set scheduled date/time on multiple WCs
 *
 * The first one is Drive-bound (template duplication + PDF export). The
 * batch ops are per-tenant Will_Calls sheet mutations + cache resync. All
 * three proxy to GAS to preserve the existing handler logic during the
 * migration window.
 *
 * Supported actions: generateWcDoc, batchCancelWillCalls, batchScheduleWillCalls
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'generateWcDoc',
  'batchCancelWillCalls',
  'batchScheduleWillCalls',
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
    return jsonResponse({ error: `Unsupported WC action: ${action}`, code: 'INVALID_ACTION' }, 400);
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
