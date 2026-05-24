/**
 * claims-actions-sb — grouped SB EF for all 12 claim lifecycle actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * Claims live in the CB Claims/Claim_Items sheets with a Supabase mirror at
 * public.claims (read-cache). GAS handlers own:
 *   - sheet mutations (Claims, Claim_Items, Claim_Notes tabs)
 *   - claim folder creation in Drive
 *   - settlement PDF generation (Doc template → PDF flow)
 *   - claim emails (received / more-info / denial / settlement-sent)
 *   - cache resync to public.claims after every mutation
 *
 * This EF dispatches each apiPost action to GAS via the gas-proxy helper.
 * Same rationale as marketing-actions-sb:
 *   1. GAS handlers (handleCreateClaim_, etc.) contain heavily-tested
 *      multi-step business logic (~2000 LOC across 12 handlers).
 *   2. The handlers already resync to Supabase, so the cache stays current.
 *   3. Routing via this EF gives per-action / per-tenant flag flipping
 *      without changing call sites.
 *
 * Supported actions:
 *   createClaim, addClaimItems, addClaimNote, requestMoreInfo,
 *   sendClaimDenial, generateClaimSettlement, uploadSignedSettlement,
 *   closeClaim, voidClaim, reopenClaim, firstReviewClaim, updateClaim
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'createClaim',
  'addClaimItems',
  'addClaimNote',
  'requestMoreInfo',
  'sendClaimDenial',
  'generateClaimSettlement',
  'uploadSignedSettlement',
  'closeClaim',
  'voidClaim',
  'reopenClaim',
  'firstReviewClaim',
  'updateClaim',
]);

interface DispatchBody {
  action?: string;
  callerEmail?: string;
  requestId?: string;
  tenantId?: string;
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
    return jsonResponse({ error: `Unsupported claim action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

  // Forward the entire payload except SB-internal framing keys. GAS claim
  // handlers expect a flat payload + a separate callerEmail (which doPost
  // synthesizes from the API_TOKEN session — we pass it explicitly).
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'action' || k === 'tenantId') continue;
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
