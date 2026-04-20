/**
 * useItemNotes — batch-fetches the latest public entity_note per item id,
 * returning a map of `{ [itemId]: body }`. Powers the Notes column in the
 * Inventory table so every visible row can show the freshest collaborative
 * note without triggering per-row queries.
 *
 * Why a batch hook instead of per-row subscriptions: the Inventory table
 * routinely renders 100+ rows. A Realtime channel per row or a per-row
 * SELECT would be prohibitively expensive. Instead we pull once for the
 * visible set and refetch on demand when a downstream write fires.
 *
 * Live updates: subscribes to a single `entity_notes` Realtime channel
 * scoped to `entity_type='inventory'` and refetches when rows mutate.
 * Debounced 400 ms so a burst of writes coalesces into one refresh.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface UseItemNotesResult {
  /** Map of itemId → latest public note body. Missing entries = no note. */
  notesByItemId: Record<string, string>;
  loading: boolean;
  refetch: () => void;
}

/**
 * @param itemIds  - list of inventory item_ids currently visible on screen.
 *                   The hook dedupes + stabilises the list internally so
 *                   callers don't need to memo it.
 * @param enabled  - pass `false` to suspend fetching (e.g., table not yet
 *                   populated). Defaults to `true`.
 */
export function useItemNotes(itemIds: string[], enabled = true): UseItemNotesResult {
  const [notesByItemId, setNotesByItemId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Stable, deduped signature — prevents refetch churn when the parent
  // rebuilds the array on every render.
  const signature = useMemo(() => {
    if (!itemIds.length) return '';
    const unique = Array.from(new Set(itemIds.filter(Boolean).map(String))).sort();
    return unique.join(',');
  }, [itemIds]);

  const stableIds = useMemo(() => signature ? signature.split(',') : [], [signature]);

  const fetchNotes = useCallback(async () => {
    if (!enabled || stableIds.length === 0) {
      setNotesByItemId({});
      return;
    }
    setLoading(true);
    // Fetch latest-first so the first row per entity_id wins. Supabase
    // postgrest has no `DISTINCT ON`; the client-side reduce is trivial
    // for the typical 100-200 row inventory view.
    const { data, error } = await supabase
      .from('entity_notes')
      .select('entity_id,body,created_at')
      .eq('entity_type', 'inventory')
      .eq('visibility', 'public')
      .in('entity_id', stableIds)
      .order('created_at', { ascending: false });

    if (!mountedRef.current) return;
    setLoading(false);
    if (error || !data) { setNotesByItemId({}); return; }

    const out: Record<string, string> = {};
    for (const row of data as Array<{ entity_id: string; body: string }>) {
      if (!out[row.entity_id]) out[row.entity_id] = row.body;
    }
    setNotesByItemId(out);
  }, [enabled, stableIds]);

  useEffect(() => { void fetchNotes(); }, [fetchNotes]);

  // Live updates — debounced 400 ms so a bulk import doesn't fire 4k
  // refetches. Scoped to entity_type='inventory' via the filter so
  // non-inventory note traffic doesn't wake this channel.
  useEffect(() => {
    if (!enabled || stableIds.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchNotes(); }, 400);
    };
    const channel = supabase
      .channel('entity_notes_inventory_column')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entity_notes', filter: 'entity_type=eq.inventory' },
        schedule,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, stableIds.length, fetchNotes]);

  return { notesByItemId, loading, refetch: fetchNotes };
}
