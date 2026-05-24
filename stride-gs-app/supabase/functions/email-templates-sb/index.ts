/**
 * email-templates-sb — grouped SB EF for email-template admin actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, MIG-011 reference
 * to email templates having moved into Supabase email_templates (per
 * 2026-05-11 finding #5).
 *
 * The Settings → Templates page edits per-template HTML and subject.
 * Today these flow through GAS handlers because:
 *   - syncTemplatesToClients also pushes the template into per-tenant
 *     client-script PropertiesService (legacy distribution).
 *   - updateEmailTemplate fans out a) SB email_templates write b) CB
 *     legacy template sheet write c) per-tenant cache invalidation.
 *
 * Proxying preserves the multi-target distribution. A future builder
 * can replace updateEmailTemplate with native SB code once the CB
 * legacy template sheet is decommissioned (P7).
 *
 * Supported actions: updateEmailTemplate, syncTemplatesToClients,
 *   seedEmailTemplatesToSupabase
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'updateEmailTemplate',
  'syncTemplatesToClients',
  'seedEmailTemplatesToSupabase',
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
    return jsonResponse({ error: `Unsupported template action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'action' || k === 'tenantId') continue;
    payload[k] = v;
  }

  // syncTemplatesToClients can run long (49 clients × multiple templates).
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
