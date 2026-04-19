/**
 * useMessages — Supabase CRUD for public.messages + public.message_recipients.
 *
 * Ported from the Stride WMS app. Powers the Messages page, conversation view,
 * and notification bell. Entity-linked messages (e.g. "RE: Repair RPR-0089")
 * carry (entity_type, entity_id); direct messages omit them.
 *
 * Expected schema (migration in a follow-up session — inferred here):
 *
 *   CREATE TABLE public.messages (
 *     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     thread_id    uuid,                         -- groups messages in a thread
 *     entity_type  text,                         -- 'repair' | 'task' | ... | NULL for direct
 *     entity_id    text,
 *     body         text NOT NULL,
 *     sender_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 *     sender_name  text,
 *     sender_role  text,
 *     created_at   timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX idx_messages_thread ON public.messages (thread_id, created_at);
 *   CREATE INDEX idx_messages_entity ON public.messages (entity_type, entity_id, created_at);
 *
 *   CREATE TABLE public.message_recipients (
 *     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     message_id      uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
 *     recipient_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     recipient_name  text,
 *     is_read         boolean NOT NULL DEFAULT false,
 *     read_at         timestamptz,
 *     is_archived     boolean NOT NULL DEFAULT false,
 *     created_at      timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX idx_message_recipients_user ON public.message_recipients (recipient_id, is_read, is_archived);
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  threadId: string | null;
  entityType: string | null;
  entityId: string | null;
  body: string;
  senderId: string | null;
  senderName: string;
  senderRole: string | null;
  createdAt: string;
  /** Populated when loading a thread for the current user. */
  myRecipient?: {
    recipientId: string;
    isRead: boolean;
    readAt: string | null;
    isArchived: boolean;
  };
}

export interface MessageRecipient {
  id: string;
  messageId: string;
  recipientId: string;
  recipientName: string;
  isRead: boolean;
  readAt: string | null;
  isArchived: boolean;
  createdAt: string;
}

export interface Conversation {
  /** thread_id when present; otherwise synthesized key ("entity:type:id" or "direct:otherUserId") */
  key: string;
  threadId: string | null;
  entityType: string | null;
  entityId: string | null;
  /** Other-party display label for direct threads, or entity-descriptive label. */
  title: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface SendMessageParams {
  body: string;
  recipientIds: string[];
  recipientNames?: string[];
  threadId?: string;
  entityType?: string;
  entityId?: string;
}

// ─── Row types ─────────────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  thread_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  body: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_role: string | null;
  created_at: string;
}
interface RecipientRow {
  id: string;
  message_id: string;
  recipient_id: string;
  recipient_name: string | null;
  is_read: boolean | null;
  read_at: string | null;
  is_archived: boolean | null;
  created_at: string;
}

function rowToMessage(r: MessageRow): Message {
  return {
    id: r.id,
    threadId: r.thread_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    body: r.body,
    senderId: r.sender_id,
    senderName: r.sender_name ?? '',
    senderRole: r.sender_role,
    createdAt: r.created_at,
  };
}

function rowToRecipient(r: RecipientRow): MessageRecipient {
  return {
    id: r.id,
    messageId: r.message_id,
    recipientId: r.recipient_id,
    recipientName: r.recipient_name ?? '',
    isRead: !!r.is_read,
    readAt: r.read_at,
    isArchived: !!r.is_archived,
    createdAt: r.created_at,
  };
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface UseMessagesResult {
  conversations: Conversation[];
  thread: Message[];
  threadLoading: boolean;
  loading: boolean;
  unreadCount: number;
  activeThreadKey: string | null;
  openThread: (key: string | { threadId?: string; entityType?: string; entityId?: string }) => Promise<void>;
  closeThread: () => void;
  sendMessage: (params: SendMessageParams) => Promise<Message | null>;
  markRead: (recipientId: string) => Promise<void>;
  markAllReadInThread: () => Promise<void>;
  archiveMessage: (recipientId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

/** Key helper: every conversation is either thread-id-based or synthesized
 *  from (entity_type, entity_id) for entity-linked non-thread messages, or
 *  (direct, otherUserId) for 1:1. We fall back to the message id if nothing
 *  else is available. */
function keyForMessage(m: MessageRow, myRecipients: RecipientRow[]): string {
  if (m.thread_id) return `thread:${m.thread_id}`;
  if (m.entity_type && m.entity_id) return `entity:${m.entity_type}:${m.entity_id}`;
  // Direct DM — pick the "other" party from the message's recipients.
  const otherRcp = myRecipients.find(r => r.message_id === m.id && r.recipient_id !== m.sender_id);
  if (otherRcp) return `direct:${otherRcp.recipient_id}`;
  return `msg:${m.id}`;
}

export function useMessages(): UseMessagesResult {
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [myRecipients, setMyRecipients] = useState<Record<string, MessageRecipient>>({}); // messageId → recipient row for current user
  const [loading, setLoading] = useState(true);

  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);

  // Resolve the current auth.users id once.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthUserId(data.session?.user.id ?? null);
    });
  }, []);

  // ── Initial + realtime load of inbox ────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!authUserId) return;
    setLoading(true);
    // 1. Load recipient rows for current user (non-archived).
    const { data: rcpData, error: rcpErr } = await supabase
      .from('message_recipients')
      .select('*')
      .eq('recipient_id', authUserId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(500);
    if (rcpErr || !rcpData) { setLoading(false); return; }
    const recipRows = rcpData as RecipientRow[];
    const recipsByMsg: Record<string, MessageRecipient> = {};
    for (const r of recipRows) recipsByMsg[r.message_id] = rowToRecipient(r);

    // 2. Load the corresponding messages.
    const msgIds = recipRows.map(r => r.message_id);
    let msgRows: MessageRow[] = [];
    if (msgIds.length > 0) {
      const { data: msgData, error: msgErr } = await supabase
        .from('messages')
        .select('*')
        .in('id', msgIds)
        .order('created_at', { ascending: false });
      if (!msgErr && msgData) msgRows = msgData as MessageRow[];
    }

    setMyRecipients(recipsByMsg);
    setMessages(msgRows.map(rowToMessage));
    setLoading(false);
  }, [authUserId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime: new recipient rows for the current user → refetch inbox.
  useEffect(() => {
    if (!authUserId) return;
    const channel = supabase
      .channel(`messages_inbox:${authUserId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'message_recipients', filter: `recipient_id=eq.${authUserId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [authUserId, refetch]);

  // ── Conversation list (derived from inbox messages) ─────────────────────
  const conversations = useMemo<Conversation[]>(() => {
    // Need raw rows for keying; reconstruct the minimal shape we need.
    const recipRows: RecipientRow[] = Object.values(myRecipients).map(r => ({
      id: r.id,
      message_id: r.messageId,
      recipient_id: r.recipientId,
      recipient_name: r.recipientName,
      is_read: r.isRead,
      read_at: r.readAt,
      is_archived: r.isArchived,
      created_at: r.createdAt,
    }));

    const byKey = new Map<string, Conversation>();
    for (const m of messages) {
      const row: MessageRow = {
        id: m.id,
        thread_id: m.threadId,
        entity_type: m.entityType,
        entity_id: m.entityId,
        body: m.body,
        sender_id: m.senderId,
        sender_name: m.senderName,
        sender_role: m.senderRole,
        created_at: m.createdAt,
      };
      const key = keyForMessage(row, recipRows);
      const existing = byKey.get(key);
      const rcp = myRecipients[m.id];
      const unread = rcp && !rcp.isRead ? 1 : 0;

      if (!existing || m.createdAt > existing.lastMessageAt) {
        byKey.set(key, {
          key,
          threadId: m.threadId,
          entityType: m.entityType,
          entityId: m.entityId,
          title: m.entityType && m.entityId
            ? `RE: ${m.entityType} ${m.entityId}`
            : (m.senderName || 'Message'),
          lastMessagePreview: m.body.slice(0, 140),
          lastMessageAt: m.createdAt,
          unreadCount: (existing?.unreadCount ?? 0) + unread,
        });
      } else {
        byKey.set(key, { ...existing, unreadCount: existing.unreadCount + unread });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  }, [messages, myRecipients]);

  const unreadCount = useMemo(
    () => Object.values(myRecipients).filter(r => !r.isRead).length,
    [myRecipients],
  );

  // ── Open a thread ───────────────────────────────────────────────────────
  const openThread = useCallback(async (
    target: string | { threadId?: string; entityType?: string; entityId?: string },
  ) => {
    const key = typeof target === 'string'
      ? target
      : target.threadId
        ? `thread:${target.threadId}`
        : (target.entityType && target.entityId ? `entity:${target.entityType}:${target.entityId}` : '');
    if (!key) return;
    setActiveThreadKey(key);
    setThreadLoading(true);

    let query = supabase.from('messages').select('*').order('created_at', { ascending: true }).limit(500);
    if (key.startsWith('thread:')) {
      query = query.eq('thread_id', key.slice('thread:'.length));
    } else if (key.startsWith('entity:')) {
      const [, entityType, entityId] = key.split(':');
      query = query.eq('entity_type', entityType).eq('entity_id', entityId);
    } else if (key.startsWith('direct:')) {
      // Direct DMs: messages either sent by or received by the other party
      // AND the current user. We assume thread_id is populated for direct
      // threads in the usual case; fall back to pulling every message where
      // the other party is sender OR recipient.
      const otherId = key.slice('direct:'.length);
      if (authUserId) {
        query = query.or(`sender_id.eq.${otherId},sender_id.eq.${authUserId}`);
      }
    }
    const { data, error } = await query;
    if (!error && data) {
      const rows = data as MessageRow[];
      setThread(rows.map(m => {
        const msg = rowToMessage(m);
        const rcp = myRecipients[m.id];
        if (rcp) {
          msg.myRecipient = {
            recipientId: rcp.id,
            isRead: rcp.isRead,
            readAt: rcp.readAt,
            isArchived: rcp.isArchived,
          };
        }
        return msg;
      }));
    } else {
      setThread([]);
    }
    setThreadLoading(false);
  }, [authUserId, myRecipients]);

  const closeThread = useCallback(() => {
    setActiveThreadKey(null);
    setThread([]);
  }, []);

  // ── Send ────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (params: SendMessageParams): Promise<Message | null> => {
    if (!authUserId) return null;
    const body = params.body.trim();
    if (!body) return null;

    // 1. Insert message
    const { data: msgData, error: msgErr } = await supabase
      .from('messages')
      .insert({
        thread_id: params.threadId ?? null,
        entity_type: params.entityType ?? null,
        entity_id: params.entityId ?? null,
        body,
        sender_id: authUserId,
        // sender_name / sender_role are set by the DB default or trigger in prod;
        // if not, the RLS-enforced insert may reject — keep the shape flexible.
      })
      .select('*')
      .single();
    if (msgErr || !msgData) return null;
    const message = rowToMessage(msgData as MessageRow);

    // 2. Insert recipient rows (one per target user). Sender gets a row too so
    //    threads include their own sent messages when querying by recipient.
    const recipients = Array.from(new Set([authUserId, ...params.recipientIds]));
    const rcpRows = recipients.map((recipientId, idx) => ({
      message_id: message.id,
      recipient_id: recipientId,
      recipient_name: params.recipientNames?.[idx] ?? null,
      is_read: recipientId === authUserId,  // sender's own row is pre-read
      read_at: recipientId === authUserId ? new Date().toISOString() : null,
      is_archived: false,
    }));
    if (rcpRows.length > 0) {
      await supabase.from('message_recipients').insert(rcpRows);
    }

    // Optimistic: append to thread if it matches the current view.
    setThread(prev => [...prev, message]);
    return message;
  }, [authUserId]);

  // ── Mark read / archive ─────────────────────────────────────────────────
  const markRead = useCallback(async (recipientId: string) => {
    await supabase
      .from('message_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', recipientId);
    setMyRecipients(prev => {
      const existing = Object.values(prev).find(r => r.id === recipientId);
      if (!existing) return prev;
      return { ...prev, [existing.messageId]: { ...existing, isRead: true, readAt: new Date().toISOString() } };
    });
  }, []);

  const markAllReadInThread = useCallback(async () => {
    const unread = thread
      .map(m => m.myRecipient)
      .filter((r): r is NonNullable<Message['myRecipient']> => !!r && !r.isRead);
    if (unread.length === 0) return;
    await Promise.all(unread.map(r => markRead(r.recipientId)));
  }, [thread, markRead]);

  const archiveMessage = useCallback(async (recipientId: string) => {
    await supabase
      .from('message_recipients')
      .update({ is_archived: true })
      .eq('id', recipientId);
    setMyRecipients(prev => {
      const existing = Object.values(prev).find(r => r.id === recipientId);
      if (!existing) return prev;
      const next = { ...prev };
      delete next[existing.messageId];
      return next;
    });
    // Remove the parent message from the list too.
    setMessages(prev => prev.filter(m => myRecipients[m.id]?.id !== recipientId));
  }, [myRecipients]);

  return useMemo(() => ({
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
    refetch,
  }), [conversations, thread, threadLoading, loading, unreadCount, activeThreadKey,
       openThread, closeThread, sendMessage, markRead, markAllReadInThread, archiveMessage, refetch]);
}
