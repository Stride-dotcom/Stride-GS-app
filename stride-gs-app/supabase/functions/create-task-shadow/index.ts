/**
 * create-task-shadow - live-shadow handler for the GAS `batchCreateTasks (createTask)` action.
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
 *   GAS dispatch for `batchCreateTasks` at StrideAPI.gs:10186-10194
 *   writes ONE entity_audit_log row PER created task id, each with
 *     changes: { summary: "Task created",
 *                svcCodes: payload.svcCodes.join(",") }
 *   The shadow returns the same per-payload shape so SHA-256 hashes
 *   match. The original payload-minus-identifiers default produced
 *   {tasks:[...], svcCodes:[...]} which never hashed equal — every
 *   batchCreateTasks call surfaced as a parity mismatch since
 *   2026-05-19 (33% match rate; the matching tail came from payloads
 *   with empty tasks/svcCodes that happened to collide).
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

export function runCreateTaskShadow(payload: Payload): ShadowResult {
  // GAS at StrideAPI.gs:10183 uses raw `.join(",")` — Array.prototype.join
  // calls String() on each element with null/undefined → "". `.map(String)`
  // first would diverge for null entries (`"null"` vs `""`). Keep raw join
  // so the EF and the shadowRegistry override produce identical strings.
  const svcCodes = Array.isArray(payload?.svcCodes)
    ? (payload.svcCodes as unknown[]).join(',')
    : '';
  return {
    ok: true,
    changes: {
      summary: 'Task created',
      svcCodes,
    },
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
  const result = runCreateTaskShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});