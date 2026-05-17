/**
 * release-items-shadow — [MIGRATION-P3] shadow for `releaseItems`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001, MIG-006, MIG-008.
 *
 * Compare target: `entity_audit_log.changes` for action='release' on each
 * released inventory row. The GAS doPost router at StrideAPI.gs:8258 loops
 * over `payload.itemIds` and writes ONE audit row per item, every one with
 * an IDENTICAL fixed dict:
 *
 *   api_auditLog_("inventory", String(releasedIds[i]), clientSheetId,
 *     "release", { status: { new: "Released" } }, callerEmail);
 *
 * The changes dict is a constant — it carries no per-item or
 * handler-internal state. Every per-item row is the same, so the shadow
 * returns that single dict; the replay harness diffs it against any one of
 * the call's audit rows (same N-rows-per-call precedent as
 * create-task-shadow / request-repair-quote-shadow).
 *
 * Note: the GAS loop is NOT gated on handler success — it runs over
 * payload.itemIds unconditionally. But a failed release still produces
 * "release" audit rows in history, so replaying its input through this
 * fixed-shape shadow still matches. (The ledger status update IS gated on
 * success, but that's a different table, not the audit answer key.)
 *
 * Per MIG-013 (Path-C) this shadow is read-only. MIG-008 vacuously
 * satisfied.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface ReleaseItemsPayload {
  itemIds?: unknown[];
  requestId?: string;
  [k: string]: unknown;
}

interface ReleaseItemsShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runReleaseItemsShadow(
  payload: ReleaseItemsPayload,
): ReleaseItemsShadowResult {
  if (!Array.isArray(payload?.itemIds) || payload.itemIds.length === 0) {
    return { ok: false, error: 'itemIds is required (non-empty array)', errorCode: 'INVALID_PARAMS' };
  }
  return {
    ok: true,
    changes: { status: { new: 'Released' } },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: ReleaseItemsPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runReleaseItemsShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
