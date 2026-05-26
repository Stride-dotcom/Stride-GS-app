/**
 * complete-task-shadow — [MIGRATION-P4a] shadow for `completeTask`.
 *
 * Compare target: entity_audit_log.changes for action='complete'.
 * GAS at StrideAPI.gs:7987 logs:
 *
 *   api_auditLog_("task", taskId, tenantId, "complete",
 *     { status: { old: "In Progress", new: "Completed" },
 *       result: payload.resultValue || "" },
 *     callerEmail);
 *
 * Note the task shape differs from the repair shadow: task carries the
 * `status.old: "In Progress"` pair (repair logs only `status.new`).
 * Shadow mirrors GAS 1:1. Pure function, no DB writes (MIG-001 dry-run
 * guarantee — identical posture to complete-repair-shadow).
 *
 * Stripped-credential deploy (MIG-008): this function constructs no
 * Supabase / Resend / Stax client, so there is nothing to strip — it
 * is inert by construction.
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

interface CompleteTaskPayload {
  taskId?: string;
  result?: string;       // 'Pass' | 'Fail'  (router calls it resultValue
  resultValue?: string;  //  on some call sites; accept either)
  requestId?: string;
  [k: string]: unknown;
}

interface CompleteTaskShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runCompleteTaskShadow(payload: CompleteTaskPayload): CompleteTaskShadowResult {
  const taskId = String(payload?.taskId ?? '').trim();
  if (!taskId) return { ok: false, error: 'taskId is required', errorCode: 'INVALID_PARAMS' };

  // Validate the actual completion result the handler acts on
  // (handleCompleteTask_ reads payload.result).
  const result = String(payload?.result ?? payload?.resultValue ?? '').trim();
  if (result !== 'Pass' && result !== 'Fail') {
    return { ok: false, error: "result must be 'Pass' or 'Fail'", errorCode: 'INVALID_PARAMS' };
  }

  // PARITY-CRITICAL: the answer key is the GAS *router* audit call at
  // StrideAPI.gs:7987, which logs `result: payload.resultValue || ""`
  // — the ROUTER-level `resultValue` field, NOT the handler's
  // `payload.result`. The task client never sends `resultValue`
  // (CompleteTaskPayload uses `result`), so GAS's historical audit
  // rows carry result="". Mirror that field + fallback exactly so the
  // shadow↔GAS diff is clean. (Repair differs: RepairDetailPanel DOES
  // send resultValue, which is why complete-repair-shadow can echo it.)
  const auditResult = String(payload?.resultValue ?? '');
  return {
    ok: true,
    changes: {
      status: { old: 'In Progress', new: 'Completed' },
      result: auditResult,
    },
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
  let payload: CompleteTaskPayload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const result = runCompleteTaskShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
