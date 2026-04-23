import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX, ExternalLink, Pencil, X } from 'lucide-react';
import { theme } from '../styles/theme';
import { useRepairDetail } from '../hooks/useRepairDetail';
import { useAuth } from '../contexts/AuthContext';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';
import {
  postSendRepairQuote,
  postRespondToRepairQuote,
  postStartRepair,
  postCompleteRepair,
  postUpdateRepairNotes,
  postCancelRepair,
  postReopenRepair,
  postCorrectRepairResult,
} from '../lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

const REPAIR_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Pending Quote': { bg: theme.colors.statusAmberBg,  color: theme.colors.statusAmber },
  'Quote Sent':    { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Approved':      { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  'Declined':      { bg: theme.colors.statusRedBg,    color: theme.colors.statusRed },
  'In Progress':   { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Complete':      { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  'Failed':        { bg: theme.colors.statusRedBg,    color: theme.colors.statusRed },
  'Cancelled':     { bg: theme.colors.statusGrayBg,   color: theme.colors.statusGray },
};

function StatusBadge({ status }: { status: string }) {
  const c = REPAIR_STATUS_COLORS[status] ?? { bg: theme.colors.statusGrayBg, color: theme.colors.statusGray };
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
  { label: 'All',            actions: [] },
  { label: 'Status Changes', actions: ['status_change', 'start', 'complete', 'cancel'] },
  { label: 'Quotes',         actions: ['update'] },
  { label: 'Notes',          actions: ['update'] },
  { label: 'Billing',        actions: ['create'] },
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
            <button
              key={f.label + i}
              onClick={() => setActiveFilter(i)}
              style={{
                padding: `4px ${theme.spacing.md}`,
                borderRadius: theme.radii.full,
                border: 'none', fontFamily: 'inherit',
                fontSize: theme.typography.sizes.xs,
                fontWeight: theme.typography.weights.semibold,
                cursor: 'pointer',
                background: isActive ? EntityPageTokens.tabActive : theme.colors.bgSubtle,
                color: isActive ? '#fff' : theme.colors.textSecondary,
                transition: `background ${theme.transitions.fast}, color ${theme.transitions.fast}`,
              }}
            >{f.label}</button>
          );
        })}
      </div>
      <EPCard style={{ padding: '8px 14px' }}>
        <EntityHistory
          entityType="repair"
          entityId={entityId}
          tenantId={tenantId}
          defaultExpanded
          actionFilter={currentFilter.actions.length > 0 ? currentFilter.actions : undefined}
        />
      </EPCard>
    </div>
  );
}

// ── Details tab ───────────────────────────────────────────────────────────────

type Repair = NonNullable<ReturnType<typeof useRepairDetail>['repair']>;

interface DetailsTabProps {
  repair: Repair;
  isStaff: boolean;
  isAdmin: boolean;
  onNavigateToItem: (id: string) => void;
  onNavigateToTask: (id: string) => void;
  onRefetch: () => void;
}

function DetailsTab({ repair, isStaff, isAdmin, onNavigateToItem, onNavigateToTask, onRefetch }: DetailsTabProps) {
  const isActive    = !['Complete', 'Cancelled', 'Declined'].includes(repair.status);
  const isCompleted = repair.status === 'Complete';

  // ── Repair fields edit mode ──
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editVendor, setEditVendor] = useState('');
  const [editScheduled, setEditScheduled] = useState('');
  const [editStart, setEditStart] = useState('');

  // ── Notes (editable separately) ──
  const [repairNotes, setRepairNotes] = useState(repair.repairNotes ?? '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const notesDirty = repairNotes !== (repair.repairNotes ?? '');

  // ── Correct result widget ──
  const [showCorrectResult, setShowCorrectResult] = useState(false);
  const [correctingResult, setCorrectingResult] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);

  function handleEditStart() {
    setEditVendor(repair.repairVendor ?? '');
    setEditScheduled(repair.scheduledDate ? repair.scheduledDate.split('T')[0] : '');
    setEditStart(repair.startDate ? repair.startDate.split('T')[0] : '');
    setEditError(null);
    setIsEditing(true);
  }

  async function handleEditSave() {
    if (!repair.clientSheetId) return;
    setSaving(true);
    setEditError(null);
    try {
      await postUpdateRepairNotes(
        {
          repairId: repair.repairId,
          repairVendor: editVendor || undefined,
          scheduledDate: editScheduled || undefined,
          startDate: editStart || undefined,
        },
        repair.clientSheetId,
      );
      onRefetch();
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveNotes() {
    if (!repair.clientSheetId) return;
    setSavingNotes(true);
    try {
      await postUpdateRepairNotes({ repairId: repair.repairId, repairNotes }, repair.clientSheetId);
      onRefetch();
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleCorrectResult(newResult: 'Pass' | 'Fail') {
    if (!repair.clientSheetId) return;
    setCorrectingResult(true);
    setCorrectError(null);
    try {
      await postCorrectRepairResult({ repairId: repair.repairId, newResult }, repair.clientSheetId);
      onRefetch();
      setShowCorrectResult(false);
    } catch (err) {
      setCorrectError(err instanceof Error ? err.message : 'Failed to correct result');
    } finally {
      setCorrectingResult(false);
    }
  }

  const showQuote = repair.status === 'Quote Sent' || repair.status === 'Approved' || repair.status === 'Declined';

  return (
    <div>
      {/* Item info card */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          <div>
            <EPLabel>Item ID</EPLabel>
            {repair.itemId ? (
              <button
                onClick={() => onNavigateToItem(repair.itemId!)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, fontFamily: 'inherit',
                  fontSize: theme.typography.sizes.base,
                  fontWeight: theme.typography.weights.semibold,
                  color: theme.colors.orange,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {repair.itemId}
                <ExternalLink size={11} />
              </button>
            ) : (
              <span style={{ fontSize: theme.typography.sizes.base, color: theme.colors.textMuted }}>—</span>
            )}
          </div>
          <Field label="Vendor"      value={repair.vendor} />
          <Field label="Description" value={repair.description} />
          <Field label="Class"       value={repair.itemClass} />
          <Field label="Location"    value={repair.location} />
          <Field label="Sidemark"    value={repair.sidemark} />
          {repair.room && <Field label="Room" value={repair.room} />}
        </div>
      </EPCard>

      {/* Source task card */}
      {repair.sourceTaskId && (
        <EPCard>
          <EPLabel>Source Task</EPLabel>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <button
              onClick={() => onNavigateToTask(repair.sourceTaskId!)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, fontFamily: 'inherit',
                fontSize: theme.typography.sizes.base,
                fontWeight: theme.typography.weights.semibold,
                color: theme.colors.orange,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              {repair.sourceTaskId}
              <ExternalLink size={11} />
            </button>
          </div>
          {repair.taskNotes && (
            <div style={{ marginTop: 8, fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.5 }}>
              {repair.taskNotes}
            </div>
          )}
        </EPCard>
      )}

      {/* Repair details card */}
      <EPCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div />
          {isStaff && isActive && (
            <button
              onClick={isEditing ? () => setIsEditing(false) : handleEditStart}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
            >
              {isEditing ? <X size={14} /> : <Pencil size={14} />}
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          {isEditing ? (
            <>
              <div>
                <EPLabel>Repair Tech</EPLabel>
                <input value={editVendor} onChange={e => setEditVendor(e.target.value)} placeholder="Repair tech / vendor…" style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div>
                <EPLabel>Scheduled Date</EPLabel>
                <input type="date" value={editScheduled} onChange={e => setEditScheduled(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
              </div>
              <div>
                <EPLabel>Start Date</EPLabel>
                <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
              </div>
            </>
          ) : (
            <>
              <Field label="Repair Tech"    value={repair.repairVendor} />
              <Field label="Created By"     value={repair.createdBy} />
              <Field label="Created"        value={fmtDate(repair.createdDate)} />
              {repair.scheduledDate && <Field label="Scheduled"  value={fmtDate(repair.scheduledDate)} />}
              {repair.startDate     && <Field label="Started"    value={fmtDate(repair.startDate)} />}
              {repair.completedDate && <Field label="Completed"  value={fmtDate(repair.completedDate)} />}
            </>
          )}
          {isAdmin && repair.quoteAmount != null && (
            <div>
              <EPLabel>Quote Amount</EPLabel>
              <div style={{ fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.semibold, color: theme.colors.text }}>
                ${Number(repair.quoteAmount).toFixed(2)}
              </div>
            </div>
          )}
        </div>
        {isEditing && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={handleEditSave} disabled={saving} style={{ ...actionBtnStyle, background: theme.colors.orange, color: '#fff' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setIsEditing(false)} style={actionBtnStyle}>Cancel</button>
            {editError && <span style={{ fontSize: 12, color: theme.colors.statusRed }}>{editError}</span>}
          </div>
        )}
      </EPCard>

      {/* Quote card */}
      {showQuote && (
        <EPCard>
          <EPLabel>Quote</EPLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginTop: 4 }}>
            {repair.quoteAmount != null && (
              <div>
                <EPLabel>Amount</EPLabel>
                <div style={{ fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.semibold, color: theme.colors.text }}>
                  ${Number(repair.quoteAmount).toFixed(2)}
                </div>
              </div>
            )}
            {repair.quoteSentDate && <Field label="Sent Date" value={fmtDate(repair.quoteSentDate)} />}
          </div>
          {repair.status === 'Declined' && (
            <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: theme.radii.md, background: theme.colors.statusRedBg, color: theme.colors.statusRed, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold }}>
              Quote declined
            </div>
          )}
          {repair.status === 'Approved' && (
            <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: theme.radii.md, background: theme.colors.statusGreenBg, color: theme.colors.statusGreen, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold }}>
              Quote approved
            </div>
          )}
        </EPCard>
      )}

      {/* Repair notes */}
      <EPCard>
        <EPLabel>Repair Notes</EPLabel>
        {isActive ? (
          <>
            <textarea
              value={repairNotes}
              onChange={e => setRepairNotes(e.target.value)}
              placeholder="Repair notes…"
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit', marginTop: 6 }}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={handleSaveNotes}
                disabled={!notesDirty || savingNotes}
                style={{ ...actionBtnStyle, background: notesDirty ? theme.colors.orange : theme.colors.bgSubtle, color: notesDirty ? '#fff' : theme.colors.textMuted }}
              >
                {savingNotes ? 'Saving…' : notesSaved ? '✓ Saved' : 'Save Notes'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: repair.repairNotes ? theme.colors.text : theme.colors.textMuted, lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 6 }}>
            {repair.repairNotes || '—'}
          </div>
        )}
      </EPCard>

      {/* Repair result */}
      {repair.repairResult && (
        <EPCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <EPLabel>Result</EPLabel>
            {isStaff && isCompleted && !showCorrectResult && (
              <button
                onClick={() => setShowCorrectResult(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: theme.colors.textSecondary, fontFamily: 'inherit' }}
              >
                Correct Result
              </button>
            )}
          </div>
          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, marginBottom: showCorrectResult ? 12 : 0 }}>
            {repair.repairResult}
          </div>
          {showCorrectResult && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>Change to:</span>
              <button onClick={() => handleCorrectResult('Pass')} disabled={correctingResult} style={{ ...actionBtnStyle, background: theme.colors.statusGreenBg, color: theme.colors.statusGreen }}>Pass</button>
              <button onClick={() => handleCorrectResult('Fail')} disabled={correctingResult} style={{ ...actionBtnStyle, background: theme.colors.statusRedBg, color: theme.colors.statusRed }}>Fail</button>
              <button onClick={() => setShowCorrectResult(false)} style={actionBtnStyle}><X size={12} /></button>
              {correctError && <span style={{ fontSize: 12, color: theme.colors.statusRed }}>{correctError}</span>}
            </div>
          )}
        </EPCard>
      )}

      {/* Drive folder links */}
      {(repair.repairFolderUrl || repair.taskFolderUrl || repair.shipmentFolderUrl) && (
        <EPCard>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {repair.repairFolderUrl && (
              <a href={repair.repairFolderUrl} target="_blank" rel="noreferrer" style={folderLinkStyle}>
                <ExternalLink size={13} /> View Repair Folder in Drive
              </a>
            )}
            {repair.taskFolderUrl && (
              <a href={repair.taskFolderUrl} target="_blank" rel="noreferrer" style={folderLinkStyle}>
                <ExternalLink size={13} /> View Task Folder in Drive
              </a>
            )}
            {repair.shipmentFolderUrl && (
              <a href={repair.shipmentFolderUrl} target="_blank" rel="noreferrer" style={folderLinkStyle}>
                <ExternalLink size={13} /> View Shipment Folder in Drive
              </a>
            )}
          </div>
        </EPCard>
      )}
    </div>
  );
}

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

export function RepairPage() {
  const { repairId } = useParams<{ repairId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { repair, status, error, refetch } = useRepairDetail(repairId);

  const isStaff = user?.role === 'admin' || user?.role === 'staff';
  const isAdmin = user?.role === 'admin';

  // ── Action state ──
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [showFailPrompt, setShowFailPrompt] = useState(false);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading repair{repairId ? ` ${repairId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this repair." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Repair Not Found" body={`No repair with ID "${repairId}" was found.`} actions={<button onClick={() => navigate('/repairs')} style={backBtnStyle}>Back to Repairs</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Repair" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/repairs')} style={backBtnStyle}>Back to Repairs</button></div>}
      />
    );
  }
  if (!repair) return null;
  const r = repair;

  const clientSheetId = r.clientSheetId;
  const s = r.status;
  const isActive    = !['Complete', 'Cancelled', 'Declined'].includes(s);
  const isCompleted = s === 'Complete';
  const isInProgress = s === 'In Progress';

  // ── Action handlers ──

  async function handleSendQuote() {
    if (!clientSheetId) return;
    const amount = parseFloat(quoteAmount);
    if (isNaN(amount) || amount < 0) {
      setQuoteError('Enter a valid quote amount');
      return;
    }
    setActionLoading('sendquote');
    setActionError(null);
    setQuoteError(null);
    try {
      await postSendRepairQuote({ repairId: r.repairId, quoteAmount: amount }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to send quote');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRespond(decision: 'Approve' | 'Decline') {
    if (!clientSheetId) return;
    setActionLoading(decision.toLowerCase());
    setActionError(null);
    try {
      await postRespondToRepairQuote({ repairId: r.repairId, decision }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${decision.toLowerCase()} quote`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStartRepair() {
    if (!clientSheetId) return;
    setActionLoading('start');
    setActionError(null);
    try {
      await postStartRepair({ repairId: r.repairId }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start repair');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCompleteRepair(resultValue: 'Pass' | 'Fail') {
    if (!clientSheetId) return;
    setActionLoading(resultValue === 'Pass' ? 'pass' : 'fail');
    setActionError(null);
    setShowFailPrompt(false);
    try {
      await postCompleteRepair({ repairId: r.repairId, resultValue }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to complete repair');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancelRepair() {
    if (!clientSheetId) return;
    if (!window.confirm('Cancel this repair? Status will be set to Cancelled.')) return;
    setActionLoading('cancel');
    setActionError(null);
    setShowFailPrompt(false);
    try {
      await postCancelRepair({ repairId: r.repairId }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel repair');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReopenRepair() {
    if (!clientSheetId) return;
    const promptMsg = isCompleted
      ? 'Reason for reopening? This will revert to In Progress, clear the result, and void billing.'
      : 'Reason for reopening? This will revert to Approved and clear the start date.';
    const reason = window.prompt(promptMsg);
    if (reason === null) return;
    setActionLoading('reopen');
    setActionError(null);
    try {
      await postReopenRepair({ repairId: r.repairId, reason: reason || '' }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reopen repair');
    } finally {
      setActionLoading(null);
    }
  }

  // ── Footer ──
  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {r.itemId && (
          <EPFooterButton
            label="View Item"
            variant="secondary"
            onClick={() => navigate(`/inventory/${r.itemId}`)}
          />
        )}
        {isStaff && isActive && (
          <EPFooterButton
            label={actionLoading === 'cancel' ? 'Cancelling…' : 'Cancel Repair'}
            variant="secondary"
            disabled={!!actionLoading}
            onClick={handleCancelRepair}
          />
        )}
        {isStaff && (isCompleted || isInProgress) && (
          <EPFooterButton
            label={actionLoading === 'reopen' ? 'Reopening…' : 'Reopen'}
            variant="secondary"
            disabled={!!actionLoading}
            onClick={handleReopenRepair}
          />
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {actionError && (
          <span style={{ fontSize: 11, color: theme.colors.statusRed, maxWidth: 200 }}>{actionError}</span>
        )}

        {/* Pending Quote: quote amount input + Send Quote button */}
        {isStaff && s === 'Pending Quote' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#fff', opacity: 0.7 }}>$</span>
                <input
                  type="number"
                  value={quoteAmount}
                  onChange={e => setQuoteAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  style={{ ...inputStyle, width: 90, background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
                />
              </div>
              {quoteError && <span style={{ fontSize: 10, color: theme.colors.statusRed }}>{quoteError}</span>}
            </div>
            <EPFooterButton
              label={actionLoading === 'sendquote' ? 'Sending…' : 'Send Quote'}
              variant="primary"
              disabled={!!actionLoading}
              onClick={handleSendQuote}
            />
          </div>
        )}

        {/* Quote Sent: Decline + Approve */}
        {s === 'Quote Sent' && (
          <>
            <EPFooterButton
              label={actionLoading === 'decline' ? 'Declining…' : 'Decline'}
              variant="secondary"
              disabled={!!actionLoading}
              onClick={() => handleRespond('Decline')}
            />
            <EPFooterButton
              label={actionLoading === 'approve' ? 'Approving…' : 'Approve Quote'}
              variant="primary"
              disabled={!!actionLoading}
              onClick={() => handleRespond('Approve')}
            />
          </>
        )}

        {/* Approved: Start Repair */}
        {isStaff && s === 'Approved' && (
          <EPFooterButton
            label={actionLoading === 'start' ? 'Starting…' : 'Start Repair'}
            variant="primary"
            disabled={!!actionLoading}
            onClick={handleStartRepair}
          />
        )}

        {/* In Progress: Fail + Complete */}
        {isStaff && isInProgress && (
          <>
            <EPFooterButton
              label={actionLoading === 'fail' ? 'Failing…' : 'Fail'}
              variant="secondary"
              disabled={!!actionLoading}
              onClick={() => setShowFailPrompt(true)}
            />
            <EPFooterButton
              label={actionLoading === 'pass' ? 'Completing…' : 'Complete'}
              variant="primary"
              disabled={!!actionLoading}
              onClick={() => handleCompleteRepair('Pass')}
            />
          </>
        )}
      </div>

      {/* Fail choice overlay */}
      {showFailPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: theme.radii.xl, padding: 24, maxWidth: 360, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: theme.colors.text, marginBottom: 8 }}>Fail Repair</div>
            <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 20 }}>How would you like to handle this repair?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => handleCompleteRepair('Fail')} disabled={!!actionLoading}
                style={{ ...actionBtnStyle, background: theme.colors.statusRedBg, color: theme.colors.statusRed, padding: '10px 16px', fontSize: 14, width: '100%' }}>
                Complete (Bill)
              </button>
              <button onClick={handleCancelRepair} disabled={!!actionLoading}
                style={{ ...actionBtnStyle, background: theme.colors.bgSubtle, color: theme.colors.text, padding: '10px 16px', fontSize: 14, width: '100%' }}>
                Cancel (No Bill)
              </button>
              <button onClick={() => setShowFailPrompt(false)}
                style={{ ...actionBtnStyle, background: 'none', color: theme.colors.textSecondary, padding: '8px 16px', fontSize: 13, width: '100%' }}>
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const tabs = [
    {
      id: 'details',
      label: 'Details',
      keepMounted: true,
      render: () => (
        <DetailsTab
          repair={r}
          isStaff={isStaff}
          isAdmin={isAdmin}
          onNavigateToItem={id => navigate(`/inventory/${id}`)}
          onNavigateToTask={id => navigate(`/tasks/${id}`)}
          onRefetch={refetch}
        />
      ),
    },
    { id: 'photos',   label: 'Photos' },
    { id: 'docs',     label: 'Docs' },
    { id: 'notes',    label: 'Notes' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <EntityPage
      entityLabel="Repair"
      entityId={r.repairId}
      statusBadge={<StatusBadge status={r.status} />}
      clientName={r.clientName}
      tabs={tabs}
      builtInTabs={{
        photos: { entityType: 'repair', entityId: r.repairId, tenantId: r.clientSheetId },
        docs:   { contextType: 'repair', contextId: r.repairId, tenantId: r.clientSheetId },
        notes:  { entityType: 'repair', entityId: r.repairId, itemId: r.itemId },
        activity: { render: () => <ActivityTab entityId={r.repairId} tenantId={r.clientSheetId} /> },
      }}
      footer={footer}
    />
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const backBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: `${theme.spacing.sm} ${theme.spacing.lg}`, borderRadius: theme.radii.lg,
  border: `1px solid ${theme.colors.border}`,
  background: theme.colors.bgCard, color: theme.colors.text,
  fontSize: theme.typography.sizes.base, fontWeight: theme.typography.weights.medium,
  cursor: 'pointer', fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: theme.radii.md,
  border: `1px solid ${theme.colors.border}`,
  background: '#fff', color: theme.colors.text,
  fontSize: theme.typography.sizes.sm, fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
};

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '5px 12px', borderRadius: theme.radii.md,
  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.medium,
  background: theme.colors.bgSubtle, color: theme.colors.text,
};

const folderLinkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: theme.typography.sizes.sm,
  color: theme.colors.orange, fontWeight: theme.typography.weights.medium,
  textDecoration: 'none',
};
