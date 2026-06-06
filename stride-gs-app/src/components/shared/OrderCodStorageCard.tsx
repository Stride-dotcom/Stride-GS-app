/**
 * OrderCodStorageCard — the "COD Storage" collection line on a delivery
 * order (Phase 4 editing + Phase 6 collection).
 *
 * Shows the auto-computed line (item count, date range, rate, total) with an
 * editable cutoff date + rate (recomputed live from the persisted per-item
 * snapshot — no inventory re-fetch), an include/remove checkbox, and Save.
 * Once delivered, a "Mark as Collected" action records the collection (notes +
 * storage_billing_items via the RPC) so the period is never re-billed.
 *
 * Feature-gated by the caller's tenant. Renders nothing when the order has no
 * COD items.
 */
import { useEffect, useMemo, useState } from 'react';
import { Coins, CalendarDays, CheckCircle2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { supabase } from '../../lib/supabase';
import { entityEvents } from '../../lib/entityEvents';
import {
  recomputeCodLineFromDetails,
  markCodStorageCollected,
  COD_STORAGE_DEFAULT_RATE,
  todayIso,
} from '../../lib/codStorage';
import type { DtOrderForUI } from '../../lib/supabaseQueries';

function fmtCurrency(n: number): string {
  return `$${(n || 0).toFixed(2)}`;
}

interface Props {
  order: DtOrderForUI;
  performedBy: string | null;
  canEdit: boolean;
}

export function OrderCodStorageCard({ order, performedBy, canEdit }: Props) {
  const details = order.codStorageDetails ?? [];
  const collected = !!order.codStorageCollectedAt;

  const [enabled, setEnabled] = useState(order.codStorageEnabled);
  const [cutoff, setCutoff] = useState(order.codStorageCutoffDate || order.localServiceDate || todayIso());
  const [rate, setRate] = useState<number>(order.codStorageRate ?? COD_STORAGE_DEFAULT_RATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [collecting, setCollecting] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [collectNotes, setCollectNotes] = useState('');
  const [collectError, setCollectError] = useState<string | null>(null);

  // Re-sync from the order whenever it refreshes (realtime).
  useEffect(() => {
    setEnabled(order.codStorageEnabled);
    setCutoff(order.codStorageCutoffDate || order.localServiceDate || todayIso());
    setRate(order.codStorageRate ?? COD_STORAGE_DEFAULT_RATE);
  }, [order.id, order.codStorageEnabled, order.codStorageCutoffDate, order.codStorageRate, order.localServiceDate]);

  const recomputed = useMemo(
    () => recomputeCodLineFromDetails(details, cutoff, rate),
    [details, cutoff, rate],
  );

  const dirty =
    enabled !== order.codStorageEnabled ||
    cutoff !== (order.codStorageCutoffDate || '') ||
    rate !== (order.codStorageRate ?? COD_STORAGE_DEFAULT_RATE) ||
    recomputed.total !== (order.codStorageTotal ?? 0);

  // No COD items on this order → nothing to show.
  if (details.length === 0) return null;

  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { error: upErr } = await supabase
        .from('dt_orders')
        .update({
          cod_storage_enabled: enabled,
          cod_storage_cutoff_date: cutoff || null,
          cod_storage_rate: rate,
          cod_storage_total: recomputed.total,
          cod_storage_item_count: recomputed.itemCount,
          cod_storage_period_start: recomputed.periodStart,
          cod_storage_details: recomputed.details,
        })
        .eq('id', order.id);
      if (upErr) { setError(upErr.message); return; }
      setSaved(true);
      entityEvents.emit('dt_order', order.id);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCollect = async () => {
    if (collecting) return;
    setCollecting(true);
    setCollectError(null);
    try {
      await markCodStorageCollected(order.id, collectNotes.trim() || null, performedBy);
      entityEvents.emit('dt_order', order.id);
      setShowCollect(false);
    } catch (err) {
      setCollectError(err instanceof Error ? err.message : String(err));
    } finally {
      setCollecting(false);
    }
  };

  const dateRange =
    recomputed.periodStart && cutoff ? `${recomputed.periodStart} → ${cutoff}` : '—';

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
        {recomputed.itemCount} item{recomputed.itemCount !== 1 ? 's' : ''} · {dateRange}
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
        </div>
      ) : (
        <>
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
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }} />
                </div>
                <div style={{ width: 130 }}>
                  <label style={labelCss}>Rate $/cuft/day</label>
                  <input type="number" min="0" step="0.01" value={rate} disabled={!canEdit}
                    onChange={e => setRate(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }} />
                </div>
              </div>

              {/* Per-item breakdown */}
              <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ display: 'flex', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: theme.colors.textSecondary, background: '#FAFAF9', padding: '6px 10px' }}>
                  <span style={{ flex: 1 }}>Item</span>
                  <span style={{ width: 50, textAlign: 'right' }}>cu ft</span>
                  <span style={{ width: 50, textAlign: 'right' }}>days</span>
                  <span style={{ width: 70, textAlign: 'right' }}>amount</span>
                </div>
                {recomputed.details.map((d, i) => (
                  <div key={d.item_id + i} style={{ display: 'flex', fontSize: 12, padding: '6px 10px', borderTop: `1px solid ${theme.colors.border}` }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.item_id}{d.item_class ? ` · ${d.item_class}` : ''}
                    </span>
                    <span style={{ width: 50, textAlign: 'right' }}>{d.cubic_feet}</span>
                    <span style={{ width: 50, textAlign: 'right' }}>{d.days}</span>
                    <span style={{ width: 70, textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(d.amount)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', fontSize: 13, padding: '8px 10px', borderTop: `2px solid ${theme.colors.border}`, fontWeight: 700, background: '#FAFAF9' }}>
                  <span style={{ flex: 1 }}>Total due</span>
                  <span>{fmtCurrency(recomputed.total)}</span>
                </div>
              </div>
            </>
          )}

          {error && (
            <div style={{ padding: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} color="#DC2626" />
              <span style={{ fontSize: 12, color: '#991B1B' }}>{error}</span>
            </div>
          )}

          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
              {saved && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#15803D' }}><CheckCircle2 size={14} /> Saved</span>}
              {dirty && <WriteButton label={saving ? 'Saving...' : 'Save'} variant="secondary" size="sm" disabled={saving} onClick={handleSave} />}
              {enabled && !dirty && (
                showCollect ? null : (
                  <WriteButton label="Mark as Collected" variant="primary" size="sm" onClick={() => setShowCollect(true)} />
                )
              )}
            </div>
          )}

          {/* Mark-as-collected form */}
          {showCollect && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.colors.border}` }}>
              <label style={labelCss}>Payment details (optional)</label>
              <textarea value={collectNotes} onChange={e => setCollectNotes(e.target.value)} rows={2}
                placeholder="e.g., Collected $X cash on delivery / Zelle ref…"
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 8 }} />
              {collectError && (
                <div style={{ fontSize: 12, color: '#991B1B', marginBottom: 8 }}>{collectError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <WriteButton label="Cancel" variant="secondary" size="sm" onClick={() => setShowCollect(false)} />
                <WriteButton label={collecting ? 'Recording...' : `Confirm Collected ${fmtCurrency(recomputed.total)}`} variant="primary" size="sm" disabled={collecting} onClick={handleCollect} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
