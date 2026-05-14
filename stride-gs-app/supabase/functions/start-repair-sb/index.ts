/**
 * start-repair-sb — [MIGRATION-P3] SB-primary handler for `startRepair`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-002 (synchronous SB→Sheets reverse writethrough), MIG-007
 *            (three-layer verification, Path-C variant per MIG-013).
 *
 * Behavior mirrors GAS handleStartRepair_:
 *   • Allowed source statuses: 'Approved', 'In Progress', 'Complete'
 *     (the latter two are "reRun" — repaint PDF without mutating state)
 *   • Pre-approval / cancelled / declined → 422 INVALID_STATUS
 *   • First legitimate start (status='Approved'): flip to 'In Progress'
 *     + stamp start_date = now (today's date in PST, matching the GAS
 *     `repSheet.setValue(now)` pattern which writes a Date object that
 *     Google Sheets renders as the local-time string).
 *   • Re-run on already-started/completed: ok=true, no state mutation,
 *     but DO write the audit-log row (matches GAS pattern — the audit
 *     entry tracks the start action, not the state transition).
 *   • Work order PDF: NOT generated here. React's lib/workOrderPdf.ts
 *     covers the operator-facing "Print Work Order" button. The legacy
 *     GAS-side server-rendered PDF flow is retired in this migration.
 *
 * Audit log shape: { status: { new: 'In Progress' } } — matches GAS
 * StrideAPI.gs:7811 exactly so the shadow comparison stays 1:1.
 *
 * Auth: verified caller email via supabase.auth.getUser(token) on an
 * anon-keyed client (mirrors cancel-repair-sb pattern). Falls back to
 * 'system' on service_role JWTs (replay-harness path).
 *
 * Request:  POST { tenantId, repairId, requestId? }
 * Response: { ok, repairId, previousStatus, alreadyStarted?, mirrorOk, mirrorError? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Status the repair must currently be in to start. v38.51.7 widened
// this to allow PDF-regen calls when already In Progress/Complete.
const ALLOWED_SOURCE_STATUSES = new Set(['Approved', 'In Progress', 'Complete']);
const RERUN_STATUSES          = new Set(['In Progress', 'Complete']);

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

    // Verified caller email — same pattern as cancel-repair-sb. anon JWT
    // path (signature-validated by the gateway) populates user.email when
    // present; service_role / unauthenticated path falls through to 'system'.
    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Pre-check: load existing status ───────────────────────────
    const { data: existing, error: existingErr } = await supabase
      .from('repairs')
      .select('repair_id, status, start_date')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: `Repair lookup failed: ${existingErr.message}` }, 500);
    if (!existing)   return json({ ok: false, error: `Repair ${repairId} not found` }, 404);

    const previousStatus = String(existing.status ?? '').trim();
    if (!ALLOWED_SOURCE_STATUSES.has(previousStatus)) {
      return json({
        ok: false,
        error: `Work Order can only be generated for Approved, In Progress, or Complete repairs (current: ${previousStatus})`,
        errorCode: 'INVALID_STATUS',
      }, 422);
    }
    const isReRun = RERUN_STATUSES.has(previousStatus);

    // ── 2. UPDATE public.repairs — only on first legitimate start ────
    // Re-run calls don't mutate state but still write the audit row
    // below, matching the legacy GAS behavior at handleStartRepair_:19196.
    if (!isReRun) {
      // start_date is a TEXT column on public.repairs (per Phase 1a
      // schema); store the local PT date in YYYY-MM-DD form to match
      // the rest of the per-tenant Repairs sheet's Start Date column
      // convention (which renders Date objects as that string in the
      // sheet's locale).
      const ptDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });  // YYYY-MM-DD
      const { error: updErr } = await supabase
        .from('repairs')
        .update({
          status:     'In Progress',
          start_date: ptDate,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('repair_id', repairId);
      if (updErr) return json({ ok: false, error: `Update failed: ${updErr.message}` }, 500);
    }

    // ── 3. entity_audit_log — fixed-shape mirror of GAS:7811 ─────────
    await supabase.from('entity_audit_log').insert({
      entity_type:  'repair',
      entity_id:    repairId,
      tenant_id:    tenantId,
      action:       'start',
      changes:      { status: { new: 'In Progress' } },
      performed_by: callerEmail,
      source:       'edge',
    });

    // ── 4. Reverse writethrough — sheet mirror via P1.4 framework ─────
    // On reRun the sheet state is already correct (status='In Progress'
    // or 'Complete') so the writer's idempotency check returns
    // skipped=true without writing. Cheap.
    let mirrorOk = true;
    let mirrorError: string | undefined;
    try {
      const gasUrl = Deno.env.get('GAS_API_URL');
      const gasToken = Deno.env.get('GAS_API_TOKEN');
      if (gasUrl && gasToken && !isReRun) {
        // Skip the mirror call entirely on reRun — nothing to change.
        const ptDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
        const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            table: 'repairs',
            op:    'update',
            rowId: repairId,
            row:   { status: 'In Progress', start_date: ptDate },
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
      } else if (!gasUrl || !gasToken) {
        mirrorOk = false;
        mirrorError = 'GAS_API_URL or GAS_API_TOKEN not configured';
      }
    } catch (e) {
      mirrorOk = false;
      mirrorError = e instanceof Error ? e.message : String(e);
    }

    if (!mirrorOk && !isReRun) {
      // Same gs_sync_events pattern as cancel-repair-sb. Note: only logged
      // when we actually attempted a mirror (skipped on reRun).
      await supabase.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  `start-repair-sb:${callerEmail}`,
        request_id:    requestId,
        payload:       { table: 'repairs', op: 'update', rowId: repairId, row: { status: 'In Progress' } },
        error_message: (mirrorError ?? 'unknown').slice(0, 1000),
      }).then(() => {}, () => {});
    }

    return json({
      ok: true, repairId, previousStatus,
      alreadyStarted: isReRun,
      mirrorOk, mirrorError,
    });

  } catch (err) {
    console.error('[start-repair-sb] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
