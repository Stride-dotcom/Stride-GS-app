/**
 * CollectCodStorageModal — "Collect COD Storage" batch action on Inventory.
 *
 * Bills the end-customer storage days for the selected COD-flagged items,
 * INDEPENDENT of any delivery order. Backed by the collect-cod-storage-sb
 * Edge Function: a dry-run preview drives the breakdown shown here, and the
 * commit creates Unbilled COD_STOR billing rows (→ normal invoicing → QBO),
 * records the periods in storage_billing_items (never re-billed), and advances
 * each item's cod_storage_start_date past the cutoff.
 *
 * Feature-gated by the caller (Inventory only shows the action when
 * codStorageBilling resolves to 'supabase' for the data tenant).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, CalendarDays, Coins, Info } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import {
  previewCodCollection,
  collectCodStorage,
  COD_STORAGE_DEFAULT_RATE,
  todayIso,
  type CodCollectionResult,
} from '../../lib/codStorage';

export interface CollectCodStorageItem {
  itemId: string;
  description?: string;
}

interface Props {
  items: CollectCodStorageItem[];
  clientName: string;
  /** tenant_id (the per-client sheet id used as tenant_id in Supabase). */
  clientSheetId: string;
  /** Caller email for the billing audit + collection record. */
  performedBy: string | null;
  onClose: () => void;
  onSuccess: (created: number, total: number) => void;
}

function fmtCurrency(n: number): string {
  return `$${(n || 0).toFixed(2)}`;
}

export function CollectCodStorageModal({
  items, clientName, clientSheetId, performedBy, onClose, onSuccess,
}: Props) {
  const today = todayIso();
  const [cutoff, setCutoff] = useState(today);
  const [rate, setRate] = useState<number>(COD_STORAGE_DEFAULT_RATE);
  const [notes, setNotes] = useState('');

  const [preview, setPreview] = useState<CodCollectionResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<CodCollectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const itemIds = items.map((i) => i.itemId).filter(Boolean);
  const reqSeq = useRef(0);

  const loadPreview = useCallback(async () => {
    if (!clientSheetId || itemIds.length === 0 || !cutoff) return;
    const seq = ++reqSeq.current;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await previewCodCollection(clientSheetId, itemIds, cutoff, rate);
      if (seq === reqSeq.current) setPreview(res);
    } catch (err) {
      if (seq === reqSeq.current) setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === reqSeq.current) setLoadingPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSheetId, cutoff, rate, itemIds.join(',')]);

  // Debounced re-preview on cutoff/rate change.
  useEffect(() => {
    if (done) return;
    const t = setTimeout(loadPreview, 250);
    return () => clearTimeout(t);
  }, [loadPreview, done]);

  const billableItems = (preview?.items ?? []).filter((r) => r.status === 'billable');
  const total = preview?.summary.total ?? 0;
  const daysAlready = preview?.summary.daysAlreadyCollected ?? 0;
  const skippedItems = (preview?.items ?? []).filter(
    (r) => r.status === 'fully_collected' || r.status === 'no_cubic' || r.status === 'no_cod',
  );

  const canSubmit = !!clientSheetId && billableItems.length > 0 && !submitting && !loadingPreview;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await collectCodStorage(clientSheetId, itemIds, cutoff, rate, notes.trim() || null, performedBy);
      setDone(res);
      onSuccess(res.summary.created ?? 0, res.summary.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const labelCss: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 600, maxWidth: '95vw', maxHeight: '92vh', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={submitting}
          message="Creating COD storage invoice"
          subMessage="Billing the selected items. You can leave this open."
        />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Coins size={18} color={theme.colors.orange} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Collect COD Storage</div>
              <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
                {itemIds.length} item{itemIds.length !== 1 ? 's' : ''}{clientName ? ` · ${clientName}` : ''}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
          {/* Done view */}
          {done ? (
            <div style={{ padding: 16, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <CheckCircle2 size={18} color="#16A34A" />
                <span style={{ fontWeight: 600, color: '#15803D' }}>
                  Invoiced {fmtCurrency(done.summary.total)} across {done.summary.created ?? 0} item{(done.summary.created ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                Unbilled COD_STOR billing rows created — they flow through the normal invoicing path to QBO.
                {(done.summary.skipped ?? 0) > 0 && ` ${done.summary.skipped} already-invoiced item(s) skipped.`}
              </div>
              {(done.summary.errors?.length ?? 0) > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>
                  {done.summary.errors!.length} item(s) failed: {done.summary.errors!.map((e) => `${e.itemId} (${e.error})`).join('; ')}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Controls */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelCss}><CalendarDays size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Bill through (cutoff)</label>
                  <input type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ width: 150 }}>
                  <label style={labelCss}>Rate $/cu ft/day</label>
                  <input type="number" min="0" step="0.01" value={rate}
                    onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                    style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Dedup warning */}
              {daysAlready > 0 && (
                <div style={{ padding: 10, background: theme.colors.orangeLight, border: `1px solid ${theme.colors.orange}`, borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Info size={14} color={theme.colors.orange} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: theme.colors.text }}>
                    {daysAlready} day{daysAlready !== 1 ? 's' : ''} already invoiced/collected on the selected items — only the remaining days are billed below.
                  </span>
                </div>
              )}

              {/* Per-item breakdown */}
              <div style={{ border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
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
                {(preview?.items ?? []).map((d, i) => {
                  const muted = d.status !== 'billable';
                  return (
                    <div key={d.itemId + i} style={{ display: 'flex', fontSize: 12, padding: '6px 10px', borderTop: `1px solid ${theme.colors.borderDefault}`, color: muted ? theme.colors.textMuted : theme.colors.text }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.itemId}
                        {muted && (
                          <span style={{ fontSize: 10, marginLeft: 6, color: theme.colors.textMuted }}>
                            {d.status === 'fully_collected' ? '· fully collected' : d.status === 'no_cubic' ? '· no cu ft' : '· not COD'}
                          </span>
                        )}
                      </span>
                      <span style={{ width: 38, textAlign: 'right' }}>{d.itemClass || '—'}</span>
                      <span style={{ width: 46, textAlign: 'right' }}>{d.cubicFeet || '—'}</span>
                      <span style={{ width: 84, textAlign: 'right' }}>{d.periodStart || '—'}</span>
                      <span style={{ width: 40, textAlign: 'right' }}>{d.billableDays || 0}</span>
                      <span style={{ width: 64, textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(d.amount)}</span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', fontSize: 13, padding: '8px 10px', borderTop: `2px solid ${theme.colors.borderDefault}`, fontWeight: 700, background: '#FAFAF9' }}>
                  <span style={{ flex: 1 }}>Total to invoice{billableItems.length > 0 ? ` (${billableItems.length} item${billableItems.length !== 1 ? 's' : ''})` : ''}</span>
                  <span>{fmtCurrency(total)}</span>
                </div>
              </div>

              {!loadingPreview && preview && billableItems.length === 0 && (
                <div style={{ padding: 12, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#92400E' }}>
                  Nothing to invoice for the selected items{skippedItems.length ? ` (${skippedItems.length} skipped — fully collected, missing cubic feet, or not COD-flagged)` : ''}.
                </div>
              )}

              {/* Notes */}
              <div style={{ marginBottom: 4 }}>
                <label style={labelCss}>Notes (payment reference, invoice #, etc.)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  placeholder="e.g., Paid in advance through cutoff / Zelle ref 1234"
                  style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>

              {previewError && (
                <div style={{ padding: 10, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} color="#DC2626" />
                  <span style={{ fontSize: 12, color: '#991B1B' }}>Preview failed: {previewError}</span>
                </div>
              )}
              {error && (
                <div style={{ padding: 10, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} color="#DC2626" />
                  <span style={{ fontSize: 12, color: '#991B1B' }}>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <WriteButton label={done ? 'Close' : 'Cancel'} variant="secondary" size="sm" onClick={onClose} />
          {!done && (
            <WriteButton
              label={submitting ? 'Creating…' : `Create Invoice ${fmtCurrency(total)}`}
              variant="primary"
              size="sm"
              disabled={!canSubmit}
              onClick={handleSubmit}
            />
          )}
        </div>
      </div>
    </>
  );
}
