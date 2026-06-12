/**
 * batch-create-tasks-sb — SB-primary handler for `batchCreateTasks`.
 *
 * Replaces GAS `handleBatchCreateTasks_` (StrideAPI.gs:29194). For each
 * (svcCode, item) pair: skip if an open task with that (item, svc)
 * already exists, otherwise generate a Task ID (SVC-ITEM-N where N is
 * the next counter for that item+svc pair), INSERT into public.tasks,
 * write entity_audit_log.
 *
 * batchMode v2 (D11, 2026-06-11): when the request carries
 * `batchMode: true`, mint a parent BATCH order number per svcCode
 * (JUS-BATCH-12 via next_order_id order_type 'batch') and create one
 * REAL single-item task per eligible item — task_id =
 * {batchNo}-{itemId}, tasks.batch_no = the parent number. Each sub
 * rides the normal single-task rails (per-item class-based billing,
 * badges, notes, photos); mixed item classes are fine. A svcCode left
 * with one eligible item gets a normal standalone task. Option-B
 * emails: complete-task suppresses per-sub sends and fires ONE
 * BATCH_COMPLETE summary when the last sub goes terminal.
 *
 * Reverse-writethrough to per-tenant Tasks sheet is BEST-EFFORT via
 * the existing __writeThroughReverseStub_ (tasks writer not shipped
 * yet); on canary tenants the per-tenant Tasks sheet drifts until
 * full-sync cron (~5-30 min). Documented as a canary-only gap per
 * MIG-016.
 *
 * Task ID generation is NOT race-condition-free across concurrent
 * batchCreateTasks calls on the same (tenant, item, svcCode) tuple —
 * SELECT MAX + INSERT pattern with no advisory lock. Acceptable on
 * canary because:
 *   • The same (tenant, item, svc) target is rarely double-clicked
 *     concurrently in practice.
 *   • A duplicate Task ID would be caught either by the user (visible
 *     in the React Tasks list) or by the next full-sync round-trip.
 *   • Hardening to advisory locks or a SECURITY DEFINER RPC is a
 *     follow-up — tracked in the per-function table.
 *
 * Response shape mirrors GAS exactly: { success, created, skipped, taskIds }.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TASK_TERMINAL = ['Completed', 'Cancelled'] as const;
const TASK_TERMINAL_LIST = `(${TASK_TERMINAL.join(',')})`;

const MAX_SLA_HOURS = 720; // 30 days — mirrors v38.214.0 sanity cap

interface ItemPayload {
  itemId: string;
  vendor?: string;
  description?: string;
  location?: string;
  sidemark?: string;
  shipmentNo?: string;
  itemNotes?: string;
}

interface BatchCreateBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  svcCodes?: string[];
  items?: ItemPayload[];
  slaHoursBySvcCode?: Record<string, number>;
  dueDate?: string;
  priority?: string;
  /** 2026-05-29 — single string stamped on every task in the batch.
   *  Mirrors GAS payload.taskNotes; empty/missing keeps task_notes blank. */
  taskNotes?: string;
  /** D11 (2026-06-11): when true, group this creation into a parent BATCH
   *  order — one batch number per svcCode, one REAL single-item sub-task
   *  per item (task_id = {batchNo}-{itemId}, tasks.batch_no stamped).
   *  False/missing keeps the standalone one-task-per-(item, svcCode)
   *  behavior. SB-only — the GAS handler ignores this field (the React
   *  toggle is gated on the batchWorkItemsTasks flag, which is only on for
   *  tenants already routed to this EF). */
  batchMode?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: BatchCreateBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();
  const svcCodes    = (body.svcCodes ?? []).map(s => String(s).trim().toUpperCase()).filter(Boolean);
  const items       = (body.items ?? []).filter(i => i && String(i.itemId ?? '').trim());
  const slaMap      = body.slaHoursBySvcCode && typeof body.slaHoursBySvcCode === 'object' ? body.slaHoursBySvcCode : {};
  const priority    = String(body.priority ?? 'Normal').trim() || 'Normal';
  const dueDateRaw  = String(body.dueDate ?? '').trim();
  const taskNotes   = String(body.taskNotes ?? '').trim();
  const batchMode   = body.batchMode === true;

  if (!tenantId) return json({ error: 'tenantId is required' }, 400);
  if (svcCodes.length === 0) return json({ error: 'svcCodes array is required and must not be empty' }, 400);
  if (items.length === 0)    return json({ error: 'items array is required and must not be empty' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server misconfigured' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Order Numbering feature (Justin Demo canary): when on, each new task gets
  // a clean client-scoped id (PREFIX-TSK-N, no leading zeros) from the
  // next_order_id RPC instead of the legacy SVC-ITEM-N counter. Resolved once
  // per request; off → legacy path (no extra per-task RPC round trips).
  const cleanNumbering = await orderNumberingOn(sb, tenantId);

  // Resolve service name + billing mode from svc_code via service_catalog
  // (mirrors api_lookupSvcName_). Best-effort — falls back to svcCode itself
  // (billing unknown) if the catalog lookup fails.
  const svcMetaBySvcCode = await resolveSvcMeta(sb, svcCodes);

  // Build an index of existing open tasks for THIS tenant to dedupe
  // intra-batch and against existing rows (mirrors api_buildOpenTaskMap_).
  const itemIds = Array.from(new Set(items.map(i => String(i.itemId).trim()).filter(Boolean)));
  const openMap = await buildOpenTaskMap(sb, tenantId, itemIds);

  // Inventory qty + item_class per item id. INSPECTION and RUSH tasks default
  // qty to the item's TRUE piece count (a carton of N pieces bills
  // "Inspection × N" / "Rush × N"); every other task type stays qty 1 (the
  // public.tasks column default). item_class backs the batch-mode mixed-class
  // guard below. Sourced from public.inventory rather than the request payload
  // so it's correct regardless of what the caller sends. Best-effort: a miss
  // leaves qty 1 / class unknown.
  const invByItem = await fetchInventoryMeta(sb, tenantId, itemIds);
  const invQtyByItem: Record<string, number> = {};
  for (const [id, meta] of Object.entries(invByItem)) invQtyByItem[id] = meta.qty;

  // Per-item-per-svc counter cache. Filled lazily by maxExistingCounter().
  const counterCache: Record<string, number> = {};

  const now = new Date();
  const skipped: Array<{ itemId: string; svcCode: string; reason: string }> = [];
  const taskIds: string[] = [];
  // Carries the originating svcCode alongside each generated taskId so the
  // audit log records the real service code. The legacy id encoded it as the
  // first segment (taskId.split('-')[0]); the clean PREFIX-TSK-N id does not,
  // so we can no longer parse it back out of the id.
  const taskMeta: Array<{ taskId: string; svcCode: string; batchNo?: string }> = [];
  const toInsert: Array<Record<string, unknown>> = [];
  // D11 batch parent order numbers minted this request (one per svcCode
  // with 2+ eligible items).
  const batchNos: string[] = [];

  // Compute due date for a given svcCode per the precedence rule
  // mirrors handleBatchCreateTasks_ at StrideAPI.gs:29263.
  function computeDueDate(svcCode: string): string | null {
    if (dueDateRaw) {
      // Single-value legacy path — apply to every task in the batch.
      // Parse as local-PT midnight to match GAS's `new Date(dueDate + "T00:00:00")`.
      const d = new Date(`${dueDateRaw}T00:00:00`);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const slaHoursRaw = slaMap[svcCode];
    if (slaHoursRaw != null) {
      let h = Number(slaHoursRaw);
      if (Number.isFinite(h) && h > 0) {
        h = Math.min(h, MAX_SLA_HOURS);
        return new Date(now.getTime() + h * 3600 * 1000).toISOString();
      }
    }
    return null;
  }

  // Mint a Task ID — clean SB-generated when the orderNumbering feature is
  // on for this tenant, legacy SVC-ITEM-N counter otherwise. Clean ids carry
  // the SERVICE code as the type token (PREFIX-INSP-N, PREFIX-ASM-N, …)
  // since 2026-06-11 — next_order_id mints the generic PREFIX-TSK-N (one
  // shared per-tenant counter for all task types) and we stamp the svc code
  // over the TSK segment so the id itself says what kind of task it is
  // (Justin, 2026-06-11). Shared by the per-item and batch branches.
  async function mintTaskId(svcCode: string, itemId: string): Promise<string | null> {
    if (cleanNumbering) {
      const { data: cleanId, error: cleanErr } = await sb.rpc('next_order_id', {
        p_tenant_id: tenantId,
        p_order_type: 'task',
      });
      if (cleanErr || typeof cleanId !== 'string' || !cleanId) {
        console.error('[batch-create-tasks-sb] next_order_id failed:', cleanErr?.message);
        return null;
      }
      return stampSvcToken(cleanId, svcCode);
    }
    const counterKey = `${itemId}|${svcCode}`;
    if (counterCache[counterKey] == null) {
      counterCache[counterKey] = await maxExistingCounter(sb, tenantId, itemId, svcCode);
    }
    counterCache[counterKey] += 1;
    return `${svcCode}-${itemId}-${counterCache[counterKey]}`;
  }

  if (batchMode) {
    // ── Batch mode v2 (D11, 2026-06-11) — parent order + REAL sub-tasks ──
    // A batch is a parent ORDER NUMBER (JUS-INSP-3G — service code + 'G'
    // group suffix) housing one real single-item task per eligible item
    // (task_id = {batchNo}-{itemId} → JUS-INSP-3G-1,
    // tasks.batch_no = the parent number). Each sub rides the existing
    // single-task rails — per-item class-based billing via
    // complete_task_atomic, badges, notes, photos, SLA — so mixed item
    // classes are FINE (each sub bills its own class; the v1 mixed-class
    // guard is gone). One batch per svcCode; a svcCode left with a single
    // eligible item gets a normal standalone task instead (a batch of one
    // is noise).
    for (const svcCode of svcCodes) {
      const svcName = svcMetaBySvcCode[svcCode]?.name ?? svcCode;
      const eligible: ItemPayload[] = [];
      // Intra-request duplicate guard: eligibility runs BEFORE openMap gets
      // marked (the insert loop below), so a duplicate itemId in the payload
      // would otherwise pass twice → two identical {batchNo}-{itemId} task
      // ids → the whole insert 500s on UNIQUE(tenant_id, task_id). The
      // modal sends unique rows; this is the server-side backstop.
      const seenThisSvc = new Set<string>();
      for (const item of items) {
        const itemId = String(item.itemId).trim();
        if (!itemId) {
          skipped.push({ itemId, svcCode, reason: 'blank itemId' });
          continue;
        }
        if (seenThisSvc.has(itemId)) {
          skipped.push({ itemId, svcCode, reason: 'duplicate itemId in request' });
          continue;
        }
        if (openMap[`${itemId}|${svcCode}`]) {
          skipped.push({ itemId, svcCode, reason: `open ${svcCode} task already exists` });
          continue;
        }
        seenThisSvc.add(itemId);
        eligible.push(item);
      }
      if (eligible.length === 0) continue;

      let batchNo: string | null = null;
      if (eligible.length > 1) {
        // Parent number from the per-tenant 'batch' sequence. Requires the
        // orderNumbering feature (next_order_id returns NULL when off) —
        // the batch UI is flag-gated to tenants that have it, so fail
        // closed rather than invent a fallback format.
        const { data: minted, error: mintErr } = await sb.rpc('next_order_id', {
          p_tenant_id: tenantId,
          p_order_type: 'batch',
        });
        if (mintErr || typeof minted !== 'string' || !minted) {
          console.error('[batch-create-tasks-sb] batch number allocation failed:', mintErr?.message);
          return json({ error: 'Batch number allocation failed (order numbering must be enabled for this account)' }, 500);
        }
        // 2026-06-12 (Justin) — the parent number reads as the SERVICE plus a
        // 'G' (group) suffix, not the generic BATCH token: JUS-BATCH-3 →
        // JUS-INSP-3G. Subs are {batchNo}-{itemId} → JUS-INSP-3G-1. The
        // per-tenant 'batch' counter still drives N (sequential across all
        // batches, service code embedded for readability); the G suffix keeps
        // the parent string distinct from a regular JUS-INSP-3 task and from
        // its own subs. No-op fallback if the minted id isn't BATCH-shaped.
        // NB: unlike stampSvcToken (which guards WC/WCPU/RPR so a task id
        // can't masquerade as a will-call/repair), there's no reserved-token
        // guard here — the safety rests on CreateTaskModal's EXCLUDE_CODES
        // denylist (WC/WCPU/RPR/REPAIR/STOR/RCVG/SPLIT can't reach the batch
        // picker), so svcCode is always a real task service here.
        const svcToken = svcCode.replace(/[^A-Z0-9_]/g, '');
        batchNo = svcToken
          ? minted.replace(/-BATCH-(\d+)$/, `-${svcToken}-$1G`)
          : minted;
      }

      for (const item of eligible) {
        const itemId = String(item.itemId).trim();
        // Sub id carries the parent number + item id (self-explanatory);
        // a lone eligible item falls back to a normal standalone task id.
        const taskId = batchNo ? `${batchNo}-${itemId}` : await mintTaskId(svcCode, itemId);
        if (!taskId) {
          return json({ error: 'Task number allocation failed' }, 500);
        }

        toInsert.push({
          tenant_id:    tenantId,
          task_id:      taskId,
          item_id:      itemId,
          type:         svcName,
          status:       'Open',
          vendor:       String(item.vendor ?? ''),
          description:  String(item.description ?? ''),
          location:     String(item.location ?? ''),
          sidemark:     String(item.sidemark ?? ''),
          shipment_number: String(item.shipmentNo ?? ''),
          item_notes:   String(item.itemNotes ?? ''),
          task_notes:   taskNotes,
          created:      now.toISOString(),
          billed:       false,
          qty:          (svcCode === 'INSP' || svcCode === 'RUSH') ? (invQtyByItem[itemId] ?? 1) : 1,
          priority,
          due_date:     computeDueDate(svcCode),
          updated_at:   now.toISOString(),
          ...(batchNo ? { batch_no: batchNo } : {}),
        });
        taskIds.push(taskId);
        taskMeta.push({ taskId, svcCode, ...(batchNo ? { batchNo } : {}) });
        openMap[`${itemId}|${svcCode}`] = true; // prevent intra-batch dupes
      }
      if (batchNo) batchNos.push(batchNo);
    }
  } else {
  for (const svcCode of svcCodes) {
    const svcName = svcMetaBySvcCode[svcCode]?.name ?? svcCode;
    for (const item of items) {
      const itemId = String(item.itemId).trim();
      if (!itemId) {
        skipped.push({ itemId, svcCode, reason: 'blank itemId' });
        continue;
      }
      const dedupKey = `${itemId}|${svcCode}`;
      if (openMap[dedupKey]) {
        skipped.push({ itemId, svcCode, reason: `open ${svcCode} task already exists` });
        continue;
      }

      // Generate Task ID (clean PREFIX-TSK-N or legacy SVC-ITEM-N).
      const taskId = await mintTaskId(svcCode, itemId);
      if (!taskId) {
        return json({ error: 'Task number allocation failed' }, 500);
      }

      const dueDateIso = computeDueDate(svcCode);

      toInsert.push({
        tenant_id:    tenantId,
        task_id:      taskId,
        item_id:      itemId,
        type:         svcName,
        status:       'Open',
        vendor:       String(item.vendor ?? ''),
        description:  String(item.description ?? ''),
        location:     String(item.location ?? ''),
        sidemark:     String(item.sidemark ?? ''),
        shipment_number: String(item.shipmentNo ?? ''),
        item_notes:   String(item.itemNotes ?? ''),
        task_notes:   taskNotes,
        created:      now.toISOString(),
        billed:       false,
        qty:          (svcCode === 'INSP' || svcCode === 'RUSH') ? (invQtyByItem[itemId] ?? 1) : 1,
        priority,
        due_date:     dueDateIso,
        updated_at:   now.toISOString(),
      });

      taskIds.push(taskId);
      taskMeta.push({ taskId, svcCode });
      openMap[dedupKey] = true; // prevent intra-batch dupes
    }
  }
  } // end batchMode branch

  // Single batch insert. supabase-js batches up to ~1000 rows safely.
  if (toInsert.length > 0) {
    const { error: insErr } = await sb.from('tasks').insert(toInsert);
    if (insErr) {
      console.error('[batch-create-tasks-sb] insert failed:', insErr.message);
      return json({ error: `Insert failed: ${insErr.message}` }, 500);
    }
  }

  // Audit-log per task (best-effort; mirrors GAS api_auditLog_ wrap).
  // Batch sub-tasks also record their parent batch number.
  const auditPromises = taskMeta.map(({ taskId, svcCode, batchNo }) => sb.from('entity_audit_log').insert({
    entity_type:   'task',
    entity_id:     taskId,
    tenant_id:     tenantId,
    action:        'create',
    changes:       { svcCode, requestId, ...(batchNo ? { batchNo } : {}) },
    performed_by:  callerEmail || 'batch-create-tasks-sb',
    source:        'supabase',
  }).then(() => {}, () => {}));
  await Promise.all(auditPromises);

  // Reverse-writethrough: best-effort sheet mirror per task row. batch_no is
  // intentionally NOT in REVERSE_TASK_FIELDS_ (SB-only column — the sheet has
  // no Batch column and the sheet→SB sync paths never project the key, so
  // PostgREST merge-duplicates preserves it).
  void fireTasksWritethrough(toInsert, tenantId, requestId, callerEmail, sb);

  return json({
    success: true,
    created: taskIds.length,
    skipped,
    taskIds,
    ...(batchNos.length > 0 ? { batchNos } : {}),
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Swap the generic TSK token in a clean task id (PREFIX-TSK-N) for the
 * service code (PREFIX-INSP-N) so the id identifies the task type. The
 * per-tenant counter stays shared across all task types (numbers never
 * collide). No-op when the id isn't TSK-shaped (legacy fallback ids) or the
 * svc code sanitizes to empty.
 */
function stampSvcToken(taskId: string, svcCode: string): string {
  const token = String(svcCode ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  // Reserved order tokens: a task id stamped WC/WCPU/RPR would be
  // shape-identical to a real will-call/repair id (separate sequences →
  // possible number collision) and LinkifiedText would deep-link it to the
  // wrong entity. The CreateTaskModal denylist blocks these codes from the
  // picker; this is the EF-side backstop — keep the generic TSK instead.
  if (!token || token === 'WC' || token === 'WCPU' || token === 'RPR') return taskId;
  return taskId.replace(/-TSK-(\d+)$/, `-${token}-$1`);
}

/**
 * Resolve whether the `orderNumbering` feature is on for this tenant via the
 * SECURITY DEFINER `order_numbering_enabled` RPC (MIG-010 per-tenant scope).
 * Fails safe to false (legacy SVC-ITEM-N ids) on any error.
 */
async function orderNumberingOn(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('order_numbering_enabled', { p_tenant_id: tenantId });
    if (error) {
      console.warn('[batch-create-tasks-sb] order_numbering_enabled failed:', error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn('[batch-create-tasks-sb] order_numbering_enabled threw:', e);
    return false;
  }
}

async function resolveSvcMeta(
  sb: ReturnType<typeof createClient>,
  svcCodes: readonly string[],
): Promise<Record<string, { name: string; billing: string }>> {
  if (svcCodes.length === 0) return {};
  try {
    const { data, error } = await sb
      .from('service_catalog')
      .select('code, name, billing')
      .in('code', svcCodes as string[]);
    if (error) {
      console.warn('[batch-create-tasks-sb] service_catalog lookup failed:', error.message);
      return {};
    }
    const out: Record<string, { name: string; billing: string }> = {};
    for (const row of (data ?? []) as Array<{ code: string; name: string; billing: string | null }>) {
      out[row.code] = { name: row.name || row.code, billing: String(row.billing ?? '') };
    }
    return out;
  } catch (e) {
    console.warn('[batch-create-tasks-sb] service_catalog lookup threw:', e);
    return {};
  }
}

async function buildOpenTaskMap(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemIds: string[],
): Promise<Record<string, boolean>> {
  if (itemIds.length === 0) return {};
  const { data, error } = await sb
    .from('tasks')
    .select('item_id, type')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds)
    .not('status', 'in', TASK_TERMINAL_LIST);
  if (error) {
    console.warn('[batch-create-tasks-sb] open-task lookup failed:', error.message);
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const row of (data ?? []) as Array<{ item_id: string; type: string }>) {
    // Note: GAS dedup uses Svc Code (the code, e.g. 'INSP') as the key.
    // public.tasks stores Type (the service name, e.g. 'Inspection').
    // For SB-side dedup we resolve the catalog inverse: any open task
    // whose Type matches the service name for the svcCode is treated
    // as an open task for that svcCode. We approximate by uppercase
    // first-token match (INSP → "Inspection") via the catalog lookup
    // — see svcNameBySvcCode in the caller. Imperfect but matches the
    // observable behavior for the canary's volume; tighten when a
    // future migration adds an explicit svc_code column to public.tasks.
    const itemId = String(row.item_id ?? '').trim();
    const type   = String(row.type    ?? '').trim().toUpperCase();
    if (itemId && type) out[`${itemId}|${type}`] = true;
  }
  return out;
}

async function fetchInventoryMeta(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemIds: string[],
): Promise<Record<string, { qty: number; itemClass: string }>> {
  if (itemIds.length === 0) return {};
  const { data, error } = await sb
    .from('inventory')
    .select('item_id, qty, item_class')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);
  if (error) {
    console.warn('[batch-create-tasks-sb] inventory lookup failed:', error.message);
    return {};
  }
  const out: Record<string, { qty: number; itemClass: string }> = {};
  for (const row of (data ?? []) as Array<{ item_id: string; qty: number | string | null; item_class: string | null }>) {
    const itemId = String(row.item_id ?? '').trim();
    if (!itemId) continue;
    const q = Math.round(Number(row.qty));
    out[itemId] = {
      qty: Number.isFinite(q) && q > 0 ? q : 1,
      itemClass: String(row.item_class ?? '').trim(),
    };
  }
  return out;
}

async function maxExistingCounter(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemId: string,
  svcCode: string,
): Promise<number> {
  // task_id format: SVC-ITEM-N (e.g. INSP-62630-1). We can't easily
  // sort numerically via PostgREST, so we fetch all task_ids matching
  // the SVC-ITEM- prefix and parse client-side. N is typically 1 — high
  // counters are rare (operator-driven re-issue).
  const prefix = `${svcCode}-${itemId}-`;
  const { data, error } = await sb
    .from('tasks')
    .select('task_id')
    .eq('tenant_id', tenantId)
    .like('task_id', `${prefix}%`);
  if (error || !data) return 0;
  let max = 0;
  for (const row of data as Array<{ task_id: string }>) {
    const tid = String(row.task_id ?? '');
    if (!tid.startsWith(prefix)) continue;
    const tail = tid.slice(prefix.length);
    const n = Number(tail);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Best-effort sheet mirror via the existing reverse-writethrough
 * framework. The tasks writer is still a stub today
 * (StrideAPI.gs:2797 `tasks: __writeThroughReverseStub_`); fires will
 * land in gs_sync_events with `sync_failed` and the
 * FailedOperationsDrawer surfaces them for manual retry. Canary
 * tenants tolerate the resulting sheet drift until full-sync cron
 * runs (~5–30 min). Documented per MIG-016.
 */
async function fireTasksWritethrough(
  rows: Array<Record<string, unknown>>,
  tenantId: string,
  requestId: string,
  callerEmail: string,
  sb: ReturnType<typeof createClient>,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  for (const row of rows) {
    try {
      const taskId = String(row.task_id);
      const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          table: 'tasks',
          op:    'insert',
          rowId: taskId,
          row,
          requestId: `${requestId}:${taskId}`,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        await sb.from('gs_sync_events').insert({
          tenant_id:     tenantId,
          entity_type:   'task',
          entity_id:     taskId,
          action_type:   'writethrough_reverse',
          sync_status:   'sync_failed',
          requested_by:  callerEmail || 'batch-create-tasks-sb',
          request_id:    `${requestId}:${taskId}`,
          payload:       { table: 'tasks', op: 'insert', rowId: taskId },
          error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
        }).then(() => {}, () => {});
      }
    } catch (e) {
      console.warn('[batch-create-tasks-sb] tasks writethrough threw:', e);
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
