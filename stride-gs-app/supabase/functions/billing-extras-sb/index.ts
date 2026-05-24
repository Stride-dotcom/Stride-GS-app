/**
 * billing-extras-sb — grouped SB EF for billing-system tail actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, MIG-004/MIG-005 for
 * billing handler atomicity decisions.
 *
 * createInvoice / voidInvoice / reissueInvoice / completeTask / completeRepair
 * each have their own SB EFs (P4a). This EF covers the remaining billing
 * surface used by the React app's billing pages:
 *
 *   - markBillingActivityResolved — mark an unbilled-activity flag as resolved
 *   - resendInvoiceEmail          — re-fire the invoice email for an existing invoice
 *   - previewStorageCharges       — non-committing storage-charge preview
 *   - commitStorageRows           — commit a subset of storage rows produced by preview
 *
 * Each handler proxies to GAS because:
 *   - markBillingActivityResolved manipulates the CB Billing_Activity tab
 *   - resendInvoiceEmail re-uses the invoice email template + Drive PDF
 *   - previewStorageCharges runs the per-client storage calculator that
 *     reads multiple sheets
 *   - commitStorageRows mutates per-tenant Billing_Ledger + CB Consolidated_Ledger
 *
 * Supported actions: markBillingActivityResolved, resendInvoiceEmail,
 *   previewStorageCharges, commitStorageRows, syncClientBilling
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'markBillingActivityResolved',
  'resendInvoiceEmail',
  'previewStorageCharges',
  'commitStorageRows',
  'syncClientBilling',
  'voidUnbilledRows',
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
    return jsonResponse({ error: `Unsupported billing action: ${action}`, code: 'INVALID_ACTION' }, 400);
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
