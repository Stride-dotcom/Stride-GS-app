/**
 * storageCredits — CRUD for admin-granted free-storage windows.
 *
 * A credit waives the per-day STOR charge for the days it covers
 * (whole client when itemId is null, else one item). The Postgres
 * storage-charge engine (migration 20260517120000) honors these
 * rows; this module is just the create / list / delete surface
 * the React UI drives.
 *
 * Every create and delete also writes one entity_audit_log row
 * keyed on entity_id = itemId (entity_type 'inventory') so the
 * waiver shows in the item's activity timeline. The audit write
 * is best-effort — it never blocks or fails the user-visible
 * mutation (mirrors lib/dtOrderAudit.ts).
 */
import { supabase } from './supabase';

export interface StorageCredit {
  id: string;
  tenant_id: string;
  item_id: string | null;
  inventory_id: string | null;
  free_from: string; // YYYY-MM-DD
  free_to: string;   // YYYY-MM-DD
  reason: string;
  created_by: string | null;
  created_at: string;
}

async function logCreditAudit(
  itemId: string,
  tenantId: string,
  action: 'storage_credit_added' | 'storage_credit_removed',
  performedBy: string | null,
  summary: string,
): Promise<void> {
  if (!itemId) return;
  try {
    const { error } = await supabase.from('entity_audit_log').insert({
      entity_type: 'inventory',
      entity_id: itemId,
      tenant_id: tenantId ?? null,
      action,
      changes: { summary },
      performed_by: performedBy ?? null,
      source: 'app',
    });
    if (error) {
      console.warn(`[storage_credit audit] insert failed for ${itemId}:`, error.message);
    }
  } catch (err) {
    console.warn(`[storage_credit audit] insert threw for ${itemId}:`, err);
  }
}

export interface CreateStorageCreditInput {
  tenantId: string;
  /** Per-item credits. One row inserted per id. */
  itemIds: string[];
  freeFrom: string; // YYYY-MM-DD
  freeTo: string;   // YYYY-MM-DD
  reason: string;
  createdBy: string;
}

/**
 * Insert one storage_credits row per item id. Returns the count
 * inserted. Throws on the first DB error (the modal surfaces it).
 */
export async function createStorageCredits(
  input: CreateStorageCreditInput,
): Promise<number> {
  const { tenantId, itemIds, freeFrom, freeTo, reason, createdBy } = input;
  const rows = itemIds.map(itemId => ({
    tenant_id: tenantId,
    item_id: itemId,
    free_from: freeFrom,
    free_to: freeTo,
    reason: reason.trim(),
    created_by: createdBy,
  }));

  const { error } = await supabase.from('storage_credits').insert(rows);
  if (error) throw new Error(error.message);

  const summary =
    `Storage credit ${freeFrom} → ${freeTo}` +
    (reason.trim() ? ` — ${reason.trim()}` : '');
  await Promise.all(
    itemIds.map(itemId =>
      logCreditAudit(itemId, tenantId, 'storage_credit_added', createdBy, summary),
    ),
  );
  return rows.length;
}

/**
 * Active + historical credits for one item. Includes whole-client
 * credits (item_id IS NULL) that also cover the item.
 */
export async function fetchStorageCreditsForItem(
  tenantId: string,
  itemId: string,
): Promise<StorageCredit[]> {
  if (!tenantId || !itemId) return [];
  const { data, error } = await supabase
    .from('storage_credits')
    .select('id, tenant_id, item_id, inventory_id, free_from, free_to, reason, created_by, created_at')
    .eq('tenant_id', tenantId)
    .or(`item_id.eq.${itemId},item_id.is.null`)
    .order('free_from', { ascending: false });
  if (error) {
    console.warn(`[storage_credit] fetch failed for ${itemId}:`, error.message);
    return [];
  }
  return (data ?? []) as StorageCredit[];
}

/**
 * Delete a credit. Writes a removal audit entry keyed on the
 * supplied itemId (the item whose timeline the user is viewing —
 * for whole-client credits item_id on the row is null, so the
 * caller passes the contextual item id).
 */
export async function deleteStorageCredit(
  creditId: string,
  ctx: { itemId: string; tenantId: string; performedBy: string; freeFrom: string; freeTo: string; reason: string },
): Promise<void> {
  const { error } = await supabase
    .from('storage_credits')
    .delete()
    .eq('id', creditId);
  if (error) throw new Error(error.message);

  const summary =
    `Storage credit removed (${ctx.freeFrom} → ${ctx.freeTo})` +
    (ctx.reason ? ` — ${ctx.reason}` : '');
  await logCreditAudit(ctx.itemId, ctx.tenantId, 'storage_credit_removed', ctx.performedBy, summary);
}
