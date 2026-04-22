/**
 * useMessages — Supabase CRUD for public.messages backed by the
 * conversations + conversation_participants model (Session 78 redesign).
 *
 * Threading model: every message belongs to a stored `conversation` row.
 * Membership is a stored fact in `conversation_participants`, not derived
 * from recipient visibility. RLS reads via "are you a participant in the
 * conversation"; this is symmetric so outgoing messages no longer
 * disappear when the other party's recipient row is hidden by RLS.
 *
 * `message_recipients` is still written + read for unread tracking and
 * back-compat with legacy code paths. It can be retired once unread
 * tracking moves to `conversation_participants.last_read_at`.
 *
 *   conversations:
 *     id uuid PK, kind ('dm'|'group'|'entity'),
 *     related_entity_type text, related_entity_id text,
 *     tenant_id text, created_by uuid, created_at, last_message_at
 *
 *   conversation_participants:
 *     conversation_id uuid, user_id uuid, joined_at, last_read_at, is_archived
 *     PK (conversation_id, user_id)
 *
 *   messages:
 *     id uuid PK, tenant_id text NOT NULL, sender_id uuid NOT NULL,
 *     conversation_id uuid REFERENCES conversations(id),
 *     subject, body, message_type, priority,
 *     related_entity_type, related_entity_id, metadata, created_at
 *
 *   message_recipients (legacy, still in use for unread/archive):
 *     id uuid PK, message_id uuid, user_id uuid, is_read, read_at, is_archived
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string | null;
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
  myRecipient?: {
    recipientId: string;
    isRead: boolean;
    readAt: string | null;
    isArchived: boolean;
  };
  /** All user_ids on the message — pulled from conversation_participants
   *  (authoritative) rather than message_recipients (RLS-hidden for the
   *  other party on outgoing messages). */
  recipientUserIds: string[];
}

export interface Conversation {
  /** `entity:<type>:<id>` for entity-linked, `direct:<uidA>:<uidB>` (sorted)
   *  for DMs. Used as React key + passed back to openThread. */
  key: string;
  /** Underlying conversation UUID. Useful for direct queries. */
  conversationId: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  entityType: string | null;
  entityId: string | null;
  threadId: string | null;
  title: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface SendMessageParams {
  body: string;
  recipientIds: string[];
  recipientNames?: string[];
  subject?: string;
  entityType?: string;
  entityId?: string;
  threadId?: string;
  priority?: string;
  messageType?: string;
}

// ─── Row shapes ────────────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  tenant_id: string;
  sender_id: string;
  conversation_id: string | null;
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

interface ConversationRow {
  id: string;
  kind: 'dm' | 'group' | 'entity';
  related_entity_type: string | null;
  related_entity_id: string | null;
  tenant_id: string | null;
  last_message_at: string | null;
}

interface ParticipantRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  is_archived: boolean | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function directKey(selfId: string, otherId: string): string {
  return selfId < otherId ? `direct:${otherId}:${selfId}` : `direct:${selfId}:${otherId}`;
}

/** Build the canonical string key for a conversation row, given my uid +
 *  the conversation's participants. */
function keyForConversation(
  conv: ConversationRow,
  participantUserIds: string[],
  selfId: string,
): string | null {
  if (conv.kind === 'entity') {
    if (!conv.related_entity_type || !conv.related_entity_id) return null;
    return `entity:${conv.related_entity_type}:${conv.related_entity_id}`;
  }
  if (conv.kind === 'dm') {
    const others = participantUserIds.filter(u => u !== selfId);
    if (others.length === 0) {
      // Self-DM
      return directKey(selfId, selfId);
    }
    return directKey(selfId, others[0]);
  }
  // Group: stable key from sorted participants.
  const sorted = [...participantUserIds].sort();
  return `group:${sorted.join(':')}`;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface UseMessagesResult {
  authUserId: string | null;
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
  deleteConversation: (key: string) => Promise<boolean>;
  refetch: () => Promise<void>;
  latestUnreadIncoming: Message | null;
  dismissBanner: (messageId: string) => void;
}

function useMessagesImpl(): UseMessagesResult {
  const { user } = useAuth();
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationRows, setConversationRows] = useState<ConversationRow[]>([]);
  const [participantsByConv, setParticipantsByConv] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [profilesByUid, setProfilesByUid] = useState<Record<string, ProfileRow>>({});
  const openThreadRef = useRef<((key: string) => Promise<void>) | null>(null);
  const activeThreadKeyRef = useRef<string | null>(null);
  useEffect(() => { activeThreadKeyRef.current = activeThreadKey; }, [activeThreadKey]);

  // Cache: legacy string key → conversation UUID. Built from conversations
  // + participants on every refetch.
  const keyToConvIdRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthUserId(data.session?.user.id ?? null);
    });
  }, [user]);

  // ── Hydrate messages with profile names + (optional) per-message recipients ──
  // Uses conversation participants for the recipientUserIds list (authoritative)
  // and message_recipients only for the per-user `myRecipient` row (used for
  // is_read/is_archived tracking).
  const hydrate = useCallback(async (
    msgRows: MessageRow[],
    selfId: string,
    convParticipants?: Record<string, string[]>,
  ): Promise<Message[]> => {
    if (msgRows.length === 0) return [];
    const msgIds = msgRows.map(m => m.id);

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

    const userIds = new Set<string>();
    for (const m of msgRows) userIds.add(m.sender_id);
    for (const r of recipients) userIds.add(r.user_id);
    if (convParticipants) {
      for (const list of Object.values(convParticipants)) for (const u of list) userIds.add(u);
    }
    const profileMap = new Map<string, ProfileRow>();
    if (userIds.size > 0) {
      const { data: profData } = await supabase
        .from('profiles')
        .select('id, email, display_name, role')
        .in('id', Array.from(userIds));
      for (const p of (profData ?? []) as ProfileRow[]) profileMap.set(p.id, p);
    }
    if (profileMap.size > 0) {
      setProfilesByUid(prev => {
        const next = { ...prev };
        profileMap.forEach((p, id) => { next[id] = p; });
        return next;
      });
    }

    return msgRows.map(m => {
      const rcps = recipsByMsg.get(m.id) ?? [];
      const mine = rcps.find(r => r.user_id === selfId);
      const profile = profileMap.get(m.sender_id);
      // Prefer conversation participants for the full recipient list
      // (authoritative; works even when message_recipients hides the
      // other party via RLS). Fallback to message_recipients for messages
      // without a conversation_id (legacy/edge cases).
      const fromConv = m.conversation_id && convParticipants
        ? convParticipants[m.conversation_id]
        : null;
      const recipientUserIds = fromConv && fromConv.length > 0
        ? fromConv
        : rcps.map(r => r.user_id);
      return {
        id: m.id,
        tenantId: m.tenant_id,
        conversationId: m.conversation_id,
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
        recipientUserIds,
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

    // 1. Load conversations I'm a participant in (RLS-filtered).
    const { data: convData, error: convErr } = await supabase
      .from('conversations')
      .select('id, kind, related_entity_type, related_entity_id, tenant_id, last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(500);
    if (convErr) {
      console.warn('[useMessages] conversations load failed:', convErr);
    }
    const convs = (convData ?? []) as ConversationRow[];
    setConversationRows(convs);

    // 2. Load all participants for those conversations.
    const convIds = convs.map(c => c.id);
    const partsByConv: Record<string, string[]> = {};
    if (convIds.length > 0) {
      const { data: partData } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, last_read_at, is_archived')
        .in('conversation_id', convIds);
      for (const p of ((partData ?? []) as ParticipantRow[])) {
        const arr = partsByConv[p.conversation_id] ?? [];
        arr.push(p.user_id);
        partsByConv[p.conversation_id] = arr;
      }
    }
    setParticipantsByConv(partsByConv);

    // 3. Build the key→convId cache.
    const keyMap = new Map<string, string>();
    for (const c of convs) {
      const k = keyForConversation(c, partsByConv[c.id] ?? [], authUserId);
      if (k) keyMap.set(k, c.id);
    }
    keyToConvIdRef.current = keyMap;

    // 4. Load messages I can see — RLS now passes anything in a conversation
    //    I'm a participant in (plus my own sent + legacy recipient-based).
    const { data: msgData, error: msgErr } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (msgErr || !msgData) { setLoading(false); return; }

    const hydrated = await hydrate(msgData as MessageRow[], authUserId, partsByConv);
    const inbox = hydrated.filter(m => !m.myRecipient?.isArchived);
    setMessages(inbox);
    setLoading(false);
  }, [authUserId, hydrate]);

  useEffect(() => { void refetch(); }, [refetch]);

  // ── Realtime ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUserId) return;
    const channel = supabase
      .channel(`messages_inbox_${authUserId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
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
            void refetch();
            const activeKey = activeThreadKeyRef.current;
            if (activeKey) void openThreadRef.current?.(activeKey);
          }
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_participants' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { user_id?: string } | undefined;
          if (row?.user_id === authUserId) void refetch();
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void refetch();
          const activeKey = activeThreadKeyRef.current;
          if (activeKey) void openThreadRef.current?.(activeKey);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[useMessages] Realtime status:', status);
        }
      });
    return () => { void supabase.removeChannel(channel); };
  }, [authUserId, refetch]);

  // ── Derived conversation list ───────────────────────────────────────────
  const conversations = useMemo<Conversation[]>(() => {
    if (!authUserId) return [];

    // Index latest message per conversation_id, plus unread count.
    const latestByConv = new Map<string, Message>();
    const unreadByConv = new Map<string, number>();
    for (const m of messages) {
      if (!m.conversationId) continue;
      const existing = latestByConv.get(m.conversationId);
      if (!existing || m.createdAt > existing.createdAt) latestByConv.set(m.conversationId, m);
      if (m.myRecipient && !m.myRecipient.isRead) {
        unreadByConv.set(m.conversationId, (unreadByConv.get(m.conversationId) ?? 0) + 1);
      }
    }

    const out: Conversation[] = [];
    for (const c of conversationRows) {
      const parts = participantsByConv[c.id] ?? [];
      const key = keyForConversation(c, parts, authUserId);
      if (!key) continue;
      const last = latestByConv.get(c.id);
      const lastAt = c.last_message_at ?? last?.createdAt ?? '';
      // Title: entity → "RE: <type> <id>"; DM → other party's name (or uid).
      let title: string;
      if (c.kind === 'entity' && c.related_entity_type && c.related_entity_id) {
        title = `RE: ${c.related_entity_type} ${c.related_entity_id}`;
      } else if (c.kind === 'dm') {
        const otherUid = parts.find(u => u !== authUserId) ?? authUserId;
        const profile = profilesByUid[otherUid];
        title = profile?.display_name || profile?.email || (otherUid === authUserId ? 'Me' : `${otherUid.slice(0, 6)}…`);
      } else {
        const others = parts.filter(u => u !== authUserId);
        const names = others.map(u => profilesByUid[u]?.display_name || profilesByUid[u]?.email || u.slice(0, 6));
        title = names.join(', ') || 'Group';
      }
      out.push({
        key,
        conversationId: c.id,
        relatedEntityType: c.related_entity_type,
        relatedEntityId: c.related_entity_id,
        entityType: c.related_entity_type,
        entityId: c.related_entity_id,
        threadId: null,
        title,
        lastMessagePreview: last?.body.slice(0, 140) ?? '',
        lastMessageAt: lastAt,
        unreadCount: unreadByConv.get(c.id) ?? 0,
      });
    }
    return out.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  }, [conversationRows, participantsByConv, messages, authUserId, profilesByUid]);

  const unreadCount = useMemo(
    () => messages.reduce((n, m) => n + (m.myRecipient && !m.myRecipient.isRead ? 1 : 0), 0),
    [messages],
  );

  // ── Resolve a string key to a conversation UUID (creates lookups via DB
  //    if not in cache — handles deep links into conversations the user
  //    just regained access to). ───────────────────────────────────────────
  const resolveConversationId = useCallback(async (key: string, selfId: string): Promise<string | null> => {
    const cached = keyToConvIdRef.current.get(key);
    if (cached) return cached;

    if (key.startsWith('entity:')) {
      const parts = key.split(':');
      const type = parts[1];
      const id = parts.slice(2).join(':');
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .eq('kind', 'entity')
        .eq('related_entity_type', type)
        .eq('related_entity_id', id)
        .maybeSingle();
      if (data?.id) {
        keyToConvIdRef.current.set(key, data.id);
        return data.id;
      }
      return null;
    }

    if (key.startsWith('direct:')) {
      const [, a, b] = key.split(':');
      const other = a === selfId ? b : a;
      // Find a DM conversation where I'm a participant, then check which
      // of those `other` is also in.
      const { data: mine } = await supabase
        .from('conversation_participants')
        .select('conversation_id, conversations!inner(kind)')
        .eq('user_id', selfId);
      const myDmIds = (mine ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((r: any) => r.conversations?.kind === 'dm')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r.conversation_id as string);
      if (myDmIds.length === 0) return null;
      const { data: shared } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', other)
        .in('conversation_id', myDmIds);
      const matchId = (shared && shared[0]?.conversation_id) || null;
      if (matchId) {
        keyToConvIdRef.current.set(key, matchId);
        return matchId;
      }
      return null;
    }

    return null;
  }, []);

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

    const convId = await resolveConversationId(key, authUserId);
    if (!convId) {
      // No conversation yet — empty thread. First send will create one.
      setThread([]);
      setThreadLoading(false);
      return;
    }

    // Single clean query — RLS guarantees we can only see messages in
    // conversations we participate in, so no client-side filter required.
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error || !data) { setThread([]); setThreadLoading(false); return; }

    // Hydrate using the participants we already loaded (or fetch on the fly
    // if this conversation wasn't in the inbox set).
    let parts = participantsByConv[convId];
    if (!parts) {
      const { data: pData } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', convId);
      parts = (pData ?? []).map(r => (r as { user_id: string }).user_id);
    }
    const hydrated = await hydrate(
      data as MessageRow[],
      authUserId,
      { [convId]: parts },
    );
    setThread(hydrated);
    setThreadLoading(false);
  }, [authUserId, hydrate, participantsByConv, resolveConversationId]);

  useEffect(() => { openThreadRef.current = (key: string) => openThread(key); }, [openThread]);

  const closeThread = useCallback(() => {
    setActiveThreadKey(null);
    setThread([]);
  }, []);

  // ── Find or create a conversation for a send ────────────────────────────
  const ensureConversation = useCallback(async (
    selfId: string,
    recipientIds: string[],
    entityType: string | null,
    entityId: string | null,
    tenantId: string,
  ): Promise<string | null> => {
    // Entity conversation
    if (entityType && entityId) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('kind', 'entity')
        .eq('related_entity_type', entityType)
        .eq('related_entity_id', entityId)
        .maybeSingle();
      let convId = existing?.id as string | undefined;
      if (!convId) {
        const { data: created, error } = await supabase
          .from('conversations')
          .insert({
            kind: 'entity',
            related_entity_type: entityType,
            related_entity_id: entityId,
            tenant_id: tenantId,
            created_by: selfId,
          })
          .select('id')
          .single();
        if (error || !created) {
          // Possible race — another sender just created it. Re-query.
          const { data: retry } = await supabase
            .from('conversations')
            .select('id')
            .eq('kind', 'entity')
            .eq('related_entity_type', entityType)
            .eq('related_entity_id', entityId)
            .maybeSingle();
          convId = retry?.id;
        } else {
          convId = created.id;
        }
      }
      if (!convId) return null;
      await ensureParticipants(convId, [selfId, ...recipientIds]);
      return convId;
    }

    // DM/group: signature = sorted unique participant uids
    const participants = Array.from(new Set([selfId, ...recipientIds])).sort();
    const isDm = participants.length <= 2;
    const kind: 'dm' | 'group' = isDm ? 'dm' : 'group';

    // Look up by participant set: get my conversations of this kind, then
    // load all their participants and find one whose set matches exactly.
    const { data: mine } = await supabase
      .from('conversation_participants')
      .select('conversation_id, conversations!inner(kind)')
      .eq('user_id', selfId);
    const myConvIds = (mine ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => r.conversations?.kind === kind)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => r.conversation_id as string);

    if (myConvIds.length > 0) {
      const { data: allParts } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .in('conversation_id', myConvIds);
      const byConv = new Map<string, string[]>();
      for (const r of (allParts ?? [])) {
        const row = r as { conversation_id: string; user_id: string };
        const arr = byConv.get(row.conversation_id) ?? [];
        arr.push(row.user_id);
        byConv.set(row.conversation_id, arr);
      }
      for (const [convId, users] of byConv.entries()) {
        const sortedUsers = [...users].sort();
        if (sortedUsers.length === participants.length &&
            sortedUsers.every((u, i) => u === participants[i])) {
          return convId;
        }
      }
    }

    // No match — create.
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ kind, tenant_id: tenantId, created_by: selfId })
      .select('id')
      .single();
    if (error || !created) {
      console.error('[useMessages] ensureConversation: insert failed:', error);
      return null;
    }
    await ensureParticipants(created.id, participants);
    return created.id;
  }, []);

  const ensureParticipants = async (convId: string, userIds: string[]) => {
    if (userIds.length === 0) return;
    const rows = Array.from(new Set(userIds)).map(uid => ({
      conversation_id: convId,
      user_id: uid,
    }));
    await supabase.from('conversation_participants').upsert(rows, {
      onConflict: 'conversation_id,user_id',
      ignoreDuplicates: true,
    });
  };

  // ── Send ────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (params: SendMessageParams): Promise<Message | null> => {
    if (!authUserId) return null;
    const body = params.body.trim();
    if (!body) return null;

    const tenantId = user?.clientSheetId || '_platform';
    const relatedEntityType = params.entityType ?? null;
    const relatedEntityId = params.entityId ?? null;

    const convId = await ensureConversation(
      authUserId,
      params.recipientIds,
      relatedEntityType,
      relatedEntityId,
      tenantId,
    );
    if (!convId) {
      console.error('[useMessages] sendMessage: failed to ensure conversation');
      return null;
    }

    const { data: msgData, error: msgErr } = await supabase
      .from('messages')
      .insert({
        tenant_id: tenantId,
        sender_id: authUserId,
        conversation_id: convId,
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

    // Legacy recipient rows for unread/archive tracking. Best-effort —
    // failure here should not orphan the message.
    const recipientUserIds = Array.from(new Set([authUserId, ...params.recipientIds]));
    const rcpRows = recipientUserIds.map(uid => ({
      message_id: msgData.id,
      recipient_type: 'user',
      recipient_id: uid,
      user_id: uid,
      is_read: uid === authUserId,
      read_at: uid === authUserId ? new Date().toISOString() : null,
      is_archived: false,
    }));
    if (rcpRows.length > 0) {
      const { error: rcpErr } = await supabase.from('message_recipients').insert(rcpRows);
      if (rcpErr) console.warn('[useMessages] insert recipient rows failed (non-fatal):', rcpErr);
    }

    // Optimistic append using current participant cache (or just the
    // recipient list we sent to — same thing for fresh sends).
    const partsForHydrate = participantsByConv[convId] ?? recipientUserIds;
    const [hydrated] = await hydrate([msgData as MessageRow], authUserId, { [convId]: partsForHydrate });
    if (hydrated) {
      setThread(prev => [...prev, hydrated]);
      setMessages(prev => [hydrated, ...prev]);
    }
    void refetch();
    return hydrated ?? null;
  }, [authUserId, user, hydrate, refetch, ensureConversation, participantsByConv]);

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

  const deleteConversation = useCallback(async (key: string): Promise<boolean> => {
    if (!authUserId) return false;
    const convId = keyToConvIdRef.current.get(key);
    if (!convId) return false;
    const toArchive = messages
      .filter(m => m.conversationId === convId && m.myRecipient)
      .map(m => m.myRecipient!.recipientId);
    if (toArchive.length > 0) {
      const { error } = await supabase
        .from('message_recipients')
        .update({ is_archived: true })
        .in('id', toArchive);
      if (error) {
        console.error('[useMessages] deleteConversation failed:', error);
        return false;
      }
    }
    setMessages(prev => prev.filter(m => m.conversationId !== convId));
    if (activeThreadKey === key) { setActiveThreadKey(null); setThread([]); }
    return true;
  }, [authUserId, messages, activeThreadKey]);

  // ── Top banner ──────────────────────────────────────────────────────────
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

// ─── Context + Provider + public hook ───────────────────────────────────────

const MessagesContext = createContext<UseMessagesResult | null>(null);

export function MessagesProvider({ children }: { children: ReactNode }) {
  const value = useMessagesImpl();
  return createElement(MessagesContext.Provider, { value }, children);
}

export function useMessages(): UseMessagesResult {
  const ctx = useContext(MessagesContext);
  if (!ctx) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMessagesImpl();
  }
  return ctx;
}
