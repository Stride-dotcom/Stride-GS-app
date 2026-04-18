/**
 * ShipmentJobPage.tsx — Standalone shipment detail page for direct-by-ID access.
 * Opened via email deep links (SHIPMENT_RECEIVED notifications).
 * Loads one shipment from Supabase by shipment_number (~50ms, RLS handles access).
 * Renders ShipmentDetailPanel directly — no client filter required.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClients } from '../hooks/useClients';
import { ShipmentDetailPanel } from '../components/shared/ShipmentDetailPanel';
import { theme } from '../styles/theme';
import { fetchShipmentByNoFromSupabase } from '../lib/supabaseQueries';
import type { ApiShipment } from '../lib/api';
import { ArrowLeft, AlertCircle, SearchX, Loader2 } from 'lucide-react';

export function ShipmentJobPage() {
  const { shipmentNo } = useParams<{ shipmentNo: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { apiClients } = useClients();

  type PageStatus = 'loading' | 'loaded' | 'not-found' | 'error';
  const [status, setStatus] = useState<PageStatus>('loading');
  const [apiShipment, setApiShipment] = useState<ApiShipment | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!shipmentNo) {
      setStatus('not-found');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetchShipmentByNoFromSupabase(shipmentNo).then(result => {
      if (cancelled) return;
      if (!result) {
        setStatus('not-found');
      } else {
        setApiShipment(result);
        setStatus('loaded');
      }
    }).catch(err => {
      if (cancelled) return;
      setErrorMsg(err?.message || 'Unexpected error loading shipment.');
      setStatus('error');
    });
    return () => { cancelled = true; };
  }, [shipmentNo]);

  // Resolve client name from tenant_id once apiClients are available
  const clientName = useMemo(() => {
    if (!apiShipment) return '';
    return apiClients.find(c => c.spreadsheetId === apiShipment.clientSheetId)?.name || '';
  }, [apiShipment, apiClients]);

  // Map ApiShipment → ShipmentDetailPanel's Shipment shape
  const shipmentForPanel = useMemo(() => {
    if (!apiShipment) return null;
    return {
      shipmentNo: apiShipment.shipmentNumber,
      client: clientName || apiShipment.clientSheetId,
      clientSheetId: apiShipment.clientSheetId,
      status: 'Received',
      carrier: apiShipment.carrier,
      tracking: apiShipment.trackingNumber,
      receivedDate: apiShipment.receiveDate,
      createdBy: '',
      notes: apiShipment.notes,
      items: [],
      totalItems: apiShipment.itemCount,
      folderUrl: apiShipment.folderUrl || undefined,
    };
  }, [apiShipment, clientName]);

  // Loading
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading shipment{shipmentNo ? ` ${shipmentNo}` : ''}...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // Not found
  if (status === 'not-found') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <SearchX size={48} color={theme.colors.textMuted} />
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>Shipment Not Found</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          No shipment with number <code style={{ fontSize: 13, background: theme.colors.bgSubtle, padding: '2px 6px', borderRadius: 4 }}>{shipmentNo}</code> was found.
        </div>
        <button onClick={() => navigate('/')} style={linkBtnStyle}>
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
      </div>
    );
  }

  // Error
  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <AlertCircle size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>Failed to Load Shipment</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          {errorMsg || 'An unexpected error occurred.'}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => window.location.reload()} style={{ ...linkBtnStyle, color: theme.colors.primary }}>Retry</button>
          <button onClick={() => navigate('/')} style={linkBtnStyle}>
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Loaded
  if (!shipmentForPanel) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '1px', color: '#1C1C1C', marginBottom: 16 }}>STRIDE LOGISTICS · SHIPMENT · {shipmentForPanel.shipmentNo}</div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)', flex: 1, overflow: 'auto' }}>
        <ShipmentDetailPanel
          shipment={shipmentForPanel}
          onClose={() => navigate('/')}
          userRole={user?.role}
          isParent={user?.isParent}
          onItemsChanged={() => {}}
        />
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
};
