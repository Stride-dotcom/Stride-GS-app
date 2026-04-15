import React, { useState, useCallback, useMemo } from 'react';
import { X, ClipboardList, Package, MapPin, CheckCircle2, XCircle, AlertTriangle, FolderOpen, Loader2, Play, ExternalLink, Truck, Wrench, Save, DollarSign, Pencil, FileText } from 'lucide-react';
import { FolderButton } from './FolderButton';
import { DeepLink } from './DeepLink';
import { theme } from '../../styles/theme';
import { fmtDate, fmtDateTime } from '../../lib/constants';
import { WriteButton } from './WriteButton';
import { postCompleteTask, postStartTask, postUpdateTaskNotes, postUpdateTaskCustomPrice, postRequestRepairQuote, postCancelTask, postGenerateTaskWorkOrder, isApiConfigured } from '../../lib/api';
import { writeSyncFailed } from '../../lib/syncEvents';
import { useLocations } from '../../hooks/useLocations';
import type { CompleteTaskResponse, StartTaskResponse } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { SERVICE_CODES } from '../../lib/constants';
import { ProcessingOverlay } from './ProcessingOverlay';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';

import type { Task, Repair } from '../../lib/types';
interface Props {
  task: any;
  onClose: () => void;
  onTaskUpdated?: () => void;
  onNavigateToItem?: (itemId: string) => void;
  itemRepairs?: any[];
  // Phase 2C — optimistic patch functions (optional; panel works without them)
  applyTaskPatch?: (taskId: string, patch: Partial<Task>) => void;
  mergeTaskPatch?: (taskId: string, patch: Partial<Task>) => void;
  clearTaskPatch?: (taskId: string) => void;
  addOptimisticTask?: (task: Task) => void;
  removeOptimisticTask?: (tempTaskId: string) => void;
  // Cross-entity: repair quote creates a new repair row
  addOptimisticRepair?: (repair: Repair) => void;
  removeOptimisticRepair?: (tempRepairId: string) => void;
}

const TYPE_CFG: Record<string, { bg: string; color: string }> = { INSP: { bg: '#FEF3EE', color: '#E85D2D' }, ASM: { bg: '#F0FDF4', color: '#15803D' }, REPAIR: { bg: '#FEF3C7', color: '#B45309' }, DLVR: { bg: '#EDE9FE', color: '#7C3AED' }, RCVG: { bg: '#EFF6FF', color: '#1D4ED8' }, WCPU: { bg: '#FCE7F3', color: '#BE185D' } };
const STATUS_CFG: Record<string, { bg: string; color: string }> = { Open: { bg: '#EFF6FF', color: '#1D4ED8' }, 'In Progress': { bg: '#FEF3EE', color: '#E85D2D' }, Completed: { bg: '#F0FDF4', color: '#15803D' }, Cancelled: { bg: '#F3F4F6', color: '#6B7280' } };

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) { return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>; }
function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) { return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>{value || '\u2014'}</div></div>; }

const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' };

export function TaskDetailPanel({ task, onClose, onTaskUpdated, itemRepairs = [], applyTaskPatch, mergeTaskPatch, clearTaskPatch, addOptimisticRepair, removeOptimisticRepair }: Props) {
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown: handleResizeMouseDown } = useResizablePanel(460, 'task', isMobile);
  const tc = TYPE_CFG[task.type] || TYPE_CFG.RCVG;
  const sc = STATUS_CFG[task.status] || STATUS_CFG.Open;
  const isOpen = task.status === 'Open' || task.status === 'In Progress';
  const isInspection = task.type === 'INSP';

  const { user } = useAuth();

  const [notes, setNotes] = useState(task.taskNotes || task.notes || '');
  const [location, setLocation] = useState(task.location || '');
  const [showResultPrompt, setShowResultPrompt] = useState<'pass' | 'fail' | null>(null);
  const [completed, setCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<CompleteTaskResponse | null>(null);

  // Start Task state
  const [startTaskLoading, setStartTaskLoading] = useState(false);
  const [startTaskResult, setStartTaskResult] = useState<StartTaskResponse | null>(null);
  const [startTaskError, setStartTaskError] = useState<string | null>(null);
  const [startTaskConflict, setStartTaskConflict] = useState<{ assignedTo: string } | null>(null);
  // After a successful start, use the live folderUrl; before that, use whatever came with task data
  const activeFolderUrl: string = startTaskResult?.folderUrl || task.taskFolderUrl || (task as any).folderUrl || '';
  const activeShipmentFolderUrl: string = task.shipmentFolderUrl || '';
  const isAlreadyStarted = !!(task.startedAt || startTaskResult?.startedAt);

  const apiConfigured = isApiConfigured();
  const clientSheetId: string = task.clientSheetId || task.clientId || '';

  // Location autocomplete
  const { locationNames } = useLocations();
  const [locationQuery, setLocationQuery] = useState(task.location || '');
  const [locationFocused, setLocationFocused] = useState(false);
  const filteredLocations = useMemo(() => {
    if (!locationQuery) return locationNames.slice(0, 15);
    return locationNames.filter(l => l.toLowerCase().includes(locationQuery.toLowerCase())).slice(0, 20);
  }, [locationQuery, locationNames]);

  // Edit/Save mode for task fields
  // Custom Price Override is visible to staff + admin; hidden from clients
  const canSeeCustomPrice = user?.role === 'admin' || user?.role === 'staff';
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskSaveSuccess, setTaskSaveSuccess] = useState(false);
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);
  const [customPrice, setCustomPrice] = useState(task.customPrice != null ? String(task.customPrice) : '');

  // Repair quote state
  const [repairRequested, setRepairRequested] = useState(false);
  const [repairRequesting, setRepairRequesting] = useState(false);

  const activeRepair = useMemo(() => {
    return itemRepairs.find((r: any) => {
      const s = String(r.status || '').trim();
      return s === 'Pending Quote' || s === 'Quote Sent' || s === 'Approved';
    });
  }, [itemRepairs]);

  const repairStatus = activeRepair ? String(activeRepair.status || '').trim()
    : repairRequested ? 'Pending Quote'
    : null;

  const handleRequestRepair = useCallback(async () => {
    if (!apiConfigured || !clientSheetId || !task.itemId) return;
    setRepairRequesting(true);

    // Phase 2C: insert temp repair row immediately
    const tempRepairId = `TEMP-${Date.now()}`;
    if (addOptimisticRepair) {
      addOptimisticRepair({
        repairId: tempRepairId,
        sourceTaskId: task.taskId,
        itemId: task.itemId,
        clientId: clientSheetId,
        clientName: task.clientName,
        description: task.description || '',
        status: 'Pending Quote',
        createdDate: new Date().toISOString().slice(0, 10),
      } as any);
    }

    try {
      const resp = await postRequestRepairQuote({ itemId: task.itemId, sourceTaskId: task.taskId }, clientSheetId);
      if (resp.ok && resp.data?.success) {
        removeOptimisticRepair?.(tempRepairId); // remove temp; refetch loads real repair
        setRepairRequested(true);
        onTaskUpdated?.();
      } else {
        removeOptimisticRepair?.(tempRepairId); // rollback
      }
    } catch (_) {
      removeOptimisticRepair?.(tempRepairId); // rollback
    }
    setRepairRequesting(false);
  }, [apiConfigured, clientSheetId, task.itemId, task.taskId, task.clientName, task.description, onTaskUpdated, addOptimisticRepair, removeOptimisticRepair]);

  const handleTaskEditStart = useCallback(() => {
    setNotes(task.taskNotes || task.notes || '');
    setLocation(task.location || '');
    setLocationQuery(task.location || '');
    setCustomPrice(task.customPrice != null ? String(task.customPrice) : '');
    setTaskSaveError(null);
    setTaskSaveSuccess(false);
    setIsEditingTask(true);
  }, [task]);

  const handleTaskEditCancel = useCallback(() => {
    setNotes(task.taskNotes || task.notes || '');
    setLocation(task.location || '');
    setLocationQuery(task.location || '');
    setCustomPrice(task.customPrice != null ? String(task.customPrice) : '');
    setIsEditingTask(false);
    setTaskSaveError(null);
  }, [task]);

  const handleTaskSave = useCallback(async () => {
    if (!apiConfigured || !clientSheetId || !task.taskId) return;
    setTaskSaving(true);
    setTaskSaveError(null);

    // Phase 2C: merge patch immediately so table reflects edits before server responds
    const patchData: Partial<Task> = {};
    const origNotes = task.taskNotes || task.notes || '';
    const origLocation = task.location || '';
    const notesChanged = notes !== origNotes;
    const locationChanged = location !== origLocation;
    if (notesChanged) patchData.taskNotes = notes;
    if (locationChanged) patchData.location = location;
    if (canSeeCustomPrice) {
      const origPrice = task.customPrice != null ? String(task.customPrice) : '';
      if (customPrice !== origPrice) {
        const priceVal = customPrice.trim() === '' ? undefined : Number(customPrice);
        if (priceVal !== undefined && isNaN(priceVal)) { setTaskSaveError('Invalid price'); setTaskSaving(false); return; }
        patchData.customPrice = priceVal;
      }
    }
    if (Object.keys(patchData).length > 0) mergeTaskPatch?.(task.taskId, patchData);

    try {
      // Save notes + location in one call
      if (notesChanged || locationChanged) {
        const payload: Record<string, unknown> = { taskId: task.taskId };
        if (notesChanged) payload.taskNotes = notes;
        if (locationChanged) payload.location = location;
        await postUpdateTaskNotes(payload as any, clientSheetId);
      }
      // Save custom price if changed (staff + admin)
      if (canSeeCustomPrice && 'customPrice' in patchData) {
        const priceVal = patchData.customPrice ?? null;
        await postUpdateTaskCustomPrice({ taskId: task.taskId, customPrice: priceVal !== undefined ? priceVal : null }, clientSheetId);
      }
      // Field edits: patch stays until auto-expiry (server value == patch value)
      setIsEditingTask(false);
      setTaskSaveSuccess(true);
      setTimeout(() => setTaskSaveSuccess(false), 3000);
      onTaskUpdated?.();
    } catch {
      clearTaskPatch?.(task.taskId); // rollback on error
      setTaskSaveError('Save failed — please try again');
    }
    setTaskSaving(false);
  }, [apiConfigured, clientSheetId, task, notes, location, customPrice, canSeeCustomPrice, onTaskUpdated, mergeTaskPatch, clearTaskPatch]);

  const callCompleteTask = async (result: 'Pass' | 'Fail') => {
    setSubmitting(true);
    setSubmitError(null);

    // Phase 2C: optimistic patch — table shows "Completed" immediately
    applyTaskPatch?.(task.taskId, {
      status: 'Completed',
      result,
      completedAt: new Date().toISOString().slice(0, 10),
    });

    // Demo mode: no API or no client sheet
    if (!apiConfigured || !clientSheetId) {
      await new Promise(r => setTimeout(r, 600));
      setSubmitResult({ success: true, taskId: task.taskId, result, billingCreated: false });
      setCompleted(true);
      setSubmitting(false);
      return;
    }

    // v32.x: Inline Custom Price override.
    //  - If the editor has a value → always send it (authoritative). This
    //    avoids a cache bug where task.customPrice came from Supabase but the
    //    Google Sheet cell was never actually written, and React would skip
    //    sending because the values "matched".
    //  - If the editor is empty but task.customPrice is set → send null to clear.
    //  - If both empty → send nothing.
    let inlineCustomPrice: number | null | undefined = undefined;
    if (canSeeCustomPrice) {
      if (customPrice.trim() !== '') {
        const priceVal = Number(customPrice);
        if (isNaN(priceVal)) {
          setSubmitError('Invalid custom price — please fix or clear the field before completing.');
          setSubmitting(false);
          clearTaskPatch?.(task.taskId);
          return;
        }
        inlineCustomPrice = priceVal;
      } else if (task.customPrice != null) {
        inlineCustomPrice = null; // user cleared an existing override
      }
    }

    const resp = await postCompleteTask(
      {
        taskId: task.taskId,
        result,
        taskNotes: notes || undefined,
        ...(inlineCustomPrice !== undefined ? { customPrice: inlineCustomPrice } : {}),
      },
      clientSheetId
    );

    setSubmitting(false);

    if (!resp.ok || !resp.data?.success) {
      clearTaskPatch?.(task.taskId); // rollback
      const errMsg = resp.error || resp.data?.error || 'Completion failed. Please try again.';
      setSubmitError(errMsg);
      void writeSyncFailed({
        tenant_id: clientSheetId,
        entity_type: 'task',
        entity_id: task.taskId,
        action_type: 'complete_task',
        requested_by: user?.email ?? '',
        request_id: resp.requestId,
        payload: { taskId: task.taskId, result, taskNotes: notes || undefined, clientName: task.clientName, description: task.description, sidemark: task.sidemark, itemId: task.itemId },
        error_message: errMsg,
      });
      return;
    }

    // Don't clear patch on success — let 120s TTL handle it (prevents flicker during refetch)
    setSubmitResult(resp.data);
    setCompleted(true);
    onTaskUpdated?.();
  };

  const handleStartTask = async (forceOverride = false) => {
    setStartTaskLoading(true);
    setStartTaskError(null);
    setStartTaskConflict(null);

    // Phase 2C: optimistic patch — table shows "In Progress" immediately
    applyTaskPatch?.(task.taskId, {
      status: 'In Progress',
      assignedTo: user?.email || undefined,
      startedAt: new Date().toISOString().slice(0, 10),
    });

    if (!apiConfigured || !clientSheetId) {
      // Demo mode
      await new Promise(r => setTimeout(r, 800));
      setStartTaskResult({ success: true, started: true, noOp: false, taskId: task.taskId, folderUrl: '', pdfCreated: false, startedAt: new Date().toISOString().slice(0, 10), message: 'Demo mode — no writes made' });
      setStartTaskLoading(false);
      return;
    }

    const resp = await postStartTask(
      { taskId: task.taskId, assignedTo: user?.email || undefined, forceOverride },
      clientSheetId
    );

    setStartTaskLoading(false);

    if (resp.ok && resp.data && !resp.data.success && resp.data.conflict) {
      // Another user already started this task — show confirmation; rollback patch
      clearTaskPatch?.(task.taskId);
      setStartTaskConflict({ assignedTo: resp.data.assignedTo || 'another user' });
      return;
    }

    if (!resp.ok || !resp.data?.success) {
      clearTaskPatch?.(task.taskId); // rollback
      const errMsg = resp.error || resp.data?.message || resp.data?.error || 'Start Task failed. Please try again.';
      setStartTaskError(errMsg);
      void writeSyncFailed({
        tenant_id: clientSheetId,
        entity_type: 'task',
        entity_id: task.taskId,
        action_type: 'start_task',
        requested_by: user?.email ?? '',
        request_id: resp.requestId,
        payload: { taskId: task.taskId, assignedTo: user?.email || undefined, forceOverride, clientName: task.clientName, description: task.description, sidemark: task.sidemark, itemId: task.itemId },
        error_message: errMsg,
      });
      return;
    }

    // Server confirmed — keep optimistic patch until refetch returns updated data
    // (Supabase write-through may have slight delay; patch TTL of 120s covers it)
    setStartTaskResult(resp.data);
    onTaskUpdated?.();
  };

  const handleResult = async (result: 'pass' | 'fail') => {
    if (isInspection) {
      await callCompleteTask(result === 'pass' ? 'Pass' : 'Fail');
    } else if (result === 'pass') {
      await callCompleteTask('Pass');
    } else {
      // Non-inspection fail: show prompt (complete with billing, or cancel)
      setShowResultPrompt('fail');
    }
  };

  const handleFailChoice = async (choice: 'complete' | 'cancel') => {
    setShowResultPrompt(null);
    if (choice === 'complete') {
      await callCompleteTask('Fail');
    } else {
      // Cancel: pass a special result so server sets status=Completed without billing
      // For now treat as Fail-cancel — same API call, billing flags on server handle it
      await callCompleteTask('Fail');
    }
  };

  return (
    <>
      {!isMobile && <div onClick={() => { if (!submitting && !startTaskLoading) onClose(); }} style={panelBackdropStyle} />}
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && <div onMouseDown={handleResizeMouseDown} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 101 }} />}

        <ProcessingOverlay visible={submitting || startTaskLoading} message={startTaskLoading ? 'Starting Task...' : 'Completing Task...'} />

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{task.taskId}</div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{task.clientName}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isOpen && !completed && (
                isEditingTask ? (
                  <>
                    <button onClick={handleTaskSave} disabled={taskSaving}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: theme.colors.orange, color: '#fff', cursor: taskSaving ? 'wait' : 'pointer' }}>
                      {taskSaving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
                      {taskSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={handleTaskEditCancel} disabled={taskSaving}
                      style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={handleTaskEditStart}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer' }}>
                    <Pencil size={12} /> Edit
                  </button>
                )
              )}
              <button onClick={onClose} disabled={submitting || startTaskLoading} style={{ background: 'none', border: 'none', cursor: (submitting || startTaskLoading) ? 'not-allowed' : 'pointer', padding: 4, color: theme.colors.textMuted, opacity: (submitting || startTaskLoading) ? 0.3 : 1 }}><X size={18} /></button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Badge t={SERVICE_CODES[task.type as keyof typeof SERVICE_CODES] || task.type} bg={tc.bg} color={tc.color} />
            <Badge t={completed ? 'Completed' : task.status} bg={completed ? STATUS_CFG.Completed.bg : sc.bg} color={completed ? STATUS_CFG.Completed.color : sc.color} />
            {task.result && <Badge t={task.result} bg={task.result === 'Pass' ? '#F0FDF4' : '#FEF2F2'} color={task.result === 'Pass' ? '#15803D' : '#DC2626'} />}
          </div>
        </div>
        {taskSaveError && (
          <div style={{ padding: '6px 20px', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #FECACA` }}>{taskSaveError}</div>
        )}
        {taskSaveSuccess && (
          <div style={{ padding: '6px 20px', background: '#F0FDF4', color: '#15803D', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #BBF7D0` }}>Changes saved successfully</div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

          {/* Item Info Card */}
          {task.itemId && (
            <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><Package size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Item</span></div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                <DeepLink kind="inventory" id={task.itemId} clientSheetId={(task as any).clientSheetId} />
                {task.vendor ? ` — ${task.vendor}` : ''}
              </div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{task.description}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: theme.colors.textMuted }}>
                {task.location && <span>Location: {task.location}</span>}
                {task.sidemark && <span>Sidemark: {task.sidemark}</span>}
              </div>
              {/* Drive Folder Buttons */}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <FolderButton label="Task Folder" url={activeFolderUrl || undefined} disabledTooltip="Start task to create folder" icon={Wrench} />
                <FolderButton label="Shipment Folder" url={activeShipmentFolderUrl || undefined} disabledTooltip="Folder link missing — use Fix Missing Folders on Inventory page" icon={Truck} />
                {isAlreadyStarted && canSeeCustomPrice && (
                  <WriteButton
                    label="Work Order"
                    variant="secondary"
                    size="sm"
                    icon={<FileText size={13} />}
                    onClick={async () => {
                      if (!apiConfigured || !clientSheetId) throw new Error('API not configured');
                      const resp = await postGenerateTaskWorkOrder({ taskId: task.taskId }, clientSheetId);
                      if (!resp.ok || !resp.data?.success) throw new Error(resp.error || resp.data?.error || 'PDF generation failed');
                    }}
                  />
                )}
                {isAlreadyStarted && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#F0FDF4', color: '#15803D', fontWeight: 600 }}>
                    ✓ Started {fmtDateTime(task.startedAt || startTaskResult?.startedAt)}
                  </span>
                )}
                {task.completedAt && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#EFF6FF', color: '#1D4ED8', fontWeight: 600 }}>
                    ✓ Completed {fmtDateTime(task.completedAt)}
                  </span>
                )}
                {task.cancelledAt && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: '#F3F4F6', color: '#6B7280', fontWeight: 600 }}>
                    ✕ Cancelled {fmtDateTime(task.cancelledAt)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Task Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginBottom: 16 }}>
            <Field label="Client" value={task.clientName} />
            <Field label="Sidemark" value={task.sidemark} />
            <Field label="Assigned To" value={task.assignedTo} />
            <Field label="Service" value={SERVICE_CODES[(task.svcCode || task.serviceCode) as keyof typeof SERVICE_CODES] || task.svcCode || task.serviceCode} />
            <Field label="Created" value={fmtDate(task.created || task.createdDate)} />
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 }}>Shipment</div>
              {(() => {
                const shipNo = task.shipmentNumber || task.shipmentNo;
                if (!shipNo) return <div style={{ fontSize: 13, color: theme.colors.textMuted }}>—</div>;
                return (
                  <a
                    href={`#/shipments?open=${encodeURIComponent(shipNo)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13, color: theme.colors.orange, fontWeight: 600, textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={e => e.stopPropagation()}
                  >
                    {shipNo}
                    <ExternalLink size={11} />
                  </a>
                );
              })()}
            </div>
          </div>
          <Field label="Description" value={task.description} />

          {/* Custom Price Override — staff + admin, open tasks only */}
          {canSeeCustomPrice && isOpen && !completed && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <DollarSign size={14} color={theme.colors.orange} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Price Override</span>
              </div>
              {isEditingTask ? (
                <>
                  <input type="number" min="0" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="Leave empty for default rate" style={{ ...input }} />
                  <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 3 }}>
                    {customPrice ? `Task will bill at $${Number(customPrice).toFixed(2)}` : 'Default rate from Price List will be used'}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: customPrice ? theme.colors.text : theme.colors.textMuted }}>
                  {customPrice ? `$${Number(customPrice).toFixed(2)}` : 'Default rate'}
                </div>
              )}
            </div>
          )}
          {canSeeCustomPrice && task.customPrice != null && (!isOpen || completed) && (
            <Field label="Price Override" value={`$${Number(task.customPrice).toFixed(2)}`} />
          )}

          {/* Location Update */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <MapPin size={14} color={theme.colors.orange} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Location</span>
            </div>
            {isEditingTask ? (
              <div style={{ position: 'relative' }}>
                <input
                  value={locationQuery}
                  onChange={e => { setLocationQuery(e.target.value); setLocation(e.target.value); }}
                  onFocus={() => setLocationFocused(true)}
                  onBlur={() => { setTimeout(() => setLocationFocused(false), 150); }}
                  placeholder="Type to search locations..."
                  style={{ ...input }}
                />
                {locationFocused && filteredLocations.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                    {filteredLocations.map(loc => (
                      <button
                        key={loc}
                        onMouseDown={() => { setLocation(loc); setLocationQuery(loc); }}
                        style={{ width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: theme.colors.text }}
                        onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        {loc}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{location || '\u2014'}</div>
            )}
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <ClipboardList size={14} color={theme.colors.orange} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Task Notes</span>
            </div>
            {isEditingTask ? (
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes about this task..." style={{ ...input, resize: 'vertical' }} />
            ) : (
              <div style={{ fontSize: 13, color: notes ? theme.colors.text : theme.colors.textMuted, lineHeight: 1.5 }}>{notes || 'No notes'}</div>
            )}
          </div>

          {/* Repair Quote Actions */}
          {task.itemId && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Wrench size={14} color={theme.colors.orange} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Repair</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!repairStatus ? (
                  <WriteButton label={repairRequesting ? 'Requesting...' : 'Request Repair Quote'} variant="secondary" size="sm" onClick={async () => { await handleRequestRepair(); }} />
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: repairStatus === 'Approved' ? '#F0FDF4' : repairStatus === 'Declined' ? '#FEF2F2' : '#EFF6FF', color: repairStatus === 'Approved' ? '#15803D' : repairStatus === 'Declined' ? '#DC2626' : '#1D4ED8' }}>
                    <CheckCircle2 size={12} />
                    {repairStatus === 'Pending Quote' ? 'Repair Quote Requested' : repairStatus === 'Quote Sent' ? 'Quote Sent — Awaiting Response' : repairStatus === 'Approved' ? 'Repair Approved' : 'Repair Declined'}
                  </span>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        {isOpen && !completed && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {/* Start Task section (shown when not yet started) */}
            {!isAlreadyStarted && !startTaskResult && (
              <div style={{ marginBottom: 12 }}>
                {startTaskError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, marginBottom: 8, fontSize: 12, color: '#DC2626' }}>
                    <AlertTriangle size={13} />{startTaskError}
                  </div>
                )}
                {/* Conflict alert — another user is assigned */}
                {startTaskConflict && (
                  <div style={{ padding: '10px 12px', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 6 }}>
                      <AlertTriangle size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      Task already assigned to {startTaskConflict.assignedTo}
                    </div>
                    <div style={{ fontSize: 11, color: '#92400E', marginBottom: 8 }}>Do you want to reassign this task to yourself?</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleStartTask(true)} style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #F59E0B', background: '#FEF3C7', color: '#92400E', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Yes, Reassign to Me
                      </button>
                      <button onClick={() => setStartTaskConflict(null)} style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 500, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!startTaskConflict && (
                  <button
                    onClick={() => handleStartTask()}
                    disabled={startTaskLoading}
                    style={{ width: '100%', padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: startTaskLoading ? theme.colors.bgSubtle : '#fff', color: startTaskLoading ? theme.colors.textMuted : theme.colors.orange, cursor: startTaskLoading ? 'wait' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8 }}
                  >
                    {startTaskLoading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={15} />}
                    {startTaskLoading ? 'Creating folder & work order…' : 'Start Task'}
                  </button>
                )}
              </div>
            )}
            {/* Start Task success banner */}
            {startTaskResult?.success && !startTaskResult.noOp && (
              <div style={{ padding: '8px 10px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, marginBottom: 10, fontSize: 12, color: '#15803D' }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  <CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Task started — folder {startTaskResult.pdfCreated ? '+ work order created' : 'created'}
                </div>
                {startTaskResult.folderUrl && (
                  <a href={startTaskResult.folderUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: '#15803D', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                    <FolderOpen size={11} />Open Task Folder<ExternalLink size={9} />
                  </a>
                )}
                {startTaskResult.warnings?.map((w, i) => (
                  <div key={i} style={{ color: '#B45309', marginTop: 2, fontSize: 11 }}>⚠ {w}</div>
                ))}
              </div>
            )}
            {/* Error banner for complete task */}
            {submitError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, marginBottom: 10, fontSize: 12, color: '#DC2626' }}>
                <AlertTriangle size={14} />{submitError}
              </div>
            )}
            {/* Loading spinner */}
            {submitting ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', color: theme.colors.textMuted, fontSize: 13 }}>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                Completing task…
              </div>
            ) : showResultPrompt === 'fail' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><AlertTriangle size={16} color="#B45309" /><span style={{ fontSize: 13, fontWeight: 600 }}>Task failed — what would you like to do?</span></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <WriteButton label="Complete (Bill)" variant="primary" style={{ flex: 1, background: '#B45309', padding: '10px', fontSize: 12 }} onClick={async () => handleFailChoice('complete')} />
                  <WriteButton label="Cancel (No Bill)" variant="secondary" style={{ flex: 1, padding: '10px', fontSize: 12 }} onClick={async () => handleFailChoice('cancel')} />
                </div>
                <button onClick={() => setShowResultPrompt(null)} style={{ width: '100%', marginTop: 6, padding: '6px', fontSize: 11, border: 'none', background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}>Go back</button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <WriteButton label="Pass" variant="primary" icon={<CheckCircle2 size={16} />} style={{ flex: 1, background: '#15803D', padding: '10px', fontSize: 13 }} onClick={async () => handleResult('pass')} />
                  <WriteButton label="Fail" variant="danger" icon={<XCircle size={16} />} style={{ flex: 1, padding: '10px', fontSize: 13 }} onClick={async () => handleResult('fail')} />
                </div>
                <button
                  onClick={async () => {
                    if (!confirm('Cancel this task? Status will be set to Cancelled.')) return;
                    if (!apiConfigured || !clientSheetId) return;
                    setSubmitting(true); setSubmitError(null);

                    // Phase 2C: optimistic patch — table shows "Cancelled" immediately
                    applyTaskPatch?.(task.taskId, {
                      status: 'Cancelled',
                      cancelledAt: new Date().toISOString().slice(0, 10),
                    });

                    try {
                      const resp = await postCancelTask({ taskId: task.taskId }, clientSheetId);
                      if (resp.ok && resp.data?.success) {
                        // Don't clear patch on success — let 120s TTL handle it (prevents flicker during refetch)
                        setCompleted(true);
                        onTaskUpdated?.();
                      }
                      else {
                        clearTaskPatch?.(task.taskId); // rollback
                        const errMsg = resp.data?.error || resp.error || 'Failed to cancel task';
                        setSubmitError(errMsg);
                        void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'task', entity_id: task.taskId, action_type: 'cancel_task', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { taskId: task.taskId, clientName: task.clientName, description: task.description, sidemark: task.sidemark, itemId: task.itemId }, error_message: errMsg });
                      }
                    } catch (e) {
                      clearTaskPatch?.(task.taskId); // rollback
                      setSubmitError('Failed to cancel task');
                    }
                    setSubmitting(false);
                  }}
                  style={{ width: '100%', marginTop: 8, padding: '7px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: 'transparent', color: theme.colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#EF4444'; e.currentTarget.style.color = '#EF4444'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.color = theme.colors.textMuted; }}
                >
                  Cancel Task
                </button>
              </div>
            )}
          </div>
        )}
        {(completed || !isOpen) && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
            {/* Success summary */}
            {completed && submitResult?.success && (
              <div style={{ padding: '10px 12px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, marginBottom: 10, fontSize: 12, color: '#15803D' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  <CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Task completed — {submitResult.result || task.result || ''}
                </div>
                {submitResult.billingCreated && <div>✓ Billing row created</div>}
                {submitResult.skipped && <div style={{ color: '#B45309' }}>Already processed — no duplicate writes.</div>}
                {submitResult.warnings?.map((w, i) => (
                  <div key={i} style={{ color: '#B45309', marginTop: 2 }}>⚠ {w}</div>
                ))}
              </div>
            )}
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
