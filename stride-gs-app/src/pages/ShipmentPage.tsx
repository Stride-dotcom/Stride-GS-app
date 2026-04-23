/**
 * ShipmentPage.tsx — Full-page shipment detail view.
 * Route: #/shipments/:shipmentNo
 *
 * Thin wrapper around ShipmentDetailPanel in `renderAsPage` mode. Fetches the
 * shipment + items via useShipmentDetail. All tabs, handlers, modals, and
 * edit logic live in ShipmentDetailPanel.
 */
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useShipmentDetail } from '../hooks/useShipmentDetail';
import { ShipmentDetailPanel } from '../components/shared/ShipmentDetailPanel';
import { theme } from '../styles/theme';

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

export function ShipmentPage() {
  const { shipmentNo } = useParams<{ shipmentNo: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { shipment, items, status, error, refetch } = useShipmentDetail(shipmentNo);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading shipment{shipmentNo ? ` ${shipmentNo}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this shipment." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Shipment Not Found" body={`No shipment "${shipmentNo}" was found.`} actions={<button onClick={() => navigate('/shipments')} style={backBtnStyle}>Back to Shipments</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Shipment" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/shipments')} style={backBtnStyle}>Back to Shipments</button></div>}
      />
    );
  }
  if (!shipment) return null;

  // ShipmentDetailPanel expects a local `Shipment` type — it reads fields that
  // overlap with ApiShipment and pre-loads `items` into its local state so
  // no lazy-fetch happens again.
  const panelShipment = {
    shipmentNo: shipment.shipmentNumber,
    client: shipment.clientName,
    clientSheetId: shipment.clientSheetId,
    status: 'Received',
    carrier: shipment.carrier,
    tracking: shipment.trackingNumber,
    receivedDate: shipment.receiveDate,
    createdBy: '',
    notes: shipment.notes || '',
    totalItems: shipment.itemCount,
    folderUrl: shipment.folderUrl,
    items: items.map(i => ({
      itemId: i.itemId,
      vendor: i.vendor || '',
      description: i.description || '',
      itemClass: i.itemClass || '',
      qty: i.qty || 1,
      location: i.location || '',
      sidemark: i.sidemark || '',
    })),
  };

  return (
    <ShipmentDetailPanel
      renderAsPage
      shipment={panelShipment as unknown as Parameters<typeof ShipmentDetailPanel>[0]['shipment']}
      onClose={() => navigate(-1)}
      userRole={user?.role}
      isParent={(user as { isParent?: boolean } | null)?.isParent}
      onItemsChanged={refetch}
    />
  );
}
