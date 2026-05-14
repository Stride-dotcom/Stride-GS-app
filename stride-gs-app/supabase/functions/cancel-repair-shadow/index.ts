/**
 * cancel-repair-shadow — [MIGRATION-P3] shadow handler for `cancelRepair`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001 (dry-run-on-shadow), MIG-006 (audit-log is the answer key),
 *            MIG-007 (three-layer verification), MIG-008 (stripped-credential).
 *
 * Compare target: `entity_audit_log.changes` for action='cancel'. The GAS
 * router at StrideAPI.gs:7745 logs a FIXED shape:
 *
 *   api_auditLog_("repair", repairId, tenantId, "cancel",
 *                 { status: { new: "Cancelled" } }, callerEmail);
 *
 * So unlike `update-item-shadow` (which mirrors the raw payload), this
 * shadow returns the same fixed `{ status: { new: 'Cancelled' } }` dict
 * regardless of input — that's GAS's actual logged shape, so matching it
 * is the parity definition. The only input validation is `repairId`
 * presence — empty repairId would fail upstream at api_isKnownEntityId_
 * and produce no audit log at all.
 *
 * Authentication:
 *   Called by `replay-shadow` via service_role; verify_jwt=true at function
 *   config level. Per MIG-008, no external-service env vars are read here
 *   (pure handler), so the credential-absence guarantee is vacuously
 *   satisfied. Stateful work (the actual cancel) lives in the primary
 *   `cancel-repair-sb` Edge Function, NOT here.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface CancelRepairPayload {
  repairId?: string;
  requestId?: string;
  [k: string]: unknown;
}

interface CancelRepairShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runCancelRepairShadow(payload: CancelRepairPayload): CancelRepairShadowResult {
  const repairId = String(payload?.repairId ?? '').trim();
  if (!repairId) return { ok: false, error: 'repairId is required', errorCode: 'INVALID_PARAMS' };

  // Fixed-shape audit-log mirror — see StrideAPI.gs:7745
  return {
    ok: true,
    changes: { status: { new: 'Cancelled' } },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: CancelRepairPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runCancelRepairShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
