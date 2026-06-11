/**
 * reopen-cancelled-repair-sb — SB-primary handler for un-cancelling a repair.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Symmetric with cancel-repair-sb (the SB-first cancel path): cancel stamps
 * status_before_cancel; this restores it.
 *
 * Flow:
 *   1. Validate inputs (tenantId, repairId).
 *   2. Load the repair. Must currently be 'Cancelled' — anything else is
 *      INVALID_STATE (idempotency: a repeat call after the first reopen sees a
 *      non-Cancelled status and returns alreadyReopened with the live status).
 *   3. Resolve the target status: status_before_cancel when it holds a sane
 *      pre-cancel status, else 'Pending Quote' (the task's documented default
 *      and the fallback for repairs cancelled before status_before_cancel
 *      shipped). 'Cancelled'/'Complete'/blank are never restored as a target.
 *   4. UPDATE public.repairs SET status=target, status_before_cancel=NULL.
 *   5. INSERT entity_audit_log: action='reopen',
 *      changes={ status: { old: 'Cancelled', new: target } }.
 *   6. Reverse writethrough to the per-tenant Repairs sheet (Status +
 *      clear "Status Before Cancel"). Best-effort: failure logs to
 *      gs_sync_events; the SB commit is not unwound.
 *
 * Called by: React RepairDetailPanel "Reopen" button on a Cancelled repair
 * (postReopenCancelledRepairSb — direct EF invoke; no GAS equivalent exists,
 * so this is unconditionally SB, not feature-flag gated).
 *
 * Auth: verified caller email via supabase.auth.getUser(token); falls back to
 * 'system' on service_role / unauthenticated calls.
 *
 * Request:  POST { tenantId, repairId, requestId? }
 * Response: { ok, repairId, newStatus, alreadyReopened?, mirrorOk?, mirrorError? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Statuses we will NOT restore a reopened repair into — restoring 'Cancelled'
// would be a no-op loop, 'Complete' would skip the reopen-from-complete path
// (which voids billing), and a blank is meaningless. Anything else captured at
// cancel time (Pending Quote / Quote Sent / Revised / Approved / Declined /
// In Progress) is a valid restore target.
const NON_RESTORABLE = new Set(['Cancelled', 'Complete', 'Completed', '']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string  = String(body.tenantId ?? '').trim();
    const repairId: string  = String(body.repairId ?? '').trim();
    const requestId: string = String(body.requestId ?? '').trim() || crypto.randomUUID();

    if (!tenantId) return json({ ok: false, error: 'tenantId is required' }, 400);
    if (!repairId) return json({ ok: false, error: 'repairId is required' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Load existing repair ──────────────────────────────────────
    const { data: existing, error: existingErr } = await supabase
      .from('repairs')
      .select('repair_id, status, status_before_cancel')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: `Repair lookup failed: ${existingErr.message}` }, 500);
    if (!existing)   return json({ ok: false, error: `Repair ${repairId} not found in tenant ${tenantId}` }, 404);

    const currentStatus = String(existing.status ?? '').trim();

    // Idempotency — already not Cancelled means a previous reopen landed
    // (or it was never cancelled). Return ok with the live status rather
    // than erroring, so a double-click is harmless.
    if (currentStatus !== 'Cancelled') {
      return json({
        ok: true, repairId, newStatus: currentStatus,
        alreadyReopened: true, mirrorOk: true,
      });
    }

    // ── 2. Resolve restore target ────────────────────────────────────
    const stored = String(existing.status_before_cancel ?? '').trim();
    const target = NON_RESTORABLE.has(stored) ? 'Pending Quote' : stored;

    // ── 3. UPDATE public.repairs ─────────────────────────────────────
    const { error: updErr } = await supabase
      .from('repairs')
      .update({
        status:               target,
        status_before_cancel: null,
        updated_at:           new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId);
    if (updErr) return json({ ok: false, error: `Update failed: ${updErr.message}` }, 500);

    // ── 4. entity_audit_log ──────────────────────────────────────────
    await supabase.from('entity_audit_log').insert({
      entity_type:  'repair',
      entity_id:    repairId,
      tenant_id:    tenantId,
      action:       'reopen',
      changes:      { status: { old: 'Cancelled', new: target } },
      performed_by: callerEmail,
      source:       'edge',
    });

    // ── 5. Reverse writethrough — status + clear Status Before Cancel ─
    let mirrorOk = true;
    let mirrorError: string | undefined;
    try {
      const gasUrl = Deno.env.get('GAS_API_URL');
      const gasToken = Deno.env.get('GAS_API_TOKEN');
      if (gasUrl && gasToken) {
        const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            table: 'repairs',
            op:    'update',
            rowId: repairId,
            row:   { status: target, status_before_cancel: '' },
            requestId,
          }),
        });
        const text = await mirrorRes.text();
        let parsed: { success?: boolean; error?: string } = {};
        try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
        if (!mirrorRes.ok || !parsed.success) {
          mirrorOk = false;
          mirrorError = parsed.error ?? `HTTP ${mirrorRes.status}`;
        }
      } else {
        mirrorOk = false;
        mirrorError = 'GAS_API_URL or GAS_API_TOKEN not configured';
      }
    } catch (e) {
      mirrorOk = false;
      mirrorError = e instanceof Error ? e.message : String(e);
    }

    if (!mirrorOk) {
      await supabase.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  `reopen-cancelled-repair-sb:${callerEmail}`,
        request_id:    requestId,
        payload:       { table: 'repairs', op: 'update', rowId: repairId, row: { status: target, status_before_cancel: '' } },
        error_message: (mirrorError ?? 'unknown').slice(0, 1000),
      }).then(() => {}, () => {});
    }

    return json({ ok: true, repairId, newStatus: target, mirrorOk, mirrorError });

  } catch (err) {
    console.error('[reopen-cancelled-repair-sb] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
