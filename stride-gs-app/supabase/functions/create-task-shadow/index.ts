/**
 * create-task-shadow — [MIGRATION-P3] shadow for `createTask`.
 *
 * GAS action key (gas_call_log.action) is `batchCreateTasks` — there is no
 * `createTask` doPost case; the React app creates tasks (single or many)
 * exclusively through the batch endpoint. feature_flags function_key is
 * `createTask` (Justin's canonical-24 name). SHADOW_REGISTRY maps
 * createTask → action batchCreateTasks.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001, MIG-006, MIG-008.
 *
 * Compare target: `entity_audit_log.changes` for action='create' on each
 * created task. The GAS doPost router at StrideAPI.gs:8602-8618 writes ONE
 * audit row per created taskId via api_auditLogBatch_, all with an
 * IDENTICAL changes dict:
 *
 *   { summary: "Task created",
 *     svcCodes: Array.isArray(payload.svcCodes) ? payload.svcCodes.join(",") : "" }
 *
 * gated on `_csJson.success && Array.isArray(_csJson.taskIds) && length`.
 *
 * Because every per-task row carries the same changes dict, the shadow
 * returns that single dict — the replay harness diffs it against any one
 * of the call's audit rows (same precedent as request-repair-quote-shadow,
 * whose legacy GAS path also fanned one logical call out to N entity
 * rows; see its SHADOW_REGISTRY comment). `svcCodes` is the request
 * payload's array joined with "," verbatim — no per-task variation, no
 * handler-internal state — so the shadow is a pure function of the
 * payload.
 *
 * Per MIG-013 (Path-C) this shadow is read-only. MIG-008 vacuously
 * satisfied (no client constructed).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface BatchCreateTasksPayload {
  svcCodes?: unknown[];
  itemIds?: unknown[];
  requestId?: string;
  [k: string]: unknown;
}

interface CreateTaskShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runCreateTaskShadow(
  payload: BatchCreateTasksPayload,
): CreateTaskShadowResult {
  // ZERO added validation — mirror the GAS audit construction
  // byte-for-byte (StrideAPI.gs:8605/8613):
  //   svcCodes: Array.isArray(payload.svcCodes) ? payload.svcCodes.join(",") : ""
  // GAS itself tolerates a non-array svcCodes (→ ""), so the shadow must
  // too; rejecting it would be a false `shadow_rejected_but_gas_accepted`
  // mismatch.
  return {
    ok: true,
    changes: {
      summary: 'Task created',
      svcCodes: Array.isArray(payload?.svcCodes) ? payload.svcCodes.join(',') : '',
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

  let payload: BatchCreateTasksPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runCreateTaskShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
