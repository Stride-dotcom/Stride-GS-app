/**
 * send-task-complete-email-sb — SB-primary thin wrapper that fires the
 * TASK_COMPLETE or INSP_EMAIL transactional email via the canonical
 * `send-email` Edge Function.
 *
 * GAS reference: handleCompleteTask_ email branch at
 * StrideAPI.gs ~line 17966-18028 (also handleCorrectTaskResult_ at
 * StrideAPI.gs ~line 30237). Template selection:
 *   • svcCode === 'INSP' OR type.toLowerCase().includes('insp')
 *       → INSP_EMAIL
 *   • else
 *       → TASK_COMPLETE
 *
 * Replacement strategy:
 *   1. Look up the task in public.tasks (by tenant + task_id) for
 *      type, item_id, task_notes, result, etc.
 *   2. Look up the parent inventory item in public.inventory for
 *      description / vendor / sidemark / location / qty.
 *   3. Look up the client in public.clients for name + email.
 *   4. Pick the template key (INSP_EMAIL vs TASK_COMPLETE) — caller may
 *      override via templateKeyOverride.
 *   5. Build the standard token bundle + portal deep-link.
 *   6. Invoke `send-email`.
 *   7. Write entity_audit_log (entity_type='task', action='send_email').
 *
 * Recipients: caller-supplied `to` wins; else fall back to clients.email
 * ONLY (per MIGRATION_STATUS.md "Notification-routing system" backlog —
 * do NOT default to staff distros).
 *
 * Auth: verify_jwt=true (default). SERVICE_ROLE for SB reads + send-email.
 *
 * Response shape:
 *   { success: true, emailSendId, templateKey, recipientCount, deduped? }
 *   { ok: false, error: "..." }   on failure (4xx)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_PORTAL_BASE = 'https://app.stridenw.com';
const VALID_OVERRIDES = new Set(['TASK_COMPLETE', 'INSP_EMAIL']);

interface SendTaskCompleteEmailBody {
  tenantId?: string;
  taskId?: string;
  to?: string | string[];
  templateKeyOverride?: string;
  callerEmail?: string;
  requestId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  let body: SendTaskCompleteEmailBody;
  try { body = await req.json(); }
  catch (e) { return json({ ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const tenantId    = String(body.tenantId    ?? '').trim();
  const taskId      = String(body.taskId      ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const requestId   = String(body.requestId   ?? '').trim() || crypto.randomUUID();

  if (!tenantId) return json({ ok: false, error: 'tenantId is required' }, 400);
  if (!taskId)   return json({ ok: false, error: 'taskId is required' },   400);

  const overrideRaw = String(body.templateKeyOverride ?? '').trim().toUpperCase();
  if (overrideRaw && !VALID_OVERRIDES.has(overrideRaw)) {
    return json({ ok: false, error: `templateKeyOverride must be one of: ${[...VALID_OVERRIDES].join(', ')}` }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[send-task-complete-email-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  // 1. Task row
  const { data: taskRow, error: tErr } = await sb
    .from('tasks')
    .select('task_id, type, svc_code, item_id, task_notes, result, completed_at, custom_price, client_email')
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId)
    .maybeSingle();
  if (tErr) {
    console.error('[send-task-complete-email-sb] task lookup failed:', tErr.message);
    return json({ ok: false, error: `Task lookup failed: ${tErr.message}` }, 500);
  }
  if (!taskRow) return json({ ok: false, error: `Task not found: ${taskId}` }, 404);
  const task = taskRow as {
    task_id: string;
    type: string | null;
    svc_code: string | null;
    item_id: string | null;
    task_notes: string | null;
    result: string | null;
    completed_at: string | null;
    custom_price: number | null;
    client_email: string | null;
  };
  const itemId   = String(task.item_id ?? '').trim();
  const taskType = String(task.type    ?? '').trim();
  const svcCode  = String(task.svc_code ?? '').trim();

  // 2. Inventory overlay
  interface InvRow {
    description: string | null;
    vendor:      string | null;
    sidemark:    string | null;
    location:    string | null;
    qty:         number | null;
    reference:   string | null;
  }
  const { data: invRow } = itemId
    ? await sb.from('inventory')
        .select('description, vendor, sidemark, location, qty, reference')
        .eq('tenant_id', tenantId).eq('item_id', itemId).maybeSingle()
    : { data: null };
  const inv = invRow as InvRow | null;

  // 3. Client
  const { data: clientRow } = await sb
    .from('clients')
    .select('name, email')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const clientName  = (clientRow as { name?: string }  | null)?.name?.trim()  || 'Client';
  const clientEmail = (clientRow as { email?: string } | null)?.email?.trim() || '';

  // 4. Template selection — override > GAS rule
  const isInsp = svcCode.toLowerCase() === 'insp' || taskType.toLowerCase().includes('insp');
  const templateKey = overrideRaw || (isInsp ? 'INSP_EMAIL' : 'TASK_COMPLETE');

  // 5. Recipients — caller > task.client_email > clients.email.
  //    task.client_email is the per-task override stored on the row when
  //    GAS captures a one-off recipient (e.g. operator typed it during
  //    completion). Falling through to it before the client default
  //    matches GAS's api_mergeEmails_ ordering loosely.
  let toList: string[] = [];
  if (body.to) {
    toList = Array.isArray(body.to) ? body.to : [body.to];
  } else if (task.client_email && String(task.client_email).trim()) {
    toList = [String(task.client_email).trim()];
  } else if (clientEmail) {
    toList = [clientEmail];
  }
  toList = toList.map(s => String(s ?? '').trim()).filter(Boolean);
  if (toList.length === 0) {
    return json({
      ok: false,
      error: `No recipients resolved (task.client_email + clients.email both empty for tenant ${tenantId} and no 'to' override provided)`,
    }, 400);
  }

  // 6. Tokens — canonical bundle. Send-email collapses missing tokens
  //    to '' so the template owns whether each one is required.
  const result = String(task.result ?? '').trim();
  const portalLink = `${APP_PORTAL_BASE}/#/tasks/${encodeURIComponent(taskId)}`;
  const tokens: Record<string, string> = {
    CLIENT_NAME:      clientName,
    TASK_ID:          taskId,
    TASK_TYPE:        taskType,
    SVC_CODE:         svcCode,
    RESULT:           result,
    RESULT_COLOR:     result === 'Pass' ? '#16A34A' : (result === 'Fail' ? '#DC2626' : '#475569'),
    ITEM_ID:          itemId,
    ITEM_DESCRIPTION: String(inv?.description ?? ''),
    DESCRIPTION:      String(inv?.description ?? ''),
    VENDOR:           String(inv?.vendor      ?? ''),
    SIDEMARK:         String(inv?.sidemark    ?? ''),
    LOCATION:         String(inv?.location    ?? ''),
    REFERENCE:        String(inv?.reference   ?? ''),
    QTY:              String(inv?.qty         ?? ''),
    TASK_NOTES:       String(task.task_notes  ?? ''),
    COMPLETED_DATE:   task.completed_at ?? '',
    PORTAL_LINK:      portalLink,
    INVENTORY_URL:    portalLink,
  };

  // 7. Invoke send-email
  const idempotencyKey = `${templateKey}:${tenantId}:${taskId}:${requestId}`;
  const send = await invokeSendEmail(supabaseUrl, serviceKey, {
    templateKey,
    to:                toList,
    tokens,
    idempotencyKey,
    relatedEntityType: 'task',
    relatedEntityId:   taskId,
    tenantId,
  });
  if (!send.ok) {
    return json({ ok: false, error: send.error ?? 'send-email failed' }, 502);
  }

  // 8. Audit
  await sb.from('entity_audit_log').insert({
    entity_type:   'task',
    entity_id:     taskId,
    tenant_id:     tenantId,
    action:        'send_email',
    changes:       { templateKey, recipientCount: toList.length, deduped: !!send.deduped, emailSendId: send.id ?? null },
    performed_by:  callerEmail || 'send-task-complete-email-sb',
    source:        'supabase',
  }).then(() => {}, () => { /* non-fatal */ });

  return json({
    success:        true,
    emailSendId:    send.id ?? null,
    templateKey,
    recipientCount: toList.length,
    deduped:        !!send.deduped,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

interface SendEmailResult {
  ok: boolean;
  id?: string;
  resendEmailId?: string;
  deduped?: boolean;
  error?: string;
}

async function invokeSendEmail(
  supabaseUrl: string,
  serviceKey: string,
  payload: Record<string, unknown>,
): Promise<SendEmailResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':         serviceKey,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({})) as SendEmailResult;
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
