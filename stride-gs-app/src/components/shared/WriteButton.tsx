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
  /** Custom text shown next to spinner while loading (default: "Processing...") */
  loadingText?: string;
  /** Custom text shown briefly on success (default: "Done") */
  successText?: string;
}

export function WriteButton({
  label, onClick, blockedReason, variant = 'secondary', icon,
  disabled = false, style, size = 'md', loadingText, successText,
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
  const pad = size === 'sm' ? '8px 16px' : '12px 24px';
  const fs = size === 'sm' ? 10 : 11;

  // While loading, force the button background to the primary orange and
  // text to white — even on the secondary/ghost variants. This solves two
  // real bugs at once:
  //   1. On secondary buttons, c.text was theme.colors.textSecondary (light
  //      gray), so Loader2's currentColor inherit was barely visible —
  //      users couldn't tell the spinner was even there.
  //   2. The static "white background, light-gray text" treatment didn't
  //      visually shift between idle and loading states, so it wasn't
  //      obvious anything had changed when the user clicked.
  const loadingBg = theme.colors.orange;
  const loadingFg = '#fff';

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => blockedReason && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}>
      <button onClick={handleClick} disabled={isDisabled} style={{
        padding: pad, fontSize: fs, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
        border: state === 'loading' ? 'none' : c.border, borderRadius: 100,
        background: state === 'success' ? '#15803D' : state === 'error' ? '#DC2626' : state === 'loading' ? loadingBg : isDisabled ? theme.colors.bgMuted : c.bg,
        color: state === 'success' || state === 'error' ? '#fff' : state === 'loading' ? loadingFg : isDisabled ? theme.colors.textMuted : c.text,
        cursor: state === 'loading' ? 'progress' : isDisabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        // Loading state stays opaque (so the spinner is visible) and pulses
        // gently — disabled-but-not-loading dims to 0.5 to read as off.
        opacity: state === 'loading' ? 1 : (isDisabled && !blockedReason ? 0.5 : 1),
        animation: state === 'loading' ? 'writeBtnPulse 1.6s ease-in-out infinite' : undefined,
        transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease', minWidth: 80,
        ...style,
      }}>
        {state === 'loading' ? <Loader2 size={size === 'sm' ? 14 : 16} color="#fff" style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> :
         state === 'success' ? '✓' :
         state === 'error' ? '✗' :
         icon}
        {state === 'loading' ? (loadingText || 'Processing…') :
         state === 'success' ? (successText || 'Done') :
         state === 'error' ? 'Failed' :
         label}
      </button>
      {showTooltip && blockedReason && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: '#1A1A1A', color: '#fff', padding: '8px 14px', borderRadius: 100,
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
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes writeBtnPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(232, 93, 45, 0.0); } 50% { box-shadow: 0 0 0 4px rgba(232, 93, 45, 0.18); } }
      `}</style>
    </div>
  );
}
