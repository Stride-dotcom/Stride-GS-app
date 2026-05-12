/**
 * dtOrderAudit — best-effort audit-log writes for delivery-order events.
 *
 * Mirrors the GAS-side `api_auditLog_("will_call", ...)` pattern other
 * entities already use. Inserts one row into `entity_audit_log` per
 * delivery-order action so the OrderPage Activity tab (which reads via
 * <EntityHistory entityType="dt_order">) actually shows something.
 *
 * Schema reminder (entity_audit_log):
 *   entity_type, entity_id, tenant_id, action, changes (jsonb),
 *   performed_by, performed_at, source
 *
 * Best-effort: failures land in console.warn only. The audit row is
 * never the user-visible action; we never block a save / approve /
 * push on a failed audit insert.
 */
import { supabase } from './supabase';

export type DtOrderAuditAction =
  | 'create'
  | 'update'
  | 'approve'
  | 'reject'
  | 'revision_requested'
  | 'push_to_dt'
  | 'cancel'
  | 'release_items';

interface AuditOptions {
  orderId: string;
  tenantId?: string | null;
  action: DtOrderAuditAction;
  /** Field-level diff for `update`, scalar summary for the others. */
  changes?: Record<string, unknown>;
  /** Email of the user who triggered the change. Best-effort. */
  performedBy?: string | null;
  /** 'app' for browser-driven actions, 'edge' for Edge Function calls. */
  source?: 'app' | 'edge' | 'gas';
}

/**
 * Insert an audit row. Fire-and-forget — caller doesn't await unless it
 * cares about the failure mode (none of the current call sites do).
 */
export async function logDtOrderAudit(opts: AuditOptions): Promise<void> {
  const { orderId, tenantId, action, changes, performedBy, source = 'app' } = opts;
  if (!orderId) return;
  try {
    const { error } = await supabase.from('entity_audit_log').insert({
      entity_type: 'dt_order',
      entity_id: orderId,
      tenant_id: tenantId ?? null,
      action,
      changes: changes ?? null,
      performed_by: performedBy ?? null,
      source,
    });
    if (error) {
      console.warn(`[dt_order audit] insert failed for ${orderId}:`, error.message);
    }
  } catch (err) {
    console.warn(`[dt_order audit] insert threw for ${orderId}:`, err);
  }
}

/**
 * Build a `changes` object for `update` actions by diffing two snapshots.
 * Only includes fields that actually changed. Falls back to an empty
 * object so the audit row is still written (proves an update happened
 * even when nothing material moved — useful for "save with no diff"
 * trail entries).
 */
export function buildOrderUpdateChanges<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const f of fields) {
    const a = before[f];
    const b = after[f];
    if (a !== b) {
      out[String(f)] = { old: a ?? null, new: b ?? null };
    }
  }
  return out;
}
