import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Loader2, SearchX, ShieldX, ExternalLink, DollarSign,
  Pencil, Save, X, CheckCircle2, XCircle, FileText, Play,
} from 'lucide-react';
import { theme } from '../styles/theme';
import { useWillCallDetail } from '../hooks/useWillCallDetail';
import { useAuth } from '../contexts/AuthContext';
import {
  EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens,
} from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';
import {
  postProcessWcRelease, postGenerateWcDoc, postCancelWillCall, postUpdateWillCall,
} from '../lib/api';
import type { ApiWCItem } from '../lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

const WC_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Pending':   { bg: theme.colors.statusAmberBg,  color: theme.colors.statusAmber },
  'Scheduled': { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Partial':   { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Released':  { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  'Cancelled': { bg: theme.colors.statusGrayBg,   color: theme.colors.statusGray },
};

function StatusBadge({ status }: { status: string }) {
  const c = WC_STATUS_COLORS[status] ?? { bg: theme.colors.statusGrayBg, color: theme.colors.statusGray };
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
  { label: 'All',        actions: [] as string[] },
  { label: 'Scheduling', actions: ['create', 'update', 'assign'] },
  { label: 'Release',    actions: ['release', 'complete'] },
];

function ActivityTab({ entityId, tenantId }: { entityId: string; tenantId?: string }) {
  const [activeFilter, setActiveFilter] = useState(0);
  const currentFilter = ACTIVITY_FILTERS[activeFilter];
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
        {ACTIVITY_FILTERS.map((f, i) => {
          const isActive = i === activeFilter;
          return (
            <button key={f.label + i} onClick={() => setActiveFilter(i)} style={{
              padding: `4px ${theme.spacing.md}`, borderRadius: theme.radii.full,
              border: 'none', fontFamily: 'inherit', fontSize: theme.typography.sizes.xs,
              fontWeight: theme.typography.weights.semibold, cursor: 'pointer',
              background: isActive ? EntityPageTokens.tabActive : theme.colors.bgSubtle,
              color: isActive ? '#fff' : theme.colors.textSecondary,
            }}>{f.label}</button>
          );
        })}
      </div>
      <EPCard style={{ padding: '8px 14px' }}>
        <EntityHistory
          entityType="will_call"
          entityId={entityId}
          tenantId={tenantId}
          defaultExpanded
          actionFilter={currentFilter.actions.length > 0 ? currentFilter.actions : undefined}
        />
      </EPCard>
    </div>
  );
}

// ── COD badge ────────────────────────────────────────────────────────────────

function CodBadge({ amount, paid }: { amount?: number | null; paid: boolean }) {
  return (
    <>
      <style>{`
        @keyframes wc-cod-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.75; transform: scale(1.04); } }
      `}</style>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: theme.radii.full,
        background: paid ? theme.colors.statusGreenBg : theme.colors.statusAmberBg,
        color: paid ? theme.colors.statusGreen : theme.colors.statusAmber,
        fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold,
        animation: paid ? 'none' : 'wc-cod-pulse 2s ease-in-out infinite',
        cursor: 'default',
      }}>
        <DollarSign size={11} />
        {paid ? 'COD Paid' : `COD${amount != null ? ` · $${Number(amount).toFixed(2)}` : ''}`}
      </span>
    </>
  );
}

// ── Items table ───────────────────────────────────────────────────────────────

function ItemsTable({
  items, selected, onToggle, onToggleAll, onNavigateToItem,
}: {
  items: ApiWCItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onNavigateToItem: (id: string) => void;
}) {
  if (!items.length) {
    return <div style={{ fontSize: 13, color: theme.colors.textMuted, padding: '12px 0' }}>No items on this will call.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <th style={{ width: 32, padding: '6px 8px', textAlign: 'center' }}>
              <input type="checkbox"
                checked={selected.size === items.length && items.length > 0}
                onChange={onToggleAll} style={{ cursor: 'pointer' }} />
            </th>
            {['Item ID', 'Description', 'Vendor', 'Location', 'Qty', 'Status'].map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: theme.colors.orange, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.itemId} style={{ borderBottom: `1px solid ${theme.colors.borderLight}`, background: selected.has(item.itemId) ? theme.colors.bgSubtle : 'transparent' }}>
              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                <input type="checkbox" checked={selected.has(item.itemId)}
                  onChange={() => onToggle(item.itemId)} style={{ cursor: 'pointer' }} />
              </td>
              <td style={{ padding: '6px 8px' }}>
                <button onClick={() => onNavigateToItem(item.itemId)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: theme.colors.orange, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {item.itemId}<ExternalLink size={10} />
                </button>
              </td>
              <td style={{ padding: '6px 8px', color: theme.colors.text, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.vendor || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.textSecondary }}>{item.location || '—'}</td>
              <td style={{ padding: '6px 8px', color: theme.colors.text, fontWeight: 600 }}>{item.qty ?? 1}</td>
              <td style={{ padding: '6px 8px' }}>
                {item.released
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: theme.colors.statusGreen, background: theme.colors.statusGreenBg, padding: '2px 7px', borderRadius: theme.radii.full }}>Released</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '2px 7px', borderRadius: theme.radii.full }}>Pending</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

// ── Edit form ─────────────────────────────────────────────────────────────────

function EditForm({
  pickupParty, phone, estimatedPickupDate, notes, cod, codAmount,
  onPickupParty, onPhone, onEstimatedPickupDate, onNotes, onCod, onCodAmount,
}: {
  pickupParty: string; phone: string; estimatedPickupDate: string; notes: string; cod: boolean; codAmount: string;
  onPickupParty: (v: string) => void; onPhone: (v: string) => void;
  onEstimatedPickupDate: (v: string) => void; onNotes: (v: string) => void;
  onCod: (v: boolean) => void; onCodAmount: (v: string) => void;
}) {
  const inp: React.CSSProperties = { width: '100%', padding: '6px 10px', borderRadius: theme.radii.md, border: `1px solid ${theme.colors.border}`, fontFamily: 'inherit', fontSize: 13, color: theme.colors.text, background: '#fff', boxSizing: 'border-box' as const };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
      <div><EPLabel>Pickup Party</EPLabel><input value={pickupParty} onChange={e => onPickupParty(e.target.value)} style={inp} /></div>
      <div><EPLabel>Phone</EPLabel><input value={phone} onChange={e => onPhone(e.target.value)} style={inp} /></div>
      <div><EPLabel>Estimated Pickup Date</EPLabel><input type="date" value={estimatedPickupDate} onChange={e => onEstimatedPickupDate(e.target.value)} style={inp} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={cod} onChange={e => onCod(e.target.checked)} />
          COD Required
        </label>
        {cod && <input type="number" value={codAmount} onChange={e => onCodAmount(e.target.value)} placeholder="Amount" style={{ ...inp, width: 100 }} />}
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <EPLabel>Notes</EPLabel>
        <textarea value={notes} onChange={e => onNotes(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' as const }} />
      </div>
    </div>
  );
}

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

export function WillCallPage() {
  const { wcNumber } = useParams<{ wcNumber: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { wc, status, error, refetch } = useWillCallDetail(wcNumber);

  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  // ── Edit state ──
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [draftPickupParty, setDraftPickupParty] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftCod, setDraftCod] = useState(false);
  const [draftCodAmount, setDraftCodAmount] = useState('');

  // ── Action state ──
  const [releasing, setReleasing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [genDocLoading, setGenDocLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // ── Item selection ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [codPaid, setCodPaid] = useState(false);

  const handleEditStart = () => {
    if (!wc) return;
    setDraftPickupParty(wc.pickupParty || '');
    setDraftPhone(wc.pickupPhone || '');
    setDraftDate(wc.estimatedPickupDate || '');
    setDraftNotes(wc.notes || '');
    setDraftCod(wc.cod ?? false);
    setDraftCodAmount(wc.codAmount != null ? String(wc.codAmount) : '');
    setEditError(null);
    setIsEditing(true);
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!wc?.clientSheetId) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await postUpdateWillCall({
        wcNumber: wc.wcNumber,
        pickupParty: draftPickupParty || undefined,
        pickupPhone: draftPhone || undefined,
        estimatedPickupDate: draftDate || undefined,
        notes: draftNotes || undefined,
        cod: draftCod,
        codAmount: draftCodAmount ? Number(draftCodAmount) : undefined,
      }, wc.clientSheetId);
      if (res.ok && res.data?.success) {
        setIsEditing(false);
        refetch();
      } else {
        setEditError(res.data?.error || 'Save failed');
      }
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  };

  const handleReleaseAll = async () => {
    if (!wc?.clientSheetId) return;
    const itemIds = (wc.items ?? []).filter(i => !i.released).map(i => i.itemId);
    if (!itemIds.length) return;
    setReleasing(true);
    setActionError(null);
    try {
      const res = await postProcessWcRelease({ wcNumber: wc.wcNumber, releaseItemIds: itemIds }, wc.clientSheetId);
      if (res.ok && res.data?.success) {
        setActionSuccess('Items released successfully');
        refetch();
      } else {
        setActionError(res.data?.error || 'Release failed');
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Release failed');
    } finally {
      setReleasing(false);
    }
  };

  const handleReleaseSome = async () => {
    if (!wc?.clientSheetId || selected.size === 0) return;
    setReleasing(true);
    setActionError(null);
    try {
      const res = await postProcessWcRelease({ wcNumber: wc.wcNumber, releaseItemIds: [...selected] }, wc.clientSheetId);
      if (res.ok && res.data?.success) {
        setSelected(new Set());
        setActionSuccess(`${selected.size} item(s) released`);
        refetch();
      } else {
        setActionError(res.data?.error || 'Release failed');
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Release failed');
    } finally {
      setReleasing(false);
    }
  };

  const handleCancelWC = async () => {
    if (!wc?.clientSheetId) return;
    if (!window.confirm('Cancel this will call? This cannot be undone.')) return;
    setCancelling(true);
    setActionError(null);
    try {
      const res = await postCancelWillCall({ wcNumber: wc.wcNumber }, wc.clientSheetId);
      if (res.ok && res.data?.success) {
        setActionSuccess('Will call cancelled');
        refetch();
      } else {
        setActionError(res.data?.error || 'Cancel failed');
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const handleGenerateDoc = async () => {
    if (!wc?.clientSheetId) return;
    setGenDocLoading(true);
    setActionError(null);
    try {
      const res = await postGenerateWcDoc(wc.wcNumber, wc.clientSheetId);
      if (res.ok && res.data?.success) {
        setActionSuccess('Pickup document generated');
        refetch();
      } else {
        setActionError(res.data?.error || 'Generate failed');
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGenDocLoading(false);
    }
  };

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
  if (status === 'not-found') return <PageState icon={SearchX} color={theme.colors.textMuted} title="Will Call Not Found" body={`No will call "${wcNumber}" was found.`} actions={<button onClick={() => navigate('/will-calls')} style={backBtnStyle}>Back to Will Calls</button>} />;
  if (status === 'error') return <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Will Call" body={error || 'An unexpected error occurred.'} actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/will-calls')} style={backBtnStyle}>Back to Will Calls</button></div>} />;
  if (!wc) return null;

  const s = wc.status;
  const isActive = s === 'Pending' || s === 'Scheduled' || s === 'Partial';
  const allItems = wc.items ?? [];
  const unreleasedItems = allItems.filter(i => !i.released);

  const toggleItem = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === allItems.length) setSelected(new Set());
    else setSelected(new Set(allItems.map(i => i.itemId)));
  };

  // ── Details tab content ──
  const detailsContent = (
    <div>
      {/* Status strip */}
      {(actionError || actionSuccess || editError) && (
        <EPCard style={{ background: actionError || editError ? theme.colors.statusRedBg : theme.colors.statusGreenBg, padding: '10px 14px', marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: actionError || editError ? theme.colors.statusRed : theme.colors.statusGreen, fontWeight: 600 }}>
            {actionError || editError || actionSuccess}
          </div>
        </EPCard>
      )}

      {/* COD section */}
      {wc.cod && (
        <EPCard>
          <EPLabel>COD Payment</EPLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: codPaid ? theme.colors.statusGreen : theme.colors.statusAmber }}>
              ${wc.codAmount != null ? Number(wc.codAmount).toFixed(2) : '0.00'}
            </span>
            {!codPaid && isStaff && (
              <button
                onClick={() => setCodPaid(true)}
                style={{ padding: '4px 12px', borderRadius: theme.radii.md, border: `1px solid ${theme.colors.statusGreen}`, background: theme.colors.statusGreenBg, color: theme.colors.statusGreen, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >Mark Paid</button>
            )}
            {codPaid && <span style={{ fontSize: 12, color: theme.colors.statusGreen, fontWeight: 600 }}>✓ Collected</span>}
          </div>
        </EPCard>
      )}

      {/* Pickup overview */}
      <EPCard>
        {isEditing ? (
          <EditForm
            pickupParty={draftPickupParty} phone={draftPhone}
            estimatedPickupDate={draftDate} notes={draftNotes}
            cod={draftCod} codAmount={draftCodAmount}
            onPickupParty={setDraftPickupParty} onPhone={setDraftPhone}
            onEstimatedPickupDate={setDraftDate} onNotes={setDraftNotes}
            onCod={setDraftCod} onCodAmount={setDraftCodAmount}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
            <Field label="Pickup Party"   value={wc.pickupParty} />
            <Field label="Phone"          value={wc.pickupPhone} />
            <Field label="Scheduled Date" value={wc.estimatedPickupDate ? fmtDate(wc.estimatedPickupDate) : undefined} />
            <Field label="Items Count"    value={String(wc.itemsCount ?? allItems.length)} />
            {wc.notes && (
              <div style={{ gridColumn: '1 / -1' }}>
                <EPLabel>Notes</EPLabel>
                <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{wc.notes}</div>
              </div>
            )}
          </div>
        )}

        {/* Edit save/cancel */}
        {isStaff && isActive && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            {isEditing ? (
              <>
                <button onClick={handleEditCancel} disabled={editSaving} style={cancelBtnStyle}><X size={13} />Cancel</button>
                <button onClick={handleEditSave} disabled={editSaving} style={saveBtnStyle}>
                  {editSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button onClick={handleEditStart} style={editBtnStyle}><Pencil size={13} />Edit</button>
            )}
          </div>
        )}
      </EPCard>

      {/* Quick actions — staff only */}
      {isStaff && isActive && !isEditing && (
        <EPCard>
          <EPLabel>Quick Actions</EPLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button onClick={handleGenerateDoc} disabled={genDocLoading} style={actionBtnStyle}>
              {genDocLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} />}
              {genDocLoading ? 'Generating…' : 'Generate Pickup Doc'}
            </button>
            {selected.size > 0 && (
              <button onClick={handleReleaseSome} disabled={releasing} style={{ ...actionBtnStyle, background: theme.colors.statusGreenBg, color: theme.colors.statusGreen, borderColor: theme.colors.statusGreen }}>
                <CheckCircle2 size={13} />
                Release {selected.size} Item{selected.size !== 1 ? 's' : ''}
              </button>
            )}
            <button onClick={handleCancelWC} disabled={cancelling} style={{ ...actionBtnStyle, color: theme.colors.statusRed, borderColor: theme.colors.statusRed, background: theme.colors.statusRedBg }}>
              {cancelling ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <XCircle size={13} />}
              Cancel WC
            </button>
          </div>
        </EPCard>
      )}

      {/* Folder link */}
      {wc.wcFolderUrl && (
        <EPCard>
          <a href={wc.wcFolderUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: theme.typography.sizes.sm, color: theme.colors.orange, fontWeight: theme.typography.weights.medium, textDecoration: 'none' }}>
            <ExternalLink size={13} />Will Call Folder
          </a>
          {wc.wcFolderUrl && (
            <>
              {' · '}
              <button onClick={handleGenerateDoc} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.orange, fontSize: 13, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FileText size={13} />Print Release Doc
              </button>
            </>
          )}
        </EPCard>
      )}

      {/* Items table */}
      <EPCard>
        <EPLabel>Items ({allItems.length})</EPLabel>
        <div style={{ marginTop: 8 }}>
          <ItemsTable
            items={allItems} selected={selected}
            onToggle={toggleItem} onToggleAll={toggleAll}
            onNavigateToItem={id => navigate(`/inventory/${id}`)}
          />
        </div>
      </EPCard>
    </div>
  );

  // ── Footer ──
  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {wc.cod && <CodBadge amount={wc.codAmount} paid={codPaid} />}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {isStaff && isActive && s === 'Pending' && (
          <EPFooterButton label={genDocLoading ? 'Generating…' : 'Start Will Call'} variant="primary"
            onClick={handleGenerateDoc} disabled={genDocLoading} icon={<Play size={13} />} />
        )}
        {isStaff && isActive && unreleasedItems.length > 0 && s !== 'Pending' && (
          <EPFooterButton
            label={releasing ? 'Releasing…' : `Release All (${unreleasedItems.length})`}
            variant="primary" onClick={handleReleaseAll} disabled={releasing}
            icon={<CheckCircle2 size={13} />}
          />
        )}
        {isStaff && isActive && selected.size > 0 && (
          <EPFooterButton label={releasing ? 'Releasing…' : `Release ${selected.size} Selected`}
            variant="primary" onClick={handleReleaseSome} disabled={releasing}
            icon={<CheckCircle2 size={13} />} />
        )}
      </div>
    </>
  );

  const tabs = [
    { id: 'details', label: 'Details', keepMounted: true, render: () => detailsContent },
    { id: 'photos', label: 'Photos' },
    { id: 'docs',   label: 'Docs' },
    { id: 'notes',  label: 'Notes' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <EntityPage
      entityLabel="Will Call"
      entityId={wc.wcNumber}
      statusBadge={<StatusBadge status={wc.status} />}
      clientName={wc.clientName}
      metaPills={
        wc.pickupParty ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: `2px ${theme.spacing.sm}`, borderRadius: theme.radii.md, background: theme.colors.bgSubtle, fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary, fontWeight: theme.typography.weights.medium }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: EntityPageTokens.labelColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pickup</span>
            {wc.pickupParty}
          </span>
        ) : undefined
      }
      tabs={tabs}
      builtInTabs={{
        photos:   { entityType: 'will_call', entityId: wc.wcNumber, tenantId: wc.clientSheetId },
        docs:     { contextType: 'willcall', contextId: wc.wcNumber, tenantId: wc.clientSheetId },
        notes:    { entityType: 'will_call', entityId: wc.wcNumber },
        activity: { render: () => <ActivityTab entityId={wc.wcNumber} tenantId={wc.clientSheetId} /> },
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

const editBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px',
  borderRadius: theme.radii.md, border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const saveBtnStyle: React.CSSProperties = {
  ...editBtnStyle, background: theme.colors.orange, color: '#fff', border: 'none',
};
const cancelBtnStyle: React.CSSProperties = {
  ...editBtnStyle,
};
const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px',
  borderRadius: theme.radii.md, border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
