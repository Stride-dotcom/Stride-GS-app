/**
 * transfer-items-shadow — [MIGRATION-P5] shadow for `transferItems`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001, MIG-006, MIG-008.
 *
 * Compare target: `entity_audit_log.changes` for action='transfer' on each
 * transferred inventory row, scoped to the SOURCE tenant. The GAS doPost
 * router at StrideAPI.gs:8287-8290 writes, per item, TWO audit rows:
 *
 *   // source tenant — action 'transfer'
 *   api_auditLog_("inventory", id, effectiveId, "transfer",
 *     { status: { new: "Transferred" }, destinationTenant: destId },
 *     callerEmail);
 *   // destination tenant — action 'transfer_in'
 *   api_auditLog_("inventory", id, destId, "transfer_in",
 *     { summary: "Item transferred in", sourceTenant: effectiveId },
 *     callerEmail);
 *
 * gated on `rJsonTx.success && !skipped && destId && txIds.length`, where
 * `destId = String(payload.destinationClientSheetId || "").trim()`.
 *
 * Parity scope: the replay corpus row for a `transferItems` call carries
 * the SOURCE tenant_id (the tenant that issued the call), so the harness's
 * natural compare target is the source-tenant `transfer` row. Its changes
 * dict is a pure function of the payload: a constant `status:{new:
 * 'Transferred'}` plus `destinationTenant` echoed from
 * `payload.destinationClientSheetId`. The shadow returns that.
 *
 * The paired `transfer_in` row (destination tenant, different action +
 * different changes shape, references `effectiveId` which is not in the
 * request payload) is intentionally NOT modelled here — it's the same
 * one-logical-call-fans-to-N-entity-rows situation the harness already
 * tolerates for create-task-shadow / request-repair-quote-shadow. A
 * follow-up can add a dedicated transfer_in corpus pass keyed on the
 * destination tenant if cross-tenant audit parity needs independent
 * verification; tracked in MIGRATION_STATUS per-function notes.
 *
 * Per MIG-013 (Path-C) this shadow is read-only. MIG-008 vacuously
 * satisfied (no client constructed).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface TransferItemsPayload {
  itemIds?: unknown[];
  destinationClientSheetId?: string;
  requestId?: string;
  [k: string]: unknown;
}

interface TransferItemsShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runTransferItemsShadow(
  payload: TransferItemsPayload,
): TransferItemsShadowResult {
  if (!Array.isArray(payload?.itemIds) || payload.itemIds.length === 0) {
    return { ok: false, error: 'itemIds is required (non-empty array)', errorCode: 'INVALID_PARAMS' };
  }
  // Mirror the router's exact derivation: String(... || "").trim().
  const destId = String(payload?.destinationClientSheetId ?? '').trim();
  if (!destId) {
    return { ok: false, error: 'destinationClientSheetId is required', errorCode: 'INVALID_PARAMS' };
  }

  return {
    ok: true,
    changes: {
      status: { new: 'Transferred' },
      destinationTenant: destId,
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

  let payload: TransferItemsPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runTransferItemsShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
