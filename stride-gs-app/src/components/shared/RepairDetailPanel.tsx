import React, { useEffect, useState } from 'react';
import { X, Wrench, Package, ClipboardList, CheckCircle2, XCircle, AlertTriangle, Send, Loader2, Truck, Play, Pencil, MapPin } from 'lucide-react';
import { TabbedDetailPanel, type TabbedDetailPanelTab } from './TabbedDetailPanel';
import { FolderButton } from './FolderButton';
import { DeepLink } from './DeepLink';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { postSendRepairQuote, postRespondToRepairQuote, postCompleteRepair, postStartRepair, postCancelRepair, postUpdateRepairNotes, postReopenRepair, postCorrectRepairResult, isApiConfigured } from '../../lib/api';
import { entityEvents } from '../../lib/entityEvents';
import type { ApiRepair, SendRepairQuoteResponse, RespondToRepairQuoteResponse, CompleteRepairResponse, StartRepairResponse } from '../../lib/api';
import { writeSyncFailed } from '../../lib/syncEvents';
import { useAuth } from '../../contexts/AuthContext';

import type { Repair } from '../../lib/types';
interface Props {
  repair: ApiRepair;
  onClose: () => void;
  onRepairUpdated?: () => void;
  onNavigateToItem?: (itemId: string) => void;
  // Phase 2C — optimistic patch functions (optional)
  applyRepairPatch?: (repairId: string, patch: Partial<Repair>) => void;
  mergeRepairPatch?: (repairId: string, patch: Partial<Repair>) => void;
  clearRepairPatch?: (repairId: string) => void;
  addOptimisticRepair?: (repair: Repair) => void;
  removeOptimisticRepair?: (tempRepairId: string) => void;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  'Pending Quote': { bg: '#FEF3C7', color: '#B45309' }, 'Quote Sent': { bg: '#EFF6FF', color: '#1D4ED8' },
  'Approved': { bg: '#F0FDF4', color: '#15803D' }, 'Declined': { bg: '#FEF2F2', color: '#DC2626' },
  'In Progress': { bg: '#EDE9FE', color: '#7C3AED' }, 'Complete': { bg: '#F0FDF4', color: '#15803D' },
  'Cancelled': { bg: '#F3F4F6', color: '#6B7280' },
};

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) { return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>; }
function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) { return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>{String(value ?? '\u2014')}</div></div>; }

const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' };

export function RepairDetailPanel({ repair, onClose, onRepairUpdated, applyRepairPatch, clearRepairPatch }: Props) {
  const { user } = useAuth();
  // v2026-04-22 — panel frame handled by TabbedDetailPanel shell.

  // Derive effective status from submit result (optimistic update).
  // Keep in sync with the repair prop — optimistic patches from the parent
  // hook (applyRepairPatch) update repair.status, and we need the header /
  // action footer to reflect that instead of the initial mount value.
  const [effectiveStatus, setEffectiveStatus] = useState<string>(repair.status);
  useEffect(() => { setEffectiveStatus(repair.status); }, [repair.status]);
  const sc = STATUS_CFG[effectiveStatus] || STATUS_CFG['Pending Quote'];
  const isActive = !['Complete', 'Cancelled', 'Declined'].includes(effectiveStatus);

  // (I)(A)(R) indicator badges for the Item card below.
  const { inspItems, asmItems, repairItems } = useItemIndicators(repair.clientSheetId);

  const [repairNotes, setRepairNotes] = useState(repair.repairNotes || '');
  const [showResultPrompt, setShowResultPrompt] = useState<'fail' | null>(null);
  const [completed, setCompleted] = useState(false);

  // Quote form state
  const [quoteAmountInput, setQuoteAmountInput] = useState<string>(
    repair.quoteAmount != null && repair.quoteAmount !== 0 ? String(repair.quoteAmount) : ''
  );

  // Submit state (shared across actions)
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SendRepairQuoteResponse | null>(null);

  // Approve / Decline state
  const [respondResult, setRespondResult] = useState<RespondToRepairQuoteResponse | null>(null);

  // Complete Repair state
  const [completeResult, setCompleteResult] = useState<CompleteRepairResponse | null>(null);

  // Start Repair state
  const [startResult, setStartResult] = useState<StartRepairResponse | null>(null);

  // v38.61.1 — Save Notes (before Start Repair) state. Separate from `submitting`
  // so the Save Notes button doesn't disable/spin the Approve/Start/Complete buttons.
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);

  // Track the last-saved notes so the Save button can enable only when dirty.
  const [savedRepairNotes, setSavedRepairNotes] = useState(repair.repairNotes || '');
  useEffect(() => { setSavedRepairNotes(repair.repairNotes || ''); }, [repair.repairNotes]);
  const notesDirty = repairNotes !== savedRepairNotes;

  // ─── Stage B: Reopen + Result correction ────────────────────────────────
  const canStaffEdit = user?.role === 'admin' || user?.role === 'staff';
  const [reopenLoading, setReopenLoading] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [showCorrectRepairResult, setShowCorrectRepairResult] = useState(false);
  const [correctRepairResultLoading, setCorrectRepairResultLoading] = useState(false);
  const [correctRepairResultError, setCorrectRepairResultError] = useState<string | null>(null);
  const [correctedRepairResult, setCorrectedRepairResult] = useState<'Pass' | 'Fail' | null>(null);

  const handleReopenRepairClick = async () => {
    if (!isApiConfigured() || !repair.clientSheetId) return;
    const cur = repair.status || '';
    let confirmMsg = '';
    if (cur === 'Completed' || cur === 'Complete') {
      confirmMsg = 'Reopen this repair?\n\nThis will:\n  • revert status to In Progress\n  • void any Unbilled billing row created by Complete\n  • clear Repair Result + Completed Date\n\nBlocked if billing already invoiced.';
    } else if (cur === 'In Progress') {
      confirmMsg = 'Reopen this repair?\n\nReverts status to Approved and clears Start Date. No billing impact.';
    } else {
      return;
    }
    const reason = window.prompt(confirmMsg + '\n\nReason (optional):');
    if (reason === null) return;
    setReopenLoading(true);
    setReopenError(null);
    try {
      const resp = await postReopenRepair({ repairId: repair.repairId, reason: reason || '' }, repair.clientSheetId);
      if (resp.ok && resp.data?.success) {
        onRepairUpdated?.();
      } else {
        setReopenError(resp.data?.error || resp.error || 'Failed to reopen repair');
      }
    } catch {
      setReopenError('Network error — please try again');
    }
    setReopenLoading(false);
  };

  const handleCorrectRepairResultClick = async (newResult: 'Pass' | 'Fail') => {
    if (!isApiConfigured() || !repair.clientSheetId) return;
    setCorrectRepairResultLoading(true);
    setCorrectRepairResultError(null);
    try {
      const resp = await postCorrectRepairResult({ repairId: repair.repairId, newResult }, repair.clientSheetId);
      if (resp.ok && resp.data?.success) {
        setCorrectedRepairResult(newResult);
        setShowCorrectRepairResult(false);
        onRepairUpdated?.();
      } else {
        setCorrectRepairResultError(resp.data?.error || resp.error || 'Failed to correct result');
      }
    } catch {
      setCorrectRepairResultError('Network error — please try again');
    }
    setCorrectRepairResultLoading(false);
  };

  const currentRepairResultForWidget: string = correctedRepairResult || repair.repairResult || '';

  // ─── Edit mode for repair fields (Repair Tech, Scheduled Date, Start Date) ──
  const [isEditing, setIsEditing] = useState(false);
  const [editRepairVendor, setEditRepairVendor] = useState(repair.repairVendor || '');
  const [editScheduledDate, setEditScheduledDate] = useState(repair.scheduledDate || '');
  const [editStartDate, setEditStartDate] = useState(repair.startDate || '');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  useEffect(() => {
    setEditRepairVendor(repair.repairVendor || '');
    setEditScheduledDate(repair.scheduledDate || '');
    setEditStartDate(repair.startDate || '');
  }, [repair.repairVendor, repair.scheduledDate, repair.startDate]);

  // ─── Save Repair Fields (Repair Tech, Scheduled Date, Start Date) ──────────
  const handleEditSave = async () => {
    const clientSheetId = repair.clientSheetId;
    if (!isApiConfigured() || !clientSheetId) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = { repairId: repair.repairId };
      if (editRepairVendor !== (repair.repairVendor || '')) payload.repairVendor = editRepairVendor;
      if (editScheduledDate !== (repair.scheduledDate || '')) payload.scheduledDate = editScheduledDate || null;
      if (editStartDate !== (repair.startDate || '')) payload.startDate = editStartDate || null;
      if (Object.keys(payload).length > 1) {
        const res = await postUpdateRepairNotes(payload as any, clientSheetId);
        if (!res.ok || !res.data?.success) {
          setEditError(res.error || 'Save failed');
          setEditSaving(false);
          return;
        }
      }
      setIsEditing(false);
      onRepairUpdated?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    }
    setEditSaving(false);
  };

  // ─── Save Repair Notes (available on Approved / pre-Start) ─────────────────
  const handleSaveNotes = async () => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;
    if (demoMode) {
      setSavedRepairNotes(repairNotes);
      setNotesSavedAt(Date.now());
      return;
    }
    setSavingNotes(true);
    try {
      const resp = await postUpdateRepairNotes(
        { repairId: repair.repairId, repairNotes },
        clientSheetId
      );
      if (!resp.ok || !resp.data?.success) {
        setSubmitError(resp.error || resp.data?.error || 'Failed to save notes. Please try again.');
      } else {
        setSavedRepairNotes(repairNotes);
        setNotesSavedAt(Date.now());
        onRepairUpdated?.();
        // Clear "Saved" indicator after a few seconds
        setTimeout(() => setNotesSavedAt(n => (n && Date.now() - n >= 2500) ? null : n), 3000);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSavingNotes(false);
    }
  };

  // ─── Send Quote ────────────────────────────────────────────────────────────
  const handleSendQuote = async () => {
    setSubmitError(null);

    const amount = parseFloat(quoteAmountInput);
    if (isNaN(amount) || amount < 0) {
      setSubmitError('Please enter a valid quote amount (0 or more).');
      return;
    }

    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      // Demo mode: simulate success
      setEffectiveStatus('Quote Sent');
      setSubmitResult({
        success: true, repairId: repair.repairId, quoteAmount: amount,
        emailSent: false, warnings: ['Demo mode — no API configured']
      });
      return;
    }

    // Phase 2C: patch table row immediately
    applyRepairPatch?.(repair.repairId, { status: 'Quote Sent', quoteAmount: amount });
    setSubmitting(true);
    try {
      const resp = await postSendRepairQuote(
        { repairId: repair.repairId, quoteAmount: amount },
        clientSheetId
      );
      if (!resp.ok || !resp.data?.success) {
        clearRepairPatch?.(repair.repairId); // rollback
        const errMsg = resp.error || resp.data?.error || 'Failed to send repair quote. Please try again.';
        setSubmitError(errMsg);
        void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'send_repair_quote', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, quoteAmount: amount, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
      } else {
        setEffectiveStatus('Quote Sent');
        // Don't clear the patch on success — let the 120s TTL handle it.
        // Clearing immediately creates a window where the fresh fetch returns
        // stale data (Supabase write-through delay) and the UI flickers back
        // to the old status. The patch persists until real data matches.
        setSubmitResult(resp.data);
        onRepairUpdated?.();
      }
    } catch (err) {
      clearRepairPatch?.(repair.repairId); // rollback
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Approve / Decline Quote ──────────────────────────────────────────────
  const handleRespond = async (decision: 'Approve' | 'Decline') => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus(decision === 'Approve' ? 'Approved' : 'Declined');
      setRespondResult({ success: true, repairId: repair.repairId, decision, emailSent: false, warnings: ['Demo mode — no API configured'] });
      return;
    }

    // Phase 2C: patch table row immediately
    applyRepairPatch?.(repair.repairId, { status: decision === 'Approve' ? 'Approved' : 'Declined' });
    setSubmitting(true);
    try {
      const resp = await postRespondToRepairQuote({ repairId: repair.repairId, decision }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        clearRepairPatch?.(repair.repairId); // rollback
        const errMsg = resp.error || resp.data?.error || `Failed to ${decision.toLowerCase()} repair. Please try again.`;
        setSubmitError(errMsg);
        void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'respond_repair_quote', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, decision, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
      } else {
        setEffectiveStatus(decision === 'Approve' ? 'Approved' : 'Declined');
        // Don't clear patch on success — let TTL handle it (prevents flicker while refetch loads)
        setRespondResult(resp.data);
        onRepairUpdated?.();
      }
    } catch (err) {
      clearRepairPatch?.(repair.repairId); // rollback
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Start Repair ────────────────────────────────────────────────────────
  // Session 74 optimistic-first rewrite: the Start button now hides the
  // moment it's clicked. The user no longer waits 30–60 s while GAS
  // renders the Work Order PDF — UI flips instantly, GAS runs in the
  // background. On failure we surface a retry banner but KEEP the
  // started state (the sheet row has usually been written even when
  // the downstream PDF step fails, and Realtime will reconcile if not).
  const handleStartRepair = async () => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus('In Progress');
      setStartResult({ success: true, repairId: repair.repairId, startDate: new Date().toISOString().split('T')[0], warnings: ['Demo mode — no API configured'] });
      return;
    }

    // 1. OPTIMISTIC UI — flip panel + table row + cross-page hooks now.
    //    No setSubmitting(true): we don't want the full-panel
    //    ProcessingOverlay to cover the Work Order banner that's about
    //    to appear.
    setEffectiveStatus('In Progress');
    setStartResult({
      success: true,
      repairId: repair.repairId,
      startDate: new Date().toISOString().split('T')[0],
    });
    applyRepairPatch?.(repair.repairId, { status: 'In Progress' });
    entityEvents.emit('repair', repair.repairId);

    // 2. Fire GAS in background. We intentionally don't await here so
    //    the user can continue working; errors land in the retry
    //    banner without touching the optimistic success state.
    void (async () => {
      try {
        const resp = await postStartRepair({ repairId: repair.repairId }, clientSheetId);
        if (!resp.ok || !resp.data?.success) {
          const errMsg = resp.error || resp.data?.error || 'Work order generation failed.';
          setSubmitError(errMsg + ' You can retry from the Regenerate Work Order button.');
          void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'start_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
        } else {
          // Refresh server-shaped data (URL, skipped flag, etc.) into the banner.
          setStartResult(resp.data);
          onRepairUpdated?.();
        }
      } catch (err) {
        setSubmitError(
          (err instanceof Error ? err.message : 'Network error')
          + ' while generating work order — you can retry from the Regenerate Work Order button.'
        );
      }
    })();
  };

  // ─── Complete Repair ──────────────────────────────────────────────────────
  // Session 74: same optimistic-first pattern as handleStartRepair —
  // flip to 'Complete' immediately, fire GAS in the background, keep
  // the optimistic state if GAS errors (surface a retry banner).
  const handleComplete = async (resultValue: 'Pass' | 'Fail') => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus('Complete');
      setCompleted(true);
      setCompleteResult({ success: true, repairId: repair.repairId, resultValue, billingCreated: false, warnings: ['Demo mode — no API configured'] });
      return;
    }

    // 1. OPTIMISTIC UI
    setEffectiveStatus('Complete');
    setCompleted(true);
    setCompleteResult({
      success: true,
      repairId: repair.repairId,
      resultValue,
      billingCreated: false,
    });
    applyRepairPatch?.(repair.repairId, { status: 'Complete', completedDate: new Date().toISOString().slice(0, 10) });
    entityEvents.emit('repair', repair.repairId);

    // 2. Background GAS
    void (async () => {
      try {
        const resp = await postCompleteRepair(
          { repairId: repair.repairId, resultValue, repairNotes: repairNotes || undefined },
          clientSheetId
        );
        if (!resp.ok || !resp.data?.success) {
          const errMsg = resp.error || resp.data?.error || 'Completion recorded locally but the server call failed.';
          setSubmitError(errMsg + ' Refresh to reconcile, or retry.');
          void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'complete_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, resultValue, repairNotes: repairNotes || undefined, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
        } else {
          setCompleteResult(resp.data);
          onRepairUpdated?.();
        }
      } catch (err) {
        setSubmitError(
          (err instanceof Error ? err.message : 'Network error')
          + ' while completing repair. Refresh to reconcile.'
        );
      }
    })();
  };

  const handleResult = (_result: 'pass' | 'fail') => {
    if (_result === 'fail') {
      setShowResultPrompt('fail');
    } else {
      handleComplete('Pass');
    }
  };

  const handleFailChoice = async (choice: 'complete' | 'cancel') => {
    setShowResultPrompt(null);
    if (choice === 'complete') {
      await handleComplete('Fail');
    } else {
      // "Cancel (No Bill)" — local state only, no billing written
      setEffectiveStatus('Cancelled');
      setCompleted(true);
      setCompleteResult({ success: true, repairId: repair.repairId, resultValue: 'Fail', billingCreated: false, warnings: ['Cancelled — no billing created'] });
    }
  };

  // ─── Tab renderers (modular) ────────────────────────────────────────
  const renderDetailsTab = () => (
    <div style={{ padding: 20 }}>

          {/* Item Info — uses repair's own fields from API */}
          {repair.itemId && (
            <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><Package size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Item</span></div>
              <div style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <DeepLink kind="inventory" id={repair.itemId} clientSheetId={repair.clientSheetId} />
                <ItemIdBadges
                  itemId={repair.itemId}
                  inspItems={inspItems}
                  asmItems={asmItems}
                  repairItems={repairItems}
                />
                {repair.vendor ? <span>{` — ${repair.vendor}`}</span> : null}
                {/* Session 74: prominent warehouse-location pill next to the Item ID.
                    Warehouse staff use this to physically locate the item before
                    starting the repair; was previously rendered as a muted 11px
                    string well below the header. Blue pill gets the eye. */}
                {repair.location && (
                  <span
                    title="Warehouse location"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 999,
                      background: '#EFF6FF', color: '#1D4ED8',
                      border: '1px solid #BFDBFE',
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                    }}
                  >
                    <MapPin size={11} /> {repair.location}
                  </span>
                )}
              </div>
              {repair.description && <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{repair.description}</div>}
              <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: theme.colors.textMuted }}>
                {repair.sidemark && <span>Sidemark: {repair.sidemark}</span>}
                {repair.room && <span>Room: {repair.room}</span>}
              </div>
              {/* Drive Folder Buttons — each one only renders when a real
                  Drive URL exists. Prior behaviour (grey disabled chip with
                  a tooltip) was noisy for legacy rows that will never have a
                  folder (pre-Drive entities, Supabase-only media flow). */}
              {(repair.repairFolderUrl || repair.taskFolderUrl || repair.shipmentFolderUrl) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {repair.repairFolderUrl && (
                    <FolderButton label="Repair Folder" url={repair.repairFolderUrl} icon={Wrench} />
                  )}
                  {repair.taskFolderUrl && (
                    <FolderButton label="Task Folder" url={repair.taskFolderUrl} icon={ClipboardList} />
                  )}
                  {repair.shipmentFolderUrl && (
                    <FolderButton label="Shipment Folder" url={repair.shipmentFolderUrl} icon={Truck} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Inspector Notes (from source task) */}
          {repair.sourceTaskId && (
            <div style={{ background: '#FFFBF5', border: '1px solid #FED7AA', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><ClipboardList size={14} color="#B45309" /><span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>Source Task: <DeepLink kind="task" id={repair.sourceTaskId} size="sm" style={{ color: '#B45309' }} /></span></div>
              <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{repair.taskNotes || 'No inspection notes available'}</div>
            </div>
          )}

          {/* Repair Details */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Repair Details</span>
            {isActive && !isEditing && (
              <button onClick={() => setIsEditing(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, color: theme.colors.orange, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
          {isEditing ? (
            <div style={{ background: '#FAFAFA', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Repair Tech</div>
                  <input value={editRepairVendor} onChange={e => setEditRepairVendor(e.target.value)} placeholder="Assign tech..." style={input} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Scheduled Date</div>
                  <input type="date" value={editScheduledDate?.slice(0, 10) || ''} onChange={e => setEditScheduledDate(e.target.value)} style={input} />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Start Date</div>
                  <input type="date" value={editStartDate?.slice(0, 10) || ''} onChange={e => setEditStartDate(e.target.value)} style={input} />
                </div>
              </div>
              {editError && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 8 }}>{editError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button onClick={() => { setIsEditing(false); setEditError(null); setEditRepairVendor(repair.repairVendor || ''); setEditScheduledDate(repair.scheduledDate || ''); setEditStartDate(repair.startDate || ''); }} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={handleEditSave} disabled={editSaving} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: 'none', background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: editSaving ? 0.6 : 1 }}>{editSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginBottom: 16 }}>
              <Field label="Repair Tech" value={repair.repairVendor} />
              <Field label="Created By" value={repair.createdBy} />
              <Field label="Created" value={fmtDate(repair.createdDate)} />
              <Field label="Scheduled Date" value={fmtDate(repair.scheduledDate)} />
              <Field label="Start Date" value={fmtDate(repair.startDate)} />
              {user?.role === 'admin' && <Field label="Quote Amount" value={repair.quoteAmount != null ? `$${repair.quoteAmount}` : null} />}
              {user?.role === 'admin' && <Field label="Approved Amount" value={repair.finalAmount != null ? `$${repair.finalAmount}` : null} />}
              <Field label="Quote Sent" value={fmtDate(repair.quoteSentDate)} />
              <Field label="Completed" value={fmtDate(repair.completedDate)} />
            </div>
          )}
          <Field label="Description" value={repair.description} />

          {/* Repair Notes (editable) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Wrench size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Repair Notes</span></div>
            {isActive && !completed ? (
              <>
                <textarea value={repairNotes} onChange={e => setRepairNotes(e.target.value)} rows={3} placeholder="Notes about the repair job or outcome…" style={{ ...input, resize: 'vertical' }} />
                {/* v38.61.1 — inline Save button for pre-Start notes. Completing
                    the repair also persists notes via completeRepair, so we only
                    surface this when there are unsaved edits. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 20 }}>
                  {notesSavedAt && !notesDirty && (
                    <span style={{ fontSize: 11, color: '#15803D', fontWeight: 600 }}>✓ Saved</span>
                  )}
                  <button
                    onClick={handleSaveNotes}
                    disabled={!notesDirty || savingNotes}
                    style={{
                      padding: '5px 12px', fontSize: 11, fontWeight: 600,
                      border: `1px solid ${notesDirty && !savingNotes ? theme.colors.orange : theme.colors.border}`,
                      borderRadius: 6,
                      background: notesDirty && !savingNotes ? theme.colors.orange : '#fff',
                      color: notesDirty && !savingNotes ? '#fff' : theme.colors.textMuted,
                      cursor: notesDirty && !savingNotes ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    {savingNotes && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
                    {savingNotes ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: repairNotes ? theme.colors.text : theme.colors.textMuted, lineHeight: 1.5 }}>{repairNotes || 'No notes'}</div>
            )}
          </div>

        {/* Photos + Notes now live in dedicated tabs via builtInTabs below. */}
    </div>
  );

  // Header actions — only Close (edit flow uses inline status-pill CTA).
  const headerActions = (
    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(255,255,255,0.7)' }}>
      <X size={18} />
    </button>
  );

  // Below-ID status row
  const belowIdContent = (
    <div style={{ display: 'flex', gap: 6 }}>
      <Badge t={effectiveStatus} bg={sc.bg} color={sc.color} />
      {repair.quoteAmount != null && <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text, padding: '2px 10px', background: theme.colors.bgSubtle, borderRadius: 10 }}>${repair.quoteAmount}</span>}
    </div>
  );

  // Status strip — start-result + error banners that need to persist
  // above the scrollable body.
  const statusStrip = (startResult?.success || submitError) ? (
    <>
      {startResult?.success && (
        <div style={{ padding: '10px 20px', background: '#F5F3FF', borderBottom: '1px solid #DDD6FE', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Play size={16} color="#7C3AED" />
            <span style={{ fontSize: 13, color: '#7C3AED', fontWeight: 600 }}>
              {startResult.skipped
                ? 'Work Order folder ready'
                : (effectiveStatus === 'Complete' || effectiveStatus === 'In Progress'
                    ? 'Work Order PDF regenerated in Repair Folder'
                    : 'Repair started — Work Order PDF created in Repair Folder')}
            </span>
          </div>
          <button onClick={() => setStartResult(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#7C3AED', fontSize: 11, padding: 0, fontWeight: 600 }}>Dismiss</button>
        </div>
      )}
      {submitError && (
        <div style={{ padding: '10px 20px', background: '#FEF2F2', borderBottom: '1px solid #FECACA', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color="#DC2626" />
            <span style={{ fontSize: 13, color: '#DC2626', fontWeight: 600 }}>{submitError}</span>
          </div>
          <button onClick={() => setSubmitError(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 11, padding: 0, fontWeight: 600 }}>Dismiss</button>
        </div>
      )}
    </>
  ) : undefined;

  // Footer — state-keyed CTAs. Each lifecycle state (Quote Sent, Approved,
  // In Progress, Completed) renders its own action row. EntityHistory
  // moved to the Activity tab via builtInTabs.
  const footer = (
    <>
      {/* Approve / Decline footer (Quote Sent) */}
        {isActive && !completed && effectiveStatus === 'Quote Sent' && !respondResult && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <WriteButton
                label={submitting ? 'Saving...' : 'Approve'}
                variant="primary"
                icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
                style={{ flex: 1, background: '#15803D', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                disabled={submitting}
                onClick={() => handleRespond('Approve')}
              />
              <WriteButton
                label={submitting ? '...' : 'Decline'}
                variant="danger"
                icon={<XCircle size={16} />}
                style={{ flex: 1, padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                disabled={submitting}
                onClick={() => handleRespond('Decline')}
              />
            </div>
          </div>
        )}

        {/* Success card after Approve / Decline */}
        {respondResult && respondResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: respondResult.decision === 'Approve' ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${respondResult.decision === 'Approve' ? '#86EFAC' : '#FECACA'}`, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {respondResult.decision === 'Approve'
                  ? <CheckCircle2 size={16} color="#15803D" />
                  : <XCircle size={16} color="#DC2626" />}
                <span style={{ fontSize: 13, fontWeight: 600, color: respondResult.decision === 'Approve' ? '#15803D' : '#DC2626' }}>
                  {respondResult.skipped ? 'Already ' + respondResult.decision + 'd' : 'Repair ' + respondResult.decision + 'd'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: respondResult.decision === 'Approve' ? '#166534' : '#991B1B' }}>
                Email: {respondResult.emailSent ? '✓ Sent to staff' : '✗ Not sent'}
              </div>
              {respondResult.warnings && respondResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {respondResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Start Repair / Regenerate Work Order — available on Approved, In Progress, Complete.
            Keep the button visible after success so the user can re-run regenerate as many
            times as they want without having to dismiss the confirmation first.
            Stage A: hidden for client role — clients don't start repairs or regenerate
            work orders; that's a staff action. */}
        {(user?.role === 'admin' || user?.role === 'staff') &&
         (effectiveStatus === 'Approved' || effectiveStatus === 'In Progress' || effectiveStatus === 'Complete') && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            <WriteButton
              label={submitting
                ? (effectiveStatus === 'Approved' ? 'Starting...' : 'Regenerating...')
                : (effectiveStatus === 'Approved' ? 'Start Repair' : 'Regenerate Work Order')}
              variant="primary"
              icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={16} />}
              style={{ width: '100%', background: '#7C3AED', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
              disabled={submitting}
              onClick={handleStartRepair}
            />
          </div>
        )}

        {/* Success card after Start Repair */}
        {startResult && startResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Play size={16} color="#7C3AED" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#7C3AED' }}>
                  {startResult.skipped ? 'Repair already in progress' : 'Repair started'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#5B21B6' }}>
                Start Date: {startResult.startDate || 'Today'}
              </div>
              {startResult.warnings && startResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {startResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Repair complete / failed footer (In Progress only) */}
        {isActive && !completed && effectiveStatus === 'In Progress' && !completeResult && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            {showResultPrompt === 'fail' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><AlertTriangle size={16} color="#B45309" /><span style={{ fontSize: 13, fontWeight: 600 }}>Repair failed — what would you like to do?</span></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <WriteButton label={submitting ? 'Saving...' : 'Complete (Bill)'} variant="primary"
                    icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : undefined}
                    style={{ flex: 1, background: '#B45309', padding: '10px', fontSize: 12, opacity: submitting ? 0.7 : 1 }}
                    disabled={submitting}
                    onClick={async () => handleFailChoice('complete')} />
                  <WriteButton label="Cancel (No Bill)" variant="secondary" style={{ flex: 1, padding: '10px', fontSize: 12, opacity: submitting ? 0.7 : 1 }} disabled={submitting} onClick={async () => handleFailChoice('cancel')} />
                </div>
                <button onClick={() => setShowResultPrompt(null)} style={{ width: '100%', marginTop: 6, padding: '6px', fontSize: 11, border: 'none', background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}>Go back</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <WriteButton label={submitting ? 'Saving...' : 'Repair Complete'} variant="primary"
                  icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
                  style={{ flex: 1, background: '#15803D', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                  disabled={submitting}
                  onClick={async () => handleResult('pass')} />
                <WriteButton label="Failed" variant="danger" icon={<XCircle size={16} />}
                  style={{ flex: 1, padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
                  disabled={submitting}
                  onClick={async () => handleResult('fail')} />
              </div>
            )}
          </div>
        )}

        {/* Success card after Repair Complete / Failed */}
        {/* Stage B — Reopen + Correct Result widgets (admin/staff only) */}
        {canStaffEdit && (effectiveStatus === 'Completed' || effectiveStatus === 'Complete' || effectiveStatus === 'In Progress') && (
          <div style={{ padding: '10px 20px 14px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {reopenError && (
              <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 6, padding: '4px 8px', background: '#FEF2F2', borderRadius: 6 }}>{reopenError}</div>
            )}
            {(effectiveStatus === 'Completed' || effectiveStatus === 'Complete') && (
              !showCorrectRepairResult ? (
                <div style={{ textAlign: 'center', marginBottom: 6 }}>
                  <button
                    onClick={() => setShowCorrectRepairResult(true)}
                    style={{ fontSize: 11, color: theme.colors.textMuted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: '2px 0', fontFamily: 'inherit' }}
                  >
                    Correct result...
                  </button>
                </div>
              ) : (
                <div style={{ marginBottom: 8, paddingTop: 6 }}>
                  <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 6 }}>Change repair result:</div>
                  {correctRepairResultError && (
                    <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 6, padding: '4px 8px', background: '#FEF2F2', borderRadius: 6 }}>{correctRepairResultError}</div>
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      onClick={() => { if (!correctRepairResultLoading && currentRepairResultForWidget !== 'Pass') handleCorrectRepairResultClick('Pass'); }}
                      disabled={correctRepairResultLoading || currentRepairResultForWidget === 'Pass'}
                      style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', background: currentRepairResultForWidget === 'Pass' ? '#D1FAE5' : '#16A34A', color: currentRepairResultForWidget === 'Pass' ? '#6B7280' : '#fff', cursor: correctRepairResultLoading || currentRepairResultForWidget === 'Pass' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: currentRepairResultForWidget === 'Pass' ? 0.55 : 1 }}
                    >
                      {correctRepairResultLoading && currentRepairResultForWidget !== 'Pass' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> : '✓'} Pass
                    </button>
                    <button
                      onClick={() => { if (!correctRepairResultLoading && currentRepairResultForWidget !== 'Fail') handleCorrectRepairResultClick('Fail'); }}
                      disabled={correctRepairResultLoading || currentRepairResultForWidget === 'Fail'}
                      style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '2px solid #DC2626', background: currentRepairResultForWidget === 'Fail' ? '#FEF2F2' : 'transparent', color: currentRepairResultForWidget === 'Fail' ? '#6B7280' : '#DC2626', cursor: correctRepairResultLoading || currentRepairResultForWidget === 'Fail' ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: currentRepairResultForWidget === 'Fail' ? 0.55 : 1 }}
                    >
                      {correctRepairResultLoading && currentRepairResultForWidget !== 'Fail' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> : '✕'} Fail
                    </button>
                    <button
                      onClick={() => { setShowCorrectRepairResult(false); setCorrectRepairResultError(null); }}
                      style={{ padding: '7px 10px', fontSize: 12, background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}
                    >Cancel</button>
                  </div>
                </div>
              )
            )}
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={handleReopenRepairClick}
                disabled={reopenLoading}
                style={{ fontSize: 11, color: '#DC2626', background: 'none', border: 'none', cursor: reopenLoading ? 'wait' : 'pointer', textDecoration: 'underline', padding: '2px 0', fontFamily: 'inherit' }}
              >
                {reopenLoading ? 'Reopening…' : (effectiveStatus === 'In Progress' ? 'Reopen repair (undo Start)...' : 'Reopen repair (undo Complete)...')}
              </button>
            </div>
          </div>
        )}

        {completeResult && completeResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: completeResult.resultValue === 'Pass' ? '#F0FDF4' : '#FEF3C7', border: `1px solid ${completeResult.resultValue === 'Pass' ? '#86EFAC' : '#FDE68A'}`, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CheckCircle2 size={16} color={completeResult.resultValue === 'Pass' ? '#15803D' : '#B45309'} />
                <span style={{ fontSize: 13, fontWeight: 600, color: completeResult.resultValue === 'Pass' ? '#15803D' : '#B45309' }}>
                  {completeResult.skipped ? 'Already complete' : `Repair complete — ${completeResult.resultValue}`}
                </span>
              </div>
              <div style={{ fontSize: 12, color: completeResult.resultValue === 'Pass' ? '#166534' : '#92400E', lineHeight: 1.5 }}>
                <div>Billing: {completeResult.billingCreated ? `✓ Created${typeof completeResult.billingAmount === 'number' ? ' ($' + completeResult.billingAmount.toFixed(2) + ')' : ''}` : '✗ Not created'}</div>
                {completeResult.emailSent !== undefined && (
                  <div>Email: {completeResult.emailSent ? '✓ Sent to client' : '✗ Not sent'}</div>
                )}
              </div>
              {completeResult.warnings && completeResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {completeResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Send Quote footer (Pending Quote) */}
        {isActive && !completed && effectiveStatus === 'Pending Quote' && !submitResult && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {/* Error banner */}
            {submitError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{submitError}</span>
              </div>
            )}
            {/* Quote amount input */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Quote Amount ($)</div>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={quoteAmountInput}
                onChange={e => setQuoteAmountInput(e.target.value)}
                disabled={submitting}
                style={{ ...input, width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <WriteButton
              label={submitting ? 'Sending...' : 'Send Quote to Client'}
              variant="primary"
              icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
              style={{ width: '100%', padding: '10px', fontSize: 13, opacity: submitting ? 0.7 : 1 }}
              disabled={submitting}
              onClick={handleSendQuote}
            />
          </div>
        )}

        {/* Success card after sending quote */}
        {submitResult && submitResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <div style={{ padding: '12px 14px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <CheckCircle2 size={16} color="#15803D" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#15803D' }}>
                  {submitResult.skipped ? 'Quote already sent' : 'Quote sent successfully'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>
                <div>Amount: <strong>${typeof submitResult.quoteAmount === 'number' ? submitResult.quoteAmount.toFixed(2) : submitResult.quoteAmount}</strong></div>
                <div>Email: {submitResult.emailSent ? '✓ Sent to client' : '✗ Not sent (check settings)'}</div>
              </div>
              {submitResult.warnings && submitResult.warnings.length > 0 && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#FEF3C7', borderRadius: 6 }}>
                  {submitResult.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Cancel Repair — available for all active statuses */}
        {isActive && !completed && effectiveStatus !== 'Cancelled' && (
          <div style={{ padding: '0 20px 8px', flexShrink: 0 }}>
            <button
              onClick={async () => {
                if (!confirm('Cancel this repair? Status will be set to Cancelled.')) return;
                const cid = repair.clientSheetId || '';
                if (!isApiConfigured() || !cid) return;
                // Phase 2C: patch table row immediately
                applyRepairPatch?.(repair.repairId, { status: 'Cancelled' });
                setSubmitting(true); setSubmitError(null);
                try {
                  const resp = await postCancelRepair({ repairId: repair.repairId }, cid);
                  if (resp.ok && resp.data?.success) {
                    // Don't clear patch on success — let TTL handle it (prevents flicker while refetch loads)
                    setEffectiveStatus('Cancelled'); setCompleted(true); onRepairUpdated?.();
                  } else {
                    clearRepairPatch?.(repair.repairId); // rollback
                    const errMsg = resp.data?.error || resp.error || 'Failed to cancel repair';
                    setSubmitError(errMsg);
                    void writeSyncFailed({ tenant_id: cid, entity_type: 'repair', entity_id: repair.repairId, action_type: 'cancel_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
                  }
                } catch (_) {
                  clearRepairPatch?.(repair.repairId); // rollback
                  setSubmitError('Failed to cancel repair');
                }
                setSubmitting(false);
              }}
              style={{ width: '100%', padding: '7px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#EF4444'; e.currentTarget.style.color = '#EF4444'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.color = theme.colors.textMuted; }}
            >
              Cancel Repair
            </button>
          </div>
        )}

      {(!isActive || completed) && !submitResult && (
        <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
      )}
    </>
  );

  // ─── Shell ────────────────────────────────────────────────────────────
  const tabs: TabbedDetailPanelTab[] = [
    { id: 'details', label: 'Details', keepMounted: true, render: renderDetailsTab },
  ];

  return (
    <TabbedDetailPanel
      title={repair.repairId}
      clientName={repair.clientName}
      sidemark={repair.sidemark}
      idBadges={repair.itemId ? (
        <ItemIdBadges
          itemId={repair.itemId}
          inspItems={inspItems}
          asmItems={asmItems}
          repairItems={repairItems}
        />
      ) : undefined}
      belowId={belowIdContent}
      headerActions={headerActions}
      statusStrip={statusStrip}
      overlay={<ProcessingOverlay visible={submitting} message="Processing..." />}
      tabs={tabs}
      builtInTabs={{
        photos: {
          entityType: 'repair',
          entityId: repair.repairId,
          tenantId: repair.clientSheetId,
          itemId: repair.itemId ? String(repair.itemId) : null,
          enableSourceFilter: !!repair.itemId,
        },
        docs: {
          contextType: 'repair',
          contextId: repair.repairId,
          tenantId: repair.clientSheetId,
        },
        notes: {
          entityType: 'repair',
          entityId: repair.repairId,
          relatedEntities: [
            ...(repair.itemId ? [{ type: 'inventory', id: String(repair.itemId), label: `Item ${repair.itemId}` }] : []),
            ...(repair.sourceTaskId ? [{ type: 'task', id: String(repair.sourceTaskId), label: `Task ${repair.sourceTaskId}` }] : []),
          ],
          enableSourceFilter: !!repair.itemId,
          itemId: repair.itemId ? String(repair.itemId) : null,
        },
        activity: {
          entityType: 'repair',
          entityId: repair.repairId,
          tenantId: repair.clientSheetId,
        },
      }}
      footer={footer}
      onClose={onClose}
      resizeKey="repair"
      defaultWidth={460}
    />
  );
}
