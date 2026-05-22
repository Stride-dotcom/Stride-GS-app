/**
 * TaskPage.tsx — Full-page task detail view.
 * Route: #/tasks/:taskId
 *
 * Thin wrapper around TaskDetailPanel in `renderAsPage` mode. Fetches the
 * task + related repairs via useTaskDetail and passes optimistic patch
 * functions that the panel uses to reflect writes locally while the write
 * propagates through GAS + Supabase. All tabs, handlers, modals, and edit
 * logic live in TaskDetailPanel — page just wires data in and routes out.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDetail } from '../hooks/useTaskDetail';
import { useGoBack } from '../hooks/useGoBack';
import { TaskDetailPanel } from '../components/shared/TaskDetailPanel';
import { theme } from '../styles/theme';
import type { ApiTask } from '../lib/api';

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

export function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  // History-aware back for the error/not-found/access-denied/onClose paths;
  // `navigate` is still used for forward links (open item).
  const goBack = useGoBack('/tasks');
  const location = useLocation();
  useAuth();
  // ?client=<spreadsheetId> disambiguates duplicate task_ids that exist when
  // an item is transferred between auto-inspect clients (each tenant counter
  // is independent so source + destination can both hold INSP-<item>-1).
  const clientHint = new URLSearchParams(location.search).get('client') || undefined;
  const { task: fetchedTask, relatedRepairs, status, error, refetch } = useTaskDetail(taskId, clientHint);

  // Local optimistic state — page manages its own copy so inline edits and
  // patch functions update immediately while the write propagates.
  const [localTask, setLocalTask] = useState<ApiTask | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last time a local mutation (edit save) happened. Used to keep
  // optimistic state visible while GAS write-through propagates to Supabase
  // (~1-3s). Without this guard, an immediate refetch can overwrite the
  // optimistic value with stale data and the user sees their edit "disappear".
  const lastMutationAtRef = useRef<number>(0);
  const OPTIMISTIC_GUARD_MS = 6000;

  useEffect(() => {
    if (!fetchedTask) return;
    // Skip overwriting localTask while a save is in flight or just landed —
    // protects optimistic patches from being clobbered by a stale fetch.
    if (saving) return;
    if (Date.now() - lastMutationAtRef.current < OPTIMISTIC_GUARD_MS) return;
    setLocalTask(fetchedTask);
  }, [fetchedTask, saving]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // Silent so the post-save safety-net refetch doesn't flash the spinner
    // over the detail panel. The optimistic state in localTask already
    // shows the user's edit; this just grabs the authoritative server row
    // after GAS write-through to Supabase has had time to land.
    refreshTimerRef.current = setTimeout(() => { refetch({ silent: true }); }, 2500);
  }, [refetch]);

  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  const handleTaskUpdated = useCallback(() => {
    // Optimistic state in localTask is already up-to-date via mergeTaskPatch.
    // Don't immediately fetch from Supabase — write-through hasn't completed
    // yet and we'd show stale data. Schedule a delayed refresh as safety net.
    lastMutationAtRef.current = Date.now();
    scheduleRefresh();
  }, [scheduleRefresh]);

  const applyTaskPatch = useCallback((patchTaskId: string, patch: Partial<ApiTask>) => {
    setLocalTask(prev => prev && prev.taskId === patchTaskId ? { ...prev, ...patch } : prev);
    lastMutationAtRef.current = Date.now();
    setSaving(true);
  }, []);

  const mergeTaskPatch = useCallback((patchTaskId: string, patch: Partial<ApiTask>) => {
    setLocalTask(prev => prev && prev.taskId === patchTaskId ? { ...prev, ...patch } : prev);
    lastMutationAtRef.current = Date.now();
  }, []);

  const clearTaskPatch = useCallback((_patchTaskId: string) => {
    setSaving(false);
    scheduleRefresh();
  }, [scheduleRefresh]);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading task{taskId ? ` ${taskId}` : ''}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this task." actions={<button onClick={goBack} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Task Not Found" body={`No task with ID "${taskId}" was found.`} actions={<button onClick={goBack} style={backBtnStyle}>Back to Tasks</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Task" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={goBack} style={backBtnStyle}>Back to Tasks</button></div>}
      />
    );
  }

  const task = localTask ?? fetchedTask;
  if (!task) return null;

  return (
    <TaskDetailPanel
      renderAsPage
      task={task}
      onClose={goBack}
      onTaskUpdated={handleTaskUpdated}
      onNavigateToItem={(itemId) => navigate(`/inventory/${encodeURIComponent(itemId)}`)}
      itemRepairs={relatedRepairs}
      applyTaskPatch={applyTaskPatch}
      mergeTaskPatch={mergeTaskPatch}
      clearTaskPatch={clearTaskPatch}
    />
  );
}
