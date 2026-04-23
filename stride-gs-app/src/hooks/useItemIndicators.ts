/**
 * useItemIndicators — Lightweight Supabase query for I/A/R badges.
 * Returns open/done Sets of item IDs that have inspection tasks, assembly tasks, or repairs.
 * Open = in-progress/active (orange badge). Done = completed (green badge).
 * Cancelled/declined items produce no badge entry.
 * Used by any page that shows an Item ID column to render (I), (A), (R) badges.
 *
 * Query is tenant-scoped and cached per client filter. ~50ms from Supabase.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';

export interface ItemIndicators {
  /** INSP tasks that are open or in progress */
  inspOpenItems: Set<string>;
  /** INSP tasks that are completed */
  inspDoneItems: Set<string>;
  /** ASM tasks that are open or in progress */
  asmOpenItems: Set<string>;
  /** ASM tasks that are completed */
  asmDoneItems: Set<string>;
  /** Repairs that are open/in progress */
  repairOpenItems: Set<string>;
  /** Repairs that are completed */
  repairDoneItems: Set<string>;
  /** v2026-04-23 — Will Call items in Pending/Scheduled/Partial → orange W */
  wcOpenItems: Set<string>;
  /** v2026-04-23 — Will Call items in Released → green W */
  wcDoneItems: Set<string>;
  loaded: boolean;
}

const EMPTY: ItemIndicators = {
  inspOpenItems: new Set(), inspDoneItems: new Set(),
  asmOpenItems: new Set(), asmDoneItems: new Set(),
  repairOpenItems: new Set(), repairDoneItems: new Set(),
  wcOpenItems: new Set(), wcDoneItems: new Set(),
  loaded: false,
};

/** Task statuses that mean "done" for badge purposes. */
const TASK_DONE = new Set(['completed', 'Completed']);
/** Repair statuses that mean "done" for badge purposes. */
const REPAIR_DONE = new Set(['complete', 'Complete', 'completed', 'Completed']);
/** v2026-04-23 — Will Call statuses that mean "done" (item released) → green W. */
const WC_DONE = new Set(['Released', 'released']);
/** v2026-04-23 — Will Call statuses that mean "open/in-progress" → orange W.
 *  Cancelled yields no badge (callers should exclude). */
const WC_OPEN = new Set(['Pending', 'Scheduled', 'Partial', 'pending', 'scheduled', 'partial']);

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
      const inspOpen = new Set<string>();
      const inspDone = new Set<string>();
      const asmOpen = new Set<string>();
      const asmDone = new Set<string>();
      const repOpen = new Set<string>();
      const repDone = new Set<string>();
      const wcOpen = new Set<string>();
      const wcDone = new Set<string>();

      try {
        // Fetch task indicators (INSP + ASM) with status for open/done split.
        let tq = supabase.from('tasks').select('item_id, type, status');
        if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
          tq = tq.in('tenant_id', clientSheetIds);
        } else if (typeof clientSheetIds === 'string') {
          tq = tq.eq('tenant_id', clientSheetIds);
        }
        const { data: tasks } = await tq.range(0, 49999);
        if (tasks && !cancelled) {
          for (const t of tasks as { item_id: string | null; type: string | null; status: string | null }[]) {
            if (!t.item_id) continue;
            const done = TASK_DONE.has(t.status ?? '');
            const code = (t.type || '').toUpperCase();
            if (code === 'INSP' || code === 'INSPECTION') {
              if (done) { if (!inspOpen.has(t.item_id)) inspDone.add(t.item_id); }
              else { inspOpen.add(t.item_id); inspDone.delete(t.item_id); }
            } else if (code === 'ASM' || code === 'ASSEMBLY') {
              if (done) { if (!asmOpen.has(t.item_id)) asmDone.add(t.item_id); }
              else { asmOpen.add(t.item_id); asmDone.delete(t.item_id); }
            }
          }
        }

        // Fetch repair indicators with status for open/done split.
        let rq = supabase.from('repairs').select('item_id, status');
        if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
          rq = rq.in('tenant_id', clientSheetIds);
        } else if (typeof clientSheetIds === 'string') {
          rq = rq.eq('tenant_id', clientSheetIds);
        }
        const { data: repairs } = await rq.range(0, 49999);
        if (repairs && !cancelled) {
          for (const r of repairs as { item_id: string | null; status: string | null }[]) {
            if (!r.item_id) continue;
            const done = REPAIR_DONE.has(r.status ?? '');
            if (done) { if (!repOpen.has(r.item_id)) repDone.add(r.item_id); }
            else { repOpen.add(r.item_id); repDone.delete(r.item_id); }
          }
        }

        // v2026-04-23 — Will Call indicators. will_calls.item_ids is jsonb
        // (array of item IDs on this WC). One WC may cover many items, so
        // we expand the array and stamp each item with the WC's status.
        // If an item appears on multiple WCs, Open wins over Done (operator
        // needs to know there's still an active pickup outstanding).
        let wq = supabase.from('will_calls').select('item_ids, status');
        if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
          wq = wq.in('tenant_id', clientSheetIds);
        } else if (typeof clientSheetIds === 'string') {
          wq = wq.eq('tenant_id', clientSheetIds);
        }
        const { data: wcs } = await wq.range(0, 49999);
        if (wcs && !cancelled) {
          for (const w of wcs as { item_ids: unknown; status: string | null }[]) {
            const status = w.status ?? '';
            const isOpen = WC_OPEN.has(status);
            const isDone = WC_DONE.has(status);
            if (!isOpen && !isDone) continue; // Cancelled / unknown → no badge
            const ids: string[] = Array.isArray(w.item_ids)
              ? (w.item_ids as unknown[]).map(x => String(x)).filter(Boolean)
              : [];
            for (const id of ids) {
              if (isOpen) {
                wcOpen.add(id);
                wcDone.delete(id); // open wins
              } else if (isDone && !wcOpen.has(id)) {
                wcDone.add(id);
              }
            }
          }
        }
      } catch { /* best-effort */ }

      if (!cancelled) {
        setData({
          inspOpenItems: inspOpen, inspDoneItems: inspDone,
          asmOpenItems: asmOpen, asmDoneItems: asmDone,
          repairOpenItems: repOpen, repairDoneItems: repDone,
          wcOpenItems: wcOpen, wcDoneItems: wcDone,
          loaded: true,
        });
      }
    })();

    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return data;
}
