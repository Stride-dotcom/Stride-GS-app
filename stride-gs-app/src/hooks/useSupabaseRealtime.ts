/**
 * useSupabaseRealtime — Phase 4 cross-user realtime subscriptions.
 *
 * Subscribes to Supabase Realtime on the read-cache tables:
 *   inventory, tasks, repairs, will_calls, shipments, billing, clients,
 *   claims, move_history, dt_orders
 *
 * Session 72 Phase 2 added claims, move_history, and dt_orders so every
 * entity surfaced in the React app propagates across tabs within ~1-2s.
 *
 * On any INSERT or UPDATE, emits the changed entity type via entityEvents so
 * that all hooks (useInventory, useTasks, useRepairs, useWillCalls,
 * useShipments, useBilling) and BatchDataContext trigger a silent refetch.
 *
 * Debounce: bulk operations (e.g. receiving 20 items) would fire 20 events in
 * rapid succession. A 500ms debounce per entity type coalesces these into a
 * single refetch.
 *
 * Design: one Supabase channel with 12 listeners (INSERT + UPDATE × 6 tables).
 * The GAS write-through (Phase 3) upserts to these tables on every doPost call,
 * so realtime subscribers see updates within 1-2 seconds of the sheet write.
 *
 * Lifecycle: mounted once in AppLayout. Cleaned up on unmount.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';
import { useAuth } from '../contexts/AuthContext';

export function useSupabaseRealtime() {
  const { user } = useAuth();
  const subscribedRef = useRef(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!user) return;
    if (subscribedRef.current) return; // prevent double-subscribe on React StrictMode
    subscribedRef.current = true;

    /** Debounced emit — coalesces rapid-fire events per entity type.
     *  Uses emitFromRealtime (not emit) so the refetch reads from Supabase
     *  (which already has the fresh data) instead of going to GAS. */
    function debouncedEmit(entityType: string, entityId: string) {
      clearTimeout(debounceTimers.current[entityType]);
      debounceTimers.current[entityType] = setTimeout(() => {
        entityEvents.emitFromRealtime(entityType, entityId);
      }, 500);
    }

    function onRow(entityType: string, idField: string) {
      return (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | undefined;
        debouncedEmit(entityType, String(row?.[idField] ?? ''));
      };
    }

    const channel = supabase
      .channel('stride_cache_realtime')
      // inventory
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inventory' }, onRow('inventory', 'item_id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inventory' }, onRow('inventory', 'item_id'))
      // tasks
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, onRow('task', 'task_id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, onRow('task', 'task_id'))
      // repairs
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'repairs' }, onRow('repair', 'repair_id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'repairs' }, onRow('repair', 'repair_id'))
      // will_calls
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'will_calls' }, onRow('will_call', 'wc_number'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'will_calls' }, onRow('will_call', 'wc_number'))
      // shipments
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shipments' }, onRow('shipment', 'shipment_number'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shipments' }, onRow('shipment', 'shipment_number'))
      // billing
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'billing' }, onRow('billing', 'ledger_row_id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'billing' }, onRow('billing', 'ledger_row_id'))
      // clients
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clients' }, onRow('client', 'spreadsheet_id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients' }, onRow('client', 'spreadsheet_id'))
      // claims (Phase 2)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'claims' }, onRow('claim', 'claim_id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'claims' }, onRow('claim', 'claim_id'))
      // move_history (Phase 2) — append-only audit log for Scanner moves + transfers
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'move_history' }, onRow('move_history', 'id'))
      // dt_orders (Phase 2) — DispatchTrack orders surfaced in Orders tab
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dt_orders' }, onRow('order', 'order_id'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dt_orders' }, onRow('order', 'order_id'))
      // Session 74: folded catalog/reference table channels into this
      // central channel. Previously each of these hooks opened its own
      // Supabase Realtime channel (useEmailTemplates, useServiceCatalog,
      // useQuoteCatalog, useExpectedShipments, useDeliveryZones), giving
      // a logged-in session 5+ redundant sockets. Now one channel
      // handles them all — each hook subscribes to entityEvents for its
      // own type instead. Fewer connections = less cycling / fewer
      // "CLOSED → reconnect" churn events in the console.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_templates' },     onRow('email_template', 'template_key'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_catalog' },     onRow('service_catalog', 'service_code'))
      // Quote catalog is actually 3 tables that drive the same store —
      // emit the same entity type for any of them so useQuoteCatalog
      // does one refetch for any cross-table change.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_classes' },        onRow('quote_catalog', 'id'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tax_areas' },           onRow('quote_catalog', 'id'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coverage_options' },    onRow('quote_catalog', 'id'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expected_shipments' },  onRow('expected_shipment', 'id'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_zones' },      onRow('delivery_zone', 'id'))
      // Session 72: log connection state so we can verify Realtime stays live
      // (Dashboard trusts this channel and only polls every 5 min as fallback).
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] ✓ connected — live updates active');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[Realtime] connection issue:', status, err || '');
        }
      });

    return () => {
      subscribedRef.current = false;
      // Clear all debounce timers
      for (const t of Object.values(debounceTimers.current)) clearTimeout(t);
      debounceTimers.current = {};
      supabase.removeChannel(channel);
    };
  }, [user]);
}
