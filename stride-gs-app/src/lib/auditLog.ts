/**
 * auditLog — best-effort browser-side writes to entity_audit_log.
 *
 * Generalizes the dtOrderAudit pattern to every entity type so React-driven
 * events that never touch an Edge Function (photo uploads/deletes, notes,
 * work-order prints) still land in the ActivityTimeline.
 *
 * RLS: the insert policy admits authenticated admin/staff via
 * user_metadata.role (20260608190000). A client-role session's insert is
 * rejected silently — acceptable for these UX-trail events; the write that
 * matters (photo/note row itself) is never blocked on the audit insert.
 *
 * Fire-and-forget: failures land in console.warn only. Never await this in
 * a user-visible critical path.
 */
import { supabase } from './supabase';

export interface EntityAuditInsert {
  entityType: string;
  entityId: string;
  tenantId?: string | null;
  action: string;
  /** Field diffs ({field: {old, new}}), summary strings, or scalars. */
  changes?: Record<string, unknown> | null;
  /** Email of the acting user. Best-effort. */
  performedBy?: string | null;
  /** Display name of the acting user (shown in the timeline when set). */
  performedByName?: string | null;
}

export async function logEntityAudit(opts: EntityAuditInsert): Promise<void> {
  const { entityType, entityId, tenantId, action, changes, performedBy, performedByName } = opts;
  if (!entityType || !entityId || !action) return;
  try {
    const { error } = await supabase.from('entity_audit_log').insert({
      entity_type:       entityType,
      entity_id:         entityId,
      tenant_id:         tenantId ?? null,
      action,
      changes:           changes ?? null,
      performed_by:      performedBy ?? null,
      performed_by_name: performedByName ?? null,
      source:            'app',
    });
    if (error) {
      console.warn(`[audit] insert failed for ${entityType}/${entityId} ${action}:`, error.message);
    }
  } catch (err) {
    console.warn(`[audit] insert threw for ${entityType}/${entityId} ${action}:`, err);
  }
}
