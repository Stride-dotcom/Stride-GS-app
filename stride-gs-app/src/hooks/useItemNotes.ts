/**
 * useItemNotes — batch-fetches recent collaborative notes per inventory
 * item, drawing from EVERY entity type that links back to an item via
 * `entity_notes.item_id`. Powers the Notes column in the Inventory table.
 *
 * Schema: `public.entity_notes.item_id` is a partial-indexed text column
 * populated whenever a note is filed against a row that has a known
 * inventory item — direct inventory notes (entity_type='inventory'), task
 * notes (entity_type='task'), repair notes (entity_type='repair'). One
 * batched query covers all three.
 *
 * Shipment + will-call notes don't carry item_id today (an entity-level
 * note covers many items), so they're not included; the broad-stroke
 * shipment context is already on the Shipment column.
 *
 * The cell shows the SINGLE most-recent note per item, prefixed with a
 * type tag — `[INSP] Damage on bottom-left leg`, `[REPAIR] Waiting for
 * parts`, `[NOTE] Client requested hold`. The hover tooltip shows the
 * top N notes across all entity types for that item, each on its own
 * line with the type tag and the note's date.
 *
 * For task notes specifically the type tag uses the task's service code
 * (INSP / ASM / RCVG / etc.) so a glance at the column tells you which
 * workflow generated the note. We pull the type alongside the notes via
 * a follow-up `tasks` query keyed by the unique task ids that show up.
 *
 * System notes (location moves, "✓ started", etc.) are filtered out —
 * they're noise for the column and tend to overwrite any user-written
 * note as "latest". Visibility=public is preserved so client-only views
 * stay scoped.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface ItemNoteEntry {
  /** Display tag rendered in brackets — `INSP`, `REPAIR`, `NOTE`, etc. */
  typeTag: string;
  /** Note body, raw — caller is responsible for truncation. */
  body: string;
  /** ISO timestamp of when the note was written. Used for tooltip date
   *  display + ordering. */
  createdAt: string;
}

export interface UseItemNotesResult {
  /** Convenience map: itemId → "[TAG] body" of the most-recent note.
   *  Missing key = no notes for that item. Mirrors the v1 hook's shape so
   *  callers that just rendered `notesByItemId[itemId]` continue to work. */
  notesByItemId: Record<string, string>;
  /** Full breakdown: itemId → ordered list of recent notes (most recent
   *  first) across every linked entity. Used to render the multi-line
   *  hover tooltip. Capped at 5 entries per item to keep tooltips compact. */
  notesDetailByItemId: Record<string, ItemNoteEntry[]>;
  loading: boolean;
  refetch: () => void;
}

const TOOLTIP_LIMIT_PER_ITEM = 5;
// PostgREST URLs cap around 8 KB; 150 IDs/batch keeps each chunk well
// under the limit even with the longest item-id strings.
const CHUNK_SIZE = 150;

interface NoteRow {
  entity_type: string;
  entity_id: string;
  item_id: string | null;
  body: string;
  created_at: string;
  is_system: boolean;
}

interface TaskTypeRow {
  task_id: string;
  type: string | null;
}

/** Map an entity_note row to the display tag used in the column.
 *
 *   inventory → 'NOTE'           (the legacy column behavior)
 *   task      → tasks.type when known (INSP / ASM / RCVG / …) else 'TASK'
 *   repair    → 'REPAIR'
 *   shipment  → 'SHIPMENT'       (shouldn't appear — no item_id today)
 *   will_call → 'WC'             (shouldn't appear — no item_id today)
 *   else      → entity_type uppercased
 */
function tagForNote(note: NoteRow, taskTypeMap: Map<string, string>): string {
  switch (note.entity_type) {
    case 'inventory': return 'NOTE';
    case 'task': {
      const t = taskTypeMap.get(note.entity_id);
      return t ? t.toUpperCase() : 'TASK';
    }
    case 'repair':    return 'REPAIR';
    case 'shipment':  return 'SHIPMENT';
    case 'will_call': return 'WC';
    default:          return note.entity_type.toUpperCase();
  }
}

/**
 * @param itemIds  list of inventory item_ids currently visible on screen.
 *                 Internally deduped + stabilised so callers don't have
 *                 to memoize.
 * @param enabled  pass `false` to suspend fetching (e.g., the table
 *                 hasn't populated yet). Defaults to `true`.
 */
export function useItemNotes(itemIds: string[], enabled = true): UseItemNotesResult {
  const [notesByItemId, setNotesByItemId] = useState<Record<string, string>>({});
  const [notesDetailByItemId, setNotesDetailByItemId] = useState<Record<string, ItemNoteEntry[]>>({});
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
      setNotesDetailByItemId({});
      return;
    }
    setLoading(true);

    // Step 1 — pull every visible-public, non-system note keyed by item_id.
    // The IN list is chunked so very large inventory views (Show All →
    // 2k+ rows) don't blow past PostgREST's URL length cap.
    const chunks: string[][] = [];
    for (let i = 0; i < stableIds.length; i += CHUNK_SIZE) {
      chunks.push(stableIds.slice(i, i + CHUNK_SIZE));
    }
    const noteResults = await Promise.all(chunks.map(ids =>
      supabase
        .from('entity_notes')
        .select('entity_type,entity_id,item_id,body,created_at,is_system')
        .in('item_id', ids)
        .eq('visibility', 'public')
        .eq('is_system', false)
        .order('created_at', { ascending: false })
    ));

    if (!mountedRef.current) { return; }

    const allNotes: NoteRow[] = [];
    for (const r of noteResults) {
      if (r.error || !r.data) continue;
      for (const row of r.data as NoteRow[]) allNotes.push(row);
    }

    // Step 2 — for every task entity_id we'll display, pull the task's
    // service code so the [TASK] tag becomes [INSP] / [ASM] / [RCVG] /
    // etc. One small batched query, also chunked to be safe.
    const taskIds = Array.from(new Set(
      allNotes
        .filter(n => n.entity_type === 'task' && n.entity_id)
        .map(n => n.entity_id),
    ));
    const taskTypeMap = new Map<string, string>();
    if (taskIds.length > 0) {
      const taskChunks: string[][] = [];
      for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
        taskChunks.push(taskIds.slice(i, i + CHUNK_SIZE));
      }
      const taskResults = await Promise.all(taskChunks.map(ids =>
        supabase
          .from('tasks')
          .select('task_id,type')
          .in('task_id', ids),
      ));
      for (const r of taskResults) {
        if (r.error || !r.data) continue;
        for (const row of r.data as TaskTypeRow[]) {
          if (row.task_id && row.type) taskTypeMap.set(row.task_id, row.type);
        }
      }
    }

    if (!mountedRef.current) return;

    // Step 3 — bucket by item_id, sort each bucket DESC by created_at,
    // cap at TOOLTIP_LIMIT_PER_ITEM, and build both output maps.
    const detailOut: Record<string, ItemNoteEntry[]> = {};
    for (const note of allNotes) {
      const itemId = note.item_id;
      if (!itemId) continue;
      const arr = detailOut[itemId] ?? (detailOut[itemId] = []);
      arr.push({
        typeTag: tagForNote(note, taskTypeMap),
        body: note.body,
        createdAt: note.created_at,
      });
    }

    const summaryOut: Record<string, string> = {};
    for (const itemId of Object.keys(detailOut)) {
      // Already DESC-by-created_at within each chunk; rows from different
      // chunks can interleave, so sort defensively here.
      detailOut[itemId].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      detailOut[itemId] = detailOut[itemId].slice(0, TOOLTIP_LIMIT_PER_ITEM);
      const top = detailOut[itemId][0];
      summaryOut[itemId] = `[${top.typeTag}] ${top.body}`;
    }

    setNotesByItemId(summaryOut);
    setNotesDetailByItemId(detailOut);
    setLoading(false);
  }, [enabled, stableIds]);

  useEffect(() => { void fetchNotes(); }, [fetchNotes]);

  // Live updates — debounced 400 ms so a bulk import doesn't fire 4k
  // refetches. We DON'T filter the realtime subscription by entity_type
  // anymore (the v1 hook scoped to entity_type='inventory'); now any
  // entity_notes change can affect the Notes column for an item, so we
  // listen on every change and let the debounced refetch sort it out.
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
        { event: '*', schema: 'public', table: 'entity_notes' },
        schedule,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, stableIds.length, fetchNotes]);

  return { notesByItemId, notesDetailByItemId, loading, refetch: fetchNotes };
}
