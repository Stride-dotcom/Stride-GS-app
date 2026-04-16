/**
 * useFailedOperations — Phase 1 Supabase failure tracking hook.
 *
 * Fetches all unresolved sync_failed events from gs_sync_events visible to
 * the current user. Subscribes to Supabase Realtime so new failures appear
 * immediately without a manual refresh.
 *
 * RLS handles visibility:
 *   - Clients: own failures only (requested_by = auth.email())
 *   - Staff/admin: all failures (via user_metadata.role set in AuthContext)
 *
 * Also exposes retry and dismiss actions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fetchSyncFailures, resolveSyncEvent, type SyncEvent } from '../lib/syncEvents';
import { apiPost } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { entityEvents } from '../lib/entityEvents';

export type { SyncEvent };

export interface UseFailedOperationsResult {
  failures: SyncEvent[];
  loading: boolean;
  unresolvedCount: number;
  refetch: () => void;
  dismiss: (id: string) => Promise<void>;
  retry: (event: SyncEvent) => Promise<{ ok: boolean; error: string | null }>;
}

// Human-readable labels for action types
export const ACTION_LABELS: Record<string, string> = {
  complete_task:         'Complete Task',
  start_task:            'Start Task',
  cancel_task:           'Cancel Task',
  update_task:           'Update Task',
  complete_repair:       'Complete Repair',
  start_repair:          'Start Repair',
  cancel_repair:         'Cancel Repair',
  send_repair_quote:     'Send Repair Quote',
  respond_repair_quote:  'Respond to Repair Quote',
  request_repair_quote:  'Request Repair Quote',
  process_wc_release:    'Release Will Call',
  cancel_will_call:      'Cancel Will Call',
  create_will_call:      'Create Will Call',
  update_will_call:      'Update Will Call',
  add_wc_items:          'Add Items to Will Call',
  remove_wc_items:       'Remove Items from Will Call',
  update_inventory_item: 'Update Item',
  update_task_notes:     'Update Task Notes',
  update_task_price:     'Update Task Price',
  release_items:         'Release Items',
  complete_shipment:     'Complete Shipment',
};

export const ENTITY_LABELS: Record<string, string> = {
  task:      'Task',
  repair:    'Repair',
  will_call: 'Will Call',
  inventory: 'Item',
  shipment:  'Shipment',
};

export function useFailedOperations(): UseFailedOperationsResult {
  const { user } = useAuth();
  const [failures, setFailures] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const data = await fetchSyncFailures();
    if (mountedRef.current) {
      setFailures(data);
      setLoading(false);
    }
  }, [user]);

  // Initial fetch
  useEffect(() => {
    if (user) refetch();
  }, [user, refetch]);

  // Supabase Realtime subscription — any change to gs_sync_events triggers a refetch.
  // Also emits entity events for confirmed rows so hooks can do targeted refetches.
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('gs_sync_events_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gs_sync_events' },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (row?.sync_status === 'confirmed') {
            // Emit so hooks/BatchDataContext can do a targeted refetch
            entityEvents.emit(String(row.entity_type ?? ''), String(row.entity_id ?? ''));
          }
          // v38.67.0 — always refetch the failures list so:
          //   • new sync_failed rows appear immediately
          //   • rows flipped to 'confirmed' by the retryFailedSyncs_ cron
          //     disappear from the drawer with no manual action
          //   • rows dismissed by another tab (resolved) disappear too
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refetch]);

  /** Dismiss (resolve) a failure without retrying. */
  const dismiss = useCallback(async (id: string) => {
    // Optimistic remove
    setFailures(prev => prev.filter(f => f.id !== id));
    await resolveSyncEvent(id);
  }, []);

  /**
   * Retry a failed operation.
   * Reconstructs the original API call from the stored payload and action_type.
   * Uses a new request_id so idempotency stamps don't block it.
   * On success: marks the original failure as resolved.
   * On failure: returns the error so the drawer can display it.
   */
  const retry = useCallback(async (event: SyncEvent): Promise<{ ok: boolean; error: string | null }> => {
    // Build payload with fresh request_id
    const retryPayload = { ...event.payload, requestId: crypto.randomUUID() };

    const resp = await apiPost(
      event.action_type,
      retryPayload,
      { clientSheetId: event.tenant_id }
    );

    if (resp.ok && (resp.data as Record<string, unknown>)?.success !== false) {
      // Success — resolve the original failure record and remove from list
      setFailures(prev => prev.filter(f => f.id !== event.id));
      await resolveSyncEvent(event.id);
      return { ok: true, error: null };
    }

    // Retry also failed — return the error but keep the record
    const errMsg = resp.error ?? 'Retry failed. Check the sheet manually.';
    return { ok: false, error: errMsg };
  }, []);

  return {
    failures,
    loading,
    unresolvedCount: failures.length,
    refetch,
    dismiss,
    retry,
  };
}
