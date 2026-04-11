import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * ConfirmDialog — reusable yes/no modal for destructive or expensive actions.
 *
 * Replaces inline window.confirm() and one-off custom modals. Used across
 * bulk action toolbars for Cancel/Send Quote/Release/etc. confirmation.
 *
 * v38.9.0 / Bulk Action Toolbar work.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  processing?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  processing = false,
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmBg = variant === 'danger' ? '#DC2626' : theme.colors.orange;
  const confirmHover = variant === 'danger' ? '#B91C1C' : theme.colors.primaryHover;

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
          overflow: 'hidden',
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
            {variant === 'danger' && <AlertTriangle size={16} color="#DC2626" />}
            <span style={{ fontWeight: 700, fontSize: 15, color: theme.colors.text }}>{title}</span>
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
              opacity: processing ? 0.4 : 1,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px', fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.55 }}>
          {message}
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
              opacity: processing ? 0.5 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => !processing && onConfirm()}
            disabled={processing}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 700,
              border: 'none',
              borderRadius: 8,
              background: processing ? confirmHover : confirmBg,
              color: '#fff',
              cursor: processing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 100,
              justifyContent: 'center',
              opacity: processing ? 0.8 : 1,
            }}
          >
            {processing && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {processing ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
