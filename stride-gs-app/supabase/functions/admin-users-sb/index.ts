/**
 * admin-users-sb — grouped SB EF for admin user-management actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * These handlers create / repair Supabase auth.users rows. They could in
 * principle be re-implemented natively using @supabase/supabase-js admin
 * APIs, but they ALSO need to resolve the CB Users row for the target
 * email to stamp `user_metadata` (role / client / clientSheetId) at
 * create-time. The CB Users sheet is still authoritative for the
 * role/client mapping during the migration window, so today the source
 * of truth for that lookup is GAS.
 *
 * Proxying preserves the v38.223.0 metadata-stamping behavior on the
 * 5 auth-user-creation paths consolidated into createSupabaseAuthUser_.
 *
 * Supported actions:
 *   adminSetUserPassword, ensureAuthUser, listMissingAuthUsers,
 *   resyncUsers, resyncClients, sendWelcomeEmail, sendWelcomeToUsers
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'adminSetUserPassword',
  'ensureAuthUser',
  'listMissingAuthUsers',
  'resyncUsers',
  'resyncClients',
  'sendWelcomeEmail',
  'sendWelcomeToUsers',
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
    return jsonResponse({ error: `Unsupported user-admin action: ${action}`, code: 'INVALID_ACTION' }, 400);
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
