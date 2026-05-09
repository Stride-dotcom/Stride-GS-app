/**
 * notify-task-client-note — Supabase Edge Function
 *
 * Fires from React (useEntityNotes.addNote) fire-and-forget after a
 * successful entity_notes INSERT when entityType='task' and the author's
 * role is 'client'. Server-side this function:
 *   1. Loads the note from entity_notes (rejecting non-task or non-client
 *      writes the React caller couldn't have known about — RLS + role
 *      double-check).
 *   2. Hydrates task / item / client context.
 *   3. Builds tokens for TASK_CLIENT_NOTE and delegates to send-email
 *      (Resend), which expands NOTIFICATION_EMAILS to the office list.
 *
 * Pattern mirror: notify-public-request — both compose `send-email` with
 * an idempotency key per source row.
 *
 * Request:  POST { noteId: string }
 * Response: { ok: boolean, sent?: boolean, deduped?: boolean, skippedReason?: string, error?: string }
 *
 * Required Edge Function secrets:
 *   SUPABASE_URL                  (auto-provided)
 *   SUPABASE_SERVICE_ROLE_KEY     (auto-provided)
 *   RESEND_API_KEY                (used by send-email)
 *   NOTIFICATION_EMAILS           (comma-separated office addresses)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_BASE = 'https://www.mystridehub.com';
const ACCEPTANCE_PREFIX = '✓ Accepted as-is';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const noteId: string = body.noteId ?? '';
    if (!noteId) {
      return json({ ok: false, error: 'noteId required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      console.error('[notify-task-client-note] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Load the note. RLS bypassed via service role.
    const { data: note, error: noteErr } = await supabase
      .from('entity_notes')
      .select('id, entity_type, entity_id, item_id, body, is_system, author_name, author_role, tenant_id, created_at')
      .eq('id', noteId)
      .maybeSingle();
    if (noteErr || !note) {
      return json({ ok: false, error: `Note not found: ${noteErr?.message ?? 'unknown'}` }, 404);
    }

    // Server-side gate: only task notes from client-role authors trigger an
    // alert. Anything else is a no-op success — the React caller fired
    // optimistically; we don't want to flap on edge cases (admin/staff
    // posting on a client task with the wrong cached role, etc.).
    if (note.entity_type !== 'task') {
      return json({ ok: true, sent: false, skippedReason: `entity_type=${note.entity_type}` });
    }
    if (note.author_role !== 'client') {
      return json({ ok: true, sent: false, skippedReason: `author_role=${note.author_role}` });
    }

    // 2. Hydrate task.
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('task_id, tenant_id, item_id, type, status, result')
      .eq('tenant_id', note.tenant_id)
      .eq('task_id', note.entity_id)
      .maybeSingle();
    if (taskErr) {
      console.warn('[notify-task-client-note] task fetch failed (continuing with note-only context):', taskErr.message);
    }

    const itemId = note.item_id ?? task?.item_id ?? '';
    const tenantId = note.tenant_id ?? task?.tenant_id ?? '';

    // 3. Hydrate item (best-effort; an item may not exist for some task types).
    let item: { description?: string | null; sidemark?: string | null; reference?: string | null } | null = null;
    if (tenantId && itemId) {
      const { data } = await supabase
        .from('inventory')
        .select('description, sidemark, reference')
        .eq('tenant_id', tenantId)
        .eq('item_id', itemId)
        .maybeSingle();
      item = data;
    }

    // 4. Hydrate client (display name).
    let clientName = '(unknown client)';
    if (tenantId) {
      const { data } = await supabase
        .from('clients')
        .select('name')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (data?.name) clientName = data.name;
    }

    // 5. Build tokens.
    const isAcceptance = !!note.is_system && (note.body ?? '').startsWith(ACCEPTANCE_PREFIX);
    const noteKind = isAcceptance ? 'Acceptance' : 'Comment';
    const taskResult = (task?.result ?? '').toString().trim();
    const taskResultSuffix = taskResult ? ` (${taskResult})` : '';

    // CLAUDE.md: deep links are query-param style with &client=. Route-style
    // (/#/tasks/<id>) gets stripped by Gmail past the # fragment. tenant_id
    // is the clientSheetId in this app — same value the GAS deep links use.
    const deepLink =
      `${APP_BASE}/#/tasks?open=${encodeURIComponent(note.entity_id)}` +
      (tenantId ? `&client=${encodeURIComponent(tenantId)}` : '');

    const tokens: Record<string, string> = {
      NOTE_KIND:         noteKind,
      CLIENT_NAME:       clientName,
      AUTHOR_NAME:       note.author_name ?? 'Client',
      NOTE_BODY:         note.body ?? '',
      NOTE_TIME:         formatPacificDate(note.created_at),
      ITEM_ID:           itemId || '—',
      ITEM_DESCRIPTION:  (item?.description ?? '').trim() || '—',
      ITEM_SIDEMARK:     (item?.sidemark ?? '').trim() || '—',
      ITEM_REFERENCE:    (item?.reference ?? '').trim() || '—',
      TASK_ID:           task?.task_id ?? note.entity_id,
      TASK_TYPE:         task?.type ?? '—',
      TASK_STATUS:       task?.status ?? '—',
      TASK_RESULT_SUFFIX: taskResultSuffix,
      DEEP_LINK:         deepLink,
    };

    // 6. Send. Idempotency keyed on note id so React retries don't double-send.
    const r = await invokeSendEmail(supabaseUrl, serviceKey, {
      templateKey: 'TASK_CLIENT_NOTE',
      tokens,
      idempotencyKey: `task-client-note:${note.id}`,
      relatedEntityType: 'task',
      relatedEntityId: note.entity_id,
      tenantId: tenantId || undefined,
    });

    if (!r.ok) {
      console.error('[notify-task-client-note] send-email failed:', r.detail);
      return json({ ok: false, error: 'send-email failed', detail: r.detail }, 502);
    }

    return json({ ok: true, sent: true, deduped: !!(r.detail as { deduped?: boolean })?.deduped });
  } catch (err) {
    console.error('[notify-task-client-note] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function formatPacificDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

async function invokeSendEmail(
  supabaseUrl: string,
  serviceKey: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; detail?: unknown }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: !!j.ok, detail: j };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
