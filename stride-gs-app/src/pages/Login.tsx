/**
 * Login — Email + password authentication.
 *
 * Single form for all roles (staff, client, admin).
 * Forgot password toggles to reset-email view.
 * No role tabs, no magic links, no Google OAuth.
 */
import React, { useState, useEffect } from 'react';
import { LogIn, Mail, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { LoginPhase } from '../contexts/AuthContext';
import { theme } from '../styles/theme';

type View = 'login' | 'forgot' | 'forgot-sent';

export function Login() {
  const { signInWithPassword, forgotPassword, loginPhase, loginPhaseError, user } = useAuth();

  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Track auth phase locally so we keep showing progress after Supabase succeeds
  const [localPhase, setLocalPhase] = useState<LoginPhase>('idle');

  // Sync context loginPhase into localPhase
  useEffect(() => {
    if (loginPhase === 'verifying' || loginPhase === 'success') {
      setLocalPhase(loginPhase);
    }
    if (loginPhase === 'idle' && loginPhaseError) {
      // Gate 2 failed — reset form with error
      setLocalPhase('idle');
      setLoading(false);
      setError(loginPhaseError);
    }
  }, [loginPhase, loginPhaseError]);

  // Derive overall busy state: either local Supabase call or context verification
  const busy = loading || localPhase === 'verifying' || localPhase === 'success';

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Enter your email address.'); return; }
    if (!password.trim()) { setError('Enter your password.'); return; }

    setLoading(true);
    setError('');
    const result = await signInWithPassword(email.trim(), password);

    if (result.error) {
      setLoading(false);
      setError(result.error);
    }
    // On success: keep loading=true — loginPhase will take over via useEffect
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Enter your email address.'); return; }

    setLoading(true);
    setError('');
    const result = await forgotPassword(email.trim());
    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setView('forgot-sent');
    }
  };

  // ─── Styles ─────────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', fontSize: 14,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 10, outline: 'none', fontFamily: 'inherit',
    background: '#fff', transition: 'border-color 0.15s', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, color: theme.colors.textSecondary,
    display: 'block', marginBottom: 5,
  };

  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '12px', fontSize: 14, fontWeight: 600,
    border: 'none', borderRadius: 10, background: busy ? '#ccc' : theme.colors.orange,
    color: '#fff', cursor: busy ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 8, transition: 'background 0.15s',
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

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
            Stride Logistics
          </h1>
          <p style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 4 }}>
            Warehouse Management System
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: 16, border: `1px solid ${theme.colors.border}`,
          padding: 32, boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>

          {/* ── Sign In View ── */}
          {view === 'login' && (localPhase === 'verifying' ? (
            /* Phase 2: Verifying account via API */
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <span style={{
                display: 'inline-block', width: 32, height: 32,
                border: '3px solid #E5E7EB', borderTopColor: theme.colors.orange,
                borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                marginBottom: 20,
              }} />
              <p style={{ fontSize: 15, fontWeight: 500, color: theme.colors.text, marginBottom: 4 }}>
                Verifying your account...
              </p>
              <p style={{ fontSize: 12, color: theme.colors.textMuted }}>
                Just a moment
              </p>
            </div>
          ) : localPhase === 'success' ? (
            /* Phase 3: Success — brief welcome before navigation */
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: '#F0FDF4', border: '1px solid #BBF7D0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <CheckCircle2 size={24} style={{ color: '#16A34A' }} />
              </div>
              <p style={{ fontSize: 17, fontWeight: 600, color: theme.colors.text, marginBottom: 4 }}>
                Welcome back{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}!
              </p>
              <p style={{ fontSize: 12, color: theme.colors.textMuted }}>
                Redirecting to dashboard...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSignIn}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={15} style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', color: theme.colors.textMuted, pointerEvents: 'none',
                  }} />
                  <input
                    type="email" value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    placeholder="your@email.com"
                    style={{ ...inputStyle, paddingLeft: 36 }}
                    autoFocus disabled={busy}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <KeyRound size={15} style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', color: theme.colors.textMuted, pointerEvents: 'none',
                  }} />
                  <input
                    type="password" value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    placeholder="Enter password"
                    style={{ ...inputStyle, paddingLeft: 36 }}
                    disabled={busy}
                  />
                </div>
              </div>

              {/* Forgot password link */}
              <div style={{ textAlign: 'right', marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => { setView('forgot'); setError(''); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 12, color: theme.colors.primary, fontFamily: 'inherit',
                    padding: 0,
                  }}
                >
                  Forgot password?
                </button>
              </div>

              {error && (
                <div style={{
                  padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA',
                  borderRadius: 8, fontSize: 12, color: '#DC2626', marginBottom: 16,
                }}>
                  {error}
                </div>
              )}

              <button type="submit" style={btnStyle} disabled={busy}>
                {busy ? (
                  <span style={{ display: 'inline-block', width: 16, height: 16,
                    border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                    borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                ) : (
                  <LogIn size={16} />
                )}
                {busy ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          ))}

          {/* ── Forgot Password View ── */}
          {view === 'forgot' && (
            <form onSubmit={handleForgotPassword}>
              <button
                type="button"
                onClick={() => { setView('login'); setError(''); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: theme.colors.textSecondary, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginBottom: 20,
                }}
              >
                <ArrowLeft size={13} /> Back to sign in
              </button>

              <h2 style={{ fontSize: 17, fontWeight: 600, color: theme.colors.text, marginBottom: 6 }}>
                Reset your password
              </h2>
              <p style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 20, lineHeight: 1.5 }}>
                Enter your email and we'll send you a password reset link.
              </p>

              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={15} style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', color: theme.colors.textMuted, pointerEvents: 'none',
                  }} />
                  <input
                    type="email" value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    placeholder="your@email.com"
                    style={{ ...inputStyle, paddingLeft: 36 }}
                    autoFocus disabled={loading}
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

              <button type="submit" style={btnStyle} disabled={loading}>
                {loading ? (
                  <span style={{ display: 'inline-block', width: 16, height: 16,
                    border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                    borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                ) : (
                  <Mail size={16} />
                )}
                {loading ? 'Sending…' : 'Send Reset Email'}
              </button>
            </form>
          )}

          {/* ── Reset Email Sent ── */}
          {view === 'forgot-sent' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: '#F0FDF4', border: '1px solid #BBF7D0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <Mail size={22} style={{ color: '#16A34A' }} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: theme.colors.text, marginBottom: 8 }}>
                Check your email
              </h2>
              <p style={{ fontSize: 13, color: theme.colors.textMuted, lineHeight: 1.6, marginBottom: 24 }}>
                A password reset link has been sent to <strong>{email}</strong>.
                Click the link in the email to set a new password.
              </p>
              <button
                type="button"
                onClick={() => { setView('login'); setError(''); }}
                style={{
                  background: 'none', border: `1px solid ${theme.colors.border}`,
                  cursor: 'pointer', fontSize: 13, color: theme.colors.textSecondary,
                  fontFamily: 'inherit', padding: '9px 20px', borderRadius: 8,
                }}
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 11, color: theme.colors.textMuted, marginTop: 24 }}>
          Stride Logistics &middot; Kent, WA &middot; Est. 2007
        </p>
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
