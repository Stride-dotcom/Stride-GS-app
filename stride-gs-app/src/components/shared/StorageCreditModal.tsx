/**
 * StorageCreditModal — admin tool to grant a free-storage window on one or
 * more inventory items. Writes a row per item into public.storage_credits
 * plus a matching entity_audit_log row. The Postgres
 * _compute_storage_charges() function subtracts active credit ranges from
 * the billable period, so credited days never appear on a storage invoice.
 *
 * Mirrors the ReleaseItemsModal layout/pattern (overlay + centered card +
 * WriteButton footer). inventory_id (UUID) is resolved here from
 * (tenant_id, item_id) — best-effort; a credit still records with a null
 * inventory_id because the calc function keys off (tenant_id, item_id).
 */
import { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, CalendarDays } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { supabase } from '../../lib/supabase';

export interface StorageCreditModalItem {
  itemId: string;
  description?: string;
}

interface Props {
  items: StorageCreditModalItem[];
  clientName: string;
  /** tenant_id (the per-client sheet id used as tenant_id in Supabase). */
  clientSheetId: string;
  /** Email of the acting admin — stored as storage_credits.created_by. */
  createdBy: string;
  onClose: () => void;
  onSuccess: (creditedCount: number) => void;
}

export function StorageCreditModal({ items, clientName, clientSheetId, createdBy, onClose, onSuccess }: Props) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const [freeFrom, setFreeFrom] = useState(today);
  const [freeTo, setFreeTo] = useState(today);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const itemIds = items.map(i => i.itemId).filter(Boolean);
  const rangeValid = !!freeFrom && !!freeTo && freeTo >= freeFrom;

  const handleSubmit = async () => {
    if (!rangeValid || itemIds.length === 0 || !clientSheetId) return;
    setSubmitting(true);
    setError(null);

    try {
      // Best-effort: resolve the inventory row UUID for each item so the
      // credit can carry inventory_id. The calc function matches on
      // (tenant_id, item_id), so a missing id is non-fatal.
      const idByItem = new Map<string, string>();
      const { data: invRows } = await supabase
        .from('inventory')
        .select('id, item_id')
        .eq('tenant_id', clientSheetId)
        .in('item_id', itemIds);
      for (const r of (invRows ?? []) as { id: string; item_id: string }[]) {
        idByItem.set(r.item_id, r.id);
      }

      const trimmedReason = reason.trim();
      const creditRows = itemIds.map(itemId => ({
        tenant_id: clientSheetId,
        item_id: itemId,
        inventory_id: idByItem.get(itemId) ?? null,
        free_from: freeFrom,
        free_to: freeTo,
        reason: trimmedReason || null,
        created_by: createdBy,
      }));

      const { data: inserted, error: insErr } = await supabase
        .from('storage_credits')
        .insert(creditRows)
        .select('id, item_id');

      if (insErr) {
        setError(insErr.message || 'Failed to add storage credit');
        setSubmitting(false);
        return;
      }

      // Audit trail — one row per credit. Non-fatal if it fails (mirrors
      // the delivery/repair audit-insert pattern used elsewhere).
      const auditRows = ((inserted ?? []) as { id: string; item_id: string }[]).map(c => ({
        entity_type: 'storage_credit',
        entity_id: c.id,
        tenant_id: clientSheetId,
        action: 'created',
        changes: {
          item_id: c.item_id,
          free_from: freeFrom,
          free_to: freeTo,
          reason: trimmedReason || null,
        },
        performed_by: createdBy,
        source: 'app',
      }));
      if (auditRows.length > 0) {
        supabase.from('entity_audit_log').insert(auditRows).then(({ error: aErr }) => {
          if (aErr) console.warn('[storage_credit] audit insert failed (non-fatal):', aErr.message);
        });
      }

      const n = inserted?.length ?? itemIds.length;
      setDoneCount(n);
      onSuccess(n);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 460, maxWidth: '95vw', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={submitting}
          message="Adding storage credit"
          subMessage="Recording the free-storage window. You can leave this open."
        />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Storage Credit</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              {itemIds.length} item{itemIds.length !== 1 ? 's' : ''}{clientName ? ` · ${clientName}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          {doneCount !== null && (
            <div style={{ padding: 14, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={18} color="#16A34A" />
                <span style={{ fontWeight: 600, color: '#15803D' }}>
                  Storage credit added to {doneCount} item{doneCount !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} color="#DC2626" />
              <span style={{ fontSize: 13, color: '#991B1B' }}>{error}</span>
            </div>
          )}

          {doneCount === null && (
            <>
              {/* Free date range */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    <CalendarDays size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Free From
                  </label>
                  <input
                    type="date"
                    value={freeFrom}
                    max={freeTo || undefined}
                    onChange={e => setFreeFrom(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    <CalendarDays size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Free To
                  </label>
                  <input
                    type="date"
                    value={freeTo}
                    min={freeFrom || undefined}
                    onChange={e => setFreeTo(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
                  />
                </div>
              </div>

              {!rangeValid && (
                <div style={{ fontSize: 11, color: '#B45309', marginTop: -8, marginBottom: 12 }}>
                  "Free To" must be on or after "Free From".
                </div>
              )}

              {/* Reason */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Reason (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g., Goodwill credit — delayed delivery"
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', resize: 'vertical' }}
                />
              </div>

              {/* Item preview */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  Items
                </div>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8 }}>
                  {items.map((it, idx) => (
                    <div
                      key={it.itemId}
                      style={{
                        padding: '8px 10px',
                        borderBottom: idx < items.length - 1 ? `1px solid ${theme.colors.borderDefault}` : 'none',
                      }}
                    >
                      <div style={{ fontSize: 13, color: theme.colors.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.itemId}
                      </div>
                      {it.description && (
                        <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <WriteButton label={doneCount !== null ? 'Close' : 'Cancel'} variant="secondary" size="sm" onClick={onClose} />
          {doneCount === null && (
            <WriteButton
              label={submitting ? 'Saving...' : `Credit ${itemIds.length} Item${itemIds.length !== 1 ? 's' : ''}`}
              variant="primary"
              size="sm"
              disabled={!rangeValid || submitting || itemIds.length === 0 || !clientSheetId}
              onClick={handleSubmit}
            />
          )}
        </div>
      </div>
    </>
  );
}
