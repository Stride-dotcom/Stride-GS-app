import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { timerStartJob } from '@/lib/time/timerClient';

type PausedTask = { id: string; title: string; task_type: string };

/**
 * Global prompt (mounted once in DashboardLayout) that allows a user to resume
 * one of their recently auto-paused tasks after completing another job.
 *
 * Trigger by dispatching:
 *   window.dispatchEvent(new CustomEvent('stride:prompt-resume-paused-task', { detail: { excludeTaskId } }))
 */
export function ResumePausedTaskPrompt() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [confirmNotNowOpen, setConfirmNotNowOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);

  const [pausedTasks, setPausedTasks] = useState<PausedTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');

  const loadPausedTasksForResume = useCallback(async (excludeTaskId?: string) => {
    if (!profile?.tenant_id || !profile?.id) return [] as PausedTask[];

    // Find the most recent tasks that were auto-paused for THIS user.
    const { data: pausedIntervals } = await (supabase
      .from('job_time_intervals') as any)
      .select('job_id, ended_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', profile.id)
      .eq('job_type', 'task')
      .eq('ended_reason', 'auto_pause')
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(10);

    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const row of pausedIntervals || []) {
      const tid = row.job_id as string | undefined;
      if (!tid || seen.has(tid)) continue;
      if (excludeTaskId && tid === excludeTaskId) continue;
      seen.add(tid);
      orderedIds.push(tid);
    }

    if (orderedIds.length === 0) return [] as PausedTask[];

    const { data: taskRows } = await (supabase
      .from('tasks') as any)
      .select('id, title, task_type, status, assigned_to')
      .eq('tenant_id', profile.tenant_id)
      .in('id', orderedIds);

    const byId = new Map<string, any>((taskRows || []).map((t: any) => [t.id, t]));

    return orderedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((t: any) => t.status === 'in_progress' && t.assigned_to === profile.id)
      .slice(0, 3)
      .map((t: any) => ({
        id: t.id,
        title: t.title || `${t.task_type} task`,
        task_type: t.task_type,
      })) as PausedTask[];
  }, [profile?.tenant_id, profile?.id]);

  const openPromptIfNeeded = useCallback(async (excludeTaskId?: string) => {
    if (!profile?.tenant_id || !profile?.id) return;
    if (open || loadingList || resumeLoading) return;

    setLoadingList(true);
    try {
      const paused = await loadPausedTasksForResume(excludeTaskId);
      if (paused.length === 0) return;

      setPausedTasks(paused);
      setSelectedTaskId(paused[0]?.id || '');
      setOpen(true);
    } finally {
      setLoadingList(false);
    }
  }, [profile?.tenant_id, profile?.id, open, loadingList, resumeLoading, loadPausedTasksForResume]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (evt: Event) => {
      const e = evt as CustomEvent<{ excludeTaskId?: string }>;
      void openPromptIfNeeded(e?.detail?.excludeTaskId);
    };

    window.addEventListener('stride:prompt-resume-paused-task', handler as EventListener);
    return () => window.removeEventListener('stride:prompt-resume-paused-task', handler as EventListener);
  }, [openPromptIfNeeded]);

  const resumeSelected = useCallback(async () => {
    if (!profile?.tenant_id || !profile?.id || !selectedTaskId) return;

    setResumeLoading(true);
    try {
      const result = await timerStartJob({
        tenantId: profile.tenant_id,
        userId: profile.id,
        jobType: 'task',
        jobId: selectedTaskId,
        pauseExisting: false,
      });
      if (!result.ok) {
        toast({
          variant: 'destructive',
          title: 'Unable to resume',
          description: result.error_message || 'Failed to resume task',
        });
        return;
      }

      const resumed = pausedTasks.find((t) => t.id === selectedTaskId);
      toast({
        title: 'Resumed',
        description: resumed ? `Resumed "${resumed.title}".` : 'Task timer resumed.',
      });

      setOpen(false);
      navigate(`/tasks/${selectedTaskId}`);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Unable to resume',
        description: err?.message || 'Failed to resume task',
      });
    } finally {
      setResumeLoading(false);
    }
  }, [profile?.tenant_id, profile?.id, selectedTaskId, pausedTasks, toast, navigate]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setPausedTasks([]);
            setSelectedTaskId('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="play_circle" size="md" />
              Resume paused task?
            </DialogTitle>
            <DialogDescription>
              You still have a task paused from switching jobs. Resume it now?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Paused task</Label>
              <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a task to resume" />
                </SelectTrigger>
                <SelectContent>
                  {pausedTasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmNotNowOpen(true)}
              disabled={resumeLoading}
            >
              Not now
            </Button>
            <Button
              onClick={resumeSelected}
              disabled={resumeLoading || !selectedTaskId}
            >
              {resumeLoading ? 'Resuming…' : 'Resume'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmNotNowOpen} onOpenChange={setConfirmNotNowOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave the task paused?</AlertDialogTitle>
            <AlertDialogDescription>
              No problem — the task will remain paused. You can resume it later from the Tasks page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resumeLoading}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={resumeLoading}
              onClick={(e) => {
                e.preventDefault();
                setConfirmNotNowOpen(false);
                setOpen(false);
              }}
            >
              Leave Paused
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

