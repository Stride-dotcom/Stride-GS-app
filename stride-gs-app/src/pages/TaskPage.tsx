import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX, ClipboardList, ExternalLink } from 'lucide-react';
import { theme } from '../styles/theme';
import { useTaskDetail } from '../hooks/useTaskDetail';
import { EntityPage, EPCard, EPLabel, EPFooterButton, EntityPageTokens } from '../components/shared/EntityPage';
import { EntityHistory } from '../components/shared/EntityHistory';
import { fmtDate } from '../lib/constants';

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

function DetailsTab({ task, onNavigateToItem }: { task: ReturnType<typeof useTaskDetail>['task'] & object; onNavigateToItem: (id: string) => void }) {
  if (!task) return null;
  return (
    <div>
      {/* Item info card */}
      <EPCard>
        <EPLabel>Linked Item</EPLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginTop: 4 }}>
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
          <Field label="Location"    value={task.location} />
          <Field label="Sidemark"    value={task.sidemark} />
          {task.shipmentNumber && <Field label="Shipment #" value={task.shipmentNumber} />}
        </div>
      </EPCard>

      {/* Task details card */}
      <EPCard>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>
          <Field label="Type"        value={task.type} />
          <Field label="Svc Code"    value={task.svcCode} />
          <Field label="Assigned To" value={task.assignedTo} />
          <Field label="Priority"    value={task.priority} />
          <Field label="Created"     value={fmtDate(task.created)} />
          {task.dueDate     && <Field label="Due Date"    value={fmtDate(task.dueDate)} />}
          {task.startedAt   && <Field label="Started"     value={fmtDate(task.startedAt)} />}
          {task.completedAt && <Field label="Completed"   value={fmtDate(task.completedAt)} />}
        </div>
      </EPCard>

      {/* Result */}
      {task.result && (
        <EPCard>
          <EPLabel>Result</EPLabel>
          <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{task.result}</div>
        </EPCard>
      )}

      {/* Drive folder */}
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
  const { task, status, error, refetch } = useTaskDetail(taskId);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading task{taskId ? ` ${taskId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (status === 'access-denied') {
    return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this task." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  }

  if (status === 'not-found') {
    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Task Not Found" body={`No task with ID "${taskId}" was found.`} actions={<button onClick={() => navigate('/tasks')} style={backBtnStyle}>Back to Tasks</button>} />;
  }

  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Task" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/tasks')} style={backBtnStyle}>Back to Tasks</button></div>}
      />
    );
  }

  if (!task) return null;

  // ── State-aware footer ──
  const isOpen       = task.status === 'Open';
  const isInProgress = task.status === 'In Progress';
  const isCompleted  = task.status === 'Completed';

  const footer = (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <EPFooterButton
          label="View Item"
          variant="secondary"
          icon={<ClipboardList size={13} />}
          onClick={() => task.itemId && navigate(`/inventory/${task.itemId}`)}
          disabled={!task.itemId}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {isOpen && (
          <EPFooterButton label="Start Task" variant="primary" />
        )}
        {isInProgress && (
          <>
            <EPFooterButton label="Fail" variant="secondary" />
            <EPFooterButton label="Pass" variant="primary" />
          </>
        )}
        {isCompleted && (
          <EPFooterButton label="Correct Result" variant="secondary" />
        )}
      </div>
    </>
  );

  const tabs = [
    { id: 'details', label: 'Details', keepMounted: true, render: () => <DetailsTab task={task} onNavigateToItem={(id) => navigate(`/inventory/${id}`)} /> },
    { id: 'photos', label: 'Photos' },
    { id: 'docs',   label: 'Docs' },
    { id: 'notes',  label: 'Notes' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <EntityPage
      entityLabel="Task"
      entityId={task.taskId}
      statusBadge={<StatusBadge status={task.status} />}
      clientName={task.clientName}
      sidemark={task.sidemark}
      metaPills={
        <>
          {task.type && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: `2px ${theme.spacing.sm}`, borderRadius: theme.radii.md, background: theme.colors.bgSubtle, fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary, fontWeight: theme.typography.weights.medium }}>
              <span style={{ fontSize: 9, fontWeight: theme.typography.weights.semibold, color: EntityPageTokens.labelColor, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Type</span>
              {task.type}
            </span>
          )}
          {task.svcCode && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: `2px ${theme.spacing.sm}`, borderRadius: theme.radii.md, background: theme.colors.bgSubtle, fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary, fontWeight: theme.typography.weights.medium }}>
              <span style={{ fontSize: 9, fontWeight: theme.typography.weights.semibold, color: EntityPageTokens.labelColor, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Svc</span>
              {task.svcCode}
            </span>
          )}
        </>
      }
      tabs={tabs}
      builtInTabs={{
        photos: { entityType: 'task', entityId: task.taskId, tenantId: task.clientSheetId },
        docs:   { contextType: 'task', contextId: task.taskId, tenantId: task.clientSheetId },
        notes:  { entityType: 'task', entityId: task.taskId, itemId: task.itemId },
        activity: { render: () => <ActivityTab entityId={task.taskId} tenantId={task.clientSheetId} /> },
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
