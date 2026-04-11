/**
 * LoadingScreen — Shown while AuthContext is checking the Supabase session.
 * Displays Stride logo + spinner.
 */
import { theme } from '../../styles/theme';

export function LoadingScreen() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#F2F2F2', fontFamily: theme.typography.fontFamily,
      gap: 20,
    }}>
      <img
        src="/stride-logo.png"
        alt="Stride"
        style={{ width: 52, height: 52, objectFit: 'contain', opacity: 0.85 }}
      />

      {/* Spinner */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        border: `3px solid ${theme.colors.border}`,
        borderTopColor: theme.colors.orange,
        animation: 'ls-spin 0.7s linear infinite',
      }} />

      <p style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 4 }}>
        Signing you in…
      </p>

      <style>{`
        @keyframes ls-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
