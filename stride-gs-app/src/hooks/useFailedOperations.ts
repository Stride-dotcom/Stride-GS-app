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
  // P2 — Supabase-authoritative writes that mirror back to the
  // per-tenant Google Sheet via handleWriteThroughReverse_. Failures
  // hit this row when GAS is unreachable or the per-table writer
  // throws.
  writethrough_reverse:  'Sync to Sheet',
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
    // ── EF-direct retry path ────────────────────────────────────────────
    // Some failed operations originated from a server-to-server call to
    // a Supabase Edge Function — not from React's apiPost → GAS router.
    // GAS doesn't know these actions ("Unknown POST action:
    // dtPushOrderAfterPuSync"), so the legacy GAS retry below cannot
    // resurrect them. Each entry tells the retry handler which EF to
    // invoke and how to rebuild the body from the gs_sync_events row
    // (typically: entity_id + a fixed shape). Add new entries here
    // whenever a new EF starts writing sync_failed rows the operator
    // should be able to retry from the drawer.
    const EF_RETRY_MAP: Record<string, { fn: string; body: (e: SyncEvent) => Record<string, unknown> }> = {
      // Mirrors dt-sync-statuses v21's pu_propagate invocation shape
      // (dt-sync-statuses/index.ts:1082). entity_id IS the linked
      // delivery's orderId. changedFields=['items'] scopes the push so
      // DT's dispatcher-assigned date/contact survive the retry —
      // matches the safety the original cron call has.
      dt_push_order_after_pu_sync: {
        fn:   'dt-push-order',
        body: (e) => ({ orderId: e.entity_id, changedFields: ['items'] }),
      },
    };

    const efRetry = EF_RETRY_MAP[event.action_type];
    if (efRetry) {
      const { data, error } = await supabase.functions.invoke(efRetry.fn, { body: efRetry.body(event) });
      if (error) {
        // Same body-extraction trick dt-sync-statuses v21 uses — the
        // supabase-js FunctionsHttpError's `context` is the underlying
        // Response, which carries the EF's actual {ok:false, error:"…"}
        // body. Without this the operator sees the generic "Edge Function
        // returned a non-2xx status code" wrapper and learns nothing.
        let bodyText = '';
        try {
          const ctx = (error as { context?: { text?: () => Promise<string> } }).context;
          if (ctx?.text) bodyText = (await ctx.text()).slice(0, 1000);
        } catch (_) { /* degrade to msg-only */ }
        const msg = (error as Error).message || String(error);
        return { ok: false, error: bodyText ? `${msg} — ${bodyText}` : msg };
      }
      const efData = data as { ok?: boolean; error?: string } | null;
      if (efData && efData.ok === false) {
        return { ok: false, error: efData.error || `${efRetry.fn} returned ok:false` };
      }
      setFailures(prev => prev.filter(f => f.id !== event.id));
      await resolveSyncEvent(event.id);
      return { ok: true, error: null };
    }

    // ── GAS-routed retry path (legacy default) ──────────────────────────
    // Build payload with fresh request_id
    const retryPayload = { ...event.payload, requestId: crypto.randomUUID() };

    // action_type is stored in snake_case (gs_sync_events convention) but the
    // StrideAPI.gs router expects camelCase. Map common actions; fall back to
    // a generic snake→camel conversion for anything not listed.
    const ACTION_MAP: Record<string, string> = {
      start_task:             'startTask',
      complete_task:          'completeTask',
      cancel_task:            'cancelTask',
      complete_repair:        'completeRepair',
      cancel_repair:          'cancelRepair',
      approve_repair_quote:   'approveRepairQuote',
      decline_repair_quote:   'declineRepairQuote',
      process_wc_release:     'processWcRelease',
      cancel_will_call:       'cancelWillCall',
      complete_shipment:      'completeShipment',
      update_inventory_item:  'updateInventoryItem',
      release_items:          'releaseItems',
      transfer_items:         'transferItems',
      update_client:          'updateClient',
      // Retry re-fires the SAME handleWriteThroughReverse_ endpoint
      // with the stored {tenantId, table, op, row, rowId} payload —
      // it's idempotent by row identifier so a second attempt either
      // succeeds or surfaces the same error (now actionable).
      writethrough_reverse:   'writeThroughReverse',
    };
    const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const action = ACTION_MAP[event.action_type] || toCamel(event.action_type);

    const resp = await apiPost(
      action,
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
