/**
 * useBatchItemMap — entity_id → item_ids[] for batch list columns.
 *
 * Lightweight bulk read of repair_items / task_items so the Repairs and
 * Tasks list pages can render "N items" (with the full list in the tooltip)
 * instead of just the primary item_id for multi-item batches. Rows are tiny
 * (two text columns); .range matches fetchRepairsFromSupabase's 50k cap
 * override. Refetches on Realtime changes to the items table (debounced) so
 * an Edit Items re-quote updates open lists within ~1-2s.
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BatchEntityType } from './useBatchWorkItems';

const TABLE_BY_ENTITY: Record<BatchEntityType, { table: string; fk: 'repair_id' | 'task_id' }> = {
  repair: { table: 'repair_items', fk: 'repair_id' },
  task:   { table: 'task_items',   fk: 'task_id' },
};

const EMPTY = new Map<string, string[]>();

export function useBatchItemMap(entityType: BatchEntityType, enabled = true): Map<string, string[]> {
  const [map, setMap] = useState<Map<string, string[]>>(EMPTY);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) { setMap(EMPTY); return; }
    const { table, fk } = TABLE_BY_ENTITY[entityType];
    let cancelled = false;

    const fetch = async () => {
      const { data } = await supabase
        .from(table)
        .select(`${fk}, item_id`)
        .order('created_at', { ascending: true })
        .range(0, 49999);
      if (cancelled) return;
      const next = new Map<string, string[]>();
      for (const row of (data ?? []) as Array<Record<string, string>>) {
        const key = row[fk];
        const itemId = row.item_id;
        if (!key || !itemId) continue;
        const arr = next.get(key);
        if (arr) arr.push(itemId); else next.set(key, [itemId]);
      }
      setMap(next);
    };
    void fetch();

    const channel = supabase
      .channel(`batch_item_map_${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { void fetch(); }, 500);
      })
      .subscribe();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [entityType, enabled]);

  return map;
}
