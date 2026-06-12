/**
 * reopen-task-sb — SB-primary handler for `reopenTask`.
 *
 * Mirrors GAS handleReopenTask_ (StrideAPI.gs:30705). Reopens a Completed
 * or In Progress task. For Completed: voids all Unbilled billing rows linked
 * to the task and reverts to 'In Progress' (clears completed_at, result).
 * For In Progress: reverts to 'Open' (clears started_at, assigned_to).
 * Returns BILLING_LOCKED if any related billing row is past Unbilled.
 *
 * Payload:  { tenantId, taskId, reason?, callerEmail?, requestId? }
 * Response: { success, taskId, newStatus, voidedBillingRows: string[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const body = await req.json().catch(() => ({}));
  const tenantId    = String(body.tenantId    ?? '').trim();
  const taskId      = String(body.taskId      ?? '').trim();
  const reason      = String(body.reason      ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ success: false, error: 'tenantId is required' }, 400);
  if (!taskId)   return json({ success: false, error: 'taskId is required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: prev, error: prevErr } = await sb
    .from('tasks')
    .select('task_id, status')
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId)
    .maybeSingle();
  if (prevErr) return json({ success: false, error: `Read failed: ${prevErr.message}` }, 500);
  if (!prev)   return json({ success: false, error: `Task not found: ${taskId}`, code: 'NOT_FOUND' }, 404);

  const status = String((prev as { status?: string }).status ?? '').trim();
  let newStatus: string;
  let updates: Record<string, unknown>;
  const voidedBillingRows: string[] = [];
  // Stamped onto each voided billing row; reused when mirroring the Void
  // back to the per-tenant Billing_Ledger sheet (see mirrorBillingVoid).
  let voidStampedReason = '';

  if (status === 'Completed') {
    // Check billing rows linked to this task.
    const { data: billRows, error: bErr } = await sb
      .from('billing')
      .select('ledger_row_id, status')
      .eq('tenant_id', tenantId)
      .eq('task_id', taskId);
    if (bErr) return json({ success: false, error: `Billing read failed: ${bErr.message}` }, 500);

    const blocked: Array<{ ledgerRowId: string; status: string }> = [];
    const unbilledIds: string[] = [];
    for (const r of (billRows ?? []) as Array<{ ledger_row_id: string; status: string }>) {
      const st = String(r.status ?? '').trim();
      if (st === 'Unbilled') unbilledIds.push(r.ledger_row_id);
      else if (st !== 'Void') blocked.push({ ledgerRowId: r.ledger_row_id, status: st });
    }

    if (blocked.length > 0) {
      return json({
        success: false,
        error: `Cannot reopen — ${blocked.length} billing row(s) already past Unbilled (${blocked.map(b => b.status).join(', ')}). Void the invoice first.`,
        code: 'BILLING_LOCKED',
      }, 409);
    }

    if (unbilledIds.length > 0) {
      voidStampedReason = `Task ${taskId} reopened by ${callerEmail || '?'}${reason ? ': ' + reason : ''}`;
      const { error: voidErr } = await sb
        .from('billing')
        .update({ status: 'Void', item_notes: voidStampedReason, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .in('ledger_row_id', unbilledIds);
      if (voidErr) return json({ success: false, error: `Billing void failed: ${voidErr.message}` }, 500);
      voidedBillingRows.push(...unbilledIds);
    }

    newStatus = 'In Progress';
    updates = {
      status: newStatus,
      completed_at: null,
      result: null,
      updated_at: new Date().toISOString(),
    };
  } else if (status === 'In Progress') {
    newStatus = 'Open';
    updates = {
      status: newStatus,
      started_at: null,
      assigned_to: null,
      updated_at: new Date().toISOString(),
    };
  } else {
    return json({
      success: false,
      error: `Task status '${status}' cannot be reopened (only Completed or In Progress)`,
      code: 'INVALID_STATE',
    }, 400);
  }

  const { error: upErr } = await sb
    .from('tasks')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId);
  if (upErr) return json({ success: false, error: `Update failed: ${upErr.message}` }, 500);

  await sb.from('entity_audit_log').insert({
    entity_type:  'task',
    entity_id:    taskId,
    tenant_id:    tenantId,
    action:       'reopen',
    changes:      { reason: reason.slice(0, 200), newStatus, voidedBillingRows: voidedBillingRows.length },
    performed_by: callerEmail || 'reopen-task-sb',
    source:       'supabase',
  }).then(() => {}, () => {});

  void mirror(tenantId, taskId, updates, requestId, callerEmail, sb);

  // Mirror the billing Void to the per-tenant Billing_Ledger sheet. The SB
  // billing table is voided above, but that sheet is still the SOURCE OF
  // TRUTH consumed by invoice-PDF generation, CB Consolidated_Ledger
  // aggregation, and QBO/IIF export. Without this, a reopened task's charge
  // stays Unbilled on the sheet and can be re-billed downstream — exactly
  // the double-bill the reopen-void is meant to prevent. The GAS path
  // (handleReopenTask_ → api_voidBillingRowsWhere_) already does this; this
  // brings the SB-primary path to parity. Best-effort: a sheet-mirror
  // failure must not undo the SB-side void (the React Billing report reads
  // public.billing, which is already correct).
  if (voidedBillingRows.length > 0) {
    void mirrorBillingVoid(tenantId, voidedBillingRows, voidStampedReason, requestId, callerEmail, sb);
  }

  return json({ success: true, taskId, newStatus, voidedBillingRows });
});

async function mirror(
  tenantId: string, taskId: string, row: Record<string, unknown>,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'tasks', op: 'update', rowId: taskId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'task', entity_id: taskId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail || 'reopen-task-sb', request_id: requestId,
        payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[reopen-task-sb] mirror threw:', e); }
}

/**
 * Mirror the billing Void to the per-tenant Billing_Ledger sheet, one
 * reverse-writethrough per voided Ledger Row ID. Routes through the GAS
 * `writeThroughReverse` action → `__writeThroughReverseBilling_`, which
 * finds the row by Ledger Row ID and flips Status→'Void' in place (it
 * refuses to touch an already-Invoiced row, so this can't un-invoice
 * anything). Best-effort: each failure is logged to gs_sync_events for
 * observability but never blocks — the SB-side void already committed.
 */
async function mirrorBillingVoid(
  tenantId: string, ledgerRowIds: string[], stampedReason: string,
  requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  for (const ledgerRowId of ledgerRowIds) {
    const payload = {
      tenantId, table: 'billing', op: 'update', rowId: ledgerRowId,
      row: { ledger_row_id: ledgerRowId, status: 'Void', item_notes: stampedReason },
      requestId,
    };
    try {
      const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        await sb.from('gs_sync_events').insert({
          tenant_id: tenantId, entity_type: 'billing', entity_id: ledgerRowId,
          action_type: 'writethrough_reverse', sync_status: 'sync_failed',
          requested_by: callerEmail || 'reopen-task-sb', request_id: requestId,
          payload, error_message: `HTTP ${res.status}`,
        }).then(() => {}, () => {});
      }
    } catch (e) { console.warn('[reopen-task-sb] billing-void mirror threw:', e); }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
