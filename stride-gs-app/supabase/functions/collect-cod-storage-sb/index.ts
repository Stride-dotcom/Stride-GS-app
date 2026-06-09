/**
 * collect-cod-storage-sb — Standalone COD Storage invoicing.
 *
 * Bills the "end customer pays storage" days for a set of COD-flagged
 * inventory items, INDEPENDENT of any delivery order. This is the
 * generalized form of the delivery-order COD add-on (mark_cod_storage_collected
 * in 20260605170200_cod_storage_p4_p6_delivery.sql): it works for items that
 * stay in the warehouse, will-call, monthly-in-advance, or partial collection.
 *
 * Per item:
 *   billable window = [cod_storage_start_date, cutoffDate]  (inclusive)
 *   minus any days already recorded in storage_billing_items (non-Void),
 *   so re-running / overlapping with the delivery add-on never double-bills.
 *   amount = cubic_feet × rate × billable_days
 *
 * On commit (dryRun=false) it, per billable item:
 *   1. Inserts/refreshes a public.billing row (svc_code='COD_STOR',
 *      status='Unbilled') with a DETERMINISTIC ledger_row_id so a repeat run
 *      for the same dates is a no-op — the row flows through the normal
 *      invoicing path to QBO. (writeThroughReverse mirrors it to the sheet.)
 *   2. Records the period in storage_billing_items (status='COD Collected')
 *      so those days never appear again — not on the designer's storage
 *      report, not in a future COD collection.
 *   3. Advances inventory.cod_storage_start_date to cutoff + 1 day so the
 *      next collection starts where this one left off.
 *   4. Writes an entity_audit_log row on the item (Activity tab).
 *
 * Service-role: the inventory UPDATE bypasses the missing browser UPDATE
 * policy (see project_cod_storage / feedback_inventory_no_browser_update_policy).
 *
 * Feature-gated UI-side to the Justin Demo tenant (codStorageBilling flag);
 * this EF is the authoritative compute path (React never computes billing).
 *
 * Payload:  { tenantId, itemIds[], cutoffDate, rate?, notes?, callerEmail?,
 *             dryRun?, requestId? }
 * Response: { success, dryRun, periodEnd, rate, items[], summary }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COD_DEFAULT_RATE = 0.05;
const SBI_COLLECTED = 'COD Collected'; // matches mark_cod_storage_collected
const DAY_MS = 86400000;

interface ItemResult {
  itemId: string;
  inventoryId: string | null;
  itemClass: string;
  sidemark: string;
  description: string;
  cubicFeet: number;
  codStartDate: string | null;   // item's current cod_storage_start_date
  periodStart: string | null;    // first uncollected day billed this run
  periodEnd: string;             // = cutoff
  eligibleDays: number;          // full window codStart..cutoff
  alreadyCollectedDays: number;  // days in window already in sbi (non-Void)
  billableDays: number;          // eligible - already
  amount: number;
  ledgerRowId: string | null;
  status: 'billable' | 'fully_collected' | 'already_invoiced' | 'no_cod' | 'no_cubic';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const body = await req.json().catch(() => ({}));
  const tenantId    = String(body.tenantId ?? '').trim();
  const cutoffDate  = String(body.cutoffDate ?? '').trim();
  const callerEmail = String(body.callerEmail ?? '').trim();
  const notes       = String(body.notes ?? '').trim();
  const dryRun      = body.dryRun === true;
  const requestId   = String(body.requestId ?? '').trim() || crypto.randomUUID();
  let rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate < 0) rate = COD_DEFAULT_RATE;

  const itemIds: string[] = Array.isArray(body.itemIds)
    ? body.itemIds.map((s: unknown) => String(s ?? '').trim()).filter(Boolean)
    : [];

  if (!tenantId)             return json({ success: false, error: 'tenantId is required' }, 400);
  if (!isIsoDate(cutoffDate)) return json({ success: false, error: 'cutoffDate (YYYY-MM-DD) is required' }, 400);
  if (itemIds.length === 0)  return json({ success: false, error: 'itemIds is required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const sb = createClient(supabaseUrl, serviceKey);

  // ── Load the inputs ────────────────────────────────────────────────
  const { data: clientRow } = await sb
    .from('clients').select('name').eq('spreadsheet_id', tenantId).maybeSingle();
  const clientName = clientRow ? String((clientRow as { name?: string }).name ?? '') : '';

  const { data: invRows, error: invErr } = await sb
    .from('inventory')
    .select('id, item_id, item_class, sidemark, description, cubic_feet, cod_storage, cod_storage_start_date, status')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);
  if (invErr) return json({ success: false, error: `inventory read failed: ${invErr.message}` }, 500);

  // Class → storage_size fallback for cubic feet (matches the storage calc).
  const { data: classRows } = await sb.from('item_classes').select('id, storage_size');
  const classSize: Record<string, number> = {};
  for (const c of (classRows ?? []) as { id: string; storage_size: number | null }[]) {
    classSize[String(c.id).toUpperCase()] = Number(c.storage_size) || 0;
  }

  // Existing durable records — anything non-Void (Unbilled/Invoiced/Billed/COD
  // Collected) blocks those days from being re-billed.
  const { data: sbiRows } = await sb
    .from('storage_billing_items')
    .select('item_id, period_start, period_end, status')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds)
    .neq('status', 'Void');
  const collectedByItem: Record<string, { start: string; end: string }[]> = {};
  for (const r of (sbiRows ?? []) as { item_id: string; period_start: string; period_end: string }[]) {
    (collectedByItem[r.item_id] ??= []).push({ start: r.period_start, end: r.period_end });
  }

  // ── Compute per item ───────────────────────────────────────────────
  const results: ItemResult[] = [];
  for (const id of itemIds) {
    const inv = (invRows ?? []).find((r) => String((r as { item_id: string }).item_id) === id) as
      | {
          id: string; item_id: string; item_class: string | null; sidemark: string | null;
          description: string | null; cubic_feet: number | null; cod_storage: boolean | null;
          cod_storage_start_date: string | null;
        }
      | undefined;

    const base = (extra: Partial<ItemResult>): ItemResult => ({
      itemId: id,
      inventoryId: inv?.id ?? null,
      itemClass: String(inv?.item_class ?? '').toUpperCase(),
      sidemark: String(inv?.sidemark ?? ''),
      description: String(inv?.description ?? ''),
      cubicFeet: 0,
      codStartDate: inv?.cod_storage_start_date ?? null,
      periodStart: null,
      periodEnd: cutoffDate,
      eligibleDays: 0,
      alreadyCollectedDays: 0,
      billableDays: 0,
      amount: 0,
      ledgerRowId: null,
      status: 'no_cod',
      ...extra,
    });

    if (!inv || inv.cod_storage !== true || !isIsoDate(inv.cod_storage_start_date)) {
      results.push(base({ status: 'no_cod' }));
      continue;
    }

    const cubicFeet = (Number(inv.cubic_feet) > 0)
      ? Number(inv.cubic_feet)
      : (classSize[String(inv.item_class ?? '').toUpperCase()] ?? 0);

    const codStart = inv.cod_storage_start_date as string;
    const eligibleDays = daysInclusive(codStart, cutoffDate);

    // Day-set subtraction of already-collected ranges within the window.
    const { uncollectedDays, firstUncollected } = subtractCollected(
      codStart, cutoffDate, collectedByItem[id] ?? [],
    );
    const alreadyCollected = Math.max(0, eligibleDays - uncollectedDays);

    if (cubicFeet <= 0) {
      results.push(base({
        cubicFeet, eligibleDays, alreadyCollectedDays: alreadyCollected,
        billableDays: uncollectedDays, status: 'no_cubic',
        periodStart: firstUncollected,
      }));
      continue;
    }
    if (uncollectedDays <= 0 || !firstUncollected) {
      results.push(base({
        cubicFeet, eligibleDays, alreadyCollectedDays: alreadyCollected,
        billableDays: 0, status: 'fully_collected',
        periodStart: null,
      }));
      continue;
    }

    const amount = round2(cubicFeet * rate * uncollectedDays);
    const ledgerRowId = `COD-STOR-${id}-${compact(firstUncollected)}-${compact(cutoffDate)}`;

    results.push(base({
      cubicFeet,
      eligibleDays,
      alreadyCollectedDays: alreadyCollected,
      billableDays: uncollectedDays,
      periodStart: firstUncollected,
      amount,
      ledgerRowId,
      status: 'billable',
    }));
  }

  const billable = results.filter((r) => r.status === 'billable');
  const total = round2(billable.reduce((s, r) => s + r.amount, 0));
  const totalAlready = results.reduce((s, r) => s + r.alreadyCollectedDays, 0);

  const summaryBase = {
    itemsBillable: billable.length,
    itemsTotal: itemIds.length,
    total,
    daysAlreadyCollected: totalAlready,
  };

  if (dryRun) {
    return json({ success: true, dryRun: true, periodEnd: cutoffDate, rate, items: results, summary: summaryBase });
  }

  // ── Commit ─────────────────────────────────────────────────────────
  const nowIso  = new Date().toISOString();
  const dateStr = nowIso.slice(0, 10);
  const nextStart = addDaysIso(cutoffDate, 1);
  const performedBy = callerEmail || 'collect-cod-storage-sb';

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: { itemId: string; error: string }[] = [];

  for (const r of billable) {
    const ledgerRowId = r.ledgerRowId as string;
    const periodStart = r.periodStart as string;
    try {
      // Idempotency fence: an existing finalized (Invoiced/Billed) row for this
      // exact ledger_row_id means these days are already on an invoice — skip.
      const { data: existing } = await sb
        .from('billing')
        .select('ledger_row_id, status')
        .eq('tenant_id', tenantId)
        .eq('ledger_row_id', ledgerRowId)
        .maybeSingle();
      const existingStatus = existing ? String((existing as { status: string }).status) : null;

      if (existingStatus === 'Invoiced' || existingStatus === 'Billed') {
        skipped.push(r.itemId);
        // Still ensure the sbi record + start-date advance are in place.
        await upsertSbi(sb, tenantId, r, ledgerRowId, rate);
        await advanceStartDate(sb, tenantId, r.itemId, nextStart);
        continue;
      }

      const row = {
        tenant_id:       tenantId,
        ledger_row_id:   ledgerRowId,
        status:          'Unbilled',
        invoice_no:      '',
        client_name:     clientName,
        date:            dateStr,
        svc_code:        'COD_STOR',
        svc_name:        'COD Storage',
        category:        'Storage',
        item_id:         r.itemId,
        description:     `COD Storage ${periodStart} → ${cutoffDate} (${r.billableDays}d @ $${rate}/cu ft/day)`,
        item_class:      r.itemClass,
        qty:             r.billableDays,
        rate:            round2(r.cubicFeet * rate),
        total:           r.amount,
        task_id:         '',
        repair_id:       '',
        shipment_number: '',
        item_notes:      notes,
        sidemark:        r.sidemark,
        reference:       '',
        created_at:      nowIso,
        updated_at:      nowIso,
      };

      // Replace an existing Unbilled/Void row in place (keeps it idempotent
      // and re-bills a previously voided period cleanly).
      if (existing) {
        const { error: upErr } = await sb.from('billing')
          .update({ ...row, created_at: undefined }).eq('tenant_id', tenantId).eq('ledger_row_id', ledgerRowId);
        if (upErr) { errors.push({ itemId: r.itemId, error: upErr.message }); continue; }
      } else {
        const { error: insErr } = await sb.from('billing').insert(row);
        if (insErr) { errors.push({ itemId: r.itemId, error: insErr.message }); continue; }
      }

      await upsertSbi(sb, tenantId, r, ledgerRowId, rate);
      await advanceStartDate(sb, tenantId, r.itemId, nextStart);

      await sb.from('entity_audit_log').insert({
        entity_type:  'inventory',
        entity_id:    r.itemId,
        tenant_id:    tenantId,
        action:       'cod_storage_collected',
        changes:      {
          summary: `COD storage collected: $${r.amount.toFixed(2)} · ${periodStart} → ${cutoffDate} ` +
                   `(${r.billableDays}d @ $${rate}/cu ft/day)` + (notes ? ` · ${notes}` : ''),
          ledgerRowId, amount: String(r.amount), rate: String(rate), days: String(r.billableDays),
        },
        performed_by: performedBy,
        source:       'supabase',
      }).then(() => {}, () => {});

      void mirror(sb, tenantId, ledgerRowId, row, existing ? 'update' : 'insert', requestId, performedBy);
      created.push(r.itemId);
    } catch (e) {
      errors.push({ itemId: r.itemId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    success: errors.length === 0,
    dryRun: false,
    periodEnd: cutoffDate,
    rate,
    items: results,
    summary: { ...summaryBase, created: created.length, skipped: skipped.length, errors },
  });
});

// ── Commit helpers ───────────────────────────────────────────────────

async function upsertSbi(
  sb: ReturnType<typeof createClient>, tenantId: string, r: ItemResult, ledgerRowId: string, rate: number,
): Promise<void> {
  // ON CONFLICT (tenant_id, item_id, period_start, period_end) WHERE status<>'Void'
  await sb.from('storage_billing_items').upsert({
    tenant_id:             tenantId,
    sidemark:              r.sidemark,
    item_id:               r.itemId,
    description:           r.description,
    period_start:          r.periodStart,
    period_end:            r.periodEnd,
    billable_days:         r.billableDays,
    rate,
    amount:                r.amount,
    summary_ledger_row_id: ledgerRowId,
    status:                SBI_COLLECTED,
  }, { onConflict: 'tenant_id,item_id,period_start,period_end', ignoreDuplicates: false })
    .then(() => {}, (e: unknown) => { console.warn('[collect-cod-storage-sb] sbi upsert:', e); });
}

async function advanceStartDate(
  sb: ReturnType<typeof createClient>, tenantId: string, itemId: string, nextStart: string,
): Promise<void> {
  await sb.from('inventory')
    .update({ cod_storage_start_date: nextStart })
    .eq('tenant_id', tenantId).eq('item_id', itemId)
    .then(() => {}, (e: unknown) => { console.warn('[collect-cod-storage-sb] start-date advance:', e); });
}

async function mirror(
  sb: ReturnType<typeof createClient>, tenantId: string, ledgerRowId: string,
  row: Record<string, unknown>, op: 'insert' | 'update', requestId: string, callerEmail: string,
): Promise<void> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl || !gasToken) return;
  try {
    const payload = { tenantId, table: 'billing', op, rowId: ledgerRowId, row, requestId };
    const res = await fetch(`${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await sb.from('gs_sync_events').insert({
        tenant_id: tenantId, entity_type: 'billing', entity_id: ledgerRowId,
        action_type: 'writethrough_reverse', sync_status: 'sync_failed',
        requested_by: callerEmail, request_id: requestId, payload, error_message: `HTTP ${res.status}`,
      }).then(() => {}, () => {});
    }
  } catch (e) { console.warn('[collect-cod-storage-sb] mirror threw:', e); }
}

// ── Date / math helpers ──────────────────────────────────────────────

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z'));
}
function utc(iso: string): number { return Date.parse(iso + 'T00:00:00Z'); }
function compact(iso: string): string { return iso.replace(/-/g, ''); }
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function addDaysIso(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}
function daysInclusive(startIso?: string | null, endIso?: string | null): number {
  if (!isIsoDate(startIso) || !isIsoDate(endIso)) return 0;
  const diff = Math.round((utc(endIso) - utc(startIso)) / DAY_MS) + 1;
  return diff > 0 ? diff : 0;
}

/**
 * Walk each day in [start, end], skipping any day covered by an
 * already-collected range. Returns the count of uncollected days and the
 * first uncollected day (the period_start to bill from). O(window×ranges)
 * but windows are at most a few months so this is cheap.
 */
function subtractCollected(
  startIso: string, endIso: string, ranges: { start: string; end: string }[],
): { uncollectedDays: number; firstUncollected: string | null } {
  if (!isIsoDate(startIso) || !isIsoDate(endIso)) return { uncollectedDays: 0, firstUncollected: null };
  const s = utc(startIso), e = utc(endIso);
  if (e < s) return { uncollectedDays: 0, firstUncollected: null };
  const spans = ranges
    .filter((r) => isIsoDate(r.start) && isIsoDate(r.end))
    .map((r) => ({ s: utc(r.start), e: utc(r.end) }));
  let count = 0;
  let first: string | null = null;
  for (let d = s; d <= e; d += DAY_MS) {
    const covered = spans.some((sp) => d >= sp.s && d <= sp.e);
    if (!covered) {
      count++;
      if (!first) first = new Date(d).toISOString().slice(0, 10);
    }
  }
  return { uncollectedDays: count, firstUncollected: first };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
