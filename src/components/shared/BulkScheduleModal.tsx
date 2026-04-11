import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Loader2, X } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * BulkScheduleModal — date picker for the Will Calls bulk Schedule action.
 *
 * One chosen date applies to every selected Will Call. The backend auto-promotes
 * Status from Pending → Scheduled when estimatedPickupDate is set (existing
 * handleUpdateWillCall_ behavior).
 *
 * Confirm disabled until a date is picked. Past dates are allowed (user may
 * legitimately backdate a scheduled pickup).
 *
 * v38.9.0 / Bulk Action Toolbar work.
 */

export interface BulkScheduleModalProps {
  open: boolean;
  wcCount: number;
  onCancel: () => void;
  onConfirm: (isoDate: string) => void | Promise<void>;
  processing?: boolean;
}

export function BulkScheduleModal({ open, wcCount, onCancel, onConfirm, processing = false }: BulkScheduleModalProps) {
  const [date, setDate] = useState('');

  const canSubmit = !!date && !processing;

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
      onClick={e => {
        if (e.target === e.currentTarget && !processing) onCancel();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          width: '100%',
          maxWidth: 460,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          fontFamily: 'inherit',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={16} color={theme.colors.orange} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>
              Schedule {wcCount} will call{wcCount === 1 ? '' : 's'}
            </span>
          </div>
          <button
            onClick={onCancel}
            disabled={processing}
            style={{
              background: 'none',
              border: 'none',
              cursor: processing ? 'not-allowed' : 'pointer',
              color: theme.colors.textMuted,
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '18px' }}>
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 600,
              color: theme.colors.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.3,
              marginBottom: 6,
            }}
          >
            Estimated Pickup Date
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={processing}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 14,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 8,
              fontFamily: 'inherit',
              background: processing ? theme.colors.bgSubtle : '#fff',
            }}
          />
          <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, lineHeight: 1.5 }}>
            This date applies to every selected will call. Already-scheduled/released/cancelled will
            calls will be skipped with a reason.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: `1px solid ${theme.colors.border}`,
            background: theme.colors.bgSubtle,
          }}
        >
          <button
            onClick={onCancel}
            disabled={processing}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 8,
              background: '#fff',
              color: theme.colors.textSecondary,
              cursor: processing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onConfirm(date)}
            disabled={!canSubmit}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 700,
              border: 'none',
              borderRadius: 8,
              background: canSubmit ? theme.colors.orange : theme.colors.bgMuted,
              color: canSubmit ? '#fff' : theme.colors.textMuted,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 100,
              justifyContent: 'center',
            }}
          >
            {processing && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {processing ? 'Working…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
