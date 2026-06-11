/**
 * useBatchWorkItems — shared per-item work tracking for batch jobs.
 *
 * One hook any batch entity page (repairs, tasks, future types) drops in to
 * manage the items inside a batch: each item is independently started,
 * passed/failed, annotated and photographed. Backs the <BatchWorkItems>
 * shared component.
 *
 * Data: public.repair_items / public.task_items joined client-side with an
 * inventory overlay (description / vendor / sidemark / location), same
 * eager-load pattern as fetchRepairItemsWithOverlay. Writes go through the
 * update_batch_work_item SECURITY DEFINER RPC (admin/staff gated) because
 * neither table has authenticated write policies — see migration
 * 20260611120000_batch_work_items.sql.
 *
 * Legacy tasks predate task_items: when the items table has no rows for the
 * entity, the hook synthesizes one display row from `fallbackItem` (the
 * parent's single item_id). The first status/notes write upserts a real row
 * via the RPC, so legacy tasks graduate lazily with no bulk backfill.
 *
 * Photos: one usePhotos hook scoped to the batch entity (entity_type +
 * entity_id = the batch). Uploads stamp item_id per card via the upload
 * override, so each photo lands on BOTH the batch (entity scope) and the
 * item's own detail page (item_id rollup) — no double upload.
 *
 * Realtime: subscribes to postgres_changes on the items table filtered to
 * this entity and refetches, so two staff working the same batch see each
 * other's per-item flips in ~1-2s.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePhotos, type Photo, type PhotoType, type EntityType as PhotoEntityType } from './usePhotos';

export type BatchEntityType = 'repair' | 'task';
export type BatchItemStatus = 'Pending' | 'In Progress' | 'Pass' | 'Fail';

export const BATCH_ITEM_STATUSES: BatchItemStatus[] = ['Pending', 'In Progress', 'Pass', 'Fail'];

export interface BatchWorkItem {
  itemId: string;
  qty: number;
  status: BatchItemStatus;
  /** Legacy lowercase mirror ('passed' | 'failed' | null) kept in sync by the RPC. */
  result: string | null;
  notes: string;
  startedAt: string | null;
  completedAt: string | null;
  /** True when no DB row exists yet (legacy single-item task fallback). */
  synthetic: boolean;
  // Inventory overlay — read-time join; empty strings when the inventory
  // row is gone (released/archived).
  description: string;
  vendor: string;
  sidemark: string;
  location: string;
  room: string;
  itemClass: string;
  inventoryStatus: string;
}

export interface BatchStatusSummary {
  total: number;
  done: number;
  passed: number;
  failed: number;
  inProgress: number;
  pending: number;
  /** Every item has a terminal result (and there is at least one item). */
  isAllComplete: boolean;
  anyFail: boolean;
  anyStarted: boolean;
}

export interface UseBatchWorkItemsOptions {
  entityType: BatchEntityType;
  entityId: string | null | undefined;
  /** Tenant (client spreadsheet ID) the batch belongs to. Required for writes. */
  tenantId: string | null | undefined;
  enabled?: boolean;
  /** Legacy fallback: parent's single item, synthesized as one card when the
   *  items table has no rows for this entity (pre-task_items tasks). */
  fallbackItem?: { itemId: string; qty?: number | null } | null;
}

export interface UseBatchWorkItemsResult {
  items: BatchWorkItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Set an item's work status. Returns the post-write summary (computed on
   *  the updated list) or null on failure — callers use it to decide batch
   *  auto-completion without racing the refetch. */
  updateItemStatus: (itemId: string, status: BatchItemStatus) => Promise<BatchStatusSummary | null>;
  updateItemNotes: (itemId: string, notes: string) => Promise<boolean>;
  batchStatus: BatchStatusSummary;
  isAllComplete: boolean;
  /** Photos uploaded against this batch, grouped by item_id. */
  photosByItem: Map<string, Photo[]>;
  photosLoading: boolean;
  uploadPhoto: (itemId: string, file: File) => Promise<Photo | null>;
  deletePhoto: (photoId: string) => Promise<boolean>;
}

interface ItemRow {
  item_id: string;
  qty: number | string | null;
  item_status: string | null;
  item_result: string | null;
  item_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface InvRow {
  item_id: string;
  description: string | null;
  vendor: string | null;
  sidemark: string | null;
  location: string | null;
  room: string | null;
  item_class: string | null;
  status: string | null;
}

const TABLE_BY_ENTITY: Record<BatchEntityType, { table: string; fk: 'repair_id' | 'task_id' }> = {
  repair: { table: 'repair_items', fk: 'repair_id' },
  task:   { table: 'task_items',   fk: 'task_id' },
};

function normalizeStatus(raw: string | null | undefined): BatchItemStatus {
  if (raw === 'In Progress' || raw === 'Pass' || raw === 'Fail') return raw;
  return 'Pending';
}

function summarize(items: BatchWorkItem[]): BatchStatusSummary {
  const total = items.length;
  let passed = 0, failed = 0, inProgress = 0, pending = 0;
  for (const it of items) {
    if (it.status === 'Pass') passed++;
    else if (it.status === 'Fail') failed++;
    else if (it.status === 'In Progress') inProgress++;
    else pending++;
  }
  const done = passed + failed;
  return {
    total, done, passed, failed, inProgress, pending,
    isAllComplete: total > 0 && done === total,
    anyFail: failed > 0,
    anyStarted: done + inProgress > 0,
  };
}

export function useBatchWorkItems({
  entityType, entityId, tenantId, enabled = true, fallbackItem,
}: UseBatchWorkItemsOptions): UseBatchWorkItemsResult {
  const [items, setItems] = useState<BatchWorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const { table, fk } = TABLE_BY_ENTITY[entityType];

  // One photos hook for the whole batch — entity-scoped (NOT item rollup:
  // no `itemId` option), so it fetches exactly the photos uploaded against
  // this batch across all its items. Cards group them by item_id below.
  const photosApi = usePhotos({
    entityType: entityType as PhotoEntityType,
    entityId,
    tenantId,
    enabled,
  });

  const refetch = useCallback(async () => {
    if (!enabled || !entityId || !tenantId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setError(null);

    const { data: itemRows, error: itemErr } = await supabase
      .from(table)
      .select('item_id, qty, item_status, item_result, item_notes, started_at, completed_at')
      .eq('tenant_id', tenantId)
      .eq(fk, entityId)
      .order('created_at', { ascending: true });
    if (!mountedRef.current) return;
    if (itemErr) { setError(itemErr.message); setLoading(false); return; }

    let rows = (itemRows ?? []) as ItemRow[];
    let synthetic = false;
    if (rows.length === 0 && fallbackItem?.itemId) {
      // Legacy single-item entity with no child rows yet — synthesize one
      // card from the parent's item_id. The first write mints the real row.
      synthetic = true;
      rows = [{
        item_id: fallbackItem.itemId,
        qty: fallbackItem.qty ?? 1,
        item_status: 'Pending',
        item_result: null,
        item_notes: null,
        started_at: null,
        completed_at: null,
      }];
    }

    const itemIds = rows.map(r => r.item_id).filter(Boolean);
    let invByItemId = new Map<string, InvRow>();
    if (itemIds.length > 0) {
      const { data: invRows } = await supabase
        .from('inventory')
        .select('item_id, description, vendor, sidemark, location, room, item_class, status')
        .eq('tenant_id', tenantId)
        .in('item_id', itemIds);
      if (!mountedRef.current) return;
      invByItemId = new Map(((invRows ?? []) as InvRow[]).map(r => [r.item_id, r]));
    }

    setItems(rows.map(r => {
      const inv = invByItemId.get(r.item_id);
      return {
        itemId: r.item_id,
        qty: r.qty != null ? Number(r.qty) : 1,
        status: normalizeStatus(r.item_status),
        result: r.item_result,
        notes: r.item_notes ?? '',
        startedAt: r.started_at,
        completedAt: r.completed_at,
        synthetic,
        description:     inv?.description ?? '',
        vendor:          inv?.vendor ?? '',
        sidemark:        inv?.sidemark ?? '',
        location:        inv?.location ?? '',
        room:            inv?.room ?? '',
        itemClass:       inv?.item_class ?? '',
        inventoryStatus: inv?.status ?? '',
      };
    }));
    setLoading(false);
  }, [enabled, entityId, tenantId, table, fk, fallbackItem?.itemId, fallbackItem?.qty]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime — another tab/staff member flipping an item refreshes this one.
  useEffect(() => {
    if (!enabled || !entityId) return;
    const channel = supabase
      .channel(`batch_work_items_${entityType}_${entityId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${fk}=eq.${entityId}` },
        () => { void refetch(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, entityType, entityId, table, fk, refetch]);

  const writeItem = useCallback(async (
    itemId: string,
    patch: { status?: BatchItemStatus; notes?: string },
  ): Promise<BatchWorkItem[] | null> => {
    if (!entityId || !tenantId) { setError('Missing tenant or entity context'); return null; }
    setError(null);

    const prev = items;
    const now = new Date().toISOString();
    const next = items.map(it => {
      if (it.itemId !== itemId) return it;
      const status = patch.status ?? it.status;
      return {
        ...it,
        status,
        notes: patch.notes ?? it.notes,
        result: patch.status === undefined ? it.result
          : status === 'Pass' ? 'passed' : status === 'Fail' ? 'failed' : null,
        startedAt: status === 'In Progress' ? (it.startedAt ?? now) : it.startedAt,
        completedAt: (status === 'Pass' || status === 'Fail')
          ? (it.completedAt ?? now)
          : patch.status !== undefined ? null : it.completedAt,
        synthetic: false,
      };
    });
    setItems(next);

    const target = items.find(it => it.itemId === itemId);
    const { error: rpcErr } = await supabase.rpc('update_batch_work_item', {
      p_entity_type: entityType,
      p_tenant_id:   tenantId,
      p_entity_id:   entityId,
      p_item_id:     itemId,
      p_status:      patch.status ?? null,
      p_notes:       patch.notes ?? null,
      // Carry qty only when minting the row from a synthetic fallback so the
      // legacy task's quantity survives; otherwise leave it untouched.
      p_qty:         target?.synthetic ? target.qty : null,
    });
    if (rpcErr) {
      if (mountedRef.current) {
        setItems(prev);
        setError(rpcErr.message);
      }
      return null;
    }
    return next;
  }, [items, entityType, entityId, tenantId]);

  const updateItemStatus = useCallback(async (
    itemId: string,
    status: BatchItemStatus,
  ): Promise<BatchStatusSummary | null> => {
    const next = await writeItem(itemId, { status });
    return next ? summarize(next) : null;
  }, [writeItem]);

  const updateItemNotes = useCallback(async (itemId: string, notes: string): Promise<boolean> => {
    return (await writeItem(itemId, { notes })) !== null;
  }, [writeItem]);

  const uploadPhoto = useCallback(async (itemId: string, file: File): Promise<Photo | null> => {
    if (!entityId) return null;
    // photo_type 'repair' also sets is_repair=true on the row (usePhotos),
    // which is what the item detail page's Repair photo filter keys on.
    const photoType: PhotoType = entityType === 'repair' ? 'repair' : 'general';
    return photosApi.uploadPhoto(file, photoType, {
      entityType: entityType as PhotoEntityType,
      entityId,
      itemId,
    });
  }, [photosApi.uploadPhoto, entityType, entityId]);

  const photosByItem = useMemo(() => {
    const map = new Map<string, Photo[]>();
    for (const p of photosApi.photos) {
      const key = p.item_id ?? '';
      const arr = map.get(key);
      if (arr) arr.push(p); else map.set(key, [p]);
    }
    return map;
  }, [photosApi.photos]);

  const batchStatus = useMemo(() => summarize(items), [items]);

  return {
    items,
    loading,
    error,
    refetch,
    updateItemStatus,
    updateItemNotes,
    batchStatus,
    isAllComplete: batchStatus.isAllComplete,
    photosByItem,
    photosLoading: photosApi.loading,
    uploadPhoto,
    deletePhoto: photosApi.deletePhoto,
  };
}
