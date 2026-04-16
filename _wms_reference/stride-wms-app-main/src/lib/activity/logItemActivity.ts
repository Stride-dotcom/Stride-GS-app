/**
 * logItemActivity - Fire-and-forget helper to insert a row into item_activity.
 *
 * Resolves actor_name from the users table when actorUserId is provided.
 * Designed to be resilient: failures are logged but never throw.
 */

import { supabase } from '@/integrations/supabase/client';

// Cache actor names for the session to reduce DB lookups
const actorNameCache = new Map<string, string | null>();

export interface LogItemActivityParams {
  tenantId: string;
  itemId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  eventType: string;
  eventLabel: string;
  details?: Record<string, unknown>;
}

async function resolveActorName(userId: string): Promise<string | null> {
  if (actorNameCache.has(userId)) {
    return actorNameCache.get(userId) ?? null;
  }

  try {
    const { data } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', userId)
      .single();

    if (data) {
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
      actorNameCache.set(userId, name);
      return name;
    }
  } catch {
    // Swallow – name is optional
  }

  actorNameCache.set(userId, null);
  return null;
}

export async function logItemActivity(params: LogItemActivityParams): Promise<void> {
  const { tenantId, itemId, actorUserId, eventType, eventLabel, details } = params;

  if (!tenantId || !itemId) return;

  try {
    // Resolve display name if not explicitly provided
    let actorName = params.actorName ?? null;
    if (!actorName && actorUserId) {
      actorName = await resolveActorName(actorUserId);
    }

    await (supabase.from('item_activity') as any).insert({
      tenant_id: tenantId,
      item_id: itemId,
      actor_user_id: actorUserId || null,
      actor_name: actorName,
      event_type: eventType,
      event_label: eventLabel,
      details: details || {},
    });
  } catch (err) {
    // Fire-and-forget: never block the caller
    console.error('[logItemActivity] Failed to log activity:', err);
  }
}

/**
 * Convenience: log multiple activities at once (e.g., batch scan events).
 */
export async function logItemActivities(
  items: Array<{ itemId: string }>,
  shared: Omit<LogItemActivityParams, 'itemId'>
): Promise<void> {
  if (!shared.tenantId || items.length === 0) return;

  try {
    let actorName = shared.actorName ?? null;
    if (!actorName && shared.actorUserId) {
      actorName = await resolveActorName(shared.actorUserId);
    }

    const rows = items.map(({ itemId }) => ({
      tenant_id: shared.tenantId,
      item_id: itemId,
      actor_user_id: shared.actorUserId || null,
      actor_name: actorName,
      event_type: shared.eventType,
      event_label: shared.eventLabel,
      details: shared.details || {},
    }));

    await (supabase.from('item_activity') as any).insert(rows);
  } catch (err) {
    console.error('[logItemActivities] Failed to log activities:', err);
  }
}
