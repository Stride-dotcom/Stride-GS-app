/**
 * logActivity - Shared fire-and-forget helper for inserting activity rows
 * into item_activity, shipment_activity, task_activity, or account_activity.
 *
 * Single source of truth: callers specify entityType + entityId and this
 * module routes to the correct table.
 *
 * Resolves actor_name from the users table when actorUserId is provided.
 * Designed to be resilient: failures are logged but never throw.
 */

import { supabase } from '@/integrations/supabase/client';

export type ActivityEntityType =
  | 'item'
  | 'shipment'
  | 'task'
  | 'account'
  | 'claim'
  | 'repair_quote'
  | 'quote'
  | 'invoice'
  | 'stocktake';

const TABLE_MAP: Record<ActivityEntityType, { table: string; idColumn: string }> = {
  item:         { table: 'item_activity',         idColumn: 'item_id' },
  shipment:     { table: 'shipment_activity',     idColumn: 'shipment_id' },
  task:         { table: 'task_activity',         idColumn: 'task_id' },
  account:      { table: 'account_activity',      idColumn: 'account_id' },
  claim:        { table: 'claim_activity',        idColumn: 'claim_id' },
  repair_quote: { table: 'repair_quote_activity', idColumn: 'repair_quote_id' },
  quote:        { table: 'quote_activity',        idColumn: 'quote_id' },
  invoice:      { table: 'invoice_activity',      idColumn: 'invoice_id' },
  stocktake:    { table: 'stocktake_activity',    idColumn: 'stocktake_id' },
};

// Cache actor names for the session to reduce DB lookups
const actorNameCache = new Map<string, string | null>();

export interface LogActivityParams {
  entityType: ActivityEntityType;
  tenantId: string;
  entityId: string;
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
    // Swallow - name is optional
  }

  actorNameCache.set(userId, null);
  return null;
}

/**
 * Log a single activity row. Fire-and-forget: never throws.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  const { entityType, tenantId, entityId, actorUserId, eventType, eventLabel, details } = params;

  // Fail gracefully if entityId is missing (do not crash billing flows)
  if (!tenantId || !entityId) return;

  const mapping = TABLE_MAP[entityType];
  if (!mapping) return;

  try {
    let actorName = params.actorName ?? null;
    if (!actorName && actorUserId) {
      actorName = await resolveActorName(actorUserId);
    }

    await (supabase as any).from(mapping.table).insert({
      tenant_id: tenantId,
      [mapping.idColumn]: entityId,
      actor_user_id: actorUserId || null,
      actor_name: actorName,
      event_type: eventType,
      event_label: eventLabel,
      details: details || {},
    });
  } catch (err) {
    console.error(`[logActivity] Failed to log ${entityType} activity:`, err);
  }
}

/**
 * Log activity to multiple entity tables for a single billing event.
 * Inserts into each entity's activity table if the corresponding ID exists.
 * Fire-and-forget: never throws.
 */
export async function logBillingActivity(params: {
  tenantId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  eventType: string;
  eventLabel: string;
  details?: Record<string, unknown>;
  itemId?: string | null;
  shipmentId?: string | null;
  taskId?: string | null;
  accountId?: string | null;
}): Promise<void> {
  const { tenantId, actorUserId, eventType, eventLabel, details, itemId, shipmentId, taskId, accountId } = params;

  if (!tenantId) return;

  // Resolve actor name once for all inserts
  let actorName = params.actorName ?? null;
  if (!actorName && actorUserId) {
    try {
      actorName = await resolveActorName(actorUserId);
    } catch {
      // Continue without name
    }
  }

  const shared = { actorUserId, actorName, eventType, eventLabel, details };

  const promises: Promise<void>[] = [];

  if (itemId) {
    promises.push(logActivity({ entityType: 'item', tenantId, entityId: itemId, ...shared }));
  }
  if (shipmentId) {
    promises.push(logActivity({ entityType: 'shipment', tenantId, entityId: shipmentId, ...shared }));
  }
  if (taskId) {
    promises.push(logActivity({ entityType: 'task', tenantId, entityId: taskId, ...shared }));
  }
  if (accountId) {
    promises.push(logActivity({ entityType: 'account', tenantId, entityId: accountId, ...shared }));
  }

  // Fire all in parallel, swallow errors
  try {
    await Promise.allSettled(promises);
  } catch {
    // Never block the caller
  }
}
