import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { useUnifiedNotes, type UnifiedNote } from '@/hooks/useUnifiedNotes';

export interface ItemNote {
  id: string;
  item_id: string;
  note: string;
  note_type: 'internal' | 'public' | 'exception';
  visibility: string | null;
  parent_note_id: string | null;
  version: number;
  is_current: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  author?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  };
  replies?: ItemNote[];
}

function toItemNote(note: UnifiedNote, itemId?: string): ItemNote {
  return {
    id: note.id,
    item_id: itemId || note.source_entity_id,
    note: note.note,
    note_type: note.note_type,
    visibility: note.visibility,
    parent_note_id: note.parent_note_id,
    version: 1,
    is_current: true,
    created_by: note.created_by || '',
    created_at: note.created_at,
    updated_at: note.updated_at,
    author: note.author
      ? {
          id: note.author.id,
          first_name: note.author.first_name,
          last_name: note.author.last_name,
        }
      : undefined,
    replies: (note.replies || []).map((reply) => toItemNote(reply, itemId)),
  };
}

export function useItemNotes(itemId: string | undefined) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const {
    notes: unifiedNotes,
    loading,
    refetch,
    addNote: addUnifiedNote,
    updateNote: updateUnifiedNote,
    deleteNote: deleteUnifiedNote,
  } = useUnifiedNotes({
    entityType: 'item',
    entityId: itemId,
  });

  const notes = useMemo(() => unifiedNotes.map((note) => toItemNote(note, itemId)), [unifiedNotes, itemId]);

  const addNote = async (
    note: string,
    noteType: 'internal' | 'public' | 'exception',
    parentNoteId?: string
  ) => {
    if (!profile?.tenant_id || !profile?.id || !itemId) return null;

    try {
      const created = await addUnifiedNote(note, noteType, {
        parentNoteId: parentNoteId || null,
      });
      if (!created) return null;

      await (supabase as any)
        .from('item_notes')
        .upsert(
          {
            id: created.id,
            item_id: itemId,
            tenant_id: profile.tenant_id,
            note: created.note,
            note_type: created.note_type,
            visibility: created.visibility,
            parent_note_id: created.parent_note_id,
            version: 1,
            is_current: true,
            created_by: created.created_by || profile.id,
            created_at: created.created_at,
            updated_at: created.updated_at,
            deleted_at: created.deleted_at,
          },
          { onConflict: 'id' }
        );

      logItemActivity({
        tenantId: profile.tenant_id,
        itemId,
        actorUserId: profile.id,
        eventType: 'item_note_added',
        eventLabel: `${noteType === 'public' ? 'Public' : noteType === 'exception' ? 'Exception' : 'Internal'} note added`,
        details: { note_id: created.id, note_type: noteType, preview: note.substring(0, 100) },
      });

      return toItemNote(created, itemId);
    } catch (error) {
      console.error('[useItemNotes] Error adding note:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add note',
      });
      return null;
    }
  };

  const updateNote = async (noteId: string, newContent: string): Promise<boolean> => {
    if (!profile?.id || !profile?.tenant_id || !itemId) return false;

    const ok = await updateUnifiedNote(noteId, newContent);
    if (!ok) return false;

    await (supabase as any)
      .from('item_notes')
      .update({
        note: newContent.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', noteId);

    logItemActivity({
      tenantId: profile.tenant_id,
      itemId,
      actorUserId: profile.id,
      eventType: 'item_note_edited',
      eventLabel: 'Note edited',
      details: { note_id: noteId, preview: newContent.substring(0, 100) },
    });

    return true;
  };

  const deleteNote = async (noteId: string): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id || !itemId) return false;
    const ok = await deleteUnifiedNote(noteId);
    if (!ok) return false;

    await (supabase as any)
      .from('item_notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', noteId);

    logItemActivity({
      tenantId: profile.tenant_id,
      itemId,
      actorUserId: profile.id,
      eventType: 'item_note_deleted',
      eventLabel: 'Note deleted',
      details: { note_id: noteId },
    });

    return true;
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
