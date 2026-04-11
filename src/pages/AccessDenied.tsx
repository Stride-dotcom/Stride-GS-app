/**
 * AccessDenied — Shown when Supabase auth succeeds but the user is not in
 * the CB Users tab or has Active=FALSE.
 */
import { ShieldOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../styles/theme';

interface AccessDeniedProps {
  reason?: string | null;
}

export function AccessDenied({ reason }: AccessDeniedProps) {
  const { signOut } = useAuth();

  const defaultReason = 'Your account does not have access to this system.';

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F2F2F2', fontFamily: theme.typography.fontFamily,
    }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 20px', textAlign: 'center' }}>

        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: '#FEF2F2', border: '1px solid #FECACA',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <ShieldOff size={28} style={{ color: '#DC2626' }} />
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: theme.colors.text, marginBottom: 12 }}>
          Access Denied
        </h1>

        <p style={{
          fontSize: 14, color: theme.colors.textMuted, lineHeight: 1.6, marginBottom: 28,
        }}>
          {reason ?? defaultReason}
          <br /><br />
          Contact your Stride administrator to request access.
        </p>

        <button
          onClick={signOut}
          style={{
            padding: '10px 24px', fontSize: 13, fontWeight: 600,
            border: `1px solid ${theme.colors.border}`, borderRadius: 10,
            background: '#fff', color: theme.colors.textSecondary,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Sign Out
        </button>

        <p style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 32 }}>
          Stride Logistics &middot; Kent, WA
        </p>
      </div>
    </div>
  );
}
