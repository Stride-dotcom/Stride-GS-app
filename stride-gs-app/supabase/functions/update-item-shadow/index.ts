/**
 * update-item-shadow — P2.1 shadow handler for `updateInventoryItem`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decisions MIG-001
 * (dry-run-on-shadow), MIG-006 (audit-log is the answer key), MIG-008
 * (stripped-credential shadow deploys).
 *
 * MVP scope (revised after code review 2026-05-11):
 *
 * The compare target is `entity_audit_log.changes`. The GAS doPost router
 * at StrideAPI.gs:7871 logs the **raw payload minus `itemId`/`requestId`**
 * to that column, NOT the validated/coerced dict from inside the handler.
 *
 * Therefore the shadow's parity output is also "payload minus identifiers"
 * — no validation, no coercion. Anything else would produce false
 * mismatches:
 *   - `declaredValue:""` (GAS audit logs `""`, validated handler coerces to 0)
 *   - `qty:"5"` (GAS audit logs `"5"`, validated handler coerces to 5)
 *   - any extra payload key (GAS audit logs it, FIELD_MAP filter would drop)
 *   - any validation rejection (GAS still audit-logs the bad payload because
 *     api_auditLog_ fires unconditionally after the handler returns)
 *
 * For the MVP, parity demonstration = "pipeline works end-to-end." The shadow
 * returns the same dict GAS audit-logs. Expected match rate: 100%. That
 * proves the harness machinery is wired correctly.
 *
 * For P2.1 proper (SB-primary `updateItem`), the shadow will be replaced by
 * a stateful handler that:
 *   - validates with the EDITABLE_FIELDS + status/qty/declaredValue logic
 *     (preserved below as a helper for that future use, not currently called
 *     on the parity path)
 *   - writes `public.inventory` directly
 *   - fans out to `public.tasks` / `public.repairs`
 *   - fires reverse-writethrough to the per-tenant sheet
 *   - records a NEW shape of audit log that captures the validated dict
 *
 * At that point, the parity comparison target also changes — likely to the
 * pre/post state of `public.inventory` rather than the audit-log changes
 * column. That's tracked as P2.1 follow-up.
 *
 * Authentication:
 *
 * Called by `replay-shadow` via service_role; verify_jwt=true at the
 * function config level. Per MIG-008, when stateful shadows ship, they
 * MUST verify the caller is service_role + their external-service env
 * vars MUST be placeholder values. Today's pure shadow has no external
 * calls so MIG-008 is vacuously satisfied.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// fireShadow on the React client calls this EF via supabase.functions.invoke(),
// which always attaches `apikey` + `authorization` + `x-client-info` — all
// non-simple headers that force a CORS preflight (OPTIONS) before the POST.
// Without the OPTIONS branch + ACAH below the preflight 405s, the browser
// blocks the POST, and supabase-js v2 surfaces the result as the generic
// "Failed to send a request to the Edge Function" error — masking that the
// request never left the browser. Mirror the canonical SB-primary pattern
// (update-item-sb.corsHeaders) so the preflight succeeds.
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateItemPayload {
  itemId?: string;
  requestId?: string;
  [k: string]: unknown;
}

interface UpdateItemShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

// Editable fields per handleUpdateInventoryItem_'s FIELD_MAP at
// StrideAPI.gs:29591-29606. NOT used on the parity path today (see
// header comment above); preserved here for P2.1's eventual real handler.
const EDITABLE_FIELDS = new Set([
  'vendor', 'description', 'reference', 'sidemark',
  'room', 'location', 'itemClass', 'qty', 'status',
  'itemNotes', 'declaredValue', 'coverageOptionId',
]);

const VALID_STATUSES = new Set(['Active', 'On Hold', 'Released', 'Transferred']);

// ─── Parity-path shadow ─────────────────────────────────────────────────────

/**
 * Mirror of the GAS router's audit-log construction at StrideAPI.gs:7871:
 *
 *   var _updFields = {};
 *   for (var _uk in payload) {
 *     if (_uk !== 'itemId' && _uk !== 'requestId') _updFields[_uk] = payload[_uk];
 *   }
 *
 * Returns the exact dict GAS writes to entity_audit_log.changes.
 *
 * `itemId` validation stays so a payload missing it fails fast — but the
 * error response shape mirrors GAS's errorResponse_ (not a parity-diff
 * concern; covered by the harness's shadow_error path).
 */
export function runUpdateItemShadow(payload: UpdateItemPayload): UpdateItemShadowResult {
  const itemId = String(payload?.itemId ?? '').trim();
  if (!itemId) return { ok: false, error: 'itemId is required', errorCode: 'INVALID_PARAMS' };

  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (key === 'itemId' || key === 'requestId') continue;
    if (payload[key] === undefined) continue;
    changes[key] = payload[key];
  }

  return { ok: true, changes };
}

// ─── Validation helper (NOT on the parity path; for P2.1 future use) ───────

/**
 * Reserved for P2.1's eventual SB-primary `updateItem` handler. NOT called
 * from the parity-path runUpdateItemShadow above — invoking it would cause
 * false mismatches against GAS's raw-payload audit log.
 *
 * Mirrors handleUpdateInventoryItem_'s validation:
 *   - status must be one of VALID_STATUSES
 *   - qty must be a non-negative number
 *   - declaredValue empty / "null" → 0; otherwise non-negative number
 *
 * Returns { ok, validated, error } — `validated` is a coerced copy.
 */
export function validateUpdateItemPayload(
  payload: UpdateItemPayload,
): { ok: boolean; validated?: Record<string, unknown>; error?: string; errorCode?: string } {
  const validated: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (key === 'itemId' || key === 'requestId') continue;
    if (payload[key] === undefined) continue;
    if (!EDITABLE_FIELDS.has(key)) continue;  // unknown editable field — drop
    validated[key] = payload[key];
  }

  if (Object.prototype.hasOwnProperty.call(validated, 'status')) {
    if (!VALID_STATUSES.has(String(validated.status))) {
      return { ok: false, error: `Invalid status: ${validated.status}`, errorCode: 'INVALID_PARAMS' };
    }
  }
  if (Object.prototype.hasOwnProperty.call(validated, 'qty')) {
    const qtyVal = Number(validated.qty);
    if (Number.isNaN(qtyVal) || qtyVal < 0) {
      return { ok: false, error: `Invalid qty: ${validated.qty}`, errorCode: 'INVALID_PARAMS' };
    }
    validated.qty = qtyVal;
  }
  if (Object.prototype.hasOwnProperty.call(validated, 'declaredValue')) {
    const dvStr = String(validated.declaredValue ?? '').trim();
    if (dvStr === '' || dvStr === 'null') {
      validated.declaredValue = 0;
    } else {
      const dvNum = Number(dvStr);
      if (Number.isNaN(dvNum) || dvNum < 0) {
        return { ok: false, error: `Invalid declaredValue: ${validated.declaredValue}`, errorCode: 'INVALID_PARAMS' };
      }
      validated.declaredValue = dvNum;
    }
  }

  return { ok: true, validated };
}

// ─── HTTP wrapper ───────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: UpdateItemPayload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const result = runUpdateItemShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
