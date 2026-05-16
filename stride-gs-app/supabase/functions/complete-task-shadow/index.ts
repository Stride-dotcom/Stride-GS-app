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
  const result = String(payload?.result ?? payload?.resultValue ?? '').trim();
  if (result !== 'Pass' && result !== 'Fail') {
    return { ok: false, error: "result must be 'Pass' or 'Fail'", errorCode: 'INVALID_PARAMS' };
  }
  return {
    ok: true,
    changes: {
      status: { old: 'In Progress', new: 'Completed' },
      result,
    },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let payload: CompleteTaskPayload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const result = runCompleteTaskShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
