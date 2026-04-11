/**
 * syncEvents.ts — Supabase gs_sync_events helpers (Phase 1)
 *
 * Writes failure records to Supabase when GAS write calls fail or timeout.
 * Reads and manages failure records for the FailedOperationsDrawer.
 *
 * Phase 1: React writes sync_failed events on error/timeout.
 * Phase 2: Apps Script also writes confirmed/failed events via service key.
 */

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SyncFailedPayload {
  tenant_id: string;               // clientSheetId — the tenancy boundary
  entity_type: string;             // 'task' | 'repair' | 'will_call' | 'inventory' | 'shipment'
  entity_id: string;               // e.g. 'INSP-12345', 'WC-00123', 'RPR-456'
  action_type: string;             // e.g. 'complete_task', 'start_task', 'process_wc_release'
  requested_by: string;            // user email
  request_id: string;              // UUID idempotency token (from apiPost)
  payload: Record<string, unknown>; // full request body — used to reconstruct retry
  error_message: string;           // what went wrong
}

export interface SyncEvent {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  action_type: string;
  sync_status: 'pending_sync' | 'confirmed' | 'sync_failed' | 'resolved';
  requested_by: string;
  request_id: string;
  payload: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

// ─── Write a sync_failed event ───────────────────────────────────────────────

/**
 * Write a sync_failed event to Supabase when a GAS write call fails or times out.
 * Fire-and-forget — errors are logged but never thrown (don't mask the original error).
 */
export async function writeSyncFailed(event: SyncFailedPayload): Promise<void> {
  try {
    const { error } = await supabase.from('gs_sync_events').insert({
      tenant_id: event.tenant_id,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      action_type: event.action_type,
      sync_status: 'sync_failed',
      requested_by: event.requested_by,
      request_id: event.request_id,
      payload: event.payload,
      error_message: event.error_message,
    });
    if (error) {
      console.error('[syncEvents] writeSyncFailed insert error:', error.message);
    }
  } catch (err) {
    // Never throw — this is best-effort tracking
    console.error('[syncEvents] writeSyncFailed exception:', err);
  }
}

// ─── Resolve (dismiss or retry-success) ──────────────────────────────────────

/**
 * Mark a sync_failed event as resolved.
 * Called when user dismisses or successfully retries.
 */
export async function resolveSyncEvent(id: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('gs_sync_events')
      .update({ sync_status: 'resolved', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('[syncEvents] resolveSyncEvent error:', error.message);
    }
  } catch (err) {
    console.error('[syncEvents] resolveSyncEvent exception:', err);
  }
}

// ─── Fetch failures ───────────────────────────────────────────────────────────

/**
 * Fetch all unresolved sync_failed events visible to this user.
 * RLS handles visibility: own events always; admin/staff see all.
 */
export async function fetchSyncFailures(): Promise<SyncEvent[]> {
  try {
    const { data, error } = await supabase
      .from('gs_sync_events')
      .select('*')
      .eq('sync_status', 'sync_failed')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[syncEvents] fetchSyncFailures error:', error.message);
      return [];
    }
    return (data ?? []) as SyncEvent[];
  } catch (err) {
    console.error('[syncEvents] fetchSyncFailures exception:', err);
    return [];
  }
}
