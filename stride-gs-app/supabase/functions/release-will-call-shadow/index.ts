/**
 * release-will-call-shadow — [MIGRATION-P3] shadow for `releaseWillCall`.
 *
 * GAS action key (gas_call_log.action) is `processWcRelease`; the
 * feature_flags function_key is `releaseWillCall` (Justin's canonical-24
 * name). The SHADOW_REGISTRY maps releaseWillCall → action processWcRelease.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001, MIG-006, MIG-008.
 *
 * Compare target: `entity_audit_log.changes` for action='release' on the
 * will_call. The GAS doPost router at StrideAPI.gs:8187 logs a FIXED dict:
 *
 *   api_auditLog_("will_call", String(payload.wcNumber || ""), effectiveId,
 *     "release", { summary: "Will call released" }, callerEmail);
 *
 * The changes payload is a constant — it does not vary with which items
 * were released or how the per-item billing landed (processWcRelease is
 * atomic with billing per MIG-004, but the *audit-changes* answer key the
 * shadow must reproduce is just the summary string). So the shadow is a
 * pure constant-shape return, exactly like start-task-shadow.
 *
 * Note: GAS writes this audit row regardless of partial vs full release —
 * a "Release Some" call that releases 2 of 5 items still logs the same
 * `{summary:"Will call released"}`. The shadow mirrors that 1:1.
 *
 * Per MIG-013 (Path-C) this shadow is read-only — no DB writes, no GAS
 * HTTP calls. MIG-008 is vacuously satisfied (constructs no client).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface ProcessWcReleasePayload {
  wcNumber?: string;
  requestId?: string;
  [k: string]: unknown;
}

interface ReleaseWillCallShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runReleaseWillCallShadow(
  _payload: ProcessWcReleasePayload,
): ReleaseWillCallShadowResult {
  // ZERO added validation — GAS logs the FIXED dict regardless of payload
  // (StrideAPI.gs:8187). Any stricter check would create false
  // `shadow_rejected_but_gas_accepted` mismatches. `wcNumber` is the audit
  // row's entity_id, not part of `changes`, so it's irrelevant to parity.
  return {
    ok: true,
    changes: { summary: 'Will call released' },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: ProcessWcReleasePayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runReleaseWillCallShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
