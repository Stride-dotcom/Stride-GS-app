/**
 * useMessages — Supabase CRUD for public.messages + public.message_recipients.
 *
 * Session 74 rewrite: the original port was written against an INFERRED schema
 * that didn't match what actually shipped in the DB. Sends were silently
 * failing (0 rows in both tables) because the INSERTs referenced columns
 * that don't exist (`thread_id`, `entity_type`, `entity_id`, `sender_name`,
 * `recipient_id` as uuid, `recipient_name`) and omitted required ones
 * (`tenant_id`). This version is aligned with the real schema:
 *
 *   messages:
 *     id uuid PK, tenant_id text NOT NULL, sender_id uuid NOT NULL,
 *     subject text, body text NOT NULL, message_type text default 'message',
 *     priority text default 'normal',
 *     related_entity_type text, related_entity_id text,
 *     metadata jsonb, created_at timestamptz
 *
 *   message_recipients:
 *     id uuid PK, message_id uuid NOT NULL,
 *     recipient_type text default 'user', recipient_id text NOT NULL,
 *     user_id uuid NOT NULL,
 *     is_read boolean, read_at timestamptz, is_archived boolean, created_at
 *
 *   RLS:
 *     messages_insert_own   — sender_id must equal auth.uid()
 *     messages_select_*     — sender or recipient via message_recipients
 *     msg_recipients_insert_sender — parent message.sender_id must be auth.uid()
 *     msg_recipients_select_own    — user_id must equal auth.uid()
 *
 *   profiles (for display names): id uuid, email, display_name, role
 *
 * There is NO `thread_id` column on messages. Conversation grouping is
 * derived from (related_entity_type, related_entity_id) for entity-linked
 * threads and from the other-party user_id for direct DMs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  tenantId: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  subject: string | null;
  body: string;
  messageType: string;
  priority: string;
  senderId: string;
  senderName: string;       // resolved from profiles at load time
  senderEmail: string;
  senderRole: string | null;
  createdAt: string;
  /** Populated when loading a thread for the current user. */
  myRecipient?: {
    recipientId: string;
    isRead: boolean;
    readAt: string | null;
    isArchived: boolean;
  };
  /** All user_ids on the message (current user + others). Used for direct-thread keying. */
  recipientUserIds: string[];
}

export interface Conversation {
  /** Synthesized: `entity:<type>:<id>` for entity-linked, `direct:<selfUid>:<otherUid>` for DMs,
   *  or `msg:<messageId>` as a fallback when neither is available. */
  key: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  /** Backwards-compat aliases for `relatedEntity*` — kept because MessagesPage
   *  and other consumers were written against the earlier Conversation shape. */
  entityType: string | null;
  entityId: string | null;
  /** Legacy: there is no `thread_id` column in the DB, so this is always null.
   *  Retained so consumers that destructure it still compile. */
  threadId: string | null;
  /** Display label — "RE: Repair RPR-0089" or the other party's name. */
  title: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface SendMessageParams {
  body: string;
  recipientIds: string[];       // auth.users.id uuids of target users
  recipientNames?: string[];
  subject?: string;
  /** UI still uses entityType/entityId; we map them onto related_entity_*. */
  entityType?: string;
  entityId?: string;
  /** Legacy alias from the earlier API — also mapped onto related_entity_*. */
  threadId?: string;
  priority?: string;
  messageType?: string;
}

// ─── Row shapes ────────────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  tenant_id: string;
  sender_id: string;
  subject: string | null;
  body: string;
  message_type: string | null;
  priority: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface RecipientRow {
  id: string;
  message_id: string;
  recipient_type: string | null;
  recipient_id: string;
  user_id: string;
  is_read: boolean | null;
  read_at: string | null;
  is_archived: boolean | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function directKey(selfId: string, otherId: string): string {
  // Stable key regardless of who initiated the thread.
  return selfId < otherId ? `direct:${otherId}:${selfId}` : `direct:${selfId}:${otherId}`;
}

/** Extract the "other party" user_id for a message viewed by the current user.
 *  Ignores self; prefers the first non-self recipient. */
function otherPartyForMessage(m: Message, selfId: string): string | null {
  if (m.senderId !== selfId) return m.senderId;
  const others = m.recipientUserIds.filter(u => u !== selfId);
  return others[0] ?? null;
}

function keyForMessage(m: Message, selfId: string): string {
  if (m.relatedEntityType && m.relatedEntityId) {
    return `entity:${m.relatedEntityType}:${m.relatedEntityId}`;
  }
  const other = otherPartyForMessage(m, selfId);
  if (other) return directKey(selfId, other);
  return `msg:${m.id}`;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface UseMessagesResult {
  conversations: Conversation[];
  thread: Message[];
  threadLoading: boolean;
  loading: boolean;
  unreadCount: number;
  activeThreadKey: string | null;
  openThread: (key: string | { entityType?: string; entityId?: string; otherUserId?: string }) => Promise<void>;
  closeThread: () => void;
  sendMessage: (params: SendMessageParams) => Promise<Message | null>;
  markRead: (recipientRowId: string) => Promise<void>;
  markAllReadInThread: () => Promise<void>;
  archiveMessage: (recipientRowId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useMessages(): UseMessagesResult {
  const { user } = useAuth();
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);

  // Resolve auth uid once per session change.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthUserId(data.session?.user.id ?? null);
    });
  }, [user]);

  // ── Helper: hydrate a set of messages with profile names + all recipients ──
  const hydrate = useCallback(async (msgRows: MessageRow[], selfId: string): Promise<Message[]> => {
    if (msgRows.length === 0) return [];
    const msgIds = msgRows.map(m => m.id);

    // All recipient rows for those messages — so we can find the "other party"
    // on each message (direct-thread keying) and flag the current user's own
    // recipient row for read/archive tracking.
    const { data: rcpData } = await supabase
      .from('message_recipients')
      .select('*')
      .in('message_id', msgIds);
    const recipients = (rcpData ?? []) as RecipientRow[];

    const recipsByMsg = new Map<string, RecipientRow[]>();
    for (const r of recipients) {
      const arr = recipsByMsg.get(r.message_id) ?? [];
      arr.push(r);
      recipsByMsg.set(r.message_id, arr);
    }

    // Profiles for sender + all recipient users (in one query).
    const userIds = new Set<string>();
    for (const m of msgRows) userIds.add(m.sender_id);
    for (const r of recipients) userIds.add(r.user_id);
    const profileMap = new Map<string, ProfileRow>();
    if (userIds.size > 0) {
      const { data: profData } = await supabase
        .from('profiles')
        .select('id, email, display_name, role')
        .in('id', Array.from(userIds));
      for (const p of (profData ?? []) as ProfileRow[]) profileMap.set(p.id, p);
    }

    return msgRows.map(m => {
      const rcps = recipsByMsg.get(m.id) ?? [];
      const mine = rcps.find(r => r.user_id === selfId);
      const profile = profileMap.get(m.sender_id);
      return {
        id: m.id,
        tenantId: m.tenant_id,
        relatedEntityType: m.related_entity_type,
        relatedEntityId: m.related_entity_id,
        subject: m.subject,
        body: m.body,
        messageType: m.message_type ?? 'message',
        priority: m.priority ?? 'normal',
        senderId: m.sender_id,
        senderName: profile?.display_name || profile?.email || 'Unknown',
        senderEmail: profile?.email ?? '',
        senderRole: profile?.role ?? null,
        createdAt: m.created_at,
        recipientUserIds: rcps.map(r => r.user_id),
        myRecipient: mine ? {
          recipientId: mine.id,
          isRead: !!mine.is_read,
          readAt: mine.read_at,
          isArchived: !!mine.is_archived,
        } : undefined,
      };
    });
  }, []);

  // ── Inbox load ──────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!authUserId) return;
    setLoading(true);

    // Fetch every message I can SEE via RLS (sender or recipient). Sending
    // and receiving both make the message visible; joining on recipients is
    // optional now because RLS already filters.
    const { data: msgData, error: msgErr } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (msgErr || !msgData) { setLoading(false); return; }

    const hydrated = await hydrate(msgData as MessageRow[], authUserId);
    // Drop messages where MY recipient row is archived (senders always keep
    // theirs; archived is a per-user soft-delete on the inbox side).
    const inbox = hydrated.filter(m => !m.myRecipient?.isArchived);
    setMessages(inbox);
    setLoading(false);
  }, [authUserId, hydrate]);

  useEffect(() => { void refetch(); }, [refetch]);

  // ── Realtime inbox refresh ──────────────────────────────────────────────
  useEffect(() => {
    if (!authUserId) return;
    const channel = supabase
      .channel(`messages_inbox_${authUserId}`)
      // My recipient rows (new inbound, read/archive changes)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_recipients', filter: `user_id=eq.${authUserId}` },
        () => { void refetch(); })
      // My own sent messages (so conversation list updates for outbound)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `sender_id=eq.${authUserId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [authUserId, refetch]);

  // ── Derived conversation list ───────────────────────────────────────────
  const conversations = useMemo<Conversation[]>(() => {
    if (!authUserId) return [];
    const byKey = new Map<string, Conversation>();

    for (const m of messages) {
      const key = keyForMessage(m, authUserId);
      const prev = byKey.get(key);
      const mine = m.myRecipient;
      const unread = mine && !mine.isRead ? 1 : 0;

      // Title: entity threads get "RE: <type> <id>"; direct threads show the
      // other party's name (resolved from senderName OR, for my own sends,
      // the first non-self recipient's profile — which we already fetched).
      let title: string;
      if (m.relatedEntityType && m.relatedEntityId) {
        title = `RE: ${m.relatedEntityType} ${m.relatedEntityId}`;
      } else {
        const other = otherPartyForMessage(m, authUserId);
        // Prefer senderName when the message was FROM the other party.
        title = m.senderId !== authUserId
          ? (m.senderName || 'Message')
          : (other ? `To ${other.slice(0, 6)}…` : 'Message');
      }

      if (!prev || m.createdAt > prev.lastMessageAt) {
        byKey.set(key, {
          key,
          relatedEntityType: m.relatedEntityType,
          relatedEntityId: m.relatedEntityId,
          entityType: m.relatedEntityType,
          entityId: m.relatedEntityId,
          threadId: null,
          title,
          lastMessagePreview: m.body.slice(0, 140),
          lastMessageAt: m.createdAt,
          unreadCount: (prev?.unreadCount ?? 0) + unread,
        });
      } else {
        byKey.set(key, { ...prev, unreadCount: prev.unreadCount + unread });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  }, [messages, authUserId]);

  // Now resolve direct-thread titles using profile names we already
  // fetched on the messages (senderName is populated). For direct threads
  // started by me where the sender is self, we need the OTHER party's name —
  // look into any message in that thread where senderId !== self.
  const conversationsWithNames = useMemo(() => {
    if (!authUserId) return conversations;
    // Build: for each direct: key, the other party's best-known name.
    const otherNameByKey = new Map<string, string>();
    for (const m of messages) {
      if (m.relatedEntityType && m.relatedEntityId) continue;
      const key = keyForMessage(m, authUserId);
      if (!key.startsWith('direct:')) continue;
      if (m.senderId !== authUserId && m.senderName && !otherNameByKey.has(key)) {
        otherNameByKey.set(key, m.senderName);
      }
    }
    return conversations.map(c => {
      if (!c.key.startsWith('direct:')) return c;
      const name = otherNameByKey.get(c.key);
      return name ? { ...c, title: name } : c;
    });
  }, [conversations, messages, authUserId]);

  const unreadCount = useMemo(
    () => messages.reduce((n, m) => n + (m.myRecipient && !m.myRecipient.isRead ? 1 : 0), 0),
    [messages],
  );

  // ── Open a thread ───────────────────────────────────────────────────────
  const openThread = useCallback(async (
    target: string | { entityType?: string; entityId?: string; otherUserId?: string },
  ) => {
    if (!authUserId) return;
    const key: string =
      typeof target === 'string'
        ? target
        : target.entityType && target.entityId
          ? `entity:${target.entityType}:${target.entityId}`
          : target.otherUserId
            ? directKey(authUserId, target.otherUserId)
            : '';
    if (!key) return;

    setActiveThreadKey(key);
    setThreadLoading(true);

    let query = supabase.from('messages').select('*').order('created_at', { ascending: true }).limit(500);
    if (key.startsWith('entity:')) {
      const parts = key.split(':');
      const entityType = parts[1];
      const entityId = parts.slice(2).join(':');
      query = query.eq('related_entity_type', entityType).eq('related_entity_id', entityId);
    } else if (key.startsWith('direct:')) {
      // key format: direct:<idA>:<idB> (sorted-stable). The other party is
      // whichever id isn't self.
      const [, a, b] = key.split(':');
      const other = a === authUserId ? b : a;
      // RLS guarantees we only see messages we're a party to, so filtering
      // by sender_id IN (self, other) captures this pair's DMs.
      query = query.or(`sender_id.eq.${authUserId},sender_id.eq.${other}`)
        .is('related_entity_type', null);
    }

    const { data, error } = await query;
    if (error || !data) { setThread([]); setThreadLoading(false); return; }
    const hydrated = await hydrate(data as MessageRow[], authUserId);
    setThread(hydrated);
    setThreadLoading(false);
  }, [authUserId, hydrate]);

  const closeThread = useCallback(() => {
    setActiveThreadKey(null);
    setThread([]);
  }, []);

  // ── Send ────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (params: SendMessageParams): Promise<Message | null> => {
    if (!authUserId) return null;
    const body = params.body.trim();
    if (!body) return null;

    // tenant_id is NOT NULL on messages. Use the caller's bound client tenant
    // when available; otherwise '_platform' as a generic marker for
    // staff/admin cross-tenant messages.
    const tenantId = user?.clientSheetId || '_platform';

    // The UI passes `entityType/entityId` (or legacy `threadId`); map onto
    // the schema's `related_entity_*`. Legacy threadId gets dropped since
    // the DB has no thread_id column.
    const relatedEntityType = params.entityType ?? null;
    const relatedEntityId = params.entityId ?? null;

    // 1. Insert message (RLS: sender_id must equal auth.uid())
    const { data: msgData, error: msgErr } = await supabase
      .from('messages')
      .insert({
        tenant_id: tenantId,
        sender_id: authUserId,
        body,
        subject: params.subject ?? null,
        message_type: params.messageType ?? 'message',
        priority: params.priority ?? 'normal',
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
        metadata: {},
      })
      .select('*')
      .single();
    if (msgErr || !msgData) {
      console.error('[useMessages] sendMessage failed to insert into messages:', msgErr);
      return null;
    }

    // 2. Insert recipient rows. Include self so the sender's own copy shows
    //    up in their inbox/list (pre-read, pre-unarchived).
    const recipientUserIds = Array.from(new Set([authUserId, ...params.recipientIds]));
    const rcpRows = recipientUserIds.map(uid => ({
      message_id: msgData.id,
      recipient_type: 'user',
      recipient_id: uid,                           // text mirror for NOT NULL constraint
      user_id: uid,                                // uuid FK used by RLS
      is_read: uid === authUserId,
      read_at: uid === authUserId ? new Date().toISOString() : null,
      is_archived: false,
    }));
    if (rcpRows.length > 0) {
      const { error: rcpErr } = await supabase.from('message_recipients').insert(rcpRows);
      if (rcpErr) {
        console.error('[useMessages] sendMessage failed to insert recipients:', rcpErr);
        // Message is orphaned without recipients — best-effort cleanup so
        // sends are all-or-nothing from the user's perspective.
        await supabase.from('messages').delete().eq('id', msgData.id);
        return null;
      }
    }

    // 3. Optimistic append to the current thread + refetch inbox so the
    //    conversation list picks up the new row.
    const [hydrated] = await hydrate([msgData as MessageRow], authUserId);
    if (hydrated) {
      setThread(prev => [...prev, hydrated]);
      setMessages(prev => [hydrated, ...prev]);
    }
    // Fire-and-forget a broader refetch — Realtime should also trigger it,
    // but this covers the 1-2 second RT lag.
    void refetch();
    return hydrated ?? null;
  }, [authUserId, user, hydrate, refetch]);

  // ── Mark read / archive ─────────────────────────────────────────────────
  const markRead = useCallback(async (recipientRowId: string) => {
    await supabase
      .from('message_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', recipientRowId);
    setMessages(prev => prev.map(m =>
      m.myRecipient?.recipientId === recipientRowId
        ? { ...m, myRecipient: { ...m.myRecipient, isRead: true, readAt: new Date().toISOString() } }
        : m,
    ));
    setThread(prev => prev.map(m =>
      m.myRecipient?.recipientId === recipientRowId
        ? { ...m, myRecipient: { ...m.myRecipient, isRead: true, readAt: new Date().toISOString() } }
        : m,
    ));
  }, []);

  const markAllReadInThread = useCallback(async () => {
    const unread = thread
      .map(m => m.myRecipient)
      .filter((r): r is NonNullable<Message['myRecipient']> => !!r && !r.isRead);
    if (unread.length === 0) return;
    await Promise.all(unread.map(r => markRead(r.recipientId)));
  }, [thread, markRead]);

  const archiveMessage = useCallback(async (recipientRowId: string) => {
    await supabase
      .from('message_recipients')
      .update({ is_archived: true })
      .eq('id', recipientRowId);
    setMessages(prev => prev.filter(m => m.myRecipient?.recipientId !== recipientRowId));
  }, []);

  return useMemo(() => ({
    conversations: conversationsWithNames,
    thread,
    threadLoading,
    loading,
    unreadCount,
    activeThreadKey,
    openThread,
    closeThread,
    sendMessage,
    markRead,
    markAllReadInThread,
    archiveMessage,
    refetch,
  }), [conversationsWithNames, thread, threadLoading, loading, unreadCount, activeThreadKey,
       openThread, closeThread, sendMessage, markRead, markAllReadInThread, archiveMessage, refetch]);
}
