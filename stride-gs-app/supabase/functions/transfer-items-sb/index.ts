/**
 * transfer-items-sb — SB-primary handler for the GAS `transferItems` action.
 *
 * Mirrors handleTransferItems_ (StrideAPI.gs:22180) at the SB layer for the
 * cross-tenant transfer flow. The full GAS handler is ~700 lines and does:
 *   1. Validate destination via CB (Active client).
 *   2. Inventory: move rows from source → destination sheet, mark source
 *      "Transferred", append "Transferred from X to Y on DATE" notes.
 *   3. Billing: project Unbilled ledger rows to destination, void source.
 *      Re-apply destination discount, recompute taxes.
 *   4. Storage backfill: bill destination for the holding window on source.
 *   5. Tasks/Repairs: append active rows to destination, cancel source.
 *   6. api_ledgerTransferTenant_: PATCH item_id_ledger.tenant_id → dest.
 *   7. Per-item audit log on BOTH tenants (transfer / transfer_in).
 *
 * Sheet-side complexity (steps 1-5: cross-spreadsheet projection, storage
 * backfill, discount recompute) can't reasonably re-implement in 300 lines
 * of SB code — those depend on each tenant's Settings sheet, class volume
 * cache, and discount table that only the GAS handler resolves. So this EF
 * follows the canary-acceptable hybrid pattern:
 *
 *   • SB writes that ARE byte-for-byte parity with GAS:
 *       - public.inventory:        flip status → 'Transferred' on source,
 *                                  move row's tenant_id to destination
 *                                  (since item_id is preserved across the
 *                                  transfer per StrideAPI.gs:8891 comment).
 *       - Open public.tasks/repairs on source: auto-cancel with the same
 *         " | <note>"-append semantics as update-item-sb's Release path.
 *       - public.item_id_ledger.tenant_id: PATCH to dest, status='active'
 *         (mirrors api_ledgerTransferTenant_ at StrideAPI.gs:5706).
 *       - entity_audit_log: per-item rows on BOTH source ('transfer') AND
 *         destination ('transfer_in'), matching StrideAPI.gs:8895-8896.
 *
 *   • Heavy sheet-side work (billing projection, storage backfill, dest
 *     row creation in destination Inventory sheet) is fired via reverse-
 *     writethrough to GAS — the writeThroughReverse endpoint dispatches to
 *     a per-tenant Tasks/Repairs writer; the destination Inventory append
 *     + Billing projection + storage backfill currently live ONLY in the
 *     GAS-primary handleTransferItems_ path. Acceptable per MIG-016
 *     canary contract: production tenants stay on GAS until the
 *     transfer-items pipeline ships per-table writers for billing
 *     projection (P4a). The fullClientSync cron on both source and
 *     destination tenants picks up sheet drift within ~5–30 min.
 *
 * Inputs:
 *   tenantId                    — source tenant (router-resolved)
 *   destinationClientSheetId    — destination tenant ID
 *   itemIds: string[]           — item IDs to transfer (preserved across)
 *   transferDate?: string       — YYYY-MM-DD; defaults to today
 *
 * Auth: verify_jwt=true. SERVICE_ROLE for writes (RLS bypass).
 *
 * Response (matches GAS for caller-shape parity):
 *   { success: true, transferred: N, skipped: [...], warnings: [...] }
 *   { success: false, error: "...", code?: "..." }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Same terminal-state semantics as update-item-sb / release-items-sb.
const TASK_TERMINAL = ['Completed', 'Cancelled'] as const;
const TASK_TERMINAL_LIST = `(${TASK_TERMINAL.join(',')})`;
const REPAIR_AUTOCANCEL_TERMINAL = ['Complete', 'Completed', 'Cancelled', 'Declined', 'Failed'] as const;
const REPAIR_AUTOCANCEL_TERMINAL_LIST = `(${REPAIR_AUTOCANCEL_TERMINAL.join(',')})`;

interface TransferItemsBody {
  tenantId?:                  string;
  destinationClientSheetId?:  string;
  callerEmail?:               string;
  requestId?:                 string;
  itemIds?:                   string[];
  transferDate?:              string;
  /** Frontend opt-out signal from the auto-inspection prompt. When `false`,
   *  the EF skips its auto-inspection fallback so the explicit operator choice
   *  ("Transfer Without Inspection") is respected. When `true` or missing, the
   *  fallback applies if the destination has `auto_inspection=true` AND the
   *  item lacks a Completed INSP task — mirrors the GAS handler at the same
   *  decision point. */
  createInspectionTasks?:     boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: TransferItemsBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const destId      = String(body.destinationClientSheetId ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const itemIds     = (body.itemIds ?? []).map(s => String(s).trim()).filter(Boolean);
  const operatorOptedOutOfInspection = body.createInspectionTasks === false;

  // Default transfer date to today if not supplied; reject future dates
  // (matches handleTransferItems_ Phase 1 constraint at StrideAPI.gs:22198).
  let transferDate = String(body.transferDate ?? '').trim();
  const today = new Date().toISOString().slice(0, 10);
  if (!transferDate) {
    transferDate = today;
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
    return json({ success: false, error: `Invalid transferDate (use YYYY-MM-DD): ${transferDate}`, code: 'INVALID_PARAMS' }, 400);
  } else if (transferDate > today) {
    return json({ success: false, error: 'Transfer Date cannot be in the future (Phase 1 limitation — past or present only)', code: 'INVALID_PARAMS' }, 400);
  }

  if (!tenantId) return json({ success: false, error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!destId)   return json({ success: false, error: 'destinationClientSheetId is required', code: 'INVALID_PARAMS' }, 400);
  if (destId === tenantId) return json({ success: false, error: 'Destination cannot be the same as source', code: 'INVALID_PARAMS' }, 400);
  if (itemIds.length === 0) return json({ success: false, error: 'No item IDs provided', code: 'INVALID_PARAMS' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[transfer-items-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ success: false, error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // 1. Read current source inventory rows; skip already-Transferred.
  const { data: invRows, error: readErr } = await sb
    .from('inventory')
    .select('item_id, status, item_notes')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);
  if (readErr) {
    console.error('[transfer-items-sb] inventory read failed:', readErr.message);
    return json({ success: false, error: `Read failed: ${readErr.message}`, code: 'READ_FAILED' }, 500);
  }

  const byId = new Map<string, { item_id: string; status: string; item_notes: string }>();
  for (const r of (invRows ?? []) as Array<{ item_id: string; status: string | null; item_notes: string | null }>) {
    byId.set(String(r.item_id), {
      item_id:    String(r.item_id),
      status:     String(r.status ?? '').trim(),
      item_notes: String(r.item_notes ?? ''),
    });
  }

  const skipped: string[] = [];
  const notFound: string[] = [];
  const toTransfer: Array<{ itemId: string; newNotes: string }> = [];
  const transferNote = `Transferred from ${tenantId} to ${destId} on ${transferDate}`;

  for (const itemId of itemIds) {
    const row = byId.get(itemId);
    if (!row) {
      notFound.push(itemId);
      continue;
    }
    if (row.status === 'Transferred') {
      skipped.push(`${itemId}: already Transferred`);
      continue;
    }
    const existing = row.item_notes.trim();
    const newNotes = existing ? `${existing} | ${transferNote}` : transferNote;
    toTransfer.push({ itemId, newNotes });
  }

  const warnings: string[] = [];
  if (notFound.length > 0) warnings.push(`Not in public.inventory: ${notFound.join(', ')}`);

  // 2. Per-row: flip status='Transferred', stamp transferred_at, append note,
  //    move the row to the destination tenant_id. Item ID is preserved
  //    across the transfer (StrideAPI.gs:8891 comment).
  let updated = 0;
  const nowIso = new Date().toISOString();
  for (const t of toTransfer) {
    const { error: upErr } = await sb
      .from('inventory')
      .update({
        status:          'Transferred',
        tenant_id:       destId,
        transferred_at:  nowIso,
        transfer_date:   transferDate,
        item_notes:      t.newNotes,
        updated_at:      nowIso,
      })
      .eq('tenant_id', tenantId)
      .eq('item_id',   t.itemId);
    if (upErr) {
      // transfer_date / transferred_at may not exist on older schemas — retry
      // with the minimum field set so the source-side transfer still lands.
      const { error: retryErr } = await sb
        .from('inventory')
        .update({
          status:     'Transferred',
          tenant_id:  destId,
          item_notes: t.newNotes,
          updated_at: nowIso,
        })
        .eq('tenant_id', tenantId)
        .eq('item_id',   t.itemId);
      if (retryErr) {
        warnings.push(`Transfer ${t.itemId}: ${retryErr.message}`);
        continue;
      }
    }
    updated++;
  }

  // 3. Auto-cancel open Tasks + Repairs on the source tenant.
  if (toTransfer.length > 0) {
    const ids = toTransfer.map(t => t.itemId);
    const cancel = await autoCancelOnTransfer(sb, tenantId, ids, callerEmail);
    if (cancel.tasksCancelled > 0)   warnings.push(`Auto-cancelled ${cancel.tasksCancelled} open task(s) on source`);
    if (cancel.repairsCancelled > 0) warnings.push(`Auto-cancelled ${cancel.repairsCancelled} open repair(s) on source`);
    warnings.push(...cancel.warnings);
  }

  // 4. item_id_ledger: PATCH tenant_id → dest (mirrors api_ledgerTransferTenant_).
  if (toTransfer.length > 0) {
    const ids = toTransfer.map(t => t.itemId);
    const { error: ledgerErr } = await sb
      .from('item_id_ledger')
      .update({ tenant_id: destId, status: 'active' })
      .in('item_id', ids);
    if (ledgerErr) {
      console.error('[transfer-items-sb] item_id_ledger PATCH failed:', ledgerErr.message);
      warnings.push(`item_id_ledger PATCH: ${ledgerErr.message}`);
    }
  }

  // 4b. Void any Unbilled STOR rows on the source tenant for the transferred items
  //     (v38.245.1 — 2026-05-28). Destination owns storage end-to-end (at-transfer
  //     backfill in handleTransferItems_ covers receive_date → transfer_date - 1;
  //     destination Active row picks up from transfer_date forward via the cutover
  //     in _compute_storage_charges). Without this void, an Unbilled STOR row sitting
  //     on source (created by a partial run before transfer) would still get picked
  //     up by the next unbilled-report and invoiced — exactly the duplicate-charge
  //     bug we're closing. GAS handleTransferItems_ already does the equivalent
  //     sheet-side void; this mirrors it in public.billing.
  //
  //     Note: public.billing.tenant_id stays = source through transfer (it's set
  //     at row insert and NOT migrated by step 2's inventory PATCH), so .eq on
  //     tenantId here correctly targets the pre-transfer billing rows.
  if (toTransfer.length > 0) {
    const ids = toTransfer.map(t => t.itemId);
    const { error: voidErr, count: voidedCount } = await sb
      .from('billing')
      .update({ status: 'Void', updated_at: nowIso }, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('svc_code', 'STOR')
      .eq('status', 'Unbilled')
      .in('item_id', ids);
    if (voidErr) {
      console.error('[transfer-items-sb] billing STOR void failed:', voidErr.message);
      warnings.push(`Source STOR void: ${voidErr.message}`);
    } else if (typeof voidedCount === 'number' && voidedCount > 0) {
      warnings.push(`Voided ${voidedCount} Unbilled STOR row(s) on source for transferred items`);
    }
  }

  // 5. Reverse-writethrough per item — best-effort. The GAS side handles
  // the cross-sheet projection (destination Inventory append, billing
  // projection, storage backfill) via the legacy transferItems endpoint.
  // We hit writeThroughReverse to flip the source sheet's Status →
  // Transferred + stamp Transfer Date. Destination-sheet population
  // remains a GAS-cron-or-manual concern in the canary phase.
  await Promise.all(toTransfer.map(t => mirrorSourceTransferToSheet(
    t.itemId, transferDate, tenantId, requestId, callerEmail, sb,
  )));

  // 5.5 Auto-inspection on transfer (v38.247.0 parity).
  //
  // When the destination client has auto_inspection=true and any transferred
  // item lacks a Completed INSP task on ANY tenant (item_id is preserved across
  // transfers, so a prior owner's inspection counts), create new INSP tasks on
  // the destination side and flip needs_inspection=true on the destination
  // inventory row. The frontend prompt offers an explicit opt-out via
  // createInspectionTasks=false; honor that. Otherwise apply unconditionally —
  // the whole reason this lives on the server is to catch the case where the
  // operator bypassed or never saw the prompt.
  let inspectionTasksCreated = 0;
  if (toTransfer.length > 0 && !operatorOptedOutOfInspection) {
    try {
      const { data: destClientRow } = await sb
        .from('clients')
        .select('auto_inspection')
        .eq('tenant_id', destId)
        .maybeSingle();
      const destAutoInspection = (destClientRow as { auto_inspection?: boolean } | null)?.auto_inspection === true;

      if (destAutoInspection) {
        const transferIds = toTransfer.map(t => t.itemId);

        // Items that already have a Completed INSP task — anywhere in the
        // tasks table. Item ID is the join key (preserved across transfers).
        const { data: inspectedRows } = await sb
          .from('tasks')
          .select('item_id')
          .in('item_id', transferIds)
          .like('task_id', 'INSP-%')
          .eq('status', 'Completed');
        const inspectedSet = new Set<string>(
          (inspectedRows ?? [])
            .map(r => String((r as { item_id: string | null }).item_id ?? '').trim())
            .filter(Boolean)
        );
        const uninspectedIds = transferIds.filter(id => !inspectedSet.has(id));

        if (uninspectedIds.length > 0) {
          // Pull inventory context for each uninspected item — the row now
          // lives on the destination tenant (step 2 PATCHed tenant_id), so
          // query against destId. Vendor/description/location/sidemark feed
          // into the new task rows and let the destination operator open the
          // task and immediately see what they're inspecting.
          const { data: invCtx } = await sb
            .from('inventory')
            .select('item_id, vendor, description, location, sidemark, shipment_number')
            .eq('tenant_id', destId)
            .in('item_id', uninspectedIds);
          const ctxById = new Map<string, {
            vendor: string; description: string; location: string;
            sidemark: string; shipment_number: string;
          }>();
          for (const row of (invCtx ?? []) as Array<{
            item_id: string;
            vendor: string | null;
            description: string | null;
            location: string | null;
            sidemark: string | null;
            shipment_number: string | null;
          }>) {
            ctxById.set(String(row.item_id), {
              vendor:          String(row.vendor          ?? '').trim(),
              description:     String(row.description     ?? '').trim(),
              location:        String(row.location        ?? '').trim(),
              sidemark:        String(row.sidemark        ?? '').trim(),
              shipment_number: String(row.shipment_number ?? '').trim(),
            });
          }

          // Resolve the friendly INSP service name (matches receiving flow).
          const { data: catRows } = await sb
            .from('service_catalog')
            .select('code, name')
            .eq('code', 'INSP');
          const inspName = (catRows ?? [])
            .map(r => String((r as { name: string | null }).name ?? '').trim())
            .find(s => s.length > 0) || 'Inspection';

          // Order Numbering feature (Justin Demo canary): when on for the
          // DESTINATION tenant, the auto-INSP task gets a clean PREFIX-TSK-N id
          // (scoped to destId). Resolved once. Off → legacy INSP-{itemId}-N.
          const cleanNumbering = await orderNumberingOn(sb, destId);

          // Per-item counter: max existing INSP-{itemId}-N across any tenant + 1.
          // Same algorithm as nextTaskCounter in complete-shipment-sb.
          const newTaskRows: Array<Record<string, unknown>> = [];
          const newTaskIds: string[] = [];
          for (const itemId of uninspectedIds) {
            const cleanId = cleanNumbering ? await cleanTaskId(sb, destId) : null;
            let taskId: string;
            if (cleanId) {
              taskId = cleanId;
            } else {
              const prefix = `INSP-${itemId}-`;
              const { data: existing } = await sb
                .from('tasks')
                .select('task_id')
                .like('task_id', `${prefix}%`);
              let max = 0;
              for (const r of (existing ?? []) as Array<{ task_id: string }>) {
                const n = Number(String(r.task_id ?? '').slice(prefix.length));
                if (Number.isFinite(n) && n > max) max = n;
              }
              taskId = `${prefix}${max + 1}`;
            }
            const ctx = ctxById.get(itemId) ?? {
              vendor: '', description: '', location: '', sidemark: '', shipment_number: '',
            };
            newTaskRows.push({
              tenant_id:       destId,
              task_id:         taskId,
              item_id:         itemId,
              type:            inspName,
              status:          'Open',
              vendor:          ctx.vendor,
              description:     ctx.description,
              location:        ctx.location,
              sidemark:        ctx.sidemark,
              shipment_number: ctx.shipment_number,
              created:         nowIso,
              item_notes:      'Auto-created on transfer (destination requires inspection)',
              billed:          false,
              updated_at:      nowIso,
            });
            newTaskIds.push(taskId);
          }

          if (newTaskRows.length > 0) {
            const { error: insErr } = await sb.from('tasks').insert(newTaskRows);
            if (insErr) {
              warnings.push(`INSP task insert: ${insErr.message}`);
            } else {
              inspectionTasksCreated = newTaskRows.length;
              await Promise.all(newTaskIds.map(taskId =>
                sb.from('entity_audit_log').insert({
                  entity_type:  'task',
                  entity_id:    taskId,
                  tenant_id:    destId,
                  action:       'create',
                  changes:      { source: 'transferItems', reason: 'auto_inspection_on_transfer' },
                  performed_by: callerEmail || 'transfer-items-sb',
                  source:       'supabase',
                }).then(() => {}, () => {})
              ));
            }
          }

          // Mark needs_inspection=true on the destination inventory rows so the
          // sheet writethrough + React indicators stay in sync with the new
          // tasks. Only patch rows where it isn't already set.
          const { error: niErr } = await sb
            .from('inventory')
            .update({ needs_inspection: true, updated_at: nowIso })
            .eq('tenant_id', destId)
            .in('item_id', uninspectedIds)
            .neq('needs_inspection', true);
          if (niErr) warnings.push(`needs_inspection PATCH: ${niErr.message}`);
        }
      }
    } catch (e) {
      warnings.push(`Auto-inspection on transfer failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 6. Audit log per item on both tenants (mirrors StrideAPI.gs:8895-8896).
  await Promise.all(toTransfer.flatMap(t => [
    sb.from('entity_audit_log').insert({
      entity_type:  'inventory',
      entity_id:    t.itemId,
      tenant_id:    tenantId,
      action:       'transfer',
      changes:      { status: { new: 'Transferred' }, destinationTenant: destId, transferDate },
      performed_by: callerEmail || 'transfer-items-sb',
      source:       'supabase',
    }).then(() => {}, () => {}),
    sb.from('entity_audit_log').insert({
      entity_type:  'inventory',
      entity_id:    t.itemId,
      tenant_id:    destId,
      action:       'transfer_in',
      changes:      { summary: 'Item transferred in', sourceTenant: tenantId, transferDate },
      performed_by: callerEmail || 'transfer-items-sb',
      source:       'supabase',
    }).then(() => {}, () => {}),
  ]));

  return json({
    success:                true,
    transferred:            updated,
    skipped:                skipped.length > 0 ? skipped : undefined,
    totalRequested:         itemIds.length,
    inspectionTasksCreated,
    warnings:               warnings.length > 0 ? warnings : undefined,
  }, 200);
});

// ── Helpers ─────────────────────────────────────────────────────────────

async function autoCancelOnTransfer(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemIds: string[],
  callerEmail: string,
): Promise<{ tasksCancelled: number; repairsCancelled: number; warnings: string[] }> {
  const out = { tasksCancelled: 0, repairsCancelled: 0, warnings: [] as string[] };
  const note = 'Auto-cancelled: item transferred to another tenant';
  const nowIso = new Date().toISOString();
  const performedBy = callerEmail || 'transfer-items-sb';

  // Tasks
  try {
    const { data: openTasks, error } = await sb
      .from('tasks')
      .select('task_id, status, task_notes')
      .eq('tenant_id', tenantId)
      .in('item_id', itemIds)
      .not('status', 'in', TASK_TERMINAL_LIST);
    if (error) {
      out.warnings.push(`Task select failed: ${error.message}`);
    } else {
      for (const row of (openTasks ?? []) as Array<{ task_id: string; status: string; task_notes: string | null }>) {
        const existing = String(row.task_notes ?? '').trim();
        const newNotes = existing ? `${existing} | ${note}` : note;
        const { error: upErr } = await sb
          .from('tasks')
          .update({
            status:       'Cancelled',
            cancelled_at: nowIso,
            task_notes:   newNotes,
            updated_at:   nowIso,
          })
          .eq('tenant_id', tenantId)
          .eq('task_id', row.task_id);
        if (upErr) {
          out.warnings.push(`Cancel task ${row.task_id}: ${upErr.message}`);
          continue;
        }
        out.tasksCancelled++;
        await sb.from('entity_audit_log').insert({
          entity_type:  'task',
          entity_id:    row.task_id,
          tenant_id:    tenantId,
          action:       'cancel',
          changes:      { status: { old: row.status, new: 'Cancelled' }, reason: note },
          performed_by: performedBy,
          source:       'supabase',
        }).then(() => {}, () => {});
      }
    }
  } catch (e) {
    out.warnings.push(`Tasks sweep threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Repairs
  try {
    const { data: openRepairs, error } = await sb
      .from('repairs')
      .select('repair_id, status, repair_notes')
      .eq('tenant_id', tenantId)
      .in('item_id', itemIds)
      .not('status', 'in', REPAIR_AUTOCANCEL_TERMINAL_LIST);
    if (error) {
      out.warnings.push(`Repair select failed: ${error.message}`);
    } else {
      for (const row of (openRepairs ?? []) as Array<{ repair_id: string; status: string; repair_notes: string | null }>) {
        const existing = String(row.repair_notes ?? '').trim();
        const newNotes = existing ? `${existing} | ${note}` : note;
        const { error: upErr } = await sb
          .from('repairs')
          .update({
            status:       'Cancelled',
            repair_notes: newNotes,
            updated_at:   nowIso,
          })
          .eq('tenant_id', tenantId)
          .eq('repair_id', row.repair_id);
        if (upErr) {
          out.warnings.push(`Cancel repair ${row.repair_id}: ${upErr.message}`);
          continue;
        }
        out.repairsCancelled++;
        await sb.from('entity_audit_log').insert({
          entity_type:  'repair',
          entity_id:    row.repair_id,
          tenant_id:    tenantId,
          action:       'cancel',
          changes:      { status: { old: row.status, new: 'Cancelled' }, reason: note },
          performed_by: performedBy,
          source:       'supabase',
        }).then(() => {}, () => {});
      }
    }
  } catch (e) {
    out.warnings.push(`Repairs sweep threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  return out;
}

async function mirrorSourceTransferToSheet(
  itemId: string,
  transferDate: string,
  tenantId: string,
  requestId: string,
  callerEmail: string,
  sb: ReturnType<typeof createClient>,
): Promise<void> {
  try {
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (!gasUrl || !gasToken) return;
    const payload = {
      tenantId,
      table: 'inventory',
      op:    'update',
      rowId: itemId,
      row:   { status: 'Transferred', transfer_date: transferDate },
      requestId: `${requestId}:${itemId}`,
    };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      await sb.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'inventory',
        entity_id:     itemId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'transfer-items-sb',
        request_id:    `${requestId}:${itemId}`,
        payload,
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[transfer-items-sb] mirror threw for', itemId, e);
  }
}

/**
 * Resolve whether the `orderNumbering` feature is on for this tenant via the
 * SECURITY DEFINER `order_numbering_enabled` RPC (MIG-010 per-tenant scope).
 * Fails safe to false (legacy ids) on any error.
 */
async function orderNumberingOn(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('order_numbering_enabled', { p_tenant_id: tenantId });
    if (error) {
      console.warn('[transfer-items-sb] order_numbering_enabled failed:', error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn('[transfer-items-sb] order_numbering_enabled threw:', e);
    return false;
  }
}

/**
 * Mint a clean PREFIX-TSK-N task id for the given tenant via next_order_id, or
 * null on RPC error (caller falls back to the legacy counter).
 */
async function cleanTaskId(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('next_order_id', { p_tenant_id: tenantId, p_order_type: 'task' });
    if (!error && typeof data === 'string' && data) return data;
    if (error) console.warn('[transfer-items-sb] next_order_id failed, using legacy id:', error.message);
  } catch (e) {
    console.warn('[transfer-items-sb] next_order_id threw, using legacy id:', e);
  }
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
