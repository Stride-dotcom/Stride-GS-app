/**
 * update-task-sb — SB-primary handler for the four GAS updateTask*
 * actions: updateTaskNotes, updateTaskCustomPrice, updateTaskDueDate,
 * updateTaskPriority.
 *
 * The GAS side splits these across four handlers
 * (handleUpdateTaskNotes_/CustomPrice_/DueDate_/Priority_, StrideAPI.gs
 * :31321-31460) because the GAS router dispatches by `action`. The SB
 * side consolidates them into one EF that accepts any subset of the
 * editable field set — the React apiRouter routes all four GAS
 * actions to this same EF.
 *
 * Mirrors the update-item-sb pattern: validate payload, UPDATE
 * public.tasks for changed fields, fire reverse-writethrough via the
 * v38.227.0 `__writeThroughReverseTasks_` writer, write
 * entity_audit_log matching the GAS shape.
 *
 * Field map (payload key → public.tasks column):
 *   taskNotes    → task_notes
 *   location     → location
 *   customPrice  → custom_price   (null/'' clears the override)
 *   dueDate      → due_date       (YYYY-MM-DD ISO; '' clears)
 *   priority     → priority       (High | Normal; defaults to Normal)
 *   assignedTo   → assigned_to    (forward-compat; not on the GAS
 *                                  apiPost surface today, but present
 *                                  in sbTaskRow_ so we accept it)
 *   result       → result         (forward-compat — handleCorrectTaskResult_
 *                                  goes through this path)
 *
 * Response shape mirrors GAS:
 *   { success: true, taskId, updated: {...} }
 *   { error: '...', code?: '...' }
 *
 * Audit-log changes shape: payload minus identifier keys (matches the
 * GAS router's audit pattern at api_auditLog_).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_PRIORITIES = new Set(['High', 'Normal']);

interface UpdateTaskBody {
  taskId?: string;
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  taskNotes?: unknown;
  location?: unknown;
  customPrice?: unknown;
  dueDate?: unknown;
  priority?: unknown;
  assignedTo?: unknown;
  result?: unknown;
  [k: string]: unknown;
}

const FIELD_MAP: Record<string, { column: string; sheetKey: string }> = {
  taskNotes:    { column: 'task_notes',   sheetKey: 'task_notes' },
  location:     { column: 'location',     sheetKey: 'location'   },
  customPrice:  { column: 'custom_price', sheetKey: 'custom_price' },
  dueDate:      { column: 'due_date',     sheetKey: 'due_date'   },
  priority:     { column: 'priority',     sheetKey: 'priority'   },
  assignedTo:   { column: 'assigned_to',  sheetKey: 'assigned_to' },
  result:       { column: 'result',       sheetKey: 'result'     },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: UpdateTaskBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const taskId      = String(body.taskId      ?? '').trim();
  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!taskId)   return json({ error: 'taskId is required',   code: 'INVALID_PARAMS' }, 400);

  // Validate + collect updates
  const validated = validatePayload(body);
  if ('error' in validated) return json({ error: validated.error, code: validated.code }, 400);
  const updates = validated.updates;
  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) {
    return json({ error: 'No editable fields provided', code: 'INVALID_PARAMS' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  // Confirm the task exists for this tenant
  const { data: existing, error: readErr } = await sb
    .from('tasks')
    .select('task_id, item_id, status')
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId)
    .maybeSingle();
  if (readErr)  return json({ error: `Read failed: ${readErr.message}`, code: 'READ_FAILED' }, 500);
  if (!existing) return json({ error: `Task not found: ${taskId}`, code: 'NOT_FOUND' }, 404);

  // Build UPDATE row
  const updateRow: Record<string, unknown> = {};
  for (const k of updateKeys) {
    const spec = FIELD_MAP[k];
    if (!spec) continue;
    updateRow[spec.column] = (updates as Record<string, unknown>)[k];
  }
  updateRow.updated_at = new Date().toISOString();

  const { error: upErr } = await sb
    .from('tasks')
    .update(updateRow)
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId);
  if (upErr) return json({ error: `Update failed: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);

  // Reverse-writethrough to per-tenant Tasks sheet via v38.227.0 writer.
  // Best-effort: failures land in gs_sync_events.
  await mirrorTaskToSheet({ tenantId, taskId, updates, requestId, callerEmail, sb });

  // Audit log — payload minus identifier keys, matching the GAS pattern
  // (StrideAPI.gs:9070 case "updateTaskNotes": api_auditLog_("task", taskId,
  // tenantId, "update", _updFields, callerEmail);
  const auditChanges: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'taskId' || k === 'requestId' || k === 'tenantId' || k === 'callerEmail') continue;
    if (v === undefined) continue;
    auditChanges[k] = v;
  }
  await sb.from('entity_audit_log').insert({
    entity_type:   'task',
    entity_id:     taskId,
    tenant_id:     tenantId,
    action:        'update',
    changes:       auditChanges,
    performed_by:  callerEmail || 'update-task-sb',
    source:        'supabase',
  }).then(() => {}, (e: unknown) => {
    console.error('[update-task-sb] audit-log insert failed:', e);
  });

  return json({
    success: true,
    taskId,
    updated: updates as Record<string, unknown>,
  }, 200);
});

// ── Helpers ─────────────────────────────────────────────────────────────

interface ValidatedTaskUpdate {
  taskNotes?:   string;
  location?:    string;
  customPrice?: number | null;
  dueDate?:     string | null;
  priority?:    string;
  assignedTo?:  string;
  result?:      string;
}

function validatePayload(body: UpdateTaskBody):
  | { updates: ValidatedTaskUpdate }
  | { error: string; code: string }
{
  const out: ValidatedTaskUpdate = {};

  if (Object.prototype.hasOwnProperty.call(body, 'taskNotes') && body.taskNotes !== undefined) {
    out.taskNotes = String(body.taskNotes ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'location') && body.location !== undefined) {
    out.location = String(body.location ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'customPrice') && body.customPrice !== undefined) {
    // GAS handleUpdateTaskCustomPrice_: empty/null clears, otherwise must
    // be a finite number. We send null on clear so Postgres NULLs the column.
    const raw = body.customPrice;
    if (raw === '' || raw === null) {
      out.customPrice = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: 'customPrice must be a number', code: 'INVALID_PARAMS' };
      out.customPrice = n;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dueDate') && body.dueDate !== undefined) {
    // YYYY-MM-DD or '' to clear. GAS stores a Date in the sheet; SB stores
    // a date string in the column. Validate format if non-empty.
    const raw = String(body.dueDate ?? '').trim();
    if (raw === '') {
      out.dueDate = null;
    } else {
      const m = /^\d{4}-\d{2}-\d{2}/.exec(raw);
      if (!m) return { error: `dueDate must be YYYY-MM-DD: ${raw}`, code: 'INVALID_PARAMS' };
      out.dueDate = raw.slice(0, 10);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'priority') && body.priority !== undefined) {
    const p = String(body.priority ?? '').trim();
    out.priority = VALID_PRIORITIES.has(p) ? p : 'Normal';
  }
  if (Object.prototype.hasOwnProperty.call(body, 'assignedTo') && body.assignedTo !== undefined) {
    out.assignedTo = String(body.assignedTo ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'result') && body.result !== undefined) {
    out.result = String(body.result ?? '');
  }

  return { updates: out };
}

async function mirrorTaskToSheet(args: {
  tenantId: string;
  taskId: string;
  updates: ValidatedTaskUpdate;
  requestId: string;
  callerEmail: string;
  sb: ReturnType<typeof createClient>;
}): Promise<void> {
  const { tenantId, taskId, updates, requestId, callerEmail, sb } = args;
  try {
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (!gasUrl || !gasToken) return;

    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      const spec = FIELD_MAP[k];
      if (!spec) continue;
      if (v === undefined) continue;
      // null serialises as JSON null; the GAS writer translates that
      // to a blank cell via api_buildRow_'s null→'' coalesce on
      // setValue (api_ensureColumn-resolved column).
      row[spec.sheetKey] = v;
    }

    const payload = {
      tenantId,
      table: 'tasks',
      op:    'update',
      rowId: taskId,
      row,
      requestId,
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
        entity_type:   'task',
        entity_id:     taskId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'update-task-sb',
        request_id:    requestId,
        payload,
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[update-task-sb] mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
