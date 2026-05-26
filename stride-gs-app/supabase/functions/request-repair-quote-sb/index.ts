/**
 * request-repair-quote-sb — Supabase Edge Function — v1 2026-05-13 PST
 *
 * SB-authoritative repair-quote-request entry point. Replaces the
 * GAS `handleRequestRepairQuote_` path for new multi-item flows
 * (single-item callers can keep using the legacy path until cutover).
 *
 * Flow:
 *   1. Validate inputs.
 *   2. Call SECURITY DEFINER RPC `create_repair_quote_request` —
 *      atomic INSERT of parent repair + N repair_items rows.
 *   3. Resolve email tokens (client name + email, item descriptions,
 *      app deep link, ITEM_TABLE_HTML rendered server-side).
 *   4. Invoke `send-email` with template `REPAIR_QUOTE_REQUEST` —
 *      that function reads recipients from the template's STAFF_EMAILS
 *      token + handles Resend dispatch + idempotency. CC's the client
 *      so they see we received their request.
 *   5. Return { ok, repairId, itemCount }.
 *
 * Failure semantics:
 *   • RPC failure → 4xx/5xx returned to caller, nothing rolled back
 *     (transaction inside RPC handles atomicity of the two INSERTs).
 *   • Email send failure → repair stays created (success from the
 *     caller's POV), gs_sync_events row written so FailedOperationsDrawer
 *     surfaces the failure for retry.
 *
 * Request:
 *   POST {
 *     tenantId:    string;
 *     itemIds:     string[];        // ≥1 item; first is the "primary"
 *     repairVendor?: string | null;
 *     repairNotes?:  string | null;
 *     itemNotes?:    string | null;
 *     createdBy?:    string | null;
 *   }
 *
 * Response:
 *   200 { ok: true, repairId: string, itemCount: number }
 *   4xx { ok: false, error: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Plain origin (no trailing `#`) so the {{APP_URL}} email token
// renders cleanly when templates concatenate it with paths. The
// deep-link variant adds the `#/` HashRouter prefix below where it's
// needed.
const APP_URL = 'https://www.mystridehub.com';

interface InventoryRow {
  item_id:     string;
  description: string | null;
  vendor:      string | null;
  sidemark:    string | null;
  location:    string | null;
  room:        string | null;
}

interface ClientRow {
  name:           string | null;
  email:          string | null;
  spreadsheet_id: string | null;
  tenant_id:      string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string = String(body.tenantId ?? '').trim();
    const itemIds: string[] = Array.isArray(body.itemIds)
      ? body.itemIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const repairVendor: string | null = body.repairVendor ? String(body.repairVendor).trim() : null;
    const repairNotes:  string | null = body.repairNotes  ? String(body.repairNotes).trim()  : null;
    const itemNotes:    string | null = body.itemNotes    ? String(body.itemNotes).trim()    : null;
    const createdBy:    string | null = body.createdBy    ? String(body.createdBy).trim()    : null;
    // v2026-05-13 — sourceTaskId for the single-item migration. When
    // called from TaskDetailPanel's "Request Repair Quote" button the
    // resulting repair links back to its parent task via this field
    // (preserves the existing GAS-side behavior). Multi-item flow from
    // Inventory bulk action leaves it null.
    const sourceTaskId: string | null = body.sourceTaskId ? String(body.sourceTaskId).trim() : null;

    if (!tenantId)             return json({ ok: false, error: 'tenantId is required' }, 400);
    if (itemIds.length === 0)  return json({ ok: false, error: 'itemIds must be a non-empty array' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      console.error('[request-repair-quote-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // Active-only guard. Repair quotes are only valid for items still in
    // storage — a Released/Transferred item can't be repaired and the
    // resulting repair would be orphaned. Picker filters to Active; this
    // catches direct API callers and picker→submit races.
    {
      const { data: statusRows, error: statusErr } = await supabase
        .from('inventory')
        .select('item_id, status')
        .eq('tenant_id', tenantId)
        .in('item_id', itemIds);
      if (statusErr) return json({ ok: false, error: `Inventory status lookup failed: ${statusErr.message}` }, 500);
      const statusByItem = new Map<string, string>();
      for (const r of (statusRows ?? []) as Array<{ item_id: string; status: string | null }>) {
        statusByItem.set(r.item_id, String(r.status ?? '').trim());
      }
      const invalid: Array<{ itemId: string; status: string }> = [];
      const notFound: string[] = [];
      for (const id of itemIds) {
        if (!statusByItem.has(id)) {
          notFound.push(id);
        } else if (statusByItem.get(id) !== 'Active') {
          invalid.push({ itemId: id, status: statusByItem.get(id) || '(blank)' });
        }
      }
      if (notFound.length > 0) {
        return json({
          ok: false,
          error: `Item(s) not found in Inventory: ${notFound.slice(0, 10).join(', ')}`,
          errorCode: 'ITEM_NOT_FOUND',
          notFound,
        }, 400);
      }
      if (invalid.length > 0) {
        const preview = invalid.slice(0, 5).map(x => `${x.itemId} (${x.status})`).join(', ');
        const more = invalid.length > 5 ? ` +${invalid.length - 5} more` : '';
        return json({
          ok: false,
          error: `Only Active items can have repair quotes requested. Non-Active item(s): ${preview}${more}`,
          errorCode: 'ITEMS_NOT_ACTIVE',
          invalidItems: invalid,
        }, 400);
      }
    }

    // ── 1. Atomic create via RPC ───────────────────────────────────────
    const { data: rpcRows, error: rpcErr } = await supabase
      .rpc('create_repair_quote_request', {
        p_tenant_id:      tenantId,
        p_item_ids:       itemIds,
        p_repair_vendor:  repairVendor,
        p_repair_notes:   repairNotes,
        p_item_notes:     itemNotes,
        p_created_by:     createdBy,
        p_source_task_id: sourceTaskId,
      });

    if (rpcErr) {
      console.error('[request-repair-quote-sb] RPC failed:', rpcErr);
      return json({ ok: false, error: `Create failed: ${rpcErr.message}` }, 500);
    }
    // RPC returns TABLE (new_repair_id text, item_count integer) — the
    // OUT parameter was renamed from `repair_id` to `new_repair_id` in
    // the 20260513180000 migration to avoid a 42702 "ambiguous column
    // reference" on the INSERT INTO repair_items ... ON CONFLICT clause.
    // See the migration file for the full RCA.
    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!rpcRow?.new_repair_id) {
      return json({ ok: false, error: 'RPC returned no repair_id' }, 500);
    }
    const repairId: string = String(rpcRow.new_repair_id);
    const itemCount: number = Number(rpcRow.item_count ?? itemIds.length);

    // ── 1b. SB→Sheet mirror: insert the new repair row into the per-tenant
    // Repairs sheet via the P1.4 reverse-writethrough framework. Best-effort:
    // failures log to gs_sync_events but don't block the user-visible
    // create (the SB row is canonical; the sheet is a downstream mirror).
    // Without this step the multi-item SB-only repair would never reach
    // the sheet — that's the gap that caused Seva Home's 2026-05-14
    // mid-quote wipe (v38.220 stopped the sync from deleting SB-only
    // rows; v38.221 stops them from BEING SB-only in the first place).
    //
    // The writer's op='insert' is an upsert (find by Repair ID, append if
    // missing, update if present), so retries are safe and we don't need
    // to track whether the row was already inserted.
    const todayPtDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const mirrorRequestId = crypto.randomUUID();
    try {
      const gasUrl = Deno.env.get('GAS_API_URL');
      const gasToken = Deno.env.get('GAS_API_TOKEN');
      if (gasUrl && gasToken) {
        const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            table: 'repairs',
            op:    'insert',
            rowId: repairId,
            row: {
              status:          'Pending Quote',
              item_id:         itemIds[0],
              created_date:    todayPtDate,
              created_by:      createdBy ?? '',
              repair_vendor:   repairVendor ?? '',
              repair_notes:    repairNotes ?? '',
              item_notes:      itemNotes ?? '',
              source_task_id:  sourceTaskId ?? '',
              approved:        false,
            },
            requestId: mirrorRequestId,
          }),
        });
        const text = await mirrorRes.text();
        let parsed: { success?: boolean; error?: string } = {};
        try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
        if (!mirrorRes.ok || !parsed.success) {
          console.error(`[request-repair-quote-sb] sheet mirror failed for ${repairId}: ${parsed.error ?? `HTTP ${mirrorRes.status}`}`);
          await supabase.from('gs_sync_events').insert({
            tenant_id:     tenantId,
            entity_type:   'repair',
            entity_id:     repairId,
            action_type:   'writethrough_reverse',
            sync_status:   'sync_failed',
            requested_by:  'request-repair-quote-sb',
            request_id:    mirrorRequestId,
            payload:       { table: 'repairs', op: 'insert', rowId: repairId },
            error_message: String(parsed.error ?? `HTTP ${mirrorRes.status}`).slice(0, 1000),
          }).then(() => {}, () => {});
        }
      } else {
        console.warn('[request-repair-quote-sb] GAS_API_URL / GAS_API_TOKEN not configured, skipping sheet mirror');
      }
    } catch (mirrorEx) {
      console.error('[request-repair-quote-sb] sheet mirror threw:', mirrorEx);
      // best-effort — SB-side commit is the authority
    }

    // ── 2. Resolve client info for email tokens ────────────────────────
    const { data: clientRow } = await supabase
      .from('clients')
      .select('name, email, spreadsheet_id, tenant_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const client = clientRow as ClientRow | null;
    const clientName  = client?.name?.trim()  || 'Client';
    const clientEmail = client?.email?.trim() || '';

    // ── 3. Resolve item info for ITEM_TABLE_HTML + back-compat tokens ──
    const { data: invRows } = await supabase
      .from('inventory')
      .select('item_id, description, vendor, sidemark, location, room')
      .eq('tenant_id', tenantId)
      .in('item_id', itemIds);

    const invByItemId = new Map<string, InventoryRow>();
    for (const r of (invRows ?? []) as InventoryRow[]) invByItemId.set(r.item_id, r);

    // Preserve caller's order — the first item is the "primary" used
    // for back-compat tokens (ITEM_ID / SIDEMARK / LOCATION).
    const orderedItems: InventoryRow[] = itemIds
      .map(id => invByItemId.get(id))
      .filter((x): x is InventoryRow => !!x);

    const primary = orderedItems[0];
    const primaryItemId   = primary?.item_id ?? itemIds[0];
    const primarySidemark = primary?.sidemark ?? '';
    const primaryLocation = primary?.location ?? '';

    const itemTableHtml = renderItemsTable(orderedItems);

    // App deep link to the new repair page. The deep-link convention
    // for the GS app uses #/repairs?open=<repair_id>&client=<tenant_id>
    // (matches the deep-link rules in CLAUDE.md — query-param form +
    // &client= so the detail panel opens). The `#/` HashRouter prefix
    // is appended here, not in APP_URL, so the {{APP_URL}} token stays
    // suitable for plain URL concatenation in the rest of the template.
    const appDeepLink = `${APP_URL}/#/repairs?open=${encodeURIComponent(repairId)}&client=${encodeURIComponent(tenantId)}`;

    // ── 4. Send email ─────────────────────────────────────────────────
    // Don't pass `to` — let send-email expand the template's recipients
    // column ({{STAFF_EMAILS}}). CC the client when we have their email.
    //
    // Resend rejects a single string containing multiple comma-joined
    // addresses (422 validation_error). `clients.email` is stored as
    // comma- or semicolon-joined for clients with multiple contacts
    // (e.g. "seattle@x.com, losangeles@x.com") — split + trim + dedupe
    // + filter blanks before passing to the CC array. Matches the same
    // normalize step send-email already applies to the `to` field
    // (send-email/index.ts:222).
    const ccEmails = clientEmail
      ? Array.from(new Set(
          clientEmail.split(/[,;]/)
            .map(s => s.trim())
            .filter(s => s && s.includes('@'))
        ))
      : [];
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':         serviceKey,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({
        templateKey: 'REPAIR_QUOTE_REQUEST',
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        tokens: {
          CLIENT_NAME:     clientName,
          REPAIR_ID:       repairId,
          ITEM_ID:         primaryItemId,
          SIDEMARK:        primarySidemark,
          LOCATION:        primaryLocation,
          ITEM_TABLE_HTML: itemTableHtml,
          APP_URL:         APP_URL,
          APP_DEEP_LINK:   appDeepLink,
        },
        idempotencyKey:    `repair-quote-request:${repairId}`,
        relatedEntityType: 'repair',
        relatedEntityId:   repairId,
        tenantId,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
    if (!sendJson.ok) {
      // Repair already created — surface email failure to FailedOperationsDrawer.
      console.error('[request-repair-quote-sb] send-email failed:', JSON.stringify(sendJson));
      // Audit-log the email failure to gs_sync_events for
      // FailedOperationsDrawer. If the audit insert itself fails (e.g.
      // RLS regression, network blip) log it loudly — silently
      // swallowing means the operator has no signal that the email
      // didn't go out.
      try {
        const { error: logErr } = await supabase.from('gs_sync_events').insert({
          tenant_id:     tenantId,
          entity_type:   'repair',
          entity_id:     repairId,
          action_type:   'send_repair_quote_request_email',
          sync_status:   'sync_failed',
          requested_by:  'request-repair-quote-sb',
          request_id:    crypto.randomUUID(),
          payload:       { itemIds, clientEmail, ccd: !!clientEmail },
          error_message: String(sendJson.error ?? 'unknown').slice(0, 1000),
        });
        if (logErr) {
          console.error('[request-repair-quote-sb] gs_sync_events insert failed:', logErr.message);
        }
      } catch (logEx) {
        console.error('[request-repair-quote-sb] gs_sync_events insert threw:', logEx);
      }
      // Still return success — the repair is created. Email is the side
      // effect; the operator can resend from the repair page.
      return json({ ok: true, repairId, itemCount, emailFailed: true, emailError: String(sendJson.error ?? '') });
    }

    console.log(`[request-repair-quote-sb] Created repair ${repairId} with ${itemCount} item(s) for tenant=${tenantId}`);
    return json({ ok: true, repairId, itemCount });

  } catch (err) {
    console.error('[request-repair-quote-sb] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * Render the items list as an HTML table for the {{ITEM_TABLE_HTML}}
 * token. Inline styles only — email clients strip <style> blocks.
 * Mirrors the table shape used by the legacy GAS quote builder so the
 * existing template's surrounding HTML doesn't need to change.
 */
function renderItemsTable(items: InventoryRow[]): string {
  if (items.length === 0) return '';
  const cellTd =
    'padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#1F2937;vertical-align:top;';
  const cellTh =
    'padding:8px 10px;background:#F9FAFB;border-bottom:2px solid #D1D5DB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;text-align:left;';
  const rows = items
    .map(it => {
      const desc = escapeHtml(it.description ?? '');
      const id   = escapeHtml(it.item_id ?? '');
      const ven  = escapeHtml(it.vendor ?? '');
      const sm   = escapeHtml(it.sidemark ?? '');
      const loc  = escapeHtml(it.location ?? '');
      return [
        '<tr>',
        `<td style="${cellTd}font-family:monospace;font-size:12px;">${id}</td>`,
        `<td style="${cellTd}">${desc}</td>`,
        `<td style="${cellTd}">${ven}</td>`,
        `<td style="${cellTd}">${sm}</td>`,
        `<td style="${cellTd}">${loc}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');
  return [
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;">',
    '<thead><tr>',
    `<th style="${cellTh}">Item ID</th>`,
    `<th style="${cellTh}">Description</th>`,
    `<th style="${cellTh}">Vendor</th>`,
    `<th style="${cellTh}">Sidemark</th>`,
    `<th style="${cellTh}">Location</th>`,
    '</tr></thead>',
    `<tbody>${rows}</tbody>`,
    '</table>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
