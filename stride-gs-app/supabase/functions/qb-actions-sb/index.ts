/**
 * qb-actions-sb — grouped SB EF for QuickBooks-related actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, P6 (payments) +
 * P4b (CB retirement) phases.
 *
 * QB integration handlers stay GAS-owned for now:
 *   - IIF / Excel exports manipulate Drive files and CB sheets.
 *   - QBO OAuth tokens live in PropertiesService (refresh-token rotation
 *     happens inside the GAS PropertiesService block).
 *   - qboCreateInvoice has its own SB EF (qbo-create-invoice-sb) — the
 *     remaining QB admin actions consolidate here.
 *
 * Supported actions:
 *   qbExport, qbExcelExport, qboDisconnect, qboSetupHeaders,
 *   qboSyncCatalogItem, updateQboStatus, backfillDocsFromDrive
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'qbExport',
  'qbExcelExport',
  'qboDisconnect',
  'qboSetupHeaders',
  'qboSyncCatalogItem',
  'updateQboStatus',
  'backfillDocsFromDrive',
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
    return jsonResponse({ error: `Unsupported QB action: ${action}`, code: 'INVALID_ACTION' }, 400);
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
