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
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, SearchX, ShieldX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDetail } from '../hooks/useTaskDetail';
import { TaskDetailPanel } from '../components/shared/TaskDetailPanel';
import { theme } from '../styles/theme';
import { fetchTaskByIdFromSupabase } from '../lib/supabaseQueries';
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
  useAuth();
  const { task: fetchedTask, relatedRepairs, status, error, refetch } = useTaskDetail(taskId);

  // Local optimistic state — page manages its own copy so inline edits and
  // patch functions update immediately while the write propagates.
  const [localTask, setLocalTask] = useState<ApiTask | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fetchedTask && !saving) setLocalTask(fetchedTask);
  }, [fetchedTask, saving]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { refetch(); }, 1500);
  }, [refetch]);

  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  const handleTaskUpdated = useCallback(() => {
    setSaving(true);
    setTimeout(async () => {
      if (taskId) {
        const fresh = await fetchTaskByIdFromSupabase(taskId);
        if (fresh) setLocalTask(fresh);
      }
      setSaving(false);
      scheduleRefresh();
    }, 800);
  }, [taskId, scheduleRefresh]);

  const applyTaskPatch = useCallback((patchTaskId: string, patch: Partial<ApiTask>) => {
    setLocalTask(prev => prev && prev.taskId === patchTaskId ? { ...prev, ...patch } : prev);
    setSaving(true);
  }, []);

  const mergeTaskPatch = useCallback((patchTaskId: string, patch: Partial<ApiTask>) => {
    setLocalTask(prev => prev && prev.taskId === patchTaskId ? { ...prev, ...patch } : prev);
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
  if (status === 'access-denied') return <PageState icon={ShieldX} color={theme.colors.statusRed} title="Access Denied" body="You don't have permission to view this task." actions={<button onClick={() => navigate(-1)} style={backBtnStyle}>Go Back</button>} />;
  if (status === 'not-found')    return <PageState icon={SearchX} color={theme.colors.textMuted} title="Task Not Found" body={`No task with ID "${taskId}" was found.`} actions={<button onClick={() => navigate('/tasks')} style={backBtnStyle}>Back to Tasks</button>} />;
  if (status === 'error') {
    return (
      <PageState icon={AlertCircle} color={theme.colors.statusRed} title="Failed to Load Task" body={error || 'An unexpected error occurred.'}
        actions={<div style={{ display: 'flex', gap: 12 }}><button onClick={refetch} style={{ ...backBtnStyle, color: theme.colors.primary }}>Retry</button><button onClick={() => navigate('/tasks')} style={backBtnStyle}>Back to Tasks</button></div>}
      />
    );
  }

  const task = localTask ?? fetchedTask;
  if (!task) return null;

  return (
    <TaskDetailPanel
      renderAsPage
      task={task}
      onClose={() => navigate(-1)}
      onTaskUpdated={handleTaskUpdated}
      onNavigateToItem={(itemId) => navigate(`/inventory/${encodeURIComponent(itemId)}`)}
      itemRepairs={relatedRepairs}
      applyTaskPatch={applyTaskPatch}
      mergeTaskPatch={mergeTaskPatch}
      clearTaskPatch={clearTaskPatch}
    />
  );
}
