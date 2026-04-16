/**
 * entityEvents — tiny pub/sub for Supabase Realtime confirmed events.
 *
 * Usage:
 *   entityEvents.emit('task', 'INSP-00123')  // called from useFailedOperations
 *   const unsub = entityEvents.subscribe(fn)  // called from hooks / BatchDataContext
 */

type EntityType = 'task' | 'repair' | 'will_call' | 'inventory' | 'shipment' | 'billing' | 'client';

type EntityEventCallback = (entityType: EntityType, entityId: string) => void;

const listeners = new Set<EntityEventCallback>();

export const entityEvents = {
  emit(entityType: string, entityId: string) {
    const type = entityType as EntityType;
    listeners.forEach((fn) => {
      try { fn(type, entityId); } catch { /* ignore listener errors */ }
    });
  },

  subscribe(fn: EntityEventCallback): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
