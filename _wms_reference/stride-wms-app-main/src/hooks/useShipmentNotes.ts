import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useUnifiedNotes, type UnifiedNote } from '@/hooks/useUnifiedNotes';

export type ShipmentNoteType = 'internal' | 'public' | 'exception';

export interface ShipmentNote {
  id: string;
  shipment_id: string | null;
  tenant_id: string | null;
  note: string;
  note_type: ShipmentNoteType;
  visibility: string | null;
  parent_note_id: string | null;
  exception_code: string | null;
  is_chip_generated: boolean | null;
  version: number | null;
  is_current: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  author?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  };
  replies?: ShipmentNote[];
}

function toShipmentNote(note: UnifiedNote): ShipmentNote {
  const exceptionCode =
    (note.metadata?.exception_code as string | undefined) ||
    (note.metadata?.legacy_exception_code as string | undefined) ||
    null;
  const chipGenerated =
    (note.metadata?.is_chip_generated as boolean | undefined) ??
    (note.metadata?.legacy_is_chip_generated as boolean | undefined) ??
    null;

  return {
    id: note.id,
    shipment_id: note.source_entity_type === 'shipment' ? note.source_entity_id : null,
    tenant_id: note.tenant_id,
    note: note.note,
    note_type: note.note_type,
    visibility: note.visibility,
    parent_note_id: note.parent_note_id,
    exception_code: exceptionCode,
    is_chip_generated: chipGenerated,
    version: 1,
    is_current: true,
    created_by: note.created_by,
    created_at: note.created_at,
    updated_at: note.updated_at,
    deleted_at: note.deleted_at,
    author: note.author
      ? {
          id: note.author.id,
          first_name: note.author.first_name,
          last_name: note.author.last_name,
        }
      : undefined,
    replies: (note.replies || []).map(toShipmentNote),
  };
}

export function useShipmentNotes(shipmentId: string | undefined) {
  const { profile } = useAuth();
  const {
    notes: unifiedNotes,
    loading,
    refetch,
    addNote: addUnifiedNote,
    updateNote: updateUnifiedNote,
    deleteNote: deleteUnifiedNote,
  } = useUnifiedNotes({
    entityType: 'shipment',
    entityId: shipmentId,
  });

  const notes = useMemo(() => unifiedNotes.map(toShipmentNote), [unifiedNotes]);

  const addNote = async (
    note: string,
    noteType: ShipmentNoteType,
    options?: { parentNoteId?: string; exceptionCode?: string | null }
  ) => {
    if (!profile?.tenant_id || !shipmentId || !profile?.id) return null;

    const trimmed = note.trim();
    if (!trimmed) return null;

    try {
      const metadata =
        noteType === 'exception'
          ? { exception_code: options?.exceptionCode || null }
          : {};

      const created = await addUnifiedNote(trimmed, noteType, {
        parentNoteId: options?.parentNoteId || null,
        metadata,
      });
      if (!created) return null;

      // Keep legacy shipment_notes synchronized for dependent workflows.
      const legacyPayload = {
        id: created.id,
        tenant_id: profile.tenant_id,
        shipment_id: shipmentId,
        parent_note_id: created.parent_note_id,
        note: created.note,
        note_type: created.note_type,
        visibility: created.visibility,
        exception_code:
          (created.metadata?.exception_code as string | undefined) ||
          (created.metadata?.legacy_exception_code as string | undefined) ||
          null,
        is_chip_generated:
          (created.metadata?.is_chip_generated as boolean | undefined) ??
          (created.metadata?.legacy_is_chip_generated as boolean | undefined) ??
          false,
        created_by: created.created_by || profile.id,
        created_at: created.created_at,
        updated_at: created.updated_at,
        deleted_at: created.deleted_at,
      };

      await (supabase as any).from('shipment_notes').upsert(legacyPayload, { onConflict: 'id' });
      return toShipmentNote(created);
    } catch (error) {
      console.error('[useShipmentNotes] Error adding shipment note:', error);
      return null;
    }
  };

  const updateNote = async (noteId: string, nextText: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;
    const ok = await updateUnifiedNote(noteId, nextText);
    if (!ok) return false;

    await (supabase as any)
      .from('shipment_notes')
      .update({
        note: nextText.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', noteId);

    return true;
  };

  const deleteNote = async (noteId: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;
    try {
      const deleted = await deleteUnifiedNote(noteId);
      if (!deleted) return false;

      await (supabase as any)
        .from('shipment_notes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', noteId);

      return true;
    } catch (error) {
      console.error('[useShipmentNotes] Error deleting shipment note:', error);
      return false;
    }
  };

  return {
    notes,
    loading,
    refetch,
    addNote,
    updateNote,
    deleteNote,
  };
}

