/**
 * entityEvents — tiny pub/sub for write-confirmed refetch signals.
 *
 * Usage:
 *   entityEvents.emit('task', 'INSP-00123')  // called after a successful write
 *   const unsub = entityEvents.subscribe(fn)  // called from hooks / BatchDataContext
 *
 * Session 71: Added skipSupabaseOnNextFetch — when a write handler emits an event,
 * the subsequent refetch should bypass Supabase (which may be stale) and go straight
 * to GAS for authoritative data. The flag auto-clears after being consumed.
 */

type EntityType = 'task' | 'repair' | 'will_call' | 'inventory' | 'shipment' | 'billing' | 'client' | 'claim' | 'move_history' | 'order';

type EntityEventCallback = (entityType: EntityType, entityId: string) => void;

const listeners = new Set<EntityEventCallback>();

/**
 * Per-entity-type flag: when true, the next fetch for this type should bypass
 * Supabase and go directly to GAS. Set by emit(), consumed by shouldSkipSupabase().
 */
const _skipSupabase: Partial<Record<EntityType, boolean>> = {};

export const entityEvents = {
  /**
   * Emit after a LOCAL write (GAS call from this browser tab).
   * Sets skipSupabase flag so the refetch goes to GAS for authoritative data.
   */
  emit(entityType: string, entityId: string) {
    const type = entityType as EntityType;
    // Flag: next fetch for this entity type should skip Supabase cache
    _skipSupabase[type] = true;
    listeners.forEach((fn) => {
      try { fn(type, entityId); } catch { /* ignore listener errors */ }
    });
  },

  /**
   * Emit from Supabase Realtime (another user/tab changed data).
   * Does NOT set skipSupabase — the data is already in Supabase, use it.
   */
  emitFromRealtime(entityType: string, entityId: string) {
    const type = entityType as EntityType;
    // Don't set _skipSupabase — Supabase has the fresh data
    listeners.forEach((fn) => {
      try { fn(type, entityId); } catch { /* ignore listener errors */ }
    });
  },

  subscribe(fn: EntityEventCallback): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /**
   * Check and consume the skip-Supabase flag for a given entity type.
   * Returns true (and clears the flag) if the next fetch should bypass Supabase.
   */
  shouldSkipSupabase(entityType: string): boolean {
    const type = entityType as EntityType;
    if (_skipSupabase[type]) {
      _skipSupabase[type] = false;
      return true;
    }
    return false;
  },
};
