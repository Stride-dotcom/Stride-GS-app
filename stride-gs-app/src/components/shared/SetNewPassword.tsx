/**
 * SetNewPassword — Shown after user clicks a Supabase password reset link.
 * AuthContext sets passwordRecoveryMode=true after the PASSWORD_RECOVERY event.
 * On success, Supabase fires USER_UPDATED → handleSession → user is logged in.
 */
import React, { useState } from 'react';
import { KeyRound, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { theme } from '../../styles/theme';

export function SetNewPassword() {
  const { resetPassword, recoveryExpired, clearRecoveryExpired } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) { setError('Enter a new password.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setLoading(true);
    const result = await resetPassword(password);
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      // AuthContext will fire USER_UPDATED → handleSession → authState = authenticated
      // App.tsx will re-render, hiding this component automatically
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px 11px 36px', fontSize: 14,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 10, outline: 'none', fontFamily: 'inherit',
    background: '#fff', boxSizing: 'border-box',
  };

  const pageWrap: React.CSSProperties = {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#F2F2F2', fontFamily: theme.typography.fontFamily,
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 16, border: `1px solid ${theme.colors.border}`,
    padding: 32, boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  };

  if (recoveryExpired) {
    return (
      <div style={pageWrap}>
        <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <img src="/stride-logo.png" alt="Stride"
              style={{ width: 56, height: 56, objectFit: 'contain', marginBottom: 16 }} />
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: theme.colors.text }}>
              Link Expired
            </h1>
          </div>
          <div style={{ ...cardStyle, textAlign: 'center' }}>
            <AlertCircle size={40} style={{ color: '#DC2626', marginBottom: 16 }} />
            <h2 style={{ fontSize: 17, fontWeight: 600, color: theme.colors.text, marginBottom: 8 }}>
              This reset link has expired
            </h2>
            <p style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 24 }}>
              Password reset links expire after 24 hours. Please request a new link to reset your password.
            </p>
            <button
              onClick={clearRecoveryExpired}
              style={{
                width: '100%', padding: '12px', fontSize: 14, fontWeight: 600,
                border: 'none', borderRadius: 10, background: theme.colors.orange,
                color: '#fff', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10,
              }}
            >
              Request new link
            </button>
            <button
              onClick={clearRecoveryExpired}
              style={{
                width: '100%', padding: '10px', fontSize: 13, fontWeight: 500,
                border: `1px solid ${theme.colors.border}`, borderRadius: 10,
                background: 'transparent', color: theme.colors.textSecondary,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Return to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F2F2F2', fontFamily: theme.typography.fontFamily,
    }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <img src="/stride-logo.png" alt="Stride"
            style={{ width: 56, height: 56, objectFit: 'contain', marginBottom: 16 }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: theme.colors.text }}>
            Set New Password
          </h1>
          <p style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 4 }}>
            Choose a strong password for your account.
          </p>
        </div>

        <div style={{
          background: '#fff', borderRadius: 16, border: `1px solid ${theme.colors.border}`,
          padding: 32, boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          {!success ? (
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: theme.colors.textSecondary, display: 'block', marginBottom: 5 }}>
                  New Password
                </label>
                <div style={{ position: 'relative' }}>
                  <KeyRound size={15} style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', color: theme.colors.textMuted, pointerEvents: 'none',
                  }} />
                  <input
                    type="password" value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    placeholder="At least 8 characters"
                    style={inputStyle} autoFocus disabled={loading}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: theme.colors.textSecondary, display: 'block', marginBottom: 5 }}>
                  Confirm Password
                </label>
                <div style={{ position: 'relative' }}>
                  <KeyRound size={15} style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', color: theme.colors.textMuted, pointerEvents: 'none',
                  }} />
                  <input
                    type="password" value={confirm}
                    onChange={e => { setConfirm(e.target.value); setError(''); }}
                    placeholder="Repeat password"
                    style={inputStyle} disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <div style={{
                  padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA',
                  borderRadius: 8, fontSize: 12, color: '#DC2626', marginBottom: 16,
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 600,
                  border: 'none', borderRadius: 10,
                  background: loading ? '#ccc' : theme.colors.orange,
                  color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 8,
                }}
              >
                {loading ? (
                  <span style={{
                    display: 'inline-block', width: 16, height: 16,
                    border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                    borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                  }} />
                ) : (
                  <KeyRound size={16} />
                )}
                {loading ? 'Saving…' : 'Set Password'}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <CheckCircle size={40} style={{ color: '#16A34A', marginBottom: 16 }} />
              <h2 style={{ fontSize: 17, fontWeight: 600, color: theme.colors.text, marginBottom: 8 }}>
                Password updated!
              </h2>
              <p style={{ fontSize: 13, color: theme.colors.textMuted }}>
                Signing you in…
              </p>
            </div>
          )}
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
