import { theme } from '../../styles/theme';

interface Props {
  visible: boolean;
  message?: string;
}

export function ProcessingOverlay({ visible, message = 'Processing...' }: Props) {
  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      background: 'rgba(255, 255, 255, 0.88)',
      backdropFilter: 'blur(2px)',
      cursor: 'wait',
    }}
    onClick={e => e.stopPropagation()}
    onMouseDown={e => e.stopPropagation()}
    >
      <div style={{
        width: 32,
        height: 32,
        border: `3px solid ${theme.colors.border}`,
        borderTopColor: theme.colors.orange,
        borderRadius: '50%',
        animation: 'processingOverlaySpin 0.8s linear infinite',
      }} />
      <span style={{
        fontSize: 14,
        fontWeight: 600,
        color: theme.colors.text,
        letterSpacing: '0.01em',
      }}>
        {message}
      </span>
      <style>{`@keyframes processingOverlaySpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
