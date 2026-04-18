/**
 * TaskJobPage.tsx — Standalone task detail page for direct-by-ID access.
 * Opens in a new tab from Dashboard. Loads one task from Supabase (~50ms)
 * with legacy GAS fallback. Full task workflow parity with TaskDetailPanel.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDetail } from '../hooks/useTaskDetail';
import { TaskDetailPanel } from '../components/shared/TaskDetailPanel';
import { theme } from '../styles/theme';
import { fetchTaskByIdFromSupabase } from '../lib/supabaseQueries';
import type { ApiTask } from '../lib/api';
import { ArrowLeft, AlertCircle, SearchX, ShieldX, Loader2 } from 'lucide-react';

export function TaskJobPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  useAuth(); // Ensure auth context is loaded (required for new-tab bootstrap)
  const { task: fetchedTask, relatedRepairs, status, error, source, refetch } = useTaskDetail(taskId);

  // Local optimistic state — standalone page manages its own state
  const [localTask, setLocalTask] = useState<ApiTask | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync fetched task into local state
  useEffect(() => {
    if (fetchedTask && !saving) {
      setLocalTask(fetchedTask);
    }
  }, [fetchedTask, saving]);

  // Delayed Supabase re-fetch after a write to confirm sync
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refetch();
    }, 1500);
  }, [refetch]);

  // Cleanup timer
  useEffect(() => {
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, []);

  // Optimistic task update handler — called after write actions
  const handleTaskUpdated = useCallback(() => {
    setSaving(true);
    // Brief delay to let write-through land, then re-fetch
    setTimeout(async () => {
      if (taskId) {
        // Try Supabase first for fast refresh
        const fresh = await fetchTaskByIdFromSupabase(taskId);
        if (fresh) {
          setLocalTask(fresh);
        }
      }
      setSaving(false);
      scheduleRefresh();
    }, 800);
  }, [taskId, scheduleRefresh]);

  // Optimistic patch functions for TaskDetailPanel
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

  // Loading state
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: theme.colors.textMuted }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 14 }}>Loading task{taskId ? ` ${taskId}` : ''}...</div>
        {source === null && <div style={{ fontSize: 12, color: theme.colors.textMuted }}>Checking Supabase cache...</div>}
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // Access denied
  if (status === 'access-denied') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <ShieldX size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>Access Denied</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          You don't have permission to view this task. It belongs to a client outside your access scope.
        </div>
        <button onClick={() => navigate('/')} style={linkBtnStyle}>
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
      </div>
    );
  }

  // Not found
  if (status === 'not-found') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <SearchX size={48} color={theme.colors.textMuted} />
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>Task Not Found</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          No task with ID <code style={{ fontSize: 13, background: theme.colors.bgSubtle, padding: '2px 6px', borderRadius: 4 }}>{taskId}</code> was found in any accessible client sheet.
        </div>
        <button onClick={() => navigate('/')} style={linkBtnStyle}>
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
      </div>
    );
  }

  // Error
  if (status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <AlertCircle size={48} color={theme.colors.statusRed} />
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.colors.text }}>Failed to Load Task</div>
        <div style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', maxWidth: 400 }}>
          {error || 'An unexpected error occurred.'}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={refetch} style={{ ...linkBtnStyle, color: theme.colors.primary }}>Retry</button>
          <button onClick={() => navigate('/')} style={linkBtnStyle}>
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Loaded — render task detail
  const displayTask = localTask || fetchedTask;
  if (!displayTask) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C', marginBottom: 16 }}>STRIDE LOGISTICS · TASK · {displayTask.taskId}</div>
      <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.04)', flex: 1, overflow: 'auto', display: 'flex' }}>
      {/* Saving indicator */}
      {saving && (
        <div style={{
          position: 'fixed', top: 12, right: 12, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 8,
          background: theme.colors.primaryLight || '#FEF3EE',
          color: theme.colors.primary,
          fontSize: 13, fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Saving...
        </div>
      )}

      {/* Full-width detail panel */}
      <div style={{ flex: 1 }}>
        <TaskDetailPanel
          task={displayTask}
          onClose={() => navigate('/')}
          onTaskUpdated={handleTaskUpdated}
          onNavigateToItem={(itemId) => navigate('/inventory', { state: { openItemId: itemId } })}
          itemRepairs={relatedRepairs}
          applyTaskPatch={applyTaskPatch}
          mergeTaskPatch={mergeTaskPatch}
          clearTaskPatch={clearTaskPatch}
        />
      </div>
      </div>
    </div>
  );
}

const linkBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8,
  border: `1px solid ${theme.colors.border}`,
  background: 'white', color: theme.colors.text,
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
