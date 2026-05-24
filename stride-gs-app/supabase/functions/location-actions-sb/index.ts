/**
 * location-actions-sb — grouped SB EF for warehouse location management.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * Locations live in the CB Locations sheet with a Supabase mirror at
 * public.locations. The sheet remains authoritative during the migration
 * window so we proxy to GAS for both update and delete; the GAS handlers
 * mutate the sheet, then resync to public.locations.
 *
 * createLocation already has a working flow in api.ts that hits GAS
 * directly — this EF covers updateLocation / deleteLocation so they can
 * be routed via the feature_flags substrate alongside the other admin
 * surfaces.
 *
 * Supported actions: updateLocation, deleteLocation
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'updateLocation',
  'deleteLocation',
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
    return jsonResponse({ error: `Unsupported location action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'action' || k === 'tenantId') continue;
    payload[k] = v;
  }

  const result = await gasProxy(action, payload);
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
