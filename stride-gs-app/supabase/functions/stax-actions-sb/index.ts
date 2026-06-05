/**
 * stax-actions-sb — grouped SB EF for Stax/payment admin actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * Stax (Fattmerchant) integration handlers live in GAS because:
 *   - The Stax SDK has no Deno port; calls go through fetch wrappers in
 *     `StaxAutoPay.gs` and StrideAPI.gs's Stax block.
 *   - Run state tracks in CB Stax_* sheets that GAS reads/writes alongside
 *     the public.stax_invoices / stax_charges / stax_customers mirror.
 *   - The auto-pay daily cron is a GAS time-driven trigger (migration to
 *     pg_cron is P7 scope).
 *
 * This EF proxies to GAS for the full set of Stax admin actions wired
 * through `apiPost` in src/lib/api.ts. The router can flip individual
 * actions to SB-primary in the future without changing call sites.
 *
 * Supported actions (16):
 *   importIIF, importIIFFromDrive, updateStaxConfig, saveStaxCustomerMapping,
 *   autoMatchStaxCustomers, pullStaxCustomers, syncStaxCustomers,
 *   updateStaxInvoice, deleteStaxInvoice,
 *   (createTestInvoice moved to the dedicated 100%-Supabase
 *    create-test-stax-invoice EF — no longer proxied here)
 *   staxRefreshCustomerIds, staxRefreshPaymentStatus, chargeSingleInvoice,
 *   sendStaxPayLinks, sendStaxPayLink, voidStaxInvoice, toggleAutoCharge,
 *   resetStaxInvoiceStatus, resolveStaxException, batchVoidStaxInvoices,
 *   batchDeleteStaxInvoices
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'importIIF',
  'importIIFFromDrive',
  'updateStaxConfig',
  'saveStaxCustomerMapping',
  'autoMatchStaxCustomers',
  'pullStaxCustomers',
  'syncStaxCustomers',
  // createTestInvoice migrated to the dedicated create-test-stax-invoice EF.
  'updateStaxInvoice',
  'deleteStaxInvoice',
  'staxRefreshCustomerIds',
  'staxRefreshPaymentStatus',
  'chargeSingleInvoice',
  'sendStaxPayLinks',
  'sendStaxPayLink',
  'voidStaxInvoice',
  'toggleAutoCharge',
  'resetStaxInvoiceStatus',
  'resolveStaxException',
  'batchVoidStaxInvoices',
  'batchDeleteStaxInvoices',
  'regenerateIifForBatch',
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
    return jsonResponse({ error: `Unsupported stax action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'action' || k === 'tenantId') continue;
    payload[k] = v;
  }

  // Stax pay-link batches and IIF imports can take a while; give them
  // close to the EF 60s cap.
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
