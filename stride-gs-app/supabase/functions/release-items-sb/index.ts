/**
 * release-items-sb — SB-primary handler for `releaseItems`.
 *
 * Replaces GAS `handleReleaseItems_` (StrideAPI.gs:21280). Bulk-release
 * inventory items by Item ID:
 *   1. Read current inventory rows; skip items already Released/Transferred.
 *   2. UPDATE public.inventory: status='Released', release_date,
 *      item_notes (append " | Released DATE by USER on DATE [— notes]").
 *   3. Auto-cancel open Tasks + Repairs for the released set (mirrors
 *      api_cancelOpenWorkOnRelease_).
 *   4. Reverse-writethrough per item to per-tenant Inventory sheet.
 *   5. Audit log per released item.
 *
 * Response shape mirrors GAS:
 *   { success, releasedCount, skipped, totalRequested, warnings }
 *
 * Project context: MIG-016 canary path. Sheet drift on the cascade
 * rows (Tasks/Repairs cancellations) is canary-acceptable per the
 * MIG-016 decision; tasks reverse-writethrough writer ships in v38.227
 * alongside this EF, so task cancel-row mirrors will land too.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TASK_TERMINAL = ['Completed', 'Cancelled'] as const;
const TASK_TERMINAL_LIST = `(${TASK_TERMINAL.join(',')})`;
const REPAIR_AUTOCANCEL_TERMINAL = ['Complete', 'Completed', 'Cancelled', 'Declined', 'Failed'] as const;
const REPAIR_AUTOCANCEL_TERMINAL_LIST = `(${REPAIR_AUTOCANCEL_TERMINAL.join(',')})`;

interface ReleaseItemsBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  itemIds?: string[];
  releaseDate?: string;        // YYYY-MM-DD
  notes?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: ReleaseItemsBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const tenantId       = String(body.tenantId    ?? '').trim();
  const callerEmail    = String(body.callerEmail ?? '').trim();
  const requestId      = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const itemIds        = (body.itemIds ?? []).map(s => String(s).trim()).filter(Boolean);
  const releaseDateRaw = String(body.releaseDate ?? '').trim();
  const notes          = String(body.notes ?? '').trim();
  const releasedBy     = callerEmail || 'API';

  if (!tenantId)        return json({ success: false, error: 'tenantId is required' }, 400);
  if (itemIds.length === 0) return json({ success: false, error: 'No items provided' }, 400);
  if (!releaseDateRaw)  return json({ success: false, error: 'No release date provided' }, 400);

  // Parse YYYY-MM-DD; reject anything else.
  const dParts = releaseDateRaw.split('-');
  if (dParts.length !== 3) return json({ success: false, error: `Invalid date: ${releaseDateRaw}` }, 400);
  const y = Number(dParts[0]), m = Number(dParts[1]), d = Number(dParts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return json({ success: false, error: `Invalid date: ${releaseDateRaw}` }, 400);
  }
  // Store as ISO (date-only is fine — public.inventory.release_date is text in the mirror).
  const releaseDateIso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  // 1. Read current state for the requested items (status + item_notes).
  const { data: invRows, error: readErr } = await sb
    .from('inventory')
    .select('item_id, status, item_notes')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);

  if (readErr) return json({ success: false, error: `Read failed: ${readErr.message}` }, 500);

  const byId = new Map<string, { item_id: string; status: string; item_notes: string }>();
  for (const r of (invRows ?? []) as Array<{ item_id: string; status: string | null; item_notes: string | null }>) {
    byId.set(String(r.item_id), {
      item_id:    String(r.item_id),
      status:     String(r.status ?? '').trim(),
      item_notes: String(r.item_notes ?? ''),
    });
  }

  const stamp = `Released ${formatMdy(releaseDateIso)} by ${releasedBy} on ${formatMdy(new Date().toISOString().slice(0,10))}`;
  const entrySuffix = notes ? `${stamp} — ${notes}` : stamp;

  // Active-only guard. Pre-fix the loop silently skipped already-
  // Released/Transferred rows; an upstream picker race could ship a non-
  // Active itemId and the operator would see "released N items" with the
  // stale row missing without explanation. Reject with a per-item status
  // report so the operator can correct the selection. notFound is also
  // surfaced explicitly instead of being rolled into warnings.
  const invalid: Array<{ itemId: string; status: string }> = [];
  const notFound: string[] = [];
  for (const itemId of itemIds) {
    const row = byId.get(itemId);
    if (!row) {
      notFound.push(itemId);
      continue;
    }
    if (row.status !== 'Active') {
      invalid.push({ itemId, status: row.status || '(blank)' });
    }
  }
  if (notFound.length > 0) {
    return json({
      success: false,
      error: `Item(s) not found in Inventory: ${notFound.slice(0, 10).join(', ')}`,
      errorCode: 'ITEM_NOT_FOUND',
      notFound,
    }, 400);
  }
  if (invalid.length > 0) {
    const preview = invalid.slice(0, 5).map(x => `${x.itemId} (${x.status})`).join(', ');
    const more = invalid.length > 5 ? ` +${invalid.length - 5} more` : '';
    return json({
      success: false,
      error: `Only Active items can be released. Non-Active item(s): ${preview}${more}`,
      errorCode: 'ITEMS_NOT_ACTIVE',
      invalidItems: invalid,
    }, 400);
  }

  const toRelease: Array<{ itemId: string; newNotes: string }> = [];
  for (const itemId of itemIds) {
    const row = byId.get(itemId)!;
    const existingNotes = row.item_notes.trim();
    const newNotes = existingNotes ? `${existingNotes} | ${entrySuffix}` : entrySuffix;
    toRelease.push({ itemId, newNotes });
  }

  // 2. UPDATE each row individually so we can append to its own item_notes.
  // N is bounded (typically 1-50, occasionally 100+). One UPDATE per row.
  let updated = 0;
  const nowIso = new Date().toISOString();
  for (const t of toRelease) {
    const { error: upErr } = await sb
      .from('inventory')
      .update({
        status:       'Released',
        release_date: releaseDateIso,
        item_notes:   t.newNotes,
        updated_at:   nowIso,
      })
      .eq('tenant_id', tenantId)
      .eq('item_id',   t.itemId);
    if (upErr) {
      console.error(`[release-items-sb] update failed for ${t.itemId}:`, upErr.message);
      continue;
    }
    updated++;
  }

  // 3. Auto-cancel open Tasks + Repairs for released items
  const warnings: string[] = [];
  const releasedIds = toRelease.map(t => t.itemId);
  if (releasedIds.length > 0) {
    const cancel = await autoCancelReleased(sb, tenantId, releasedIds, callerEmail);
    if (cancel.tasksCancelled > 0)   warnings.push(`Auto-cancelled ${cancel.tasksCancelled} open task(s)`);
    if (cancel.repairsCancelled > 0) warnings.push(`Auto-cancelled ${cancel.repairsCancelled} open repair(s)`);
    warnings.push(...cancel.warnings);
  }
  if (notFound.length > 0) warnings.push(`Not in public.inventory: ${notFound.join(', ')}`);

  // 4. Reverse-writethrough per item (uses extended __writeThroughReverseInventory_)
  await Promise.all(toRelease.map(t => mirrorInventoryRelease(t.itemId, releaseDateIso, tenantId, requestId, callerEmail, sb)));

  // 5. Audit log per item
  await Promise.all(toRelease.map(t => sb.from('entity_audit_log').insert({
    entity_type:   'inventory',
    entity_id:     t.itemId,
    tenant_id:     tenantId,
    action:        'release',
    changes:       { status: { new: 'Released' }, release_date: releaseDateIso, notes },
    performed_by:  callerEmail || 'release-items-sb',
    source:        'supabase',
  }).then(() => {}, () => {})));

  return json({
    success:        true,
    releasedCount:  updated,
    totalRequested: itemIds.length,
    warnings:       warnings.length > 0 ? warnings : undefined,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

function formatMdy(yyyymmdd: string): string {
  // Sheet stamp format mirrors GAS: MM/dd/yyyy in tenant timezone. PT is
  // the practical default. We render the calendar date as-is — no TZ
  // conversion here (the operator's local date is intended).
  const p = yyyymmdd.split('-');
  if (p.length !== 3) return yyyymmdd;
  return `${p[1]}/${p[2]}/${p[0]}`;
}

async function autoCancelReleased(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemIds: string[],
  callerEmail: string,
): Promise<{ tasksCancelled: number; repairsCancelled: number; warnings: string[] }> {
  const out = { tasksCancelled: 0, repairsCancelled: 0, warnings: [] as string[] };
  const note = 'Auto-cancelled: item released via Release (bulk)';
  const nowIso = new Date().toISOString();
  const performedBy = callerEmail || 'release-items-sb';

  // Tasks
  try {
    const { data: openTasks, error } = await sb
      .from('tasks')
      .select('task_id, status, task_notes, item_id')
      .eq('tenant_id', tenantId)
      .in('item_id', itemIds)
      .not('status', 'in', TASK_TERMINAL_LIST);
    if (error) {
      out.warnings.push(`Task select failed: ${error.message}`);
    } else {
      for (const row of (openTasks ?? []) as Array<{ task_id: string; status: string; task_notes: string | null; item_id: string }>) {
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
          entity_type:   'task',
          entity_id:     row.task_id,
          tenant_id:     tenantId,
          action:        'cancel',
          changes:       { status: { old: row.status, new: 'Cancelled' }, reason: note },
          performed_by:  performedBy,
          source:        'supabase',
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
      .select('repair_id, status, repair_notes, item_id')
      .eq('tenant_id', tenantId)
      .in('item_id', itemIds)
      .not('status', 'in', REPAIR_AUTOCANCEL_TERMINAL_LIST);
    if (error) {
      out.warnings.push(`Repair select failed: ${error.message}`);
    } else {
      for (const row of (openRepairs ?? []) as Array<{ repair_id: string; status: string; repair_notes: string | null; item_id: string }>) {
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
          entity_type:   'repair',
          entity_id:     row.repair_id,
          tenant_id:     tenantId,
          action:        'cancel',
          changes:       { status: { old: row.status, new: 'Cancelled' }, reason: note },
          performed_by:  performedBy,
          source:        'supabase',
        }).then(() => {}, () => {});
      }
    }
  } catch (e) {
    out.warnings.push(`Repairs sweep threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  return out;
}

async function mirrorInventoryRelease(
  itemId: string,
  releaseDateIso: string,
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
      row:   { status: 'Released', release_date: releaseDateIso },
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
        requested_by:  callerEmail || 'release-items-sb',
        request_id:    `${requestId}:${itemId}`,
        payload,
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[release-items-sb] mirror threw for', itemId, e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
