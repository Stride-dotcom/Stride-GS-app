/**
 * RepairJobPage.tsx — Standalone repair detail page for direct-by-ID access.
 * Opens in a new tab from Dashboard or via external-link icon on Repairs page.
 * Loads one repair from Supabase (~50ms) with GAS fallback for full data.
 * Full RepairDetailPanel parity.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRepairDetail } from '../hooks/useRepairDetail';
import { RepairDetailPanel } from '../components/shared/RepairDetailPanel';
import { theme } from '../styles/theme';
import { fetchRepairByIdFromSupabase } from '../lib/supabaseQueries';
import type { ApiRepair } from '../lib/api';
import { ArrowLeft, AlertCircle, SearchX, ShieldX, Loader2 } from 'lucide-react';

export function RepairJobPage() {
  const { repairId } = useParams<{ repairId: string }>();
  const navigate = useNavigate();
  useAuth();

  const { repair: fetchedRepair, status, error, refetch } = useRepairDetail(repairId);

  const [localRepair, setLocalRepair] = useState<ApiRepair | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fetchedRepair && !saving) setLocalRepair(fetchedRepair);
  }, [fetchedRepair, saving]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { refetch(); }, 1500);
  }, [refetch]);

  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  const handleRepairUpdated = useCallback(() => {
    setSaving(true);
    setTimeout(async () => {
      if (repairId) {
        const fresh = await fetchRepairByIdFromSupabase(repairId);
        if (fresh) setLocalRepair(prev => prev ? { ...prev, ...fresh } : fresh);
      }
      setSaving(false);
      scheduleRefresh();
    }, 800);
  }, [repairId, scheduleRefresh]);

  const applyRepairPatch = useCallback((rId: string, patch: Partial<ApiRepair>) => {
    setLocalRepair(prev => prev && prev.repairId === rId ? { ...prev, ...patch } : prev);
    setSaving(true);
  }, []);

  const mergeRepairPatch = useCallback((rId: string, patch: Partial<ApiRepair>) => {
    setLocalRepair(prev => prev && prev.repairId === rId ? { ...prev, ...patch } : prev);
  }, []);

  const clearRepairPatch = useCallback((_rId: string) => {
    setSaving(false);
    scheduleRefresh();
  }, [scheduleRefresh]);

  // Loading
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading repair{repairId ? ` ${repairId}` : ''}...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (status === 'access-denied') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <ShieldX size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600 }}>Access Denied</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          You don't have permission to view this repair.
        </div>
        <button onClick={() => navigate('/repairs')} style={linkBtnStyle}><ArrowLeft size={14} /> Back to Repairs</button>
      </div>
    );
  }

  if (status === 'not-found') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <SearchX size={48} color={theme.colors.textMuted} />
        <div style={{ fontSize: 18, fontWeight: 600 }}>Repair Not Found</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          No repair with ID <code style={{ fontSize: 13, background: theme.colors.bgSubtle, padding: '2px 6px', borderRadius: 4 }}>{repairId}</code> was found.
        </div>
        <button onClick={() => navigate('/repairs')} style={linkBtnStyle}><ArrowLeft size={14} /> Back to Repairs</button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <AlertCircle size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600 }}>Failed to Load Repair</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted }}>{error || 'An unexpected error occurred.'}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={refetch} style={{ ...linkBtnStyle, color: theme.colors.primary }}>Retry</button>
          <button onClick={() => navigate('/repairs')} style={linkBtnStyle}><ArrowLeft size={14} /> Back to Repairs</button>
        </div>
      </div>
    );
  }

  const displayRepair = localRepair || fetchedRepair;
  if (!displayRepair) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C', marginBottom: 16 }}>STRIDE LOGISTICS · REPAIR · {displayRepair.repairId}</div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)', flex: 1, overflow: 'auto', display: 'flex' }}>
      {saving && (
        <div style={{
          position: 'fixed', top: 12, right: 12, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 8,
          background: theme.colors.primaryLight || '#FEF3EE',
          color: theme.colors.primary, fontSize: 13, fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Saving...
        </div>
      )}
      <div style={{ flex: 1 }}>
        <RepairDetailPanel
          repair={displayRepair}
          onClose={() => navigate('/repairs')}
          onRepairUpdated={handleRepairUpdated}
          applyRepairPatch={applyRepairPatch}
          mergeRepairPatch={mergeRepairPatch}
          clearRepairPatch={clearRepairPatch}
        />
      </div>
      </div>
    </div>
  );
}

const linkBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8,
  border: `1px solid ${theme.colors.border}`,
  background: 'white', color: theme.colors.text,
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
  fontFamily: 'inherit',
};
