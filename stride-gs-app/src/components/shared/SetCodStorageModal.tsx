/**
 * SetCodStorageModal — batch Inventory action to flag/unflag items for COD
 * Storage ("end customers pay storage"). Writes via the set_cod_storage RPC
 * (admin/staff gated; public.inventory has no browser UPDATE policy).
 *
 * Two modes:
 *   • Set    — COD from today (default) or COD from a chosen date.
 *   • Remove — clears the flag + start date.
 *
 * Feature-gated by the caller (Inventory only shows the action when
 * useFeatureFlag('codStorageBilling') === 'supabase'). Mirrors the
 * StorageCreditModal layout/pattern.
 */
import { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, CalendarDays, PackageX } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { setCodStorage, todayIso } from '../../lib/codStorage';
import { entityEvents } from '../../lib/entityEvents';
import type { InventoryItem } from '../../lib/types';

export interface CodStorageModalItem {
  itemId: string;
  description?: string;
}

interface Props {
  items: CodStorageModalItem[];
  clientName: string;
  /** tenant_id (the per-client sheet id used as tenant_id in Supabase). */
  clientSheetId: string;
  onClose: () => void;
  onSuccess: (updatedCount: number) => void;
  /** Optimistic table patch (Inventory passes these). */
  applyItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  clearItemPatch?: (itemId: string) => void;
}

type Mode = 'set' | 'remove';
type SetWhen = 'today' | 'date';

export function SetCodStorageModal({
  items, clientName, clientSheetId, onClose, onSuccess, applyItemPatch, clearItemPatch,
}: Props) {
  const today = todayIso();
  const [mode, setMode] = useState<Mode>('set');
  const [when, setWhen] = useState<SetWhen>('today');
  const [startDate, setStartDate] = useState(today);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const itemIds = items.map(i => i.itemId).filter(Boolean);
  const effectiveStart = mode === 'set' ? (when === 'today' ? today : startDate) : null;
  const canSubmit = itemIds.length > 0 && !!clientSheetId &&
    (mode === 'remove' || (when === 'today' || !!startDate));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const enabled = mode === 'set';
    // Optimistic table patch.
    if (applyItemPatch) {
      for (const id of itemIds) {
        applyItemPatch(id, { codStorage: enabled, codStorageStartDate: enabled ? (effectiveStart || '') : '' });
      }
    }

    try {
      const n = await setCodStorage(clientSheetId, itemIds, enabled, effectiveStart);

      // The set_cod_storage RPC writes the entity_audit_log row server-side
      // (SECURITY DEFINER bypasses the admin/staff INSERT policy that rejects
      // browser inserts) — so the Activity tab is fed from there, not here.

      // Signal open Item Detail panels + the I/A/R/W/D/$ badge hook to refetch
      // (mirrors ItemCodStorageSection's per-save emit). Without this the detail
      // page COD state + the "$" badges stay stale after a batch set/remove.
      for (const id of itemIds) entityEvents.emit('inventory', id);

      setDoneCount(n);
      onSuccess(n);
    } catch (err) {
      if (clearItemPatch) for (const id of itemIds) clearItemPatch(id);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const labelCss: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
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
          message={mode === 'set' ? 'Setting COD storage' : 'Removing COD storage'}
          subMessage="Updating the selected items. You can leave this open."
        />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>COD Storage</div>
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
                  COD storage {mode === 'set' ? 'set on' : 'removed from'} {doneCount} item{doneCount !== 1 ? 's' : ''}
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
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {(['set', 'remove'] as Mode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${mode === m ? theme.colors.orange : theme.colors.borderDefault}`,
                      background: mode === m ? theme.colors.orangeLight : '#fff',
                      color: mode === m ? theme.colors.orange : theme.colors.textSecondary,
                      fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {m === 'set' ? <CalendarDays size={14} /> : <PackageX size={14} />}
                    {m === 'set' ? 'Set COD Storage' : 'Remove COD Storage'}
                  </button>
                ))}
              </div>

              {mode === 'set' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={labelCss}>Start date</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: when === 'date' ? 10 : 0 }}>
                    {(['today', 'date'] as SetWhen[]).map(w => (
                      <button
                        key={w}
                        onClick={() => setWhen(w)}
                        style={{
                          flex: 1, padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${when === w ? theme.colors.orange : theme.colors.borderDefault}`,
                          background: when === w ? theme.colors.orangeLight : '#fff',
                          color: when === w ? theme.colors.orange : theme.colors.textSecondary,
                          fontSize: 12, fontWeight: 600,
                        }}
                      >
                        {w === 'today' ? 'COD from today' : 'COD from date'}
                      </button>
                    ))}
                  </div>
                  {when === 'date' && (
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
                    />
                  )}
                </div>
              )}

              {mode === 'remove' && (
                <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 14 }}>
                  Clears the COD storage flag and start date on the selected items. The
                  designer will be billed storage normally again.
                </div>
              )}

              {/* Item preview */}
              <div>
                <div style={labelCss}>Items</div>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8 }}>
                  {items.map((it, idx) => (
                    <div key={it.itemId} style={{ padding: '8px 10px', borderBottom: idx < items.length - 1 ? `1px solid ${theme.colors.borderDefault}` : 'none' }}>
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
              label={submitting ? 'Saving...' : mode === 'set' ? `Set ${itemIds.length} Item${itemIds.length !== 1 ? 's' : ''}` : `Remove from ${itemIds.length} Item${itemIds.length !== 1 ? 's' : ''}`}
              variant="primary"
              size="sm"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
            />
          )}
        </div>
      </div>
    </>
  );
}
