/**
 * send-will-call-emails-shadow - live-shadow handler for the GAS `sendWillCallEmails` action.
 * Originally deployed via Supabase MCP on 2026-05-19 without a source
 * file, leaving the EF without CORS preflight handling - every
 * `supabase.functions.invoke()` call from the React app surfaced
 * "Failed to send a request to the Edge Function". This source file
 * restores parity with the in-repo shadows fixed in PR #527 and adds
 * the OPTIONS handler.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-001 (dry-run-on-shadow), MIG-007 (live-traffic parity
 *            layer 1), MIG-008 (stripped-credential).
 *
 * Compare target: client-side `resolveAuditShape` in shadowRegistry.ts.
 * This handler is registered there with the default (payload minus
 * DEFAULT_IDENTIFIER_KEYS), so the shadow mirrors the same derivation.
 * Email-sender shadows have no audit-log counterpart in GAS today; the
 * default shape still gives parity_results something to hash without
 * producing side effects.
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

// Mirrors src/lib/shadowRegistry.ts DEFAULT_IDENTIFIER_KEYS. Keep in sync.
const DEFAULT_IDENTIFIER_KEYS = new Set<string>([
  'itemId', 'taskId', 'repairId', 'willCallNumber', 'wcNo', 'wcNumber',
  'shipmentId', 'shipmentNo', 'invoiceNo', 'invoiceNumber',
  'requestId', 'idempotencyKey', 'clientSheetId',
]);

type Payload = Record<string, unknown>;
interface ShadowResult { ok: boolean; changes?: Record<string, unknown>; error?: string; errorCode?: string }

export function runSendWillCallEmailsShadow(payload: Payload): ShadowResult {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (DEFAULT_IDENTIFIER_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return { ok: true, changes: out };
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
  const result = runSendWillCallEmailsShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});