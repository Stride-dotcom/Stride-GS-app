/**
 * WillCallPage.tsx — Full-page will-call detail view.
 * Route: #/will-calls/:wcNumber
 *
 * Thin wrapper around WillCallDetailPanel in `renderAsPage` mode. Fetches the
 * will call via useWillCallDetail and passes optimistic patch functions. All
 * tabs, handlers, modals, and edit logic live in WillCallDetailPanel.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWillCallDetail } from '../hooks/useWillCallDetail';
import { WillCallDetailPanel } from '../components/shared/WillCallDetailPanel';
import { theme } from '../styles/theme';
import { fetchWillCallByIdFromSupabase } from '../lib/supabaseQueries';
import type { ApiWillCall } from '../lib/api';

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: `${theme.spacing.sm} ${theme.spacing.lg}`, borderRadius: theme.radii.lg,
  border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.medium,
  cursor: 'pointer', fontFamily: 'inherit',
};

function PageState({ icon: Icon, color, title, body, actions }: {
  icon: React.ComponentType<{ size: number; color?: string }>;
  color: string; title: string; body: string; actions?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 32, textAlign: 'center' }}>
      <Icon size={48} color={color} />
      <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>{title}</div>
      <div style={{ fontSize: 14, color: theme.colors.textMuted, maxWidth: 400 }}>{body}</div>
      {actions}
    </div>
  );
}

export function WillCallPage() {
  const { wcNumber } = useParams<{ wcNumber: string }>();
  const navigate = useNavigate();
  useAuth();
  const { wc: fetchedWc, status, error, refetch } = useWillCallDetail(wcNumber);

  const [localWc, setLocalWc] = useState<ApiWillCall | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fetchedWc && !saving) setLocalWc(fetchedWc);
  }, [fetchedWc, saving]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { refetch(); }, 1500);
  }, [refetch]);

  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  const handleWcUpdated = useCallback(() => {
    setSaving(true);
    setTimeout(async () => {
      if (wcNumber) {
        const fresh = await fetchWillCallByIdFromSupabase(wcNumber, {});
        if (fresh) setLocalWc(fresh);
      }
      setSaving(false);
      scheduleRefresh();
    }, 800);
  }, [wcNumber, scheduleRefresh]);

  const applyWcPatch = useCallback((patchWcNumber: string, patch: Partial<ApiWillCall>) => {
    setLocalWc(prev => prev && prev.wcNumber === patchWcNumber ? { ...prev, ...patch } : prev);
    setSaving(true);
  }, []);

  const clearWcPatch = useCallback((_patchWcNumber: string) => {
    setSaving(false);
    scheduleRefresh();
  }, [scheduleRefresh]);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading will call{wcNumber ? ` ${wcNumber}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this will call." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Will Call Not Found" body={`No will call "${wcNumber}" was found.`} actions={<button onClick={() => navigate('/will-calls')} style={backBtnStyle}>Back to Will Calls</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Will Call" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/will-calls')} style={backBtnStyle}>Back to Will Calls</button></div>}
      />
    );
  }

  const wc = localWc ?? fetchedWc;
  if (!wc) return null;

  return (
    <WillCallDetailPanel
      renderAsPage
      wc={wc}
      onClose={() => navigate(-1)}
      onWcUpdated={handleWcUpdated}
      onNavigateToWc={(n) => navigate(`/will-calls/${encodeURIComponent(n)}`)}
      applyWcPatch={applyWcPatch as unknown as (wcNumber: string, patch: Record<string, unknown>) => void}
      clearWcPatch={clearWcPatch}
    />
  );
}
