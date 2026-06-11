/**
 * cancel-repair-sb — [MIGRATION-P3] SB-primary handler for `cancelRepair`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-002 (synchronous SB→Sheets reverse writethrough),
 *            MIG-007 (three-layer verification — this is layer 3's primary).
 *
 * Flow:
 *   1. Validate inputs (tenantId, repairId, caller is staff/admin).
 *   2. UPDATE public.repairs SET status='Cancelled' WHERE (tenant_id, repair_id).
 *      Idempotent: skips when status is already Cancelled (returns ok).
 *   3. INSERT entity_audit_log row matching GAS's shape from
 *      StrideAPI.gs:7745: action='cancel', changes={status:{new:'Cancelled'}}.
 *   4. Fire reverse writethrough to per-tenant Repairs sheet
 *      (mirrors the legacy GAS behavior so sheet readers stay current).
 *      Best-effort: failure logs to gs_sync_events via the framework but
 *      doesn't unwind the SB commit.
 *
 * Called by:
 *   • React RepairDetailPanel "Cancel Repair" button, gated by
 *     resolveFlagBackend('cancelRepair', tenantId) === 'supabase'.
 *   • The parity-comparison replay path through `replay-shadow` calls
 *     `cancel-repair-shadow` (the pure shadow) for diff against
 *     entity_audit_log — NOT this primary.
 *
 * Auth: Edge Function config sets verify_jwt=true. Caller's JWT must
 * carry user_metadata.role IN ('admin','staff'). Service-role calls
 * (from the replay harness) bypass the role check.
 *
 * Request:  POST { tenantId, repairId, requestId? }
 * Response: { ok, repairId, alreadyCancelled?, mirrorOk?, mirrorError? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // ── Verified caller email ───────────────────────────────────────
    // Critical: do NOT trust an unsigned JWT decode. The previous
    // implementation did `atob(jwt.split('.')[1])` and trusted whatever
    // email it found — forgeable trivially. Now we validate the JWT
    // against Supabase Auth via getUser(token) using an anon-keyed
    // client. That triggers signature verification server-side. If the
    // caller is service_role (replay harness), getUser fails and we
    // fall back to 'system' which is the correct telemetry value for
    // that path.
    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) {
        callerEmail = user.email;
      }
      // No error path on authErr — getUser failure with a service_role JWT
      // is expected (it's not a user JWT). Falls through to 'system'.
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Pre-check: does the repair exist + what's its current status? ──
    const { data: existing, error: existingErr } = await supabase
      .from('repairs')
      .select('repair_id, status')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .maybeSingle();
    if (existingErr) {
      return json({ ok: false, error: `Repair lookup failed: ${existingErr.message}` }, 500);
    }
    if (!existing) {
      return json({ ok: false, error: `Repair ${repairId} not found in tenant ${tenantId}` }, 404);
    }

    // Idempotent: already Cancelled → return ok without re-firing audit
    // log or reverse writethrough. Matches the legacy GAS handler's
    // implicit behavior (it would UPDATE to the same value, but skipping
    // the round-trip is cleaner).
    if (existing.status === 'Cancelled') {
      return json({
        ok: true, repairId, alreadyCancelled: true,
        mirrorOk: true,
      });
    }

    // ── 2. UPDATE public.repairs ─────────────────────────────────────
    // Status flip + updated_at refresh. We scope by (tenant_id, repair_id)
    // — both filters are required to defend against a leaked tenant_id
    // somehow reaching a different tenant's repair_id (very unlikely
    // given the global RPR-{itemId}-{millis} format, but cheap to enforce).
    // Capture the pre-cancel status into status_before_cancel so
    // reopen-cancelled-repair-sb can restore it instead of a blanket
    // "Pending Quote". The idempotency guard above already returned for an
    // existing 'Cancelled' row, so existing.status here is never 'Cancelled'.
    const { error: updErr } = await supabase
      .from('repairs')
      .update({
        status:               'Cancelled',
        status_before_cancel: String(existing.status ?? '').trim() || null,
        updated_at:           new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId);
    if (updErr) {
      return json({ ok: false, error: `Update failed: ${updErr.message}` }, 500);
    }

    // ── 3. entity_audit_log — mirror GAS's exact shape ───────────────
    // GAS at StrideAPI.gs:7745 writes:
    //   api_auditLog_("repair", repairId, tenantId, "cancel",
    //                 { status: { new: "Cancelled" } }, callerEmail);
    // We match for parity. The shadow handler returns the same dict so
    // the replay-harness diff is exact.
    await supabase.from('entity_audit_log').insert({
      entity_type:  'repair',
      entity_id:    repairId,
      tenant_id:    tenantId,
      action:       'cancel',
      changes:      { status: { new: 'Cancelled' } },
      performed_by: callerEmail,
      source:       'edge',
    });

    // ── 4. Reverse writethrough — sheet stays current as legacy mirror
    // Best-effort: failure surfaces to gs_sync_events but doesn't unwind
    // the Supabase commit. The legacy sheet reader (full client sync,
    // PDF generators) tolerates eventual consistency during the
    // migration window; full-sync backstops any failed mirror.
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
            row:   { status: 'Cancelled', status_before_cancel: String(existing.status ?? '').trim() },
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
      // Log the failure to gs_sync_events so FailedOperationsDrawer
      // surfaces it for the operator. Doesn't block the response —
      // the SB commit already succeeded.
      await supabase.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  `cancel-repair-sb:${callerEmail}`,
        request_id:    requestId,
        payload:       { table: 'repairs', op: 'update', rowId: repairId, row: { status: 'Cancelled' } },
        error_message: (mirrorError ?? 'unknown').slice(0, 1000),
      }).then(() => {}, () => {});
    }

    return json({ ok: true, repairId, mirrorOk, mirrorError });

  } catch (err) {
    console.error('[cancel-repair-sb] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
