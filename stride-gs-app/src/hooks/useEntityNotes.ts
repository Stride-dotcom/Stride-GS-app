/**
 * useEntityNotes — Supabase CRUD for public.entity_notes.
 *
 * Ported from the Stride WMS app. Notes attach to any entity in the system
 * (inventory items, tasks, repairs, will calls, shipments, claims, orders)
 * and render via <NotesSection entityType= entityId= />.
 *
 * Expected schema (migration lands in a follow-up session — this hook is
 * written against the inferred columns so it compiles now):
 *
 *   CREATE TABLE public.entity_notes (
 *     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     entity_type  text NOT NULL,
 *     entity_id    text NOT NULL,
 *     body         text NOT NULL,
 *     visibility   text NOT NULL DEFAULT 'public'
 *                    CHECK (visibility IN ('public','staff_only','internal')),
 *     mentions     text[] DEFAULT '{}',       -- array of emails @-mentioned
 *     is_system    boolean NOT NULL DEFAULT false,
 *     author_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 *     author_name  text,
 *     author_role  text,                      -- 'admin' | 'staff' | 'client'
 *     created_at   timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX idx_entity_notes_entity ON public.entity_notes (entity_type, entity_id, created_at DESC);
 *
 * RLS (expected):
 *   - SELECT: admin/staff read all; client reads only visibility='public'
 *     on entities they own.
 *   - INSERT: any authenticated.
 *   - DELETE: admin only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Visibility values (session 73 follow-up):
 *   - 'public'   — everyone with access to the entity can see it
 *   - 'internal' — admin/staff only (enforced by RLS entity_notes_select_client)
 *
 * A previous `staff_only` tier existed but was collapsed into `internal`
 * since RLS already hid both from clients. The migration
 * 20260420020337_entity_notes_drop_staff_only tightened the CHECK
 * constraint accordingly.
 */
export type NoteVisibility = 'public' | 'internal';

export interface EntityNote {
  id: string;
  entityType: string;
  entityId: string;
  /** v2026-04-22: item_id anchor for cross-entity rollup. NULL for container
   *  entities (will_call, shipment) and claim notes. */
  itemId: string | null;
  body: string;
  visibility: NoteVisibility;
  mentions: string[];
  isSystem: boolean;
  authorId: string | null;
  authorName: string;
  authorRole: 'admin' | 'staff' | 'client' | null;
  createdAt: string;
}

interface NoteRow {
  id: string;
  entity_type: string;
  entity_id: string;
  item_id: string | null;
  body: string;
  visibility: string | null;
  mentions: string[] | null;
  is_system: boolean | null;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  created_at: string;
}

function rowToNote(r: NoteRow): EntityNote {
  // Legacy rows with 'staff_only' get bucketed as 'internal' for the UI,
  // matching the server-side migration. The DB CHECK constraint now
  // only permits 'public' | 'internal', but we're defensive on read.
  const v = r.visibility === 'internal' || r.visibility === 'staff_only' ? 'internal' : 'public';
  const role = r.author_role === 'admin' || r.author_role === 'staff' || r.author_role === 'client'
    ? r.author_role
    : null;
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    itemId: r.item_id ?? null,
    body: r.body,
    visibility: v as NoteVisibility,
    mentions: Array.isArray(r.mentions) ? r.mentions : [],
    isSystem: !!r.is_system,
    authorId: r.author_id,
    authorName: r.author_name ?? '',
    authorRole: role,
    createdAt: r.created_at,
  };
}

export interface UseEntityNotesResult {
  notes: EntityNote[];
  loading: boolean;
  error: string | null;
  addNote: (body: string, visibility?: NoteVisibility, mentions?: string[]) => Promise<EntityNote | null>;
  deleteNote: (noteId: string) => Promise<boolean>;
  refetch: () => Promise<void>;
}

/**
 * v2026-04-22 — optional `itemId` param gets stamped on every insert so
 * the cross-entity rollup (useEntityNotesRollup) can find this note.
 * - For entity_type='inventory', itemId defaults to entityId (same thing).
 * - For task/repair panels, caller passes the parent item_id.
 * - For will_call/shipment/claim (container or out-of-scope), pass undefined
 *   (or null) and the insert stamps NULL — correct for container semantics.
 */
export function useEntityNotes(entityType: string, entityId: string, itemId?: string | null): UseEntityNotesResult {
  const { user } = useAuth();
  const [notes, setNotes] = useState<EntityNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(entityType && entityId);

  const refetch = useCallback(async () => {
    if (!enabled) { setNotes([]); setLoading(false); return; }
    setError(null);
    const { data, error: err } = await supabase
      .from('entity_notes')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setNotes(((data ?? []) as NoteRow[]).map(rowToNote));
    setLoading(false);
  }, [enabled, entityType, entityId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime — any INSERT/DELETE on this entity's notes triggers a refetch.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`entity_notes:${entityType}:${entityId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entity_notes', filter: `entity_id=eq.${entityId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, entityType, entityId, refetch]);

  const addNote = useCallback(async (
    body: string,
    visibility: NoteVisibility = 'public',
    mentions: string[] = [],
  ): Promise<EntityNote | null> => {
    const trimmed = body.trim();
    if (!trimmed) return null;
    const session = await supabase.auth.getSession();
    const authUserId = session.data.session?.user.id ?? null;

    // v2026-04-22 — stamp item_id so cross-entity rollup can find this note.
    // Rules (must stay aligned with the 20260422000000 migration backfill):
    //   entity_type='inventory' → item_id = entity_id
    //   entity_type in (task|repair) → item_id = caller-provided itemId
    //   entity_type in (will_call|shipment|claim) → NULL (container / OOS)
    let stampedItemId: string | null;
    if (entityType === 'inventory') {
      stampedItemId = entityId;
    } else if (entityType === 'task' || entityType === 'repair') {
      stampedItemId = itemId ?? null;
    } else {
      stampedItemId = null;
    }

    const { data, error: err } = await supabase
      .from('entity_notes')
      .insert({
        // tenant_id: explicit so the row satisfies the tenant scoping RLS
        // policy even before the column's DEFAULT trigger (if any) runs.
        // Falls to null for admin/staff without a bound client — migration
        // 2026-04-21 dropped the NOT NULL constraint.
        tenant_id: user?.clientSheetId ?? null,
        entity_type: entityType,
        entity_id: entityId,
        item_id: stampedItemId,
        body: trimmed,
        visibility,
        mentions,
        is_system: false,
        author_id: authUserId,
        author_name: user?.displayName ?? user?.email ?? 'Unknown',
        author_role: user?.role ?? null,
      })
      .select('*')
      .single();
    if (err || !data) {
      setError(err?.message ?? 'Failed to add note');
      return null;
    }
    const note = rowToNote(data as NoteRow);
    setNotes(prev => [note, ...prev]);
    return note;
  }, [entityType, entityId, user]);

  const deleteNote = useCallback(async (noteId: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('entity_notes')
      .delete()
      .eq('id', noteId);
    if (err) {
      setError(err.message);
      return false;
    }
    setNotes(prev => prev.filter(n => n.id !== noteId));
    return true;
  }, []);

  return useMemo(() => ({
    notes,
    loading,
    error,
    addNote,
    deleteNote,
    refetch,
  }), [notes, loading, error, addNote, deleteNote, refetch]);
}

// ─── Rollup hook ────────────────────────────────────────────────────────────

export interface UseEntityNotesRollupResult {
  notes: EntityNote[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * v2026-04-22 — Returns every entity_notes row where item_id = itemId,
 * regardless of entity_type. Read-only; writes still go through the
 * entity-scoped useEntityNotes hook.
 *
 * Used by detail panels' Notes tab to show the Item's inventory notes
 * PLUS the linked Task / Repair notes in a single list, filtered by
 * sub-tabs (see EntitySourceTabs). Mirrors the usePhotos({ itemId })
 * rollup pattern.
 */
export function useEntityNotesRollup(itemId: string | null | undefined): UseEntityNotesRollupResult {
  const [notes, setNotes] = useState<EntityNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(itemId);

  const refetch = useCallback(async () => {
    if (!enabled) { setNotes([]); setLoading(false); return; }
    setError(null);
    const { data, error: err } = await supabase
      .from('entity_notes')
      .select('*')
      .eq('item_id', itemId!)
      .order('created_at', { ascending: false })
      .limit(500);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setNotes(((data ?? []) as NoteRow[]).map(rowToNote));
    setLoading(false);
  }, [enabled, itemId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime — any change on entity_notes rows for this item_id triggers
  // a refetch. Filter uses item_id so inserts from linked Tasks/Repairs
  // against the same item propagate in ~1-2s.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`entity_notes_rollup:${itemId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entity_notes', filter: `item_id=eq.${itemId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, itemId, refetch]);

  return useMemo(() => ({ notes, loading, error, refetch }), [notes, loading, error, refetch]);
}
