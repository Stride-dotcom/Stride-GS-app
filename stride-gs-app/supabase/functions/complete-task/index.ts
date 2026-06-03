/**
 * complete-task — [MIGRATION-P4a] SB-primary handler for `completeTask`.
 *
 * Sibling of complete-repair-sb; same structure/auth/idempotency. Per
 * MIG-004 the status flip + billing write + addon flush happen under
 * one logical transaction (the `complete_task_atomic` RPC); this edge
 * function handles the reverse writethrough (sheet mirror) and computes
 * the completion email payload OUTSIDE that transaction.
 *
 * Faithful port of StrideAPI.gs `handleCompleteTask_`. Differences vs
 * complete-repair-sb, all intentional:
 *   • Billing math is task-flavored (svcCode = tasks.type; service_catalog
 *     rate + bill_if_pass/bill_if_fail gate; client discount; inline
 *     custom-price override). All of it lives in the RPC for atomicity.
 *   • EMAIL: when this handler runs it IS the primary completion path
 *     (the parity shadow uses the separate complete-task-shadow EF, not
 *     this one), so GAS handleCompleteTask_ does not run and cannot send
 *     the completion email. This handler therefore OWNS the email — it
 *     sends TASK_COMPLETE / INSP_EMAIL via the send-email EF, gated on
 *     clients.enable_notifications (mirror of GAS's ENABLE_NOTIFICATIONS
 *     gate). No double-send risk: GAS only emails when IT completes, and
 *     it never completes a task this handler completed.
 *
 * Idempotency: RPC `skipped=true` when status already Completed/Cancelled
 * → return ok, skip mirror + email. send-email is also deduped on
 * `task-complete:{taskId}:{result}` so a retried POST won't double-send.
 *
 * Auth: JWT signature verified via supabase.auth.getUser(token) against
 * the anon-keyed client (NOT atob decode — the cancelRepair review
 * landmine; pattern carried through every P3/P4 handler).
 *
 * Request:  POST {
 *   tenantId, taskId, result: 'Pass'|'Fail',
 *   taskNotes?: string,
 *   customPrice?: number|null|undefined,  // number=set, null/""=clear, absent=no change
 *   requestId?: string
 * }
 * Response: { ok, taskId, result, skipped?, skipReason?,
 *             billingCount?, addonCount?, ledgerRowIds?, missingRate?,
 *             mirrorOk, mirrorError?, mirroredCount?,
 *             emailSent, emailError?, emailSkipped?,
 *             emailDryRun: { templateKey, tokens } | null }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = 'https://www.mystridehub.com';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string = String(body.tenantId ?? '').trim();
    const taskId:   string = String(body.taskId   ?? '').trim();
    const result:   string = String(body.result   ?? '').trim();
    const taskNotes: string | null = (body.taskNotes !== undefined && body.taskNotes !== null)
      ? String(body.taskNotes).trim() : null;
    const requestId: string = String(body.requestId ?? '').trim() || crypto.randomUUID();

    // Custom-price trichotomy (mirror GAS handleCompleteTask_):
    //   key absent              → no change
    //   null or ''              → clear the override
    //   number                  → set the override
    let clearCustomPrice = false;
    let customPrice: number | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'customPrice')) {
      if (body.customPrice === null || body.customPrice === '') {
        clearCustomPrice = true;
      } else {
        const n = Number(body.customPrice);
        if (Number.isNaN(n)) {
          return json({ ok: false, error: 'customPrice must be a number or null', errorCode: 'INVALID_PARAMS' }, 400);
        }
        customPrice = n;
      }
    }

    if (!tenantId) return json({ ok: false, error: 'tenantId is required' }, 400);
    if (!taskId)   return json({ ok: false, error: 'taskId is required' }, 400);
    if (result !== 'Pass' && result !== 'Fail') {
      return json({ ok: false, error: "result must be 'Pass' or 'Fail'", errorCode: 'INVALID_PARAMS' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    // ── Auth: verify JWT signature (not atob) ───────────────────────
    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Atomic RPC ───────────────────────────────────────────────
    const { data: rpcRows, error: rpcErr } = await supabase
      .rpc('complete_task_atomic', {
        p_tenant_id:          tenantId,
        p_task_id:            taskId,
        p_result:             result,
        p_task_notes:         taskNotes,
        p_custom_price:       customPrice,
        p_clear_custom_price: clearCustomPrice,
        p_created_by:         callerEmail,
      });
    if (rpcErr) {
      console.error('[complete-task] RPC failed:', rpcErr);
      return json({ ok: false, error: `Complete failed: ${rpcErr.message}` }, 500);
    }
    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!rpcRow) return json({ ok: false, error: 'RPC returned no rows' }, 500);

    if (rpcRow.skipped === true) {
      return json({
        ok: true, taskId, result,
        skipped: true, skipReason: String(rpcRow.skip_reason ?? ''),
        mirrorOk: true, emailDryRun: null,
      });
    }

    const ledgerRowIds: string[] = Array.isArray(rpcRow.ledger_row_ids) ? rpcRow.ledger_row_ids : [];
    const billingCount: number = Number(rpcRow.billing_count ?? 0);
    const addonCount:   number = Number(rpcRow.addon_count   ?? 0);
    const missingRate:  boolean = rpcRow.missing_rate === true;

    // ── 2. Reverse-writethrough each billing row to per-tenant sheet ─
    let mirrorOk = true;
    let mirrorError: string | undefined;
    let mirroredCount = 0;
    const gasUrl = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (ledgerRowIds.length > 0) {
      if (!gasUrl || !gasToken) {
        mirrorOk = false;
        mirrorError = 'GAS_API_URL or GAS_API_TOKEN not configured';
      } else {
        try {
          const { data: billRows } = await supabase
            .from('billing')
            .select('ledger_row_id, status, invoice_no, client_name, date, svc_code, svc_name, category, item_id, description, item_class, qty, rate, total, task_id, repair_id, shipment_number, item_notes, sidemark, reference')
            .eq('tenant_id', tenantId)
            .in('ledger_row_id', ledgerRowIds);
          for (const billRow of (billRows ?? []) as Array<Record<string, unknown>>) {
            try {
              const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tenantId, table: 'billing', op: 'insert',
                  rowId: String(billRow.ledger_row_id), row: billRow, requestId,
                }),
              });
              const text = await mirrorRes.text();
              let parsed: { success?: boolean; error?: string } = {};
              try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
              if (!mirrorRes.ok || !parsed.success) {
                mirrorOk = false;
                mirrorError = parsed.error ?? `HTTP ${mirrorRes.status}`;
                await supabase.from('gs_sync_events').insert({
                  tenant_id: tenantId, entity_type: 'billing',
                  entity_id: String(billRow.ledger_row_id),
                  action_type: 'writethrough_reverse', sync_status: 'sync_failed',
                  requested_by: `complete-task:${callerEmail}`, request_id: requestId,
                  payload: { table: 'billing', op: 'insert', rowId: billRow.ledger_row_id, row: billRow },
                  error_message: (mirrorError ?? 'unknown').slice(0, 1000),
                }).then(() => {}, () => {});
              } else {
                mirroredCount += 1;
              }
            } catch (mirrorEx) {
              mirrorOk = false;
              mirrorError = mirrorEx instanceof Error ? mirrorEx.message : String(mirrorEx);
            }
          }
        } catch (e) {
          mirrorOk = false;
          mirrorError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    // ── 3. Reverse-writethrough the tasks row ───────────────────────
    try {
      const { data: taskRow } = await supabase
        .from('tasks')
        .select('status, completed_at, result, task_notes, custom_price, billed')
        .eq('tenant_id', tenantId).eq('task_id', taskId).maybeSingle();
      if (taskRow && gasUrl && gasToken) {
        const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId, table: 'tasks', op: 'update',
            rowId: taskId, row: taskRow, requestId,
          }),
        });
        const text = await mirrorRes.text();
        let parsed: { success?: boolean; error?: string } = {};
        try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
        if (!mirrorRes.ok || !parsed.success) {
          mirrorOk = false;
          mirrorError = (mirrorError ? mirrorError + '; ' : '') + 'tasks mirror: ' + (parsed.error ?? `HTTP ${mirrorRes.status}`);
        }
      }
    } catch (e) {
      mirrorOk = false;
      mirrorError = (mirrorError ? mirrorError + '; ' : '') + 'tasks mirror: ' + (e instanceof Error ? e.message : String(e));
    }

    // ── 4. Send the completion email (INSP_EMAIL / TASK_COMPLETE) ───
    // This handler is the primary completion path, so it owns the email
    // (GAS handleCompleteTask_ doesn't run). Mirror of complete-repair-sb:
    // POST to send-email (Resend), which resolves recipients from the
    // template's `recipients` column ({{STAFF_EMAILS}},{{CLIENT_EMAIL}}
    // for INSP) using tenantId. GAS picks INSP_EMAIL when type contains
    // 'insp', else TASK_COMPLETE (StrideAPI.gs:19231). Gated on
    // clients.enable_notifications to match GAS's ENABLE_NOTIFICATIONS
    // check (StrideAPI.gs:19225). Non-fatal: completion already committed,
    // so any email failure is logged to gs_sync_events, not surfaced as a
    // call failure.
    let emailSent = false;
    let emailError: string | undefined;
    let emailSkipped: string | undefined;
    let emailPayload: { templateKey: string; tokens: Record<string, string> } | null = null;
    try {
      const { data: clientRow } = await supabase
        .from('clients').select('name, enable_notifications')
        .eq('tenant_id', tenantId).maybeSingle();
      const clientName = (clientRow as { name?: string } | null)?.name?.trim() || 'Client';
      const enableNotifications = (clientRow as { enable_notifications?: boolean } | null)?.enable_notifications;

      const { data: taskRow2 } = await supabase
        .from('tasks')
        .select('type, item_id, task_notes, shipment_number')
        .eq('tenant_id', tenantId).eq('task_id', taskId).maybeSingle();
      const taskType = String((taskRow2 as { type?: string } | null)?.type ?? '').trim();
      const itemId   = String((taskRow2 as { item_id?: string } | null)?.item_id ?? '').trim();
      const notes    = String((taskRow2 as { task_notes?: string } | null)?.task_notes ?? '');
      const shipNo   = String((taskRow2 as { shipment_number?: string } | null)?.shipment_number ?? '').trim();

      interface InvRow { description: string | null; vendor: string | null; sidemark: string | null; location: string | null; }
      const { data: invRow } = itemId
        ? await supabase.from('inventory')
            .select('description, vendor, sidemark, location')
            .eq('tenant_id', tenantId).eq('item_id', itemId).maybeSingle()
        : { data: null };
      const inv = invRow as InvRow | null;

      // SVC_NAME — service_catalog display name (TASK_COMPLETE uses it in
      // its subject + body). service_catalog is global (not tenant-scoped),
      // keyed by code; fall back to the raw type when no row matches.
      let svcName = taskType;
      if (taskType) {
        // Exact code match — NOT ilike: several codes contain '_'
        // (FAB_RUG, NO_ID, MULTI_INS) which ilike treats as a wildcard.
        // tasks.type and service_catalog.code share casing (both set from
        // the canonical svc code); fall back to the raw code on no match.
        const { data: svcRows } = await supabase
          .from('service_catalog').select('name').eq('code', taskType).limit(1);
        const nm = Array.isArray(svcRows) && svcRows[0]
          ? String((svcRows[0] as { name?: string }).name ?? '').trim() : '';
        if (nm) svcName = nm;
      }

      const isInsp = taskType.toLowerCase().includes('insp');
      const templateKey = isInsp ? 'INSP_EMAIL' : 'TASK_COMPLETE';
      const appDeepLink = `${APP_URL}/#/tasks?open=${encodeURIComponent(taskId)}&client=${encodeURIComponent(tenantId)}`;

      // Tokens cover both templates: INSP_EMAIL needs SHIPMENT_NO +
      // REPAIR_NOTE; TASK_COMPLETE needs SVC_NAME (incl. its subject) +
      // SHIPMENT_NO. REPAIR_NOTE is blank here (mirrors GAS).
      const tokens: Record<string, string> = {
        CLIENT_NAME:     clientName,
        TASK_ID:         taskId,
        ITEM_ID:         itemId,
        TASK_TYPE:       taskType,
        SVC_NAME:        svcName,
        RESULT:          result,
        RESULT_COLOR:    result === 'Pass' ? '#16A34A' : '#DC2626',
        TASK_NOTES:      notes || '-',
        SHIPMENT_NO:     shipNo || '-',
        REPAIR_NOTE:     '',
        ITEM_TABLE_HTML: renderItemTable(itemId, inv),
        APP_URL,
        APP_DEEP_LINK:   appDeepLink,
      };
      emailPayload = { templateKey, tokens };

      if (enableNotifications === false) {
        emailSkipped = 'notifications_disabled';
      } else {
        const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'apikey':         serviceKey,
            'Content-Type':   'application/json',
          },
          body: JSON.stringify({
            templateKey,
            tokens,
            // Dedupe per (task, result) so a retried completion POST — or
            // the user double-clicking Pass — sends at most one email.
            idempotencyKey:    `task-complete:${taskId}:${result}`,
            relatedEntityType: 'task',
            relatedEntityId:   taskId,
            tenantId,
          }),
        });
        const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
        if (sendJson.ok) emailSent = true;
        else emailError = String(sendJson.error ?? `HTTP ${sendRes.status}`);
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }
    if (emailError) {
      console.error('[complete-task] completion email failed:', emailError);
      await supabase.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'task', entity_id: taskId,
        action_type: 'send_task_complete_email', sync_status: 'sync_failed',
        requested_by: `complete-task:${callerEmail}`, request_id: requestId,
        payload: { templateKey: emailPayload?.templateKey ?? '', result },
        error_message: emailError.slice(0, 1000),
      }).then(() => {}, () => {});
    }

    return json({
      ok: true, taskId, result,
      billingCount, addonCount, ledgerRowIds, missingRate,
      mirrorOk, mirrorError, mirroredCount,
      emailSent, emailError, emailSkipped,
      // Retained for parity inspection / debugging — the exact payload
      // handed to send-email (was the `emailDryRun` field while this
      // handler was shadow-only and did not send).
      emailDryRun: emailPayload,
    });

  } catch (err) {
    console.error('[complete-task] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function renderItemTable(itemId: string, inv: {
  description: string | null; vendor: string | null;
  sidemark: string | null; location: string | null;
} | null): string {
  if (!itemId) return '';
  const td = 'padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#1F2937;vertical-align:top;';
  const th = 'padding:8px 10px;background:#F9FAFB;border-bottom:2px solid #D1D5DB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;text-align:left;';
  return [
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;">',
    '<thead><tr>',
    `<th style="${th}">Item ID</th>`,
    `<th style="${th}">Description</th>`,
    `<th style="${th}">Vendor</th>`,
    `<th style="${th}">Sidemark</th>`,
    `<th style="${th}">Location</th>`,
    '</tr></thead><tbody><tr>',
    `<td style="${td}font-family:monospace;font-size:12px;">${escapeHtml(itemId)}</td>`,
    `<td style="${td}">${escapeHtml(inv?.description ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(inv?.vendor ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(inv?.sidemark ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(inv?.location ?? '')}</td>`,
    '</tr></tbody></table>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
