/**
 * re-quote-repair — [MIGRATION-P3] SB-primary handler for adding/removing
 * items on an in-flight repair without cancel-and-rebuild.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md.
 * Decisions: MIG-002 (synchronous SB→Sheets reverse writethrough).
 *
 * Allowed source statuses: 'Pending Quote', 'Quote Sent'.
 * Approved / In Progress / Complete / Cancelled / Declined → 422 INVALID_STATUS
 * (those are cancel-and-rebuild because modifying items after approval
 *  invalidates the customer agreement).
 *
 * Flow:
 *   1. Validate inputs (tenantId, repairId, non-empty itemIds).
 *   2. Call SECURITY DEFINER RPC `re_quote_repair`:
 *      • Verifies status is reQuotable
 *      • Validates every new item exists in tenant inventory
 *      • Atomic: DELETE existing repair_items → INSERT new → UPDATE repairs
 *        (status='Pending Quote', clear quote_*, approved=false, new
 *         primary item_id) → INSERT entity_audit_log row.
 *   3. Reverse-writethrough the parent repair row to the per-tenant
 *      Repairs sheet via P1.4 framework (status + quote-clears + new
 *      primary Item ID + Approved=false). Repair_Items sheet is NOT
 *      mirrored — same scope as the multi-item create flow; the SB row
 *      is canonical until P4a flips invoice generation.
 *   4. Return { ok, repairId, itemCount, oldItemIds, newItemIds, mirrorOk, mirrorError? }.
 *
 * Auth: verified caller email via supabase.auth.getUser(token) on an
 * anon-keyed client (mirrors cancel-repair-sb pattern). Service_role
 * path falls through to 'system' for the replay harness.
 *
 * Email: NOT sent here. After re-quote staff invokes the standard
 * sendRepairQuote flow which generates the new quote + sends the
 * customer-facing REPAIR_QUOTE email with the new item list.
 *
 * Request:  POST { tenantId, repairId, newItemIds[], requestId? }
 * Response: { ok, repairId, itemCount, oldItemIds[], newItemIds[],
 *             previousStatus, mirrorOk, mirrorError? }
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
    const tenantId: string = String(body.tenantId ?? '').trim();
    const repairId: string = String(body.repairId ?? '').trim();
    const newItemIds: string[] = Array.isArray(body.newItemIds)
      ? body.newItemIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const requestId: string = String(body.requestId ?? '').trim() || crypto.randomUUID();

    if (!tenantId)              return json({ ok: false, error: 'tenantId is required' }, 400);
    if (!repairId)              return json({ ok: false, error: 'repairId is required' }, 400);
    if (newItemIds.length === 0) return json({ ok: false, error: 'newItemIds must be a non-empty array' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    // Verified caller email — same pattern as start-repair-sb / cancel-repair-sb.
    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Snapshot previous status before the RPC overwrites it — used in the
    // response so the caller can confirm the source state for telemetry.
    const { data: snapshot } = await supabase
      .from('repairs')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .maybeSingle();
    const previousStatus: string = String(snapshot?.status ?? '').trim();

    // ── 1. Atomic swap via RPC ─────────────────────────────────────────
    const { data: rpcRows, error: rpcErr } = await supabase
      .rpc('re_quote_repair', {
        p_tenant_id:     tenantId,
        p_repair_id:     repairId,
        p_new_item_ids:  newItemIds,
        p_performed_by:  callerEmail,
      });

    if (rpcErr) {
      // Map the RPC's known SQLSTATEs to user-facing error codes. 22023
      // = invalid status / empty array; 02000 = not found; 23503 =
      // missing items; 42501 = role check. Rest fall through to 500.
      const code = (rpcErr as { code?: string }).code ?? '';
      const msg  = rpcErr.message ?? 'Unknown RPC error';
      console.error('[re-quote-repair] RPC failed:', code, msg);
      if (code === '22023') return json({ ok: false, error: msg, errorCode: 'INVALID_STATUS' }, 422);
      if (code === '02000') return json({ ok: false, error: msg, errorCode: 'NOT_FOUND' }, 404);
      if (code === '23503') return json({ ok: false, error: msg, errorCode: 'ITEM_NOT_FOUND' }, 422);
      if (code === '42501') return json({ ok: false, error: msg, errorCode: 'FORBIDDEN' }, 403);
      return json({ ok: false, error: `Re-quote failed: ${msg}` }, 500);
    }

    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!rpcRow?.repair_id) {
      return json({ ok: false, error: 'RPC returned no repair_id' }, 500);
    }
    const itemCount: number   = Number(rpcRow.item_count ?? newItemIds.length);
    const oldItemIds: string[] = Array.isArray(rpcRow.old_item_ids) ? rpcRow.old_item_ids : [];
    const returnedNewIds: string[] = Array.isArray(rpcRow.new_item_ids) ? rpcRow.new_item_ids : newItemIds;

    // ── 2. Reverse writethrough — mirror parent repair row to sheet ────
    // Field set matches what the RPC writes: status='Pending Quote',
    // quote_* fields cleared, approved=false, primary item_id is the
    // new first item. The __writeThroughReverseRepairs_ writer is
    // idempotent so retry on transient failure is safe.
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
            row: {
              status:                 'Pending Quote',
              item_id:                returnedNewIds[0],
              approved:               false,
              quote_amount:           null,
              quote_sent_date:        null,
              quote_lines_json:       null,
              quote_subtotal:         null,
              quote_taxable_subtotal: null,
              quote_tax_area_id:      null,
              quote_tax_area_name:    null,
              quote_tax_rate:         null,
              quote_tax_amount:       null,
              quote_grand_total:      null,
            },
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
      // Same gs_sync_events pattern as cancel-repair-sb. SB row is
      // canonical — sheet drift surfaces in FailedOperationsDrawer for
      // manual retry without blocking the user-visible state change.
      await supabase.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  `re-quote-repair:${callerEmail}`,
        request_id:    requestId,
        payload:       {
          table: 'repairs',
          op:    'update',
          rowId: repairId,
          row:   { status: 'Pending Quote', item_id: returnedNewIds[0], approved: false },
        },
        error_message: (mirrorError ?? 'unknown').slice(0, 1000),
      }).then(() => {}, () => {});
    }

    console.log(`[re-quote-repair] tenant=${tenantId} repair=${repairId} items: ${oldItemIds.length}→${itemCount} (prev=${previousStatus})`);
    return json({
      ok: true,
      repairId,
      itemCount,
      oldItemIds,
      newItemIds: returnedNewIds,
      previousStatus,
      mirrorOk,
      mirrorError,
    });

  } catch (err) {
    console.error('[re-quote-repair] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
