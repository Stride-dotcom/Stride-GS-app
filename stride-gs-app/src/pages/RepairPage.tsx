/**
 * RepairPage.tsx — Full-page repair detail view.
 * Route: #/repairs/:repairId
 *
 * Thin wrapper around RepairDetailPanel in `renderAsPage` mode. Fetches the
 * repair via useRepairDetail and passes optimistic patch functions so the
 * panel can reflect writes locally while they propagate. All tabs, handlers,
 * modals, and edit logic live in RepairDetailPanel — page just wires data in.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useRepairDetail } from '../hooks/useRepairDetail';
import { useGoBack } from '../hooks/useGoBack';
import { RepairDetailPanel } from '../components/shared/RepairDetailPanel';
import { theme } from '../styles/theme';
import type { ApiRepair } from '../lib/api';

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

export function RepairPage() {
  const { repairId } = useParams<{ repairId: string }>();
  const navigate = useNavigate();
  // History-aware back for error/onClose paths; `navigate` is kept for
  // forward links (open item from inside the detail panel).
  const goBack = useGoBack('/repairs');
  useAuth();
  const { repair: fetchedRepair, status, error, refetch } = useRepairDetail(repairId);

  const [localRepair, setLocalRepair] = useState<ApiRepair | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // See TaskPage.tsx — guards optimistic state from being clobbered by a
  // stale fetch fired between the GAS save returning and Supabase
  // write-through completing.
  const lastMutationAtRef = useRef<number>(0);
  const OPTIMISTIC_GUARD_MS = 6000;

  useEffect(() => {
    if (!fetchedRepair) return;
    if (saving) return;
    if (Date.now() - lastMutationAtRef.current < OPTIMISTIC_GUARD_MS) return;
    setLocalRepair(fetchedRepair);
  }, [fetchedRepair, saving]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Silent: post-save safety-net refetch should not flash the spinner.
    refreshTimerRef.current = setTimeout(() => { refetch({ silent: true }); }, 2500);
  }, [refetch]);

  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  const handleRepairUpdated = useCallback(() => {
    lastMutationAtRef.current = Date.now();
    scheduleRefresh();
  }, [scheduleRefresh]);

  const applyRepairPatch = useCallback((patchRepairId: string, patch: Partial<ApiRepair>) => {
    setLocalRepair(prev => prev && prev.repairId === patchRepairId ? { ...prev, ...patch } : prev);
    lastMutationAtRef.current = Date.now();
    setSaving(true);
  }, []);

  const mergeRepairPatch = useCallback((patchRepairId: string, patch: Partial<ApiRepair>) => {
    setLocalRepair(prev => prev && prev.repairId === patchRepairId ? { ...prev, ...patch } : prev);
    lastMutationAtRef.current = Date.now();
  }, []);

  const clearRepairPatch = useCallback((_patchRepairId: string) => {
    setSaving(false);
    scheduleRefresh();
  }, [scheduleRefresh]);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading repair{repairId ? ` ${repairId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this repair." actions={<button onClick={goBack} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Repair Not Found" body={`No repair with ID "${repairId}" was found.`} actions={<button onClick={goBack} style={backBtnStyle}>Back to Repairs</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Repair" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={goBack} style={backBtnStyle}>Back to Repairs</button></div>}
      />
    );
  }

  const repair = localRepair ?? fetchedRepair;
  if (!repair) return null;

  return (
    <RepairDetailPanel
      renderAsPage
      repair={repair}
      onClose={goBack}
      onRepairUpdated={handleRepairUpdated}
      onNavigateToItem={(itemId) => navigate(`/inventory/${encodeURIComponent(itemId)}`)}
      applyRepairPatch={applyRepairPatch}
      mergeRepairPatch={mergeRepairPatch}
      clearRepairPatch={clearRepairPatch}
    />
  );
}
