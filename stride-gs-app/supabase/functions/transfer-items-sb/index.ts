/**
 * transfer-items-sb — SB-primary handler for `transferItems`.
 *
 * Replaces GAS `handleTransferItems_` (StrideAPI.gs:22180). Cross-tenant
 * inventory move: marks source items 'Transferred', creates matching
 * inventory rows on destination, voids source's Unbilled billing,
 * re-creates billing on destination with destination's discount.
 *
 * Flow:
 *   1. Validate inputs (destinationClientSheetId, itemIds, transferDate).
 *   2. Validate destination is an active client.
 *   3. Duplicate guard: reject if any item is already Active/On Hold
 *      on the destination.
 *   4. Read source inventory rows for the items.
 *   5. INSERT destination inventory rows (status='Active', transfer_date).
 *   6. UPDATE source inventory: status='Transferred', transfer_date.
 *   7. For each source Unbilled billing row:
 *        - UPDATE source row to status='Void' with transfer note.
 *        - INSERT destination billing row with dest's discount re-applied.
 *   8. Audit log per item per tenant.
 *
 * Skipped on canary (operator handles manually if needed):
 *   • Open Tasks/Repairs port to destination. GAS handler ports them
 *     across; SB-primary leaves them on the source where they'll
 *     auto-cancel via the same release-cascade pattern (source item
 *     transitioning to 'Transferred' is treated similarly). Document.
 *   • Drive folder rename / hyperlinks.
 *
 * Response shape mirrors GAS:
 *   { success, transferredCount, voidedLedgerRows, createdLedgerRows,
 *     warnings? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TransferItemsBody {
  tenantId?: string;                    // source tenant
  destinationClientSheetId?: string;
  callerEmail?: string;
  requestId?: string;
  itemIds?: string[];
  transferDate?: string;                // YYYY-MM-DD
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: TransferItemsBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const sourceTenantId = String(body.tenantId ?? '').trim();
  const destTenantId   = String(body.destinationClientSheetId ?? '').trim();
  const callerEmail    = String(body.callerEmail ?? '').trim();
  const requestId      = String(body.requestId ?? '').trim() || crypto.randomUUID();
  const itemIds        = (body.itemIds ?? []).map(s => String(s).trim()).filter(Boolean);
  const transferDateRaw = String(body.transferDate ?? '').trim();

  if (!sourceTenantId)               return json({ success: false, error: 'tenantId (source) required' }, 400);
  if (!destTenantId)                 return json({ success: false, error: 'Missing destinationClientSheetId' }, 400);
  if (sourceTenantId === destTenantId) return json({ success: false, error: 'Destination cannot be the same as source' }, 400);
  if (itemIds.length === 0)          return json({ success: false, error: 'No item IDs provided' }, 400);

  // Transfer date: default today; reject future dates per v38.25.0
  let transferDate = transferDateRaw;
  if (!transferDate) {
    transferDate = new Date().toISOString().slice(0, 10);
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
    return json({ success: false, error: 'Invalid transferDate (use YYYY-MM-DD)' }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (transferDate > today) {
    return json({ success: false, error: 'Transfer Date cannot be in the future (Phase 1 limitation — past or present only)' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const warnings: string[] = [];

  // 1. Validate destination is an active client
  const { data: clientRows } = await sb
    .from('clients')
    .select('spreadsheet_id, name, active, discount_services_pct, discount_storage_pct')
    .in('spreadsheet_id', [sourceTenantId, destTenantId]);
  type ClientRow = {
    spreadsheet_id: string;
    name: string | null;
    active: boolean | null;
    discount_services_pct: number | null;
    discount_storage_pct: number | null;
  };
  const clientsBySid = new Map<string, ClientRow>();
  for (const c of (clientRows ?? []) as ClientRow[]) {
    clientsBySid.set(c.spreadsheet_id, c);
  }
  const srcClient  = clientsBySid.get(sourceTenantId);
  const destClient = clientsBySid.get(destTenantId);
  if (!destClient || destClient.active === false) {
    return json({ success: false, error: 'Destination is not a valid active client' }, 400);
  }
  const sourceClientName = (srcClient?.name ?? 'Source').trim() || 'Source';
  const destClientName   = (destClient.name ?? 'Destination').trim() || 'Destination';
  const srcDiscountSvc   = Number(srcClient?.discount_services_pct ?? 0);
  const srcDiscountStor  = Number(srcClient?.discount_storage_pct ?? 0);
  const destDiscountSvc  = Number(destClient.discount_services_pct ?? 0);
  const destDiscountStor = Number(destClient.discount_storage_pct ?? 0);

  // 2. Duplicate guard against destination Active/On Hold
  const { data: dupRows } = await sb
    .from('inventory')
    .select('item_id')
    .eq('tenant_id', destTenantId)
    .in('item_id', itemIds)
    .in('status', ['Active', 'On Hold']);
  if (dupRows && dupRows.length > 0) {
    const dupIds = (dupRows as Array<{ item_id: string }>).map(r => r.item_id);
    return json({
      success: false,
      error: `BLOCKED: ${dupIds.length} item(s) already exist as Active/On Hold in ${destClientName}: ${dupIds.slice(0, 10).join(', ')}`,
    }, 409);
  }

  // 3. Read source inventory rows
  const { data: srcInvRows, error: srcReadErr } = await sb
    .from('inventory')
    .select('*')
    .eq('tenant_id', sourceTenantId)
    .in('item_id', itemIds);
  if (srcReadErr) return json({ success: false, error: `Source inventory read: ${srcReadErr.message}` }, 500);
  const srcRows = (srcInvRows ?? []) as Array<Record<string, unknown>>;
  if (srcRows.length === 0) {
    return json({ success: false, error: 'No matching Inventory rows found for the provided Item IDs' }, 400);
  }

  const nowIso = new Date().toISOString();
  const transferNote = `Transferred from ${sourceClientName} to ${destClientName} on ${nowIso.slice(0, 16).replace('T', ' ')}`;

  // 4. INSERT destination inventory rows
  const destRows = srcRows
    .filter(r => String(r.status ?? '').trim() !== 'Transferred')
    .map(r => {
      const copy: Record<string, unknown> = { ...r };
      delete copy.id;                    // let DB generate new UUID PK
      copy.tenant_id = destTenantId;
      copy.status    = 'Active';
      copy.transfer_date = transferDate;
      copy.updated_at = nowIso;
      // Reset release_date — was for the source's release lifecycle, not dest's
      copy.release_date = '';
      return copy;
    });
  let transferredCount = 0;
  if (destRows.length > 0) {
    const { error: destInsErr } = await sb.from('inventory').insert(destRows);
    if (destInsErr) {
      return json({ success: false, error: `Destination inventory insert failed: ${destInsErr.message}` }, 500);
    }
    transferredCount = destRows.length;
  }

  // 5. UPDATE source rows to Transferred
  const movableSrcIds = srcRows
    .filter(r => String(r.status ?? '').trim() !== 'Transferred')
    .map(r => String(r.item_id));
  if (movableSrcIds.length > 0) {
    const { error: srcUpErr } = await sb
      .from('inventory')
      .update({ status: 'Transferred', transfer_date: transferDate, updated_at: nowIso })
      .eq('tenant_id', sourceTenantId)
      .in('item_id', movableSrcIds);
    if (srcUpErr) warnings.push(`Source inventory transfer update: ${srcUpErr.message}`);
  }

  // 6. Billing — Void source Unbilled rows + create destination rows
  // with destination's discount re-applied. Skip REPAIR/RPR svc_codes
  // (manually priced per GAS handleTransferItems_).
  let voidedLedgerRows = 0;
  let createdLedgerRows = 0;
  const { data: srcBillRows } = await sb
    .from('billing')
    .select('*')
    .eq('tenant_id', sourceTenantId)
    .in('item_id', itemIds)
    .eq('status', 'Unbilled');
  const srcBills = (srcBillRows ?? []) as Array<Record<string, unknown>>;
  for (const bill of srcBills) {
    const ledgerId = String(bill.ledger_row_id);
    const svcCode  = String(bill.svc_code ?? '').toUpperCase();
    const category = String(bill.category ?? '');
    const origRate = Number(bill.rate ?? 0);
    const qty      = Number(bill.qty ?? 1) || 1;

    // Void source row
    const voidNote = String(bill.item_notes ?? '').trim();
    const newVoidNote = voidNote ? `${voidNote} | ${transferNote}` : transferNote;
    const { error: voidErr } = await sb
      .from('billing')
      .update({ status: 'Void', item_notes: newVoidNote, updated_at: nowIso })
      .eq('tenant_id', sourceTenantId)
      .eq('ledger_row_id', ledgerId);
    if (voidErr) {
      warnings.push(`Void source billing ${ledgerId}: ${voidErr.message}`);
      continue;
    }
    voidedLedgerRows++;

    // Compute destination rate
    const skipDisc = svcCode === 'REPAIR' || svcCode === 'RPR';
    const isStorage = category.toLowerCase().includes('storage');
    const srcPct = isStorage ? srcDiscountStor : srcDiscountSvc;
    const destPct = isStorage ? destDiscountStor : destDiscountSvc;
    let newRate = origRate;
    if (!skipDisc && origRate > 0 && category) {
      // Reverse source discount → base rate → apply dest discount
      const baseRate = (srcPct !== 0 && srcPct >= -100 && srcPct <= 100)
        ? Math.round((origRate / (1 + srcPct / 100)) * 100) / 100
        : origRate;
      newRate = (destPct !== 0 && destPct >= -100 && destPct <= 100)
        ? Math.round(baseRate * (1 + destPct / 100) * 100) / 100
        : baseRate;
    }

    // Create destination row
    const destBill: Record<string, unknown> = { ...bill };
    delete destBill.id;
    destBill.tenant_id     = destTenantId;
    destBill.client_name   = destClientName;
    destBill.status        = 'Unbilled';
    destBill.invoice_no    = '';
    destBill.rate          = newRate;
    destBill.total         = newRate * qty;
    destBill.updated_at    = nowIso;
    // Ledger Row ID is unique per tenant — same ID is fine on the new
    // tenant since they don't collide (PRIMARY KEY is presumed
    // (tenant_id, ledger_row_id)).
    const { error: destBillErr } = await sb.from('billing').insert(destBill);
    if (destBillErr) {
      warnings.push(`Create dest billing ${ledgerId}: ${destBillErr.message}`);
      continue;
    }
    createdLedgerRows++;
  }

  // 7. Reverse-writethrough: source inventory rows (release-style — status
  // becomes Transferred). The inventory writer's mode-(a)+(c) handles
  // a status='Transferred' payload by writing Status without firing the
  // Released-specific ledger/auto-cancel side effects.
  for (const itemId of movableSrcIds) {
    void mirror({
      tenantId: sourceTenantId, table: 'inventory', op: 'update', rowId: itemId,
      row: { status: 'Transferred', transfer_date: transferDate },
      requestId, callerEmail, sb,
    });
  }
  // Destination inventory rows — INSERT mirror (writer is general-update;
  // the canary's destination sheet is best-effort).
  for (const row of destRows) {
    void mirror({
      tenantId: destTenantId, table: 'inventory', op: 'insert', rowId: String(row.item_id),
      row, requestId, callerEmail, sb,
    });
  }

  // 8. Audit log
  await sb.from('entity_audit_log').insert({
    entity_type: 'inventory',
    entity_id:   itemIds.join(','),
    tenant_id:   sourceTenantId,
    action:      'transfer',
    changes:     { destinationTenantId: destTenantId, transferDate, transferredCount, voidedLedgerRows, createdLedgerRows },
    performed_by: callerEmail || 'transfer-items-sb',
    source:      'supabase',
  }).then(() => {}, () => {});

  // Per-item audit log on the source for searchability
  await Promise.all(itemIds.map(id => sb.from('entity_audit_log').insert({
    entity_type:   'inventory',
    entity_id:     id,
    tenant_id:     sourceTenantId,
    action:        'transfer',
    changes:       { destinationTenantId: destTenantId, transferDate, status: { new: 'Transferred' } },
    performed_by:  callerEmail || 'transfer-items-sb',
    source:        'supabase',
  }).then(() => {}, () => {})));

  warnings.push('Open Tasks/Repairs port to destination is NOT performed by SB-primary path (canary-acceptable per MIG-016 — operator handles manually if needed).');

  return json({
    success:           true,
    transferredCount,
    voidedLedgerRows,
    createdLedgerRows,
    warnings:          warnings.length > 0 ? warnings : undefined,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

async function mirror(args: {
  tenantId: string;
  table: string;
  op: 'insert' | 'update';
  rowId: string;
  row: Record<string, unknown>;
  requestId: string;
  callerEmail: string;
  sb: ReturnType<typeof createClient>;
}): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  const reqId = `${args.requestId}:${args.rowId}`;
  try {
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: args.tenantId, table: args.table, op: args.op,
        rowId: args.rowId, row: args.row, requestId: reqId,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      await args.sb.from('gs_sync_events').insert({
        tenant_id:     args.tenantId,
        entity_type:   args.table.replace(/s$/, ''),
        entity_id:     args.rowId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  args.callerEmail || 'transfer-items-sb',
        request_id:    reqId,
        payload:       { table: args.table, op: args.op, rowId: args.rowId },
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[transfer-items-sb] mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
