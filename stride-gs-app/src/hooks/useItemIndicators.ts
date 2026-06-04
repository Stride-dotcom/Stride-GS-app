/**
 * useItemIndicators — Lightweight Supabase query for I/A/R/W badges.
 * Returns open/done Sets of item IDs that have inspection tasks, assembly tasks, repairs,
 * or will calls.
 * Open = in-progress/active (orange badge). Done = completed (green badge).
 * Cancelled/declined items produce no badge entry.
 * Used by any page that shows an Item ID column to render (I), (A), (R), (W) badges.
 *
 * Query is tenant-scoped and cached per client filter. ~50ms from Supabase.
 *
 * Realtime: subscribes to entityEvents for task / repair / will_call writes
 * (which fire from useSupabaseRealtime + every explicit emit). Without this,
 * creating a will call / task / repair on one page didn't refresh the badges
 * on another open page until manual reload.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';

export interface ItemIndicators {
  /** INSP tasks that are open or in progress */
  inspOpenItems: Set<string>;
  /** INSP tasks that are completed */
  inspDoneItems: Set<string>;
  /** INSP tasks completed with result=Fail (red I, overrides done) */
  inspFailedItems: Set<string>;
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
  inspOpenItems: new Set(), inspDoneItems: new Set(), inspFailedItems: new Set(),
  asmOpenItems: new Set(), asmDoneItems: new Set(),
  repairOpenItems: new Set(), repairDoneItems: new Set(),
  wcOpenItems: new Set(), wcDoneItems: new Set(),
  loaded: false,
};

/** Task statuses that mean "done" for badge purposes. */
const TASK_DONE = new Set(['completed', 'Completed']);
/** Task statuses that should produce NO badge. Without this skip the loop's
 *  else-branch (status not in TASK_DONE → open) would paint Cancelled tasks
 *  orange, which contradicts the hook's docstring promise. */
const TASK_CANCELLED = new Set(['Cancelled', 'cancelled']);
/** Repair statuses that mean "done" for badge purposes. */
const REPAIR_DONE = new Set(['complete', 'Complete', 'completed', 'Completed']);
/** Repair statuses that should produce NO badge. Same fix as TASK_CANCELLED:
 *  the else-branch previously misclassified Cancelled repairs as open. */
const REPAIR_CANCELLED = new Set(['Cancelled', 'cancelled']);
/** v2026-04-23 — Will Call statuses that mean "done" (item released) → green W. */
const WC_DONE = new Set(['Released', 'released']);
/** v2026-04-23 — Will Call statuses that mean "open/in-progress" → orange W.
 *  Cancelled yields no badge (callers should exclude). */
const WC_OPEN = new Set(['Pending', 'Scheduled', 'Partial', 'pending', 'scheduled', 'partial']);

export function useItemIndicators(clientSheetIds?: string | string[]): ItemIndicators {
  const [data, setData] = useState<ItemIndicators>(EMPTY);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const key = useMemo(() => {
    if (!clientSheetIds) return '';
    return Array.isArray(clientSheetIds) ? clientSheetIds.slice().sort().join(',') : clientSheetIds;
  }, [clientSheetIds]);

  // Fetch is hoisted out of the effect so the realtime subscription below can
  // reuse it on every entityEvents echo. Prior version had this inline plus a
  // `data.loaded` early-return guard that prevented refetching the SAME key
  // even when the underlying tasks / repairs / will_calls data had changed —
  // i.e. creating a new will call left the badges stale until reload.
  const fetchIndicators = useCallback(async () => {
    if (!key) { setData(EMPTY); return; }
    cancelRef.current?.cancelled && (cancelRef.current.cancelled = true);
    const ctx = { cancelled: false };
    cancelRef.current = ctx;

    const inspOpen = new Set<string>();
    const inspDone = new Set<string>();
    const inspFailed = new Set<string>();
    const asmOpen = new Set<string>();
    const asmDone = new Set<string>();
    const repOpen = new Set<string>();
    const repDone = new Set<string>();
    const wcOpen = new Set<string>();
    const wcDone = new Set<string>();

    try {
      // Fetch task indicators (INSP + ASM) with status for open/done split.
      let tq = supabase.from('tasks').select('item_id, type, status, result');
      if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
        tq = tq.in('tenant_id', clientSheetIds);
      } else if (typeof clientSheetIds === 'string') {
        tq = tq.eq('tenant_id', clientSheetIds);
      }
      const { data: tasks } = await tq.range(0, 49999);
      if (tasks && !ctx.cancelled) {
        for (const t of tasks as { item_id: string | null; type: string | null; status: string | null; result: string | null }[]) {
          if (!t.item_id) continue;
          if (TASK_CANCELLED.has(t.status ?? '')) continue; // no badge for cancelled tasks
          const done = TASK_DONE.has(t.status ?? '');
          const code = (t.type || '').toUpperCase();
          if (code === 'INSP' || code === 'INSPECTION') {
            const failed = done && (t.result ?? '').toLowerCase() === 'fail';
            if (failed) { inspFailed.add(t.item_id); }
            if (done) { if (!inspOpen.has(t.item_id)) inspDone.add(t.item_id); }
            else { inspOpen.add(t.item_id); inspDone.delete(t.item_id); }
          } else if (code === 'ASM' || code === 'ASSEMBLY') {
            if (done) { if (!asmOpen.has(t.item_id)) asmDone.add(t.item_id); }
            else { asmOpen.add(t.item_id); asmDone.delete(t.item_id); }
          }
        }
      }

      // Fetch repair indicators with status for open/done split.
      // A repair can carry MANY items (repair_items join table, mirroring
      // will_calls/will_call_items). The repairs row only holds the primary
      // item_id, so stamping just that one left every other item on a batch
      // repair badge-less. We build repair_id → status here, then expand
      // repair_items below so EVERY linked item gets the R badge.
      const repairStatusById = new Map<string, string>(); // repair_id → status
      const stampRepair = (itemId: string, status: string) => {
        if (REPAIR_CANCELLED.has(status)) return; // no badge for cancelled repairs
        const done = REPAIR_DONE.has(status);
        if (done) { if (!repOpen.has(itemId)) repDone.add(itemId); }
        else { repOpen.add(itemId); repDone.delete(itemId); } // open wins over done
      };
      let rq = supabase.from('repairs').select('repair_id, item_id, status');
      if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
        rq = rq.in('tenant_id', clientSheetIds);
      } else if (typeof clientSheetIds === 'string') {
        rq = rq.eq('tenant_id', clientSheetIds);
      }
      const { data: repairs } = await rq.range(0, 49999);
      if (repairs && !ctx.cancelled) {
        for (const r of repairs as { repair_id: string | null; item_id: string | null; status: string | null }[]) {
          const status = r.status ?? '';
          if (r.repair_id) repairStatusById.set(r.repair_id, status);
          // Legacy single-item stamp — keeps the primary item badged even if
          // a repair has no repair_items rows yet (deploy-order independent).
          if (r.item_id) stampRepair(r.item_id, status);
        }
      }

      // Expand the repair_items join so every item on a batch repair — not
      // just the primary — gets the R badge. item_result/qty are ignored:
      // badge state follows the PARENT repair status (informational per-item
      // result doesn't change whether there's an active repair on the item).
      let riq = supabase.from('repair_items').select('repair_id, item_id');
      if (Array.isArray(clientSheetIds) && clientSheetIds.length > 0) {
        riq = riq.in('tenant_id', clientSheetIds);
      } else if (typeof clientSheetIds === 'string') {
        riq = riq.eq('tenant_id', clientSheetIds);
      }
      const { data: repairItems } = await riq.range(0, 49999);
      if (repairItems && !ctx.cancelled) {
        for (const ri of repairItems as { repair_id: string | null; item_id: string | null }[]) {
          if (!ri.item_id || !ri.repair_id) continue;
          const status = repairStatusById.get(ri.repair_id);
          if (status === undefined) continue; // orphan / parent not in this tenant scope
          stampRepair(ri.item_id, status);
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
      if (wcs && !ctx.cancelled) {
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

    if (!ctx.cancelled) {
      setData({
        inspOpenItems: inspOpen, inspDoneItems: inspDone, inspFailedItems: inspFailed,
        asmOpenItems: asmOpen, asmDoneItems: asmDone,
        repairOpenItems: repOpen, repairDoneItems: repDone,
        wcOpenItems: wcOpen, wcDoneItems: wcDone,
        loaded: true,
      });
    }
  // clientSheetIds changes between renders (array identity) but `key` is the
  // stable JOIN'd form — depend on it instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Initial fetch on key change.
  useEffect(() => {
    void fetchIndicators();
    return () => {
      if (cancelRef.current) cancelRef.current.cancelled = true;
    };
  }, [fetchIndicators]);

  // Realtime — refetch whenever any task / repair / will_call changes. The
  // central useSupabaseRealtime channel emits these on every Supabase write,
  // and explicit emits from the create modals fire a tick after the GAS
  // round-trip lands. Either way, badges update without a manual refresh.
  useEffect(() => {
    if (!key) return;
    return entityEvents.subscribe((type) => {
      if (type === 'task' || type === 'repair' || type === 'will_call') {
        void fetchIndicators();
      }
    });
  }, [key, fetchIndicators]);

  return data;
}
