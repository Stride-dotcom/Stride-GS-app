import React, { useEffect, useState } from 'react';
import { X, Wrench, Package, ClipboardList, CheckCircle2, XCircle, AlertTriangle, Send, Loader2, Truck, Play } from 'lucide-react';
import { FolderButton } from './FolderButton';
import { DeepLink } from './DeepLink';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { postSendRepairQuote, postRespondToRepairQuote, postCompleteRepair, postStartRepair, postCancelRepair, isApiConfigured } from '../../lib/api';
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
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown: handleResizeMouseDown } = useResizablePanel(460, 'repair', isMobile);

  // Derive effective status from submit result (optimistic update).
  // Keep in sync with the repair prop — optimistic patches from the parent
  // hook (applyRepairPatch) update repair.status, and we need the header /
  // action footer to reflect that instead of the initial mount value.
  const [effectiveStatus, setEffectiveStatus] = useState<string>(repair.status);
  useEffect(() => { setEffectiveStatus(repair.status); }, [repair.status]);
  const sc = STATUS_CFG[effectiveStatus] || STATUS_CFG['Pending Quote'];
  const isActive = !['Complete', 'Cancelled', 'Declined'].includes(effectiveStatus);

  const [repairNotes, setRepairNotes] = useState(repair.repairNotes || '');
  const [showResultPrompt, setShowResultPrompt] = useState<'fail' | null>(null);
  const [completed, setCompleted] = useState(false);

  // Quote form state
  const [quoteAmountInput, setQuoteAmountInput] = useState<string>(
    repair.quoteAmount != null ? String(repair.quoteAmount) : ''
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
  const handleStartRepair = async () => {
    setSubmitError(null);
    const clientSheetId = repair.clientSheetId;
    const demoMode = !isApiConfigured() || !clientSheetId;

    if (demoMode) {
      setEffectiveStatus('In Progress');
      setStartResult({ success: true, repairId: repair.repairId, startDate: new Date().toISOString().split('T')[0], warnings: ['Demo mode — no API configured'] });
      return;
    }

    // Phase 2C: patch table row immediately
    applyRepairPatch?.(repair.repairId, { status: 'In Progress' });
    setSubmitting(true);
    try {
      const resp = await postStartRepair({ repairId: repair.repairId }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        clearRepairPatch?.(repair.repairId); // rollback
        const errMsg = resp.error || resp.data?.error || 'Failed to start repair. Please try again.';
        setSubmitError(errMsg);
        void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'start_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
      } else {
        setEffectiveStatus('In Progress');
        // Don't clear patch on success — let TTL handle it (prevents flicker while refetch loads)
        setStartResult(resp.data);
        onRepairUpdated?.();
      }
    } catch (err) {
      clearRepairPatch?.(repair.repairId); // rollback
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Complete Repair ──────────────────────────────────────────────────────
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

    // Phase 2C: patch table row immediately
    applyRepairPatch?.(repair.repairId, { status: 'Complete', completedDate: new Date().toISOString().slice(0, 10) });
    setSubmitting(true);
    try {
      const resp = await postCompleteRepair(
        { repairId: repair.repairId, resultValue, repairNotes: repairNotes || undefined },
        clientSheetId
      );
      if (!resp.ok || !resp.data?.success) {
        clearRepairPatch?.(repair.repairId); // rollback
        const errMsg = resp.error || resp.data?.error || 'Failed to complete repair. Please try again.';
        setSubmitError(errMsg);
        void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'repair', entity_id: repair.repairId, action_type: 'complete_repair', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { repairId: repair.repairId, resultValue, repairNotes: repairNotes || undefined, clientName: repair.clientName, description: repair.description }, error_message: errMsg });
      } else {
        setEffectiveStatus('Complete');
        // Don't clear patch on success — let TTL handle it (prevents flicker while refetch loads)
        setCompleted(true);
        setCompleteResult(resp.data);
        onRepairUpdated?.();
      }
    } catch (err) {
      clearRepairPatch?.(repair.repairId); // rollback
      setSubmitError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
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

  return (
    <>
      {!isMobile && <div onClick={() => { if (!submitting) onClose(); }} style={panelBackdropStyle} />}
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && <div onMouseDown={handleResizeMouseDown} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 101 }} />}

        <ProcessingOverlay visible={submitting} message="Processing..." />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{repair.repairId}</div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{repair.clientName}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}><X size={18} /></button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Badge t={effectiveStatus} bg={sc.bg} color={sc.color} />
            {repair.quoteAmount != null && <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text, padding: '2px 10px', background: theme.colors.bgSubtle, borderRadius: 10 }}>${repair.quoteAmount}</span>}
          </div>
        </div>

        {/* Top-of-panel persistent confirmation for Start / Regenerate Work Order */}
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

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Item Info — uses repair's own fields from API */}
          {repair.itemId && (
            <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><Package size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Item</span></div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                <DeepLink kind="inventory" id={repair.itemId} clientSheetId={repair.clientSheetId} />
                {repair.vendor ? ` — ${repair.vendor}` : ''}
              </div>
              {repair.description && <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{repair.description}</div>}
              <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: theme.colors.textMuted }}>
                {repair.location && <span>Location: {repair.location}</span>}
                {repair.sidemark && <span>Sidemark: {repair.sidemark}</span>}
              </div>
              {/* Drive Folder Buttons */}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <FolderButton label="Repair Folder" url={repair.repairFolderUrl || undefined} disabledTooltip="Approve repair to create folder" icon={Wrench} />
                <FolderButton label="Task Folder" url={repair.taskFolderUrl || undefined} disabledTooltip="Folder link missing — use Fix Missing Folders on Inventory page" icon={ClipboardList} />
                <FolderButton label="Shipment Folder" url={repair.shipmentFolderUrl || undefined} disabledTooltip="Folder link missing — use Fix Missing Folders on Inventory page" icon={Truck} />
              </div>
            </div>
          )}

          {/* Inspector Notes (from source task) */}
          {repair.sourceTaskId && (
            <div style={{ background: '#FFFBF5', border: '1px solid #FED7AA', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><ClipboardList size={14} color="#B45309" /><span style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>Source Task: {repair.sourceTaskId}</span></div>
              <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{repair.taskNotes || 'No inspection notes available'}</div>
            </div>
          )}

          {/* Repair Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginBottom: 16 }}>
            <Field label="Repair Tech" value={repair.repairVendor} />
            <Field label="Created By" value={repair.createdBy} />
            <Field label="Created" value={fmtDate(repair.createdDate)} />
            <Field label="Scheduled Date" value={fmtDate(repair.scheduledDate)} />
            <Field label="Quote Amount" value={repair.quoteAmount != null ? `$${repair.quoteAmount}` : null} />
            <Field label="Approved Amount" value={repair.finalAmount != null ? `$${repair.finalAmount}` : null} />
            <Field label="Quote Sent" value={fmtDate(repair.quoteSentDate)} />
            <Field label="Completed" value={fmtDate(repair.completedDate)} />
          </div>
          <Field label="Description" value={repair.description} />

          {/* Repair Notes (editable) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Wrench size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Repair Notes</span></div>
            {isActive && !completed ? (
              <textarea value={repairNotes} onChange={e => setRepairNotes(e.target.value)} rows={3} placeholder="Document the repair work performed..." style={{ ...input, resize: 'vertical' }} />
            ) : (
              <div style={{ fontSize: 13, color: repairNotes ? theme.colors.text : theme.colors.textMuted, lineHeight: 1.5 }}>{repairNotes || 'No notes'}</div>
            )}
          </div>

          {/* Photos section removed — use Repair Folder / Shipment Folder buttons above */}
        </div>

        {/* Footer Actions */}

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
            times as they want without having to dismiss the confirmation first. */}
        {(effectiveStatus === 'Approved' || effectiveStatus === 'In Progress' || effectiveStatus === 'Complete') && (
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
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}
      </div>
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
