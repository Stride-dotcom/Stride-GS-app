/**
 * respond-repair-quote-sb — [MIGRATION-P3] SB-primary for
 * `respondToRepairQuote`. Fourth handler in the repair P3 cluster.
 *
 * Behavior mirrors GAS handleRespondToRepairQuote_:
 *   • Approve → status 'Approved', approved=true. Idempotent on
 *     existing.approved=true (returns skipped:true).
 *   • Decline → status 'Declined'. Idempotent on existing.status='Declined'.
 *   • Source status check: typically 'Quote Sent' but GAS doesn't gate
 *     on it — the idempotency guard is the only protection. We mirror
 *     that: any source status with a non-approved/non-declined state
 *     can transition (clients sometimes act on a re-quote without
 *     going through 'Quote Sent' again).
 *   • Sends REPAIR_APPROVED or REPAIR_DECLINED email via Resend. Both
 *     templates use the same token set (CLIENT_NAME, REPAIR_ID,
 *     ITEM_ID, ITEM_TABLE_HTML, LOCATION, QUOTE_AMOUNT, SIDEMARK, APP_URL).
 *
 * Audit log shape (matches GAS:7767):
 *   { decision: 'Approve'|'Decline', status: { new: 'Approved'|'Declined' } }
 *
 * Auth: verified caller email via supabase.auth.getUser.
 *
 * Request:  POST { tenantId, repairId, decision: 'Approve'|'Decline', requestId? }
 * Response: { ok, repairId, decision, newStatus, skipped?, mirrorOk,
 *             mirrorError?, emailSent, emailError? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = 'https://www.mystridehub.com';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string  = String(body.tenantId ?? '').trim();
    const repairId: string  = String(body.repairId ?? '').trim();
    const decision: string  = String(body.decision ?? '').trim();
    const requestId: string = String(body.requestId ?? '').trim() || crypto.randomUUID();

    if (!tenantId) return json({ ok: false, error: 'tenantId is required' }, 400);
    if (!repairId) return json({ ok: false, error: 'repairId is required' }, 400);
    if (decision !== 'Approve' && decision !== 'Decline') {
      return json({ ok: false, error: "decision must be 'Approve' or 'Decline'", errorCode: 'INVALID_PARAMS' }, 400);
    }
    const newStatus = decision === 'Approve' ? 'Approved' : 'Declined';

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Load existing — idempotency + email-token data ────────────
    const { data: existing, error: existingErr } = await supabase
      .from('repairs')
      .select('repair_id, status, approved, item_id, quote_amount, quote_grand_total')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .maybeSingle();
    if (existingErr) return json({ ok: false, error: `Repair lookup failed: ${existingErr.message}` }, 500);
    if (!existing)   return json({ ok: false, error: `Repair ${repairId} not found` }, 404);

    // Idempotency — same as GAS:
    //   Approve: skip if approved=true
    //   Decline: skip if status='Declined'
    if (decision === 'Approve' && existing.approved === true) {
      return json({
        ok: true, repairId, decision, newStatus,
        skipped: true, message: 'Repair already approved',
        mirrorOk: true, emailSent: false,
      });
    }
    if (decision === 'Decline' && existing.status === 'Declined') {
      return json({
        ok: true, repairId, decision, newStatus,
        skipped: true, message: 'Repair already declined',
        mirrorOk: true, emailSent: false,
      });
    }

    // ── 2. UPDATE public.repairs ─────────────────────────────────────
    const patch: Record<string, unknown> = {
      status:     newStatus,
      updated_at: new Date().toISOString(),
    };
    if (decision === 'Approve') patch.approved = true;
    const { error: updErr } = await supabase
      .from('repairs')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId);
    if (updErr) return json({ ok: false, error: `Update failed: ${updErr.message}` }, 500);

    // ── 3. entity_audit_log — match GAS shape exactly ────────────────
    await supabase.from('entity_audit_log').insert({
      entity_type:  'repair',
      entity_id:    repairId,
      tenant_id:    tenantId,
      action:       'status_change',
      changes:      { decision, status: { new: newStatus } },
      performed_by: callerEmail,
      source:       'edge',
    });

    // ── 4. Reverse writethrough — just status (writer covers it) ─────
    let mirrorOk = true;
    let mirrorError: string | undefined;
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
            op:    'update',
            rowId: repairId,
            row:   { status: newStatus },
            requestId,
          }),
        });
        const text = await mirrorRes.text();
        let parsed: { success?: boolean; error?: string } = {};
        try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
        if (!mirrorRes.ok || !parsed.success) {
          mirrorOk = false;
          mirrorError = parsed.error ?? `HTTP ${mirrorRes.status}`;
        }
      } else {
        mirrorOk = false;
        mirrorError = 'GAS_API_URL or GAS_API_TOKEN not configured';
      }
    } catch (e) {
      mirrorOk = false;
      mirrorError = e instanceof Error ? e.message : String(e);
    }
    if (!mirrorOk) {
      await supabase.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  `respond-repair-quote-sb:${callerEmail}`,
        request_id:    requestId,
        payload:       { table: 'repairs', op: 'update', rowId: repairId, row: { status: newStatus } },
        error_message: (mirrorError ?? 'unknown').slice(0, 1000),
      }).then(() => {}, () => {});
    }

    // ── 5. Email tokens ──────────────────────────────────────────────
    const { data: clientRow } = await supabase
      .from('clients')
      .select('name')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const clientName = (clientRow as { name?: string } | null)?.name?.trim() || 'Client';

    // Multi-item repairs: the full item list lives in public.repair_items
    // (parent repairs.item_id is only the denormalized "primary"). One quote
    // can cover N items, so the subject, the body header ({{ITEM_ID}}) and the
    // item-detail table must list ALL of them — not just the primary. Pre-fix
    // only existing.item_id was referenced, so a batch repair's approve/decline
    // email showed one item ID everywhere. Mirrors send-repair-quote-sb.
    const primaryItemId = String(existing.item_id ?? '').trim();
    interface InventoryRow {
      item_id: string; description: string | null; vendor: string | null;
      sidemark: string | null; location: string | null;
    }
    const { data: repairItemRows } = await supabase
      .from('repair_items')
      .select('item_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .order('created_at', { ascending: true });
    const repairItemIds = ((repairItemRows as { item_id: string }[] | null) ?? [])
      .map(r => String(r.item_id ?? '').trim())
      .filter(Boolean);
    // Primary first (deep-link / back-compat), then remaining repair_items in
    // insertion order, de-duplicated. Legacy single-item repairs predate
    // repair_items — the primary fallback keeps them rendering one row.
    const orderedItemIds = Array.from(new Set([primaryItemId, ...repairItemIds].filter(Boolean)));

    const { data: invRows } = orderedItemIds.length > 0
      ? await supabase
          .from('inventory')
          .select('item_id, description, vendor, sidemark, location')
          .eq('tenant_id', tenantId).in('item_id', orderedItemIds)
      : { data: null };
    const invByItemId = new Map<string, InventoryRow>();
    for (const r of ((invRows as InventoryRow[] | null) ?? [])) invByItemId.set(r.item_id, r);
    // Preserve orderedItemIds order; synthesize a bare row for any item missing
    // from inventory so its ID still appears in the table.
    const orderedItems: InventoryRow[] = orderedItemIds.map(id =>
      invByItemId.get(id) ?? { item_id: id, description: null, vendor: null, sidemark: null, location: null });
    // Primary item's sidemark/location still drive the single-value summary
    // cells in the dark header card.
    const inv = invByItemId.get(primaryItemId) ?? null;

    // Comma-joined list of every item — drives the subject and {{ITEM_ID}}.
    const itemIdsLabel = orderedItemIds.join(', ');
    // Count-aware grammar tokens: "{{ITEM_NOUN}}" → "item" | "items",
    // "{{ITEM_ID_LABEL}}" → "Item ID" | "Item IDs".
    const isMultiItem = orderedItemIds.length > 1;
    const itemNoun    = isMultiItem ? 'items' : 'item';
    const itemIdLabel = isMultiItem ? 'Item IDs' : 'Item ID';

    const quoteAmount = existing.quote_grand_total ?? existing.quote_amount ?? 0;
    const itemTableHtml = renderItemTable(orderedItems);

    // ── 6. Send REPAIR_APPROVED or REPAIR_DECLINED via Resend ────────
    const templateKey = decision === 'Approve' ? 'REPAIR_APPROVED' : 'REPAIR_DECLINED';
    let emailSent = false;
    let emailError: string | undefined;
    try {
      const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey':         serviceKey,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({
          templateKey,
          tokens: {
            CLIENT_NAME:     clientName,
            REPAIR_ID:       repairId,
            ITEM_ID:         itemIdsLabel,
            ITEM_NOUN:       itemNoun,
            ITEM_ID_LABEL:   itemIdLabel,
            ITEM_TABLE_HTML: itemTableHtml,
            LOCATION:        inv?.location ?? '',
            SIDEMARK:        inv?.sidemark ?? '',
            // Raw number — REPAIR_APPROVED template wraps with `${{...}}`,
            // so formatCurrency() (which prefixes $) would yield $$X.XX.
            QUOTE_AMOUNT:    formatMoney(Number(quoteAmount)),
            APP_URL,
          },
          idempotencyKey:    `repair-${decision.toLowerCase()}:${repairId}`,
          relatedEntityType: 'repair',
          relatedEntityId:   repairId,
          tenantId,
        }),
      });
      const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
      if (sendJson.ok) emailSent = true;
      else emailError = String(sendJson.error ?? 'unknown');
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }
    if (!emailSent) {
      console.error(`[respond-repair-quote-sb] ${templateKey} email failed:`, emailError);
      await supabase.from('gs_sync_events').insert({
        tenant_id:     tenantId,
        entity_type:   'repair',
        entity_id:     repairId,
        action_type:   `send_${templateKey.toLowerCase()}_email`,
        sync_status:   'sync_failed',
        requested_by:  `respond-repair-quote-sb:${callerEmail}`,
        request_id:    requestId,
        payload:       { templateKey, decision },
        error_message: (emailError ?? 'unknown').slice(0, 1000),
      }).then(() => {}, () => {});
    }

    return json({
      ok: true, repairId, decision, newStatus,
      mirrorOk, mirrorError,
      emailSent, emailError,
    });

  } catch (err) {
    console.error('[respond-repair-quote-sb] Unexpected error:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function formatCurrency(n: number): string {
  return `$${formatMoney(n)}`;
}

// Same shape as formatCurrency but without the $ prefix — used for tokens
// that go into templates which provide their own '$' (e.g. `${{TOKEN}}`).
function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderItemTable(items: {
  item_id: string; description: string | null; vendor: string | null;
  sidemark: string | null; location: string | null;
}[]): string {
  if (items.length === 0) return '';
  const td = 'padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#1F2937;vertical-align:top;';
  const th = 'padding:8px 10px;background:#F9FAFB;border-bottom:2px solid #D1D5DB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;text-align:left;';
  const rows = items.map(it => [
    '<tr>',
    `<td style="${td}font-family:monospace;font-size:12px;">${escapeHtml(it.item_id ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.description ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.vendor ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.sidemark ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.location ?? '')}</td>`,
    '</tr>',
  ].join('')).join('');
  return [
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;">',
    '<thead><tr>',
    `<th style="${th}">Item ID</th>`,
    `<th style="${th}">Description</th>`,
    `<th style="${th}">Vendor</th>`,
    `<th style="${th}">Sidemark</th>`,
    `<th style="${th}">Location</th>`,
    '</tr></thead><tbody>',
    rows,
    '</tbody></table>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
