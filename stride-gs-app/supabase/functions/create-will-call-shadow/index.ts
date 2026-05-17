/**
 * create-will-call-shadow — [MIGRATION-P3] shadow handler for `createWillCall`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001 (dry-run-on-shadow), MIG-006 (audit-log is the answer
 *            key), MIG-008 (stripped-credential — inert by construction).
 *
 * Compare target: `entity_audit_log.changes` for action='create' on the
 * will_call. The GAS doPost router at StrideAPI.gs:8173 logs, ONLY when
 * the handler returned `success`:
 *
 *   api_auditLog_("will_call", _wcJson.wcNumber || "", effectiveId,
 *     "create",
 *     { pickupParty: payload.pickupParty || "",
 *       itemCount:   (payload.itemIds || []).length },
 *     callerEmail);
 *
 * Both fields derive purely from the request payload — `pickupParty`
 * verbatim (empty string when absent) and `itemCount` as the *number* of
 * entries in `itemIds`. No handler-internal state participates, so the
 * shadow is a pure function of the payload. Historical calls that failed
 * produced no audit row (the GAS log is gated on `_wcJson.success`), so the
 * replay harness sees `no_audit_row` for those and skips — the shadow only
 * needs to mirror the success-path shape.
 *
 * Per MIG-013 (Path-C) this shadow is read-only: it computes the audit
 * shape the SB primary would emit and returns it, with no DB writes and no
 * GAS HTTP calls. replay-shadow hashes the JSON and diffs it against the
 * GAS audit row.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface CreateWillCallPayload {
  pickupParty?: string;
  itemIds?: unknown[];
  requestId?: string;
  [k: string]: unknown;
}

interface CreateWillCallShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runCreateWillCallShadow(
  payload: CreateWillCallPayload,
): CreateWillCallShadowResult {
  // ZERO added validation — mirror the GAS router's audit construction
  // byte-for-byte (StrideAPI.gs:8173):
  //   { pickupParty: payload.pickupParty || "",
  //     itemCount:   (payload.itemIds || []).length }
  // Per the update-item-shadow precedent, any check stricter than GAS
  // (e.g. rejecting empty itemIds — which GAS does NOT do at the audit
  // layer; it logs itemCount:0) would surface as a false
  // `shadow_rejected_but_gas_accepted` mismatch in replay-shadow.
  const itemIds = Array.isArray(payload?.itemIds) ? payload.itemIds : [];
  return {
    ok: true,
    changes: {
      pickupParty: payload?.pickupParty || '',
      itemCount: itemIds.length,
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

  let payload: CreateWillCallPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runCreateWillCallShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
