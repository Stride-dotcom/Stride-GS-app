/**
 * complete-repair-sb — [MIGRATION-P4a] SB-primary handler for `completeRepair`.
 *
 * Sixth + final handler in the repair cluster. Per MIG-004 the status
 * flip + billing writes + addon flush + email all happen under one
 * logical transaction so a partial failure can't leave a repair half-
 * completed. The RPC `complete_repair_atomic` handles steps 1-4 in
 * one Postgres transaction; this edge function handles the reverse
 * writethrough (sheet mirror) + email dispatch outside that
 * transaction (best-effort, failures land in gs_sync_events).
 *
 * Flow:
 *   1. Call complete_repair_atomic RPC →
 *        UPDATE public.repairs (status, completed_date, repair_result,
 *          final_amount, repair_notes, billed)
 *        INSERT public.billing rows (one per quote_lines_json line +
 *          one per unbilled addon)
 *        UPDATE public.addons SET billed=true
 *        INSERT entity_audit_log
 *   2. For each new billing ledger_row_id: reverse-writethrough to
 *      per-tenant Billing_Ledger sheet via __writeThroughReverseBilling_.
 *   3. Reverse-writethrough repair row (status, completed_date,
 *      repair_result, final_amount, repair_notes) via existing
 *      __writeThroughReverseRepairs_.
 *   4. Send REPAIR_COMPLETE email via Resend (send-email).
 *
 * Per MIG-005 the CB Consolidated_Ledger sheet stays on its existing
 * aggregation path (independent — populated via CB-side polling or
 * Master sync, not from this handler). Retired entirely in P4b.
 *
 * Idempotency: RPC's `skipped=true` when status was already Complete
 * or Cancelled. In that case we still return ok but skip the mirror +
 * email.
 *
 * Auth: verified caller email via supabase.auth.getUser.
 *
 * Request:  POST {
 *   tenantId, repairId, resultValue: 'Pass'|'Fail',
 *   finalAmount?: number, repairNotes?: string, requestId?: string
 * }
 * Response: { ok, repairId, resultValue, skipped?, skipReason?,
 *             billingCount?, addonCount?, ledgerRowIds?,
 *             mirrorOk, mirrorError?, emailSent, emailError? }
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
    const tenantId:    string  = String(body.tenantId    ?? '').trim();
    const repairId:    string  = String(body.repairId    ?? '').trim();
    const resultValue: string  = String(body.resultValue ?? '').trim();
    const repairNotes: string | null = (body.repairNotes !== undefined && body.repairNotes !== null)
      ? String(body.repairNotes).trim() : null;
    const finalAmount: number | null = (body.finalAmount !== undefined && body.finalAmount !== null && body.finalAmount !== '')
      ? Number(body.finalAmount) : null;
    const requestId:   string  = String(body.requestId   ?? '').trim() || crypto.randomUUID();

    if (!tenantId) return json({ ok: false, error: 'tenantId is required' }, 400);
    if (!repairId) return json({ ok: false, error: 'repairId is required' }, 400);
    if (resultValue !== 'Pass' && resultValue !== 'Fail') {
      return json({ ok: false, error: "resultValue must be 'Pass' or 'Fail'", errorCode: 'INVALID_PARAMS' }, 400);
    }
    if (finalAmount !== null && Number.isNaN(finalAmount)) {
      return json({ ok: false, error: 'finalAmount must be a number', errorCode: 'INVALID_PARAMS' }, 400);
    }

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

    // ── 1. Atomic RPC ───────────────────────────────────────────────
    const { data: rpcRows, error: rpcErr } = await supabase
      .rpc('complete_repair_atomic', {
        p_tenant_id:    tenantId,
        p_repair_id:    repairId,
        p_result:       resultValue,
        p_final_amount: finalAmount,
        p_repair_notes: repairNotes,
        p_created_by:   callerEmail,
      });
    if (rpcErr) {
      console.error('[complete-repair-sb] RPC failed:', rpcErr);
      return json({ ok: false, error: `Complete failed: ${rpcErr.message}` }, 500);
    }
    const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!rpcRow) return json({ ok: false, error: 'RPC returned no rows' }, 500);

    if (rpcRow.skipped === true) {
      return json({
        ok: true, repairId, resultValue,
        skipped: true, skipReason: String(rpcRow.skip_reason ?? ''),
        mirrorOk: true, emailSent: false,
      });
    }

    const ledgerRowIds: string[] = Array.isArray(rpcRow.ledger_row_ids) ? rpcRow.ledger_row_ids : [];
    const billingCount: number = Number(rpcRow.billing_count ?? 0);
    const addonCount:   number = Number(rpcRow.addon_count   ?? 0);

    // ── 2. Reverse-writethrough each billing row to per-tenant sheet ─
    // The new __writeThroughReverseBilling_ writer expects a row payload
    // shaped like public.billing's columns. Re-read the rows from SB
    // (the RPC just inserted them) to get the canonical values and
    // forward to GAS. Failures land in gs_sync_events but don't
    // unwind the SB commit.
    let mirrorOk = true;
    let mirrorError: string | undefined;
    let mirroredCount = 0;
    if (ledgerRowIds.length > 0) {
      try {
        const { data: billRows } = await supabase
          .from('billing')
          .select('ledger_row_id, status, invoice_no, client_name, date, svc_code, svc_name, category, item_id, description, item_class, qty, rate, total, task_id, repair_id, shipment_number, item_notes, sidemark, reference')
          .eq('tenant_id', tenantId)
          .in('ledger_row_id', ledgerRowIds);
        for (const billRow of (billRows ?? []) as Array<Record<string, unknown>>) {
          try {
            const gasUrl = Deno.env.get('GAS_API_URL');
            const gasToken = Deno.env.get('GAS_API_TOKEN');
            if (!gasUrl || !gasToken) {
              mirrorOk = false; mirrorError = 'GAS_API_URL or GAS_API_TOKEN not configured';
              break;
            }
            const mirrorRes = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tenantId,
                table: 'billing',
                op:    'insert',
                rowId: String(billRow.ledger_row_id),
                row:   billRow,
                requestId,
              }),
            });
            const text = await mirrorRes.text();
            let parsed: { success?: boolean; error?: string } = {};
            try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
            if (!mirrorRes.ok || !parsed.success) {
              mirrorOk = false;
              mirrorError = parsed.error ?? `HTTP ${mirrorRes.status}`;
              // Log this specific row but keep going — partial mirror
              // is better than aborting and leaving N-1 rows un-mirrored.
              await supabase.from('gs_sync_events').insert({
                tenant_id: tenantId, entity_type: 'billing',
                entity_id: String(billRow.ledger_row_id),
                action_type: 'writethrough_reverse', sync_status: 'sync_failed',
                requested_by: `complete-repair-sb:${callerEmail}`, request_id: requestId,
                payload: { table: 'billing', op: 'insert', rowId: billRow.ledger_row_id, row: billRow },
                error_message: (mirrorError ?? 'unknown').slice(0, 1000),
              }).then(() => {}, () => {});
            } else {
              mirroredCount += 1;
            }
          } catch (mirrorEx) {
            mirrorOk = false;
            mirrorError = mirrorEx instanceof Error ? mirrorEx.message : String(mirrorEx);
          }
        }
      } catch (e) {
        mirrorOk = false;
        mirrorError = e instanceof Error ? e.message : String(e);
      }
    }

    // ── 3. Reverse-writethrough repair row (existing writer) ─────────
    // status, completed_date, repair_result, final_amount, repair_notes
    // are all in REVERSE_REPAIR_FIELDS_ (v38.215.0 + v38.216.0). Just
    // forward the relevant subset.
    try {
      const { data: repRow } = await supabase
        .from('repairs')
        .select('status, completed_date, repair_result, final_amount, repair_notes')
        .eq('tenant_id', tenantId).eq('repair_id', repairId).maybeSingle();
      if (repRow) {
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
              row:   repRow,
              requestId,
            }),
          });
          const text = await mirrorRes.text();
          let parsed: { success?: boolean; error?: string } = {};
          try { parsed = JSON.parse(text); } catch { parsed = { error: `non-JSON: ${text.slice(0, 200)}` }; }
          if (!mirrorRes.ok || !parsed.success) {
            mirrorOk = false;
            mirrorError = (mirrorError ? mirrorError + '; ' : '') + 'repairs mirror: ' + (parsed.error ?? `HTTP ${mirrorRes.status}`);
          }
        }
      }
    } catch (e) {
      mirrorOk = false;
      mirrorError = (mirrorError ? mirrorError + '; ' : '') + 'repairs mirror: ' + (e instanceof Error ? e.message : String(e));
    }

    // ── 4. Send REPAIR_COMPLETE email ────────────────────────────────
    // Resolve tokens: client name from clients, item info from inventory.
    const { data: clientRow } = await supabase
      .from('clients').select('name').eq('tenant_id', tenantId).maybeSingle();
    const clientName = (clientRow as { name?: string } | null)?.name?.trim() || 'Client';

    const { data: repairRow2 } = await supabase
      .from('repairs')
      .select('item_id, quote_amount, final_amount, completed_date, repair_notes')
      .eq('tenant_id', tenantId).eq('repair_id', repairId).maybeSingle();
    const primaryItemId = String((repairRow2 as { item_id?: string } | null)?.item_id ?? '').trim();
    const quoteAmount: number = Number((repairRow2 as { quote_amount?: number } | null)?.quote_amount ?? 0);
    const finalAmt:    number = Number((repairRow2 as { final_amount?: number } | null)?.final_amount ?? 0);
    const completedDate = String((repairRow2 as { completed_date?: string } | null)?.completed_date ?? '');
    const notes         = String((repairRow2 as { repair_notes?: string } | null)?.repair_notes ?? '');

    // Multi-item repairs: the full item list lives in public.repair_items
    // (parent repairs.item_id is only the denormalized "primary"). One repair
    // can cover N items, so the subject, the body header ({{ITEM_ID}}) and the
    // item-detail table must list ALL of them — not just the primary. Pre-fix
    // only repairs.item_id was referenced, so a batch repair's completion email
    // showed one item ID everywhere. Mirrors send-repair-quote-sb.
    interface InventoryRow {
      item_id: string; description: string | null; vendor: string | null;
      sidemark: string | null; location: string | null; item_class: string | null;
    }
    // D5 (BATCH_WORK_ITEMS_QA.md): the table also carries each item's own
    // Pass/Fail + work notes (per-item rows written by the BatchWorkItems
    // module). Items without a per-item result (legacy repairs, non-canary
    // tenants completing without the module) fall back to the PARENT result
    // so single-item repairs keep reading correctly.
    const { data: repairItemRows } = await supabase
      .from('repair_items')
      .select('item_id, created_at, item_status, item_result, item_notes')
      .eq('tenant_id', tenantId)
      .eq('repair_id', repairId)
      .order('created_at', { ascending: true });
    const repairItemMeta = new Map<string, { result: string; notes: string }>();
    for (const r of ((repairItemRows as Array<{
      item_id: string; item_status: string | null; item_result: string | null; item_notes: string | null;
    }> | null) ?? [])) {
      const id = String(r.item_id ?? '').trim();
      if (!id) continue;
      const status = String(r.item_status ?? '').trim();
      const legacy = String(r.item_result ?? '').trim().toLowerCase();
      const result = (status === 'Pass' || status === 'Fail') ? status
        : legacy === 'passed' ? 'Pass'
        : legacy === 'failed' ? 'Fail'
        : '';
      repairItemMeta.set(id, { result, notes: String(r.item_notes ?? '').trim() });
    }
    const repairItemIds = Array.from(repairItemMeta.keys());
    // Primary first (deep-link / back-compat), then remaining repair_items in
    // insertion order, de-duplicated. Legacy single-item repairs predate
    // repair_items — the primary fallback keeps them rendering one row.
    const orderedItemIds = Array.from(new Set([primaryItemId, ...repairItemIds].filter(Boolean)));

    const { data: invRows } = orderedItemIds.length > 0
      ? await supabase
          .from('inventory')
          .select('item_id, description, vendor, sidemark, location, item_class')
          .eq('tenant_id', tenantId).in('item_id', orderedItemIds)
      : { data: null };
    const invByItemId = new Map<string, InventoryRow>();
    for (const r of ((invRows as InventoryRow[] | null) ?? [])) invByItemId.set(r.item_id, r);
    // Preserve orderedItemIds order; synthesize a bare row for any item missing
    // from inventory so its ID still appears in the table. Each row carries
    // its per-item Result (fallback: the parent resultValue) + work notes.
    const orderedItems = orderedItemIds.map(id => {
      const inv = invByItemId.get(id) ?? { item_id: id, description: null, vendor: null, sidemark: null, location: null, item_class: null };
      const meta = repairItemMeta.get(id);
      return {
        ...inv,
        result: meta?.result || resultValue,
        notes:  meta?.notes ?? '',
      };
    });

    // Comma-joined list of every item — drives the subject and {{ITEM_ID}}.
    const itemIdsLabel = orderedItemIds.join(', ');
    // Count-aware grammar tokens: "{{ITEM_NOUN}}" → "item" | "items",
    // "{{ITEM_ID_LABEL}}" → "Item ID" | "Item IDs".
    const isMultiItem = orderedItemIds.length > 1;
    const itemNoun    = isMultiItem ? 'items' : 'item';
    const itemIdLabel = isMultiItem ? 'Item IDs' : 'Item ID';

    const itemTableHtml = renderItemTable(orderedItems);
    const appDeepLink = `${APP_URL}/#/repairs?open=${encodeURIComponent(repairId)}&client=${encodeURIComponent(tenantId)}`;

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
          templateKey: 'REPAIR_COMPLETE',
          tokens: {
            CLIENT_NAME:         clientName,
            REPAIR_ID:           repairId,
            ITEM_ID:             itemIdsLabel,
            ITEM_NOUN:           itemNoun,
            ITEM_ID_LABEL:       itemIdLabel,
            ITEM_TABLE_HTML:     itemTableHtml,
            REPAIR_RESULT:       resultValue,
            REPAIR_RESULT_COLOR: resultValue === 'Pass' ? '#16A34A' : '#DC2626',
            COMPLETED_DATE:      completedDate,
            // Raw numbers — REPAIR_COMPLETE template wraps each with
            // `${{...}}`, so formatCurrency() would yield $$X.XX.
            QUOTE_AMOUNT:        formatMoney(quoteAmount),
            FINAL_AMOUNT:        formatMoney(finalAmt),
            PARTS_COST:          '-',  // not tracked separately
            LABOR_HOURS:         '-',  // not tracked separately
            NOTES:               notes || '-',
            APP_URL,
            APP_DEEP_LINK:       appDeepLink,
          },
          idempotencyKey:    `repair-complete:${repairId}:${resultValue}`,
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
      console.error('[complete-repair-sb] REPAIR_COMPLETE email failed:', emailError);
      await supabase.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'repair', entity_id: repairId,
        action_type: 'send_repair_complete_email', sync_status: 'sync_failed',
        requested_by: `complete-repair-sb:${callerEmail}`, request_id: requestId,
        payload: { templateKey: 'REPAIR_COMPLETE', resultValue },
        error_message: (emailError ?? 'unknown').slice(0, 1000),
      }).then(() => {}, () => {});
    }

    return json({
      ok: true, repairId, resultValue,
      billingCount, addonCount, ledgerRowIds, mirroredCount,
      mirrorOk, mirrorError,
      emailSent, emailError,
    });

  } catch (err) {
    console.error('[complete-repair-sb] Unexpected error:', err);
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
  sidemark: string | null; location: string | null; item_class: string | null;
  /** Per-item Pass/Fail — D5: each row carries its own result since mixed
   *  outcomes are possible. Caller pre-applies the parent-result fallback. */
  result: string;
  /** Per-item work notes (repair_items.item_notes) — client-visible. */
  notes: string;
}[]): string {
  if (items.length === 0) return '';
  const td = 'padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#1F2937;vertical-align:top;';
  const th = 'padding:8px 10px;background:#F9FAFB;border-bottom:2px solid #D1D5DB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;text-align:left;';
  const resultCell = (result: string): string => {
    const r = String(result || '').trim();
    if (r === 'Pass') return `<span style="color:#15803D;font-weight:700;">&#10003; Pass</span>`;
    if (r === 'Fail') return `<span style="color:#B91C1C;font-weight:700;">&#10007; Fail</span>`;
    return '&mdash;';
  };
  const rows = items.map(it => [
    '<tr>',
    `<td style="${td}font-family:monospace;font-size:12px;">${escapeHtml(it.item_id ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.description ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.vendor ?? '')}</td>`,
    `<td style="${td}">${escapeHtml(it.sidemark ?? '')}</td>`,
    `<td style="${td}white-space:nowrap;">${resultCell(it.result)}</td>`,
    `<td style="${td}">${it.notes ? escapeHtml(it.notes) : '&mdash;'}</td>`,
    '</tr>',
  ].join('')).join('');
  return [
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;">',
    '<thead><tr>',
    `<th style="${th}">Item ID</th>`,
    `<th style="${th}">Description</th>`,
    `<th style="${th}">Vendor</th>`,
    `<th style="${th}">Sidemark</th>`,
    `<th style="${th}">Result</th>`,
    `<th style="${th}">Notes</th>`,
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
