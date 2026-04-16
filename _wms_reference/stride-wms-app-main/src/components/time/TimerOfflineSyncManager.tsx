import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { flushOfflineTimers } from '@/lib/time/timerClient';

/**
 * Mounted once (DashboardLayout) to:
 * - show offline notices when timer events are queued
 * - flush queued timer intervals when back online
 */
export function TimerOfflineSyncManager() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const lastOfflineToastAt = useRef<number>(0);
  const lastSyncToastAt = useRef<number>(0);

  const flush = useCallback(async () => {
    if (!profile?.tenant_id || !profile?.id) return;
    const stats = await flushOfflineTimers({ tenantId: profile.tenant_id, userId: profile.id });
    if (!stats.ok) return;

    if (stats.inserted > 0) {
      const now = Date.now();
      // Throttle success toast
      if (now - lastSyncToastAt.current > 15000) {
        lastSyncToastAt.current = now;
        toast({
          title: 'Timer synced',
          description: `Synced ${stats.inserted} offline timer update${stats.inserted === 1 ? '' : 's'}.`,
        });
      }
    }
  }, [profile?.tenant_id, profile?.id, toast]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onQueued = () => {
      const now = Date.now();
      if (now - lastOfflineToastAt.current < 20000) return;
      lastOfflineToastAt.current = now;
      toast({
        title: 'Offline mode',
        description: 'You are offline. Timer changes will sync when you’re back online.',
      });
    };

    const onSynced = (evt: Event) => {
      const e = evt as CustomEvent<{ inserted?: number }>;
      if ((e?.detail?.inserted || 0) <= 0) return;
      // flush() already shows a toast; this event is mainly for future UI hooks.
    };

    const onOnline = () => void flush();
    const onOffline = () => onQueued();

    window.addEventListener('stride:timer-offline-queued', onQueued as EventListener);
    window.addEventListener('stride:timer-offline-synced', onSynced as EventListener);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('stride:timer-offline-queued', onQueued as EventListener);
      window.removeEventListener('stride:timer-offline-synced', onSynced as EventListener);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flush, toast]);

  // Poll occasionally while online.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = setInterval(() => {
      if (navigator.onLine) void flush();
    }, 30000);
    return () => clearInterval(id);
  }, [flush]);

  return null;
}

