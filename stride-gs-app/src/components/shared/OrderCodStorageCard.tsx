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
  collectCodStorage,
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

  const persistedCutoff = order.codStorageCutoffDate || order.localServiceDate || todayIso();
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
    total !== (order.codStorageTotal ?? 0);

  // ── Render decision ──────────────────────────────────────────────────
  // Collected orders always show (the green record). Otherwise wait for the
  // preview; render nothing if this order has no COD-flagged items.
  if (!collected) {
    if (!preview && !loadingPreview) return null;       // first load not started
    if (preview && codItems.length === 0) return null;  // no COD items on order
  }

  const buildSummaryPatch = () => ({
    cod_storage_enabled: enabled,
    cod_storage_cutoff_date: cutoff || null,
    cod_storage_rate: rate,
    cod_storage_total: total,
    cod_storage_item_count: billableItems.length,
    cod_storage_period_start: periodStart,
    cod_storage_details: detailsFromPreview(preview?.items ?? [], rate),
  });

  // Persist the line onto dt_orders (drives the DT description push) — no billing.
  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const { error: upErr } = await supabase
        .from('dt_orders')
        .update(buildSummaryPatch())
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

  // Commit: create the billing rows + mark collected (same path as the
  // standalone Collect COD), then stamp the collection onto the order.
  const handleCollect = async () => {
    if (collecting || billableItems.length === 0) return;
    setCollecting(true);
    setCollectError(null);
    try {
      const res = await collectCodStorage(
        order.tenantId || '', itemIds, cutoff, rate, collectNotes.trim() || null, performedBy,
      );
      if (res.summary.errors && res.summary.errors.length > 0) {
        setCollectError(res.summary.errors.map((e) => `${e.itemId}: ${e.error}`).join('; '));
        return;
      }
      const { error: upErr } = await supabase
        .from('dt_orders')
        .update({
          ...buildSummaryPatch(),
          cod_storage_enabled: true,
          cod_storage_total: res.summary.total,
          cod_storage_collected_at: new Date().toISOString(),
          cod_storage_collected_by: performedBy,
          cod_storage_collection_notes: collectNotes.trim() || null,
        })
        .eq('id', order.id);
      if (upErr) { setCollectError(upErr.message); return; }
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
      <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 12 }}>
        {collected
          ? `${order.codStorageItemCount ?? 0} item${(order.codStorageItemCount ?? 0) !== 1 ? 's' : ''}`
          : `${billableItems.length} item${billableItems.length !== 1 ? 's' : ''} · ${dateRange}`}
      </div>

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
            Unbilled COD_STOR billing row{(order.codStorageItemCount ?? 0) !== 1 ? 's' : ''} created — flows through the normal invoicing path to QBO.
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
                  <span style={{ flex: 1 }}>Total due{billableItems.length > 0 ? ` (${billableItems.length} item${billableItems.length !== 1 ? 's' : ''})` : ''}</span>
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
                <WriteButton label="Collect COD Storage" variant="primary" size="sm" onClick={() => setShowCollect(true)} />
              )}
            </div>
          )}

          {/* Collect form */}
          {showCollect && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.colors.border}` }}>
              <label style={labelCss}>Payment details (optional)</label>
              <textarea value={collectNotes} onChange={e => setCollectNotes(e.target.value)} rows={2}
                placeholder="e.g., Collected $X cash on delivery / Zelle ref…"
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 8, boxSizing: 'border-box' }} />
              {collectError && (
                <div style={{ fontSize: 12, color: '#991B1B', marginBottom: 8 }}>{collectError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <WriteButton label="Cancel" variant="secondary" size="sm" onClick={() => setShowCollect(false)} />
                <WriteButton label={collecting ? 'Collecting...' : `Create Invoice ${fmtCurrency(total)}`} variant="primary" size="sm" disabled={collecting} onClick={handleCollect} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
