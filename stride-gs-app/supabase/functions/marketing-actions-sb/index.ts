/**
 * marketing-actions-sb — grouped SB EF for all 18 marketing actions.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 *
 * Marketing campaigns/templates/contacts live in a Google Sheet that the
 * server-side cron loop reads to enqueue email sends. The authoritative
 * data path is sheet → Supabase mirror (already in place — see
 * supabase/migrations/20260415193000_marketing_contacts_cache_table.sql
 * and 20260415210000_marketing_campaigns_templates_settings.sql).
 *
 * This EF dispatches each apiPost action to GAS via the gas-proxy helper.
 * Rationale:
 *   1. The GAS handlers (handleCreateMarketingCampaign_, etc.) already
 *      contain ~1500 LOC of validated business logic — re-implementing
 *      natively is high risk for low gain during the migration window.
 *   2. The handlers themselves call `resyncMarketingCampaignToSupabase_`
 *      after every mutation, so the SB cache stays current automatically.
 *   3. Wiring through this EF lets the router (apiRouter.ts) flip any
 *      individual marketing action to SB-primary later without changing
 *      the call sites — when a future builder replaces a proxy with
 *      native code, only this EF changes.
 *
 * Dispatch shape (the router sends): { action: '<gasAction>', ...payload }
 * Returns whatever GAS returned, wrapped in the standard envelope shape.
 *
 * Supported actions:
 *   createMarketingCampaign, updateMarketingCampaign, activateCampaign,
 *   pauseCampaign, completeCampaign, runCampaignNow, deleteCampaign,
 *   createMarketingContact, importMarketingContacts, updateMarketingContact,
 *   suppressContact, unsuppressContact, createMarketingTemplate,
 *   updateMarketingTemplate, updateMarketingSettings, sendTestEmail,
 *   previewTemplate, checkMarketingInbox
 */

import { gasProxy, corsHeaders, jsonResponse } from '../_shared/gas-proxy.ts';

const SUPPORTED_ACTIONS = new Set([
  'createMarketingCampaign',
  'updateMarketingCampaign',
  'activateCampaign',
  'pauseCampaign',
  'completeCampaign',
  'runCampaignNow',
  'deleteCampaign',
  'createMarketingContact',
  'importMarketingContacts',
  'updateMarketingContact',
  'suppressContact',
  'unsuppressContact',
  'createMarketingTemplate',
  'updateMarketingTemplate',
  'updateMarketingSettings',
  'sendTestEmail',
  'previewTemplate',
  'checkMarketingInbox',
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
    return jsonResponse({ error: `Unsupported marketing action: ${action}`, code: 'INVALID_ACTION' }, 400);
  }

  // Forward everything except SB-internal framing keys to GAS as the
  // handler-payload. GAS's marketing handlers expect a flat payload of
  // whatever the React app sent.
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

  // GAS marketing handlers return varied shapes; pass through verbatim with
  // success:true to match the contract expected by the React MarketingWriteResponse type.
  const data = (result.data ?? {}) as Record<string, unknown>;
  if (typeof data === 'object' && data && !('success' in data)) {
    (data as Record<string, unknown>).success = true;
  }
  return jsonResponse(data, 200);
});
