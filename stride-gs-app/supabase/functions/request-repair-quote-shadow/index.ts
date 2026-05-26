/**
 * request-repair-quote-shadow — [MIGRATION-P3] shadow for `requestRepairQuote`.
 *
 * Compare target: `entity_audit_log.changes` for action='create'. GAS at
 * StrideAPI.gs:7761 logs a single audit row per call (not per item)
 * with empty entity_id:
 *
 *   api_auditLog_("repair", "", effectiveId, "create",
 *     { summary: "Repair quote requested for items: " + JSON.stringify(itemIds).substring(0, 200) },
 *     callerEmail);
 *
 * Shadow returns the same shape. itemIds order follows the payload
 * order (matches GAS — it uses payload.itemIds || payload.items as-is).
 *
 * Note: this is the ONLY repair shadow with entity_id='' because the
 * GAS router intentionally doesn't bind the audit to a single repair_id
 * (multi-item legacy GAS path created N repairs, no single entity to
 * bind to). The SB primary creates ONE repair with N items so a future
 * iteration could bind entity_id to that single repair_id — but for
 * parity-comparison purposes today, we mirror GAS's empty value.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// CORS — required so the browser-side `supabase.functions.invoke()` preflight
// passes. Without this, supabase-js v2 surfaces "Failed to send a request to
// the Edge Function" because the OPTIONS preflight is rejected before the
// POST ever fires. Mirrors update-item-sb.
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestQuotePayload {
  itemIds?: unknown;
  items?: unknown;
  itemId?: unknown;         // single-item legacy payload shape from TaskDetailPanel / ItemDetailPanel
  sourceTaskId?: unknown;
  requestId?: unknown;
  [k: string]: unknown;
}

interface RequestQuoteShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runRequestQuoteShadow(payload: RequestQuotePayload): RequestQuoteShadowResult {
  // GAS accepts itemIds OR items OR (legacy single) itemId. Normalize
  // to an array matching what GAS would have logged.
  let arr: string[];
  if (Array.isArray(payload.itemIds)) {
    arr = payload.itemIds.map(x => String(x));
  } else if (Array.isArray(payload.items)) {
    arr = payload.items.map(x => String(x));
  } else if (payload.itemId) {
    arr = [String(payload.itemId)];
  } else {
    return { ok: false, error: 'itemIds (or items, or single itemId) is required', errorCode: 'INVALID_PARAMS' };
  }
  // Same .substring(0, 200) truncation as the GAS handler. JSON.stringify
  // matches GAS's V8 output for primitive-string arrays.
  const summary = `Repair quote requested for items: ${JSON.stringify(arr).substring(0, 200)}`;
  return {
    ok: true,
    changes: { summary },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  let payload: RequestQuotePayload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const result = runRequestQuoteShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
