import { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, CalendarDays } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { postReleaseItems } from '../../lib/api';
import type { ReleaseItemsResponse } from '../../lib/api';

interface Props {
  itemIds: string[];
  clientName: string;
  clientSheetId: string;
  onClose: () => void;
  onSuccess: (result: ReleaseItemsResponse) => void;
}

export function ReleaseItemsModal({ itemIds, clientName, clientSheetId, onClose, onSuccess }: Props) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const [releaseDate, setReleaseDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReleaseItemsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!releaseDate) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await postReleaseItems({ itemIds, releaseDate, notes: notes.trim() || undefined }, clientSheetId);
      if (resp.ok && resp.data?.success) {
        setResult(resp.data);
        onSuccess(resp.data);
      } else {
        setError(resp.error || resp.data?.error || 'Failed to release items');
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
        width: 440, maxWidth: '95vw', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 201, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={submitting}
          message="Hold tight — releasing your items"
          subMessage="Updating inventory, billing, and notifying the client. You can leave this open."
        />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Release Items</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 2 }}>
              {itemIds.length} item{itemIds.length !== 1 ? 's' : ''} from {clientName}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          {/* Success */}
          {result && (
            <div style={{ padding: 14, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <CheckCircle2 size={18} color="#16A34A" />
                <span style={{ fontWeight: 600, color: '#15803D' }}>
                  {result.releasedCount} item{result.releasedCount !== 1 ? 's' : ''} released
                </span>
              </div>
              {result.skipped && result.skipped.length > 0 && (
                <div style={{ fontSize: 12, color: '#92400E', marginTop: 6 }}>
                  Skipped: {result.skipped.join(', ')}
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

          {/* Form */}
          {!result && (
            <>
              {/* Release Date */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  <CalendarDays size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Release Date
                </label>
                <input
                  type="date"
                  value={releaseDate}
                  onChange={e => setReleaseDate(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', fontSize: 13,
                    border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8,
                    fontFamily: 'inherit', outline: 'none',
                  }}
                />
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g., Delivered to client residence"
                  rows={2}
                  style={{
                    width: '100%', padding: '8px 12px', fontSize: 13,
                    border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8,
                    fontFamily: 'inherit', outline: 'none', resize: 'vertical',
                  }}
                />
              </div>

              {/* Item list preview */}
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 4 }}>
                Items: {itemIds.slice(0, 10).join(', ')}{itemIds.length > 10 ? ` +${itemIds.length - 10} more` : ''}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.borderDefault}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <WriteButton label={result ? 'Close' : 'Cancel'} variant="secondary" size="sm" onClick={onClose} />
          {!result && (
            <WriteButton
              label={submitting ? 'Releasing...' : `Release ${itemIds.length} Item${itemIds.length !== 1 ? 's' : ''}`}
              variant="primary"
              size="sm"
              disabled={!releaseDate || submitting}
              style={{ background: '#15803D' }}
              onClick={handleSubmit}
            />
          )}
        </div>
      </div>
    </>
  );
}
