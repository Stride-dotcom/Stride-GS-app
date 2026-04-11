import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * Phase 7A Safety Net — BatchProgress
 *
 * Shows inline progress during batch operations.
 * Displays: processing count, success count, error count.
 * Used in floating action bars and modal footers.
 */

export type BatchState = 'idle' | 'processing' | 'complete' | 'error';

interface Props {
  state: BatchState;
  /** Total items being processed */
  total: number;
  /** Items processed so far */
  processed: number;
  /** Items that succeeded */
  succeeded: number;
  /** Items that failed */
  failed: number;
  /** Action name (e.g., "Completing tasks") */
  actionLabel: string;
  /** Error message if state is 'error' */
  errorMessage?: string;
}

export function BatchProgress({ state, total, processed, succeeded, failed, actionLabel, errorMessage }: Props) {
  if (state === 'idle') return null;

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px', borderRadius: 8,
      background: state === 'error' ? '#FEF2F2' : state === 'complete' ? '#F0FDF4' : theme.colors.bgSubtle,
      border: `1px solid ${state === 'error' ? '#FECACA' : state === 'complete' ? '#A7F3D0' : theme.colors.border}`,
      fontSize: 12, fontFamily: theme.typography.fontFamily,
    }}>
      {state === 'processing' && (
        <>
          <Loader2 size={14} color={theme.colors.orange} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ color: theme.colors.text, fontWeight: 500 }}>
            {actionLabel}... {processed}/{total} ({pct}%)
          </span>
        </>
      )}
      {state === 'complete' && (
        <>
          <CheckCircle2 size={14} color="#15803D" />
          <span style={{ color: '#15803D', fontWeight: 600 }}>
            {succeeded} of {total} {actionLabel} completed
          </span>
          {failed > 0 && (
            <span style={{ color: '#DC2626', fontWeight: 500, marginLeft: 4 }}>
              · {failed} failed
            </span>
          )}
        </>
      )}
      {state === 'error' && (
        <>
          <XCircle size={14} color="#DC2626" />
          <span style={{ color: '#DC2626', fontWeight: 500 }}>
            {errorMessage || `${actionLabel} failed`}
          </span>
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/**
 * Simple toast notification for action results.
 * Shows temporarily (3s default) then fades out.
 */
interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  visible: boolean;
}

export function ActionToast({ message, type, visible }: ToastProps) {
  if (!visible) return null;

  const colors = {
    success: { bg: '#F0FDF4', border: '#A7F3D0', text: '#15803D', icon: <CheckCircle2 size={14} color="#15803D" /> },
    error: { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626', icon: <XCircle size={14} color="#DC2626" /> },
    warning: { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309', icon: <AlertTriangle size={14} color="#B45309" /> },
    info: { bg: theme.colors.bgSubtle, border: theme.colors.border, text: theme.colors.text, icon: null },
  };
  const c = colors[type];

  return (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 500,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 16px', borderRadius: 10,
      background: c.bg, border: `1px solid ${c.border}`,
      color: c.text, fontSize: 13, fontWeight: 500,
      boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      fontFamily: theme.typography.fontFamily,
      animation: 'slideDown 0.2s ease-out',
    }}>
      {c.icon}
      {message}
      <style>{`@keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
