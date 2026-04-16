import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline-unsaved' | 'error';

interface UseReceivingAutosaveReturn {
  status: AutosaveStatus;
  saveField: (field: string, value: unknown) => void;
  saveNow: () => Promise<void>;
  retryNow: () => void;
  lastSavedAt: Date | null;
}

interface PendingUpdate {
  [field: string]: unknown;
}

const DEBOUNCE_MS = 300;
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [1000, 2000, 4000];

export function useReceivingAutosave(
  shipmentId: string | undefined,
  enabled: boolean = true
): UseReceivingAutosaveReturn {
  const { toast } = useToast();
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const pendingRef = useRef<PendingUpdate>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flush = useCallback(async () => {
    if (!shipmentId || !enabled) return;

    const updates = { ...pendingRef.current };
    if (Object.keys(updates).length === 0) return;

    // Clear pending
    pendingRef.current = {};

    if (!isMountedRef.current) return;
    setStatus('saving');

    try {
      const { error } = await supabase
        .from('shipments')
        .update(updates as any)
        .eq('id', shipmentId);

      if (error) throw error;

      if (!isMountedRef.current) return;
      retryCountRef.current = 0;
      setStatus('saved');
      setLastSavedAt(new Date());
    } catch (err: any) {
      console.error('[autosave] flush error:', err);

      if (!isMountedRef.current) return;

      // Re-queue failed updates
      pendingRef.current = { ...updates, ...pendingRef.current };

      if (retryCountRef.current < MAX_RETRIES) {
        const delay = RETRY_BACKOFF[retryCountRef.current] || 4000;
        retryCountRef.current++;
        timerRef.current = setTimeout(() => flush(), delay);
        setStatus('saving');
      } else {
        setStatus('error');
        toast({
          variant: 'destructive',
          title: 'Autosave Failed',
          description: 'Changes could not be saved. Please check your connection and try again.',
        });
      }
    }
  }, [shipmentId, enabled, toast]);

  const saveField = useCallback((field: string, value: unknown) => {
    pendingRef.current[field] = value;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), DEBOUNCE_MS);

    if (status === 'saved' || status === 'idle') {
      setStatus('idle');
    }
  }, [flush, status]);

  const saveNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await flush();
  }, [flush]);

  const retryNow = useCallback(() => {
    retryCountRef.current = 0;
    setStatus('idle');
    flush();
  }, [flush]);

  // Check online status
  useEffect(() => {
    const handleOffline = () => {
      if (Object.keys(pendingRef.current).length > 0) {
        setStatus('offline-unsaved');
      }
    };

    const handleOnline = () => {
      if (status === 'offline-unsaved') {
        retryCountRef.current = 0;
        flush();
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [status, flush]);

  return {
    status,
    saveField,
    saveNow,
    retryNow,
    lastSavedAt,
  };
}
