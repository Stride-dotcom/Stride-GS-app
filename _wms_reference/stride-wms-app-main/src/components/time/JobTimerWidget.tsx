import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useJobTimer, type JobType } from '@/hooks/useJobTimer';
import { useAuth } from '@/contexts/AuthContext';
import { useTimeTrackingConcurrencyPrefs } from '@/hooks/useTimeTrackingConcurrencyPrefs';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
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

type TimerState = ReturnType<typeof useJobTimer>;

function getJobTypeLabel(jobType: string): string {
  const lower = (jobType || '').toLowerCase();
  if (lower === 'task') return 'task';
  if (lower === 'shipment') return 'shipment';
  if (lower === 'stocktake') return 'stocktake';
  return 'job';
}

export function JobTimerWidget(props: {
  jobType: JobType;
  jobId: string | undefined;
  variant?: 'inline' | 'card';
  showControls?: boolean;
  showTime?: boolean;
  showStatus?: boolean;
  className?: string;
}) {
  const timer = useJobTimer(props.jobType, props.jobId);
  return (
    <JobTimerWidgetFromState
      timer={timer}
      jobType={props.jobType}
      jobId={props.jobId}
      variant={props.variant}
      showControls={props.showControls}
      showTime={props.showTime}
      showStatus={props.showStatus}
      className={props.className}
    />
  );
}

export function JobTimerWidgetFromState(props: {
  timer: TimerState;
  jobType: JobType;
  jobId: string | undefined;
  variant?: 'inline' | 'card';
  showControls?: boolean;
  showTime?: boolean;
  showStatus?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { prefs: concurrencyPrefs } = useTimeTrackingConcurrencyPrefs();

  const variant = props.variant ?? 'inline';
  const showControls = props.showControls ?? false;
  const showTime = props.showTime ?? true;
  const showStatus = props.showStatus ?? true;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [activeJobTypeLabel, setActiveJobTypeLabel] = useState<string | null>(null);

  const [concurrentOpen, setConcurrentOpen] = useState(false);
  const [concurrentLoading, setConcurrentLoading] = useState(false);
  const [concurrentUserNames, setConcurrentUserNames] = useState<string>('');
  const [concurrentPendingPauseExisting, setConcurrentPendingPauseExisting] = useState<boolean>(false);
  const [resumeConfirmedConcurrent, setResumeConfirmedConcurrent] = useState<boolean>(false);

  // If job changes, close confirm dialog
  useEffect(() => {
    setConfirmOpen(false);
    setConfirmLoading(false);
    setActiveJobTypeLabel(null);
    setConcurrentOpen(false);
    setConcurrentLoading(false);
    setConcurrentUserNames('');
    setConcurrentPendingPauseExisting(false);
    setResumeConfirmedConcurrent(false);
  }, [props.jobType, props.jobId]);

  const timeLabel = useMemo(() => formatMinutesShort(props.timer.laborMinutes), [props.timer.laborMinutes]);

  const statusBadge = !showStatus ? null : props.timer.isActiveForMe ? (
    <Badge variant="secondary" className="text-xs">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        Active
      </span>
    </Badge>
  ) : props.timer.isPausedForMe ? (
    <Badge variant="outline" className="text-xs">
      Paused
    </Badge>
  ) : null;

  const handlePause = async () => {
    const res = await props.timer.pause();
    if (!res.ok) {
      toast({ variant: 'destructive', title: 'Pause failed', description: res.error_message || 'Unable to pause timer' });
      return;
    }
    toast({ title: 'Paused', description: 'Timer paused. Resume when ready.' });
  };

  const allowConcurrentForThisJob = useMemo(() => {
    if (props.jobType === 'task') return concurrencyPrefs.allowConcurrentTasks;
    if (props.jobType === 'shipment') return concurrencyPrefs.allowConcurrentShipments;
    if (props.jobType === 'stocktake') return concurrencyPrefs.allowConcurrentStocktakes;
    return true;
  }, [props.jobType, concurrencyPrefs.allowConcurrentTasks, concurrencyPrefs.allowConcurrentShipments, concurrencyPrefs.allowConcurrentStocktakes]);

  const handleResumeStart = async (pauseExisting: boolean) => {
    const res = await props.timer.startOrResume({ pauseExisting });
    if (!res.ok) {
      if (res.error_code === 'ACTIVE_TIMER_EXISTS' && !pauseExisting) {
        setActiveJobTypeLabel(res.active_job_type ? getJobTypeLabel(res.active_job_type) : 'job');
        setConfirmOpen(true);
        return;
      }
      toast({ variant: 'destructive', title: 'Resume failed', description: res.error_message || 'Unable to resume timer' });
      return;
    }
    toast({ title: 'Resumed', description: pauseExisting ? 'Paused your other job and resumed this one.' : 'Timer resumed.' });
  };

  const requestResume = async (pauseExisting: boolean, confirmedConcurrent: boolean = false) => {
    const myUserId = profile?.id;
    const otherActiveUserIds = myUserId
      ? props.timer.activeIntervals
          .filter((i) => !i.ended_at && i.user_id !== myUserId)
          .map((i) => i.user_id)
      : [];

    if (!confirmedConcurrent && otherActiveUserIds.length > 0 && !props.timer.isActiveForMe) {
      if (!allowConcurrentForThisJob) {
        toast({
          variant: 'destructive',
          title: 'Job already in progress',
          description: 'Another user is already timing this job and concurrent timers are disabled in preferences.',
        });
        return;
      }

      setConcurrentLoading(true);
      setConcurrentPendingPauseExisting(pauseExisting);
      try {
        const { data: users } = await (supabase.from('users') as any)
          .select('id, first_name, last_name')
          .in('id', otherActiveUserIds.slice(0, 5));
        const names = (users || [])
          .map((u: any) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim())
          .filter(Boolean);
        setConcurrentUserNames(names.length > 0 ? names.join(', ') : 'another user');
      } catch {
        setConcurrentUserNames('another user');
      } finally {
        setConcurrentLoading(false);
        setConcurrentOpen(true);
      }
      return;
    }

    await handleResumeStart(pauseExisting);
  };

  const content = (
    <div className={cn('flex items-center gap-2 flex-wrap', props.className)}>
      {showTime && (
        <Badge variant="secondary" className="text-xs tabular-nums whitespace-nowrap">
          Time: {timeLabel}
        </Badge>
      )}
      {statusBadge}

      {showControls && (
        <div className="flex items-center gap-2">
          {props.timer.isActiveForMe ? (
            <Button size="sm" variant="outline" onClick={handlePause} disabled={props.timer.loading}>
              <MaterialIcon name="pause" size="sm" className="mr-1.5" />
              Pause
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setResumeConfirmedConcurrent(false);
                void requestResume(false);
              }}
              disabled={props.timer.loading}
            >
              <MaterialIcon name="play_arrow" size="sm" className="mr-1.5" />
              {props.timer.isPausedForMe ? 'Resume' : 'Start'}
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={concurrentOpen} onOpenChange={setConcurrentOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Join a job already in progress?</AlertDialogTitle>
            <AlertDialogDescription>
              This {getJobTypeLabel(String(props.jobType))} is already being timed by {concurrentUserNames || 'another user'}.
              Do you want to start your timer too?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={concurrentLoading} onClick={() => setConcurrentUserNames('')}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={concurrentLoading}
              onClick={async (e) => {
                e.preventDefault();
                setConcurrentLoading(true);
                try {
                  setResumeConfirmedConcurrent(true);
                  await requestResume(concurrentPendingPauseExisting, true);
                  setConcurrentOpen(false);
                  setConcurrentUserNames('');
                } finally {
                  setConcurrentLoading(false);
                }
              }}
            >
              Start My Timer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause current {activeJobTypeLabel || 'job'}?</AlertDialogTitle>
            <AlertDialogDescription>
              You already have a job in progress. Do you want to pause it and resume this timer?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmLoading} onClick={() => setActiveJobTypeLabel(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmLoading}
              onClick={async (e) => {
                e.preventDefault();
                setConfirmLoading(true);
                try {
                  await requestResume(true, resumeConfirmedConcurrent);
                  setConfirmOpen(false);
                  setActiveJobTypeLabel(null);
                } finally {
                  setConfirmLoading(false);
                }
              }}
            >
              Pause & Resume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (variant === 'card') {
    return (
      <div className={cn('border rounded-lg p-3 bg-card', props.className)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MaterialIcon name="timer" size="sm" className="text-muted-foreground" />
            <span className="text-sm font-medium">Timer</span>
          </div>
          {content}
        </div>
        {props.timer.error && (
          <div className="text-xs text-muted-foreground mt-2">
            Timer unavailable: {props.timer.error}
          </div>
        )}
      </div>
    );
  }

  return content;
}

