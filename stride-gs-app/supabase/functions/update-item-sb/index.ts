/**
 * update-item-sb — SB-primary handler for `updateInventoryItem`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decisions
 *   MIG-002  synchronous SB→Sheets reverse writethrough
 *   MIG-006  entity_audit_log is the answer key
 *   MIG-010  per-tenant scope semantics for feature_flags
 *   MIG-015  Justin Demo canary override of MIG-007 (this session)
 *
 * Replaces the GAS handler `handleUpdateInventoryItem_` (StrideAPI.gs
 * v38.225.0 ~line 31550). Behavior is a direct port:
 *   1. Validate payload (status whitelist, qty/declaredValue numeric+non-neg).
 *   2. UPDATE public.inventory for the changed fields.
 *      Clear release_date when status → 'Active' (matches v38.177.0).
 *   3. Cascade fan-out to public.tasks + public.repairs (open rows only)
 *      for the syncable subset of fields. Mirrors SYNC_FIELDS.
 *   4. Cascade Sidemark/Reference to public.billing (Unbilled rows for
 *      this item_id) — mirrors api_propagateInvFieldsToBilling_.
 *   5. Auto-cancel open Tasks + Repairs on a true Released-transition
 *      (prevStatus !== 'Released' && newStatus === 'Released'). Mirrors
 *      v38.211.0 api_cancelOpenWorkOnRelease_, including the
 *      " | <note>"-append on existing task_notes / repair_notes.
 *   6. Fire reverse-writethrough to the per-tenant Inventory sheet so
 *      legacy readers see the new values. Requires StrideAPI v38.226.0+
 *      (the __writeThroughReverseInventory_ extension for general field
 *      updates) — operator must deploy the GAS change BEFORE flipping
 *      the canary flag, otherwise the sheet mirror will throw.
 *      Cascade rows (Tasks/Repairs/Billing) are NOT individually mirrored
 *      back to the sheet by this handler — the per-tenant full-sync cron
 *      picks them up within ~5–30 min. Documented as a canary-acceptable
 *      gap in MIG-015. Production tenants stay on GAS until each affected
 *      per-table reverse writer ships.
 *   7. Write entity_audit_log row matching the GAS shape exactly
 *      (entity_type='inventory', action='update',
 *       changes={payload − {itemId,requestId,tenantId,callerEmail}}).
 *
 * Authorization:
 *   verify_jwt=true (default). The caller's JWT is forwarded by
 *   supabase.functions.invoke. SERVICE_ROLE is used for writes (RLS
 *   bypass). The tenantId field is taken from the body; the routing
 *   layer (src/lib/apiRouter.ts) only forwards SB-path when the
 *   feature_flag resolves to 'supabase' for THIS tenantId, so the JWT
 *   already authorizes the caller against this tenant. RLS-based
 *   double-checking is a follow-up for production-tenant rollouts.
 *
 * Response shape (matches GAS for caller-shape parity):
 *   { success: true, itemId, updated: {...}, billingFanOutCount, autoCancel }
 *   { error: "...", code?: "..." }   on failure
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Editable field map (mirrors handleUpdateInventoryItem_ FIELD_MAP) ──
//
// Payload key → public.inventory column. `syncToWork` indicates the
// field also propagates to open Tasks/Repairs (mirrors GAS SYNC_FIELDS).
// Status is INTENTIONALLY excluded from the cascade — we don't want a
// Released inventory item to flip its open tasks to status='Released'.
const FIELD_MAP: Record<string, { column: string; syncToWork: boolean }> = {
  vendor:           { column: 'vendor',             syncToWork: true  },
  description:      { column: 'description',        syncToWork: true  },
  reference:        { column: 'reference',          syncToWork: true  },
  sidemark:         { column: 'sidemark',           syncToWork: true  },
  room:             { column: 'room',               syncToWork: true  },
  location:         { column: 'location',           syncToWork: true  },
  itemClass:        { column: 'item_class',         syncToWork: true  },
  qty:              { column: 'qty',                syncToWork: false },
  status:           { column: 'status',             syncToWork: false },
  itemNotes:        { column: 'item_notes',         syncToWork: true  },
  declaredValue:    { column: 'declared_value',     syncToWork: false },
  coverageOptionId: { column: 'coverage_option_id', syncToWork: false },
};

const VALID_STATUSES = new Set(['Active', 'On Hold', 'Released', 'Transferred']);

// Tasks status terminal states — same set as TASK_CLOSED in GAS handler.
const TASK_TERMINAL = ['Completed', 'Cancelled'] as const;
// Repairs terminal states — same set as REPAIR_CLOSED in
// api_cancelOpenWorkOnRelease_ (StrideAPI.gs:20460).
const REPAIR_TERMINAL = ['Complete', 'Completed', 'Cancelled', 'Declined', 'Failed'] as const;

// PostgREST `not in` filter — comma-joined values inside parens.
// None of our status strings contain commas/parens so unquoted is safe.
const TASK_TERMINAL_LIST   = `(${TASK_TERMINAL.join(',')})`;
const REPAIR_TERMINAL_LIST = `(${REPAIR_TERMINAL.join(',')})`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateItemBody {
  itemId?: string;
  requestId?: string;
  tenantId?: string;
  callerEmail?: string;
  [k: string]: unknown;
}

interface ValidatedUpdate {
  vendor?: string;
  description?: string;
  reference?: string;
  sidemark?: string;
  room?: string;
  location?: string;
  itemClass?: string;
  qty?: number;
  status?: string;
  itemNotes?: string;
  declaredValue?: number;
  coverageOptionId?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: UpdateItemBody;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse({ error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const itemId      = String(body.itemId      ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return jsonResponse({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!itemId)   return jsonResponse({ error: 'itemId is required',   code: 'INVALID_PARAMS' }, 400);

  // Validate + collect updates
  const validated = validatePayload(body);
  if ('error' in validated) {
    return jsonResponse({ error: validated.error, code: validated.code }, 400);
  }
  const updates = validated.updates;
  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) {
    return jsonResponse({ error: 'No editable fields provided', code: 'INVALID_PARAMS' }, 400);
  }

  // Supabase client (SERVICE_ROLE — see header comment on auth).
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[update-item-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // ── 1. Snapshot the inventory row BEFORE write so we can detect a
  // true Released-transition. Also confirms the row exists so a
  // typo'd itemId returns NOT_FOUND instead of silently updating zero
  // rows.
  const { data: prevRow, error: prevErr } = await sb
    .from('inventory')
    .select('item_id, status')
    .eq('tenant_id', tenantId)
    .eq('item_id', itemId)
    .maybeSingle();

  if (prevErr) {
    console.error('[update-item-sb] prev-row read failed:', prevErr.message);
    return jsonResponse({ error: `Read failed: ${prevErr.message}`, code: 'READ_FAILED' }, 500);
  }
  if (!prevRow) {
    return jsonResponse({ error: `Item not found: ${itemId}`, code: 'NOT_FOUND' }, 404);
  }
  const prevStatus = String((prevRow as { status?: unknown }).status ?? '').trim();

  // ── 2. UPDATE public.inventory ─────────────────────────────────────
  const updateRow: Record<string, unknown> = {};
  for (const key of updateKeys) {
    const spec = FIELD_MAP[key];
    if (!spec) continue;
    updateRow[spec.column] = (updates as Record<string, unknown>)[key];
  }
  // Clear release_date when status flips to Active (v38.177.0 parity).
  if (updates.status === 'Active') {
    updateRow.release_date = '';
  }
  updateRow.updated_at = new Date().toISOString();

  const { error: upErr } = await sb
    .from('inventory')
    .update(updateRow)
    .eq('tenant_id', tenantId)
    .eq('item_id', itemId);

  if (upErr) {
    console.error('[update-item-sb] inventory update failed:', upErr.message);
    return jsonResponse({ error: `Update failed: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);
  }

  // ── 3. Cascade to public.tasks + public.repairs (open rows) ─────────
  // SYNC_FIELDS subset: only the syncToWork=true keys propagate.
  // Status is NOT one of them. Open = NOT IN terminal set.
  const cascadeRow: Record<string, unknown> = {};
  for (const key of updateKeys) {
    const spec = FIELD_MAP[key];
    if (!spec?.syncToWork) continue;
    cascadeRow[spec.column] = (updates as Record<string, unknown>)[key];
  }
  let cascadeTaskCount = 0;
  let cascadeRepairCount = 0;
  if (Object.keys(cascadeRow).length > 0) {
    cascadeRow.updated_at = new Date().toISOString();
    const { data: cTasks, error: tErr } = await sb
      .from('tasks')
      .update(cascadeRow)
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .not('status', 'in', TASK_TERMINAL_LIST)
      .select('task_id');
    if (tErr) {
      // Best-effort — inventory write is committed. Log + continue,
      // matching GAS's per-row try/catch on the same fan-out.
      console.error('[update-item-sb] tasks cascade failed:', tErr.message);
    } else {
      cascadeTaskCount = (cTasks ?? []).length;
    }

    const { data: cRepairs, error: rErr } = await sb
      .from('repairs')
      .update(cascadeRow)
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .not('status', 'in', REPAIR_TERMINAL_LIST)
      .select('repair_id');
    if (rErr) {
      console.error('[update-item-sb] repairs cascade failed:', rErr.message);
    } else {
      cascadeRepairCount = (cRepairs ?? []).length;
    }
  }

  // ── 4. Cascade Sidemark/Reference to public.billing (Unbilled) ─────
  // Mirrors api_propagateInvFieldsToBilling_'s status='Unbilled' filter.
  const billingFanOut: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'sidemark') && updates.sidemark !== undefined) {
    billingFanOut.sidemark = updates.sidemark;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'reference') && updates.reference !== undefined) {
    billingFanOut.reference = updates.reference;
  }
  let billingFanOutCount = 0;
  if (Object.keys(billingFanOut).length > 0) {
    billingFanOut.updated_at = new Date().toISOString();
    const { data: cBilling, error: bErr } = await sb
      .from('billing')
      .update(billingFanOut)
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .eq('status', 'Unbilled')
      .select('ledger_row_id');
    if (bErr) {
      console.error('[update-item-sb] billing fan-out failed:', bErr.message);
    } else {
      billingFanOutCount = (cBilling ?? []).length;
    }
  }

  // ── 5. Auto-cancel on Released-transition ──────────────────────────
  // Only fires when status actually transitioned INTO Released. Mirrors
  // v38.211.0 api_cancelOpenWorkOnRelease_. Note: this writes a per-row
  // " | <note>"-appended task_notes / repair_notes to match GAS exactly,
  // requiring a SELECT-then-UPDATE-per-row pass. N is small in practice
  // (≤ 5 open tasks/repairs per inventory item).
  let autoCancel: { tasksCancelled: number; repairsCancelled: number; warnings: string[] } | null = null;
  if (
    Object.prototype.hasOwnProperty.call(updates, 'status') &&
    updates.status === 'Released' &&
    prevStatus !== 'Released'
  ) {
    autoCancel = await cancelOpenWorkOnRelease(sb, tenantId, itemId, callerEmail);
  }

  // ── 6. Reverse-writethrough to per-tenant Inventory sheet ──────────
  // Best-effort: failures land in gs_sync_events for FailedOperationsDrawer
  // pickup, but don't roll back the SB commit.
  await mirrorInventoryToSheet({
    tenantId, itemId, updates, prevStatus, requestId, callerEmail, sb,
  });

  // ── 7. entity_audit_log (matches GAS shape exactly) ────────────────
  // GAS at StrideAPI.gs:9108-9109 does:
  //   var _updFields = {}; for (var _uk in payload) {
  //     if (_uk !== 'itemId' && _uk !== 'requestId') _updFields[_uk] = payload[_uk];
  //   }
  //   api_auditLog_("inventory", payload.itemId, effectiveId, "update", _updFields, callerEmail);
  //
  // We add tenantId + callerEmail to the strip set because those are
  // SB-side framing keys that don't appear on the GAS-side payload (GAS
  // takes them as query params, not in the body).
  const auditChanges: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'itemId' || k === 'requestId' || k === 'tenantId' || k === 'callerEmail') continue;
    if (v === undefined) continue;
    auditChanges[k] = v;
  }
  await sb.from('entity_audit_log').insert({
    entity_type:   'inventory',
    entity_id:     itemId,
    tenant_id:     tenantId,
    action:        'update',
    changes:       auditChanges,
    performed_by:  callerEmail || 'update-item-sb',
    source:        'supabase',
  }).then(() => {}, (e: unknown) => {
    // Best-effort — never block the user-visible write on audit-log
    // failure (matches api_auditLog_'s try/catch wrap).
    console.error('[update-item-sb] audit-log insert failed:', e);
  });

  // ── 8. Response (matches handleUpdateInventoryItem_ shape) ─────────
  return jsonResponse({
    success:            true,
    itemId,
    updated:            updates as Record<string, unknown>,
    billingFanOutCount,
    autoCancel:         autoCancel
      ? { tasksCancelled: autoCancel.tasksCancelled, repairsCancelled: autoCancel.repairsCancelled }
      : null,
    cascadeTaskCount,
    cascadeRepairCount,
  }, 200);
});

// ── Helpers ─────────────────────────────────────────────────────────────

function validatePayload(body: UpdateItemBody):
  | { updates: ValidatedUpdate }
  | { error: string; code: string }
{
  const out: ValidatedUpdate = {};
  for (const key of Object.keys(FIELD_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const v = (body as Record<string, unknown>)[key];
    if (v === undefined) continue;

    if (key === 'status') {
      const s = String(v);
      if (!VALID_STATUSES.has(s)) return { error: `Invalid status: ${s}`, code: 'INVALID_PARAMS' };
      out.status = s;
    } else if (key === 'qty') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return { error: `Invalid qty: ${String(v)}`, code: 'INVALID_PARAMS' };
      out.qty = n;
    } else if (key === 'declaredValue') {
      const s = String(v ?? '').trim();
      if (s === '' || s === 'null') {
        out.declaredValue = 0;
      } else {
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) return { error: `Invalid declaredValue: ${s}`, code: 'INVALID_PARAMS' };
        out.declaredValue = n;
      }
    } else if (key === 'coverageOptionId') {
      out.coverageOptionId = v === null || String(v).trim() === '' ? null : String(v);
    } else {
      // string-typed editable field — vendor, description, reference,
      // sidemark, room, location, itemClass, itemNotes
      (out as Record<string, unknown>)[key] = String(v ?? '');
    }
  }
  return { updates: out };
}

/**
 * Mirror handleUpdateInventoryItem_'s Released-transition auto-cancel
 * for open Tasks and Repairs. Selects each open row, then updates one
 * at a time with " | <note>"-appended task_notes / repair_notes to
 * match GAS's note-append semantics exactly.
 *
 * Writes one audit-log row per cancellation (action='cancel',
 * changes={ status: { old, new: 'Cancelled' }, reason }).
 *
 * Best-effort throughout — a single-row failure is logged into the
 * returned `warnings` list but doesn't roll back the parent update.
 */
async function cancelOpenWorkOnRelease(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemId: string,
  callerEmail: string,
): Promise<{ tasksCancelled: number; repairsCancelled: number; warnings: string[] }> {
  const result = { tasksCancelled: 0, repairsCancelled: 0, warnings: [] as string[] };
  const note = 'Auto-cancelled: item released via Manual Status Edit';
  const nowIso = new Date().toISOString();
  const performedBy = callerEmail || 'update-item-sb';

  // Tasks
  try {
    const { data: openTasks, error: selErr } = await sb
      .from('tasks')
      .select('task_id, status, task_notes')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .not('status', 'in', TASK_TERMINAL_LIST);
    if (selErr) {
      result.warnings.push(`Task select failed: ${selErr.message}`);
    } else {
      for (const row of (openTasks ?? []) as Array<{ task_id: string; status: string; task_notes: string | null }>) {
        const existing = String(row.task_notes ?? '').trim();
        const newNotes = existing ? `${existing} | ${note}` : note;
        const { error: updErr } = await sb
          .from('tasks')
          .update({
            status:       'Cancelled',
            cancelled_at: nowIso,
            task_notes:   newNotes,
            updated_at:   nowIso,
          })
          .eq('tenant_id', tenantId)
          .eq('task_id',   row.task_id);
        if (updErr) {
          result.warnings.push(`Cancel task ${row.task_id}: ${updErr.message}`);
          continue;
        }
        result.tasksCancelled++;
        // Per-row audit log — matches GAS api_auditLog_ inside the loop.
        await sb.from('entity_audit_log').insert({
          entity_type:   'task',
          entity_id:     row.task_id,
          tenant_id:     tenantId,
          action:        'cancel',
          changes:       { status: { old: row.status, new: 'Cancelled' }, reason: note },
          performed_by:  performedBy,
          source:        'supabase',
        }).then(() => {}, () => { /* non-fatal */ });
      }
    }
  } catch (e) {
    result.warnings.push(`Tasks sweep threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Repairs
  try {
    const { data: openRepairs, error: selErr } = await sb
      .from('repairs')
      .select('repair_id, status, repair_notes')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .not('status', 'in', REPAIR_TERMINAL_LIST);
    if (selErr) {
      result.warnings.push(`Repair select failed: ${selErr.message}`);
    } else {
      for (const row of (openRepairs ?? []) as Array<{ repair_id: string; status: string; repair_notes: string | null }>) {
        const existing = String(row.repair_notes ?? '').trim();
        const newNotes = existing ? `${existing} | ${note}` : note;
        const { error: updErr } = await sb
          .from('repairs')
          .update({
            status:       'Cancelled',
            repair_notes: newNotes,
            updated_at:   nowIso,
          })
          .eq('tenant_id', tenantId)
          .eq('repair_id', row.repair_id);
        if (updErr) {
          result.warnings.push(`Cancel repair ${row.repair_id}: ${updErr.message}`);
          continue;
        }
        result.repairsCancelled++;
        await sb.from('entity_audit_log').insert({
          entity_type:   'repair',
          entity_id:     row.repair_id,
          tenant_id:     tenantId,
          action:        'cancel',
          changes:       { status: { old: row.status, new: 'Cancelled' }, reason: note },
          performed_by:  performedBy,
          source:        'supabase',
        }).then(() => {}, () => { /* non-fatal */ });
      }
    }
  } catch (e) {
    result.warnings.push(`Repairs sweep threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

/**
 * Fire the reverse-writethrough to the per-tenant Google Sheet's
 * Inventory tab. Requires StrideAPI v38.226.0+'s extended
 * __writeThroughReverseInventory_ writer that handles general field
 * updates (not just release status). On older GAS versions, the writer
 * throws "row.status required" and the failure lands in gs_sync_events.
 *
 * Best-effort: a failure here is logged to gs_sync_events but does NOT
 * roll back the SB commit. The full-sync cron picks up sheet drift
 * within ~5–30 min, and the FailedOperationsDrawer surfaces the
 * specific failure for manual retry.
 */
async function mirrorInventoryToSheet(args: {
  tenantId: string;
  itemId: string;
  updates: ValidatedUpdate;
  prevStatus: string;
  requestId: string;
  callerEmail: string;
  sb: ReturnType<typeof createClient>;
}): Promise<void> {
  const { tenantId, itemId, updates, prevStatus, requestId, callerEmail, sb } = args;
  try {
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (!gasUrl || !gasToken) {
      console.warn('[update-item-sb] GAS_API_URL / GAS_API_TOKEN not configured, skipping sheet mirror');
      return;
    }

    const row = sbToSheetMirror(updates, prevStatus);

    const mirrorPayload = {
      tenantId,
      table: 'inventory',
      op:    'update',
      rowId: itemId,
      row,
      requestId,
    };
    const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(mirrorPayload),
    });
    const text = await mirrorRes.text();
    let parsed: { success?: boolean; error?: string } = {};
    try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
    if (!mirrorRes.ok || !parsed.success) {
      console.error(`[update-item-sb] sheet mirror failed for ${itemId}: ${parsed.error ?? `HTTP ${mirrorRes.status}`}`);
      await sb.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'inventory',
        entity_id:     itemId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'update-item-sb',
        request_id:    requestId,
        payload:       mirrorPayload,
        error_message: String(parsed.error ?? `HTTP ${mirrorRes.status}`).slice(0, 1000),
      }).then(() => {}, () => { /* non-fatal */ });
    }
  } catch (mirrorEx) {
    console.error('[update-item-sb] sheet mirror threw:', mirrorEx);
  }
}

/**
 * Convert validated updates (camelCase payload keys) into the row
 * shape the GAS reverse-writethrough writer expects (snake_case SB
 * column names matching public.inventory).
 *
 * Special case: when status flips to Active, signal a release_date
 * clear via empty string (matches v38.177.0).
 */
function sbToSheetMirror(updates: ValidatedUpdate, _prevStatus: string): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    const spec = FIELD_MAP[k];
    if (!spec) continue;
    if (v === undefined) continue;
    row[spec.column] = v;
  }
  if (updates.status === 'Active') {
    row.release_date = '';
  }
  return row;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
