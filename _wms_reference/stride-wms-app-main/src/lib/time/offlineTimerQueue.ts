/**
 * offlineTimerQueue.ts
 *
 * Lightweight localStorage-backed queue for timer intervals so users can
 * keep tracking time when offline and sync to Supabase when online.
 *
 * Phase 1: only queues job_time_intervals rows for the current user.
 */

export type OfflineTimerInterval = {
  id: string; // uuid (client-generated) for idempotent sync
  tenant_id: string;
  job_type: string;
  job_id: string;
  user_id: string;
  started_at: string; // ISO
  ended_at: string | null; // ISO or null
  ended_reason: string | null;
  created_at: string; // ISO
};

export type OfflineActiveTimer = {
  id: string; // interval id (uuid)
  tenant_id: string;
  job_type: string;
  job_id: string;
  user_id: string;
  started_at: string; // ISO
};

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function storageKeyQueue(tenantId: string, userId: string) {
  return `stride:timer_offline_queue:v1:${tenantId}:${userId}`;
}

function storageKeyActive(tenantId: string, userId: string) {
  return `stride:timer_offline_active:v1:${tenantId}:${userId}`;
}

export function readOfflineTimerQueue(tenantId: string, userId: string): OfflineTimerInterval[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(storageKeyQueue(tenantId, userId));
  const parsed = safeParseJson<OfflineTimerInterval[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export function writeOfflineTimerQueue(tenantId: string, userId: string, queue: OfflineTimerInterval[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKeyQueue(tenantId, userId), JSON.stringify(queue));
}

export function enqueueOfflineTimerInterval(interval: OfflineTimerInterval) {
  if (typeof window === 'undefined') return;
  const queue = readOfflineTimerQueue(interval.tenant_id, interval.user_id);
  // Upsert by id to keep sync idempotent.
  const existingIdx = queue.findIndex((q) => q.id === interval.id);
  if (existingIdx >= 0) {
    queue[existingIdx] = interval;
  } else {
    queue.push(interval);
  }
  writeOfflineTimerQueue(interval.tenant_id, interval.user_id, queue);
}

export function readOfflineActiveTimer(tenantId: string, userId: string): OfflineActiveTimer | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKeyActive(tenantId, userId));
  const parsed = safeParseJson<OfflineActiveTimer>(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.tenant_id !== tenantId || parsed.user_id !== userId) return null;
  return parsed;
}

export function writeOfflineActiveTimer(active: OfflineActiveTimer | null) {
  if (typeof window === 'undefined') return;
  if (!active) return;
  window.localStorage.setItem(storageKeyActive(active.tenant_id, active.user_id), JSON.stringify(active));
}

export function clearOfflineActiveTimer(tenantId: string, userId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKeyActive(tenantId, userId));
}

export function clearOfflineTimerQueue(tenantId: string, userId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKeyQueue(tenantId, userId));
}

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const key = 'stride:device_id:v1';
  const existing = window.localStorage.getItem(key);
  if (existing && existing.trim()) return existing;
  const id = (globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  window.localStorage.setItem(key, id);
  return id;
}

