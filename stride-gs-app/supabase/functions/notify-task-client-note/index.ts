/**
 * notify-task-client-note — Supabase Edge Function
 *
 * Fires from React (useEntityNotes.addNote) fire-and-forget after a
 * successful entity_notes INSERT when entity_type ∈ {'task', 'repair'}
 * and the author's role is 'client'. Server-side this function:
 *   1. Loads the note from entity_notes (rejecting non-task/repair or
 *      non-client writes the React caller couldn't have known about —
 *      RLS + role double-check).
 *   2. Hydrates the parent entity (task OR repair) + item + client.
 *   3. Builds tokens for TASK_CLIENT_NOTE and delegates to send-email
 *      (Resend), which expands NOTIFICATION_EMAILS to the office list.
 *
 * The function name keeps the legacy "task" suffix for the URL — it was
 * deployed before repairs were in scope. Internally it's entity-agnostic
 * and the same template covers both. Renaming the function would break
 * the React invoke call without buying anything.
 *
 * Pattern mirror: notify-public-request — both compose `send-email` with
 * an idempotency key per source row.
 *
 * Request:  POST { noteId: string }
 * Response: { ok, sent?, deduped?, skippedReason?, error? }
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

// Per-entity routing for hydration + deep links. v4 (2026-05-09) added
// inventory / shipment / will_call / claim — the React side fires the
// notifier on every client-authored note now, so the route map is the
// authoritative coverage list. Adding a new entity type means: one
// entry here, no React changes.
const ENTITY_ROUTES: Record<string, {
  table: string;
  idColumn: string;
  typeColumn?: string;       // optional sub-classifier (tasks have type=INSP/ASM/...)
  resultColumn?: string;     // optional pass/fail field
  defaultTypeLabel: string;  // ENTITY_LABEL — used in subject + table rows + CTA
  routePath: string;         // CLAUDE.md deep-link format: /#/<route>?open=<id>&client=<tenant>
}> = {
  task: {
    table: 'tasks',
    idColumn: 'task_id',
    typeColumn: 'type',
    resultColumn: 'result',
    defaultTypeLabel: 'Task',
    routePath: '/#/tasks',
  },
  repair: {
    table: 'repairs',
    idColumn: 'repair_id',
    // repairs has repair_result; status itself encodes Failed/Complete so we
    // surface status in the result-suffix slot for repairs.
    resultColumn: 'repair_result',
    defaultTypeLabel: 'Repair',
    routePath: '/#/repairs',
  },
  inventory: {
    table: 'inventory',
    idColumn: 'item_id',         // entity_id == item_id for inventory notes
    defaultTypeLabel: 'Item',
    routePath: '/#/inventory',
  },
  shipment: {
    table: 'shipments',
    idColumn: 'shipment_number',
    defaultTypeLabel: 'Shipment',
    routePath: '/#/shipments',
  },
  will_call: {
    table: 'will_calls',
    idColumn: 'wc_number',
    defaultTypeLabel: 'Will Call',
    routePath: '/#/will-calls',
  },
  claim: {
    table: 'claims',
    idColumn: 'claim_id',
    defaultTypeLabel: 'Claim',
    routePath: '/#/claims',
  },
};

interface ParentRow {
  tenant_id?: string | null;
  item_id?: string | null;
  type?: string | null;
  status?: string | null;
  result?: string | null;
  repair_result?: string | null;
}

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

    const { data: note, error: noteErr } = await supabase
      .from('entity_notes')
      .select('id, entity_type, entity_id, item_id, body, is_system, author_name, author_role, tenant_id, created_at')
      .eq('id', noteId)
      .maybeSingle();
    if (noteErr || !note) {
      return json({ ok: false, error: `Note not found: ${noteErr?.message ?? 'unknown'}` }, 404);
    }

    // Server-side gate: only client-role authors on a routable entity_type
    // trigger an alert. The React caller fired optimistically; we don't
    // want to flap on edge cases (admin posting on a client task with a
    // stale cached role, future entity types we haven't routed yet, etc.).
    const route = ENTITY_ROUTES[note.entity_type];
    if (!route) {
      return json({ ok: true, sent: false, skippedReason: `entity_type=${note.entity_type}` });
    }
    if (note.author_role !== 'client') {
      return json({ ok: true, sent: false, skippedReason: `author_role=${note.author_role}` });
    }

    // Hydrate the parent entity. Select * because the column shapes differ
    // between tasks and repairs and we read each through the ParentRow
    // optional view below.
    let parent: ParentRow | null = null;
    if (note.tenant_id) {
      const { data, error: parentErr } = await supabase
        .from(route.table)
        .select('*')
        .eq('tenant_id', note.tenant_id)
        .eq(route.idColumn, note.entity_id)
        .maybeSingle();
      if (parentErr) {
        console.warn(`[notify-task-client-note] ${route.table} fetch failed:`, parentErr.message);
      }
      parent = (data as ParentRow | null) ?? null;
    }

    const itemId   = note.item_id ?? parent?.item_id ?? '';
    const tenantId = note.tenant_id ?? parent?.tenant_id ?? '';

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

    let clientName = '(unknown client)';
    if (tenantId) {
      const { data } = await supabase
        .from('clients')
        .select('name')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (data?.name) clientName = data.name;
    }

    const isAcceptance = !!note.is_system && (note.body ?? '').startsWith(ACCEPTANCE_PREFIX);
    const noteKind = isAcceptance ? 'Acceptance' : 'Comment';

    // Result-suffix logic differs by entity:
    //   Tasks:   parent.result is 'Pass' | 'Fail' (or empty) — show literally
    //   Repairs: parent.repair_result mirrors that, but the status field
    //            ('Failed', 'Complete', etc.) is the source of truth shown
    //            elsewhere. Either field, when present, lands here.
    const rawResult = route.resultColumn === 'repair_result'
      ? (parent?.repair_result ?? '').toString().trim()
      : (parent?.result ?? '').toString().trim();
    const resultSuffix = rawResult ? ` (${rawResult})` : '';

    // CLAUDE.md: deep links are query-param style with &client=. Route-style
    // (/#/tasks/<id>) gets stripped by Gmail past the # fragment. tenant_id
    // is the clientSheetId in this app — same value the GAS deep links use.
    const deepLink =
      `${APP_BASE}${route.routePath}?open=${encodeURIComponent(note.entity_id)}` +
      (tenantId ? `&client=${encodeURIComponent(tenantId)}` : '');

    // v3 — entity-agnostic tokens. The template was rewritten to consume
    // ENTITY_* names so a repair event no longer reads "Task RPR-12345
    // (Repair)" with a "Task" row label. See migration
    // 20260508140000_task_client_note_entity_tokens.sql.
    const tokens: Record<string, string> = {
      NOTE_KIND:            noteKind,
      CLIENT_NAME:          clientName,
      AUTHOR_NAME:          note.author_name ?? 'Client',
      NOTE_BODY:            note.body ?? '',
      NOTE_TIME:            formatPacificDate(note.created_at),
      ITEM_ID:              itemId || '—',
      ITEM_DESCRIPTION:     (item?.description ?? '').trim() || '—',
      ITEM_SIDEMARK:        (item?.sidemark ?? '').trim() || '—',
      ITEM_REFERENCE:       (item?.reference ?? '').trim() || '—',
      ENTITY_LABEL:         route.defaultTypeLabel,
      ENTITY_LABEL_LOWER:   route.defaultTypeLabel.toLowerCase(),
      ENTITY_ID:            note.entity_id,
      ENTITY_TYPE_DETAIL:   parent?.type?.toString().trim() || route.defaultTypeLabel,
      ENTITY_STATUS:        parent?.status?.toString().trim() || '—',
      ENTITY_RESULT_SUFFIX: resultSuffix,
      DEEP_LINK:            deepLink,
    };

    const r = await invokeSendEmail(supabaseUrl, serviceKey, {
      templateKey: 'TASK_CLIENT_NOTE',
      tokens,
      idempotencyKey: `task-client-note:${note.id}`,
      relatedEntityType: note.entity_type,
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
