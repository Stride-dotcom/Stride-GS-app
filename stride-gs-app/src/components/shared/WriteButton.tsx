import React, { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * Phase 7A Safety Net — WriteButton
 *
 * A button that:
 * 1. Prevents duplicate clicks (disabled while executing)
 * 2. Shows loading spinner during async execution
 * 3. Shows success/error state briefly after completion
 * 4. Optionally shows a tooltip when disabled (blocked-action reason)
 *
 * Use this for ALL write/destructive actions in the app.
 */

interface Props {
  /** Button label */
  label: string;
  /** Async function to execute on click */
  onClick: () => Promise<void> | void;
  /** If provided, button is disabled and this tooltip shows on hover */
  blockedReason?: string | null;
  /** Visual style */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Icon to show before label */
  icon?: React.ReactNode;
  /** Whether button is disabled for reasons other than blocked action */
  disabled?: boolean;
  /** Additional inline styles */
  style?: React.CSSProperties;
  /** Size variant */
  size?: 'sm' | 'md';
}

export function WriteButton({
  label, onClick, blockedReason, variant = 'secondary', icon,
  disabled = false, style, size = 'md',
}: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showTooltip, setShowTooltip] = useState(false);
  const inFlight = useRef(false);

  const isDisabled = disabled || !!blockedReason || state === 'loading';

  const handleClick = async () => {
    if (inFlight.current || isDisabled) return;
    inFlight.current = true;
    setState('loading');

    try {
      await onClick();
      setState('success');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    } finally {
      inFlight.current = false;
    }
  };

  const colors = {
    primary: { bg: theme.colors.orange, hover: theme.colors.primaryHover, text: '#fff', border: 'none' },
    secondary: { bg: '#fff', hover: theme.colors.bgSubtle, text: theme.colors.textSecondary, border: `1px solid ${theme.colors.border}` },
    danger: { bg: '#DC2626', hover: '#B91C1C', text: '#fff', border: 'none' },
    ghost: { bg: 'transparent', hover: 'rgba(255,255,255,0.15)', text: '#fff', border: '1px solid rgba(255,255,255,0.2)' },
  };
  const c = colors[variant];
  const pad = size === 'sm' ? '5px 12px' : '7px 16px';
  const fs = size === 'sm' ? 11 : 12;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => blockedReason && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}>
      <button onClick={handleClick} disabled={isDisabled} style={{
        padding: pad, fontSize: fs, fontWeight: 600,
        border: c.border, borderRadius: 8,
        background: state === 'success' ? '#15803D' : state === 'error' ? '#DC2626' : isDisabled ? theme.colors.bgMuted : c.bg,
        color: state === 'success' || state === 'error' ? '#fff' : isDisabled ? theme.colors.textMuted : c.text,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        opacity: isDisabled && !blockedReason ? 0.5 : 1,
        transition: 'all 0.2s ease', minWidth: 80,
        ...style,
      }}>
        {state === 'loading' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> :
         state === 'success' ? '✓' :
         state === 'error' ? '✗' :
         icon}
        {state === 'loading' ? 'Processing...' :
         state === 'success' ? 'Done' :
         state === 'error' ? 'Failed' :
         label}
      </button>
      {showTooltip && blockedReason && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: '#1A1A1A', color: '#fff', padding: '6px 12px', borderRadius: 8,
          fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', pointerEvents: 'none',
          fontFamily: theme.typography.fontFamily,
        }}>
          {blockedReason}
          <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid #1A1A1A' }} />
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
