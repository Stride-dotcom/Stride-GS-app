/**
 * complete-repair-shadow — [MIGRATION-P4a] shadow for `completeRepair`.
 *
 * Compare target: entity_audit_log.changes for action='complete'.
 * GAS at StrideAPI.gs:7814 logs:
 *
 *   api_auditLog_("repair", repairId, tenantId, "complete",
 *     { status: { new: "Complete" }, result: payload.resultValue || "" },
 *     callerEmail);
 *
 * Shape varies by resultValue input. Shadow mirrors 1:1.
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

interface CompleteRepairPayload {
  repairId?: string;
  resultValue?: string;       // 'Pass' | 'Fail'
  requestId?: string;
  [k: string]: unknown;
}

interface CompleteRepairShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runCompleteRepairShadow(payload: CompleteRepairPayload): CompleteRepairShadowResult {
  const repairId = String(payload?.repairId ?? '').trim();
  if (!repairId) return { ok: false, error: 'repairId is required', errorCode: 'INVALID_PARAMS' };
  const resultValue = String(payload?.resultValue ?? '').trim();
  if (resultValue !== 'Pass' && resultValue !== 'Fail') {
    return { ok: false, error: "resultValue must be 'Pass' or 'Fail'", errorCode: 'INVALID_PARAMS' };
  }
  return {
    ok: true,
    changes: { status: { new: 'Complete' }, result: resultValue },
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
  let payload: CompleteRepairPayload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const result = runCompleteRepairShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
