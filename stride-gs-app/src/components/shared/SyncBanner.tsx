/**
 * SyncBanner — Prominent sync indicator for data pages.
 * Shows a full-width animated banner during refetch with client name,
 * elapsed timer, and a pulsing animation. Auto-dismisses with a brief
 * success flash when data loads.
 *
 * Usage:
 *   <SyncBanner syncing={refreshing} label="Needs ID Holding Account" />
 */
import { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { theme } from '../../styles/theme';

interface Props {
  /** True while the refetch is in progress */
  syncing: boolean;
  /** What's being synced — typically the client name or "all clients" */
  label?: string;
}

export function SyncBanner({ syncing, label }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [wasSyncing, setWasSyncing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start/stop elapsed timer
  useEffect(() => {
    if (syncing) {
      setElapsed(0);
      setWasSyncing(true);
      setShowSuccess(false);
      timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      // Show success flash when sync completes (only if it was actually syncing)
      if (wasSyncing) {
        setShowSuccess(true);
        setWasSyncing(false);
        const t = setTimeout(() => setShowSuccess(false), 3000);
        return () => clearTimeout(t);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [syncing]);

  // Format elapsed time as M:SS
  const formatTime = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
  };

  if (!syncing && !showSuccess) return null;

  if (showSuccess) {
    return (
      <div style={{
        padding: '10px 16px',
        background: '#F0FDF4',
        border: '1px solid #BBF7D0',
        borderRadius: 10,
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        fontWeight: 600,
        color: '#15803D',
        animation: 'fadeIn 0.3s ease',
      }}>
        <CheckCircle2 size={16} />
        Data refreshed{label ? ` — ${label}` : ''}
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 16px',
      background: 'linear-gradient(90deg, #FFF7ED 0%, #FFEDD5 50%, #FFF7ED 100%)',
      backgroundSize: '200% 100%',
      animation: 'syncPulse 2s ease-in-out infinite',
      border: `1px solid ${theme.colors.orange}33`,
      borderRadius: 10,
      marginBottom: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 size={18} color={theme.colors.orange} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.textPrimary }}>
            Syncing{label ? ` ${label}` : ''}...
          </div>
          <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 1 }}>
            Data will refresh automatically when complete
          </div>
        </div>
      </div>
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: theme.colors.orange,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 40,
        textAlign: 'right',
      }}>
        {formatTime(elapsed)}
      </div>
      <style>{`
        @keyframes syncPulse {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
