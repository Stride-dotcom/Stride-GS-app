/**
 * useMessages — Supabase CRUD for the conversations-model messaging stack.
 *
 * Session 89 rebuild. Replaces every previous derived-from-recipients
 * approach with the standard IM design that's been sitting half-wired
 * in the schema since migration 20260422040000:
 *
 *   public.conversations
 *     id, kind ('dm'|'group'|'entity'), related_entity_type/id, tenant_id,
 *     created_by, created_at, last_message_at
 *
 *   public.conversation_participants
 *     (conversation_id, user_id) PK, joined_at, last_read_at, is_archived
 *
 *   public.messages.conversation_id  → conversations.id  (set on every send)
 *
 *   public.message_recipients         (kept — drives per-message Delivered /
 *                                      Read receipts on MessageBubble)
 *
 * Why the rebuild:
 *
 *   • The old approach derived "what conversation does this message belong
 *     to?" from the recipient set visible to the current user. RLS only
 *     showed each recipient their own row, so a 3-person message looked
 *     like a `group:` thread to the sender but two separate `direct:`
 *     threads to the recipients (each could only see themselves on the
 *     recipient list). One message → three different threads, one per
 *     viewer. iMessage-style consistent threading was impossible without
 *     either loosening RLS or adding a real "conversation" entity.
 *
 *   • SendMessage's old INSERT…RETURNING `.select('*').single()` had to
 *     pass every SELECT policy on `messages` at the moment of insert.
 *     With participant-EXISTS subqueries on the policy stack and zero
 *     conversation rows yet, the read could fail and the optimistic UI
 *     was empty. Now: sender ensures their `conversation_participants`
 *     row exists *before* the message INSERT (via SECURITY DEFINER RPC),
 *     so `messages_select_via_conversation` succeeds at INSERT time
 *     without needing to read back the message row at all — we only
 *     fetch the id and refetch the inbox.
 *
 *   • Visibility rule — every user (admin/staff/client) sees only
 *     messages they sent or received. The previous `messages_select_staff`
 *     policy granted admin/staff full visibility into other people's
 *     conversations; that's gone in the migration that ships with this
 *     rebuild. Recipient picker filtering (admin/staff see all users in
 *     the directory; clients see only own-tenant + staff/admin) lives
 *     in React, not RLS — see ComposeMessageModal.
 *
 * Send flow:
 *
 *   1. Resolve a conversation_id. Three RPC calls map onto the three
 *      conversation kinds:
 *        • entity_type + entity_id  → find_or_create_entity_conversation
 *        • recipient_ids            → find_or_create_dm_conversation
 *        • caller already passed conversationId → use it directly
 *      Both RPCs are SECURITY DEFINER and create participant rows for
 *      every involved user atomically, so the next step's RLS check
 *      will succeed for the sender.
 *
 *   2. INSERT into `messages` with conversation_id + sender_id + body +
 *      related_entity_*. We round-trip just the id back via `.select('id')`.
 *
 *   3. INSERT non-sender recipients into `message_recipients`. These
 *      drive the iMessage-style Delivered/Read receipts that MessageBubble
 *      renders. The trigger `messages_touch_conversation` updates
 *      `conversations.last_message_at` automatically.
 *
 *   4. Refetch the inbox so the conversation list + active thread both
 *      pick up the new message immediately.
 *
 * Realtime:
 *
 *   Single channel subscribed to `messages` INSERT + `message_recipients`
 *   UPDATE (read-receipt flips). RLS scopes both — we only get events for
 *   conversations we're already in. Either event triggers a refetch.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ─── Public types ──────────────────────────────────────────────────────────

export interface Message {
  id: string;
  conversationId: string;
  tenantId: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  subject: string | null;
  body: string;
  messageType: string;
  priority: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  senderRole: string | null;
  createdAt: string;
  /** Populated when the current user is a non-sender recipient of this message. */
  myRecipient?: {
    recipientId: string;
    isRead: boolean;
    readAt: string | null;
    isArchived: boolean;
  };
  /** Every participant on the message's conversation — used for thread
   *  display and for the iMessage-style read-receipt aggregation. Pulled
   *  from `conversation_participants`, so visible to every member of the
   *  conversation regardless of who sent the message. */
  recipientUserIds: string[];
  /** Per-message read state for every non-sender recipient row visible
   *  through `message_recipients` RLS (sender sees all rows on their own
   *  messages; recipients see their own row). Drives MessageBubble's
   *  Delivered / Read receipt rendering. */
  recipientReads: Array<{ userId: string; isRead: boolean; readAt: string | null }>;
}

export interface Conversation {
  /** Stable key — equal to `conversations.id` (UUID). Components compare
   *  by string, no parsing. */
  key: string;
  /** For entity threads only. */
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  /** Aliases — older consumers (MessagesPage / ThreadHeader) read these. */
  entityType: string | null;
  entityId: string | null;
  /** Legacy field — there is no `thread_id` column in the DB. Kept null
   *  so existing destructures still compile. */
  threadId: string | null;
  /** Display label — entity threads → "RE: <type> <id>"; DM → other party
   *  name; group → comma-joined participant names. Resolved against the
   *  profile cache; falls back to "Message" if names aren't loaded yet. */
  title: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
  /** All `conversation_participants` for this conversation (including
   *  self). MessagesPage uses this to derive recipientIds for replies
   *  without parsing the key string. */
  participantUserIds: string[];
}

export interface SendMessageParams {
  body: string;
  /** When the caller already knows the conversation (e.g. replying to an
   *  open thread), pass it directly to skip the find-or-create RPC. */
  conversationId?: string;
  recipientIds: string[];
  recipientNames?: string[];
  subject?: string;
  /** entity-anchored thread (replaces threadId). */
  entityType?: string;
  entityId?: string;
  /** Legacy param — silently ignored; kept so older callers compile. */
  threadId?: string;
  priority?: string;
  messageType?: string;
}

export interface UseMessagesResult {
  authUserId: string | null;
  conversations: Conversation[];
  thread: Message[];
  threadLoading: boolean;
  loading: boolean;
  unreadCount: number;
  activeThreadKey: string | null;
  openThread: (target: string | { entityType?: string; entityId?: string; otherUserId?: string; otherUserIds?: string[]; conversationId?: string }) => Promise<void>;
  closeThread: () => void;
  sendMessage: (params: SendMessageParams) => Promise<Message | null>;
  markRead: (recipientRowId: string) => Promise<void>;
  markAllReadInThread: () => Promise<void>;
  archiveMessage: (recipientRowId: string) => Promise<void>;
  /** Per-user soft-delete: archive every recipient row I have in the
   *  conversation. The other party's copy is untouched. */
  deleteConversation: (key: string) => Promise<boolean>;
  refetch: () => Promise<void>;
  latestUnreadIncoming: Message | null;
  dismissBanner: (messageId: string) => void;
}

// ─── Row shapes ────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  kind: 'dm' | 'group' | 'entity';
  related_entity_type: string | null;
  related_entity_id: string | null;
  tenant_id: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
}

interface ParticipantRow {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
  is_archived: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string | null;
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

// ─── Hook implementation ───────────────────────────────────────────────────

function useMessagesImpl(): UseMessagesResult {
  const { user } = useAuth();
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [conversationRows, setConversationRows] = useState<ConversationRow[]>([]);
  const [participantsByConv, setParticipantsByConv] = useState<Record<string, ParticipantRow[]>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [profilesByUid, setProfilesByUid] = useState<Record<string, ProfileRow>>({});
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);

  // Mirror activeThreadKey + openThread in refs so the realtime callback
  // can read the latest values without re-subscribing on every change
  // (which would cause same-name CHANNEL_ERROR collisions).
  const openThreadRef = useRef<((key: string) => Promise<void>) | null>(null);
  const activeThreadKeyRef = useRef<string | null>(null);
  useEffect(() => { activeThreadKeyRef.current = activeThreadKey; }, [activeThreadKey]);

  // Mirror `messages` in a ref so callbacks that run after `await refetch()`
  // can see the freshly-loaded list synchronously. React state updates
  // from refetch don't flush until the next render, so a closure that
  // reads `messages` directly would still see the pre-refetch snapshot —
  // visible as an empty thread on the first open of a brand-new
  // conversation.
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthUserId(data.session?.user.id ?? null);
    });
  }, [user]);

  // Hydrate one set of message rows + recipients into the public Message
  // shape. Pulls profile names + the per-conversation participant list so
  // each Message carries the full participant set even when the caller is
  // a non-sender recipient (the conversation_participants RLS makes the
  // full roster visible to every participant, which is the whole reason
  // we built this table).
  const hydrateMessages = useCallback(async (
    msgRows: MessageRow[],
    recipientsByMsg: Map<string, RecipientRow[]>,
    participantsByConvId: Map<string, ParticipantRow[]>,
    selfId: string,
    profileCache: Map<string, ProfileRow>,
  ): Promise<Message[]> => {
    return msgRows.map((msg): Message => {
      const rcps = recipientsByMsg.get(msg.id) ?? [];
      const mine = rcps.find(r => r.user_id === selfId);
      const profile = profileCache.get(msg.sender_id);
      const participants = msg.conversation_id
        ? (participantsByConvId.get(msg.conversation_id) ?? []).map(p => p.user_id)
        : Array.from(new Set([msg.sender_id, ...rcps.map(r => r.user_id)]));
      return {
        id: msg.id,
        conversationId: msg.conversation_id ?? '',
        tenantId: msg.tenant_id,
        relatedEntityType: msg.related_entity_type,
        relatedEntityId: msg.related_entity_id,
        subject: msg.subject,
        body: msg.body,
        messageType: msg.message_type ?? 'message',
        priority: msg.priority ?? 'normal',
        senderId: msg.sender_id,
        senderName: profile?.display_name || profile?.email || 'Unknown',
        senderEmail: profile?.email ?? '',
        senderRole: profile?.role ?? null,
        createdAt: msg.created_at,
        recipientUserIds: participants,
        recipientReads: rcps.map(r => ({
          userId: r.user_id,
          isRead: !!r.is_read,
          readAt: r.read_at,
        })),
        myRecipient: mine && mine.user_id !== msg.sender_id ? {
          recipientId: mine.id,
          isRead: !!mine.is_read,
          readAt: mine.read_at,
          isArchived: !!mine.is_archived,
        } : undefined,
      };
    });
  }, []);

  // ── Inbox load ──────────────────────────────────────────────────────────
  // Three-step fan-out, all RLS-scoped:
  //   1. Conversations I'm a participant of (via conversations_select).
  //   2. Every participant row for those conversations (via
  //      conv_participants_select — a participant can see all peers).
  //   3. All messages in those conversations (via
  //      messages_select_via_conversation) and their message_recipients
  //      rows (read receipts). Empty sets are handled gracefully.
  const refetch = useCallback(async () => {
    if (!authUserId) return;
    setLoading(true);

    const { data: convData, error: convErr } = await supabase
      .from('conversations')
      .select('id, kind, related_entity_type, related_entity_id, tenant_id, created_by, created_at, last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(300);
    if (convErr) {
      console.warn('[useMessages] conversation fetch failed:', convErr);
      setLoading(false);
      return;
    }
    const convs = (convData ?? []) as ConversationRow[];
    setConversationRows(convs);
    const convIds = convs.map(c => c.id);

    if (convIds.length === 0) {
      setParticipantsByConv({});
      setMessages([]);
      setLoading(false);
      return;
    }

    const [participantsRes, messagesRes] = await Promise.all([
      supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, joined_at, last_read_at, is_archived')
        .in('conversation_id', convIds),
      supabase
        .from('messages')
        .select('id, conversation_id, tenant_id, sender_id, subject, body, message_type, priority, related_entity_type, related_entity_id, metadata, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(2000),
    ]);

    if (participantsRes.error) {
      console.warn('[useMessages] participant fetch failed:', participantsRes.error);
    }
    if (messagesRes.error) {
      console.warn('[useMessages] messages fetch failed:', messagesRes.error);
    }

    const participantRows = (participantsRes.data ?? []) as ParticipantRow[];
    const participantsByConvId = new Map<string, ParticipantRow[]>();
    for (const p of participantRows) {
      const arr = participantsByConvId.get(p.conversation_id) ?? [];
      arr.push(p);
      participantsByConvId.set(p.conversation_id, arr);
    }
    setParticipantsByConv(Object.fromEntries(participantsByConvId));

    const msgRows = (messagesRes.data ?? []) as MessageRow[];

    let recipientsByMsg = new Map<string, RecipientRow[]>();
    if (msgRows.length > 0) {
      const { data: rcpData } = await supabase
        .from('message_recipients')
        .select('id, message_id, recipient_type, recipient_id, user_id, is_read, read_at, is_archived, created_at')
        .in('message_id', msgRows.map(m => m.id));
      for (const r of (rcpData ?? []) as RecipientRow[]) {
        const arr = recipientsByMsg.get(r.message_id) ?? [];
        arr.push(r);
        recipientsByMsg.set(r.message_id, arr);
      }
    }

    // Profiles for every user we'll display: senders + every participant
    // across every conversation. Fetched in one query.
    const userIds = new Set<string>();
    for (const m of msgRows) userIds.add(m.sender_id);
    for (const p of participantRows) userIds.add(p.user_id);
    const profileCache = new Map<string, ProfileRow>();
    if (userIds.size > 0) {
      const { data: profData } = await supabase
        .from('profiles')
        .select('id, email, display_name, role')
        .in('id', Array.from(userIds));
      for (const p of (profData ?? []) as ProfileRow[]) profileCache.set(p.id, p);
    }
    if (profileCache.size > 0) {
      setProfilesByUid(prev => {
        const next = { ...prev };
        profileCache.forEach((p, id) => { next[id] = p; });
        return next;
      });
    }

    const hydrated = await hydrateMessages(msgRows, recipientsByMsg, participantsByConvId, authUserId, profileCache);
    setMessages(hydrated);
    setLoading(false);
  }, [authUserId, hydrateMessages]);

  useEffect(() => { void refetch(); }, [refetch]);

  // ── Realtime ────────────────────────────────────────────────────────────
  // One channel, one subscription. Server-side filters on UUID columns
  // are unreliable on Supabase's replication stream, so we accept every
  // event RLS lets through and refetch unconditionally — RLS already
  // restricts what we see to our own conversations + recipient rows, so
  // the noise floor is low.
  useEffect(() => {
    if (!authUserId) return;
    const channel = supabase
      .channel(`messages_inbox_${authUserId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => {
          void refetch();
          const activeKey = activeThreadKeyRef.current;
          if (activeKey) void openThreadRef.current?.(activeKey);
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_recipients' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { user_id?: string } | undefined;
          if (row?.user_id === authUserId) {
            // My own row — new incoming message or my own read flip.
            void refetch();
            const activeKey = activeThreadKeyRef.current;
            if (activeKey) void openThreadRef.current?.(activeKey);
          } else {
            // Read-receipt flip on a message I sent (RLS lets me see
            // peers' recipient rows on my own messages). Reload only the
            // active thread so the Delivered/Read line updates without
            // a full inbox refetch.
            const activeKey = activeThreadKeyRef.current;
            if (activeKey) void openThreadRef.current?.(activeKey);
          }
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_participants' },
        () => {
          // New conversation we were just added to, or our own
          // last_read_at flipped — refetch covers both.
          void refetch();
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Catch up on anything we missed during channel setup.
          void refetch();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[useMessages] Realtime status:', status);
        }
      });
    return () => { void supabase.removeChannel(channel); };
  }, [authUserId, refetch]);

  // ── Derived: conversation list ──────────────────────────────────────────
  // One row per `conversations` row, decorated with the latest message
  // preview + my unread count for that conversation.
  const conversations = useMemo<Conversation[]>(() => {
    if (!authUserId) return [];

    // Bucket messages by conversation_id so we can pull last-preview +
    // unread counts in one pass.
    const msgsByConv = new Map<string, Message[]>();
    for (const m of messages) {
      if (!m.conversationId) continue;
      const arr = msgsByConv.get(m.conversationId) ?? [];
      arr.push(m);
      msgsByConv.set(m.conversationId, arr);
    }

    return conversationRows
      .map((c): Conversation | null => {
        const convMessages = msgsByConv.get(c.id) ?? [];
        const sorted = convMessages.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const latest = sorted[0];
        const participants = participantsByConv[c.id] ?? [];
        const myParticipant = participants.find(p => p.user_id === authUserId);

        // Filter out conversations I've archived (per-user soft delete).
        if (myParticipant?.is_archived) return null;

        const unread = sorted.reduce((n, m) => n + (m.myRecipient && !m.myRecipient.isRead ? 1 : 0), 0);
        const participantUserIds = participants.map(p => p.user_id);

        // Title resolution. Entity threads → "RE: <Type> <Id>". DMs →
        // the other party's display name. Groups → comma-joined names.
        let title: string;
        if (c.related_entity_type && c.related_entity_id) {
          title = `RE: ${c.related_entity_type} ${c.related_entity_id}`;
        } else {
          const others = participantUserIds.filter(u => u !== authUserId);
          const names = others.map(u => {
            const p = profilesByUid[u];
            return p?.display_name || p?.email || `${u.slice(0, 6)}…`;
          });
          if (others.length === 0) {
            title = 'You';
          } else if (others.length === 1) {
            title = names[0];
          } else if (others.length <= 3) {
            title = names.join(', ');
          } else {
            title = `${names.slice(0, 2).join(', ')} & ${names.length - 2} others`;
          }
        }

        const lastMessageAt = latest?.createdAt ?? c.last_message_at ?? c.created_at;
        const lastMessagePreview = latest?.body.slice(0, 140) ?? '';

        return {
          key: c.id,
          relatedEntityType: c.related_entity_type,
          relatedEntityId: c.related_entity_id,
          entityType: c.related_entity_type,
          entityId: c.related_entity_id,
          threadId: null,
          title,
          lastMessagePreview,
          lastMessageAt,
          unreadCount: unread,
          participantUserIds,
        };
      })
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  }, [conversationRows, messages, participantsByConv, profilesByUid, authUserId]);

  const unreadCount = useMemo(
    () => messages.reduce((n, m) => n + (m.myRecipient && !m.myRecipient.isRead ? 1 : 0), 0),
    [messages],
  );

  // ── Open a thread ───────────────────────────────────────────────────────
  // Two paths:
  //   • String key (conversation UUID, or `entity:<type>:<id>` /
  //     `direct:<a>:<b>` legacy formats from saved deep links) → resolve
  //     to a conversation row, filter messages.
  //   • Object form → translate to RPC arguments, find/create the
  //     conversation, then load it.
  const findConversationByKey = useCallback((key: string): ConversationRow | null => {
    // New format: bare UUID → direct conversation_id lookup.
    const direct = conversationRows.find(c => c.id === key);
    if (direct) return direct;
    // Legacy "entity:<type>:<id>" deep-link key → lookup by entity.
    if (key.startsWith('entity:')) {
      const parts = key.split(':');
      const type = parts[1];
      const id = parts.slice(2).join(':');
      return conversationRows.find(c => c.related_entity_type === type && c.related_entity_id === id) ?? null;
    }
    return null;
  }, [conversationRows]);

  const openThread = useCallback(async (
    target: string | { entityType?: string; entityId?: string; otherUserId?: string; otherUserIds?: string[]; conversationId?: string },
  ) => {
    if (!authUserId) return;

    let conversationId: string | null = null;

    if (typeof target === 'string') {
      const conv = findConversationByKey(target);
      conversationId = conv?.id ?? null;
    } else if (target.conversationId) {
      conversationId = target.conversationId;
    } else if (target.entityType && target.entityId) {
      // Find existing entity conversation in-memory. If absent, call the
      // RPC (find-or-create) — user may be deep-linking to an entity
      // they've never messaged about before.
      const existing = conversationRows.find(c =>
        c.related_entity_type === target.entityType && c.related_entity_id === target.entityId,
      );
      if (existing) {
        conversationId = existing.id;
      } else {
        const tenantId = user?.clientSheetId || '_platform';
        const { data: rpcId, error: rpcErr } = await supabase.rpc('find_or_create_entity_conversation', {
          p_entity_type: target.entityType,
          p_entity_id: target.entityId,
          p_tenant_id: tenantId,
          p_other_user_ids: [],
        });
        if (rpcErr) {
          console.error('[useMessages] openThread entity RPC failed:', rpcErr);
          return;
        }
        conversationId = rpcId as string;
        await refetch();
      }
    } else {
      // DM/group target — gather the participant set, look up locally,
      // fall back to the RPC.
      const others = target.otherUserIds && target.otherUserIds.length > 0
        ? target.otherUserIds.filter(u => u !== authUserId)
        : (target.otherUserId ? [target.otherUserId] : []);
      if (others.length === 0) return;
      const wantSet = new Set([authUserId, ...others]);
      const existing = conversationRows.find(c => {
        if (c.related_entity_type !== null) return false;
        const ps = participantsByConv[c.id] ?? [];
        if (ps.length !== wantSet.size) return false;
        return ps.every(p => wantSet.has(p.user_id));
      });
      if (existing) {
        conversationId = existing.id;
      } else {
        const tenantId = user?.clientSheetId || '_platform';
        const { data: rpcId, error: rpcErr } = await supabase.rpc('find_or_create_dm_conversation', {
          p_other_user_ids: others,
          p_tenant_id: tenantId,
        });
        if (rpcErr) {
          console.error('[useMessages] openThread DM RPC failed:', rpcErr);
          return;
        }
        conversationId = rpcId as string;
        await refetch();
      }
    }

    if (!conversationId) {
      setThread([]);
      setActiveThreadKey(null);
      return;
    }

    setActiveThreadKey(conversationId);
    setThreadLoading(true);
    // Read from messagesRef instead of the closure-captured `messages` —
    // when openThread runs after `await refetch()` (the cold-create path
    // for brand-new conversations), state hasn't flushed yet but the ref
    // has been updated by refetch's setMessages. Reading the ref makes
    // the new conversation's messages appear immediately rather than on
    // the next realtime tick.
    const source = messagesRef.current.length > 0 ? messagesRef.current : messages;
    const matched = source
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    setThread(matched);
    setThreadLoading(false);
  }, [authUserId, messages, conversationRows, participantsByConv, findConversationByKey, refetch, user]);

  useEffect(() => { openThreadRef.current = (key: string) => openThread(key); }, [openThread]);

  const closeThread = useCallback(() => {
    setActiveThreadKey(null);
    setThread([]);
  }, []);

  // ── Send ────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (params: SendMessageParams): Promise<Message | null> => {
    if (!authUserId) return null;
    const body = params.body.trim();
    if (!body) return null;

    const tenantId = user?.clientSheetId || '_platform';

    // 1. Resolve conversationId: caller-provided > entity > DM/group RPC.
    let conversationId: string | null = params.conversationId ?? null;
    if (!conversationId) {
      if (params.entityType && params.entityId) {
        const { data, error } = await supabase.rpc('find_or_create_entity_conversation', {
          p_entity_type: params.entityType,
          p_entity_id: params.entityId,
          p_tenant_id: tenantId,
          p_other_user_ids: params.recipientIds.filter(u => u !== authUserId),
        });
        if (error || !data) {
          console.error('[useMessages] sendMessage entity RPC failed:', error);
          return null;
        }
        conversationId = data as string;
      } else if (params.recipientIds.length > 0) {
        const others = params.recipientIds.filter(u => u !== authUserId);
        if (others.length === 0) return null;
        const { data, error } = await supabase.rpc('find_or_create_dm_conversation', {
          p_other_user_ids: others,
          p_tenant_id: tenantId,
        });
        if (error || !data) {
          console.error('[useMessages] sendMessage DM RPC failed:', error);
          return null;
        }
        conversationId = data as string;
      } else {
        console.warn('[useMessages] sendMessage: no conversationId / entityType / recipientIds');
        return null;
      }
    }

    // 2. INSERT the message. Only round-trip the id back; messages_select_via_conversation
    //    succeeds at this point because the RPC guaranteed our participant
    //    row exists.
    const { data: inserted, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        tenant_id: tenantId,
        sender_id: authUserId,
        body,
        subject: params.subject ?? null,
        message_type: params.messageType ?? 'message',
        priority: params.priority ?? 'normal',
        related_entity_type: params.entityType ?? null,
        related_entity_id: params.entityId ?? null,
        metadata: {},
      })
      .select('id')
      .single();
    if (msgErr || !inserted) {
      console.error('[useMessages] sendMessage failed to insert into messages:', msgErr);
      return null;
    }

    // 3. INSERT recipient rows for every NON-SENDER participant. These
    //    drive the per-message Delivered/Read receipts that MessageBubble
    //    renders. We pull the participant list from local state — RPC
    //    just seeded it, so it should be up-to-date after the next
    //    refetch, but we may need a fallback to params.recipientIds
    //    when the conversation was just created and local state hasn't
    //    caught up yet.
    let participantIds: string[] = participantsByConv[conversationId]?.map(p => p.user_id) ?? [];
    if (participantIds.length === 0) {
      // Brand-new conversation just created via RPC — rebuild from
      // params (caller's `recipientIds` always includes everyone except
      // the sender).
      participantIds = Array.from(new Set([authUserId, ...params.recipientIds]));
    }
    const nonSender = participantIds.filter(u => u !== authUserId);
    if (nonSender.length > 0) {
      const rcpRows = nonSender.map(uid => ({
        message_id: inserted.id,
        recipient_type: 'user',
        recipient_id: uid,
        user_id: uid,
        is_read: false,
        read_at: null,
        is_archived: false,
      }));
      const { error: rcpErr } = await supabase.from('message_recipients').insert(rcpRows);
      if (rcpErr) {
        // Don't fail the whole send — the message is already in the DB
        // and visible via conversation_participants. Read receipts will
        // just be missing for this row. Log + move on.
        console.warn('[useMessages] sendMessage: failed to fan out message_recipients:', rcpErr);
      }
    }

    // 4. Refetch + reload active thread.
    await refetch();
    const activeKey = activeThreadKeyRef.current;
    if (activeKey) void openThreadRef.current?.(activeKey);

    // Minimal stub return — callers (MessagesPage.handleCompose) only
    // check `if (msg)` to decide whether to navigate.
    return {
      id: inserted.id,
      conversationId,
      tenantId,
      relatedEntityType: params.entityType ?? null,
      relatedEntityId: params.entityId ?? null,
      subject: params.subject ?? null,
      body,
      messageType: params.messageType ?? 'message',
      priority: params.priority ?? 'normal',
      senderId: authUserId,
      senderName: '',
      senderEmail: '',
      senderRole: null,
      createdAt: new Date().toISOString(),
      recipientUserIds: participantIds,
      recipientReads: [],
    };
  }, [authUserId, user, refetch, participantsByConv]);

  // ── Read / archive ──────────────────────────────────────────────────────
  const markRead = useCallback(async (recipientRowId: string) => {
    const now = new Date().toISOString();
    await supabase
      .from('message_recipients')
      .update({ is_read: true, read_at: now })
      .eq('id', recipientRowId);
    setMessages(prev => prev.map(m =>
      m.myRecipient?.recipientId === recipientRowId
        ? { ...m, myRecipient: { ...m.myRecipient, isRead: true, readAt: now } }
        : m,
    ));
    setThread(prev => prev.map(m =>
      m.myRecipient?.recipientId === recipientRowId
        ? { ...m, myRecipient: { ...m.myRecipient, isRead: true, readAt: now } }
        : m,
    ));
  }, []);

  const markAllReadInThread = useCallback(async () => {
    const unread = thread
      .map(m => m.myRecipient)
      .filter((r): r is NonNullable<Message['myRecipient']> => !!r && !r.isRead);
    if (unread.length === 0) return;
    await Promise.all(unread.map(r => markRead(r.recipientId)));
    // Also bump the participant's last_read_at — used by future
    // unread-since-cursor optimizations.
    const activeKey = activeThreadKeyRef.current;
    if (activeKey && authUserId) {
      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', activeKey)
        .eq('user_id', authUserId);
    }
  }, [thread, markRead, authUserId]);

  const archiveMessage = useCallback(async (recipientRowId: string) => {
    await supabase
      .from('message_recipients')
      .update({ is_archived: true })
      .eq('id', recipientRowId);
    setMessages(prev => prev.filter(m => m.myRecipient?.recipientId !== recipientRowId));
  }, []);

  const deleteConversation = useCallback(async (key: string): Promise<boolean> => {
    if (!authUserId) return false;
    // Per-user soft-delete: flip is_archived on my conversation_participants
    // row. The other party's copy is untouched.
    const { error } = await supabase
      .from('conversation_participants')
      .update({ is_archived: true })
      .eq('conversation_id', key)
      .eq('user_id', authUserId);
    if (error) {
      console.error('[useMessages] deleteConversation failed:', error);
      return false;
    }
    if (activeThreadKey === key) {
      setActiveThreadKey(null);
      setThread([]);
    }
    await refetch();
    return true;
  }, [authUserId, activeThreadKey, refetch]);

  // ── Top-banner state ────────────────────────────────────────────────────
  const [dismissedBannerIds, setDismissedBannerIds] = useState<Set<string>>(new Set());
  const dismissBanner = useCallback((messageId: string) => {
    setDismissedBannerIds(prev => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
  }, []);

  const latestUnreadIncoming = useMemo<Message | null>(() => {
    if (!authUserId) return null;
    let newest: Message | null = null;
    for (const m of messages) {
      if (m.senderId === authUserId) continue;
      if (!m.myRecipient || m.myRecipient.isRead) continue;
      if (dismissedBannerIds.has(m.id)) continue;
      if (!newest || m.createdAt > newest.createdAt) newest = m;
    }
    return newest;
  }, [messages, authUserId, dismissedBannerIds]);

  return useMemo(() => ({
    authUserId,
    conversations,
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
    deleteConversation,
    refetch,
    latestUnreadIncoming,
    dismissBanner,
  }), [authUserId, conversations, thread, threadLoading, loading, unreadCount, activeThreadKey,
       openThread, closeThread, sendMessage, markRead, markAllReadInThread, archiveMessage,
       deleteConversation, refetch, latestUnreadIncoming, dismissBanner]);
}

// ─── Provider + public hook ────────────────────────────────────────────────
// Single shared instance pattern. AppLayout wraps the app in
// <MessagesProvider> — every consumer (TopBar bell, banner, MessagesPage)
// reads from the same Context, so there's exactly one Supabase Realtime
// channel for the whole app and one inbox refetch per event.

const MessagesContext = createContext<UseMessagesResult | null>(null);

export function MessagesProvider({ children }: { children: ReactNode }) {
  const value = useMessagesImpl();
  return createElement(MessagesContext.Provider, { value }, children);
}

export function useMessages(): UseMessagesResult {
  const ctx = useContext(MessagesContext);
  if (!ctx) {
    // Defensive fallback for orphan consumers (Storybook, isolated
    // tests). Functional but unshared — costs one channel per consumer.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMessagesImpl();
  }
  return ctx;
}
