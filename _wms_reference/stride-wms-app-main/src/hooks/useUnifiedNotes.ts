import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  buildUnifiedEntityRoute,
  getUnifiedEntityLabel,
  type UnifiedNoteEntityType,
  type UnifiedNoteType,
} from '@/lib/notes/entityMeta';
import { extractMentionUsernames } from '@/lib/notes/mentions';

interface UnifiedNoteAuthor {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  username?: string | null;
}

export interface UnifiedNoteLink {
  note_id: string;
  entity_type: string;
  entity_id: string;
  entity_number: string | null;
  link_kind: 'source' | 'related' | string;
}

export interface UnifiedNote {
  id: string;
  tenant_id: string;
  note: string;
  note_type: UnifiedNoteType;
  visibility: 'internal' | 'public';
  parent_note_id: string | null;
  root_note_id: string | null;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_number: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  edited_by: string | null;
  edited_at: string | null;
  deleted_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  author?: UnifiedNoteAuthor;
  links?: UnifiedNoteLink[];
  sourceLink?: UnifiedNoteLink | null;
  isSourceContext?: boolean;
  replies?: UnifiedNote[];
}

export interface MentionableUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
}

interface AddUnifiedNoteOptions {
  parentNoteId?: string | null;
  sourceEntityNumber?: string | null;
  metadata?: Record<string, unknown> | null;
  mentionedUserIds?: string[];
}

interface UseUnifiedNotesParams {
  entityType: UnifiedNoteEntityType | string;
  entityId?: string;
  isClientUser?: boolean;
}

function sortReplies(note: UnifiedNote): void {
  if (!note.replies || note.replies.length === 0) return;
  note.replies.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  note.replies.forEach(sortReplies);
}

function threadLatestActivity(note: UnifiedNote): number {
  let latest = new Date(note.updated_at || note.created_at).getTime();
  for (const reply of note.replies || []) {
    latest = Math.max(latest, threadLatestActivity(reply));
  }
  return latest;
}

export function useUnifiedNotes({
  entityType,
  entityId,
  isClientUser = false,
}: UseUnifiedNotesParams) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [notes, setNotes] = useState<UnifiedNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [mentionableUsers, setMentionableUsers] = useState<MentionableUser[]>([]);

  const mentionableByUsername = useMemo(() => {
    const map = new Map<string, MentionableUser>();
    for (const user of mentionableUsers) {
      map.set(user.username.toLowerCase(), user);
    }
    return map;
  }, [mentionableUsers]);

  const mentionableById = useMemo(() => {
    const map = new Map<string, MentionableUser>();
    for (const user of mentionableUsers) {
      map.set(user.id, user);
    }
    return map;
  }, [mentionableUsers]);

  const resolveMentionUserIds = useCallback(
    (noteText: string): string[] => {
      const usernames = extractMentionUsernames(noteText);
      const ids = new Set<string>();
      for (const username of usernames) {
        const user = mentionableByUsername.get(username);
        if (user) ids.add(user.id);
      }
      return Array.from(ids);
    },
    [mentionableByUsername]
  );

  const fetchMentionableUsers = useCallback(async () => {
    if (!profile?.tenant_id || isClientUser) {
      setMentionableUsers([]);
      return;
    }

    try {
      const { data: usersData, error: usersError } = await (supabase as any)
        .from('users')
        .select('id, first_name, last_name, email, username, status')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null);

      if (usersError) throw usersError;

      const { data: roleRows, error: rolesError } = await (supabase as any)
        .from('user_roles')
        .select('user_id, roles(name)')
        .is('deleted_at', null);

      if (rolesError) throw rolesError;

      const roleMap = new Map<string, Set<string>>();
      for (const row of (roleRows || []) as Array<{ user_id: string; roles?: { name?: string } | null }>) {
        if (!row.user_id) continue;
        const roleName = (row.roles?.name || '').toLowerCase();
        if (!roleName) continue;
        if (!roleMap.has(row.user_id)) roleMap.set(row.user_id, new Set<string>());
        roleMap.get(row.user_id)?.add(roleName);
      }

      const staffUsers: MentionableUser[] = ((usersData || []) as Array<any>)
        .filter((u) => {
          const status = (u.status || '').toLowerCase();
          if (status === 'inactive' || status === 'suspended') return false;
          const roles = roleMap.get(u.id) || new Set<string>();
          if (roles.size === 0) return false;
          return Array.from(roles).some((roleName) => roleName !== 'client_user');
        })
        .map((u) => {
          const fallback = `${u.first_name || ''}_${u.last_name || ''}`
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '') || `user_${String(u.id).slice(0, 6)}`;
          return {
            id: u.id,
            firstName: u.first_name || '',
            lastName: u.last_name || '',
            email: u.email || '',
            username: (u.username || fallback).toLowerCase(),
          };
        })
        .sort((a, b) => a.username.localeCompare(b.username));

      setMentionableUsers(staffUsers);
    } catch (error) {
      console.error('[useUnifiedNotes] Failed to load mentionable users:', error);
      setMentionableUsers([]);
    }
  }, [profile?.tenant_id, isClientUser]);

  const fetchNotes = useCallback(async () => {
    if (!entityId) return;
    try {
      setLoading(true);
      const { data: linkRows, error: linkError } = await (supabase as any)
        .from('note_entity_links')
        .select('note_id, entity_type, entity_id, entity_number, link_kind, notes(*)')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false });

      if (linkError) throw linkError;

      const noteById = new Map<string, UnifiedNote>();
      for (const row of (linkRows || []) as Array<any>) {
        const note = row.notes as UnifiedNote | null;
        if (!note || !note.id) continue;
        if (note.deleted_at) continue;
        if (isClientUser && note.visibility !== 'public') continue;
        if (!noteById.has(note.id)) {
          noteById.set(note.id, {
            ...note,
            metadata:
              note.metadata && typeof note.metadata === 'object'
                ? (note.metadata as Record<string, unknown>)
                : null,
            replies: [],
          });
        }
      }

      const allNotes = Array.from(noteById.values());
      if (allNotes.length === 0) {
        setNotes([]);
        return;
      }

      const noteIds = allNotes.map((n) => n.id);
      const { data: allLinksData } = await (supabase as any)
        .from('note_entity_links')
        .select('note_id, entity_type, entity_id, entity_number, link_kind')
        .in('note_id', noteIds);

      const creatorIds = new Set<string>();
      for (const note of allNotes) {
        if (note.created_by) creatorIds.add(note.created_by);
      }

      const authorMap = new Map<string, UnifiedNoteAuthor>();
      if (creatorIds.size > 0) {
        const { data: authorsData } = await (supabase as any)
          .from('users')
          .select('id, first_name, last_name, email, username')
          .in('id', Array.from(creatorIds));
        for (const author of (authorsData || []) as UnifiedNoteAuthor[]) {
          authorMap.set(author.id, author);
        }
      }

      const linksByNote = new Map<string, UnifiedNoteLink[]>();
      for (const link of (allLinksData || []) as UnifiedNoteLink[]) {
        if (!linksByNote.has(link.note_id)) linksByNote.set(link.note_id, []);
        linksByNote.get(link.note_id)?.push(link);
      }

      const hydrated = allNotes.map((note) => {
        const links = linksByNote.get(note.id) || [];
        const sourceLink = links.find((link) => link.link_kind === 'source') || null;
        const sourceMatchesContext =
          sourceLink?.entity_type === entityType && sourceLink?.entity_id === entityId;
        return {
          ...note,
          author: note.created_by ? authorMap.get(note.created_by) : undefined,
          links,
          sourceLink,
          isSourceContext: sourceMatchesContext,
          replies: [],
        };
      });

      const noteMap = new Map<string, UnifiedNote>(hydrated.map((n) => [n.id, n]));
      const roots: UnifiedNote[] = [];
      for (const note of hydrated) {
        if (note.parent_note_id && noteMap.has(note.parent_note_id)) {
          noteMap.get(note.parent_note_id)?.replies?.push(note);
        } else {
          roots.push(note);
        }
      }

      roots.forEach(sortReplies);
      roots.sort((a, b) => threadLatestActivity(b) - threadLatestActivity(a));
      setNotes(roots);
    } catch (error) {
      console.error('[useUnifiedNotes] Failed to fetch notes:', error);
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, isClientUser]);

  const sendMentionMessages = useCallback(
    async (createdNote: UnifiedNote, mentionedUserIds: string[]) => {
      if (!profile?.id || !profile?.tenant_id) return;
      if (createdNote.note_type !== 'internal') return;

      const recipients = Array.from(
        new Set((mentionedUserIds || []).filter((id) => id && id !== profile.id))
      );
      if (recipients.length === 0) return;

      const noteRootId = createdNote.root_note_id || createdNote.id;
      const entityLabel = getUnifiedEntityLabel(createdNote.source_entity_type);
      const entityNumber = createdNote.source_entity_number || createdNote.source_entity_id;
      const entityRoute = buildUnifiedEntityRoute(
        createdNote.source_entity_type,
        createdNote.source_entity_id,
        createdNote.source_entity_number
      );
      const preview = createdNote.note.length > 600
        ? `${createdNote.note.slice(0, 600)}...`
        : createdNote.note;

      const mentionRows = recipients.map((recipientId) => ({
        tenant_id: profile.tenant_id,
        note_id: createdNote.id,
        mentioned_user_id: recipientId,
        mention_username: mentionableById.get(recipientId)?.username || 'unknown',
        created_by: profile.id,
      }));
      if (mentionRows.length > 0) {
        await (supabase as any)
          .from('note_mentions')
          .upsert(mentionRows, { onConflict: 'note_id,mentioned_user_id' });
      }

      for (const recipientId of recipients) {
        const participantKey = [profile.id, recipientId].sort().join(':');
        const threadKey = `note:${noteRootId}:${participantKey}`;
        const subject = `Mention in ${entityLabel} ${entityNumber}`;
        const body = `You were mentioned in ${entityLabel} ${entityNumber}.\n\n${preview}${
          entityRoute ? `\n\nOpen: ${entityRoute}` : ''
        }`;

        const metadata = {
          source: 'note_mention',
          thread_key: threadKey,
          note_id: createdNote.id,
          note_thread_root_id: noteRootId,
          note_reply_parent_id: createdNote.id,
          note_type: createdNote.note_type,
          entity_number: entityNumber,
          source_entity_type: createdNote.source_entity_type,
          source_entity_id: createdNote.source_entity_id,
          action_path: entityRoute || null,
        };

        try {
          const { data: message, error: messageError } = await (supabase as any)
            .from('messages')
            .insert({
              tenant_id: profile.tenant_id,
              sender_id: profile.id,
              subject,
              body,
              message_type: 'message',
              priority: 'normal',
              related_entity_type: createdNote.source_entity_type,
              related_entity_id: createdNote.source_entity_id,
              metadata,
            })
            .select('id')
            .single();

          if (!messageError && message?.id) {
            await (supabase as any).from('message_recipients').insert({
              message_id: message.id,
              recipient_type: 'user',
              recipient_id: recipientId,
              user_id: recipientId,
            });
          }

          await (supabase as any).from('in_app_notifications').insert({
            tenant_id: profile.tenant_id,
            user_id: recipientId,
            title: `Mentioned in ${entityLabel} ${entityNumber}`,
            body: preview,
            category: 'message',
            icon: 'alternate_email',
            priority: 'normal',
            related_entity_type: createdNote.source_entity_type,
            related_entity_id: createdNote.source_entity_id,
            action_url: entityRoute || null,
          });
        } catch (err) {
          console.warn('[useUnifiedNotes] Failed to send mention notification:', err);
        }
      }
    },
    [mentionableById, profile?.id, profile?.tenant_id]
  );

  const addNote = useCallback(
    async (
      noteText: string,
      noteType: UnifiedNoteType,
      options?: AddUnifiedNoteOptions
    ): Promise<UnifiedNote | null> => {
      if (!entityId) return null;
      const trimmed = noteText.trim();
      if (!trimmed) return null;

      try {
        const { data: noteId, error } = await (supabase as any).rpc('create_unified_note', {
          p_entity_type: entityType,
          p_entity_id: entityId,
          p_note_text: trimmed,
          p_note_type: noteType,
          p_parent_note_id: options?.parentNoteId || null,
          p_source_entity_number: options?.sourceEntityNumber || null,
          p_metadata: options?.metadata || {},
        });

        if (error) throw error;
        if (!noteId) throw new Error('Missing note id from create_unified_note');

        const { data: createdRow, error: createdError } = await (supabase as any)
          .from('notes')
          .select('*')
          .eq('id', noteId)
          .single();
        if (createdError) throw createdError;

        const created = createdRow as UnifiedNote;
        if (options?.mentionedUserIds?.length && created.note_type === 'internal') {
          await sendMentionMessages(created, options.mentionedUserIds);
        }

        await fetchNotes();
        return created;
      } catch (error) {
        console.error('[useUnifiedNotes] Failed to add note:', error);
        const errorMessage =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message || '')
            : '';
        toast({
          variant: 'destructive',
          title: 'Error',
          description: errorMessage || 'Failed to add note',
        });
        return null;
      }
    },
    [entityId, entityType, fetchNotes, sendMentionMessages, toast]
  );

  const updateNote = useCallback(
    async (noteId: string, nextText: string): Promise<boolean> => {
      const trimmed = nextText.trim();
      if (!trimmed) return false;
      try {
        const { data, error } = await (supabase as any).rpc('update_unified_note', {
          p_note_id: noteId,
          p_note_text: trimmed,
        });
        if (error) throw error;
        if (data !== true) return false;
        await fetchNotes();
        return true;
      } catch (error) {
        console.error('[useUnifiedNotes] Failed to update note:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to update note',
        });
        return false;
      }
    },
    [fetchNotes, toast]
  );

  const deleteNote = useCallback(
    async (noteId: string): Promise<boolean> => {
      try {
        const { data, error } = await (supabase as any).rpc('soft_delete_unified_note', {
          p_note_id: noteId,
        });
        if (error) throw error;
        if (data !== true) return false;
        await fetchNotes();
        return true;
      } catch (error) {
        console.error('[useUnifiedNotes] Failed to delete note:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to delete note',
        });
        return false;
      }
    },
    [fetchNotes, toast]
  );

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    fetchMentionableUsers();
  }, [fetchMentionableUsers]);

  const flattenedNotes = useMemo(() => {
    const out: UnifiedNote[] = [];
    const walk = (note: UnifiedNote) => {
      out.push(note);
      for (const reply of note.replies || []) walk(reply);
    };
    notes.forEach(walk);
    return out;
  }, [notes]);

  return {
    notes,
    flattenedNotes,
    loading,
    mentionableUsers,
    resolveMentionUserIds,
    refetch: fetchNotes,
    addNote,
    updateNote,
    deleteNote,
  };
}

