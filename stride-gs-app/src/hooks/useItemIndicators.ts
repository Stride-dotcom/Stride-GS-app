/**
 * useItemIndicators — Lightweight Supabase query for I/A/R badges.
 * Returns Sets of item IDs that have inspection tasks, assembly tasks, or repairs.
 * Used by any page that shows an Item ID column to render (I), (A), (R) badges.
 *
 * Query is tenant-scoped and cached per client filter. ~50ms from Supabase.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';

interface ItemIndicators {
  inspItems: Set<string>;
  asmItems: Set<string>;
  repairItems: Set<string>;
  loaded: boolean;
}

const EMPTY: ItemIndicators = { inspItems: new Set(), asmItems: new Set(), repairItems: new Set(), loaded: false };

export function useItemIndicators(clientSheetIds?: string | string[]): ItemIndicators {
  const [data, setData] = useState<ItemIndicators>(EMPTY);
  const keyRef = useRef('');

  const key = useMemo(() => {
    if (!clientSheetIds) return '';
    return Array.isArray(clientSheetIds) ? clientSheetIds.slice().sort().join(',') : clientSheetIds;
  }, [clientSheetIds]);

  useEffect(() => {
    if (!key) { setData(EMPTY); return; }
    if (keyRef.current === key && data.loaded) return;
    keyRef.current = key;

    let cancelled = false;
    (async () => {
      const insp = new Set<string>();
      const asm = new Set<string>();
      const rep = new Set<string>();

      try {
        // Fetch task indicators (INSP + ASM) — ALL statuses, not just open.
        // The indicator means "this item has had an inspection/assembly created",
        // regardless of whether it's completed, in progress, or open.
        let tq = supabase.from('tasks').select('item_id, type');
        if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
          tq = tq.in('tenant_id', clientSheetIds);
        } else if (typeof clientSheetIds === 'string') {
          tq = tq.eq('tenant_id', clientSheetIds);
        }
        const { data: tasks } = await tq.range(0, 49999);
        if (tasks && !cancelled) {
          for (const t of tasks as { item_id: string | null; type: string | null }[]) {
            if (!t.item_id) continue;
            const code = (t.type || '').toUpperCase();
            if (code === 'INSP' || code === 'INSPECTION') insp.add(t.item_id);
            else if (code === 'ASM' || code === 'ASSEMBLY') asm.add(t.item_id);
          }
        }

        // Fetch repair indicators — ALL statuses
        let rq = supabase.from('repairs').select('item_id');
        if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
          rq = rq.in('tenant_id', clientSheetIds);
        } else if (typeof clientSheetIds === 'string') {
          rq = rq.eq('tenant_id', clientSheetIds);
        }
        const { data: repairs } = await rq.range(0, 49999);
        if (repairs && !cancelled) {
          for (const r of repairs as { item_id: string | null }[]) {
            if (r.item_id) rep.add(r.item_id);
          }
        }
      } catch { /* best-effort */ }

      if (!cancelled) {
        setData({ inspItems: insp, asmItems: asm, repairItems: rep, loaded: true });
      }
    })();

    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return data;
}
