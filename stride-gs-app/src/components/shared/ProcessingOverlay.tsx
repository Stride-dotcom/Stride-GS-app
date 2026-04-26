import { theme } from '../../styles/theme';

interface Props {
  visible: boolean;
  /** Primary, prominent message. Defaults to "Processing…". */
  message?: string;
  /** Optional secondary line (smaller) — use to reassure the user, e.g. "You can leave this open." */
  subMessage?: string;
  /**
   * Visual emphasis. Default ('strong') uses a large spinner + ring + animated dots,
   * intended for slow operations (creates, sends, deploys). 'subtle' is a smaller
   * spinner for quick saves where the dramatic ring would feel heavy-handed.
   */
  emphasis?: 'strong' | 'subtle';
  /**
   * If true, overlay spans the whole viewport instead of its closest positioned
   * ancestor. Use sparingly — most callers should leave this false and place
   * the overlay inside a modal/panel with `position: relative`.
   */
  fullscreen?: boolean;
}

const KEYFRAMES_ID = 'stride-processing-overlay-kf';
if (typeof document !== 'undefined' && !document.getElementById(KEYFRAMES_ID)) {
  const s = document.createElement('style');
  s.id = KEYFRAMES_ID;
  s.textContent = `
@keyframes processingOverlaySpin { to { transform: rotate(360deg); } }
@keyframes processingOverlayFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes processingOverlayPulseRing {
  0% { transform: scale(0.8); opacity: 0.7; }
  100% { transform: scale(1.6); opacity: 0; }
}
@keyframes processingOverlayDot { 0%,80%,100% { opacity: 0.2; } 40% { opacity: 1; } }
`;
  document.head.appendChild(s);
}

export function ProcessingOverlay({
  visible,
  message = 'Processing…',
  subMessage,
  emphasis = 'strong',
  fullscreen = false,
}: Props) {
  if (!visible) return null;

  const isStrong = emphasis === 'strong';
  const spinnerSize = isStrong ? 48 : 28;
  const ringBorder = isStrong ? 4 : 3;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: fullscreen ? 'fixed' : 'absolute',
        inset: 0,
        // 50 keeps the overlay above content inside its stacking context but
        // below toasts/banners. When fullscreen is true the overlay is
        // intentionally rendered at the top of the page stacking context, so
        // its low z-index is fine — there's nothing to compete with except
        // the modal that owns it.
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isStrong ? 16 : 12,
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        cursor: 'progress',
        animation: 'processingOverlayFadeIn 180ms ease-out',
        padding: '24px',
        textAlign: 'center',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ position: 'relative', width: spinnerSize, height: spinnerSize }}>
        {isStrong && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `2px solid ${theme.colors.orange}`,
              animation: 'processingOverlayPulseRing 1.4s ease-out infinite',
            }}
          />
        )}
        <div
          aria-hidden="true"
          style={{
            width: spinnerSize,
            height: spinnerSize,
            border: `${ringBorder}px solid ${theme.colors.border}`,
            borderTopColor: theme.colors.orange,
            borderRadius: '50%',
            animation: 'processingOverlaySpin 0.8s linear infinite',
          }}
        />
      </div>
      <div
        style={{
          fontSize: isStrong ? 15 : 14,
          fontWeight: 600,
          color: theme.colors.text,
          letterSpacing: '0.01em',
          maxWidth: 360,
          fontFamily: theme.typography.fontFamily,
        }}
      >
        {message}
        <span aria-hidden="true">
          <span style={{ display: 'inline-block', animation: 'processingOverlayDot 1.2s infinite both' }}>.</span>
          <span style={{ display: 'inline-block', animation: 'processingOverlayDot 1.2s infinite both', animationDelay: '0.2s' }}>.</span>
          <span style={{ display: 'inline-block', animation: 'processingOverlayDot 1.2s infinite both', animationDelay: '0.4s' }}>.</span>
        </span>
      </div>
      {subMessage && (
        <div
          style={{
            fontSize: 12,
            color: theme.colors.textMuted,
            maxWidth: 340,
            fontFamily: theme.typography.fontFamily,
            lineHeight: 1.5,
          }}
        >
          {subMessage}
        </div>
      )}
    </div>
  );
}
