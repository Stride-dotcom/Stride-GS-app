import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX, ExternalLink, Pencil, X } from 'lucide-react';
import { theme } from '../styles/theme';
import { useTaskDetail } from '../hooks/useTaskDetail';
import { useAuth } from '../contexts/AuthContext';
import { useLocations } from '../hooks/useLocations';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate, SERVICE_CODES } from '../lib/constants';
import {
  postStartTask,
  postCompleteTask,
  postCancelTask,
  postReopenTask,
  postCorrectTaskResult,
  postUpdateTaskNotes,
  postUpdateTaskPriority,
  postUpdateTaskDueDate,
  postUpdateTaskCustomPrice,
  postRequestRepairQuote,
  postGenerateTaskWorkOrder,
  postUpdateInventoryItem,
} from '../lib/api';

// ── Status badge ──────────────────────────────────────────────────────────────

const TASK_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Open':        { bg: theme.colors.statusAmberBg,  color: theme.colors.statusAmber },
  'In Progress': { bg: theme.colors.statusBlueBg,   color: theme.colors.statusBlue },
  'Completed':   { bg: theme.colors.statusGreenBg,  color: theme.colors.statusGreen },
  'Failed':      { bg: theme.colors.statusRedBg,    color: theme.colors.statusRed },
  'Cancelled':   { bg: theme.colors.statusGrayBg,   color: theme.colors.statusGray },
};

function StatusBadge({ status }: { status: string }) {
  const c = TASK_STATUS_COLORS[status] ?? { bg: theme.colors.statusGrayBg, color: theme.colors.statusGray };
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
              key={f.label}
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
          entityType="task"
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

type Task = NonNullable<ReturnType<typeof useTaskDetail>['task']>;

interface DetailsTabProps {
  task: Task;
  isStaff: boolean;
  onNavigateToItem: (id: string) => void;
  onNavigateToShipment: (no: string) => void;
  onRefetch: () => void;
}

function DetailsTab({ task, isStaff, onNavigateToItem, onNavigateToShipment, onRefetch }: DetailsTabProps) {
  const { locationNames } = useLocations();

  // ── Edit state ──
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState('');
  const [draftLocation, setDraftLocation] = useState('');
  const [draftCustomPrice, setDraftCustomPrice] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [showLocationDrop, setShowLocationDrop] = useState(false);
  const locationRef = useRef<HTMLDivElement>(null);

  // ── Correct Result widget ──
  const [showCorrectResult, setShowCorrectResult] = useState(false);
  const [correctingResult, setCorrectingResult] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);

  // ── Priority toggle ──
  const [priorityLoading, setPriorityLoading] = useState(false);

  // ── Due date blur save ──
  const [dueDateLoading, setDueDateLoading] = useState(false);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (locationRef.current && !locationRef.current.contains(e.target as Node)) {
        setShowLocationDrop(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredLocations = locationNames.filter(l =>
    l.toLowerCase().includes(locationQuery.toLowerCase())
  ).slice(0, 8);

  function handleEditStart() {
    setDraftNotes(task.taskNotes ?? '');
    setDraftLocation(task.location ?? '');
    setDraftCustomPrice(task.customPrice != null ? String(task.customPrice) : '');
    setLocationQuery(task.location ?? '');
    setSaveError(null);
    setIsEditing(true);
  }

  async function handleSave() {
    if (!task.clientSheetId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await postUpdateTaskNotes(
        { taskId: task.taskId, taskNotes: draftNotes, location: draftLocation || undefined },
        task.clientSheetId,
      );
      if (draftLocation && draftLocation !== task.location && task.itemId) {
        await postUpdateInventoryItem(
          { itemId: task.itemId, location: draftLocation },
          task.clientSheetId,
        );
      }
      const newPrice = draftCustomPrice.trim() === '' ? null : parseFloat(draftCustomPrice);
      if (!isNaN(newPrice as number) || newPrice === null) {
        await postUpdateTaskCustomPrice(
          { taskId: task.taskId, customPrice: newPrice },
          task.clientSheetId,
        );
      }
      onRefetch();
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handlePriorityToggle() {
    if (!task.clientSheetId || !isStaff) return;
    const newPriority = task.priority === 'High' ? 'Normal' : 'High';
    setPriorityLoading(true);
    try {
      await postUpdateTaskPriority({ taskId: task.taskId, priority: newPriority }, task.clientSheetId);
      onRefetch();
    } catch {
      // silent fail on priority toggle
    } finally {
      setPriorityLoading(false);
    }
  }

  async function handleDueDateChange(val: string) {
    if (!task.clientSheetId || !isStaff) return;
    setDueDateLoading(true);
    try {
      await postUpdateTaskDueDate({ taskId: task.taskId, dueDate: val || null }, task.clientSheetId);
      onRefetch();
    } catch {
      // silent fail
    } finally {
      setDueDateLoading(false);
    }
  }

  async function handleCorrectResult(newResult: 'Pass' | 'Fail') {
    if (!task.clientSheetId) return;
    setCorrectingResult(true);
    setCorrectError(null);
    try {
      await postCorrectTaskResult({ taskId: task.taskId, newResult }, task.clientSheetId);
      onRefetch();
      setShowCorrectResult(false);
    } catch (err) {
      setCorrectError(err instanceof Error ? err.message : 'Failed to correct result');
    } finally {
      setCorrectingResult(false);
    }
  }

  const isOpen       = task.status === 'Open';
  const isInProgress = task.status === 'In Progress';
  const isCompleted  = task.status === 'Completed';

  return (
    <div>
      {/* Item info card */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          <div>
            <EPLabel>Item ID</EPLabel>
            {task.itemId ? (
              <button
                onClick={() => onNavigateToItem(task.itemId!)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, fontFamily: 'inherit',
                  fontSize: theme.typography.sizes.base,
                  fontWeight: theme.typography.weights.semibold,
                  color: theme.colors.orange,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {task.itemId}
                <ExternalLink size={11} />
              </button>
            ) : (
              <span style={{ fontSize: theme.typography.sizes.base, color: theme.colors.textMuted }}>—</span>
            )}
          </div>
          <Field label="Vendor"      value={task.vendor} />
          <Field label="Description" value={task.description} />
          {isEditing ? (
            <div ref={locationRef} style={{ position: 'relative' }}>
              <EPLabel>Location</EPLabel>
              <input
                value={locationQuery}
                onChange={e => { setLocationQuery(e.target.value); setDraftLocation(e.target.value); setShowLocationDrop(true); }}
                onFocus={() => setShowLocationDrop(true)}
                placeholder="Enter location…"
                style={inputStyle}
              />
              {showLocationDrop && filteredLocations.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radii.md, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 20, maxHeight: 180, overflowY: 'auto' }}>
                  {filteredLocations.map(l => (
                    <button key={l} onClick={() => { setDraftLocation(l); setLocationQuery(l); setShowLocationDrop(false); }}
                      style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, color: theme.colors.text, fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >{l}</button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Field label="Location" value={task.location} />
          )}
          <Field label="Sidemark"    value={task.sidemark} />
          {task.shipmentNumber && (
            <div>
              <EPLabel>Shipment #</EPLabel>
              <button
                onClick={() => onNavigateToShipment(task.shipmentNumber!)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 0, fontFamily: 'inherit',
                  fontSize: theme.typography.sizes.base,
                  fontWeight: theme.typography.weights.semibold,
                  color: theme.colors.orange,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {task.shipmentNumber}
                <ExternalLink size={11} />
              </button>
            </div>
          )}
        </div>
      </EPCard>

      {/* Task details card */}
      <EPCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div />
          {isStaff && (
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
          <Field label="Service"     value={SERVICE_CODES[task.svcCode as keyof typeof SERVICE_CODES] ?? task.svcCode} />
          <Field label="Assigned To" value={task.assignedTo} />
          <div>
            <EPLabel>Priority</EPLabel>
            {isStaff && (isOpen || isInProgress) ? (
              <button
                onClick={handlePriorityToggle}
                disabled={priorityLoading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: theme.radii.full,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.semibold,
                  background: task.priority === 'High' ? theme.colors.statusRedBg : theme.colors.bgSubtle,
                  color: task.priority === 'High' ? theme.colors.statusRed : theme.colors.textSecondary,
                  opacity: priorityLoading ? 0.6 : 1,
                }}
              >
                {task.priority ?? 'Normal'}
              </button>
            ) : (
              <div style={{ fontSize: theme.typography.sizes.base, color: task.priority ? theme.colors.text : theme.colors.textMuted, fontWeight: task.priority ? theme.typography.weights.medium : theme.typography.weights.normal }}>
                {task.priority ?? '—'}
              </div>
            )}
          </div>
          <div>
            <EPLabel>Due Date</EPLabel>
            {isStaff && (isOpen || isInProgress) ? (
              <input
                type="date"
                defaultValue={task.dueDate ? task.dueDate.split('T')[0] : ''}
                onChange={e => handleDueDateChange(e.target.value)}
                disabled={dueDateLoading}
                style={{ ...inputStyle, fontSize: 13, width: '100%' }}
              />
            ) : (
              <div style={{ fontSize: theme.typography.sizes.base, color: task.dueDate ? theme.colors.text : theme.colors.textMuted }}>
                {task.dueDate ? fmtDate(task.dueDate) : '—'}
              </div>
            )}
          </div>
          <Field label="Created"    value={fmtDate(task.created)} />
          {task.startedAt   && <Field label="Started"   value={fmtDate(task.startedAt)} />}
          {task.completedAt && <Field label="Completed" value={fmtDate(task.completedAt)} />}
        </div>

        {/* Task notes */}
        <div style={{ marginTop: 14 }}>
          <EPLabel>Notes</EPLabel>
          {isEditing ? (
            <textarea
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              placeholder="Task notes…"
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            />
          ) : (
            <div style={{ fontSize: 13, color: task.taskNotes ? theme.colors.text : theme.colors.textMuted, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {task.taskNotes || '—'}
            </div>
          )}
        </div>

        {/* Custom price (staff only) */}
        {isStaff && isEditing && (
          <div style={{ marginTop: 14 }}>
            <EPLabel>Custom Price Override</EPLabel>
            <input
              type="number"
              value={draftCustomPrice}
              onChange={e => setDraftCustomPrice(e.target.value)}
              placeholder="Leave blank for standard pricing"
              min="0"
              step="0.01"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
        )}

        {isEditing && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...actionBtnStyle, background: theme.colors.orange, color: '#fff' }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button onClick={() => setIsEditing(false)} style={actionBtnStyle}>Cancel</button>
            {saveError && <span style={{ fontSize: 12, color: theme.colors.statusRed }}>{saveError}</span>}
          </div>
        )}
      </EPCard>

      {/* Result card */}
      {task.result && (
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
          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: showCorrectResult ? 12 : 0 }}>
            {task.result}
          </div>
          {showCorrectResult && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: theme.colors.textSecondary }}>Change to:</span>
              <button
                onClick={() => handleCorrectResult('Pass')}
                disabled={correctingResult}
                style={{ ...actionBtnStyle, background: theme.colors.statusGreenBg, color: theme.colors.statusGreen }}
              >Pass</button>
              <button
                onClick={() => handleCorrectResult('Fail')}
                disabled={correctingResult}
                style={{ ...actionBtnStyle, background: theme.colors.statusRedBg, color: theme.colors.statusRed }}
              >Fail</button>
              <button onClick={() => setShowCorrectResult(false)} style={actionBtnStyle}>
                <X size={12} />
              </button>
              {correctError && <span style={{ fontSize: 12, color: theme.colors.statusRed }}>{correctError}</span>}
            </div>
          )}
        </EPCard>
      )}

      {/* Task folder link */}
      {task.taskFolderUrl && (
        <EPCard>
          <a
            href={task.taskFolderUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.orange, fontWeight: theme.typography.weights.medium,
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={13} />
            View Task Folder in Drive
          </a>
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

export function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { task, status, error, refetch } = useTaskDetail(taskId);

  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  // ── Action state ──
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showFailPrompt, setShowFailPrompt] = useState(false);
  const [showConflict, setShowConflict] = useState(false);

  // ── Loading states ──
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading task{taskId ? ` ${taskId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this task." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Task Not Found" body={`No task with ID "${taskId}" was found.`} actions={<button onClick={() => navigate('/tasks')} style={backBtnStyle}>Back to Tasks</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Task" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/tasks')} style={backBtnStyle}>Back to Tasks</button></div>}
      />
    );
  }
  if (!task) return null;
  const t = task;

  const clientSheetId = t.clientSheetId;
  const isOpen       = t.status === 'Open';
  const isInProgress = t.status === 'In Progress';
  const isCompleted  = t.status === 'Completed';
  const isActive     = isOpen || isInProgress;
  const isInspection = t.type === 'INSP' || t.type === 'Inspection';

  // ── Action handlers ──

  async function handleStartTask(forceOverride = false) {
    if (!clientSheetId) return;
    setActionLoading('start');
    setActionError(null);
    setShowConflict(false);
    try {
      await postStartTask({ taskId: t.taskId, assignedTo: user?.email, forceOverride }, clientSheetId);
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start task';
      if (msg.toLowerCase().includes('conflict') || msg.toLowerCase().includes('already started')) {
        setShowConflict(true);
      } else {
        setActionError(msg);
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCompleteTask(result: 'Pass' | 'Fail') {
    if (!clientSheetId) return;
    setActionLoading(result === 'Pass' ? 'pass' : 'fail');
    setActionError(null);
    setShowFailPrompt(false);
    try {
      await postCompleteTask({ taskId: t.taskId, result }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to complete task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancelTask() {
    if (!clientSheetId) return;
    if (!window.confirm(`Cancel task ${t.taskId}? This cannot be undone.`)) return;
    setActionLoading('cancel');
    setActionError(null);
    try {
      await postCancelTask({ taskId: t.taskId }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReopenTask() {
    if (!clientSheetId) return;
    const reason = window.prompt('Reason for reopening (optional):');
    if (reason === null) return;
    setActionLoading('reopen');
    setActionError(null);
    try {
      await postReopenTask({ taskId: t.taskId, reason: reason || undefined }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reopen task');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRequestRepair() {
    if (!clientSheetId || !t.itemId) return;
    setActionLoading('repair');
    setActionError(null);
    try {
      const res = await postRequestRepairQuote({ itemId: t.itemId, sourceTaskId: t.taskId }, clientSheetId);
      const repairId = (res as { repairId?: string }).repairId ?? (res as { data?: { repairId?: string } }).data?.repairId;
      if (repairId) {
        navigate(`/repairs/${repairId}`);
      }
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to request repair quote');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleGenerateWorkOrder() {
    if (!clientSheetId) return;
    setActionLoading('workorder');
    setActionError(null);
    try {
      await postGenerateTaskWorkOrder({ taskId: t.taskId }, clientSheetId);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to generate work order');
    } finally {
      setActionLoading(null);
    }
  }

  function handleFailClick() {
    if (isInspection) {
      handleCompleteTask('Fail');
    } else {
      setShowFailPrompt(true);
    }
  }

  // ── Footer ──
  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {t.itemId && (
          <EPFooterButton
            label="View Item"
            variant="secondary"
            onClick={() => navigate(`/inventory/${t.itemId}`)}
          />
        )}
        {isStaff && isActive && t.itemId && (
          <EPFooterButton
            label="Repair Quote"
            variant="secondary"
            disabled={actionLoading === 'repair'}
            onClick={handleRequestRepair}
          />
        )}
        {isStaff && isInProgress && (
          <EPFooterButton
            label={actionLoading === 'workorder' ? 'Generating…' : 'Work Order'}
            variant="secondary"
            disabled={!!actionLoading}
            onClick={handleGenerateWorkOrder}
          />
        )}
        {isStaff && isActive && (
          <EPFooterButton
            label={actionLoading === 'cancel' ? 'Cancelling…' : 'Cancel Task'}
            variant="secondary"
            disabled={!!actionLoading}
            onClick={handleCancelTask}
          />
        )}
        {isStaff && (isCompleted || isInProgress) && (
          <EPFooterButton
            label={actionLoading === 'reopen' ? 'Reopening…' : 'Reopen'}
            variant="secondary"
            disabled={!!actionLoading}
            onClick={handleReopenTask}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {actionError && (
          <span style={{ fontSize: 11, color: theme.colors.statusRed, maxWidth: 200 }}>{actionError}</span>
        )}
        {isStaff && isOpen && (
          <EPFooterButton
            label={actionLoading === 'start' ? 'Starting…' : 'Start Task'}
            variant="primary"
            disabled={!!actionLoading}
            onClick={() => handleStartTask()}
          />
        )}
        {isStaff && isInProgress && (
          <>
            <EPFooterButton
              label={actionLoading === 'fail' ? 'Failing…' : 'Fail'}
              variant="secondary"
              disabled={!!actionLoading}
              onClick={handleFailClick}
            />
            <EPFooterButton
              label={actionLoading === 'pass' ? 'Completing…' : 'Pass'}
              variant="primary"
              disabled={!!actionLoading}
              onClick={() => handleCompleteTask('Pass')}
            />
          </>
        )}
      </div>

      {/* Fail choice overlay */}
      {showFailPrompt && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: '#fff', borderRadius: theme.radii.xl, padding: 24, maxWidth: 360, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: theme.colors.text, marginBottom: 8 }}>Fail Task</div>
            <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 20 }}>
              How would you like to complete this task?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => handleCompleteTask('Fail')}
                disabled={!!actionLoading}
                style={{ ...actionBtnStyle, background: theme.colors.statusRedBg, color: theme.colors.statusRed, padding: '10px 16px', fontSize: 14, width: '100%' }}
              >
                Complete (Bill)
              </button>
              <button
                onClick={handleCancelTask}
                disabled={!!actionLoading}
                style={{ ...actionBtnStyle, background: theme.colors.bgSubtle, color: theme.colors.text, padding: '10px 16px', fontSize: 14, width: '100%' }}
              >
                Cancel (No Bill)
              </button>
              <button
                onClick={() => setShowFailPrompt(false)}
                style={{ ...actionBtnStyle, background: 'none', color: theme.colors.textSecondary, padding: '8px 16px', fontSize: 13, width: '100%' }}
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict override overlay */}
      {showConflict && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: '#fff', borderRadius: theme.radii.xl, padding: 24, maxWidth: 360, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: theme.colors.text, marginBottom: 8 }}>Task Already Started</div>
            <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 20 }}>
              This task was started by another user. Do you want to reassign it to yourself?
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleStartTask(true)}
                disabled={!!actionLoading}
                style={{ ...actionBtnStyle, background: theme.colors.orange, color: '#fff', padding: '10px 16px', fontSize: 14, flex: 1 }}
              >
                Yes, Reassign
              </button>
              <button
                onClick={() => setShowConflict(false)}
                style={{ ...actionBtnStyle, background: theme.colors.bgSubtle, color: theme.colors.text, padding: '10px 16px', fontSize: 14, flex: 1 }}
              >
                Cancel
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
          task={task}
          isStaff={isStaff}
          onNavigateToItem={id => navigate(`/inventory/${id}`)}
          onNavigateToShipment={no => navigate(`/shipments/${no}`)}
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
      entityLabel="Task"
      entityId={t.taskId}
      statusBadge={<StatusBadge status={t.status} />}
      clientName={t.clientName}
      tabs={tabs}
      builtInTabs={{
        photos:   { entityType: 'task', entityId: t.taskId, tenantId: t.clientSheetId },
        docs:     { contextType: 'task', contextId: t.taskId, tenantId: t.clientSheetId },
        notes:    { entityType: 'task', entityId: t.taskId, itemId: t.itemId },
        activity: { render: () => <ActivityTab entityId={t.taskId} tenantId={t.clientSheetId} /> },
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
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 12px', borderRadius: theme.radii.md,
  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.medium,
  background: theme.colors.bgSubtle, color: theme.colors.text,
};
