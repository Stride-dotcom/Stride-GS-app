/**
 * update-repair-sb — SB-primary handler for the `updateRepairNotes`
 * GAS action (which despite the name accepts repair_notes, repair_vendor,
 * scheduled_date, start_date, item_notes, task_notes via field-by-field
 * checks). See handleUpdateRepairNotes_ at StrideAPI.gs:19595.
 *
 * Mirrors the update-task-sb pattern: validate, UPDATE public.repairs,
 * fire reverse-writethrough via the v38.215.0 `__writeThroughReverseRepairs_`
 * writer (already covers the 4 fields below + extras), audit log.
 *
 * Field map (payload key → public.repairs column):
 *   repairNotes    → repair_notes
 *   repairVendor   → repair_vendor
 *   scheduledDate  → scheduled_date  ('' clears)
 *   startDate      → start_date      ('' clears)
 *   itemNotes      → item_notes      (forward-compat — not currently on
 *                                     the GAS apiPost surface but present
 *                                     on Repairs sheet schema)
 *   taskNotes      → task_notes      (same)
 *
 * Response shape mirrors GAS:
 *   { success: true, repairId, saved: [...] }
 *   { error: '...', code?: '...' }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateRepairBody {
  repairId?: string;
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  repairNotes?: unknown;
  repairVendor?: unknown;
  scheduledDate?: unknown;
  startDate?: unknown;
  itemNotes?: unknown;
  taskNotes?: unknown;
  [k: string]: unknown;
}

const FIELD_MAP: Record<string, { column: string; sheetKey: string; kind: 'text' | 'date' }> = {
  repairNotes:   { column: 'repair_notes',   sheetKey: 'repair_notes',   kind: 'text' },
  repairVendor:  { column: 'repair_vendor',  sheetKey: 'repair_vendor',  kind: 'text' },
  scheduledDate: { column: 'scheduled_date', sheetKey: 'scheduled_date', kind: 'date' },
  startDate:     { column: 'start_date',     sheetKey: 'start_date',     kind: 'date' },
  itemNotes:     { column: 'item_notes',     sheetKey: 'item_notes',     kind: 'text' },
  taskNotes:     { column: 'task_notes',     sheetKey: 'task_notes',     kind: 'text' },
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: UpdateRepairBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const repairId    = String(body.repairId    ?? '').trim();
  const tenantId    = String(body.tenantId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!repairId) return json({ error: 'repairId is required', code: 'INVALID_PARAMS' }, 400);

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

  // Confirm repair exists
  const { data: existing, error: readErr } = await sb
    .from('repairs')
    .select('repair_id')
    .eq('tenant_id', tenantId)
    .eq('repair_id', repairId)
    .maybeSingle();
  if (readErr)  return json({ error: `Read failed: ${readErr.message}`, code: 'READ_FAILED' }, 500);
  if (!existing) return json({ error: `Repair not found: ${repairId}`, code: 'NOT_FOUND' }, 404);

  // Build UPDATE row
  const updateRow: Record<string, unknown> = {};
  for (const k of updateKeys) {
    const spec = FIELD_MAP[k];
    if (!spec) continue;
    updateRow[spec.column] = (updates as Record<string, unknown>)[k];
  }
  updateRow.updated_at = new Date().toISOString();

  const { error: upErr } = await sb
    .from('repairs')
    .update(updateRow)
    .eq('tenant_id', tenantId)
    .eq('repair_id', repairId);
  if (upErr) return json({ error: `Update failed: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);

  // Reverse-writethrough — v38.215.0 writer covers these fields
  await mirrorRepairToSheet({ tenantId, repairId, updates, requestId, callerEmail, sb });

  // Audit log — payload minus identifiers
  const auditChanges: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'repairId' || k === 'requestId' || k === 'tenantId' || k === 'callerEmail') continue;
    if (v === undefined) continue;
    auditChanges[k] = v;
  }
  await sb.from('entity_audit_log').insert({
    entity_type:   'repair',
    entity_id:     repairId,
    tenant_id:     tenantId,
    action:        'update',
    changes:       auditChanges,
    performed_by:  callerEmail || 'update-repair-sb',
    source:        'supabase',
  }).then(() => {}, () => {});

  return json({
    success: true,
    repairId,
    saved:   updateKeys,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

interface ValidatedRepairUpdate {
  repairNotes?:   string;
  repairVendor?:  string;
  scheduledDate?: string | null;
  startDate?:     string | null;
  itemNotes?:     string;
  taskNotes?:     string;
}

function validatePayload(body: UpdateRepairBody):
  | { updates: ValidatedRepairUpdate }
  | { error: string; code: string }
{
  const out: ValidatedRepairUpdate = {};
  for (const [k, spec] of Object.entries(FIELD_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
    const v = (body as Record<string, unknown>)[k];
    if (v === undefined) continue;

    if (spec.kind === 'date') {
      // Empty/null → clear. Otherwise YYYY-MM-DD (slice off any T...).
      const raw = String(v ?? '').trim();
      if (raw === '') {
        (out as Record<string, unknown>)[k] = null;
      } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        (out as Record<string, unknown>)[k] = raw.slice(0, 10);
      } else {
        return { error: `${k} must be YYYY-MM-DD: ${raw}`, code: 'INVALID_PARAMS' };
      }
    } else {
      (out as Record<string, unknown>)[k] = String(v ?? '');
    }
  }
  return { updates: out };
}

async function mirrorRepairToSheet(args: {
  tenantId: string;
  repairId: string;
  updates: ValidatedRepairUpdate;
  requestId: string;
  callerEmail: string;
  sb: ReturnType<typeof createClient>;
}): Promise<void> {
  const { tenantId, repairId, updates, requestId, callerEmail, sb } = args;
  try {
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (!gasUrl || !gasToken) return;

    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      const spec = FIELD_MAP[k];
      if (!spec) continue;
      if (v === undefined) continue;
      row[spec.sheetKey] = v;
    }

    const payload = {
      tenantId,
      table: 'repairs',
      op:    'update',
      rowId: repairId,
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
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'update-repair-sb',
        request_id:    requestId,
        payload,
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[update-repair-sb] mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
