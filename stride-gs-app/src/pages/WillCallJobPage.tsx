/**
 * WillCallJobPage.tsx — Standalone will call detail page for direct-by-ID access.
 * Opens in a new tab from Dashboard or via external-link icon on Will Calls page.
 * Loads one WC from Supabase (~50ms) with GAS fallback for full data (items, COD).
 * Full WillCallDetailPanel parity.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWillCallDetail } from '../hooks/useWillCallDetail';
import { WillCallDetailPanel } from '../components/shared/WillCallDetailPanel';
import { theme } from '../styles/theme';
import { fetchWillCallByIdFromSupabase } from '../lib/supabaseQueries';
import type { ApiWillCall } from '../lib/api';
import type { WillCall } from '../lib/types';
import { ArrowLeft, AlertCircle, SearchX, ShieldX, Loader2 } from 'lucide-react';

export function WillCallJobPage() {
  const { wcNumber } = useParams<{ wcNumber: string }>();
  const navigate = useNavigate();
  useAuth(); // Ensure auth context is loaded

  const { wc: fetchedWc, status, error, refetch } = useWillCallDetail(wcNumber);

  // Local optimistic state
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
        const fresh = await fetchWillCallByIdFromSupabase(wcNumber);
        if (fresh) setLocalWc(prev => prev ? { ...prev, ...fresh } : fresh);
      }
      setSaving(false);
      scheduleRefresh();
    }, 800);
  }, [wcNumber, scheduleRefresh]);

  // Optimistic patch functions
  const applyWcPatch = useCallback((wcNum: string, patch: Partial<WillCall>) => {
    setLocalWc(prev => prev && prev.wcNumber === wcNum ? { ...prev, ...patch } as ApiWillCall : prev);
    setSaving(true);
  }, []);

  const mergeWcPatch = useCallback((wcNum: string, patch: Partial<WillCall>) => {
    setLocalWc(prev => prev && prev.wcNumber === wcNum ? { ...prev, ...patch } as ApiWillCall : prev);
  }, []);

  const clearWcPatch = useCallback((_wcNum: string) => {
    setSaving(false);
    scheduleRefresh();
  }, [scheduleRefresh]);

  // Loading
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading will call{wcNumber ? ` ${wcNumber}` : ''}...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // Access denied
  if (status === 'access-denied') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <ShieldX size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600 }}>Access Denied</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          You don't have permission to view this will call.
        </div>
        <button onClick={() => navigate('/will-calls')} style={linkBtnStyle}><ArrowLeft size={14} /> Back to Will Calls</button>
      </div>
    );
  }

  // Not found
  if (status === 'not-found') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <SearchX size={48} color={theme.colors.textMuted} />
        <div style={{ fontSize: 18, fontWeight: 600 }}>Will Call Not Found</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          No will call with number <code style={{ fontSize: 13, background: theme.colors.bgSubtle, padding: '2px 6px', borderRadius: 4 }}>{wcNumber}</code> was found.
        </div>
        <button onClick={() => navigate('/will-calls')} style={linkBtnStyle}><ArrowLeft size={14} /> Back to Will Calls</button>
      </div>
    );
  }

  // Error
  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <AlertCircle size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600 }}>Failed to Load Will Call</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted }}>{error || 'An unexpected error occurred.'}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={refetch} style={{ ...linkBtnStyle, color: theme.colors.primary }}>Retry</button>
          <button onClick={() => navigate('/will-calls')} style={linkBtnStyle}><ArrowLeft size={14} /> Back to Will Calls</button>
        </div>
      </div>
    );
  }

  const displayWc = localWc || fetchedWc;
  if (!displayWc) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '1px', color: '#1C1C1C', marginBottom: 16 }}>STRIDE LOGISTICS · WILL CALL · {displayWc.wcNumber}</div>
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
        <WillCallDetailPanel
          wc={displayWc}
          onClose={() => navigate('/will-calls')}
          onWcUpdated={handleWcUpdated}
          applyWcPatch={applyWcPatch}
          mergeWcPatch={mergeWcPatch}
          clearWcPatch={clearWcPatch}
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
