/**
 * QBOConnect — QuickBooks Online connection card for Settings → Integrations.
 *
 * Shows connection status, allows admin to connect/disconnect QBO.
 * OAuth flow opens a popup; tokens are server-side only.
 */
import React, { useState } from 'react';
import { BookOpen, CheckCircle2, XCircle, Loader2, RefreshCw, Unlink, Database } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from '../shared/WriteButton';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { useQBO } from '../../hooks/useQBO';
import { apiPost } from '../../lib/api';

const card: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${theme.colors.border}`,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 12,
};

export function QBOConnect() {
  const { connected, companyName, loading, error, refreshStatus, startAuth, disconnect } = useQBO();
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<{ results: string[] } | null>(null);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    await disconnect();
    setDisconnecting(false);
    setShowDisconnect(false);
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: connected ? '#F0FDF4' : theme.colors.orangeLight,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BookOpen size={16} color={connected ? '#16A34A' : theme.colors.orange} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={sectionTitle}>QuickBooks Online</div>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: -8 }}>
            Push invoices directly to QBO — auto-creates customers and sub-jobs
          </div>
        </div>
        {/* Status badge */}
        <div style={{
          padding: '4px 10px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 600,
          background: connected ? '#F0FDF4' : '#FEF2F2',
          color: connected ? '#16A34A' : '#DC2626',
          border: `1px solid ${connected ? '#BBF7D0' : '#FECACA'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          {connected ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {connected ? 'Connected' : 'Not Connected'}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 8,
          background: '#FEF2F2', border: '1px solid #FECACA',
          fontSize: 12, color: '#DC2626',
        }}>
          {error}
        </div>
      )}

      {connected ? (
        <>
          {/* Connected details */}
          <div style={{
            display: 'flex', gap: 16, padding: '12px 16px',
            background: '#F8FAFC', borderRadius: 8, marginBottom: 12,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Company</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>{companyName || 'Unknown'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={refreshStatus}
              disabled={loading}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 500,
                border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                background: '#fff', cursor: loading ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'inherit', color: theme.colors.textSecondary,
              }}
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
            <button
              onClick={() => setShowDisconnect(true)}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 500,
                border: '1px solid #FECACA', borderRadius: 8,
                background: '#FEF2F2', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'inherit', color: '#DC2626',
              }}
            >
              <Unlink size={13} /> Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Not connected — show connect button + setup */}
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 12 }}>
            Connect your QuickBooks Online account to push invoices directly from the Billing page.
            Customers and sub-jobs are created automatically based on client names and sidemarks.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <WriteButton
              label={loading ? 'Connecting...' : 'Connect to QuickBooks'}
              variant="primary"
              disabled={loading}
              onClick={startAuth}
            />
            <button
              onClick={async () => {
                setSetupLoading(true); setSetupResult(null);
                try {
                  const res = await apiPost<{ success: boolean; results: string[] }>('qboSetupHeaders', {});
                  if (res.ok && res.data) setSetupResult({ results: res.data.results });
                  else setSetupResult({ results: [res.error || 'Setup failed'] });
                } catch (e) {
                  setSetupResult({ results: [e instanceof Error ? e.message : String(e)] });
                }
                setSetupLoading(false);
              }}
              disabled={setupLoading}
              style={{
                padding: '8px 14px', fontSize: 12, fontWeight: 500,
                border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                background: '#fff', cursor: setupLoading ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'inherit', color: theme.colors.textSecondary,
              }}
            >
              {setupLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Database size={13} />}
              Setup QBO Headers
            </button>
          </div>
          {setupResult && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', border: `1px solid ${theme.colors.border}`, fontSize: 12 }}>
              {setupResult.results.map((r, i) => (
                <div key={i} style={{ color: r.includes('ERROR') ? '#DC2626' : theme.colors.textSecondary, marginBottom: 2 }}>{r}</div>
              ))}
            </div>
          )}
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      {/* Disconnect confirmation dialog */}
      <ConfirmDialog
        open={showDisconnect}
        title="Disconnect QuickBooks?"
        message="This will remove the QBO connection. You can reconnect at any time. Existing pushed invoices in QBO will not be affected."
        confirmLabel={disconnecting ? 'Disconnecting...' : 'Disconnect'}
        variant="danger"
        processing={disconnecting}
        onConfirm={handleDisconnect}
        onCancel={() => setShowDisconnect(false)}
      />
    </div>
  );
}
