import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { minutesBetweenIso } from '@/lib/time/minutesBetweenIso';
import { timerEndJob, timerStartJob } from '@/lib/time/timerClient';
import { readOfflineActiveTimer, readOfflineTimerQueue } from '@/lib/time/offlineTimerQueue';

// Allow "plug-in" future job types while preserving autocomplete for core ones.
export type JobType = 'task' | 'shipment' | 'stocktake' | (string & {});

export interface JobTimeIntervalRow {
  id: string;
  tenant_id: string;
  job_type: JobType;
  job_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  created_at: string;
}

export interface TimerStartResult {
  ok: boolean;
  already_active?: boolean;
  started_interval_id?: string | null;
  paused_interval_id?: string | null;
  paused_job_type?: string | null;
  paused_job_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  active_interval_id?: string | null;
  active_job_type?: string | null;
  active_job_id?: string | null;
}

export function useJobTimer(jobType: JobType, jobId: string | undefined) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [intervals, setIntervals] = useState<JobTimeIntervalRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Local clock ticker so "active" timers update smoothly
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchIntervals = useCallback(async () => {
    if (!profile?.tenant_id || !jobId) return;
    setLoading(true);
    setError(null);
    try {
      // Offline: show whatever we have locally (queued + active offline interval).
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const queued = readOfflineTimerQueue(profile.tenant_id, profile.id || '');
        const active = profile.id ? readOfflineActiveTimer(profile.tenant_id, profile.id) : null;

        const offlineRows: JobTimeIntervalRow[] = [];
        for (const q of queued) {
          if (q.job_type !== String(jobType) || q.job_id !== jobId) continue;
          offlineRows.push(q as unknown as JobTimeIntervalRow);
        }
        if (active && active.job_type === String(jobType) && active.job_id === jobId) {
          offlineRows.push({
            id: active.id,
            tenant_id: active.tenant_id,
            job_type: jobType,
            job_id: jobId,
            user_id: active.user_id,
            started_at: active.started_at,
            ended_at: null,
            ended_reason: null,
            created_at: active.started_at,
          });
        }

        if (offlineRows.length > 0) {
          // Merge by id to avoid duplicates if we already have server rows in state.
          setIntervals((prev) => {
            const byId = new Map<string, JobTimeIntervalRow>();
            for (const r of prev) byId.set(r.id, r);
            for (const r of offlineRows) byId.set(r.id, r);
            return Array.from(byId.values()).sort(
              (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
            );
          });
        }

        return;
      }

      const { data, error: fetchError } = await (supabase
        .from('job_time_intervals') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('job_type', jobType)
        .eq('job_id', jobId)
        .order('started_at', { ascending: true });

      if (fetchError) throw fetchError;
      setIntervals((data || []) as JobTimeIntervalRow[]);
    } catch (err: any) {
      console.error('[useJobTimer] fetchIntervals error:', err);
      setError(err?.message || 'Failed to load timer intervals');
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, jobId, jobType]);

  useEffect(() => {
    fetchIntervals();
  }, [fetchIntervals]);

  const activeIntervals = useMemo(
    () => intervals.filter(i => !i.ended_at),
    [intervals],
  );

  const isActive = activeIntervals.length > 0;

  const myActiveInterval = useMemo(() => {
    if (!profile?.id) return null;
    return activeIntervals.find(i => i.user_id === profile.id) || null;
  }, [activeIntervals, profile?.id]);

  const isActiveForMe = !!myActiveInterval;

  // Start ticker only when any interval is active
  useEffect(() => {
    if (!isActive) {
      if (tickerRef.current) clearInterval(tickerRef.current);
      tickerRef.current = null;
      return;
    }
    if (tickerRef.current) return;

    tickerRef.current = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      tickerRef.current = null;
    };
  }, [isActive]);

  const laborMinutes = useMemo(() => {
    if (intervals.length === 0) return 0;
    const nowIso = new Date(nowTick).toISOString();
    const total = intervals.reduce((sum, i) => {
      const end = i.ended_at || nowIso;
      return sum + minutesBetweenIso(i.started_at, end);
    }, 0);
    return Math.round(total);
  }, [intervals, nowTick]);

  // For phase 1 (single-user default), cycle minutes == labor minutes.
  // We'll compute the true cycle time later (union of active ranges).
  const cycleMinutes = laborMinutes;

  const startOrResume = useCallback(async (options?: { pauseExisting?: boolean }): Promise<TimerStartResult> => {
    if (!jobId) return { ok: false, error_code: 'MISSING_JOB_ID', error_message: 'Missing job id' };
    try {
      const result = await timerStartJob({
        tenantId: profile?.tenant_id,
        userId: profile?.id,
        jobType: String(jobType),
        jobId,
        pauseExisting: options?.pauseExisting ?? false,
      });

      if (result.ok) {
        if ((result as any).offline) {
          const nowIso = (result as any).offline_started_at || new Date().toISOString();
          const intervalId = result.started_interval_id || `offline-${Date.now()}`;
          setIntervals((prev) => {
            const existing = prev.find((i) => i.id === intervalId);
            if (existing) return prev;
            return [
              ...prev,
              {
                id: intervalId,
                tenant_id: profile?.tenant_id || '',
                job_type: jobType,
                job_id: jobId,
                user_id: profile?.id || '',
                started_at: nowIso,
                ended_at: null,
                ended_reason: null,
                created_at: nowIso,
              } as JobTimeIntervalRow,
            ];
          });
        } else {
          await fetchIntervals();
        }
      }
      return result;
    } catch (err: any) {
      console.error('[useJobTimer] startOrResume error:', err);
      return { ok: false, error_code: 'RPC_ERROR', error_message: err?.message || 'Failed to start timer' };
    }
  }, [jobId, jobType, fetchIntervals, profile?.tenant_id, profile?.id]);

  const end = useCallback(async (reason: 'pause' | 'complete' | 'auto_pause' | string = 'pause') => {
    if (!jobId) return { ok: false, error_code: 'MISSING_JOB_ID', error_message: 'Missing job id' } as TimerStartResult;
    try {
      const result = await timerEndJob({
        tenantId: profile?.tenant_id,
        userId: profile?.id,
        jobType: String(jobType),
        jobId,
        reason,
      });

      if (result.ok) {
        if ((result as any).offline) {
          const nowIso = new Date().toISOString();
          setIntervals((prev) =>
            prev.map((i) => {
              if (i.ended_at) return i;
              if (i.user_id !== profile?.id) return i;
              if (i.job_id !== jobId) return i;
              if (String(i.job_type) !== String(jobType)) return i;
              return { ...i, ended_at: nowIso, ended_reason: reason };
            })
          );
        } else {
          await fetchIntervals();
        }
      }

      return result as any;
    } catch (err: any) {
      console.error('[useJobTimer] end error:', err);
      return { ok: false, error_code: 'RPC_ERROR', error_message: err?.message || 'Failed to end timer' };
    }
  }, [jobId, jobType, fetchIntervals, profile?.tenant_id, profile?.id]);

  const pause = useCallback(async () => end('pause'), [end]);
  const complete = useCallback(async () => end('complete'), [end]);

  // "Paused" means: job is in progress but this user has no active interval.
  // (We don't yet store an explicit paused state at job level.)
  const isPausedForMe = useMemo(() => {
    if (!profile?.id) return false;
    const hasAny = intervals.some(i => i.user_id === profile.id);
    return hasAny && !isActiveForMe;
  }, [intervals, profile?.id, isActiveForMe]);

  return {
    loading,
    error,
    intervals,
    refetch: fetchIntervals,

    isActive,
    activeIntervals,
    laborMinutes,
    cycleMinutes,

    isActiveForMe,
    isPausedForMe,
    myActiveInterval,

    startOrResume,
    pause,
    complete,
    end,
  };
}

