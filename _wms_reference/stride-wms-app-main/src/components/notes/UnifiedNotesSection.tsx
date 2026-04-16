import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useUnifiedNotes, type UnifiedNote } from '@/hooks/useUnifiedNotes';
import {
  UNIFIED_NOTE_ENTITY_META,
  type UnifiedNoteEntityType,
  type UnifiedNoteType,
} from '@/lib/notes/entityMeta';
import { getActiveMentionQuery } from '@/lib/notes/mentions';
import { SHIPMENT_EXCEPTION_CODE_META, type ShipmentExceptionCode } from '@/hooks/useShipmentExceptions';
import { EntityLink } from '@/components/chat/EntityLink';
import { HelpTip } from '@/components/ui/help-tip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface UnifiedNotesSectionProps {
  entityType: UnifiedNoteEntityType;
  entityId: string;
  entityNumber?: string | null;
  title?: string;
  isClientUser?: boolean;
  className?: string;
  embedded?: boolean;
  forcedNoteType?: UnifiedNoteType;
  allowedNoteTypes?: UnifiedNoteType[];
  readOnly?: boolean;
  readOnlyLinkedSources?: boolean;
  allowClientWrite?: boolean;
  topContent?: ReactNode;
  listHeightClassName?: string;
  showMentionsHelp?: boolean;
}

const EXCEPTION_CODE_OPTIONS: ShipmentExceptionCode[] = [
  'DAMAGE',
  'WET',
  'OPEN',
  'MISSING_DOCS',
  'CRUSHED_TORN_CARTONS',
  'MIS_SHIP',
  'SHORTAGE',
  'OVERAGE',
  'OTHER',
];

function getAuthorName(note: UnifiedNote): string {
  if (!note.author) return 'System';
  const name = `${note.author.first_name || ''} ${note.author.last_name || ''}`.trim();
  return name || note.author.email || note.author.username || 'User';
}

function getAuthorInitials(name: string): string {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return initials || '??';
}

export function UnifiedNotesSection({
  entityType,
  entityId,
  entityNumber,
  title = 'Notes',
  isClientUser = false,
  className,
  embedded = false,
  forcedNoteType,
  allowedNoteTypes = ['internal', 'public'],
  readOnly = false,
  readOnlyLinkedSources = false,
  allowClientWrite = false,
  topContent,
  listHeightClassName,
  showMentionsHelp = true,
}: UnifiedNotesSectionProps) {
  const { profile } = useAuth();
  const { hasRole } = usePermissions();
  const {
    notes,
    loading,
    mentionableUsers,
    resolveMentionUserIds,
    addNote,
    updateNote,
    deleteNote,
  } = useUnifiedNotes({ entityType, entityId, isClientUser });

  const [newNote, setNewNote] = useState('');
  const [noteType, setNoteType] = useState<UnifiedNoteType>(
    forcedNoteType || (allowedNoteTypes[0] as UnifiedNoteType)
  );
  const [exceptionCode, setExceptionCode] = useState<string>('__general__');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const [composerCaret, setComposerCaret] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!forcedNoteType) return;
    setNoteType(forcedNoteType);
    if (forcedNoteType !== 'exception') setExceptionCode('__general__');
  }, [forcedNoteType]);

  const mentionContext = useMemo(
    () => getActiveMentionQuery(newNote, composerCaret),
    [newNote, composerCaret]
  );

  const mentionSuggestions = useMemo(() => {
    if (!mentionContext) return [];
    const q = mentionContext.query.toLowerCase();
    return mentionableUsers
      .filter((user) => user.id !== profile?.id)
      .filter((user) => (q ? user.username.startsWith(q) : true))
      .slice(0, 8);
  }, [mentionContext, mentionableUsers, profile?.id]);

  const effectiveNoteType = forcedNoteType || noteType;
  const canWrite = (!isClientUser || allowClientWrite) && !readOnly;

  const filterThreadByType = (thread: UnifiedNote, matcher: (note: UnifiedNote) => boolean): UnifiedNote | null => {
    if (!matcher(thread)) return null;
    return {
      ...thread,
      replies: (thread.replies || [])
        .map((reply) => filterThreadByType(reply, matcher))
        .filter((reply): reply is UnifiedNote => reply !== null),
    };
  };

  const visibleThreadedNotes = useMemo(() => {
    const allowedSet = new Set<UnifiedNoteType>(allowedNoteTypes);
    const base = isClientUser
      ? notes.filter((n) => n.visibility === 'public')
      : notes;

    const allowed = base
      .map((note) => filterThreadByType(note, (candidate) => allowedSet.has(candidate.note_type)))
      .filter((note): note is UnifiedNote => note !== null);

    if (forcedNoteType) {
      return allowed
        .map((note) => filterThreadByType(note, (candidate) => candidate.note_type === forcedNoteType))
        .filter((note): note is UnifiedNote => note !== null);
    }
    return allowed;
  }, [allowedNoteTypes, forcedNoteType, isClientUser, notes]);

  const filteredByTab = (tabType: UnifiedNoteType | 'all') => {
    if (tabType === 'all') return visibleThreadedNotes;
    return visibleThreadedNotes
      .map((note) => filterThreadByType(note, (candidate) => candidate.note_type === tabType))
      .filter((note): note is UnifiedNote => note !== null);
  };

  const visibleFlattenedNotes = useMemo(() => {
    const out: UnifiedNote[] = [];
    const walk = (note: UnifiedNote) => {
      out.push(note);
      for (const reply of note.replies || []) walk(reply);
    };
    visibleThreadedNotes.forEach(walk);
    return out;
  }, [visibleThreadedNotes]);

  const internalCount = visibleFlattenedNotes.filter((n) => n.note_type === 'internal').length;
  const publicCount = visibleFlattenedNotes.filter((n) => n.note_type === 'public').length;
  const exceptionCount = visibleFlattenedNotes.filter((n) => n.note_type === 'exception').length;

  const insertMention = (username: string) => {
    if (!mentionContext) return;
    const before = newNote.slice(0, mentionContext.replaceStart);
    const after = newNote.slice(mentionContext.replaceEnd);
    const insert = `@${username} `;
    const next = `${before}${insert}${after}`;
    const nextCaret = before.length + insert.length;
    setNewNote(next);
    setComposerCaret(nextCaret);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleSubmit = async () => {
    if (!newNote.trim() || !canWrite) return;
    setSubmitting(true);
    try {
      const mentionIds = effectiveNoteType === 'internal'
        ? resolveMentionUserIds(newNote)
        : [];
      const metadata =
        effectiveNoteType === 'exception'
          ? {
              exception_code: exceptionCode === '__general__' ? null : exceptionCode,
            }
          : undefined;
      const created = await addNote(newNote, effectiveNoteType, {
        sourceEntityNumber: entityNumber || null,
        metadata,
        mentionedUserIds: mentionIds,
      });
      if (created) {
        setNewNote('');
        setComposerCaret(0);
        if (effectiveNoteType === 'exception') setExceptionCode('__general__');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (parent: UnifiedNote) => {
    if (!replyText.trim() || !canWrite) return;
    const isReplyInternal = parent.note_type === 'internal';
    setSubmitting(true);
    try {
      const mentionIds = isReplyInternal ? resolveMentionUserIds(replyText) : [];
      const parentExceptionCode =
        parent.note_type === 'exception'
          ? (parent.metadata?.legacy_exception_code as string | undefined)
          : undefined;
      const metadata =
        parent.note_type === 'exception'
          ? {
              exception_code: parentExceptionCode || null,
            }
          : undefined;
      const created = await addNote(replyText, parent.note_type, {
        parentNoteId: parent.id,
        sourceEntityNumber: entityNumber || null,
        metadata,
        mentionedUserIds: mentionIds,
      });
      if (created) {
        setReplyText('');
        setReplyingTo(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const beginEdit = (note: UnifiedNote) => {
    setEditingNoteId(note.id);
    setEditingText(note.note);
  };

  const saveEdit = async () => {
    if (!editingNoteId || !editingText.trim()) return;
    setSubmitting(true);
    try {
      const ok = await updateNote(editingNoteId, editingText);
      if (ok) {
        setEditingNoteId(null);
        setEditingText('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cancelEdit = () => {
    setEditingNoteId(null);
    setEditingText('');
  };

  const canManageByRole = hasRole('admin') || hasRole('manager') || hasRole('billing_manager') || hasRole('admin_dev');

  const renderSourceBadge = (note: UnifiedNote) => {
    if (!note.sourceLink || note.isSourceContext) return null;
    const sourceType = note.sourceLink.entity_type as UnifiedNoteEntityType;
    const meta = UNIFIED_NOTE_ENTITY_META[sourceType];
    if (!meta) return null;

    if (meta.linkType && note.sourceLink.entity_number) {
      return (
        <EntityLink
          type={meta.linkType}
          number={note.sourceLink.entity_number}
          id={note.sourceLink.entity_id}
        />
      );
    }

    return (
      <Badge variant="outline" className="text-xs">
        {meta.label}: {note.sourceLink.entity_number || note.sourceLink.entity_id}
      </Badge>
    );
  };

  const renderNote = (note: UnifiedNote, isReply = false) => {
    const authorName = getAuthorName(note);
    const initials = getAuthorInitials(authorName);
    const isLinkedReadonly = readOnlyLinkedSources && !note.isSourceContext;
    const noteIsReadOnly = readOnly || isLinkedReadonly;
    const canManage = !noteIsReadOnly && !isClientUser && (note.created_by === profile?.id || canManageByRole);
    const exceptionCode =
      (note.metadata?.exception_code as string | undefined) ||
      (note.metadata?.legacy_exception_code as string | undefined) ||
      null;
    const exceptionLabel =
      note.note_type === 'exception' && exceptionCode
        ? SHIPMENT_EXCEPTION_CODE_META[exceptionCode as ShipmentExceptionCode]?.label || exceptionCode
        : null;

    return (
      <div
        key={note.id}
        className={cn('flex gap-3', isReply ? 'ml-8 mt-2' : 'border-b pb-4 last:border-b-0')}
      >
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{authorName}</span>
            <span className="text-xs text-muted-foreground">
              {format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}
            </span>
            {note.note_type === 'public' ? (
              <Badge variant="outline" className="text-xs">
                <MaterialIcon name="public" className="text-[12px] mr-1" />
                Public
              </Badge>
            ) : note.note_type === 'exception' ? (
              <Badge variant="destructive" className="text-xs">
                <MaterialIcon name="report_problem" className="text-[12px] mr-1" />
                Exception
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                <MaterialIcon name="lock" className="text-[12px] mr-1" />
                Internal
              </Badge>
            )}
            {exceptionLabel && (
              <Badge variant="outline" className="text-xs">
                {exceptionLabel}
              </Badge>
            )}
            {renderSourceBadge(note)}
            {isLinkedReadonly && (
              <Badge variant="outline" className="text-xs">
                Read only
              </Badge>
            )}
          </div>

          {editingNoteId === note.id ? (
            <div className="mt-2 space-y-2">
              <Textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="min-h-[72px] text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit} disabled={submitting || !editingText.trim()}>
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm mt-1 whitespace-pre-wrap">{note.note}</p>
          )}

          {!isReply && !noteIsReadOnly && !isClientUser ? (
            <div className="mt-1 flex flex-wrap gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setReplyingTo(replyingTo === note.id ? null : note.id)}
              >
                <MaterialIcon name="reply" className="text-[12px] mr-1" />
                Reply
              </Button>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => beginEdit(note)}
                >
                  <MaterialIcon name="edit" className="text-[12px] mr-1" />
                  Edit
                </Button>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => void deleteNote(note.id)}
                >
                  <MaterialIcon name="delete" className="text-[12px] mr-1" />
                  Delete
                </Button>
              )}
            </div>
          ) : null}

          {replyingTo === note.id && !noteIsReadOnly && (
            <div className="flex gap-2 mt-2">
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply..."
                className="min-h-[60px] text-sm"
              />
              <Button
                size="sm"
                onClick={() => void handleReply(note)}
                disabled={submitting || !replyText.trim()}
              >
                {submitting ? (
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                ) : (
                  <MaterialIcon name="send" size="sm" />
                )}
              </Button>
            </div>
          )}

          {(note.replies || []).map((reply) => renderNote(reply, true))}
        </div>
      </div>
    );
  };

  if (loading) {
    const loadingBody = (
      <div className="py-8 flex items-center justify-center">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
    if (embedded) return <div className={className}>{loadingBody}</div>;
    return <Card className={className}><CardContent>{loadingBody}</CardContent></Card>;
  }

  const renderList = (threaded: UnifiedNote[]) => {
    const content = (
      <div className="space-y-4">
        {threaded.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No notes yet.</p>
        ) : (
          threaded.map((note) => renderNote(note))
        )}
      </div>
    );

    if (!listHeightClassName) return content;
    return <ScrollArea className={listHeightClassName}>{content}</ScrollArea>;
  };

  const sectionBody = (
    <div className="space-y-4">
      {topContent}

      {canWrite && (
        <div className="space-y-3">
          {!forcedNoteType && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-muted-foreground">Note Type:</span>
              <div className="flex gap-2">
                {allowedNoteTypes.includes('internal') && (
                  <div className="flex flex-1 items-center gap-1">
                    <Button
                      type="button"
                      variant={noteType === 'internal' ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        'flex-1',
                        noteType === 'internal' ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''
                      )}
                      onClick={() => setNoteType('internal')}
                    >
                      <MaterialIcon name="lock" className="text-[14px] mr-2" />
                      Internal
                    </Button>
                    {showMentionsHelp && (
                      <HelpTip
                        tooltip="Use @username in Internal notes to tag staff and send them an in-app alert linked to this thread."
                        side="top"
                      />
                    )}
                  </div>
                )}
                {allowedNoteTypes.includes('public') && (
                  <Button
                    type="button"
                    variant={noteType === 'public' ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      'flex-1',
                      noteType === 'public' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''
                    )}
                    onClick={() => setNoteType('public')}
                  >
                    <MaterialIcon name="public" className="text-[14px] mr-2" />
                    Public
                  </Button>
                )}
                {allowedNoteTypes.includes('exception') && (
                  <Button
                    type="button"
                    variant={noteType === 'exception' ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      'flex-1',
                      noteType === 'exception' ? 'bg-red-600 hover:bg-red-700 text-white' : ''
                    )}
                    onClick={() => setNoteType('exception')}
                  >
                    <MaterialIcon name="report_problem" className="text-[14px] mr-2" />
                    Exception
                  </Button>
                )}
              </div>
            </div>
          )}

          <p
            className={cn(
              'text-xs',
              effectiveNoteType === 'internal'
                ? 'text-amber-600 dark:text-amber-400'
                : effectiveNoteType === 'public'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-red-600 dark:text-red-400'
            )}
          >
            {effectiveNoteType === 'internal'
              ? 'Internal notes are only viewable by your company. Use @username to mention a staff member.'
              : effectiveNoteType === 'public'
                ? 'Public notes are client-visible.'
                : 'Exception notes are client-visible and tied to shipment exception workflow.'}
          </p>

          {effectiveNoteType === 'exception' && allowedNoteTypes.includes('exception') && (
            <div className="space-y-2">
              <Label className="text-sm">Exception Type (optional)</Label>
              <Select value={exceptionCode} onValueChange={setExceptionCode}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="General exception note" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__general__">General exception note</SelectItem>
                  {EXCEPTION_CODE_OPTIONS.map((code) => (
                    <SelectItem key={code} value={code}>
                      {SHIPMENT_EXCEPTION_CODE_META[code]?.label || code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="relative">
            <Textarea
              ref={composerRef}
              value={newNote}
              onChange={(e) => {
                setNewNote(e.target.value);
                setComposerCaret(e.target.selectionStart || 0);
              }}
              onClick={(e) => setComposerCaret((e.target as HTMLTextAreaElement).selectionStart || 0)}
              onKeyUp={(e) => setComposerCaret((e.target as HTMLTextAreaElement).selectionStart || 0)}
              placeholder={
                effectiveNoteType === 'internal'
                  ? 'Add an internal note...'
                  : effectiveNoteType === 'public'
                    ? 'Add a public note...'
                    : 'Add an exception note...'
              }
              className={cn(
                'min-h-[80px]',
                effectiveNoteType === 'exception' ? 'border-red-300 focus:border-red-500' : ''
              )}
            />
            {effectiveNoteType === 'internal' && mentionContext && mentionSuggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-sm">
                {mentionSuggestions.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(user.username);
                    }}
                  >
                    <span className="font-medium">@{user.username}</span>
                    <span className="text-muted-foreground ml-2">
                      {`${user.firstName} ${user.lastName}`.trim() || user.email}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => void handleSubmit()} disabled={submitting || !newNote.trim()}>
              {submitting ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="send" size="sm" className="mr-2" />
              )}
              Add Note
            </Button>
          </div>
        </div>
      )}

      {isClientUser || forcedNoteType ? (
        renderList(visibleThreadedNotes)
      ) : (
        <Tabs defaultValue="all" className="w-full">
          <TabsList
            className={cn(
              'w-full grid',
              allowedNoteTypes.includes('exception') ? 'grid-cols-4' : 'grid-cols-3'
            )}
          >
            <TabsTrigger value="all">All ({visibleFlattenedNotes.length})</TabsTrigger>
            {allowedNoteTypes.includes('internal') && (
              <TabsTrigger value="internal">Internal ({internalCount})</TabsTrigger>
            )}
            {allowedNoteTypes.includes('public') && (
              <TabsTrigger value="public">Public ({publicCount})</TabsTrigger>
            )}
            {allowedNoteTypes.includes('exception') && (
              <TabsTrigger value="exception">Exception ({exceptionCount})</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="all" className="mt-4">
            {renderList(filteredByTab('all'))}
          </TabsContent>
          {allowedNoteTypes.includes('internal') && (
            <TabsContent value="internal" className="mt-4">
              {renderList(filteredByTab('internal'))}
            </TabsContent>
          )}
          {allowedNoteTypes.includes('public') && (
            <TabsContent value="public" className="mt-4">
              {renderList(filteredByTab('public'))}
            </TabsContent>
          )}
          {allowedNoteTypes.includes('exception') && (
            <TabsContent value="exception" className="mt-4">
              {renderList(filteredByTab('exception'))}
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );

  if (embedded) {
    return <div className={cn('space-y-4', className)}>{sectionBody}</div>;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <MaterialIcon name="chat" size="md" />
          {title} ({visibleFlattenedNotes.length})
        </CardTitle>
      </CardHeader>
      <CardContent>{sectionBody}</CardContent>
    </Card>
  );
}

