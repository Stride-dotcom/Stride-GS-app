import { useState, useMemo } from 'react';
import { X, CheckCircle2, AlertTriangle, Package } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { postAddItemsToWillCall } from '../../lib/api';
import type { AddItemsToWillCallResponse } from '../../lib/api';
import type { WillCall } from '../../lib/types';
import { fmtDate } from '../../lib/constants';

interface Props {
  itemIds: string[];
  clientName: string;
  clientSheetId: string;
  willCalls: WillCall[];
  onClose: () => void;
  onSuccess: (result: AddItemsToWillCallResponse) => void;
}

const ACTIVE_STATUSES = ['Pending', 'Scheduled'];

export function AddToWillCallModal({ itemIds, clientName, clientSheetId, willCalls, onClose, onSuccess }: Props) {
  const [selectedWc, setSelectedWc] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AddItemsToWillCallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter to open WCs for this client
  const openWcs = useMemo(() =>
    willCalls.filter(wc =>
      wc.clientSheetId === clientSheetId &&
      ACTIVE_STATUSES.includes(wc.status)
    ).sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || '')),
    [willCalls, clientSheetId]
  );

  const handleSubmit = async () => {
    if (!selectedWc) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await postAddItemsToWillCall({ wcNumber: selectedWc, items: itemIds }, clientSheetId);
      if (resp.ok && resp.data?.success) {
        setResult(resp.data);
        onSuccess(resp.data);
      } else {
        setError(resp.error || resp.data?.error || 'Failed to add items');
      }
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
        width: 560, maxWidth: '95vw', maxHeight: '80vh', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        <ProcessingOverlay visible={submitting} message="Adding items to will call..." />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Add to Will Call</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              {itemIds.length} item{itemIds.length !== 1 ? 's' : ''} from {clientName}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
          {/* Success result */}
          {result && (
            <div style={{ padding: 16, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <CheckCircle2 size={18} color="#16A34A" />
                <span style={{ fontWeight: 600, color: '#15803D' }}>Items Added</span>
              </div>
              <div style={{ fontSize: 13, color: '#166534' }}>
                {result.addedCount} item{result.addedCount !== 1 ? 's' : ''} added to {selectedWc}.
                Total: {result.totalItems} items, ${(result.totalFee || 0).toFixed(2)} fee.
              </div>
              {result.warnings && result.warnings.length > 0 && (
                <div style={{ fontSize: 12, color: '#92400E', marginTop: 6 }}>
                  {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} color="#DC2626" />
              <span style={{ fontSize: 13, color: '#991B1B' }}>{error}</span>
            </div>
          )}

          {/* WC picker */}
          {!result && (
            <>
              {openWcs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: theme.colors.textMuted }}>
                  <Package size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                  <div style={{ fontSize: 14, marginBottom: 4 }}>No open will calls for {clientName}</div>
                  <div style={{ fontSize: 12 }}>Create a new will call first, then add items to it.</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 8 }}>
                    Select a Will Call ({openWcs.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {openWcs.map(wc => {
                      const isSelected = selectedWc === wc.wcNumber;
                      return (
                        <button
                          key={wc.wcNumber}
                          onClick={() => setSelectedWc(isSelected ? null : wc.wcNumber)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 14px', borderRadius: 10,
                            border: `2px solid ${isSelected ? theme.colors.orange : theme.colors.borderDefault}`,
                            background: isSelected ? theme.colors.orangeLight || '#FFF7ED' : '#fff',
                            cursor: 'pointer', textAlign: 'left', width: '100%',
                            transition: 'border-color 0.1s, background 0.1s',
                          }}
                        >
                          {/* Radio indicator */}
                          <div style={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                            border: `2px solid ${isSelected ? theme.colors.orange : theme.colors.borderDefault}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSelected && <div style={{ width: 10, height: 10, borderRadius: '50%', background: theme.colors.orange }} />}
                          </div>

                          {/* WC details */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                              <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{wc.wcNumber}</span>
                              <span style={{
                                fontSize: 11, padding: '1px 8px', borderRadius: 99,
                                background: wc.status === 'Pending' ? '#FEF3C7' : wc.status === 'Scheduled' ? '#DBEAFE' : '#E0E7FF',
                                color: wc.status === 'Pending' ? '#92400E' : wc.status === 'Scheduled' ? '#1E40AF' : '#3730A3',
                                fontWeight: 500,
                              }}>{wc.status}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: theme.colors.textSecondary }}>
                              <span>{wc.pickupParty || '—'}</span>
                              <span>{wc.scheduledDate ? fmtDate(wc.scheduledDate) : 'Not scheduled'}</span>
                              <span>{wc.itemCount} item{wc.itemCount !== 1 ? 's' : ''}</span>
                              <span>Created {fmtDate(wc.createdDate)}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <WriteButton label={result ? 'Close' : 'Cancel'} variant="secondary" size="sm" onClick={onClose} />
          {!result && openWcs.length > 0 && (
            <WriteButton
              label={submitting ? 'Adding...' : `Add ${itemIds.length} Item${itemIds.length !== 1 ? 's' : ''}`}
              variant="primary"
              size="sm"
              disabled={!selectedWc || submitting}
              onClick={handleSubmit}
            />
          )}
        </div>
      </div>
    </>
  );
}
