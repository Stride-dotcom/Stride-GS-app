import React, { useState, useEffect, useCallback } from 'react';
import {
  X, FolderOpen, FileText, Clock, Package, AlertTriangle,
  MessageSquare, Info, CheckCircle, XCircle, RotateCcw,
  Upload, ExternalLink,
} from 'lucide-react';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { WriteButton } from './WriteButton';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { isApiConfigured } from '../../lib/api';
import {
  fetchClaimDetail,
  postAddClaimNote,
  postRequestMoreInfo,
  postSendClaimDenial,
  postGenerateClaimSettlement,
  postUploadSignedSettlement,
  postCloseClaim,
  postVoidClaim,
  postReopenClaim,
  postUpdateClaim,
} from '../../lib/api';
import type {
  ApiClaimItem, ApiClaimHistoryEvent, ApiClaimFile,
} from '../../lib/api';
import type { Claim } from '../../lib/types';

interface Props {
  claim: Claim;
  onClose: () => void;
  onUpdated?: () => void;
  // Phase 2C — optimistic patch functions (from useClaims)
  applyClaimPatch?: (claimId: string, patch: Partial<Claim>) => void;
  mergeClaimPatch?: (claimId: string, patch: Partial<Claim>) => void;
  clearClaimPatch?: (claimId: string) => void;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  'Under Review':    { bg: '#FEF3C7', color: '#B45309' },
  'Waiting on Info': { bg: '#EFF6FF', color: '#1D4ED8' },
  'Settlement Sent': { bg: '#EDE9FE', color: '#7C3AED' },
  'Approved':        { bg: '#F0FDF4', color: '#15803D' },
  'Closed':          { bg: '#F3F4F6', color: '#6B7280' },
  'Void':            { bg: '#F3F4F6', color: '#9CA3AF' },
};

const TYPE_CFG: Record<string, { bg: string; color: string }> = {
  'Item Claim':     { bg: '#FEF3EE', color: '#E85D2D' },
  'Property Claim': { bg: '#FEF2F2', color: '#DC2626' },
};

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>
      {t}
    </span>
  );
}

function Field({ label, value, mono, href }: { label: string; value?: string | number | null; mono?: boolean; href?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      {href && value ? (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: theme.colors.orange, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
          {String(value)} <ExternalLink size={11} />
        </a>
      ) : (
        <div style={{ fontSize: 13, color: value != null && value !== '' ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>
          {value != null && value !== '' ? String(value) : '—'}
        </div>
      )}
    </div>
  );
}

function EditField({ label, value, onChange, onBlur, type = 'text', saved }: { label: string; value: string; onChange: (v: string) => void; onBlur: () => void; type?: string; saved?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
        {saved && <span style={{ fontSize: 9, color: '#15803D', fontWeight: 600 }}>✓ Saved</span>}
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        type={type}
        style={{ width: '100%', padding: '5px 8px', fontSize: 13, border: `1px solid ${saved ? '#15803D' : theme.colors.border}`, borderRadius: 6, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff', transition: 'border-color 0.2s' }}
      />
    </div>
  );
}

// Use shared fmtDate from constants — MM/DD/YY format
const fmt = fmtDate;

function fmtMoney(n?: number | null) {
  if (n == null) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

function fmtTimestamp(ts?: string) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ts; }
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      {icon}
      <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{label}</span>
    </div>
  );
}

type Tab = 'details' | 'items' | 'history' | 'files';

export function ClaimDetailPanel({ claim: initialClaim, onClose, onUpdated, applyClaimPatch, clearClaimPatch }: Props) {
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown: handleResizeMouseDown } = useResizablePanel(520, 'claim', isMobile);
  const [activeTab, setActiveTab] = useState<Tab>('details');
  const [claim, setClaim] = useState(initialClaim);
  const [detailItems, setDetailItems] = useState<ApiClaimItem[]>([]);
  const [history, setHistory] = useState<ApiClaimHistoryEvent[]>([]);
  const [files, setFiles] = useState<ApiClaimFile[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Add note state
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteIsPublic, setNoteIsPublic] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);

  // Action modals
  const [showDenialForm, setShowDenialForm] = useState(false);
  const [denialExplanation, setDenialExplanation] = useState('');

  const [showSettlementForm, setShowSettlementForm] = useState(false);
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementCoverageType, setSettlementCoverageType] = useState('');
  const [settlementOutcomeType, setSettlementOutcomeType] = useState('Approved');
  const [settlementResolution, setSettlementResolution] = useState('Cash Settlement');
  const [settlementExplanation, setSettlementExplanation] = useState('');

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadUrl, setUploadUrl] = useState('');

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeNote, setCloseNote] = useState('');

  const [showVoidForm, setShowVoidForm] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const [showInfoForm, setShowInfoForm] = useState(false);
  const [infoRequested, setInfoRequested] = useState('');

  const [showReopenForm, setShowReopenForm] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit mode — explicit Edit button → fields become editable → Save button persists
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editRequestedAmt, setEditRequestedAmt] = useState('');
  const [editApprovedAmt, setEditApprovedAmt] = useState('');
  const [editCoverage, setEditCoverage] = useState('');
  const [editContactName, setEditContactName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const startEditing = useCallback(() => {
    setEditRequestedAmt(claim.requestedAmount != null ? String(claim.requestedAmount) : '');
    setEditApprovedAmt(claim.approvedAmount != null ? String(claim.approvedAmount) : '');
    setEditCoverage(claim.coverageType || '');
    setEditContactName(claim.primaryContactName || '');
    setEditEmail(claim.email || '');
    setEditPhone(claim.phone || '');
    setEditing(true);
  }, [claim]);

  const saveEdits = useCallback(async () => {
    setEditSaving(true);
    // Phase 2C: optimistic patch — claims list updates instantly
    const patchFields = {
      requestedAmount: editRequestedAmt.trim() === '' ? undefined : Number(editRequestedAmt),
      approvedAmount: editApprovedAmt.trim() === '' ? undefined : Number(editApprovedAmt),
      coverageType: editCoverage.trim() || undefined,
      primaryContactName: editContactName.trim() || undefined,
      email: editEmail.trim() || undefined,
      phone: editPhone.trim() || undefined,
    };
    applyClaimPatch?.(claim.claimId, patchFields);
    try {
      await postUpdateClaim({
        claimId: claim.claimId,
        requestedAmount: editRequestedAmt.trim() === '' ? null : Number(editRequestedAmt),
        approvedAmount: editApprovedAmt.trim() === '' ? null : Number(editApprovedAmt),
        coverageType: editCoverage.trim(),
        primaryContactName: editContactName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
      });
      // Update local claim state so UI reflects changes immediately
      setClaim(prev => ({ ...prev, ...patchFields }));
      setEditing(false);
      setActionSuccess('Changes saved');
      setTimeout(() => setActionSuccess(null), 3000);
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } catch (e) {
      clearClaimPatch?.(claim.claimId); // rollback
      setActionError('Failed to save changes');
    }
    setEditSaving(false);
  }, [claim.claimId, editRequestedAmt, editApprovedAmt, editCoverage, editContactName, editEmail, editPhone, onUpdated, applyClaimPatch, clearClaimPatch]);

  const hasApi = isApiConfigured();

  const loadDetail = useCallback(async () => {
    if (!hasApi) return;
    setDetailLoading(true);
    try {
      const res = await fetchClaimDetail(claim.claimId);
      if (res.ok && res.data) {
        // Update claim from detail (may have first-review stamp)
        const d = res.data;
        setClaim(prev => ({
          ...prev,
          firstReviewedBy: d.claim.firstReviewedBy || prev.firstReviewedBy,
          firstReviewedAt: d.claim.firstReviewedAt || prev.firstReviewedAt,
          status: d.claim.status as typeof prev.status || prev.status,
          currentSettlementFileUrl: d.claim.currentSettlementFileUrl || prev.currentSettlementFileUrl,
          currentSettlementVersion: d.claim.currentSettlementVersion || prev.currentSettlementVersion,
          approvedAmount: d.claim.approvedAmount ?? prev.approvedAmount,
          outcomeType: d.claim.outcomeType || prev.outcomeType,
          resolutionType: d.claim.resolutionType || prev.resolutionType,
        }));
        setDetailItems(d.items || []);
        setHistory(d.history || []);
        setFiles(d.files || []);
      }
    } catch {
      // detail load failed silently
    } finally {
      setDetailLoading(false);
    }
  }, [claim.claimId, hasApi]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const sc = STATUS_CFG[claim.status] || STATUS_CFG['Under Review'];
  const tc = TYPE_CFG[claim.claimType] || TYPE_CFG['Item Claim'];

  const isActive = !['Closed', 'Void'].includes(claim.status);
  const isSettlementSent = claim.status === 'Settlement Sent';
  const isClosed = claim.status === 'Closed';
  const isVoid = claim.status === 'Void';

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setNoteLoading(true);
    setActionError(null);
    const res = await postAddClaimNote({ claimId: claim.claimId, noteText: noteText.trim(), isPublic: noteIsPublic });
    setNoteLoading(false);
    if (res.ok) {
      setNoteText('');
      setShowNoteForm(false);
      setActionSuccess('Note added');
      await loadDetail();
      // Note-adding doesn't change the claim list view — just trigger a refresh
      onUpdated?.();
    } else {
      setActionError(res.error || 'Failed to add note');
    }
  }

  async function handleRequestMoreInfo() {
    setActionLoading(true);
    setActionError(null);
    // Phase 2C: optimistic patch — claims list shows "Waiting on Info" immediately
    applyClaimPatch?.(claim.claimId, { status: 'Waiting on Info' });
    const res = await postRequestMoreInfo({ claimId: claim.claimId, infoRequested: infoRequested.trim() || undefined });
    setActionLoading(false);
    if (res.ok) {
      setShowInfoForm(false);
      setInfoRequested('');
      setActionSuccess('Status updated to Waiting on Info — email sent to claimant');
      setClaim(prev => ({ ...prev, status: 'Waiting on Info' }));
      await loadDetail();
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } else {
      clearClaimPatch?.(claim.claimId); // rollback
      setActionError(res.error || 'Failed');
    }
  }

  async function handleSendDenial() {
    if (!denialExplanation.trim()) return;
    setActionLoading(true);
    setActionError(null);
    // Phase 2C: optimistic patch
    applyClaimPatch?.(claim.claimId, { status: 'Closed', outcomeType: 'Denied' });
    const res = await postSendClaimDenial({ claimId: claim.claimId, decisionExplanation: denialExplanation.trim() });
    setActionLoading(false);
    if (res.ok) {
      setShowDenialForm(false);
      setActionSuccess('Denial sent — claim closed');
      setClaim(prev => ({ ...prev, status: 'Closed', outcomeType: 'Denied' }));
      await loadDetail();
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } else {
      clearClaimPatch?.(claim.claimId);
      setActionError(res.error || 'Failed');
    }
  }

  async function handleGenerateSettlement() {
    const amt = parseFloat(settlementAmount);
    if (isNaN(amt) || amt <= 0) { setActionError('Enter a valid approved amount'); return; }
    setActionLoading(true);
    setActionError(null);
    if (!settlementCoverageType.trim()) { setActionError('Coverage type is required'); setActionLoading(false); return; }
    // Phase 2C: optimistic patch
    applyClaimPatch?.(claim.claimId, {
      status: 'Settlement Sent',
      approvedAmount: amt,
      resolutionType: settlementResolution,
      outcomeType: settlementOutcomeType,
      coverageType: settlementCoverageType.trim(),
    });
    const res = await postGenerateClaimSettlement({
      claimId: claim.claimId,
      approvedAmount: amt,
      coverageType: settlementCoverageType.trim(),
      outcomeType: settlementOutcomeType,
      resolutionType: settlementResolution,
      decisionExplanation: settlementExplanation.trim() || undefined,
    });
    setActionLoading(false);
    if (res.ok && res.data) {
      setShowSettlementForm(false);
      setActionSuccess(`Settlement v${res.data.versionNo} generated${res.data.emailSent ? ' — email sent to claimant' : ''}`);
      setClaim(prev => ({
        ...prev,
        status: 'Settlement Sent',
        approvedAmount: amt,
        resolutionType: settlementResolution,
        currentSettlementFileUrl: res.data!.fileUrl,
        currentSettlementVersion: String(res.data!.versionNo),
      }));
      await loadDetail();
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } else {
      clearClaimPatch?.(claim.claimId);
      setActionError(res.error || 'Failed to generate settlement');
    }
  }

  const isFolderUrl = uploadUrl.includes('/folders/') || uploadUrl.includes('folderview');

  async function handleUploadSigned() {
    if (!uploadUrl.trim()) return;
    if (isFolderUrl) {
      setActionError('That looks like a folder URL. Please paste the direct link to the signed file (e.g. https://drive.google.com/file/d/...)');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    // Phase 2C: optimistic patch
    applyClaimPatch?.(claim.claimId, { status: 'Approved' });
    const res = await postUploadSignedSettlement({ claimId: claim.claimId, driveFileUrl: uploadUrl.trim() });
    setActionLoading(false);
    if (res.ok) {
      setShowUploadForm(false);
      setActionSuccess('Signed settlement recorded — claim approved');
      setClaim(prev => ({ ...prev, status: 'Approved' }));
      await loadDetail();
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } else {
      clearClaimPatch?.(claim.claimId);
      setActionError(res.error || 'Failed');
    }
  }

  async function handleClose() {
    setActionLoading(true);
    setActionError(null);
    applyClaimPatch?.(claim.claimId, { status: 'Closed' });
    const res = await postCloseClaim({ claimId: claim.claimId, closeNote: closeNote.trim() || undefined });
    setActionLoading(false);
    if (res.ok) {
      setShowCloseForm(false);
      setActionSuccess('Claim closed');
      setClaim(prev => ({ ...prev, status: 'Closed' }));
      await loadDetail();
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } else {
      clearClaimPatch?.(claim.claimId);
      setActionError(res.error || 'Failed');
    }
  }

  async function handleVoid() {
    if (!voidReason.trim()) return;
    setActionLoading(true);
    setActionError(null);
    applyClaimPatch?.(claim.claimId, { status: 'Void', voidReason: voidReason.trim() });
    const res = await postVoidClaim({ claimId: claim.claimId, voidReason: voidReason.trim() });
    setActionLoading(false);
    if (res.ok) {
      setShowVoidForm(false);
      setActionSuccess('Claim voided');
      setClaim(prev => ({ ...prev, status: 'Void', voidReason: voidReason.trim() }));
      await loadDetail();
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } else {
      clearClaimPatch?.(claim.claimId);
      setActionError(res.error || 'Failed');
    }
  }

  async function handleReopen() {
    setActionLoading(true);
    setActionError(null);
    applyClaimPatch?.(claim.claimId, { status: 'Under Review' });
    const res = await postReopenClaim({ claimId: claim.claimId, reopenReason: reopenReason.trim() || undefined });
    setActionLoading(false);
    if (res.ok) {
      setShowReopenForm(false);
      setReopenReason('');
      setActionSuccess('Claim reopened — status reset to Under Review');
      setClaim(prev => ({ ...prev, status: 'Under Review' }));
      await loadDetail();
      clearClaimPatch?.(claim.claimId);
      onUpdated?.();
    } else {
      clearClaimPatch?.(claim.claimId);
      setActionError(res.error || 'Failed');
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 13,
    border: `1px solid ${theme.colors.border}`, borderRadius: 8,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'details', label: 'Details' },
    { id: 'items', label: 'Items', count: detailItems.length },
    { id: 'history', label: 'History', count: history.length },
    { id: 'files', label: 'Files', count: files.length },
  ];

  return (
    <>
      {!isMobile && <div onClick={onClose} style={panelBackdropStyle} />}
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && <div onMouseDown={handleResizeMouseDown} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 101 }} />}

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{claim.claimId}</div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                {claim.companyClientName}
                {claim.primaryContactName && ` · ${claim.primaryContactName}`}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge t={claim.status} bg={sc.bg} color={sc.color} />
            <Badge t={claim.claimType} bg={tc.bg} color={tc.color} />
            {claim.outcomeType && (
              <span style={{ fontSize: 11, color: theme.colors.textSecondary, padding: '2px 8px', background: theme.colors.bgSubtle, borderRadius: 10 }}>
                {claim.outcomeType}
              </span>
            )}
            {claim.approvedAmount != null && (
              <span style={{ fontSize: 12, fontWeight: 600, color: '#15803D', padding: '2px 10px', background: '#F0FDF4', borderRadius: 10 }}>
                {fmtMoney(claim.approvedAmount)} approved
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              flex: 1, padding: '10px 4px', fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? theme.colors.orange : theme.colors.textSecondary,
              background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === tab.id ? theme.colors.orange : 'transparent'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span style={{ marginLeft: 4, fontSize: 10, background: activeTab === tab.id ? theme.colors.orangeLight : theme.colors.bgSubtle, color: activeTab === tab.id ? theme.colors.orange : theme.colors.textMuted, borderRadius: 8, padding: '1px 5px', fontWeight: 600 }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Action feedback */}
        {actionSuccess && (
          <div style={{ background: '#F0FDF4', borderBottom: `1px solid #BBF7D0`, padding: '8px 20px', fontSize: 12, color: '#15803D', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <CheckCircle size={13} />
            {actionSuccess}
            <button onClick={() => setActionSuccess(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#15803D', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )}
        {actionError && (
          <div style={{ background: '#FEF2F2', borderBottom: `1px solid #FECACA`, padding: '8px 20px', fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <XCircle size={13} />
            {actionError}
            <button onClick={() => setActionError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* DETAILS TAB */}
          {activeTab === 'details' && (
            <>
              {/* Issue description */}
              <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <SectionHeader icon={<AlertTriangle size={14} color={theme.colors.orange} />} label="Issue Description" />
                <div style={{ fontSize: 13, color: theme.colors.text, lineHeight: 1.6 }}>{claim.issueDescription || '—'}</div>
              </div>

              {/* Edit / Save / Cancel bar */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {!editing ? (
                  <button onClick={startEditing} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.orange}`, borderRadius: 8, background: '#fff', color: theme.colors.orange, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Edit Details
                  </button>
                ) : (
                  <>
                    <button onClick={saveEdits} disabled={editSaving} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', opacity: editSaving ? 0.6 : 1 }}>
                      {editSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button onClick={() => setEditing(false)} disabled={editSaving} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                  </>
                )}
              </div>

              {/* Contact info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginBottom: 12 }}>
                <Field label="Company / Client" value={claim.companyClientName} />
                {editing ? <EditField label="Primary Contact" value={editContactName} onChange={setEditContactName} onBlur={() => {}} /> : <Field label="Primary Contact" value={claim.primaryContactName} />}
                {editing ? <EditField label="Email" value={editEmail} onChange={setEditEmail} onBlur={() => {}} /> : <Field label="Email" value={claim.email} />}
                {editing ? <EditField label="Phone" value={editPhone} onChange={setEditPhone} onBlur={() => {}} /> : <Field label="Phone" value={claim.phone} />}
              </div>

              {/* Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginBottom: 12 }}>
                <Field label="Date Opened" value={fmt(claim.dateOpened)} />
                <Field label="Incident Date" value={fmt(claim.incidentDate)} />
                {claim.dateSettlementSent && <Field label="Settlement Sent" value={fmt(claim.dateSettlementSent)} />}
                {claim.dateSignedSettlementReceived && <Field label="Signed Settlement Received" value={fmt(claim.dateSignedSettlementReceived)} />}
                {claim.dateClosed && <Field label="Date Closed" value={fmt(claim.dateClosed)} />}
              </div>

              {/* Amounts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginBottom: 12 }}>
                {editing ? <EditField label="Requested Amount ($)" value={editRequestedAmt} onChange={setEditRequestedAmt} onBlur={() => {}} type="number" /> : <Field label="Requested Amount" value={claim.requestedAmount != null ? fmtMoney(claim.requestedAmount) : undefined} />}
                {editing ? <EditField label="Approved Amount ($)" value={editApprovedAmt} onChange={setEditApprovedAmt} onBlur={() => {}} type="number" /> : <Field label="Approved Amount" value={claim.approvedAmount != null ? fmtMoney(claim.approvedAmount) : undefined} />}
              </div>

              {/* Coverage */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginBottom: 12 }}>
                {editing ? (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Coverage Type</div>
                    <select value={editCoverage} onChange={e => setEditCoverage(e.target.value)}
                      style={{ width: '100%', padding: '5px 8px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 6, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff', cursor: 'pointer' }}>
                      <option value="">— Not specified —</option>
                      <option>Full Replacement Coverage</option>
                      <option>Full Replacement Coverage with $300 Deductible</option>
                      <option>Standard Valuation Coverage</option>
                    </select>
                  </div>
                ) : <Field label="Coverage Type" value={claim.coverageType} />}
                {claim.clientSelectedCoverage && <Field label="Client Coverage Selection" value={claim.clientSelectedCoverage} />}
                {claim.resolutionType && <Field label="Resolution Type" value={claim.resolutionType} />}
                {claim.outcomeType && <Field label="Outcome" value={claim.outcomeType} />}
              </div>

              {/* Location & Reference */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginBottom: 12 }}>
                {claim.incidentLocation && <Field label="Incident Location" value={claim.incidentLocation} />}
                {claim.propertyIncidentReference && <Field label="Property / Item Reference" value={claim.propertyIncidentReference} />}
              </div>

              {/* Decision explanation */}
              {claim.decisionExplanation && (
                <div style={{ background: '#F0FDF4', border: `1px solid #BBF7D0`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: '#15803D', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Decision Explanation</div>
                  <div style={{ fontSize: 13, color: theme.colors.text, lineHeight: 1.5 }}>{claim.decisionExplanation}</div>
                </div>
              )}

              {/* Void reason */}
              {claim.voidReason && (
                <div style={{ background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Void Reason</div>
                  <div style={{ fontSize: 13, color: theme.colors.text, lineHeight: 1.5 }}>{claim.voidReason}</div>
                </div>
              )}

              {/* Close note */}
              {claim.closeNote && (
                <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Close Note</div>
                  <div style={{ fontSize: 13, color: theme.colors.text, lineHeight: 1.5 }}>{claim.closeNote}</div>
                </div>
              )}

              {/* Internal notes summary */}
              {claim.internalNotesSummary && (
                <div style={{ marginBottom: 12 }}>
                  <Field label="Internal Notes" value={claim.internalNotesSummary} />
                </div>
              )}

              {/* Admin info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px', marginBottom: 12 }}>
                <Field label="Created By" value={claim.createdBy} />
                {claim.firstReviewedBy && <Field label="First Reviewed By" value={claim.firstReviewedBy} />}
                {claim.firstReviewedAt && <Field label="First Reviewed At" value={fmt(claim.firstReviewedAt)} />}
              </div>

              {/* Folder link */}
              {claim.claimFolderUrl && (
                <a href={claim.claimFolderUrl} target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`,
                  borderRadius: 10, fontSize: 12, color: theme.colors.primary, textDecoration: 'none', marginBottom: 12,
                }}>
                  <FolderOpen size={14} /> View Claim Folder <ExternalLink size={11} style={{ marginLeft: 'auto' }} />
                </a>
              )}

              {/* Current settlement file */}
              {claim.currentSettlementFileUrl && (
                <a href={claim.currentSettlementFileUrl} target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#EDE9FE', border: `1px solid #C4B5FD`,
                  borderRadius: 10, fontSize: 12, color: '#7C3AED', textDecoration: 'none', marginBottom: 12,
                }}>
                  <FileText size={14} /> Current Settlement
                  {claim.currentSettlementVersion && ` (v${claim.currentSettlementVersion})`}
                  <ExternalLink size={11} style={{ marginLeft: 'auto' }} />
                </a>
              )}

              {/* Add note form */}
              {showNoteForm && hasApi && (
                <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<MessageSquare size={13} color={theme.colors.textSecondary} />} label="Add Note" />
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Enter note..."
                    style={{ ...inputStyle, resize: 'vertical', marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={noteIsPublic} onChange={e => setNoteIsPublic(e.target.checked)} style={{ accentColor: theme.colors.orange }} />
                      Public note (visible in external communications)
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setShowNoteForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                      <WriteButton label={noteLoading ? 'Saving...' : 'Save Note'} size="sm" onClick={handleAddNote} disabled={!noteText.trim() || noteLoading} />
                    </div>
                  </div>
                </div>
              )}

              {/* Request More Info form */}
              {showInfoForm && hasApi && (
                <div style={{ background: '#EFF6FF', border: `1px solid #BFDBFE`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<Info size={13} color="#1D4ED8" />} label="Request More Info" />
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>INFORMATION NEEDED (OPTIONAL)</label>
                    <textarea value={infoRequested} onChange={e => setInfoRequested(e.target.value)} rows={3}
                      style={{ ...inputStyle, resize: 'vertical' }} placeholder="Describe what additional info is needed from the claimant..." />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowInfoForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <WriteButton label={actionLoading ? 'Sending...' : 'Send & Update Status'} size="sm" onClick={handleRequestMoreInfo} disabled={actionLoading} />
                  </div>
                </div>
              )}

              {/* Settlement form */}
              {showSettlementForm && hasApi && (
                <div style={{ background: '#EDE9FE', border: `1px solid #C4B5FD`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<FileText size={13} color="#7C3AED" />} label="Generate Settlement" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>APPROVED AMOUNT *</label>
                      <input type="number" value={settlementAmount} onChange={e => setSettlementAmount(e.target.value)}
                        placeholder="0.00" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>OUTCOME TYPE *</label>
                      <select value={settlementOutcomeType} onChange={e => setSettlementOutcomeType(e.target.value)} style={{ ...inputStyle }}>
                        {['Approved', 'Partial Approval'].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>COVERAGE TYPE *</label>
                      <input value={settlementCoverageType} onChange={e => setSettlementCoverageType(e.target.value)}
                        placeholder="e.g. Full Replacement Coverage" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>RESOLUTION TYPE</label>
                      <select value={settlementResolution} onChange={e => setSettlementResolution(e.target.value)} style={{ ...inputStyle }}>
                        {['Cash Settlement', 'Repair', 'Replace', 'Other'].map(r => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>DECISION EXPLANATION (OPTIONAL)</label>
                    <textarea value={settlementExplanation} onChange={e => setSettlementExplanation(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none' }} placeholder="Explanation to include in settlement document..." />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowSettlementForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <WriteButton label={actionLoading ? 'Generating...' : 'Generate & Email'} size="sm" onClick={handleGenerateSettlement} disabled={actionLoading} />
                  </div>
                </div>
              )}

              {/* Upload signed settlement form */}
              {showUploadForm && hasApi && (
                <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<Upload size={13} color={theme.colors.textSecondary} />} label="Upload Signed Settlement" />
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>GOOGLE DRIVE FILE URL *</label>
                    <input value={uploadUrl} onChange={e => setUploadUrl(e.target.value)} placeholder="https://drive.google.com/file/d/..." style={{ ...inputStyle, borderColor: isFolderUrl ? '#DC2626' : undefined }} />
                    {isFolderUrl && (
                      <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={11} /> This looks like a folder URL — paste the direct file link instead
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 3 }}>
                      Right-click the signed file in Google Drive → "Get link" or open the file and copy the URL
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowUploadForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <WriteButton label={actionLoading ? 'Saving...' : 'Record Signed Settlement'} size="sm" onClick={handleUploadSigned} disabled={!uploadUrl.trim() || actionLoading || isFolderUrl} />
                  </div>
                </div>
              )}

              {/* Denial form */}
              {showDenialForm && hasApi && (
                <div style={{ background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<XCircle size={13} color="#DC2626" />} label="Send Denial" />
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>DENIAL EXPLANATION *</label>
                    <textarea value={denialExplanation} onChange={e => setDenialExplanation(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'none' }} placeholder="Reason for denial to include in email..." />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowDenialForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <WriteButton label={actionLoading ? 'Sending...' : 'Send Denial & Close'} size="sm" variant="danger" onClick={handleSendDenial} disabled={!denialExplanation.trim() || actionLoading} />
                  </div>
                </div>
              )}

              {/* Close form */}
              {showCloseForm && hasApi && (
                <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<CheckCircle size={13} color="#6B7280" />} label="Close Claim" />
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>CLOSE NOTE (OPTIONAL)</label>
                    <textarea value={closeNote} onChange={e => setCloseNote(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none' }} placeholder="Add a note about how this was resolved..." />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowCloseForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <WriteButton label={actionLoading ? 'Closing...' : 'Close Claim'} size="sm" onClick={handleClose} disabled={actionLoading} />
                  </div>
                </div>
              )}

              {/* Void form */}
              {showVoidForm && hasApi && (
                <div style={{ background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<XCircle size={13} color="#DC2626" />} label="Void Claim" />
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>VOID REASON *</label>
                    <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none' }} placeholder="Reason this claim is being voided..." />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowVoidForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <WriteButton label={actionLoading ? 'Voiding...' : 'Void Claim'} size="sm" variant="danger" onClick={handleVoid} disabled={!voidReason.trim() || actionLoading} />
                  </div>
                </div>
              )}

              {/* Reopen form */}
              {showReopenForm && hasApi && (
                <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <SectionHeader icon={<RotateCcw size={13} color={theme.colors.textSecondary} />} label="Reopen Claim" />
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>REASON FOR REOPENING (OPTIONAL)</label>
                    <textarea value={reopenReason} onChange={e => setReopenReason(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none' }} placeholder="Why is this claim being reopened?" />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowReopenForm(false)} style={{ padding: '5px 10px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <WriteButton label={actionLoading ? 'Reopening...' : 'Reopen Claim'} size="sm" onClick={handleReopen} disabled={actionLoading} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ITEMS TAB */}
          {activeTab === 'items' && (
            <>
              {detailLoading && <div style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', padding: 24 }}>Loading items...</div>}
              {!detailLoading && detailItems.length === 0 && (
                <div style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', padding: 32 }}>
                  <Package size={28} style={{ opacity: 0.3, marginBottom: 8 }} /><br />
                  No items linked to this claim
                </div>
              )}
              {detailItems.map((item, i) => (
                <div key={i} style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>{item.itemId}</span>
                    {item.statusSnapshot && (
                      <span style={{ fontSize: 10, background: '#F3F4F6', color: '#6B7280', padding: '2px 8px', borderRadius: 8 }}>{item.statusSnapshot}</span>
                    )}
                  </div>
                  {item.itemDescriptionSnapshot && (
                    <div style={{ fontSize: 12, color: theme.colors.text, marginBottom: 4 }}>{item.itemDescriptionSnapshot}</div>
                  )}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {item.vendorSnapshot && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Vendor: {item.vendorSnapshot}</span>}
                    {item.classSnapshot && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Class: {item.classSnapshot}</span>}
                    {item.locationSnapshot && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Location: {item.locationSnapshot}</span>}
                    {item.sidemarkSnapshot && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Sidemark: {item.sidemarkSnapshot}</span>}
                  </div>
                  {item.addedBy && (
                    <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 4 }}>
                      Added {fmtTimestamp(item.addedAt)} by {item.addedBy.split('@')[0]}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* HISTORY TAB */}
          {activeTab === 'history' && (
            <>
              {detailLoading && <div style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', padding: 24 }}>Loading history...</div>}
              {!detailLoading && history.length === 0 && (
                <div style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', padding: 32 }}>
                  <Clock size={28} style={{ opacity: 0.3, marginBottom: 8 }} /><br />
                  No history events yet
                </div>
              )}
              {history.map((evt, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: evt.isPublic ? '#EDE9FE' : theme.colors.bgSubtle, border: `1px solid ${evt.isPublic ? '#C4B5FD' : theme.colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {evt.isPublic
                      ? <Info size={12} color="#7C3AED" />
                      : <MessageSquare size={12} color={theme.colors.textMuted} />
                    }
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: theme.colors.text }}>{evt.eventType}</span>
                      <span style={{ fontSize: 10, color: theme.colors.textMuted }}>{fmtTimestamp(evt.eventTimestamp)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.4 }}>{evt.eventMessage}</div>
                    {evt.actor && <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 2 }}>{evt.actor.split('@')[0]}</div>}
                    {evt.relatedFileUrl && (
                      <a href={evt.relatedFileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: theme.colors.orange, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, textDecoration: 'none' }}>
                        <FileText size={11} /> View file
                      </a>
                    )}
                    {evt.isPublic && (
                      <span style={{ display: 'inline-block', marginTop: 4, fontSize: 9, background: '#EDE9FE', color: '#7C3AED', borderRadius: 6, padding: '1px 6px', fontWeight: 600 }}>PUBLIC</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* FILES TAB */}
          {activeTab === 'files' && (
            <>
              {detailLoading && <div style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', padding: 24 }}>Loading files...</div>}
              {!detailLoading && files.length === 0 && (
                <div style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', padding: 32 }}>
                  <FileText size={28} style={{ opacity: 0.3, marginBottom: 8 }} /><br />
                  No files yet
                </div>
              )}
              {files.map((file, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: file.isCurrent ? '#EDE9FE' : theme.colors.bgSubtle, border: `1px solid ${file.isCurrent ? '#C4B5FD' : theme.colors.border}`, borderRadius: 10, marginBottom: 8 }}>
                  <FileText size={14} color={file.isCurrent ? '#7C3AED' : theme.colors.textMuted} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {file.fileName || file.fileType}
                      {file.isCurrent && <span style={{ fontSize: 9, background: '#7C3AED', color: '#fff', borderRadius: 6, padding: '1px 6px', fontWeight: 600 }}>CURRENT</span>}
                      {file.versionNo != null && <span style={{ fontSize: 10, color: theme.colors.textMuted }}>v{file.versionNo}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: theme.colors.textMuted }}>
                      {file.fileType} {file.createdAt && `· ${fmtTimestamp(file.createdAt)}`} {file.createdBy && `· ${file.createdBy.split('@')[0]}`}
                    </div>
                  </div>
                  <a href={file.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: file.isCurrent ? '#7C3AED' : theme.colors.textSecondary, flexShrink: 0 }}>
                    <ExternalLink size={13} />
                  </a>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          {/* Primary action buttons based on status */}
          {hasApi && activeTab === 'details' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {/* Add Note — always available on active claims */}
              {isActive && (
                <button
                  onClick={() => { setShowNoteForm(!showNoteForm); setShowDenialForm(false); setShowSettlementForm(false); setShowUploadForm(false); setShowCloseForm(false); setShowVoidForm(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary, fontWeight: 400 }}
                >
                  <MessageSquare size={12} /> {showNoteForm ? 'Cancel Note' : 'Add Note'}
                </button>
              )}
              {/* Request More Info */}
              {claim.status === 'Under Review' && (
                <button
                  onClick={() => { setShowInfoForm(!showInfoForm); setShowNoteForm(false); setShowDenialForm(false); setShowSettlementForm(false); setShowUploadForm(false); setShowCloseForm(false); setShowVoidForm(false); setShowReopenForm(false); }}
                  disabled={actionLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#EFF6FF', cursor: 'pointer', color: '#1D4ED8', fontWeight: 500 }}
                >
                  <Info size={12} /> {showInfoForm ? 'Cancel' : 'Request More Info'}
                </button>
              )}
              {/* Generate Settlement */}
              {(claim.status === 'Under Review' || claim.status === 'Waiting on Info') && (
                <WriteButton
                  label={showSettlementForm ? 'Cancel Settlement' : 'Generate Settlement'}
                  icon={<FileText size={12} />}
                  size="sm"
                  onClick={async () => { setShowSettlementForm(!showSettlementForm); setShowNoteForm(false); setShowDenialForm(false); setShowUploadForm(false); setShowCloseForm(false); setShowVoidForm(false); }}
                />
              )}
              {/* Upload Signed Settlement */}
              {isSettlementSent && (
                <WriteButton
                  label={showUploadForm ? 'Cancel Upload' : 'Upload Signed Settlement'}
                  icon={<Upload size={12} />}
                  size="sm"
                  onClick={async () => { setShowUploadForm(!showUploadForm); setShowNoteForm(false); setShowSettlementForm(false); setShowCloseForm(false); setShowVoidForm(false); }}
                />
              )}
              {/* Send Denial */}
              {isActive && claim.status !== 'Approved' && (
                <button
                  onClick={() => { setShowDenialForm(!showDenialForm); setShowNoteForm(false); setShowSettlementForm(false); setShowUploadForm(false); setShowCloseForm(false); setShowVoidForm(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 12, border: `1px solid #FECACA`, borderRadius: 8, background: '#FEF2F2', cursor: 'pointer', color: '#DC2626', fontWeight: 500 }}
                >
                  <XCircle size={12} /> {showDenialForm ? 'Cancel' : 'Deny Claim'}
                </button>
              )}
            </div>
          )}

          {/* Secondary actions row */}
          {hasApi && activeTab === 'details' && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {/* Close */}
              {isActive && !isClosed && !isVoid && (
                <button
                  onClick={() => { setShowCloseForm(!showCloseForm); setShowNoteForm(false); setShowSettlementForm(false); setShowUploadForm(false); setShowDenialForm(false); setShowVoidForm(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}
                >
                  <CheckCircle size={11} /> {showCloseForm ? 'Cancel' : 'Close'}
                </button>
              )}
              {/* Void */}
              {!isVoid && (
                <button
                  onClick={() => { setShowVoidForm(!showVoidForm); setShowNoteForm(false); setShowSettlementForm(false); setShowUploadForm(false); setShowDenialForm(false); setShowCloseForm(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', fontSize: 11, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', color: theme.colors.textSecondary }}
                >
                  <XCircle size={11} /> {showVoidForm ? 'Cancel' : 'Void'}
                </button>
              )}
              {/* Reopen */}
              {(isClosed || isVoid) && (
                <WriteButton
                  label={showReopenForm ? 'Cancel' : 'Reopen Claim'}
                  icon={<RotateCcw size={11} />}
                  size="sm"
                  variant="ghost"
                  onClick={async () => { setShowReopenForm(!showReopenForm); setShowNoteForm(false); setShowSettlementForm(false); setShowUploadForm(false); setShowDenialForm(false); setShowCloseForm(false); setShowVoidForm(false); }}
                  disabled={actionLoading}
                />
              )}
            </div>
          )}

          {/* Non-API mode footer */}
          {!hasApi && (
            <div style={{ fontSize: 12, color: theme.colors.textMuted, textAlign: 'center', padding: '4px 0' }}>
              Connect API to enable claim actions
            </div>
          )}
        </div>
      </div>
    </>
  );
}
