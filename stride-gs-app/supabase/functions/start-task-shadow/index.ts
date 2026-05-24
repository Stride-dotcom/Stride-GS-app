/**
 * start-task-shadow — [MIGRATION-P3] shadow handler for `startTask`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001 (dry-run-on-shadow), MIG-006 (audit-log is the answer
 *            key), MIG-008 (stripped-credential).
 *
 * Compare target: `entity_audit_log.changes` for action='start' on the
 * task. The GAS router at StrideAPI.gs:8630 logs a fixed shape:
 *
 *   api_auditLog_("task", taskId, tenantId, "start",
 *                 { status: { new: "In Progress" } }, callerEmail);
 *
 * Note: GAS writes the audit row regardless of whether the call actually
 * mutates task state — re-clicking "Start Task" on an already-In Progress
 * row still emits the same audit shape (and start-task-sb mirrors that,
 * see comment in its file). The shadow stays a fixed-dict return.
 *
 * Per MIG-013 (Path-C), this shadow is purely read-only: it computes the
 * audit shape the SB primary would emit and returns it, with no DB
 * writes and no GAS HTTP calls. The runShadow helper on the React side
 * hashes the JSON and compares against the GAS result.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface StartTaskPayload {
  taskId?: string;
  requestId?: string;
  [k: string]: unknown;
}

interface StartTaskShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runStartTaskShadow(payload: StartTaskPayload): StartTaskShadowResult {
  const taskId = String(payload?.taskId ?? '').trim();
  if (!taskId) return { ok: false, error: 'taskId is required', errorCode: 'INVALID_PARAMS' };
  return {
    ok: true,
    changes: { status: { new: 'In Progress' } },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: StartTaskPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runStartTaskShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
