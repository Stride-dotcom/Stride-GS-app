/**
 * start-repair-shadow — [MIGRATION-P3] shadow handler for `startRepair`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001 (dry-run-on-shadow), MIG-006 (audit-log is the answer key),
 *            MIG-008 (stripped-credential).
 *
 * Compare target: `entity_audit_log.changes` for action='start'. The GAS
 * router at StrideAPI.gs:7811 logs a fixed shape:
 *
 *   api_auditLog_("repair", repairId, tenantId, "start",
 *                 { status: { new: "In Progress" } }, callerEmail);
 *
 * Note: GAS writes the audit row even on "rerun" calls (when status is
 * already In Progress or Complete and the operator regenerates the work
 * order PDF). The shadow mirrors that — every successful call produces
 * the same dict. The "no mutation when reRun" semantic only affects the
 * primary's behavior, not the audit-log shape, so shadow parity stays
 * 1:1 with GAS.
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

interface StartRepairPayload {
  repairId?: string;
  requestId?: string;
  [k: string]: unknown;
}

interface StartRepairShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runStartRepairShadow(payload: StartRepairPayload): StartRepairShadowResult {
  const repairId = String(payload?.repairId ?? '').trim();
  if (!repairId) return { ok: false, error: 'repairId is required', errorCode: 'INVALID_PARAMS' };
  return {
    ok: true,
    changes: { status: { new: 'In Progress' } },
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

  let payload: StartRepairPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const result = runStartRepairShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
