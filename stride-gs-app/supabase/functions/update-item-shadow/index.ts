/**
 * update-item-shadow — P2.1 shadow handler for `updateInventoryItem`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decisions MIG-001
 * (dry-run-on-shadow), MIG-006 (audit-log is the answer key), MIG-008
 * (stripped-credential shadow deploys), and the per-function migration
 * table for `updateItem`.
 *
 * What this is (MVP scope):
 *
 * A pure function (`input → changes`) that mirrors `handleUpdateInventoryItem_`'s
 * validation + field-mapping logic from StrideAPI.gs. Given the same payload
 * the GAS handler received, it returns the same `changes` dict that GAS would
 * write to `entity_audit_log.changes`. The replay-shadow Edge Function compares
 * shadow's `changes` against the GAS-recorded `changes` to confirm parity.
 *
 * What this is NOT (yet):
 *
 * - Not a full SB-primary `updateItem` handler. P2.1's full version writes
 *   `public.inventory` directly, fans out to `public.tasks` / `public.repairs`,
 *   and fires the reverse-writethrough endpoint to keep the per-tenant sheet
 *   current. That comes after parity proves out on this MVP.
 * - Doesn't read or write any tables. Pure validation + field-mapping. That
 *   makes the parity comparison trivial: shadow's output is the change set;
 *   GAS's `entity_audit_log.changes` is the change set; deep-equal compares
 *   them.
 *
 * Why pure-function MVP works for updateItem specifically:
 *
 * `handleUpdateInventoryItem_` for the audit-log-output portion is essentially
 * "validate fields, build {payloadKey → value} dict, log it." The fan-out to
 * Tasks/Repairs and the writethrough to Supabase are SIDE EFFECTS that don't
 * produce additional `entity_audit_log` rows (verified by inspection). So for
 * audit-log parity, mirroring the validation + field-mapping is sufficient.
 *
 * For more complex handlers (completeTask, createInvoice) the shadow has to
 * be stateful — it needs to read prior billing rows, run the storage-charges
 * RPC, etc. Those land in their own session.
 *
 * Authentication:
 *
 * Called only by the `replay-shadow` Edge Function via service_role. Not
 * publicly invokable. Per MIG-008, this function deploys with placeholder
 * external-service credentials so even buggy code can't double-charge or
 * double-email anyone — it never calls external services anyway, but the
 * pattern stays consistent.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateItemPayload {
  itemId?: string;
  // Editable fields (must stay in sync with handleUpdateInventoryItem_'s
  // FIELD_MAP at StrideAPI.gs:29591-29606)
  vendor?: string;
  description?: string;
  reference?: string;
  sidemark?: string;
  room?: string;
  location?: string;
  itemClass?: string;
  qty?: number | string;
  status?: string;
  itemNotes?: string;
  declaredValue?: number | string;
  coverageOptionId?: string;
  // Allow other fields (requestId, etc.) — we just ignore them.
  [k: string]: unknown;
}

interface UpdateItemShadowResult {
  ok: boolean;
  // The "changes" dict that the GAS handler would write to entity_audit_log.
  // Mirrors what handleUpdateInventoryItem_ ends up passing to api_auditLog_.
  changes?: Record<string, unknown>;
  // If validation rejects the input, ok=false + error matches GAS's errorResponse_.
  error?: string;
  errorCode?: string;
}

// Field-map mirror of handleUpdateInventoryItem_'s FIELD_MAP. Keys are payload
// keys; the comparison against entity_audit_log.changes uses the SAME payload
// keys (verified via sampled rows like {sidemark: "FIRST LIGHT"}), so we don't
// need to translate to sheet-header names here.
const EDITABLE_FIELDS = [
  'vendor', 'description', 'reference', 'sidemark',
  'room', 'location', 'itemClass', 'qty', 'status',
  'itemNotes', 'declaredValue', 'coverageOptionId',
] as const;

const VALID_STATUSES = new Set(['Active', 'On Hold', 'Released', 'Transferred']);

// ─── Pure shadow logic ──────────────────────────────────────────────────────

export function runUpdateItemShadow(payload: UpdateItemPayload): UpdateItemShadowResult {
  const itemId = String(payload?.itemId ?? '').trim();
  if (!itemId) return { ok: false, error: 'itemId is required', errorCode: 'INVALID_PARAMS' };

  // Collect only provided fields. Mirror of the GAS for-loop at 29611-29616.
  const changes: Record<string, unknown> = {};
  let updateCount = 0;
  for (const key of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined) {
      changes[key] = payload[key];
      updateCount++;
    }
  }
  if (updateCount === 0) {
    return { ok: false, error: 'No editable fields provided', errorCode: 'INVALID_PARAMS' };
  }

  // Validate status (mirror StrideAPI.gs:29620-29625).
  if (Object.prototype.hasOwnProperty.call(changes, 'status')) {
    if (!VALID_STATUSES.has(String(changes.status))) {
      return { ok: false, error: `Invalid status: ${changes.status}`, errorCode: 'INVALID_PARAMS' };
    }
  }

  // Validate qty (mirror StrideAPI.gs:29628-29634). Coerce to number on
  // success — GAS does the same.
  if (Object.prototype.hasOwnProperty.call(changes, 'qty')) {
    const qtyVal = Number(changes.qty);
    if (Number.isNaN(qtyVal) || qtyVal < 0) {
      return { ok: false, error: `Invalid qty: ${changes.qty}`, errorCode: 'INVALID_PARAMS' };
    }
    changes.qty = qtyVal;
  }

  // Validate declaredValue (mirror StrideAPI.gs:29637-29648). Empty / "null"
  // strings → 0; otherwise coerce to non-negative number.
  if (Object.prototype.hasOwnProperty.call(changes, 'declaredValue')) {
    const dvStr = String(changes.declaredValue ?? '').trim();
    if (dvStr === '' || dvStr === 'null') {
      changes.declaredValue = 0;
    } else {
      const dvNum = Number(dvStr);
      if (Number.isNaN(dvNum) || dvNum < 0) {
        return { ok: false, error: `Invalid declaredValue: ${changes.declaredValue}`, errorCode: 'INVALID_PARAMS' };
      }
      changes.declaredValue = dvNum;
    }
  }

  return { ok: true, changes };
}

// ─── HTTP wrapper ───────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: UpdateItemPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const result = runUpdateItemShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
