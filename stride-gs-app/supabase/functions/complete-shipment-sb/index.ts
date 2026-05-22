/**
 * complete-shipment-sb — SB-primary handler for `completeShipment`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decisions
 *   MIG-002  synchronous SB→Sheets reverse writethrough
 *   MIG-006  entity_audit_log is the answer key
 *   MIG-014  receive-shipment-shadow audit shape already understood
 *   MIG-016  P2/P3 routing layer
 *
 * Replaces the GAS handler `handleCompleteShipment_` (StrideAPI.gs ~line 16966).
 *
 * Core flow:
 *   1. Validate payload (items[] non-empty, per-item itemId/description/class).
 *   2. Generate or accept Shipment # — uses Postgres RPC `next_shipment_no()`
 *      from migration 20260511190000 (atomic SEQUENCE; race-free).
 *   3. Idempotency check via `[IK:<key>]` tag in public.shipments.notes —
 *      mirrors GAS's `[IK:...]` lookup pattern (StrideAPI.gs:17066-17091).
 *      If a previous call already wrote this IK, return that shipment_number
 *      with `alreadyProcessed: true`.
 *   4. Duplicate-Item-ID check against Active / On Hold inventory rows.
 *      Mirrors GAS's pre-write dup-check (StrideAPI.gs:17094-17122).
 *   5. INSERT public.shipments row (one).
 *   6. INSERT public.inventory rows (one per item, status='Active',
 *      shipment_number=shipmentNo).
 *   7. Auto-create INSP and ASM tasks per item — same rules as GAS:
 *        • INSP when item.needsInspection OR (autoInspectionLoaded=false
 *          AND tenant's clients.auto_inspection=true).
 *        • ASM  when item.needsAssembly.
 *      Task ID = SVC-<itemId>-1 (counter resolved via SELECT-then-pick max,
 *      mirrors maxExistingCounter in batch-create-tasks-sb).
 *   8. INSERT receiving billing rows (svc_code='RCVG' + optional add-on
 *      codes from item.addons) when:
 *        • billingEnabled (clients.enable_receiving_billing) AND
 *        • !skipReceivingBilling
 *      Rate looked up via service_catalog.rates[class] for the item class.
 *      If no rate found, total='Missing Rate' is stored in `item_notes` as
 *      a flag (NOT NaN in `total` — billing.total is numeric) and a warning
 *      is added to the response.
 *   9. Reverse-writethrough to per-tenant Inventory sheet (loop, best-effort).
 *      Shipments + billing rows propagate via the existing per-table writers
 *      (shipments/billing). Tasks reverse-writethrough fires via tasks
 *      writer (StrideAPI v38.227+).
 *  10. Audit log: one row per inserted item, action='create',
 *      changes={summary: 'received', qty, vendor, shipmentNo}.
 *
 * Skipped vs GAS (deliberate gaps, documented per MIG-016):
 *   • Drive folder creation — Edge Functions have no Drive API without
 *     OAuth setup. The legacy Drive folder + hyperlink pass is GAS-only.
 *     Per MIG-016, per-shipment folders were already retired in
 *     StrideAPI v38.141.0; per-item folders are deprecated; only the
 *     Tasks/<taskId> folders matter, and those are created lazily by
 *     "Start Task" anyway.
 *   • SHIPMENT_RECEIVED email — fires via the separate send-shipment-email-sb
 *     handler (Phase P3 email cluster). Operator can invoke it post-receive
 *     or rely on the GAS-side fallback while active_backend='gas'.
 *   • Receiving PDF generation — DOC_RECEIVING template is GAS-rendered
 *     via api_generateDocPdf_; future port through a dedicated render-doc EF.
 *   • Lock acquisition — Postgres atomicity (sequence + unique constraints)
 *     replaces GAS's LockService.getScriptLock(15000). Idempotency tag
 *     blocks concurrent duplicate writes from the same caller; concurrent
 *     truly-distinct writes can't collide because shipment numbers are
 *     unique by construction.
 *   • Hyperlink pass on Inventory.Shipment # / Task ID cells — Drive-API
 *     dependent; lives in GAS. SB readers don't depend on the rich-text
 *     URL (React detail panels use Supabase deep links per v38.141).
 *   • Discount application (api_applyDiscount_) — service_catalog query
 *     here uses the flat rates[class] as-is. Per-client storage/services
 *     discount percentages (clients.discount_storage_pct/discount_services_pct)
 *     are NOT applied here. Canary-acceptable gap; full-sync cron and
 *     subsequent invoice generation re-apply discounts.
 *
 * Response shape mirrors GAS:
 *   { success: true, shipmentNo, itemCount, tasksCreated, billingRows,
 *     emailSent: false, warnings? }
 *   { success: true, alreadyProcessed: true, shipmentNo, message } on IK reuse
 *   { error: "...", code?: "..." } on validation/server failure
 *
 * Authorization: verify_jwt=true (default). Service role used for writes.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CompleteShipmentItem {
  itemId?: string;
  description?: string;
  class?: string;
  qty?: number;
  vendor?: string;
  location?: string;
  sidemark?: string;
  reference?: string;
  room?: string;
  itemNotes?: string;
  needsInspection?: boolean;
  needsAssembly?: boolean;
  addons?: string[];
  declaredValue?: number;
  coverageOptionId?: string | null;
}

interface CompleteShipmentBody {
  tenantId?: string;
  callerEmail?: string;
  requestId?: string;
  items?: CompleteShipmentItem[];
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  idempotencyKey?: string;
  receiveDate?: string;          // YYYY-MM-DD
  shipmentNo?: string;           // optional client-supplied override
  skipReceivingBilling?: boolean;
  autoInspectionLoaded?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required', code: 'METHOD_NOT_ALLOWED' }, 405);

  let body: CompleteShipmentBody;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, code: 'INVALID_JSON' }, 400);
  }

  const tenantId        = String(body.tenantId        ?? '').trim();
  const callerEmail     = String(body.callerEmail     ?? '').trim();
  const requestId       = String(body.requestId       ?? '').trim() || crypto.randomUUID();
  const items           = Array.isArray(body.items) ? body.items : [];
  const carrier         = String(body.carrier         ?? '').trim();
  const trackingNumber  = String(body.trackingNumber  ?? '').trim();
  const notes           = String(body.notes           ?? '').trim();
  const idempotencyKey  = String(body.idempotencyKey  ?? '').trim();
  const receiveDateRaw  = String(body.receiveDate     ?? '').trim();
  const suppliedShipNo  = String(body.shipmentNo      ?? '').trim();
  const skipBilling     = body.skipReceivingBilling === true;
  const clientTrustsFlags = body.autoInspectionLoaded === true;

  if (!tenantId) return json({ error: 'tenantId is required', code: 'INVALID_PARAMS' }, 400);
  if (items.length === 0) return json({ error: 'No items provided', code: 'INVALID_PARAMS' }, 400);

  // Per-item validation (mirrors GAS missing[] aggregation).
  const missing: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!String(it.itemId ?? '').trim())      missing.push(`Item ${i + 1}: missing itemId`);
    if (!String(it.description ?? '').trim()) missing.push(`Item ${i + 1}: missing description`);
    if (!String(it.class ?? '').trim())       missing.push(`Item ${i + 1}: missing class`);
  }
  if (missing.length) {
    return json({ error: `Validation failed: ${missing.slice(0, 10).join('; ')}`, code: 'VALIDATION_ERROR' }, 400);
  }

  // Receive date — default to today (YYYY-MM-DD).
  const receiveDate = receiveDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(receiveDateRaw)
    ? receiveDateRaw
    : new Date().toISOString().slice(0, 10);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[complete-shipment-sb] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Server misconfigured', code: 'CONFIG_ERROR' }, 500);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const warnings: string[] = [];

  // ── 1. Idempotency check via [IK:<key>] tag in shipments.notes ──────────
  if (idempotencyKey) {
    const ikTag = `[IK:${idempotencyKey}]`;
    const { data: ikRows, error: ikErr } = await sb
      .from('shipments')
      .select('shipment_number, notes')
      .eq('tenant_id', tenantId)
      .like('notes', `%${ikTag}%`)
      .limit(1);
    if (ikErr) {
      console.warn('[complete-shipment-sb] IK lookup failed:', ikErr.message);
    } else if (ikRows && ikRows.length > 0) {
      const existing = (ikRows[0] as { shipment_number: string }).shipment_number;
      return json({
        success:          true,
        alreadyProcessed: true,
        shipmentNo:       existing,
        message:          'Shipment already processed with this idempotency key',
      });
    }
  }

  // ── 2. Generate shipment number (or accept caller-supplied) ─────────────
  let shipmentNo = suppliedShipNo;
  if (!shipmentNo) {
    const { data: rpcData, error: rpcErr } = await sb.rpc('next_shipment_no');
    if (rpcErr || !rpcData) {
      console.error('[complete-shipment-sb] next_shipment_no RPC failed:', rpcErr?.message);
      return json({ error: `Shipment # generation failed: ${rpcErr?.message ?? 'no value returned'}`, code: 'RPC_ERROR' }, 500);
    }
    shipmentNo = String(rpcData);
  }

  // ── 3. Load tenant config (clients row) for billing + inspection flags ──
  const { data: clientRow } = await sb
    .from('clients')
    .select('name, enable_receiving_billing, auto_inspection')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const clientName        = (clientRow as { name?: string } | null)?.name?.trim()                 ?? 'Client';
  const billingEnabled    = (clientRow as { enable_receiving_billing?: boolean } | null)?.enable_receiving_billing === true;
  const autoInspectionTen = (clientRow as { auto_inspection?: boolean } | null)?.auto_inspection === true;

  // ── 4. Duplicate Item ID check (Active / On Hold only) ──────────────────
  const itemIds = items.map(i => String(i.itemId ?? '').trim()).filter(Boolean);
  if (itemIds.length > 0) {
    const { data: dupRows, error: dupErr } = await sb
      .from('inventory')
      .select('item_id, status')
      .eq('tenant_id', tenantId)
      .in('item_id', itemIds)
      .in('status', ['Active', 'On Hold']);
    if (dupErr) {
      console.error('[complete-shipment-sb] dup-check read failed:', dupErr.message);
      return json({ error: `Read failed: ${dupErr.message}`, code: 'READ_FAILED' }, 500);
    }
    const dupes = (dupRows ?? []).map(r => String((r as { item_id: string }).item_id));
    if (dupes.length > 0) {
      return json({
        error: `BLOCKED: ${dupes.length} item(s) already exist in Active inventory: ${dupes.slice(0, 10).join(', ')}`,
        code:  'DUPLICATE_ITEMS',
      }, 409);
    }
  }

  const nowIso = new Date().toISOString();

  // ── 5. INSERT public.shipments row ─────────────────────────────────────
  const shipNotes = idempotencyKey ? `[IK:${idempotencyKey}] ${notes}` : notes;
  const shipmentRow: Record<string, unknown> = {
    tenant_id:       tenantId,
    shipment_number: shipmentNo,
    receive_date:    receiveDate,
    item_count:      items.length,
    carrier,
    tracking_number: trackingNumber,
    notes:           shipNotes,
    photos_url:      '',
    invoice_url:     '',
    created_at:      nowIso,
    updated_at:      nowIso,
  };
  const { error: shipErr } = await sb.from('shipments').insert(shipmentRow);
  if (shipErr) {
    // If the row already exists (unique violation on the natural key), surface
    // it explicitly — caller probably retrying without an IK.
    console.error('[complete-shipment-sb] shipments insert failed:', shipErr.message);
    return json({ error: `Shipment insert failed: ${shipErr.message}`, code: 'INSERT_FAILED' }, 500);
  }

  // ── 6. INSERT public.inventory rows ─────────────────────────────────────
  const inventoryRows: Array<Record<string, unknown>> = items.map(item => ({
    tenant_id:        tenantId,
    item_id:          String(item.itemId   ?? '').trim(),
    qty:              Number(item.qty)     || 1,
    vendor:           String(item.vendor   ?? '').trim(),
    description:      String(item.description ?? '').trim(),
    item_class:       String(item.class    ?? '').trim(),
    location:         String(item.location ?? '').trim(),
    sidemark:         String(item.sidemark ?? '').trim(),
    reference:        String(item.reference ?? '').trim(),
    room:             String(item.room     ?? '').trim(),
    item_notes:       String(item.itemNotes ?? '').trim(),
    carrier,
    tracking_number:  trackingNumber,
    shipment_number:  shipmentNo,
    receive_date:     receiveDate,
    release_date:     '',
    status:           'Active',
    invoice_url:      '',
    needs_inspection: item.needsInspection === true,
    needs_assembly:   item.needsAssembly === true,
    declared_value:   Number(item.declaredValue ?? 0) || 0,
    coverage_option_id: item.coverageOptionId ?? null,
    created_at:       nowIso,
    updated_at:       nowIso,
  }));
  const { error: invErr } = await sb.from('inventory').insert(inventoryRows);
  if (invErr) {
    console.error('[complete-shipment-sb] inventory insert failed:', invErr.message);
    // Best-effort cleanup of the shipments row we just wrote — partial state
    // gets rolled back so caller can retry cleanly. Ignore secondary errors.
    await sb.from('shipments').delete().eq('tenant_id', tenantId).eq('shipment_number', shipmentNo).then(() => {}, () => {});
    return json({ error: `Inventory insert failed: ${invErr.message}`, code: 'INSERT_FAILED' }, 500);
  }

  // ── 7. Auto-create INSP and ASM tasks per item ──────────────────────────
  // Mirrors handleCompleteShipment_'s per-item task batch (StrideAPI.gs:17175).
  // INSP fires when item.needsInspection is true, OR when the React client
  // didn't load the auto-inspection setting AND the tenant's auto_inspection
  // is true. ASM fires when item.needsAssembly is true.
  let tasksCreated = 0;
  try {
    // Resolve service-name labels for INSP / ASM from service_catalog.
    const { data: catRows } = await sb
      .from('service_catalog')
      .select('code, name')
      .in('code', ['INSP', 'ASM']);
    const svcNameByCode: Record<string, string> = {};
    for (const r of (catRows ?? []) as Array<{ code: string; name: string }>) {
      svcNameByCode[r.code] = r.name || r.code;
    }
    const inspName = svcNameByCode['INSP'] || 'Inspection';
    const asmName  = svcNameByCode['ASM']  || 'Assembly';

    const taskRows: Array<Record<string, unknown>> = [];
    const taskIdsCreated: string[] = [];

    for (const item of items) {
      const itemId = String(item.itemId ?? '').trim();
      if (!itemId) continue;

      const doInspection = clientTrustsFlags
        ? item.needsInspection === true
        : (item.needsInspection === true || autoInspectionTen);
      const doAssembly = item.needsAssembly === true;

      // Counter: SELECT-then-pick-max per (svc, item). Fresh inventory => 1.
      if (doInspection) {
        const counter = await nextTaskCounter(sb, tenantId, itemId, 'INSP');
        const taskId  = `INSP-${itemId}-${counter}`;
        taskRows.push(buildTaskRow(tenantId, taskId, 'INSP', inspName, item, shipmentNo, nowIso));
        taskIdsCreated.push(taskId);
      }
      if (doAssembly) {
        const counter = await nextTaskCounter(sb, tenantId, itemId, 'ASM');
        const taskId  = `ASM-${itemId}-${counter}`;
        taskRows.push(buildTaskRow(tenantId, taskId, 'ASM', asmName, item, shipmentNo, nowIso));
        taskIdsCreated.push(taskId);
      }
    }

    if (taskRows.length > 0) {
      const { error: tErr } = await sb.from('tasks').insert(taskRows);
      if (tErr) {
        warnings.push(`Task creation failed: ${tErr.message}`);
      } else {
        tasksCreated = taskRows.length;
        // Audit log per task (best-effort).
        await Promise.all(taskIdsCreated.map(taskId =>
          sb.from('entity_audit_log').insert({
            entity_type:   'task',
            entity_id:     taskId,
            tenant_id:     tenantId,
            action:        'create',
            changes:       { source: 'completeShipment', shipmentNo },
            performed_by:  callerEmail || 'complete-shipment-sb',
            source:        'supabase',
          }).then(() => {}, () => {}),
        ));
      }
    }
  } catch (e) {
    warnings.push(`Task creation threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 8. INSERT receiving billing rows (RCVG + add-ons) ───────────────────
  // TODO: GAS-parity gap — per-client discount percentages
  // (discount_services_pct) are NOT applied here. The flat
  // service_catalog.rates[class] value is used as-is.
  let billingRows = 0;
  if (billingEnabled && !skipBilling) {
    try {
      // Collect unique service codes to look up: RCVG + every add-on referenced.
      const codeSet = new Set<string>(['RCVG']);
      for (const it of items) {
        if (Array.isArray(it.addons)) {
          for (const c of it.addons) {
            const s = String(c).trim();
            if (s && s !== 'RCVG') codeSet.add(s);
          }
        }
      }
      const codes = Array.from(codeSet);
      const { data: catRows } = await sb
        .from('service_catalog')
        .select('code, name, category, rates, flat_rate, billing')
        .in('code', codes);
      type CatRow = { code: string; name: string; category: string; rates: Record<string, unknown> | null; flat_rate: number | null; billing: string };
      const catByCode: Record<string, CatRow> = {};
      for (const r of (catRows ?? []) as CatRow[]) catByCode[r.code] = r;

      const billBatch: Array<Record<string, unknown>> = [];
      for (const item of items) {
        const itemId    = String(item.itemId ?? '').trim();
        if (!itemId) continue;
        const itemClass = String(item.class ?? '').trim();

        // Base RCVG row.
        const rcvgRate = lookupRate(catByCode['RCVG'], itemClass);
        const rcvgRow  = buildBillingRow({
          tenantId,
          ledgerRowId: `RCVG-${itemId}-${shipmentNo}`,
          svcCode:     'RCVG',
          svcName:     catByCode['RCVG']?.name ?? 'Receiving',
          category:    catByCode['RCVG']?.category ?? 'Warehouse',
          clientName,
          date:        receiveDate,
          item,
          itemClass,
          rate:        rcvgRate.rate,
          rateNotes:   rcvgRate.rate > 0 ? 'Receiving' : 'Receiving — Missing Rate',
          shipmentNo,
          nowIso,
        });
        if (rcvgRate.rate <= 0) {
          warnings.push(`Missing RCVG rate for class ${itemClass} on item ${itemId} — billing row flagged Missing Rate`);
        }
        billBatch.push(rcvgRow);

        // Per-item add-on rows.
        const addons = Array.isArray(item.addons) ? item.addons : [];
        for (const codeRaw of addons) {
          const code = String(codeRaw).trim();
          if (!code || code === 'RCVG') continue;
          const cat   = catByCode[code];
          const rate  = lookupRate(cat, itemClass);
          billBatch.push(buildBillingRow({
            tenantId,
            ledgerRowId: `${code}-${itemId}-${shipmentNo}`,
            svcCode:     code,
            svcName:     cat?.name ?? code,
            category:    cat?.category ?? '',
            clientName,
            date:        receiveDate,
            item,
            itemClass,
            rate:        rate.rate,
            rateNotes:   rate.rate > 0 ? 'Receiving add-on' : `Receiving add-on (${code}) — Missing Rate`,
            shipmentNo,
            nowIso,
          }));
          if (rate.rate <= 0) {
            warnings.push(`Missing ${code} rate for class ${itemClass} on item ${itemId} — billing row flagged Missing Rate`);
          }
        }
      }

      if (billBatch.length > 0) {
        const { error: bErr } = await sb.from('billing').insert(billBatch);
        if (bErr) {
          warnings.push(`Billing insert failed: ${bErr.message}`);
        } else {
          billingRows = billBatch.length;
        }
      }
    } catch (e) {
      warnings.push(`Billing creation threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 9. Reverse-writethrough to per-tenant Inventory sheet ───────────────
  //    Best-effort — failures land in gs_sync_events. Shipments + billing
  //    mirror via their own per-table writers (the shipments writer is the
  //    per-table writeThroughReverse for table='shipments' op='insert',
  //    same shape used in send-shipment-email-sb's audit row). Tasks mirror
  //    via the tasks writer added in v38.227.0.
  await mirrorAllToSheet({
    sb,
    tenantId,
    requestId,
    callerEmail,
    shipmentRow,
    inventoryRows,
    warnings,
  });

  // ── 10. Audit log per inserted item (action='create') ───────────────────
  await Promise.all(items.map(item => {
    const itemId = String(item.itemId ?? '').trim();
    if (!itemId) return Promise.resolve();
    return sb.from('entity_audit_log').insert({
      entity_type:   'inventory',
      entity_id:     itemId,
      tenant_id:     tenantId,
      action:        'create',
      changes:       {
        summary: 'received',
        qty:     Number(item.qty) || 1,
        vendor:  String(item.vendor ?? ''),
        shipmentNo,
      },
      performed_by:  callerEmail || 'complete-shipment-sb',
      source:        'supabase',
    }).then(() => {}, () => {});
  }));
  // One shipment-level audit row too.
  await sb.from('entity_audit_log').insert({
    entity_type:   'shipment',
    entity_id:     shipmentNo,
    tenant_id:     tenantId,
    action:        'create',
    changes:       {
      itemCount:   items.length,
      carrier,
      trackingNumber,
      receiveDate,
      idempotencyKey: idempotencyKey || null,
    },
    performed_by:  callerEmail || 'complete-shipment-sb',
    source:        'supabase',
  }).then(() => {}, () => {});

  return json({
    success:        true,
    shipmentNo,
    itemCount:      items.length,
    tasksCreated,
    billingRows,
    emailSent:      false, // GAS-parity gap: email fires via send-shipment-email-sb
    warnings:       warnings.length > 0 ? warnings : undefined,
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function lookupRate(
  cat: { rates: Record<string, unknown> | null; flat_rate: number | null; billing: string } | undefined,
  itemClass: string,
): { rate: number } {
  if (!cat) return { rate: 0 };
  if (cat.billing === 'flat') {
    const fr = Number(cat.flat_rate ?? 0);
    return { rate: Number.isFinite(fr) && fr > 0 ? fr : 0 };
  }
  // class_based: rates is jsonb keyed by class name (case-sensitive in GAS).
  const rates = cat.rates ?? {};
  const raw = (rates as Record<string, unknown>)[itemClass];
  if (raw == null) return { rate: 0 };
  const n = Number(raw);
  return { rate: Number.isFinite(n) && n > 0 ? n : 0 };
}

interface BuildBillingArgs {
  tenantId:    string;
  ledgerRowId: string;
  svcCode:     string;
  svcName:     string;
  category:    string;
  clientName:  string;
  date:        string;
  item:        CompleteShipmentItem;
  itemClass:   string;
  rate:        number;
  rateNotes:   string;
  shipmentNo:  string;
  nowIso:      string;
}

function buildBillingRow(a: BuildBillingArgs): Record<string, unknown> {
  return {
    tenant_id:       a.tenantId,
    ledger_row_id:   a.ledgerRowId,
    status:          'Unbilled',
    invoice_no:      '',
    client_name:     a.clientName,
    date:            a.date,
    svc_code:        a.svcCode,
    svc_name:        a.svcName,
    category:        a.category,
    item_id:         String(a.item.itemId ?? '').trim(),
    description:     String(a.item.description ?? '').trim(),
    item_class:      a.itemClass,
    qty:             1,
    rate:            a.rate > 0 ? a.rate : 0,
    total:           a.rate > 0 ? a.rate : 0,
    task_id:         '',
    repair_id:       '',
    shipment_number: a.shipmentNo,
    item_notes:      a.rateNotes,
    sidemark:        String(a.item.sidemark ?? '').trim(),
    reference:       String(a.item.reference ?? '').trim(),
    created_at:      a.nowIso,
    updated_at:      a.nowIso,
  };
}

function buildTaskRow(
  tenantId: string,
  taskId: string,
  svcCode: string,
  svcName: string,
  item: CompleteShipmentItem,
  shipmentNo: string,
  nowIso: string,
): Record<string, unknown> {
  return {
    tenant_id:       tenantId,
    task_id:         taskId,
    item_id:         String(item.itemId ?? '').trim(),
    type:            svcName,
    status:          'Open',
    vendor:          String(item.vendor ?? '').trim(),
    description:     String(item.description ?? '').trim(),
    location:        String(item.location ?? '').trim(),
    sidemark:        String(item.sidemark ?? '').trim(),
    shipment_number: shipmentNo,
    created:         nowIso,
    item_notes:      String(item.itemNotes ?? '').trim(),
    billed:          false,
    updated_at:      nowIso,
    // svc_code intentionally not written — public.tasks schema doesn't carry
    // it directly (see batch-create-tasks-sb dedup note). Type is the
    // authoritative GAS-shape field.
  };
}

/**
 * Compute the next per-(item, svc) task counter. Mirrors
 * batch-create-tasks-sb::maxExistingCounter: fetch all task_ids matching
 * the SVC-ITEM- prefix and pick max+1. For fresh receiving this is
 * almost always 1.
 */
async function nextTaskCounter(
  sb: ReturnType<typeof createClient>,
  tenantId: string,
  itemId: string,
  svcCode: string,
): Promise<number> {
  const prefix = `${svcCode}-${itemId}-`;
  const { data, error } = await sb
    .from('tasks')
    .select('task_id')
    .eq('tenant_id', tenantId)
    .like('task_id', `${prefix}%`);
  if (error || !data) return 1;
  let max = 0;
  for (const row of data as Array<{ task_id: string }>) {
    const tid = String(row.task_id ?? '');
    if (!tid.startsWith(prefix)) continue;
    const n = Number(tid.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * Reverse-writethrough fan-out for shipments + inventory.
 *
 * Shipments: one mirror call (table='shipments', op='insert').
 * Inventory: one mirror call per item (table='inventory', op='insert').
 *
 * Failures land in gs_sync_events for FailedOperationsDrawer pickup but
 * do NOT roll back SB state. Per MIG-016, full-sync cron picks up any
 * sheet drift within ~5–30 min.
 */
async function mirrorAllToSheet(args: {
  sb:             ReturnType<typeof createClient>;
  tenantId:       string;
  requestId:      string;
  callerEmail:    string;
  shipmentRow:    Record<string, unknown>;
  inventoryRows:  Array<Record<string, unknown>>;
  warnings:       string[];
}): Promise<void> {
  const { sb, tenantId, requestId, callerEmail, shipmentRow, inventoryRows, warnings } = args;
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) {
    console.warn('[complete-shipment-sb] GAS_API_URL / GAS_API_TOKEN not configured — skipping mirror');
    return;
  }

  // Shipments row mirror.
  await fireMirror({
    sb, tenantId, requestId, callerEmail, warnings, gasUrl, gasToken,
    table: 'shipments', op: 'insert',
    rowId: String(shipmentRow.shipment_number ?? ''),
    row:   shipmentRow,
    label: 'shipments',
  });

  // Inventory row mirrors — one per item.
  for (const row of inventoryRows) {
    await fireMirror({
      sb, tenantId, requestId, callerEmail, warnings, gasUrl, gasToken,
      table: 'inventory', op: 'insert',
      rowId: String(row.item_id ?? ''),
      row,
      label: 'inventory',
    });
  }
}

async function fireMirror(a: {
  sb:           ReturnType<typeof createClient>;
  tenantId:     string;
  requestId:    string;
  callerEmail:  string;
  warnings:     string[];
  gasUrl:       string;
  gasToken:     string;
  table:        string;
  op:           string;
  rowId:        string;
  row:          Record<string, unknown>;
  label:        string;
}): Promise<void> {
  try {
    const payload = {
      tenantId:  a.tenantId,
      table:     a.table,
      op:        a.op,
      rowId:     a.rowId,
      row:       a.row,
      requestId: `${a.requestId}:${a.label}:${a.rowId}`,
    };
    const res = await fetch(`${a.gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(a.gasToken)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      await a.sb.from('gs_sync_events').insert({
        tenant_id:     a.tenantId,
        entity_type:   a.table,
        entity_id:     a.rowId,
        action_type:   'writethrough_reverse',
        sync_status:   'sync_failed',
        requested_by:  a.callerEmail || 'complete-shipment-sb',
        request_id:    payload.requestId,
        payload,
        error_message: `HTTP ${res.status} ${text.slice(0, 200)}`,
      }).then(() => {}, () => {});
    }
  } catch (e) {
    console.warn(`[complete-shipment-sb] mirror ${a.label} ${a.rowId} threw:`, e);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
