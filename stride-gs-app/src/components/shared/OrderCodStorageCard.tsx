/**
 * OrderCodStorageCard — the "COD Storage" collection line on a delivery order.
 *
 * Appears automatically whenever the order carries COD-flagged inventory items
 * (the end customer owes storage), INDEPENDENT of how the order was billed
 * (client-paid deliveries still surface it). The per-item breakdown, dedup, and
 * billing all run through the same authoritative path as the standalone
 * Inventory "Collect COD" action — the collect-cod-storage-sb Edge Function —
 * so the two can never double-collect a day.
 *
 * Flow:
 *   • A dry-run EF preview drives the editable line: cutoff (defaults to the
 *     requested delivery date), rate ($0.05/cu ft/day default), include
 *     checkbox (checked by default), and the per-item breakdown
 *     (item · class · cu ft · from-date · remaining days · amount). Days
 *     already invoiced/collected elsewhere are subtracted automatically.
 *   • "Save" persists the line onto dt_orders (cod_storage_* columns) so the
 *     DispatchTrack description push shows "COD STORAGE: collect $X" for the
 *     driver — WITHOUT billing.
 *   • "Collect COD Storage" runs the EF commit: creates Unbilled COD_STOR
 *     billing rows (→ normal invoicing → QBO), records the periods in
 *     storage_billing_items (never re-billed), advances each item's
 *     cod_storage_start_date past the cutoff, writes the item activity log, and
 *     reverse-writethroughs to the sheet. It then stamps cod_storage_collected_*
 *     on the order so the card flips to the collected view.
 *
 * Feature-gated by the caller's tenant (OrderPage only mounts this when
 * codStorageBilling resolves to 'supabase' for the order's tenant). Renders
 * nothing when the order has no COD-flagged items.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, CalendarDays, CheckCircle2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { supabase } from '../../lib/supabase';
import { entityEvents } from '../../lib/entityEvents';
import {
  previewCodCollection,
  markCodStorageCollected,
  COD_STORAGE_DEFAULT_RATE,
  todayIso,
  type CodCollectionResult,
  type CodCollectionItem,
  type CodStorageDetail,
} from '../../lib/codStorage';
import type { DtOrderForUI } from '../../lib/supabaseQueries';

function fmtCurrency(n: number): string {
  return `$${(n || 0).toFixed(2)}`;
}

// service_catalog "Daily Storage" accessorial — the charge line the COD amount
// drives on a customer-collect order so it rolls into the order total + DT.
const COD_STORAGE_SVC_CODE = 'STOR';

/** Build the persisted snake_case detail snapshot from the EF preview's
 *  billable items (source of truth for the DT push + collected record). */
function detailsFromPreview(items: CodCollectionItem[], rate: number): CodStorageDetail[] {
  return items
    .filter((it) => it.status === 'billable')
    .map((it) => ({
      item_id: it.itemId,
      inventory_id: it.inventoryId,
      sidemark: it.sidemark,
      description: it.description,
      item_class: it.itemClass,
      cubic_feet: it.cubicFeet,
      start_date: it.periodStart ?? it.codStartDate ?? '',
      end_date: it.periodEnd,
      days: it.billableDays,
      rate,
      amount: it.amount,
    }));
}

interface Props {
  order: DtOrderForUI;
  performedBy: string | null;
  canEdit: boolean;
}

export function OrderCodStorageCard({ order, performedBy, canEdit }: Props) {
  const collected = !!order.codStorageCollectedAt;

  // Inventory item codes on this order (ad-hoc free-text items have no
  // dt_item_code → excluded). The EF authoritatively filters to cod_storage=true.
  const itemIds = useMemo(
    () => Array.from(new Set((order.items ?? []).map((i) => i.dtItemCode).filter(Boolean))),
    [order.items],
  );

  // Auto-follow the requested delivery date: the cutoff tracks localServiceDate
  // (so the COD amount stays correct as more storage days accrue while waiting
  // to schedule) until the order is collected. Falls back to a saved cutoff or
  // today when there's no service date yet. (Operator can still hand-edit the
  // cutoff in-session; it re-syncs to the delivery date when that date changes.)
  const persistedCutoff = order.localServiceDate || order.codStorageCutoffDate || todayIso();
  // A persisted COD decision exists once the line has been saved/collected
  // (cutoff or total written). Until then, default the include checkbox to ON.
  const hasPersisted = order.codStorageCutoffDate != null || order.codStorageTotal != null;

  const [enabled, setEnabled] = useState(hasPersisted ? order.codStorageEnabled : true);
  const [cutoff, setCutoff] = useState(persistedCutoff);
  const [rate, setRate] = useState<number>(order.codStorageRate ?? COD_STORAGE_DEFAULT_RATE);

  const [preview, setPreview] = useState<CodCollectionResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [collecting, setCollecting] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [collectNotes, setCollectNotes] = useState('');
  const [collectError, setCollectError] = useState<string | null>(null);

  // Re-sync editable state from the order whenever it refreshes (realtime).
  useEffect(() => {
    setEnabled(hasPersisted ? order.codStorageEnabled : true);
    setCutoff(persistedCutoff);
    setRate(order.codStorageRate ?? COD_STORAGE_DEFAULT_RATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.codStorageEnabled, order.codStorageCutoffDate, order.codStorageRate, order.localServiceDate]);

  // Authoritative dry-run preview (mirrors the standalone Collect COD modal).
  // The EF resolves cubic feet, the COD start date, and subtracts any
  // already-collected days from storage_billing_items.
  const loadPreview = useCallback(async () => {
    if (collected || !order.tenantId || itemIds.length === 0 || !cutoff) {
      setPreview(null);
      return;
    }
    const seq = ++reqSeq.current;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await previewCodCollection(order.tenantId, itemIds, cutoff, rate);
      if (seq === reqSeq.current) setPreview(res);
    } catch (err) {
      if (seq === reqSeq.current) setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === reqSeq.current) setLoadingPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collected, order.tenantId, itemIds.join(','), cutoff, rate]);

  // Debounced re-preview on cutoff/rate change.
  useEffect(() => {
    const t = setTimeout(loadPreview, 250);
    return () => clearTimeout(t);
  }, [loadPreview]);

  // COD-relevant items (have a COD start date) — decides whether to render.
  const codItems = (preview?.items ?? []).filter((r) => r.status !== 'no_cod');
  const billableItems = (preview?.items ?? []).filter((r) => r.status === 'billable');
  const total = preview?.summary.total ?? 0;
  const daysAlready = preview?.summary.daysAlreadyCollected ?? 0;
  const periodStart = useMemo(() => {
    let min: string | null = null;
    for (const r of billableItems) {
      if (r.periodStart && (!min || r.periodStart < min)) min = r.periodStart;
    }
    return min;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billableItems.map((r) => r.periodStart).join(',')]);

  const dirty =
    enabled !== order.codStorageEnabled ||
    cutoff !== persistedCutoff ||
    rate !== (order.codStorageRate ?? COD_STORAGE_DEFAULT_RATE) ||
    // Only the included line's total drives "unsaved changes" — a disabled
    // line's live total differing from the persisted 0 isn't a pending edit.
    (enabled && total !== (order.codStorageTotal ?? 0));

  // ── Render decision ──────────────────────────────────────────────────
  // Collected orders always show (the green record). Otherwise wait for the
  // preview; render nothing if this order has no COD-flagged items.
  if (!collected) {
    if (!preview && !loadingPreview) return null;       // first load not started
    if (preview && codItems.length === 0) return null;  // no COD items on order
  }

  // Build the dt_orders cod_storage_* patch from a result set (the live
  // preview for Save, or the commit result for Collect so the persisted
  // snapshot exactly matches what was billed).
  const buildSummaryPatch = (res?: CodCollectionResult) => {
    const src = res ?? preview;
    const items = (src?.items ?? []).filter((r) => r.status === 'billable');
    let ps: string | null = null;
    for (const r of items) if (r.periodStart && (!ps || r.periodStart < ps)) ps = r.periodStart;
    return {
      cod_storage_enabled: enabled,
      cod_storage_cutoff_date: cutoff || null,
      cod_storage_rate: rate,
      cod_storage_total: src?.summary.total ?? 0,
      cod_storage_item_count: items.length,
      cod_storage_period_start: ps,
      cod_storage_details: detailsFromPreview(src?.items ?? [], rate),
    };
  };

  // For a customer-collect order, the COD amount is part of what the customer
  // pays, so it drives the "Daily Storage" (STOR) accessorial line — keeping
  // order_total + the DT charges summary in sync as the cutoff/date changes.
  // STOR is non-taxable, so order_total / accessorials_total shift by exactly
  // the delta vs the STOR amount already baked into the order. For a
  // bill-to-client order COD stays OUT of the client's total (returns {}).
  const buildOrderTotalPatch = (codTotal: number) => {
    if (order.billingMethod !== 'customer_collect') return {};
    const others = (order.accessorials ?? []).filter((a) => a.code !== COD_STORAGE_SVC_CODE);
    const priorStor = (order.accessorials ?? []).find((a) => a.code === COD_STORAGE_SVC_CODE)?.subtotal ?? 0;
    const delta = codTotal - priorStor;
    return {
      accessorials_json: codTotal > 0
        ? [...others, { code: COD_STORAGE_SVC_CODE, quantity: 1, rate: codTotal, subtotal: codTotal }]
        : others,
      accessorials_total: (order.accessorialsTotal ?? 0) + delta,
      order_total: (order.orderTotal ?? 0) + delta,
    };
  };

  // Persist the line onto dt_orders (drives the DT description push) — no billing.
  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const patch = buildSummaryPatch();
      const { error: upErr } = await supabase
        .from('dt_orders')
        .update({ ...patch, ...buildOrderTotalPatch(patch.cod_storage_total ?? 0) })
        .eq('id', order.id);
      if (upErr) { setSaveError(upErr.message); return; }
      setSaved(true);
      entityEvents.emit('dt_order', order.id);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Mark Paid — collect-on-delivery model (like will-call COD). Records the
  // durable dedup ledger + stamps the order collected/paid + writes an item
  // activity row, but creates NO billing row / no QBO invoice. For a
  // customer-collect order it settles EVERYTHING owed in one action (delivery
  // charges + COD storage), so the DT re-push shows the customer paid in full.
  const handleCollect = async () => {
    if (collecting || billableItems.length === 0) return;
    setCollecting(true);
    setCollectError(null);
    try {
      // 1. Persist the current line so the RPC reads the right details + amount.
      //    For customer-collect, this also folds COD into the order total via
      //    the STOR "Daily Storage" line (so the DT re-push total includes it).
      const patch = buildSummaryPatch();
      const totalsPatch = buildOrderTotalPatch(patch.cod_storage_total ?? 0);
      const { error: upErr } = await supabase
        .from('dt_orders')
        .update({ ...patch, ...totalsPatch, cod_storage_enabled: true })
        .eq('id', order.id);
      if (upErr) { setCollectError(upErr.message); return; }

      // 2. Mark collected/paid: dedup ledger (storage_billing_items) + stamps
      //    cod_storage_collected_* + per-item activity row. No billing row.
      await markCodStorageCollected(order.id, collectNotes.trim() || null, performedBy);

      // 3. Unified settle: a customer-collect order is paid in full at the door.
      //    order_total now already includes COD (step 1), so paid_amount = the
      //    NEW order total — never order_total + cod (that would double-count).
      //    (Client-paid deliveries leave the order's own paid_* alone — only COD
      //    is collected from the end customer, recorded above.)
      if (order.billingMethod === 'customer_collect') {
        const nowIso = new Date().toISOString();
        const paidAmount = ('order_total' in totalsPatch)
          ? (totalsPatch as { order_total: number }).order_total
          : (order.orderTotal ?? 0);
        const { error: paidErr } = await supabase
          .from('dt_orders')
          .update({
            paid_at: nowIso, paid_amount: paidAmount, paid_method: 'COD',
            payment_collected: true, payment_collected_at: nowIso,
          })
          .eq('id', order.id);
        if (paidErr) { setCollectError(paidErr.message); return; }
      }
      entityEvents.emit('dt_order', order.id);
      setShowCollect(false);
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : String(err));
    } finally {
      setCollecting(false);
    }
  };

  const dateRange = periodStart && cutoff ? `${periodStart} → ${cutoff}` : `through ${cutoff}`;

  const labelCss: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Coins size={16} color={theme.colors.orange} />
        <span style={{ fontSize: 14, fontWeight: 700, color: theme.colors.text }}>COD Storage</span>
        <span style={{ fontSize: 10, fontWeight: 700, background: '#FFF7F0', color: theme.colors.orange, border: `1px solid ${theme.colors.orange}`, padding: '1px 6px', borderRadius: 6, textTransform: 'uppercase' }}>
          Collected from customer
        </span>
        {collected && (
          <span style={{ fontSize: 10, fontWeight: 700, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', padding: '1px 6px', borderRadius: 6, textTransform: 'uppercase', marginLeft: 'auto' }}>
            Collected
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 8 }}>
        {collected
          ? `${order.codStorageItemCount ?? 0} item${(order.codStorageItemCount ?? 0) !== 1 ? 's' : ''}`
          : `${billableItems.length} item${billableItems.length !== 1 ? 's' : ''} · ${dateRange}`}
      </div>

      {/* How the amount relates to the order total, per billing method. */}
      {!collected && (
        <div style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 12, lineHeight: 1.45 }}>
          {order.billingMethod === 'customer_collect'
            ? 'Included in the order total as the “Daily Storage” line (the customer pays delivery + storage together).'
            : 'Collected separately from the customer — NOT part of the client’s order total.'}
        </div>
      )}

      {/* Collected view */}
      {collected ? (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <CheckCircle2 size={16} color="#16A34A" />
            <span style={{ fontWeight: 600, color: '#15803D' }}>
              {fmtCurrency(order.codStorageTotal ?? 0)} collected
            </span>
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
            {new Date(order.codStorageCollectedAt as string).toLocaleString()}
            {order.codStorageCollectedBy ? ` · ${order.codStorageCollectedBy}` : ''}
          </div>
          {order.codStorageCollectionNotes && (
            <div style={{ fontSize: 12, color: theme.colors.text, marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {order.codStorageCollectionNotes}
            </div>
          )}
          <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 6 }}>
            Collected from the customer at delivery (no invoice). Recorded on the order + item activity and pushed to DispatchTrack as paid.
          </div>
        </div>
      ) : (
        <>
          {/* Dedup notice — days already invoiced/collected elsewhere excluded. */}
          {daysAlready > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: 8, background: '#FFF7F0', border: `1px solid ${theme.colors.orange}`, borderRadius: 8, marginBottom: 12 }}>
              <AlertTriangle size={13} color={theme.colors.orange} style={{ marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: theme.colors.text }}>
                {daysAlready} day{daysAlready !== 1 ? 's' : ''} already invoiced/collected — only the remaining days are shown.
              </span>
            </div>
          )}

          {/* Include / remove */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: canEdit ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={e => setEnabled(e.target.checked)} style={{ accentColor: theme.colors.orange }} />
            <span style={{ fontSize: 13, color: theme.colors.text }}>Include COD Storage collection line</span>
          </label>

          {enabled && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelCss}><CalendarDays size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Cutoff date</label>
                  <input type="date" value={cutoff} disabled={!canEdit} onChange={e => setCutoff(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ width: 130 }}>
                  <label style={labelCss}>Rate $/cuft/day</label>
                  <input type="number" min="0" step="0.01" value={rate} disabled={!canEdit}
                    onChange={e => setRate(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Per-item breakdown */}
              <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ display: 'flex', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: theme.colors.textSecondary, background: '#FAFAF9', padding: '6px 10px' }}>
                  <span style={{ flex: 1 }}>Item</span>
                  <span style={{ width: 38, textAlign: 'right' }}>class</span>
                  <span style={{ width: 46, textAlign: 'right' }}>cu ft</span>
                  <span style={{ width: 84, textAlign: 'right' }}>from</span>
                  <span style={{ width: 40, textAlign: 'right' }}>days</span>
                  <span style={{ width: 64, textAlign: 'right' }}>amount</span>
                </div>
                {loadingPreview && !preview && (
                  <div style={{ padding: 16, fontSize: 12, color: theme.colors.textMuted, textAlign: 'center' }}>Calculating…</div>
                )}
                {codItems.map((d, i) => {
                  const muted = d.status !== 'billable';
                  return (
                    <div key={d.itemId + i} style={{ display: 'flex', fontSize: 12, padding: '6px 10px', borderTop: `1px solid ${theme.colors.border}`, color: muted ? theme.colors.textMuted : theme.colors.text }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.itemId}
                        {muted && (
                          <span style={{ fontSize: 10, marginLeft: 6, color: theme.colors.textMuted }}>
                            {d.status === 'fully_collected' ? '· fully collected' : d.status === 'no_cubic' ? '· no cu ft' : ''}
                          </span>
                        )}
                      </span>
                      <span style={{ width: 38, textAlign: 'right' }}>{d.itemClass || '—'}</span>
                      <span style={{ width: 46, textAlign: 'right' }}>{d.cubicFeet || '—'}</span>
                      <span style={{ width: 84, textAlign: 'right' }}>{d.periodStart || d.codStartDate || '—'}</span>
                      <span style={{ width: 40, textAlign: 'right' }}>{d.billableDays || 0}</span>
                      <span style={{ width: 64, textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(d.amount)}</span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', fontSize: 13, padding: '8px 10px', borderTop: `2px solid ${theme.colors.border}`, fontWeight: 700, background: '#FAFAF9' }}>
                  <span style={{ flex: 1 }}>Total to collect{billableItems.length > 0 ? ` (${billableItems.length} item${billableItems.length !== 1 ? 's' : ''})` : ''}</span>
                  <span>{fmtCurrency(total)}</span>
                </div>
              </div>

              {!loadingPreview && preview && billableItems.length === 0 && (
                <div style={{ padding: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#92400E' }}>
                  Nothing to collect — these items are already fully collected or have no billable storage days.
                </div>
              )}
            </>
          )}

          {previewError && (
            <div style={{ padding: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} color="#DC2626" />
              <span style={{ fontSize: 12, color: '#991B1B' }}>Preview failed: {previewError}</span>
            </div>
          )}
          {saveError && (
            <div style={{ padding: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} color="#DC2626" />
              <span style={{ fontSize: 12, color: '#991B1B' }}>{saveError}</span>
            </div>
          )}

          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
              {saved && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#15803D' }}><CheckCircle2 size={14} /> Saved</span>}
              {dirty && <WriteButton label={saving ? 'Saving...' : 'Save'} variant="secondary" size="sm" disabled={saving} onClick={handleSave} />}
              {enabled && billableItems.length > 0 && !showCollect && (
                <WriteButton label="Mark Paid" variant="primary" size="sm" onClick={() => setShowCollect(true)} />
              )}
            </div>
          )}

          {/* Mark-paid form */}
          {showCollect && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.colors.border}` }}>
              {order.billingMethod === 'customer_collect' && (
                <div style={{ fontSize: 11, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  This is a customer-collect order — marking paid settles the delivery charges
                  ({fmtCurrency(order.orderTotal ?? 0)}) <strong>and</strong> COD storage ({fmtCurrency(total)}) =
                  {' '}<strong>{fmtCurrency((order.orderTotal ?? 0) + total)}</strong> collected.
                </div>
              )}
              <label style={labelCss}>Payment details (optional)</label>
              <textarea value={collectNotes} onChange={e => setCollectNotes(e.target.value)} rows={2}
                placeholder="e.g., Collected $X cash on delivery / Zelle ref…"
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 8, boxSizing: 'border-box' }} />
              {collectError && (
                <div style={{ fontSize: 12, color: '#991B1B', marginBottom: 8 }}>{collectError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <WriteButton label="Cancel" variant="secondary" size="sm" onClick={() => setShowCollect(false)} />
                <WriteButton label={collecting ? 'Marking paid...' : `Mark Paid ${fmtCurrency(total)}`} variant="primary" size="sm" disabled={collecting} onClick={handleCollect} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
