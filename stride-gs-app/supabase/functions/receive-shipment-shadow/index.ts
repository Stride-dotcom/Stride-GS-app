/**
 * receive-shipment-shadow - live-shadow handler for the GAS `completeShipment (receiveShipment)` action.
 * Originally deployed via Supabase MCP on 2026-05-19 without a source
 * file, leaving the EF without CORS preflight handling - every
 * `supabase.functions.invoke()` call from the React app surfaced
 * "Failed to send a request to the Edge Function". CORS was added in
 * PR #540 (2026-05-27); curl-verified live on 2026-05-28.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001 (dry-run-on-shadow), MIG-007 (live-traffic parity
 *            layer 1), MIG-008 (stripped-credential).
 *
 * Audit-shape contract (must stay in sync with shadowRegistry.ts and
 * with GAS):
 *   GAS dispatch for `completeShipment` at StrideAPI.gs:9533 writes
 *     api_auditLog_("shipment", shipmentNo, tenantId, "create",
 *       { itemCount: (payload.items || []).length,
 *         carrier: payload.carrier || "" },
 *       callerEmail);
 *   The shadow MUST return that exact shape so SHA-256 hashes match.
 *   The original payload-minus-identifiers default produced
 *   {items:[...], carrier, ...} which never hashed equal — every
 *   receiveShipment call surfaced as a parity mismatch since 2026-05-19.
 *
 * Zero side effects - no DB writes, no GAS HTTP calls, no Resend/Stax
 * client construction (MIG-008 inert by construction).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// CORS - required so the browser-side `supabase.functions.invoke()` preflight
// passes. Without this, supabase-js v2 surfaces "Failed to send a request to
// the Edge Function" because the OPTIONS preflight is rejected before the
// POST ever fires. Mirrors update-item-sb / start-task-shadow.
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Payload = Record<string, unknown>;
interface ShadowResult { ok: boolean; changes?: Record<string, unknown>; error?: string; errorCode?: string }

export function runReceiveShipmentShadow(payload: Payload): ShadowResult {
  // Mirror GAS at StrideAPI.gs:9598 byte-for-byte:
  //   { itemCount: (payload.items || []).length, carrier: payload.carrier || "" }
  //
  // Use the `||` operator (NOT `??` + String()): GAS's `||` collapses every
  // falsy value (`""`, null, undefined, 0, false, NaN) to `""`. `String(x ?? '')`
  // diverges from that for the 0/false/NaN/number-typed-carrier cases —
  // realistic payloads always pass strings so the bug never bit in production,
  // but a single non-string carrier in a future payload (webhook ingest, retry
  // queue, anything not going through the trimmed React input) would surface
  // as a hash_diff mismatch that nobody could explain. The same `||` form runs
  // in shadowRegistry.ts so the EF and the synthetic GAS audit shape derive
  // identically from the same payload.
  const itemsRaw = (payload?.items as unknown) || [];
  const itemCount = Array.isArray(itemsRaw) ? itemsRaw.length : 0;
  const carrier = (payload?.carrier as string | null | undefined) || '';
  return {
    ok: true,
    changes: { itemCount, carrier },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  let payload: Payload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const result = runReceiveShipmentShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});