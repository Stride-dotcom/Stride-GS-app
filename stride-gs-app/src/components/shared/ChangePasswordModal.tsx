import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useAuth } from '../../contexts/AuthContext';
import { BtnSpinner } from '../ui/BtnSpinner';
import { ProcessingOverlay } from './ProcessingOverlay';

interface ChangePasswordModalProps {
  onClose: () => void;
}

export function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const { changePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError('');
    if (!newPassword || !confirmPassword) {
      setError('Both fields are required.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const result = await changePassword(newPassword);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      setTimeout(onClose, 1800);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div style={{
        background: '#fff',
        borderRadius: theme.radii.xl,
        boxShadow: theme.shadows.lg,
        width: 400,
        padding: '28px 28px 24px',
        fontFamily: theme.typography.fontFamily,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <ProcessingOverlay
          visible={loading}
          message="Hold tight — saving your password"
          subMessage="Updating your account."
        />
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: theme.colors.orangeLight,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <KeyRound size={16} color={theme.colors.orange} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: theme.colors.textPrimary }}>
              Change Password
            </div>
            <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 1 }}>
              Set a new password for your account
            </div>
          </div>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', padding: 4, borderRadius: theme.radii.sm,
            color: theme.colors.textSecondary,
          }}>
            <X size={16} />
          </button>
        </div>

        {success ? (
          <div style={{
            background: '#F0FDF4', border: '1px solid #86EFAC',
            borderRadius: theme.radii.md, padding: '12px 14px',
            color: '#166534', fontSize: 13, fontWeight: 500, textAlign: 'center',
          }}>
            Password updated successfully!
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{
                display: 'block', fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
                color: theme.colors.orange, marginBottom: 5, letterSpacing: '0.03em',
              }}>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md, padding: '8px 10px',
                  fontSize: 13, fontFamily: theme.typography.fontFamily,
                  outline: 'none',
                }}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{
                display: 'block', fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
                color: theme.colors.orange, marginBottom: 5, letterSpacing: '0.03em',
              }}>Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md, padding: '8px 10px',
                  fontSize: 13, fontFamily: theme.typography.fontFamily,
                  outline: 'none',
                }}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            {error && (
              <div style={{
                background: '#FEF2F2', border: '1px solid #FECACA',
                borderRadius: theme.radii.md, padding: '8px 12px',
                color: '#B91C1C', fontSize: 12, marginBottom: 14,
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} disabled={loading} style={{
                background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: theme.radii.md,
                padding: '8px 16px', fontSize: 13, fontWeight: 500,
                fontFamily: theme.typography.fontFamily, cursor: 'pointer',
                color: theme.colors.textPrimary,
              }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={loading} style={{
                background: loading ? theme.colors.textSecondary : theme.colors.orange,
                border: 'none', borderRadius: theme.radii.md,
                padding: '8px 18px', fontSize: 13, fontWeight: 600,
                fontFamily: theme.typography.fontFamily, cursor: loading ? 'progress' : 'pointer',
                color: '#fff',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                {loading && <BtnSpinner size={12} color="#fff" />}
                {loading ? 'Saving…' : 'Save Password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
