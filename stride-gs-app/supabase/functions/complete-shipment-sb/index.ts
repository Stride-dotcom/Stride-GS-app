/**
 * complete-shipment-sb — SB-primary handler for `completeShipment`
 * (a.k.a. receiveShipment).
 *
 * Replaces GAS `handleCompleteShipment_` (StrideAPI.gs:16966). Receiving
 * is the highest-impact operational write in the system — one call
 * creates: 1 shipment row + N inventory rows + ≤2N tasks (auto-INSP /
 * auto-ASM) + N+ billing rows (RCVG + addons).
 *
 * Flow:
 *   1. Validate inputs (items[], required per-item fields).
 *   2. Generate Shipment # via Postgres next_shipment_no() function
 *      (atomic SEQUENCE — same v38.182 race fix as next_invoice_no).
 *   3. Idempotency: check public.shipments.notes for the IK tag.
 *      Existing shipment with same key → return alreadyProcessed.
 *   4. Duplicate Item ID guard: reject if any incoming item_id is
 *      already Active or On Hold in public.inventory.
 *   5. INSERT public.shipments.
 *   6. INSERT N public.inventory rows.
 *   7. INSERT auto-INSP / auto-ASM tasks per item (respecting
 *      needsInspection / needsAssembly per-item flags).
 *   8. INSERT N receiving billing rows (Unbilled, code='RCVG') if
 *      billing enabled. Rate from public.service_catalog + per-client
 *      discount. Addons (item.addons[]) produce additional rows.
 *   9. Reverse-writethrough: shipments writer (stub today —
 *      gs_sync_events for canary), inventory rows (existing writer),
 *      tasks rows (v38.227.0 writer).
 *  10. Audit log: per shipment + per inventory item + per task.
 *
 * Response shape mirrors GAS handleCompleteShipment_:
 *   { success, shipmentNo, itemsCreated, tasksCreated, billingRows,
 *     warnings? }
 *
 * Canary-acceptable gaps documented per scope:
 *   • Drive folder creation skipped. React's "Open folder" links will
 *     fail for SB-primary shipments until the operator manually
 *     creates the folder OR until a Drive-creation Edge Function is
 *     wired. Acceptable on Justin Demo canary.
 *   • Shipment-received email skipped. Operator manually sends from
 *     React if needed, or wire send-email EF in a follow-up.
 *   • Shipments reverse-writethrough writer is still a stub at GAS-side;
 *     per-tenant Shipments sheet drifts until full-sync cron.
 *
 * Project context: MIG-016. Production tenants stay on GAS via
 * per-tenant scope.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ShipmentItem {
  itemId: string;
  qty?: number;
  vendor?: string;
  description: string;
  class: string;
  location?: string;
  sidemark?: string;
  reference?: string;
  room?: string;
  itemNotes?: string;
  needsInspection?: boolean;
  needsAssembly?: boolean;
  addons?: string[];
}

interface CompleteShipmentBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  items?: ShipmentItem[];
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  idempotencyKey?: string;
  receiveDate?: string; // YYYY-MM-DD
  skipReceivingBilling?: boolean;
  autoInspectionLoaded?: boolean;
}

interface ServiceCatalogRow {
  code:      string;
  name:      string;
  category:  string | null;
  billing:   string | null;
  rates:     Record<string, number> | null;
  flat_rate: number | null;
  xxl_rate:  number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body: CompleteShipmentBody;
  try { body = await req.json(); }
  catch (e) { return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 400); }

  const tenantId        = String(body.tenantId        ?? '').trim();
  const callerEmail     = String(body.callerEmail     ?? '').trim();
  const requestId       = String(body.requestId       ?? '').trim() || crypto.randomUUID();
  const carrier         = String(body.carrier         ?? '').trim();
  const trackingNumber  = String(body.trackingNumber  ?? '').trim();
  const userNotes       = String(body.notes           ?? '').trim();
  const idempotencyKey  = String(body.idempotencyKey  ?? '').trim();
  const skipReceivingBilling = body.skipReceivingBilling === true;
  const clientTrustsFlags    = body.autoInspectionLoaded === true;
  const items: ShipmentItem[] = Array.isArray(body.items) ? body.items : [];

  if (!tenantId)       return json({ error: 'tenantId is required',   code: 'INVALID_PARAMS' }, 400);
  if (items.length === 0) return json({ error: 'No items provided',   code: 'INVALID_PARAMS' }, 400);

  // Receive date — default to today (UTC slice is fine; the column
  // is text storing YYYY-MM-DD).
  let receiveDateIso = String(body.receiveDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receiveDateIso)) {
    receiveDateIso = new Date().toISOString().slice(0, 10);
  }

  // Per-item validation
  const missing: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.itemId)      missing.push(`Item ${i + 1}: missing itemId`);
    if (!it.description) missing.push(`Item ${i + 1}: missing description`);
    if (!it.class)       missing.push(`Item ${i + 1}: missing class`);
  }
  if (missing.length) {
    return json({ error: `Validation failed: ${missing.slice(0, 10).join('; ')}`, code: 'VALIDATION_ERROR' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  const warnings: string[] = [];

  // 1. Idempotency check — look for an existing shipment whose notes
  // carry the [IK:<key>] tag. Matches the GAS pattern at
  // StrideAPI.gs:17065.
  if (idempotencyKey) {
    const ikTag = `[IK:${idempotencyKey}]`;
    const { data: ikRows } = await sb
      .from('shipments')
      .select('shipment_number, notes')
      .eq('tenant_id', tenantId)
      .like('notes', `%${ikTag}%`)
      .limit(1);
    if (ikRows && ikRows.length > 0) {
      const existing = (ikRows[0] as { shipment_number: string }).shipment_number;
      return json({
        success: true,
        alreadyProcessed: true,
        shipmentNo: existing,
        message: 'Shipment already processed with this idempotency key',
      });
    }
  }

  // 2. Duplicate Item ID guard — reject if any item is already Active
  // or On Hold in inventory (matches GAS:17097-17122).
  const itemIds = items.map(i => String(i.itemId).trim());
  const { data: dupRows, error: dupErr } = await sb
    .from('inventory')
    .select('item_id, status')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds)
    .in('status', ['Active', 'On Hold']);
  if (dupErr) return json({ error: `Dup check failed: ${dupErr.message}`, code: 'READ_FAILED' }, 500);
  if (dupRows && dupRows.length > 0) {
    const dupIds = (dupRows as Array<{ item_id: string }>).map(r => r.item_id);
    return json({
      error: `BLOCKED: ${dupIds.length} item(s) already exist in Active inventory: ${dupIds.slice(0, 10).join(', ')}`,
      code: 'DUPLICATE_ITEMS',
    }, 409);
  }

  // 3. Generate Shipment # via atomic Postgres SEQUENCE
  // `public.next_shipment_no()` returns 'SHP-NNNNNN'.
  const { data: shipNoRow, error: shipNoErr } = await sb.rpc('next_shipment_no');
  if (shipNoErr) return json({ error: `Shipment# generation failed: ${shipNoErr.message}`, code: 'RPC_ERROR' }, 500);
  const shipmentNo = String(shipNoRow ?? '').trim();
  if (!shipmentNo) return json({ error: 'next_shipment_no returned empty', code: 'RPC_ERROR' }, 500);

  // 4. Resolve client settings (auto_inspection, discount, name, billing-enabled)
  const { data: clientRow } = await sb
    .from('clients')
    .select('name, auto_inspection, discount_services_pct, enable_receiving_billing')
    .eq('spreadsheet_id', tenantId)
    .maybeSingle();
  type ClientRow = {
    name?: string | null;
    auto_inspection?: boolean | null;
    discount_services_pct?: number | null;
    enable_receiving_billing?: boolean | null;
  };
  const cr: ClientRow | null = (clientRow as ClientRow | null) ?? null;
  const clientName        = String(cr?.name ?? '').trim() || 'Client';
  const autoInspection    = !!cr?.auto_inspection;
  const discountPct       = Number(cr?.discount_services_pct ?? 0);
  const billingEnabled    = cr?.enable_receiving_billing !== false; // default ON

  // 5. INSERT public.shipments
  const ikNotes = idempotencyKey ? `[IK:${idempotencyKey}] ${userNotes}` : userNotes;
  const nowIso  = new Date().toISOString();
  const shipmentInsert = {
    tenant_id:       tenantId,
    shipment_number: shipmentNo,
    receive_date:    receiveDateIso,
    item_count:      items.length,
    carrier,
    tracking_number: trackingNumber,
    notes:           ikNotes,
    updated_at:      nowIso,
  };
  const { error: shipInsErr } = await sb.from('shipments').insert(shipmentInsert);
  if (shipInsErr) return json({ error: `Shipment insert failed: ${shipInsErr.message}`, code: 'INSERT_FAILED' }, 500);

  // 6. INSERT inventory rows
  const inventoryRows = items.map(it => ({
    tenant_id:       tenantId,
    item_id:         String(it.itemId).trim(),
    qty:             Number(it.qty ?? 1) || 1,
    vendor:          String(it.vendor ?? '').trim(),
    description:     String(it.description ?? '').trim(),
    item_class:      String(it.class ?? '').trim(),
    location:        String(it.location ?? '').trim(),
    sidemark:        String(it.sidemark ?? '').trim(),
    reference:       String(it.reference ?? '').trim(),
    room:            String(it.room ?? '').trim(),
    item_notes:      String(it.itemNotes ?? '').trim(),
    carrier,
    tracking_number: trackingNumber,
    shipment_number: shipmentNo,
    receive_date:    receiveDateIso,
    status:          'Active',
    needs_inspection: !!it.needsInspection,
    needs_assembly:   !!it.needsAssembly,
    updated_at:      nowIso,
  }));
  const { error: invInsErr } = await sb.from('inventory').insert(inventoryRows);
  if (invInsErr) {
    warnings.push(`Inventory insert failed: ${invInsErr.message} (shipment row persisted; review manually)`);
  }

  // 7. Auto-INSP + auto-ASM tasks
  // doInspection follows the GAS rule:
  //   - clientTrustsFlags (autoInspectionLoaded=true): respect per-item flag
  //     (user may have unchecked individual items in the dialog)
  //   - else: server fallback = per-item OR client setting (covers the
  //     React-race where apiClients hadn't loaded when the dialog opened)
  const taskRows: Array<Record<string, unknown>> = [];
  const counterCache: Record<string, number> = {};
  for (const it of items) {
    const itemId = String(it.itemId).trim();
    const doInsp = clientTrustsFlags ? !!it.needsInspection : (!!it.needsInspection || autoInspection);
    if (doInsp) {
      const tid = await nextTaskId(sb, tenantId, itemId, 'INSP', counterCache);
      taskRows.push(buildTaskRow(tenantId, tid, 'INSP', itemId, it, shipmentNo, nowIso));
    }
    if (it.needsAssembly) {
      const tid = await nextTaskId(sb, tenantId, itemId, 'ASM', counterCache);
      taskRows.push(buildTaskRow(tenantId, tid, 'ASM', itemId, it, shipmentNo, nowIso));
    }
  }
  let tasksCreated = 0;
  if (taskRows.length > 0) {
    // Resolve service names for INSP / ASM via service_catalog
    const svcNames = await resolveSvcNames(sb, ['INSP', 'ASM']);
    for (const row of taskRows) {
      const code = String(row.svc_code ?? '');
      if (svcNames[code]) row.type = svcNames[code];
    }
    const { error: tInsErr } = await sb.from('tasks').insert(taskRows);
    if (tInsErr) {
      warnings.push(`Task creation failed: ${tInsErr.message}`);
    } else {
      tasksCreated = taskRows.length;
    }
  }

  // 8. Billing rows (RCVG + addons)
  let billingRowsCreated = 0;
  if (billingEnabled && !skipReceivingBilling) {
    const svcCodesNeeded = new Set<string>(['RCVG']);
    for (const it of items) {
      for (const code of (it.addons ?? [])) {
        const c = String(code ?? '').trim();
        if (c && c !== 'RCVG') svcCodesNeeded.add(c);
      }
    }
    const svcByCode = await fetchServiceCatalog(sb, Array.from(svcCodesNeeded));

    const billingRows: Array<Record<string, unknown>> = [];
    for (const it of items) {
      const itemId = String(it.itemId).trim();
      const cls    = String(it.class).trim().toUpperCase();

      // RCVG row
      const rcvg = computeRow(svcByCode.get('RCVG'), cls, discountPct);
      if (rcvg.rate <= 0) {
        warnings.push(`Missing RCVG rate for class ${cls} on item ${itemId} — billing row created with Missing Rate flag`);
      }
      billingRows.push({
        tenant_id:       tenantId,
        ledger_row_id:   `RCVG-${itemId}-${shipmentNo}`,
        status:          'Unbilled',
        invoice_no:      '',
        client_name:     clientName,
        date:            receiveDateIso,
        svc_code:        'RCVG',
        svc_name:        rcvg.name || 'Receiving',
        category:        rcvg.category || '',
        item_id:         itemId,
        description:     String(it.description ?? '').trim(),
        item_class:      cls,
        qty:             1,
        rate:            rcvg.rate > 0 ? rcvg.rate : 0,
        total:           rcvg.rate > 0 ? rcvg.rate : 0,
        shipment_number: shipmentNo,
        item_notes:      'Receiving',
        sidemark:        String(it.sidemark ?? '').trim(),
        reference:       String(it.reference ?? '').trim(),
        updated_at:      nowIso,
      });

      // Addons
      for (const codeRaw of (it.addons ?? [])) {
        const code = String(codeRaw).trim();
        if (!code || code === 'RCVG') continue;
        const addon = computeRow(svcByCode.get(code), cls, discountPct);
        if (addon.rate <= 0) {
          warnings.push(`Missing ${code} rate for class ${cls} on item ${itemId} — billing row created with Missing Rate flag`);
        }
        billingRows.push({
          tenant_id:       tenantId,
          ledger_row_id:   `${code}-${itemId}-${shipmentNo}`,
          status:          'Unbilled',
          invoice_no:      '',
          client_name:     clientName,
          date:            receiveDateIso,
          svc_code:        code,
          svc_name:        addon.name || code,
          category:        addon.category || '',
          item_id:         itemId,
          description:     String(it.description ?? '').trim(),
          item_class:      cls,
          qty:             1,
          rate:            addon.rate > 0 ? addon.rate : 0,
          total:           addon.rate > 0 ? addon.rate : 0,
          shipment_number: shipmentNo,
          item_notes:      'Receiving add-on',
          sidemark:        String(it.sidemark ?? '').trim(),
          reference:       String(it.reference ?? '').trim(),
          updated_at:      nowIso,
        });
      }
    }
    if (billingRows.length > 0) {
      const { error: bInsErr } = await sb.from('billing').insert(billingRows);
      if (bInsErr) {
        warnings.push(`Billing row creation failed: ${bInsErr.message}`);
      } else {
        billingRowsCreated = billingRows.length;
      }
    }
  }

  // 9. Reverse-writethrough — best-effort, per-row, won't roll back the SB commit
  void mirrorShipment(shipmentInsert, tenantId, requestId, callerEmail, sb);
  for (const row of inventoryRows) {
    void mirrorInventoryInsert(row, tenantId, requestId, callerEmail, sb);
  }
  for (const row of taskRows) {
    void mirrorTaskInsert(row, tenantId, requestId, callerEmail, sb);
  }

  // 10. Audit log
  await sb.from('entity_audit_log').insert({
    entity_type:   'shipment',
    entity_id:     shipmentNo,
    tenant_id:     tenantId,
    action:        'create',
    changes:       { itemCount: items.length, carrier, idempotencyKey: idempotencyKey || null },
    performed_by:  callerEmail || 'complete-shipment-sb',
    source:        'supabase',
  }).then(() => {}, () => {});

  warnings.push('Sheet mirror best-effort — shipments writer is stub; Drive folders + shipment-received email NOT fired by SB-primary path (canary-acceptable per MIG-016)');

  return json({
    success:       true,
    shipmentNo,
    itemsCreated:  inventoryRows.length,
    tasksCreated,
    billingRows:   billingRowsCreated,
    warnings:      warnings.length > 0 ? warnings : undefined,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

function buildTaskRow(tenantId: string, taskId: string, svcCode: 'INSP' | 'ASM', itemId: string, it: ShipmentItem, shipmentNo: string, nowIso: string): Record<string, unknown> {
  return {
    tenant_id:       tenantId,
    task_id:         taskId,
    item_id:         itemId,
    type:            svcCode,    // overwritten by caller with the service_catalog name
    status:          'Open',
    vendor:          String(it.vendor ?? '').trim(),
    description:     String(it.description ?? '').trim(),
    location:        String(it.location ?? '').trim(),
    sidemark:        String(it.sidemark ?? '').trim(),
    shipment_number: shipmentNo,
    item_notes:      String(it.itemNotes ?? '').trim(),
    billed:          false,
    created:         nowIso,
    svc_code:        svcCode,
    updated_at:      nowIso,
  };
}

async function nextTaskId(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemId: string,
  svcCode: string,
  cache: Record<string, number>,
): Promise<string> {
  const key = `${itemId}|${svcCode}`;
  if (cache[key] == null) {
    const prefix = `${svcCode}-${itemId}-`;
    const { data } = await sb
      .from('tasks')
      .select('task_id')
      .eq('tenant_id', tenantId)
      .like('task_id', `${prefix}%`);
    let max = 0;
    for (const row of (data ?? []) as Array<{ task_id: string }>) {
      const tail = String(row.task_id ?? '').slice(prefix.length);
      const n = Number(tail);
      if (Number.isFinite(n) && n > max) max = n;
    }
    cache[key] = max;
  }
  cache[key] += 1;
  return `${svcCode}-${itemId}-${cache[key]}`;
}

async function resolveSvcNames(
  sb: ReturnType<typeof createClient>,
  codes: readonly string[],
): Promise<Record<string, string>> {
  if (codes.length === 0) return {};
  const { data, error } = await sb
    .from('service_catalog')
    .select('code, name')
    .in('code', codes as string[]);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data as Array<{ code: string; name: string }>) {
    out[row.code] = row.name || row.code;
  }
  return out;
}

async function fetchServiceCatalog(
  sb: ReturnType<typeof createClient>,
  codes: string[],
): Promise<Map<string, ServiceCatalogRow>> {
  const out = new Map<string, ServiceCatalogRow>();
  if (codes.length === 0) return out;
  const { data, error } = await sb
    .from('service_catalog')
    .select('code, name, category, billing, rates, flat_rate, xxl_rate')
    .in('code', codes);
  if (error || !data) return out;
  for (const row of data as ServiceCatalogRow[]) {
    out.set(row.code, row);
  }
  return out;
}

function computeRow(
  svc: ServiceCatalogRow | undefined,
  klass: string,
  discountPct: number,
): { rate: number; name: string; category: string } {
  if (!svc) return { rate: 0, name: '', category: '' };
  let rate = 0;
  if (svc.billing === 'class_based') {
    if (klass === 'XXL') rate = Number(svc.xxl_rate) || 0;
    else if (klass && svc.rates) {
      const r = (svc.rates as Record<string, unknown>)[klass];
      rate = Number(r) || 0;
    }
  } else {
    rate = Number(svc.flat_rate) || 0;
  }
  // Apply discount if rate > 0
  if (rate > 0 && Number.isFinite(discountPct) && discountPct !== 0 && discountPct >= -100 && discountPct <= 100) {
    rate = Math.round(rate * (1 + discountPct / 100) * 100) / 100;
  }
  return { rate, name: svc.name, category: svc.category ?? '' };
}

async function mirrorShipment(row: Record<string, unknown>, tenantId: string, requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>): Promise<void> {
  await mirror({ table: 'shipments', op: 'insert', rowId: String(row.shipment_number), row, tenantId, requestId, callerEmail, sb });
}
async function mirrorInventoryInsert(row: Record<string, unknown>, tenantId: string, requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>): Promise<void> {
  await mirror({ table: 'inventory', op: 'insert', rowId: String(row.item_id), row, tenantId, requestId, callerEmail, sb });
}
async function mirrorTaskInsert(row: Record<string, unknown>, tenantId: string, requestId: string, callerEmail: string, sb: ReturnType<typeof createClient>): Promise<void> {
  await mirror({ table: 'tasks', op: 'insert', rowId: String(row.task_id), row, tenantId, requestId, callerEmail, sb });
}

async function mirror(args: {
  table: string; op: 'insert' | 'update'; rowId: string;
  row: Record<string, unknown>;
  tenantId: string; requestId: string; callerEmail: string;
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
        requested_by:  args.callerEmail || 'complete-shipment-sb',
        request_id:    reqId,
        payload:       { table: args.table, op: args.op, rowId: args.rowId },
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn('[complete-shipment-sb] mirror threw:', e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
