import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Loader2, SearchX, ShieldX, ClipboardList, Truck, Pencil, Save, X,
  ChevronDown, ExternalLink, Wrench, ArrowLeftRight,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { useItemDetail } from '../hooks/useItemDetail';
import { useAuth } from '../contexts/AuthContext';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';
import {
  postUpdateInventoryItem, postRequestRepairQuote,
} from '../lib/api';
import type { ApiInventoryItem } from '../lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Active:      { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  Released:    { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'On Hold':   { bg: theme.colors.statusAmberBg,  color: theme.colors.statusAmber },
  Transferred: { bg: theme.colors.statusGrayBg,   color: theme.colors.statusGray },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? { bg: theme.colors.statusGrayBg, color: theme.colors.statusGray };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: theme.radii.full,
      background: c.bg, color: c.color,
      fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
      {status}
    </span>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────────

const ACTIVITY_FILTERS = [
  { label: 'All',            actions: [] as string[] },
  { label: 'Status Changes', actions: ['status_change', 'release', 'transfer'] },
  { label: 'Field Updates',  actions: ['update'] },
  { label: 'Created',        actions: ['create'] },
];

function ActivityTab({ entityId, tenantId }: { entityId: string; tenantId?: string }) {
  const [activeFilter, setActiveFilter] = useState(0);
  const f = ACTIVITY_FILTERS[activeFilter];
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
        {ACTIVITY_FILTERS.map((fil, i) => {
          const active = i === activeFilter;
          return (
            <button key={fil.label} onClick={() => setActiveFilter(i)} style={{
              padding: `4px ${theme.spacing.md}`, borderRadius: theme.radii.full,
              border: 'none', fontFamily: 'inherit', fontSize: theme.typography.sizes.xs,
              fontWeight: theme.typography.weights.semibold, cursor: 'pointer',
              background: active ? EntityPageTokens.tabActive : theme.colors.bgSubtle,
              color: active ? '#fff' : theme.colors.textSecondary,
            }}>{fil.label}</button>
          );
        })}
      </div>
      <EPCard style={{ padding: '8px 14px' }}>
        <EntityHistory entityType="inventory" entityId={entityId} tenantId={tenantId}
          defaultExpanded actionFilter={f.actions.length > 0 ? f.actions : undefined} />
      </EPCard>
    </div>
  );
}

// ── Field component ───────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <EPLabel>{label}</EPLabel>
      <div style={{ fontSize: theme.typography.sizes.base, color: value ? theme.colors.text : theme.colors.textMuted, fontWeight: value ? theme.typography.weights.medium : theme.typography.weights.normal }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ── Actions dropdown ──────────────────────────────────────────────────────────

function ActionsDropdown({ onRequestRepair, onTransfer, repairRequesting }: {
  onRequestRepair: () => void;
  onTransfer: () => void;
  repairRequesting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: theme.radii.md,
        border: `1px solid ${theme.colors.border}`, background: theme.colors.bgCard,
        color: theme.colors.text, fontSize: 12, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit',
      }}>
        Actions <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 100,
          background: '#fff', borderRadius: theme.radii.lg,
          border: `1px solid ${theme.colors.borderLight}`,
          boxShadow: theme.shadows.md, minWidth: 180, padding: '4px 0',
        }}>
          <DropItem label="Request Repair Quote" icon={<Wrench size={13} />}
            onClick={() => { setOpen(false); onRequestRepair(); }} disabled={repairRequesting} />
          <DropItem label="Transfer Item" icon={<ArrowLeftRight size={13} />}
            onClick={() => { setOpen(false); onTransfer(); }} />
        </div>
      )}
    </div>
  );
}

function DropItem({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 14px', border: 'none', background: 'transparent',
      fontFamily: 'inherit', fontSize: 13, color: disabled ? theme.colors.textMuted : theme.colors.text,
      cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left',
    }}>
      {icon}{label}
    </button>
  );
}

// ── Details tab ───────────────────────────────────────────────────────────────

function DetailsTab({
  item, isEditing, isStaff,
  draftVendor, setDraftVendor, draftDescription, setDraftDescription,
  draftRef, setDraftRef, draftSidemark, setDraftSidemark,
  draftRoom, setDraftRoom, draftLocation, setDraftLocation,
  draftClass, setDraftClass, draftQty, setDraftQty,
  draftStatus, setDraftStatus,
  onNavigateToShipment,
}: {
  item: ApiInventoryItem; isEditing: boolean; isStaff: boolean;
  draftVendor: string; setDraftVendor: (v: string) => void;
  draftDescription: string; setDraftDescription: (v: string) => void;
  draftRef: string; setDraftRef: (v: string) => void;
  draftSidemark: string; setDraftSidemark: (v: string) => void;
  draftRoom: string; setDraftRoom: (v: string) => void;
  draftLocation: string; setDraftLocation: (v: string) => void;
  draftClass: string; setDraftClass: (v: string) => void;
  draftQty: string; setDraftQty: (v: string) => void;
  draftStatus: string; setDraftStatus: (v: string) => void;
  onNavigateToShipment: (no: string) => void;
}) {
  const inp: React.CSSProperties = { width: '100%', padding: '6px 10px', borderRadius: theme.radii.md, border: `1px solid ${theme.colors.border}`, fontFamily: 'inherit', fontSize: 13, color: theme.colors.text, background: '#fff', boxSizing: 'border-box' as const };

  return (
    <div>
      {/* Core details grid — ordered: Location, Qty, Vendor, Description, Sidemark, Reference, Room, Class, Receive Date */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          {isEditing && isStaff ? (
            <>
              <div><EPLabel>Location</EPLabel><input value={draftLocation} onChange={e => setDraftLocation(e.target.value)} style={inp} /></div>
              <div><EPLabel>Qty</EPLabel><input type="number" value={draftQty} onChange={e => setDraftQty(e.target.value)} style={inp} /></div>
              <div><EPLabel>Vendor</EPLabel><input value={draftVendor} onChange={e => setDraftVendor(e.target.value)} style={inp} /></div>
              <div><EPLabel>Description</EPLabel><input value={draftDescription} onChange={e => setDraftDescription(e.target.value)} style={inp} /></div>
              <div><EPLabel>Sidemark</EPLabel><input value={draftSidemark} onChange={e => setDraftSidemark(e.target.value)} style={inp} /></div>
              <div><EPLabel>Reference</EPLabel><input value={draftRef} onChange={e => setDraftRef(e.target.value)} style={inp} /></div>
              <div><EPLabel>Room</EPLabel><input value={draftRoom} onChange={e => setDraftRoom(e.target.value)} style={inp} /></div>
              <div>
                <EPLabel>Class</EPLabel>
                <select value={draftClass} onChange={e => setDraftClass(e.target.value)} style={inp}>
                  {['', 'XS', 'S', 'M', 'L', 'XL'].map(c => <option key={c} value={c}>{c || '— None —'}</option>)}
                </select>
              </div>
              <Field label="Receive Date" value={fmtDate(item.receiveDate)} />
              <div>
                <EPLabel>Status</EPLabel>
                <select value={draftStatus} onChange={e => setDraftStatus(e.target.value)} style={inp}>
                  {['Active', 'On Hold', 'Released', 'Transferred'].map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <Field label="Location"     value={item.location} />
              <Field label="Qty"          value={String(item.qty)} />
              <Field label="Vendor"       value={item.vendor} />
              <Field label="Description"  value={item.description} />
              <Field label="Sidemark"     value={item.sidemark} />
              <Field label="Reference"    value={item.reference} />
              <Field label="Room"         value={item.room} />
              <Field label="Class"        value={item.itemClass} />
              <Field label="Receive Date" value={fmtDate(item.receiveDate)} />
              {item.releaseDate && <Field label="Release Date" value={fmtDate(item.releaseDate)} />}
              {item.carrier     && <Field label="Carrier"      value={item.carrier} />}
              {item.trackingNumber && <Field label="Tracking #" value={item.trackingNumber} />}
            </>
          )}
        </div>
      </EPCard>

      {/* Shipment # — own card with deeplink */}
      {item.shipmentNumber && (
        <EPCard>
          <EPLabel>Shipment</EPLabel>
          <button
            onClick={() => onNavigateToShipment(item.shipmentNumber!)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.semibold, color: theme.colors.orange, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}
          >
            {item.shipmentNumber}
            <ExternalLink size={12} />
          </button>
        </EPCard>
      )}

      {/* Flags */}
      {(item.needsInspection || item.needsAssembly) && (
        <EPCard>
          <EPLabel>Add-on Services</EPLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {item.needsInspection && <FlagChip label="Inspection Required" color="#D97706" />}
            {item.needsAssembly   && <FlagChip label="Assembly Required" color="#7C3AED" />}
          </div>
        </EPCard>
      )}

      {/* Folder links */}
      {(item.shipmentFolderUrl || (item as any).photosFolderUrl) && (
        <EPCard>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {item.shipmentFolderUrl && (
              <a href={item.shipmentFolderUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                <ExternalLink size={13} />Shipment Folder
              </a>
            )}
            {(item as any).photosFolderUrl && (
              <a href={(item as any).photosFolderUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                <ExternalLink size={13} />Photos Folder
              </a>
            )}
          </div>
        </EPCard>
      )}
    </div>
  );
}

function FlagChip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: `3px ${theme.spacing.sm}`, borderRadius: theme.radii.md, background: color + '18', color, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold }}>{label}</span>
  );
}

const linkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: theme.typography.sizes.sm, color: theme.colors.orange,
  fontWeight: theme.typography.weights.medium, textDecoration: 'none',
};

// ── Loading / error states ────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { item, status, error, refetch } = useItemDetail(itemId);

  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  // ── Edit state ──
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Draft fields
  const [draftVendor, setDraftVendor]         = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftRef, setDraftRef]               = useState('');
  const [draftSidemark, setDraftSidemark]     = useState('');
  const [draftRoom, setDraftRoom]             = useState('');
  const [draftLocation, setDraftLocation]     = useState('');
  const [draftClass, setDraftClass]           = useState('');
  const [draftQty, setDraftQty]               = useState('');
  const [draftStatus, setDraftStatus]         = useState('');

  // ── Repair quote state ──
  const [repairRequesting, setRepairRequesting] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);

  // ── Loading ──
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading item{itemId ? ` ${itemId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this item." actions={<button onClick={() => navigate('/inventory')} style={backBtnStyle}>Back to Inventory</button>} />;
  if (status === 'not-found') return <PageState icon={SearchX} color={theme.colors.textMuted} title="Item Not Found" body={`No item with ID "${itemId}" was found.`} actions={<button onClick={() => navigate('/inventory')} style={backBtnStyle}>Back to Inventory</button>} />;
  if (status === 'error') return <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Item" body={error || 'An unexpected error occurred.'} actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/inventory')} style={backBtnStyle}>Back to Inventory</button></div>} />;
  if (!item) return null;

  // ── Handlers ──
  const handleEditStart = () => {
    setDraftVendor(item.vendor || '');
    setDraftDescription(item.description || '');
    setDraftRef(item.reference || '');
    setDraftSidemark(item.sidemark || '');
    setDraftRoom(item.room || '');
    setDraftLocation(item.location || '');
    setDraftClass(item.itemClass || '');
    setDraftQty(String(item.qty ?? ''));
    setDraftStatus(item.status || 'Active');
    setSaveError(null);
    setSaveSuccess(false);
    setIsEditing(true);
  };

  const handleEditCancel = () => { setIsEditing(false); setSaveError(null); };

  const handleSave = async () => {
    if (!item.clientSheetId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const changes: Record<string, unknown> = {};
      if (draftVendor !== (item.vendor || ''))          changes.vendor = draftVendor;
      if (draftDescription !== (item.description || '')) changes.description = draftDescription;
      if (draftRef !== (item.reference || ''))           changes.reference = draftRef;
      if (draftSidemark !== (item.sidemark || ''))       changes.sidemark = draftSidemark;
      if (draftRoom !== (item.room || ''))               changes.room = draftRoom;
      if (draftLocation !== (item.location || ''))       changes.location = draftLocation;
      if (draftClass !== (item.itemClass || ''))         changes.itemClass = draftClass;
      if (draftQty !== String(item.qty ?? ''))           changes.qty = Number(draftQty);
      if (draftStatus !== item.status)                   changes.status = draftStatus;

      if (Object.keys(changes).length === 0) { setIsEditing(false); return; }

      const res = await postUpdateInventoryItem({ itemId: item.itemId, ...changes } as any, item.clientSheetId);
      if (res.ok && res.data?.success) {
        setIsEditing(false);
        setSaveSuccess(true);
        refetch();
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError(res.data?.error || 'Save failed');
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestRepair = async () => {
    if (!item.clientSheetId) return;
    setRepairRequesting(true);
    setRepairError(null);
    try {
      const res = await postRequestRepairQuote({ itemId: item.itemId }, item.clientSheetId);
      if (res.ok && res.data?.success) {
        navigate(`/repairs/${res.data.repairId}`);
      } else {
        setRepairError(res.data?.error || 'Failed to request repair quote');
      }
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : 'Failed to request repair quote');
    } finally {
      setRepairRequesting(false);
    }
  };

  // ── Header actions ──
  const headerActions = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {isStaff && (
        <button
          onClick={isEditing ? handleEditCancel : handleEditStart}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: theme.radii.md, border: `1px solid ${theme.colors.border}`, background: isEditing ? theme.colors.orange : theme.colors.bgCard, color: isEditing ? '#fff' : theme.colors.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Pencil size={12} />{isEditing ? 'Editing…' : 'Edit'}
        </button>
      )}
      {isStaff && (
        <ActionsDropdown
          onRequestRepair={handleRequestRepair}
          onTransfer={() => navigate('/inventory', { state: { transferItemId: item.itemId, clientSheetId: item.clientSheetId } })}
          repairRequesting={repairRequesting}
        />
      )}
    </div>
  );

  // ── Status strip ──
  const statusStrip = (saveError || saveSuccess || repairError) ? (
    <div style={{ padding: '8px 14px', borderRadius: theme.radii.md, marginTop: 8, background: saveError || repairError ? theme.colors.statusRedBg : theme.colors.statusGreenBg, color: saveError || repairError ? theme.colors.statusRed : theme.colors.statusGreen, fontSize: 13, fontWeight: 600 }}>
      {saveError || repairError || 'Changes saved successfully'}
    </div>
  ) : undefined;

  // ── Tabs ──
  const tabs = [
    {
      id: 'details',
      label: 'Details',
      keepMounted: true,
      render: () => (
        <>
          {statusStrip && <div style={{ marginBottom: 8 }}>{statusStrip}</div>}
          <DetailsTab
            item={item} isEditing={isEditing} isStaff={isStaff}
            draftVendor={draftVendor} setDraftVendor={setDraftVendor}
            draftDescription={draftDescription} setDraftDescription={setDraftDescription}
            draftRef={draftRef} setDraftRef={setDraftRef}
            draftSidemark={draftSidemark} setDraftSidemark={setDraftSidemark}
            draftRoom={draftRoom} setDraftRoom={setDraftRoom}
            draftLocation={draftLocation} setDraftLocation={setDraftLocation}
            draftClass={draftClass} setDraftClass={setDraftClass}
            draftQty={draftQty} setDraftQty={setDraftQty}
            draftStatus={draftStatus} setDraftStatus={setDraftStatus}
            onNavigateToShipment={no => navigate(`/shipments/${no}`)}
          />
        </>
      ),
    },
    { id: 'photos', label: 'Photos' },
    { id: 'docs', label: 'Docs' },
    { id: 'notes', label: 'Notes' },
    { id: 'activity', label: 'Activity' },
  ];

  // ── Footer ──
  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <EPFooterButton label="Create Task" variant="secondary" icon={<ClipboardList size={13} />}
          onClick={() => navigate('/tasks', { state: { createForItemId: item.itemId, clientSheetId: item.clientSheetId } })} />
        <EPFooterButton label="Add to Will Call" variant="secondary" icon={<Truck size={13} />}
          onClick={() => navigate('/will-calls', { state: { addItemId: item.itemId, clientSheetId: item.clientSheetId } })} />
        {isStaff && (
          <EPFooterButton label={repairRequesting ? 'Requesting…' : 'Repair Quote'} variant="secondary"
            icon={<Wrench size={13} />} onClick={handleRequestRepair} disabled={repairRequesting} />
        )}
      </div>
      {isEditing ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <EPFooterButton label="Cancel" variant="secondary" icon={<X size={13} />} onClick={handleEditCancel} />
          <EPFooterButton label={saving ? 'Saving…' : 'Save Changes'} variant="primary"
            icon={saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
            onClick={handleSave} disabled={saving} />
        </div>
      ) : (
        isStaff && <EPFooterButton label="Edit Item" variant="primary" icon={<Pencil size={13} />} onClick={handleEditStart} />
      )}
    </>
  );

  return (
    <EntityPage
      entityLabel="Inventory"
      entityId={item.itemId}
      statusBadge={<StatusBadge status={item.status} />}
      clientName={item.clientName}
      headerActions={headerActions}
      tabs={tabs}
      builtInTabs={{
        photos: { entityType: 'inventory', entityId: item.itemId, itemId: item.itemId, tenantId: item.clientSheetId, enableSourceFilter: true },
        docs:   { contextType: 'item', contextId: item.itemId, tenantId: item.clientSheetId },
        notes:  { entityType: 'inventory', entityId: item.itemId, enableSourceFilter: true, itemId: item.itemId },
        activity: { render: () => <ActivityTab entityId={item.itemId} tenantId={item.clientSheetId} /> },
      }}
      footer={footer}
    />
  );
}

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: `${theme.spacing.sm} ${theme.spacing.lg}`, borderRadius: theme.radii.lg,
  border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.medium,
  cursor: 'pointer', fontFamily: 'inherit',
};
