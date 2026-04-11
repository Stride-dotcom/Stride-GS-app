import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { UserCog, Loader2, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import { AutocompleteSelect } from './AutocompleteSelect';
import { useUsers } from '../../hooks/useUsers';

/**
 * BulkReassignModal — user picker for the Tasks bulk Reassign action.
 *
 * Confirm button stays disabled until a valid, non-empty assignee is picked.
 * Blank strings are rejected client-side AND server-side.
 *
 * v38.9.0 / Bulk Action Toolbar work.
 */

export interface BulkReassignModalProps {
  open: boolean;
  taskCount: number;
  onCancel: () => void;
  onConfirm: (assignedTo: string) => void | Promise<void>;
  processing?: boolean;
}

export function BulkReassignModal({ open, taskCount, onCancel, onConfirm, processing = false }: BulkReassignModalProps) {
  const { users, loading } = useUsers();
  const [assignee, setAssignee] = useState('');

  // Show staff + admin only (these are who operate on tasks). Active users.
  const options = useMemo(
    () =>
      users
        .filter(u => u.active && (u.role === 'admin' || u.role === 'staff'))
        .map(u => ({ value: u.email, label: u.email })),
    [users]
  );

  const canSubmit = !!assignee.trim() && !processing;

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
        {/* Header */}
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
            <UserCog size={16} color={theme.colors.orange} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>
              Reassign {taskCount} task{taskCount === 1 ? '' : 's'}
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

        {/* Body */}
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
            Assign to
          </label>
          <AutocompleteSelect
            options={options}
            value={assignee}
            onChange={setAssignee}
            placeholder={loading ? 'Loading users…' : 'Select a user…'}
            disabled={processing || loading}
          />
          <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 8, lineHeight: 1.5 }}>
            Only staff and admin users are shown. Tasks already assigned to this user will be rewritten
            (no-op) and counted as succeeded.
          </div>
        </div>

        {/* Footer */}
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
            onClick={() => canSubmit && onConfirm(assignee.trim())}
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
            {processing ? 'Working…' : 'Reassign'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
