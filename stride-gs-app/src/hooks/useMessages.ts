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
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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

/**
 * Session 74: thread keys MUST be stable across sender/receiver and across
 * every reply in the same conversation. One message = one key, determined
 * by the thread family, never by message id.
 *
 *   • entity conversation → `entity:<type>:<id>`
 *   • direct DM           → `direct:<uidA>:<uidB>` (sorted)
 *   • unkeyable           → null (caller must skip — do NOT bucket it
 *                           under its own message id, that produces one
 *                           conversation row per message)
 *
 * "Unkeyable" happens only for malformed rows (sender = self, zero
 * recipient rows visible) which shouldn't exist in normal use. The old
 * `msg:<id>` fallback is removed because it was the root cause of the
 * "every reply spawns a new chat" symptom: as soon as hydration dropped
 * the self-recipient row for any reason, the key collapsed to
 * msg:<new-message-id> and split the thread.
 */
function keyForMessage(m: Message, selfId: string): string | null {
  if (m.relatedEntityType && m.relatedEntityId) {
    return `entity:${m.relatedEntityType}:${m.relatedEntityId}`;
  }
  const other = otherPartyForMessage(m, selfId);
  if (other) return directKey(selfId, other);
  return null;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface UseMessagesResult {
  /** Supabase auth uid of the currently signed-in user. Exposed so
   *  consumers like MessagesPage can derive recipients / render bubbles
   *  from the same auth source the hook uses — avoids a second
   *  `supabase.auth.getSession()` race that caused sent bubbles to
   *  render as the other party (or send to `undefined`) on first mount. */
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
  /** Session 74: remove a whole conversation for the current user by
   *  archiving every one of their recipient rows in that thread. RLS
   *  guarantees we only affect our own rows. */
  deleteConversation: (key: string) => Promise<boolean>;
  refetch: () => Promise<void>;
  /** The newest unread incoming message (for the top banner). Null if the
   *  user has no unread messages. */
  latestUnreadIncoming: Message | null;
  /** Dismiss the banner for this specific message without marking read
   *  (banner hides until another unread message arrives). */
  dismissBanner: (messageId: string) => void;
}

/**
 * Internal implementation. Do not call directly from components — use the
 * `useMessages` export below which reads from <MessagesProvider>.
 *
 * Session 74: the hook was previously used from three separate mount
 * points (TopBar bell, AppLayout banner, MessagesPage). Each call created
 * a Supabase Realtime channel with the same name (`messages_inbox_<uid>`);
 * Supabase rejected the duplicates with CHANNEL_ERROR, which also meant
 * Realtime events only fired for one instance — or none. The fix is a
 * single shared instance via Context: MessagesProvider calls this impl
 * once, and every consumer reads from the same result.
 */
function useMessagesImpl(): UseMessagesResult {
  const { user } = useAuth();
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  // Session 74: cache profiles by uid so the conversation list can resolve
  // the OTHER party's display name + avatar even for threads where I've only
  // sent messages (no received reply yet). Populated on every hydrate() call.
  const [profilesByUid, setProfilesByUid] = useState<Record<string, ProfileRow>>({});
  // Session 74: ref to the latest openThread so the realtime callback can
  // reload the currently-open thread without re-subscribing on every
  // identity change.
  const openThreadRef = useRef<((key: string) => Promise<void>) | null>(null);
  // Session 74: activeThreadKey mirrored in a ref so the realtime handlers
  // can read the current thread without forcing the channel to re-subscribe
  // on every open/close (which caused CHANNEL_ERROR from the same-name
  // channel collision).
  const activeThreadKeyRef = useRef<string | null>(null);
  useEffect(() => { activeThreadKeyRef.current = activeThreadKey; }, [activeThreadKey]);

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
    // Update the shared profile cache so conversationsWithNames can resolve
    // the OTHER party's name for direct threads (works even for threads
    // where I've only sent messages and never received a reply).
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
    // Session 74 fix: server-side postgres_changes filters on UUID columns
    // are unreliable on Supabase's replication stream — the filter
    // `user_id=eq.<uuid>` often silently matches nothing even with
    // REPLICA IDENTITY FULL. Subscribe WITHOUT a filter and match
    // client-side. RLS still prevents other users' rows from being
    // streamed to us, so we only receive events we're allowed to see.
    //
    // Also: we refetch the thread view when a new incoming message
    // belongs to the currently-open thread, so the receiver's open
    // conversation updates instantly without a page refresh.
    const channel = supabase
      .channel(`messages_inbox_${authUserId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_recipients' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { user_id?: string } | undefined;
          if (row?.user_id === authUserId) {
            void refetch();
            // Reload the active thread if one is open — read the latest key
            // from the ref so this handler doesn't need activeThreadKey as
            // an effect dep (which would force the channel to re-subscribe
            // on every open/close → same-name CHANNEL_ERROR collision).
            const activeKey = activeThreadKeyRef.current;
            if (activeKey) void openThreadRef.current?.(activeKey);
          }
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { sender_id?: string } | undefined;
          if (row?.sender_id === authUserId) {
            void refetch();
            const activeKey = activeThreadKeyRef.current;
            if (activeKey) void openThreadRef.current?.(activeKey);
          }
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[useMessages] Realtime subscribed');
          // Session 74: catch-up refetch on (re)subscribe. If the channel
          // was previously CLOSED (e.g. token refresh, laptop-sleep,
          // intermittent network) events fired during the outage were
          // not delivered. Refetch guarantees the inbox is current the
          // moment realtime is back online — the user never sees stale
          // state just because their WebSocket blinked.
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
    const byKey = new Map<string, Conversation>();

    for (const m of messages) {
      const key = keyForMessage(m, authUserId);
      if (!key) continue;                          // skip unkeyable rows
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

  // Resolve direct-thread titles to the OTHER party's display name.
  // Session 74: instead of only picking names from RECEIVED messages (which
  // left outbound-only threads showing a generic "Message" title), resolve
  // the other party's uid from the key and look them up in the profile
  // cache populated by hydrate().
  const conversationsWithNames = useMemo(() => {
    if (!authUserId) return conversations;
    return conversations.map(c => {
      if (!c.key.startsWith('direct:')) return c;
      const parts = c.key.split(':');
      const [a, b] = [parts[1], parts[2]];
      const otherUid = a === authUserId ? b : a;
      if (!otherUid) return c;
      const profile = profilesByUid[otherUid];
      if (!profile) return c;
      const name = profile.display_name || profile.email || c.title;
      return { ...c, title: name };
    });
  }, [conversations, authUserId, profilesByUid]);

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

    // Session 74 fix: the previous direct-thread query used
    // `.or(sender_id.eq.<self>, sender_id.eq.<other>)` — that leaks any
    // message you sent to a THIRD party into the <self,other> thread
    // because RLS only filters by "I'm on the recipient list", not "the
    // other party is on the recipient list". Correct isolation requires
    // verifying BOTH self AND other appear as recipients on the message.
    //
    // Approach:
    //   • entity threads: filter on (related_entity_type, related_entity_id)
    //     — that's already unambiguous
    //   • direct threads: fetch candidate messages with sender IN (self,
    //     other) AND related_entity_type IS NULL, then fetch all their
    //     recipient rows and keep only those where BOTH self and other
    //     appear as recipients.
    let hydrated: Message[] = [];
    if (key.startsWith('entity:')) {
      const parts = key.split(':');
      const entityType = parts[1];
      const entityId = parts.slice(2).join(':');
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('related_entity_type', entityType)
        .eq('related_entity_id', entityId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error || !data) { setThread([]); setThreadLoading(false); return; }
      hydrated = await hydrate(data as MessageRow[], authUserId);
    } else if (key.startsWith('direct:')) {
      const [, a, b] = key.split(':');
      const other = a === authUserId ? b : a;
      const { data: candData, error: candErr } = await supabase
        .from('messages')
        .select('*')
        .is('related_entity_type', null)
        .or(`sender_id.eq.${authUserId},sender_id.eq.${other}`)
        .order('created_at', { ascending: true })
        .limit(500);
      if (candErr || !candData) { setThread([]); setThreadLoading(false); return; }
      const candidates = candData as MessageRow[];
      if (candidates.length === 0) { setThread([]); setThreadLoading(false); return; }
      // Hydrate (fetches recipients + profile names for every candidate).
      const hydratedCandidates = await hydrate(candidates, authUserId);
      // Session 74 (tightened): keep ONLY messages where the participant
      // set is exactly {self, other} — no third party, no partial rows.
      //
      //   participants = {senderId} ∪ recipientUserIds
      //
      // Must contain self. Must contain other. Must contain nothing else.
      // This is strict 1:1 DM isolation; the earlier broad fallback
      // admitted rows based on partial matches and caused messages from
      // neighboring threads (e.g. sender-only messages missing their
      // recipient row) to leak into the wrong bucket.
      hydrated = hydratedCandidates.filter(m => {
        const participants = new Set<string>([m.senderId, ...m.recipientUserIds]);
        if (!participants.has(authUserId)) return false;
        if (!participants.has(other)) return false;
        // No extra participants allowed (for self-DM other === authUserId
        // so size === 1 is valid; for regular DMs size must be exactly 2).
        const expected = other === authUserId ? 1 : 2;
        if (participants.size !== expected) return false;
        return true;
      });
    }

    setThread(hydrated);
    setThreadLoading(false);
  }, [authUserId, hydrate]);

  // Keep the ref pointing at the latest openThread so the Realtime
  // callback above can reload the active thread without re-subscribing
  // each time openThread's identity changes.
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

  // Session 74: delete a whole conversation for the current user. We mark
  // every one of the user's recipient rows in the thread as archived (RLS
  // msg_recipients_update_own scopes to their own rows) and drop all of
  // their matching messages from local state. The other party's copy is
  // untouched — this is a per-user soft-delete, like iMessage.
  const deleteConversation = useCallback(async (key: string): Promise<boolean> => {
    if (!authUserId) return false;
    const keep: Message[] = [];
    const toArchive: string[] = [];
    for (const m of messages) {
      const mk = keyForMessage(m, authUserId);
      if (mk && mk === key) {
        if (m.myRecipient) toArchive.push(m.myRecipient.recipientId);
      } else {
        keep.push(m);
      }
    }
    if (toArchive.length > 0) {
      const { error } = await supabase
        .from('message_recipients')
        .update({ is_archived: true })
        .in('id', toArchive);
      if (error) {
        console.error('[useMessages] deleteConversation archive failed:', error);
        return false;
      }
    }
    setMessages(keep);
    if (activeThreadKey === key) { setActiveThreadKey(null); setThread([]); }
    return true;
  }, [authUserId, messages, activeThreadKey]);

  // Session 74: top-banner state. Tracks the set of messageIds the user
  // has dismissed so the banner doesn't re-appear after they close it
  // (unless a NEWER unread incoming message arrives).
  const [dismissedBannerIds, setDismissedBannerIds] = useState<Set<string>>(new Set());
  const dismissBanner = useCallback((messageId: string) => {
    setDismissedBannerIds(prev => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
  }, []);

  // Find the single newest unread incoming message (not dismissed). The
  // banner renders when this is non-null and the user isn't currently
  // viewing the messages page (MessagesPage auto-marks-as-read which
  // clears the unread flag and removes the banner anyway).
  const latestUnreadIncoming = useMemo<Message | null>(() => {
    if (!authUserId) return null;
    let newest: Message | null = null;
    for (const m of messages) {
      if (m.senderId === authUserId) continue;                // only incoming
      if (!m.myRecipient || m.myRecipient.isRead) continue;   // only unread
      if (dismissedBannerIds.has(m.id)) continue;              // dismissed
      if (!newest || m.createdAt > newest.createdAt) newest = m;
    }
    return newest;
  }, [messages, authUserId, dismissedBannerIds]);

  return useMemo(() => ({
    authUserId,
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
    deleteConversation,
    refetch,
    latestUnreadIncoming,
    dismissBanner,
  }), [authUserId, conversationsWithNames, thread, threadLoading, loading, unreadCount, activeThreadKey,
       openThread, closeThread, sendMessage, markRead, markAllReadInThread, archiveMessage,
       deleteConversation, refetch, latestUnreadIncoming, dismissBanner]);
}

// ─── Context + Provider + public hook ───────────────────────────────────────
// Session 74: single-instance pattern. MessagesProvider (mount once in
// AppLayout) calls useMessagesImpl and provides the result. The exported
// `useMessages` hook reads from the Context so every consumer — the TopBar
// bell, the MessageTopBanner, the MessagesPage itself — shares ONE hook
// instance and ONE Supabase Realtime channel. Prevents the same-name
// channel collisions that produced CHANNEL_ERROR.

const MessagesContext = createContext<UseMessagesResult | null>(null);

export function MessagesProvider({ children }: { children: ReactNode }) {
  const value = useMessagesImpl();
  // createElement avoids needing this file to be .tsx. Equivalent to:
  //   <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
  return createElement(MessagesContext.Provider, { value }, children);
}

export function useMessages(): UseMessagesResult {
  const ctx = useContext(MessagesContext);
  if (!ctx) {
    // Defensive: if a consumer mounts outside MessagesProvider we still
    // return a usable result (just its own instance). This keeps edge
    // cases like Storybook and isolated tests working without forcing
    // every wrapping to include the provider. The cost is one channel
    // per orphan consumer — functional, just not shared.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMessagesImpl();
  }
  return ctx;
}
