/**
 * update-task-sb — SB-primary handler for the `updateTask` action.
 *
 * Replaces the four GAS handlers covered by the legacy `updateTask*` cases:
 *   - handleUpdateTaskNotes_      (StrideAPI.gs:31321) — taskNotes, location
 *   - handleUpdateTaskCustomPrice_(StrideAPI.gs:31367) — customPrice
 *   - handleUpdateTaskDueDate_    (StrideAPI.gs:31401) — dueDate
 *   - handleUpdateTaskPriority_   (StrideAPI.gs:31434) — priority
 * plus the assigned-to single-task editor (api_setRowVal_ on Assigned To,
 * mirrors the GAS assignTask path at StrideAPI.gs:29557+).
 *
 * The legacy GAS API exposes one case per field; the router (apiRouter.ts)
 * maps the React app's unified `updateTask` action to THIS EF and lets the
 * caller batch any subset of editable fields in a single body. Each provided
 * field cleanly maps to a public.tasks column.
 *
 * Editable fields (any subset; at least one required):
 *   status         → tasks.status         (whitelist: Open|In Progress|Completed|Cancelled|On Hold)
 *   taskNotes      → tasks.task_notes
 *   customPrice    → tasks.custom_price   (numeric, null/'' = clear)
 *   assignedTo     → tasks.assigned_to
 *   dueDate        → tasks.due_date       (YYYY-MM-DD, null/'' = clear)
 *   priority       → tasks.priority       (High|Normal, default Normal)
 *   taskType       → tasks.type
 *   location       → tasks.location
 *
 * Auth:
 *   verify_jwt=true (default). SERVICE_ROLE is used for writes (RLS bypass).
 *   Tenant scoping is enforced by router (per-tenant flag flip).
 *
 * Response (matches GAS for caller-shape parity):
 *   { success: true, taskId, updated: {...} }
 *   { error: "...", code?: "..." }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Payload key → public.tasks column name.
const FIELD_MAP: Record<string, string> = {
  status:       'status',
  taskNotes:    'task_notes',
  customPrice:  'custom_price',
  assignedTo:   'assigned_to',
  dueDate:      'due_date',
  priority:     'priority',
  taskType:     'type',
  location:     'location',
};

// Per the GAS-side React app TaskStatus union (src/lib/types.ts:110) plus
// "On Hold" which appears in the broader task lifecycle docs. Keeping the
// union slightly wider than the React enum so a future status addition
// doesn't fail this validator before the React type is updated.
const VALID_STATUSES = new Set(['Open', 'In Progress', 'Completed', 'Cancelled', 'On Hold']);

interface UpdateTaskBody {
  taskId?:       string;
  tenantId?:     string;
  callerEmail?:  string;
  requestId?:    string;
  status?:       unknown;
  taskNotes?:    unknown;
  customPrice?:  unknown;
  assignedTo?:   unknown;
  dueDate?:      unknown;
  priority?:     unknown;
  taskType?:     unknown;
  location?:     unknown;
  [k: string]: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: UpdateTaskBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const taskId      = String(body.taskId      ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!taskId)   return json({ error: 'taskId is required',   code: 'INVALID_PARAMS' }, 400);

  // Validate + collect updates
  const validated = validatePayload(body);
  if ('error' in validated) {
    return json({ error: validated.error, code: validated.code }, 400);
  }
  const updates = validated.updates;
  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) {
    return json({ error: 'No editable fields provided', code: 'INVALID_PARAMS' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[update-task-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Confirm the row exists so a typo'd taskId returns NOT_FOUND.
  const { data: prevRow, error: prevErr } = await sb
    .from('tasks')
    .select('task_id')
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId)
    .maybeSingle();

  if (prevErr) {
    console.error('[update-task-sb] prev-row read failed:', prevErr.message);
    return json({ error: `Read failed: ${prevErr.message}`, code: 'READ_FAILED' }, 500);
  }
  if (!prevRow) {
    return json({ error: `Task not found: ${taskId}`, code: 'NOT_FOUND' }, 404);
  }

  // Build the UPDATE row from FIELD_MAP.
  const updateRow: Record<string, unknown> = {};
  for (const key of updateKeys) {
    const col = FIELD_MAP[key];
    if (!col) continue;
    updateRow[col] = (updates as Record<string, unknown>)[key];
  }
  updateRow.updated_at = new Date().toISOString();

  const { error: upErr } = await sb
    .from('tasks')
    .update(updateRow)
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId);

  if (upErr) {
    console.error('[update-task-sb] task update failed:', upErr.message);
    return json({ error: `Update failed: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);
  }

  // Reverse-writethrough — best effort.
  await mirrorTaskToSheet({ tenantId, taskId, updates, requestId, callerEmail, sb });

  // Audit log — best-effort. Strip identifiers/framing keys to mirror
  // update-item-sb's audit-shape contract.
  const auditChanges: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'taskId' || k === 'requestId' || k === 'tenantId' || k === 'callerEmail') continue;
    if (v === undefined) continue;
    auditChanges[k] = v;
  }
  await sb.from('entity_audit_log').insert({
    entity_type:  'task',
    entity_id:    taskId,
    tenant_id:    tenantId,
    action:       'update',
    changes:      auditChanges,
    performed_by: callerEmail || 'update-task-sb',
    source:       'supabase',
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
  status?:       string;
  task_notes?:   string;
  custom_price?: number | null;
  assigned_to?:  string;
  due_date?:     string | null;
  priority?:     string;
  type?:         string;
  location?:     string;
}

function validatePayload(body: UpdateTaskBody):
  | { updates: Record<string, unknown> }
  | { error: string; code: string }
{
  const out: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, 'status') && body.status !== undefined) {
    const s = String(body.status);
    if (!VALID_STATUSES.has(s)) return { error: `Invalid status: ${s}`, code: 'INVALID_PARAMS' };
    out.status = s;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'taskNotes') && body.taskNotes !== undefined && body.taskNotes !== null) {
    out.taskNotes = String(body.taskNotes);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'customPrice')) {
    const raw = body.customPrice;
    if (raw === null || raw === '' || raw === undefined) {
      out.customPrice = null; // clear
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { error: `customPrice must be a non-negative number`, code: 'INVALID_PARAMS' };
      out.customPrice = n;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'assignedTo') && body.assignedTo !== undefined) {
    out.assignedTo = String(body.assignedTo ?? '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'dueDate')) {
    const raw = body.dueDate;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      out.dueDate = null;
    } else {
      const s = String(raw).trim();
      // Accept YYYY-MM-DD (matches handleUpdateTaskDueDate_'s input).
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `dueDate must be YYYY-MM-DD: ${s}`, code: 'INVALID_PARAMS' };
      out.dueDate = s;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'priority') && body.priority !== undefined) {
    let p = String(body.priority ?? '').trim();
    if (p !== 'High' && p !== 'Normal') p = 'Normal'; // mirrors handleUpdateTaskPriority_
    out.priority = p;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'taskType') && body.taskType !== undefined) {
    out.taskType = String(body.taskType ?? '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'location') && body.location !== undefined) {
    out.location = String(body.location ?? '');
  }

  return { updates: out };
}

async function mirrorTaskToSheet(args: {
  tenantId: string;
  taskId: string;
  updates: Record<string, unknown>;
  requestId: string;
  callerEmail: string;
  sb: ReturnType<typeof createClient>;
}): Promise<void> {
  const { tenantId, taskId, updates, requestId, callerEmail, sb } = args;
  try {
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (!gasUrl || !gasToken) {
      console.warn('[update-task-sb] GAS_API_URL / GAS_API_TOKEN not configured, skipping sheet mirror');
      return;
    }

    // Camel→snake for the writer (matches REVERSE_TASK_FIELDS_ in StrideAPI.gs:3220).
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      const col = FIELD_MAP[k];
      if (!col) continue;
      if (v === undefined) continue;
      row[col] = v;
    }
    if (Object.keys(row).length === 0) return;

    const payload = { tenantId, table: 'tasks', op: 'update', rowId: taskId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: { success?: boolean; error?: string } = {};
    try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
    if (!res.ok || !parsed.success) {
      console.error(`[update-task-sb] sheet mirror failed for ${taskId}: ${parsed.error ?? `HTTP ${res.status}`}`);
      await sb.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'task',
        entity_id:     taskId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'update-task-sb',
        request_id:    requestId,
        payload,
        error_message: String(parsed.error ?? `HTTP ${res.status}`).slice(0, 1000),
      }).then(() => {}, () => { /* non-fatal */ });
    }
  } catch (e) {
    console.error('[update-task-sb] sheet mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
