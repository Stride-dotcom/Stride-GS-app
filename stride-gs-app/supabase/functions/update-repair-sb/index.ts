/**
 * update-repair-sb — SB-primary handler for the GAS `updateRepairNotes` action.
 *
 * Replaces handleUpdateRepairNotes_ (StrideAPI.gs:19595). Save-on-blur
 * editor for the repair detail panel — accepts any subset of editable fields
 * and writes them to public.repairs.
 *
 * Editable fields (any subset; at least one required):
 *   repairNotes    → repairs.repair_notes
 *   repairVendor   → repairs.repair_vendor
 *   scheduledDate  → repairs.scheduled_date   (YYYY-MM-DD; '' clears)
 *   startDate      → repairs.start_date       (YYYY-MM-DD; '' clears)
 *
 * Description/damage/etc. are intentionally not in the GAS handler's field
 * map, so they're not exposed here either — adding them silently would
 * break parity with the GAS save-on-blur contract. If/when the GAS handler
 * grows new fields, update FIELD_MAP below in lockstep.
 *
 * Auth:
 *   verify_jwt=true (default). SERVICE_ROLE for writes. Tenant scoping
 *   enforced by router (per-tenant flag flip).
 *
 * Response (matches GAS for caller-shape parity):
 *   { success: true, repairId, updated: {...} }
 *   { error: "...", code?: "..." }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Payload key → public.repairs column. Snake-case column matches REVERSE_REPAIR_FIELDS_
// (StrideAPI.gs:3042) so the reverse-writethrough writer accepts the same keys.
const FIELD_MAP: Record<string, string> = {
  repairNotes:   'repair_notes',
  repairVendor:  'repair_vendor',
  scheduledDate: 'scheduled_date',
  startDate:     'start_date',
};

interface UpdateRepairBody {
  repairId?:      string;
  tenantId?:      string;
  callerEmail?:   string;
  requestId?:     string;
  repairNotes?:   unknown;
  repairVendor?:  unknown;
  scheduledDate?: unknown;
  startDate?:     unknown;
  [k: string]: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: UpdateRepairBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const repairId    = String(body.repairId    ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (!repairId) return json({ error: 'repairId is required', code: 'INVALID_PARAMS' }, 400);

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
    console.error('[update-repair-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // Confirm row exists (typo'd repairId → NOT_FOUND).
  const { data: prevRow, error: prevErr } = await sb
    .from('repairs')
    .select('repair_id')
    .eq('tenant_id', tenantId)
    .eq('repair_id', repairId)
    .maybeSingle();

  if (prevErr) {
    console.error('[update-repair-sb] prev-row read failed:', prevErr.message);
    return json({ error: `Read failed: ${prevErr.message}`, code: 'READ_FAILED' }, 500);
  }
  if (!prevRow) {
    return json({ error: `Repair not found: ${repairId}`, code: 'NOT_FOUND' }, 404);
  }

  // Build update row.
  const updateRow: Record<string, unknown> = {};
  for (const key of updateKeys) {
    const col = FIELD_MAP[key];
    if (!col) continue;
    updateRow[col] = (updates as Record<string, unknown>)[key];
  }
  updateRow.updated_at = new Date().toISOString();

  const { error: upErr } = await sb
    .from('repairs')
    .update(updateRow)
    .eq('tenant_id', tenantId)
    .eq('repair_id', repairId);

  if (upErr) {
    console.error('[update-repair-sb] repair update failed:', upErr.message);
    return json({ error: `Update failed: ${upErr.message}`, code: 'UPDATE_FAILED' }, 500);
  }

  // Reverse-writethrough — best-effort.
  await mirrorRepairToSheet({ tenantId, repairId, updates, requestId, callerEmail, sb });

  // Audit log — best-effort, strip framing keys.
  const auditChanges: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'repairId' || k === 'requestId' || k === 'tenantId' || k === 'callerEmail') continue;
    if (v === undefined) continue;
    auditChanges[k] = v;
  }
  await sb.from('entity_audit_log').insert({
    entity_type:  'repair',
    entity_id:    repairId,
    tenant_id:    tenantId,
    action:       'update',
    changes:      auditChanges,
    performed_by: callerEmail || 'update-repair-sb',
    source:       'supabase',
  }).then(() => {}, (e: unknown) => {
    console.error('[update-repair-sb] audit-log insert failed:', e);
  });

  return json({
    success: true,
    repairId,
    updated: updates as Record<string, unknown>,
  }, 200);
});

// ── Helpers ─────────────────────────────────────────────────────────────

function validatePayload(body: UpdateRepairBody):
  | { updates: Record<string, unknown> }
  | { error: string; code: string }
{
  const out: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, 'repairNotes') && body.repairNotes !== undefined && body.repairNotes !== null) {
    out.repairNotes = String(body.repairNotes);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'repairVendor') && body.repairVendor !== undefined) {
    out.repairVendor = String(body.repairVendor ?? '');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'scheduledDate')) {
    const raw = body.scheduledDate;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      out.scheduledDate = null;
    } else {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `scheduledDate must be YYYY-MM-DD: ${s}`, code: 'INVALID_PARAMS' };
      out.scheduledDate = s;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'startDate')) {
    const raw = body.startDate;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      out.startDate = null;
    } else {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `startDate must be YYYY-MM-DD: ${s}`, code: 'INVALID_PARAMS' };
      out.startDate = s;
    }
  }

  return { updates: out };
}

async function mirrorRepairToSheet(args: {
  tenantId: string;
  repairId: string;
  updates: Record<string, unknown>;
  requestId: string;
  callerEmail: string;
  sb: ReturnType<typeof createClient>;
}): Promise<void> {
  const { tenantId, repairId, updates, requestId, callerEmail, sb } = args;
  try {
    const gasUrl   = Deno.env.get('GAS_API_URL');
    const gasToken = Deno.env.get('GAS_API_TOKEN');
    if (!gasUrl || !gasToken) {
      console.warn('[update-repair-sb] GAS_API_URL / GAS_API_TOKEN not configured, skipping sheet mirror');
      return;
    }

    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      const col = FIELD_MAP[k];
      if (!col) continue;
      if (v === undefined) continue;
      row[col] = v;
    }
    if (Object.keys(row).length === 0) return;

    const payload = { tenantId, table: 'repairs', op: 'update', rowId: repairId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: { success?: boolean; error?: string } = {};
    try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
    if (!res.ok || !parsed.success) {
      console.error(`[update-repair-sb] sheet mirror failed for ${repairId}: ${parsed.error ?? `HTTP ${res.status}`}`);
      await sb.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  callerEmail || 'update-repair-sb',
        request_id:    requestId,
        payload,
        error_message: String(parsed.error ?? `HTTP ${res.status}`).slice(0, 1000),
      }).then(() => {}, () => { /* non-fatal */ });
    }
  } catch (e) {
    console.error('[update-repair-sb] sheet mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
