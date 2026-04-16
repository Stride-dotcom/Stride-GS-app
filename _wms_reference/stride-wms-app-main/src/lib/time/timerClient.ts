import { supabase } from '@/integrations/supabase/client';
import type { TimerStartResult } from '@/hooks/useJobTimer';
import {
  clearOfflineActiveTimer,
  enqueueOfflineTimerInterval,
  readOfflineActiveTimer,
  readOfflineTimerQueue,
  writeOfflineActiveTimer,
  writeOfflineTimerQueue,
} from '@/lib/time/offlineTimerQueue';

export type TimerEndResult = {
  ok: boolean;
  ended?: boolean;
  error_code?: string;
  error_message?: string;
  offline?: boolean;
};

function isNetworkishError(err: any): boolean {
  // If browser says offline, treat as network error.
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
  const msg = String(err?.message || err?.toString?.() || '');
  return /failed to fetch|networkerror|fetch failed|network request failed|load failed/i.test(msg);
}

function notifyOfflineQueued(action: 'start' | 'end') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('stride:timer-offline-queued', { detail: { action } }));
}

function notifyOfflineSynced(stats: { inserted: number; hadActive: boolean }) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('stride:timer-offline-synced', { detail: stats }));
}

export async function timerStartJob(params: {
  tenantId: string | null | undefined;
  userId: string | null | undefined;
  jobType: string;
  jobId: string;
  pauseExisting?: boolean;
}): Promise<TimerStartResult & { offline?: boolean; offline_started_at?: string }> {
  const { tenantId, userId, jobType, jobId } = params;
  const pauseExisting = params.pauseExisting ?? false;

  if (!tenantId || !userId) {
    return { ok: false, error_code: 'NOT_AUTHENTICATED', error_message: 'Not authenticated' } as any;
  }

  try {
    const { data, error } = await supabase.rpc('rpc_timer_start_job', {
      p_job_type: jobType,
      p_job_id: jobId,
      p_pause_existing: pauseExisting,
    });
    if (error) throw error;
    return (data || {}) as any;
  } catch (err: any) {
    if (!isNetworkishError(err)) throw err;

    const nowIso = new Date().toISOString();
    const active = readOfflineActiveTimer(tenantId, userId);

    // Same job already running offline -> idempotent success
    if (active && active.job_type === jobType && active.job_id === jobId) {
      notifyOfflineQueued('start');
      return {
        ok: true,
        already_active: true,
        started_interval_id: active.id,
        paused_interval_id: null,
        offline: true,
        offline_started_at: active.started_at,
      } as any;
    }

    // Different job already running offline
    if (active && !pauseExisting) {
      notifyOfflineQueued('start');
      return {
        ok: false,
        error_code: 'ACTIVE_TIMER_EXISTS',
        error_message: 'You already have a job in progress (offline)',
        active_interval_id: active.id,
        active_job_type: active.job_type,
        active_job_id: active.job_id,
        offline: true,
      } as any;
    }

    // Auto-pause offline active timer (if present)
    if (active && pauseExisting) {
      enqueueOfflineTimerInterval({
        id: active.id,
        tenant_id: tenantId,
        job_type: active.job_type,
        job_id: active.job_id,
        user_id: userId,
        started_at: active.started_at,
        ended_at: nowIso,
        ended_reason: 'auto_pause',
        created_at: nowIso,
      });
      clearOfflineActiveTimer(tenantId, userId);
    }

    const newId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeOfflineActiveTimer({
      id: newId,
      tenant_id: tenantId,
      job_type: jobType,
      job_id: jobId,
      user_id: userId,
      started_at: nowIso,
    });

    notifyOfflineQueued('start');
    return {
      ok: true,
      already_active: false,
      started_interval_id: newId,
      paused_interval_id: active?.id ?? null,
      paused_job_type: active?.job_type ?? null,
      paused_job_id: active?.job_id ?? null,
      offline: true,
      offline_started_at: nowIso,
    } as any;
  }
}

export async function timerEndJob(params: {
  tenantId: string | null | undefined;
  userId: string | null | undefined;
  jobType: string;
  jobId: string;
  reason?: string;
}): Promise<TimerEndResult> {
  const { tenantId, userId, jobType, jobId } = params;
  const reason = params.reason ?? 'pause';

  if (!tenantId || !userId) {
    return { ok: false, error_code: 'NOT_AUTHENTICATED', error_message: 'Not authenticated' };
  }

  try {
    const { data, error } = await supabase.rpc('rpc_timer_end_job', {
      p_job_type: jobType,
      p_job_id: jobId,
      p_reason: reason,
    });
    if (error) throw error;
    return (data || {}) as any;
  } catch (err: any) {
    if (!isNetworkishError(err)) throw err;

    const nowIso = new Date().toISOString();
    const active = readOfflineActiveTimer(tenantId, userId);

    if (!active || active.job_type !== jobType || active.job_id !== jobId) {
      notifyOfflineQueued('end');
      return { ok: true, ended: false, offline: true };
    }

    enqueueOfflineTimerInterval({
      id: active.id,
      tenant_id: tenantId,
      job_type: active.job_type,
      job_id: active.job_id,
      user_id: userId,
      started_at: active.started_at,
      ended_at: nowIso,
      ended_reason: reason,
      created_at: nowIso,
    });
    clearOfflineActiveTimer(tenantId, userId);

    notifyOfflineQueued('end');
    return { ok: true, ended: true, offline: true };
  }
}

export async function flushOfflineTimers(params: {
  tenantId: string | null | undefined;
  userId: string | null | undefined;
}): Promise<{ ok: boolean; inserted: number; remaining: number; hadActive: boolean }> {
  const { tenantId, userId } = params;
  if (!tenantId || !userId) return { ok: true, inserted: 0, remaining: 0, hadActive: false };
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return { ok: true, inserted: 0, remaining: readOfflineTimerQueue(tenantId, userId).length, hadActive: !!readOfflineActiveTimer(tenantId, userId) };
  }

  const queue = readOfflineTimerQueue(tenantId, userId);
  const active = readOfflineActiveTimer(tenantId, userId);

  let inserted = 0;

  try {
    // Upsert queued (ended) intervals in batches (idempotent).
    if (queue.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < queue.length; i += batchSize) {
        const batch = queue.slice(i, i + batchSize).map((q) => ({
          id: q.id,
          tenant_id: q.tenant_id,
          job_type: q.job_type,
          job_id: q.job_id,
          user_id: q.user_id,
          started_at: q.started_at,
          ended_at: q.ended_at,
          ended_reason: q.ended_reason,
          created_at: q.created_at,
        }));

        const { error } = await (supabase.from('job_time_intervals') as any)
          .upsert(batch, { onConflict: 'id' });
        if (error) throw error;
        inserted += batch.length;
      }

      writeOfflineTimerQueue(tenantId, userId, []);
    }

    // Sync any offline-active timer as an active interval on the server (best-effort).
    let hadActive = false;
    if (active) {
      hadActive = true;
      const { error } = await (supabase.from('job_time_intervals') as any)
        .upsert([{
          id: active.id,
          tenant_id: tenantId,
          job_type: active.job_type,
          job_id: active.job_id,
          user_id: userId,
          started_at: active.started_at,
          ended_at: null,
          ended_reason: null,
          created_at: new Date().toISOString(),
        }], { onConflict: 'id' });

      if (!error) {
        clearOfflineActiveTimer(tenantId, userId);
      }

      notifyOfflineSynced({ inserted, hadActive });
      return { ok: !error, inserted, remaining: readOfflineTimerQueue(tenantId, userId).length, hadActive };
    }

    if (inserted > 0) {
      notifyOfflineSynced({ inserted, hadActive: false });
    }
    return { ok: true, inserted, remaining: readOfflineTimerQueue(tenantId, userId).length, hadActive: false };
  } catch {
    // Keep queue intact for retry.
    return { ok: false, inserted: 0, remaining: queue.length, hadActive: !!active };
  }
}

