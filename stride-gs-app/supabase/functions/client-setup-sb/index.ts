/**
 * client-setup-sb — grouped SB EF for client-level admin actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, MIG-014 (client
 * settings reverse-the-direction decision) and MIG-016 (onboardClient
 * deploy order).
 *
 * onboardClient already has its own SB EF (onboard-client-sb). This EF
 * covers the remaining client-level admin actions:
 *
 *   - finishClientSetup — completes a half-onboarded client (Sheet ID
 *                          repair, post-onboarding setup steps).
 *   - updateClient       — patch fields on public.clients. Per MIG-014
 *                          public.clients IS authoritative; the existing
 *                          `propagate_clients_to_sheet` trigger mirrors
 *                          to the CB Clients sheet. Proxying to GAS
 *                          intentionally so the legacy CB sheet write
 *                          stays consistent during the migration window.
 *   - syncSettings       — push per-client settings sheet → SB mirror.
 *
 * Supported actions: finishClientSetup, updateClient, syncSettings,
 *   setClientWebAppDeployment, rediscoverAllScriptIds,
 *   backfillScriptIdsViaWebApp, resolveOnboardUser
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'finishClientSetup',
  'updateClient',
  'syncSettings',
  'setClientWebAppDeployment',
  'rediscoverAllScriptIds',
  'backfillScriptIdsViaWebApp',
  'resolveOnboardUser',
]);

interface DispatchBody {
  action?: string;
  callerEmail?: string;
  requestId?: string;
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
    return jsonResponse({ error: `Unsupported client action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

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
