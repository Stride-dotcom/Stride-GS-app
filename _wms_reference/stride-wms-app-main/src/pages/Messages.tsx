import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useMessages, MessageRecipient, InAppNotification } from '@/hooks/useMessages';
import { useAppleBanner } from '@/hooks/useAppleBanner';
import { useDepartments } from '@/hooks/useDepartments';
import { useUsers } from '@/hooks/useUsers';
import { usePresence } from '@/hooks/usePresence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AvatarWithPresence } from '@/components/ui/online-indicator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ConversationView } from '@/components/messages/ConversationView';
import { MessageInputBar } from '@/components/messages/MessageInputBar';

type InboxType = 'messages' | 'alerts';
type FolderType = 'inbox' | 'archive';
type ReplyMode = 'reply' | 'reply_all';

interface ConversationThread {
  threadKey: string;
  title: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  isSms: boolean;
  smsPhone: string | null;
  messages: MessageRecipient[];
  participantIds: string[];
  primaryContactId: string | null;
  smsContext?: {
    accountId?: string | null;
    accountName?: string | null;
    recipientSourceField?: string | null;
    contactLabel?: string | null;
  };
  noteThreadContext?: {
    noteThreadRootId: string;
    noteReplyParentId: string;
    noteType: string;
    entityNumber: string | null;
    sourceEntityType: string | null;
    sourceEntityId: string | null;
  };
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const ALERT_ENTITY_TOKEN_REGEX = /\b(SHP-[A-Z0-9-]+|TASK-[A-Z0-9-]+)\b/gi;

const ALLOWED_INTERNAL_ROUTE_PREFIXES = [
  '/shipments',
  '/tasks',
  '/claims',
  '/quotes',
  '/repair-quotes',
  '/inventory',
  '/incoming/manifest',
  '/incoming/expected',
  '/incoming/dock-intake',
  '/scan/shipment',
  '/billing/invoices',
  '/accounts',
  '/messages',
] as const;

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function isAllowedInternalPath(pathname: string): boolean {
  return ALLOWED_INTERNAL_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function sanitizeInternalPath(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  const pathname = path.split('?')[0].split('#')[0];
  if (!isAllowedInternalPath(pathname)) return null;
  return path;
}

function sanitizeActionUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    return sanitizeInternalPath(trimmed);
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!isAllowedInternalPath(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeEntityType(entityType: string | null | undefined): string {
  return (entityType || '').trim().toLowerCase().replace(/[.\s-]+/g, '_');
}

function getEntityRouteFromAlert(alert: InAppNotification | null): string | null {
  if (!alert?.related_entity_type || !alert.related_entity_id) return null;

  const entityType = normalizeEntityType(alert.related_entity_type);
  const entityId = alert.related_entity_id;

  if (entityType === 'shipment') return `/shipments/${entityId}`;
  if (entityType === 'task' || entityType === 'inspection') return `/tasks/${entityId}`;
  if (entityType === 'claim') return `/claims/${entityId}`;
  if (entityType === 'quote') return `/quotes/${entityId}`;
  if (entityType === 'repair' || entityType === 'repair_quote') return `/repair-quotes/${entityId}`;
  if (entityType === 'item' || entityType === 'inventory') return `/inventory/${entityId}`;

  return null;
}

function resolveDeterministicAlertRoute(alert: InAppNotification | null): string | null {
  const entityRoute = getEntityRouteFromAlert(alert);
  if (entityRoute) return entityRoute;
  if (!alert?.action_url) return null;
  return sanitizeActionUrl(alert.action_url);
}

function extractAlertEntityTokens(alert: InAppNotification | null): string[] {
  if (!alert) return [];
  const source = `${alert.title || ''}\n${alert.body || ''}`;
  const matches = source.match(ALERT_ENTITY_TOKEN_REGEX) || [];
  return [...new Set(matches.map((m) => m.toUpperCase()))];
}

function getAlertEntityReference(alert: InAppNotification | null): string | null {
  if (!alert) return null;

  const tokens = extractAlertEntityTokens(alert);
  if (tokens.length === 1) return tokens[0];
  if (tokens.length > 1) return `${tokens[0]} (+${tokens.length - 1})`;

  if (alert.related_entity_type && alert.related_entity_id) {
    return `${alert.related_entity_type}:${alert.related_entity_id}`;
  }
  if (alert.related_entity_id) return alert.related_entity_id;
  return null;
}

function buildAlertTokenRouteMap(alert: InAppNotification | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!alert) return map;

  const tokens = extractAlertEntityTokens(alert);
  const taskTokens = tokens.filter((t) => t.startsWith('TASK-'));
  const taskRoute = getEntityRouteFromAlert(alert);
  const entityType = normalizeEntityType(alert.related_entity_type);

  tokens.forEach((token) => {
    if (token.startsWith('SHP-')) {
      map.set(token, `/scan/shipment/${encodeURIComponent(token)}`);
      return;
    }

    if (
      token.startsWith('TASK-') &&
      taskTokens.length === 1 &&
      taskRoute &&
      (entityType === 'task' || entityType === 'inspection')
    ) {
      map.set(token, taskRoute);
    }
  });

  return map;
}

function buildThreadKey(msg: MessageRecipient, myUserId?: string): string {
  const metadata = (msg.message?.metadata || {}) as Record<string, unknown>;
  const explicitThreadKey = typeof metadata.thread_key === 'string' ? metadata.thread_key : null;
  if (explicitThreadKey) return explicitThreadKey;

  const source = String(metadata.source || '');
  if (source === 'sms_reply' || source === 'sms_outbound') {
    const smsPhone = (metadata.from_phone as string) || (metadata.to_phone as string) || '';
    return `sms:${smsPhone || msg.message_id}`;
  }

  const senderId = msg.message?.sender_id || '';
  const counterpart = senderId === myUserId
    ? (msg.user_id || msg.recipient_id || senderId)
    : senderId;
  return `dm:${counterpart || msg.message_id}`;
}

function linkifyBody(text: string, tokenRouteMap: Map<string, string>): JSX.Element[] {
  const regex = /(https?:\/\/[^\s]+|\/[a-zA-Z0-9\-_/?.=&%]+|\b(?:SHP-[A-Z0-9-]+|TASK-[A-Z0-9-]+)\b)/gi;
  const pieces = text.split('\n');

  return pieces.map((line, idx) => {
    const chunks: JSX.Element[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    const workingRegex = new RegExp(regex);

    while ((match = workingRegex.exec(line)) !== null) {
      const token = match[0];
      const start = match.index;
      if (start > last) {
        chunks.push(<span key={`${idx}-txt-${start}`}>{line.slice(last, start)}</span>);
      }

      const upperToken = token.toUpperCase();
      const tokenRoute = tokenRouteMap.get(upperToken) || null;
      const safeInternalPath = token.startsWith('/') ? sanitizeInternalPath(token) : null;
      const safeHttpLink = /^https?:\/\//i.test(token) ? token : null;
      const href = tokenRoute || safeInternalPath || safeHttpLink;

      if (href) {
        chunks.push(
          <a
            key={`${idx}-lnk-${start}`}
            href={href}
            className="text-primary underline underline-offset-2"
            target={isExternalHref(href) ? '_blank' : undefined}
            rel={isExternalHref(href) ? 'noreferrer' : undefined}
          >
            {token}
          </a>
        );
      } else {
        chunks.push(<span key={`${idx}-tok-${start}`}>{token}</span>);
      }

      last = start + token.length;
    }

    if (last < line.length) {
      chunks.push(<span key={`${idx}-txt-end`}>{line.slice(last)}</span>);
    }

    return (
      <p key={`line-${idx}`} className="text-sm leading-6">
        {chunks.length > 0 ? chunks : line}
      </p>
    );
  });
}

export default function Messages() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { banner, hideBanner } = useAppleBanner();
  const [searchParams, setSearchParams] = useSearchParams();
  const typingStopRef = useRef<number | null>(null);
  const typingChannelRef = useRef<any>(null);

  useEffect(() => {
    if (banner?.persistent && banner?.type === 'info') {
      hideBanner();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    messages,
    notifications,
    loading,
    sendMessage,
    markMessageRead,
    markMessageUnread,
    markAllMessagesRead,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    archiveMessage,
    restoreMessage,
    archiveNotification,
    restoreNotification,
    refetchMessages,
    refetchNotifications,
  } = useMessages();

  const { departments } = useDepartments();
  const { users, roles } = useUsers();
  const { getUserStatus } = usePresence();

  const [searchQuery, setSearchQuery] = useState('');
  const [messageFolder, setMessageFolder] = useState<FolderType>('inbox');
  const [alertFolder, setAlertFolder] = useState<FolderType>('inbox');
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyMode, setReplyMode] = useState<ReplyMode>('reply');
  const [typingByThread, setTypingByThread] = useState<Record<string, string[]>>({});

  const inbox: InboxType = searchParams.get('inbox') === 'alerts' ? 'alerts' : 'messages';

  const setInbox = (next: InboxType) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('inbox', next);
    setSearchParams(nextParams, { replace: true });
    setMobileView('list');
  };

  const [newMessage, setNewMessage] = useState({
    subject: '',
    body: '',
    recipientType: 'user' as 'user' | 'role' | 'department',
    recipientIds: [] as string[],
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
  });

  useEffect(() => {
    void refetchMessages({ archived: messageFolder === 'archive' });
  }, [messageFolder, refetchMessages]);

  useEffect(() => {
    void refetchNotifications({ archived: alertFolder === 'archive' });
  }, [alertFolder, refetchNotifications]);

  useEffect(() => {
    if (!profile?.tenant_id || !profile?.id) return;

    const channel = supabase
      .channel(`message-typing-${profile.tenant_id}`)
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const threadKey = String(payload?.threadKey || '');
        const userId = String(payload?.userId || '');
        const userName = String(payload?.userName || 'User');
        const isTyping = payload?.isTyping === true;
        if (!threadKey || !userId || userId === profile.id) return;

        setTypingByThread((prev) => {
          const current = new Set(prev[threadKey] || []);
          if (isTyping) {
            current.add(userName);
          } else {
            current.delete(userName);
          }
          return { ...prev, [threadKey]: [...current] };
        });
      })
      .subscribe();

    typingChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      if (typingStopRef.current) {
        window.clearTimeout(typingStopRef.current);
      }
    };
  }, [profile?.tenant_id, profile?.id]);

  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'User';
      map.set(u.id, name);
    });
    return map;
  }, [users]);

  const conversations = useMemo(() => {
    const map = new Map<string, ConversationThread>();

    for (const msg of messages) {
      const threadKey = buildThreadKey(msg, profile?.id);
      const metadata = (msg.message?.metadata || {}) as Record<string, unknown>;
      const source = String(metadata.source || '');
      const isSms = source === 'sms_reply' || source === 'sms_outbound' || threadKey.startsWith('sms:');
      const smsPhone = isSms
        ? ((metadata.from_phone as string) || (metadata.to_phone as string) || threadKey.replace(/^sms:/, ''))
        : null;
      const noteThreadRootId =
        typeof metadata.note_thread_root_id === 'string' && metadata.note_thread_root_id.trim()
          ? metadata.note_thread_root_id.trim()
          : null;
      const noteReplyParentId =
        typeof metadata.note_reply_parent_id === 'string' && metadata.note_reply_parent_id.trim()
          ? metadata.note_reply_parent_id.trim()
          : typeof metadata.note_id === 'string' && metadata.note_id.trim()
            ? metadata.note_id.trim()
            : noteThreadRootId;
      const noteThreadContext =
        noteThreadRootId
          ? {
              noteThreadRootId,
              noteReplyParentId: noteReplyParentId || noteThreadRootId,
              noteType:
                typeof metadata.note_type === 'string' && metadata.note_type.trim()
                  ? metadata.note_type
                  : 'internal',
              entityNumber:
                typeof metadata.entity_number === 'string' && metadata.entity_number.trim()
                  ? metadata.entity_number
                  : null,
              sourceEntityType:
                msg.message?.related_entity_type ||
                (typeof metadata.source_entity_type === 'string' ? metadata.source_entity_type : null),
              sourceEntityId:
                msg.message?.related_entity_id ||
                (typeof metadata.source_entity_id === 'string' ? metadata.source_entity_id : null),
            }
          : null;

      let title = 'Conversation';
      let primaryContactId: string | null = null;
      if (isSms) {
        title =
          (metadata.contact_label as string) ||
          (metadata.contact_name as string) ||
          smsPhone ||
          'SMS';
      } else {
        const senderId = msg.message?.sender_id;
        if (senderId && senderId !== profile?.id) {
          title =
            `${msg.message?.sender?.first_name || ''} ${msg.message?.sender?.last_name || ''}`.trim() ||
            userNameById.get(senderId) ||
            'Conversation';
          primaryContactId = senderId;
        } else {
          const recipientUserId = msg.user_id || msg.recipient_id;
          title = userNameById.get(recipientUserId) || 'Conversation';
          primaryContactId = recipientUserId || null;
        }
      }

      const unread = !msg.is_read && msg.message?.sender_id !== profile?.id;
      const participantSet = new Set<string>();
      if (msg.message?.sender_id) participantSet.add(msg.message.sender_id);
      if (msg.user_id) participantSet.add(msg.user_id);

      const existing = map.get(threadKey);
      const smsContext = isSms
        ? {
            accountId: (metadata.account_id as string) || null,
            accountName: (metadata.account_name as string) || null,
            recipientSourceField: (metadata.recipient_source_field as string) || null,
            contactLabel: (metadata.contact_label as string) || null,
          }
        : undefined;
      if (existing) {
        const isNewerThanCurrent = new Date(msg.created_at) > new Date(existing.lastMessageTime);
        existing.messages.push(msg);
        existing.unreadCount += unread ? 1 : 0;
        existing.participantIds = [...new Set([...existing.participantIds, ...participantSet])];
        if (isSms && smsContext) {
          existing.smsContext = {
            accountId: existing.smsContext?.accountId || smsContext.accountId || null,
            accountName: existing.smsContext?.accountName || smsContext.accountName || null,
            recipientSourceField: existing.smsContext?.recipientSourceField || smsContext.recipientSourceField || null,
            contactLabel: existing.smsContext?.contactLabel || smsContext.contactLabel || null,
          };
        }
        if (noteThreadContext && (isNewerThanCurrent || !existing.noteThreadContext)) {
          existing.noteThreadContext = noteThreadContext;
        }
        if (isNewerThanCurrent) {
          existing.lastMessage = msg.message?.body?.slice(0, 100) || '';
          existing.lastMessageTime = msg.created_at;
        }
      } else {
        map.set(threadKey, {
          threadKey,
          title,
          lastMessage: msg.message?.body?.slice(0, 100) || '',
          lastMessageTime: msg.created_at,
          unreadCount: unread ? 1 : 0,
          isSms,
          smsPhone,
          messages: [msg],
          participantIds: [...participantSet],
          primaryContactId,
          smsContext,
          noteThreadContext: noteThreadContext || undefined,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    );
  }, [messages, profile?.id, userNameById]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q) ||
      (c.smsPhone || '').toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  const filteredAlerts = useMemo(() => {
    if (!searchQuery.trim()) return notifications;
    const q = searchQuery.toLowerCase();
    return notifications.filter((n) =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.body || '').toLowerCase().includes(q) ||
      (n.category || '').toLowerCase().includes(q)
    );
  }, [notifications, searchQuery]);

  const selectedConversation = useMemo(
    () => filteredConversations.find((c) => c.threadKey === selectedThreadKey) || filteredConversations[0] || null,
    [filteredConversations, selectedThreadKey]
  );

  const selectedAlert = useMemo(
    () => filteredAlerts.find((n) => n.id === selectedAlertId) || filteredAlerts[0] || null,
    [filteredAlerts, selectedAlertId]
  );

  const selectedAlertDeepLink = useMemo(
    () => resolveDeterministicAlertRoute(selectedAlert),
    [selectedAlert]
  );

  const selectedAlertTokenRouteMap = useMemo(
    () => buildAlertTokenRouteMap(selectedAlert),
    [selectedAlert]
  );

  const selectedAlertEntityReference = useMemo(
    () => getAlertEntityReference(selectedAlert),
    [selectedAlert]
  );

  useEffect(() => {
    if (inbox === 'messages' && !selectedThreadKey && filteredConversations.length > 0) {
      setSelectedThreadKey(filteredConversations[0].threadKey);
    }
  }, [filteredConversations, inbox, selectedThreadKey]);

  useEffect(() => {
    if (inbox === 'alerts' && !selectedAlertId && filteredAlerts.length > 0) {
      setSelectedAlertId(filteredAlerts[0].id);
    }
  }, [filteredAlerts, inbox, selectedAlertId]);

  const conversationMessages = useMemo(() => {
    if (!selectedConversation) return [];
    const byMessageId = new Map<string, MessageRecipient[]>();
    selectedConversation.messages.forEach((m) => {
      const key = m.message_id || m.id;
      const list = byMessageId.get(key) || [];
      list.push(m);
      byMessageId.set(key, list);
    });

    return Array.from(byMessageId.entries())
      .map(([messageId, rows]) => {
        const first = rows[0];
        const metadata = (first.message?.metadata || {}) as Record<string, unknown>;
        const source = String(metadata.source || '');
        const isSmsInbound = source === 'sms_reply';
        const isSmsOutbound = source === 'sms_outbound';
        const isSent = isSmsInbound ? false : isSmsOutbound ? true : first.message?.sender_id === profile?.id;
        const otherRows = rows.filter((r) => r.user_id !== profile?.id);
        const readLabel = isSent && otherRows.length > 0 && otherRows.every((r) => r.is_read) ? 'Read' : undefined;
        const senderName = isSmsInbound
          ? ((metadata.contact_label as string) || (metadata.contact_name as string) || (metadata.from_phone as string) || 'SMS')
          : `${first.message?.sender?.first_name || ''} ${first.message?.sender?.last_name || ''}`.trim() || 'User';

        return {
          id: `${messageId}-${first.id}`,
          message_id: messageId,
          content: first.message?.body || '',
          sender_id: first.message?.sender_id || '',
          sender_name: senderName,
          created_at: first.message?.created_at || first.created_at,
          is_sent: isSent,
          is_external: isSmsInbound,
          read_label: readLabel,
        };
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [selectedConversation, profile?.id]);

  const typingText = useMemo(() => {
    if (!selectedConversation || selectedConversation.isSms) return null;
    const names = typingByThread[selectedConversation.threadKey] || [];
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing...`;
    return `${names.length} people are typing...`;
  }, [selectedConversation, typingByThread]);

  const unreadMessagesCount = useMemo(
    () => messages.filter((m) => !m.is_read && m.message?.sender_id !== profile?.id).length,
    [messages, profile?.id]
  );
  const unreadAlertsCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const onSelectConversation = async (threadKey: string) => {
    setSelectedThreadKey(threadKey);
    setMobileView('detail');
    const thread = conversations.find((c) => c.threadKey === threadKey);
    if (!thread) return;
    const ids = [...new Set(thread.messages.map((m) => m.message_id))];
    for (const id of ids) {
      const row = thread.messages.find((m) => m.message_id === id);
      if (row && !row.is_read && row.message?.sender_id !== profile?.id) {
        await markMessageRead(id);
      }
    }
  };

  const markThreadReadState = async (thread: ConversationThread, shouldRead: boolean) => {
    const ids = [...new Set(thread.messages.map((m) => m.message_id))];
    for (const id of ids) {
      if (shouldRead) {
        await markMessageRead(id);
      } else {
        await markMessageUnread(id);
      }
    }
    await refetchMessages({ archived: messageFolder === 'archive' });
  };

  const archiveThread = async (thread: ConversationThread, archive: boolean) => {
    const ids = [...new Set(thread.messages.map((m) => m.message_id))];
    for (const id of ids) {
      if (archive) {
        await archiveMessage(id);
      } else {
        await restoreMessage(id);
      }
    }
    await refetchMessages({ archived: messageFolder === 'archive' });
  };

  const emitTyping = useCallback((isTyping: boolean) => {
    if (!profile?.tenant_id || !profile?.id || !selectedConversation || selectedConversation.isSms) return;
    void typingChannelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        threadKey: selectedConversation.threadKey,
        userId: profile.id,
        userName: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email || 'User',
        isTyping,
      },
    });
  }, [profile?.tenant_id, profile?.id, profile?.first_name, profile?.last_name, profile?.email, selectedConversation]);

  const onTypingChange = (isTyping: boolean) => {
    emitTyping(isTyping);
    if (typingStopRef.current) {
      window.clearTimeout(typingStopRef.current);
    }
    if (isTyping) {
      typingStopRef.current = window.setTimeout(() => emitTyping(false), 1800);
    }
  };

  const handleSendSmsReply = useCallback(async (
    text: string,
    toPhone: string,
    threadKey: string,
    context?: ConversationThread['smsContext']
  ) => {
    if (!profile?.tenant_id || !profile?.id) return false;

    try {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: {
          tenant_id: profile.tenant_id,
          to_phone: toPhone,
          body: text,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: message, error: msgError } = await supabase
        .from('messages')
        .insert({
          tenant_id: profile.tenant_id,
          sender_id: profile.id,
          subject: `SMS to ${toPhone}`,
          body: text,
          message_type: 'system' as const,
          priority: 'normal' as const,
          metadata: {
            source: 'sms_outbound',
            to_phone: toPhone,
            twilio_sid: data?.sid || null,
            thread_key: threadKey,
            contact_label: context?.contactLabel || null,
            account_id: context?.accountId || null,
            account_name: context?.accountName || null,
            recipient_source_field: context?.recipientSourceField || null,
          },
        })
        .select('id')
        .single();

      if (!msgError && message) {
        await supabase.from('message_recipients').insert({
          message_id: message.id,
          recipient_type: 'user',
          recipient_id: profile.id,
          user_id: profile.id,
        });
      }

      await refetchMessages({ archived: false });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send SMS';
      toast({ variant: 'destructive', title: 'SMS Failed', description: msg });
      return false;
    }
  }, [profile?.tenant_id, profile?.id, refetchMessages, toast]);

  const handleSendInConversation = async (text: string) => {
    if (!selectedConversation || !text.trim()) return;
    setSending(true);

    let success = false;
    if (selectedConversation.isSms && selectedConversation.smsPhone) {
      success = await handleSendSmsReply(
        text,
        selectedConversation.smsPhone,
        selectedConversation.threadKey,
        selectedConversation.smsContext
      );
    } else {
      const participants = selectedConversation.participantIds
        .filter((id) => id && id !== profile?.id);
      const replyRecipientIds = replyMode === 'reply'
        ? [selectedConversation.primaryContactId].filter(Boolean) as string[]
        : participants;
      const uniqueRecipients = [...new Set(replyRecipientIds.length > 0 ? replyRecipientIds : participants)];
      const noteThread = selectedConversation.noteThreadContext;
      const relatedEntityType =
        noteThread?.sourceEntityType ||
        selectedConversation.messages[0]?.message?.related_entity_type ||
        undefined;
      const relatedEntityId =
        noteThread?.sourceEntityId ||
        selectedConversation.messages[0]?.message?.related_entity_id ||
        undefined;
      const messageMetadata = noteThread
        ? {
            source: 'note_mention_reply',
            note_thread_root_id: noteThread.noteThreadRootId,
            note_reply_parent_id: noteThread.noteReplyParentId || noteThread.noteThreadRootId,
            note_type: noteThread.noteType || 'internal',
            entity_number: noteThread.entityNumber || null,
          }
        : undefined;

      if (uniqueRecipients.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No recipients',
          description: 'This thread has no reply targets.',
        });
        setSending(false);
        return;
      }

      success = await sendMessage({
        subject: 'Message',
        body: text,
        recipients: uniqueRecipients.map((id) => ({ type: 'user', id })),
        threadKey: selectedConversation.threadKey,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
        metadata: messageMetadata,
      });
      if (success) {
        await refetchMessages({ archived: false });
      }
    }

    if (success) {
      onTypingChange(false);
    }
    setSending(false);
  };

  const recipientOptions = useMemo(() => {
    switch (newMessage.recipientType) {
      case 'user':
        return users.map((u) => ({
          value: u.id,
          label: `${u.first_name || ''} ${u.last_name || ''} (${u.email})`.trim(),
        }));
      case 'role':
        return roles.map((r) => ({ value: r.id, label: r.name }));
      case 'department':
        return departments.map((d) => ({ value: d.id, label: d.name }));
      default:
        return [];
    }
  }, [newMessage.recipientType, users, roles, departments]);

  const getInitials = (user: { first_name?: string | null; last_name?: string | null; email?: string | null }) => {
    if (user.first_name && user.last_name) return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
    if (user.first_name) return user.first_name.slice(0, 2).toUpperCase();
    return user.email?.slice(0, 2).toUpperCase() || '??';
  };

  const handleSendMessage = async () => {
    if (!newMessage.subject.trim() || !newMessage.body.trim() || newMessage.recipientIds.length === 0) return;
    setSending(true);

    const threadKey = newMessage.recipientType === 'user' && newMessage.recipientIds.length === 1
      ? `dm:${newMessage.recipientIds[0]}`
      : `thread:${crypto.randomUUID()}`;

    const success = await sendMessage({
      subject: newMessage.subject,
      body: newMessage.body,
      recipients: newMessage.recipientIds.map((id) => ({ type: newMessage.recipientType, id })),
      priority: newMessage.priority,
      threadKey,
    });

    if (success) {
      await refetchMessages({ archived: false });
      setComposeOpen(false);
      setNewMessage({
        subject: '',
        body: '',
        recipientType: 'user',
        recipientIds: [],
        priority: 'normal',
      });
    }
    setSending(false);
  };

  const renderMessagesList = () => {
    if (loading && conversations.length === 0) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading...</p>
        </div>
      );
    }

    if (filteredConversations.length === 0) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          <MaterialIcon name="chat" size="xl" className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No conversations</p>
        </div>
      );
    }

    return filteredConversations.map((conv) => {
      const initial = conv.title.charAt(0).toUpperCase();
      const isSelected = conv.threadKey === selectedConversation?.threadKey;
      return (
        <div
          key={conv.threadKey}
          className={cn(
            'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors',
            isSelected ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-muted/50'
          )}
          onClick={() => void onSelectConversation(conv.threadKey)}
        >
          {conv.isSms ? (
            <Avatar className="h-10 w-10">
              <AvatarFallback className="text-sm font-semibold bg-green-100 text-green-700">
                <MaterialIcon name="sms" size="sm" />
              </AvatarFallback>
            </Avatar>
          ) : (
            <AvatarWithPresence status={conv.primaryContactId ? getUserStatus(conv.primaryContactId) : 'offline'} indicatorSize="sm">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
                  {initial}
                </AvatarFallback>
              </Avatar>
            </AvatarWithPresence>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-sm font-semibold truncate">{conv.title}</span>
                {conv.isSms && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 text-green-700 border-green-300 bg-green-50 shrink-0">
                    SMS
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">{formatRelative(conv.lastMessageTime)}</span>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground truncate flex-1">{conv.lastMessage}</p>
              {conv.unreadCount > 0 && <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                <MaterialIcon name="more_horiz" size="sm" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void markThreadReadState(conv, true)}>
                Mark read
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void markThreadReadState(conv, false)}>
                Mark unread
              </DropdownMenuItem>
              {messageFolder === 'inbox' ? (
                <DropdownMenuItem onClick={() => void archiveThread(conv, true)}>
                  Archive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => void archiveThread(conv, false)}>
                  Restore to inbox
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    });
  };

  const renderAlertsList = () => {
    if (loading && notifications.length === 0) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin mx-auto mb-2" />
          <p className="text-sm">Loading...</p>
        </div>
      );
    }

    if (filteredAlerts.length === 0) {
      return (
        <div className="p-8 text-center text-muted-foreground">
          <MaterialIcon name="notifications" size="xl" className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No alerts</p>
        </div>
      );
    }

    return filteredAlerts.map((alert) => {
      const isSelected = selectedAlert?.id === alert.id;
      const entityReference = getAlertEntityReference(alert);
      const rowDeepLink = resolveDeterministicAlertRoute(alert);
      return (
        <div
          key={alert.id}
          className={cn(
            'px-4 py-3 border-b cursor-pointer transition-colors',
            isSelected ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-muted/40',
            !alert.is_read && 'bg-blue-50/60 dark:bg-blue-950/20'
          )}
          onClick={async () => {
            setSelectedAlertId(alert.id);
            setMobileView('detail');
            if (!alert.is_read) {
              await markNotificationRead(alert.id);
            }
          }}
        >
          <div className="flex items-start gap-2">
            {!alert.is_read && <span className="mt-2 h-2 w-2 rounded-full bg-primary shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate">{alert.title}</p>
                <span className="text-[11px] text-muted-foreground shrink-0">{formatRelative(alert.created_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {alert.body || 'No details'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px]">{alert.category}</Badge>
                {entityReference && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {entityReference}
                  </span>
                )}
                {rowDeepLink && (
                  <a
                    href={rowDeepLink}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] text-primary hover:underline inline-flex items-center gap-1"
                    target={isExternalHref(rowDeepLink) ? '_blank' : undefined}
                    rel={isExternalHref(rowDeepLink) ? 'noreferrer' : undefined}
                  >
                    <MaterialIcon name="open_in_new" size="sm" />
                    Open
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    });
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100dvh-3rem-env(safe-area-inset-top,0px))] overflow-hidden">
        <div className={cn('w-full md:w-96 md:min-w-[360px] border-r flex flex-col bg-background', mobileView === 'detail' && 'hidden md:flex')}>
          <div className="p-4 border-b space-y-3">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-semibold">Inbox</h1>
              {inbox === 'messages' ? (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setComposeOpen(true)} title="Compose">
                  <MaterialIcon name="edit_square" size="sm" />
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={inbox === 'messages' ? 'default' : 'outline'}
                className="justify-between"
                onClick={() => setInbox('messages')}
              >
                <span>Messages</span>
                {unreadMessagesCount > 0 && <Badge variant="secondary">{unreadMessagesCount}</Badge>}
              </Button>
              <Button
                variant={inbox === 'alerts' ? 'default' : 'outline'}
                className="justify-between"
                onClick={() => setInbox('alerts')}
              >
                <span>Alerts</span>
                {unreadAlertsCount > 0 && <Badge variant="secondary">{unreadAlertsCount}</Badge>}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {(inbox === 'messages' ? messageFolder : alertFolder) === 'inbox' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (inbox === 'messages') {
                      void markAllMessagesRead();
                    } else {
                      void markAllNotificationsRead();
                    }
                  }}
                >
                  <MaterialIcon name="done_all" size="sm" className="mr-1" />
                  Mark all read
                </Button>
              ) : null}
              <div className="ml-auto flex items-center rounded-md border p-0.5">
                <Button
                  variant={(inbox === 'messages' ? messageFolder : alertFolder) === 'inbox' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    if (inbox === 'messages') setMessageFolder('inbox');
                    else setAlertFolder('inbox');
                  }}
                >
                  Inbox
                </Button>
                <Button
                  variant={(inbox === 'messages' ? messageFolder : alertFolder) === 'archive' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    if (inbox === 'messages') setMessageFolder('archive');
                    else setAlertFolder('archive');
                  }}
                >
                  Archive
                </Button>
              </div>
            </div>

            <div className="relative">
              <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={`Search ${inbox === 'messages' ? 'messages' : 'alerts'}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {inbox === 'messages' ? renderMessagesList() : renderAlertsList()}
          </div>
        </div>

        <div className={cn('flex-1 flex flex-col bg-background', mobileView === 'list' && 'hidden md:flex')}>
          {inbox === 'messages' ? (
            selectedConversation ? (
              <>
                <div className="border-b px-4 py-3 flex items-center gap-3">
                  <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setMobileView('list')}>
                    <MaterialIcon name="arrow_back" size="md" />
                  </Button>
                  {selectedConversation.isSms ? (
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs font-semibold bg-green-100 text-green-700">
                        <MaterialIcon name="sms" size="sm" />
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <AvatarWithPresence status={selectedConversation.primaryContactId ? getUserStatus(selectedConversation.primaryContactId) : 'offline'} indicatorSize="sm">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                          {selectedConversation.title.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </AvatarWithPresence>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate">{selectedConversation.title}</p>
                      {selectedConversation.isSms && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-700 border-green-300 bg-green-50">
                          SMS
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedConversation.isSms
                        ? selectedConversation.smsPhone
                        : selectedConversation.primaryContactId
                          ? getUserStatus(selectedConversation.primaryContactId)
                          : 'Conversation'}
                    </p>
                  </div>
                  {!selectedConversation.isSms && (
                    <div className="hidden md:flex items-center gap-1 rounded-md border p-0.5">
                      <Button
                        size="sm"
                        variant={replyMode === 'reply' ? 'default' : 'ghost'}
                        className="h-7"
                        onClick={() => setReplyMode('reply')}
                      >
                        Reply
                      </Button>
                      <Button
                        size="sm"
                        variant={replyMode === 'reply_all' ? 'default' : 'ghost'}
                        className="h-7"
                        onClick={() => setReplyMode('reply_all')}
                        disabled={selectedConversation.participantIds.filter((id) => id && id !== profile?.id).length <= 1}
                      >
                        Reply all
                      </Button>
                    </div>
                  )}
                </div>

                <ConversationView
                  messages={conversationMessages}
                  currentUserId={profile?.id || ''}
                  typingText={typingText}
                />

                <MessageInputBar
                  onSend={handleSendInConversation}
                  disabled={sending}
                  isSms={selectedConversation.isSms}
                  onTypingChange={onTypingChange}
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MaterialIcon name="chat_bubble_outline" size="xl" className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">Select a conversation</p>
                  <p className="text-xs mt-1">Choose a thread to view details</p>
                </div>
              </div>
            )
          ) : selectedAlert ? (
            <div className="flex-1 flex flex-col">
              <div className="border-b px-4 py-3 flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setMobileView('list')}>
                  <MaterialIcon name="arrow_back" size="md" />
                </Button>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{selectedAlert.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(selectedAlert.created_at)}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MaterialIcon name="more_horiz" size="sm" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {selectedAlert.is_read ? (
                      <DropdownMenuItem onClick={() => void markNotificationUnread(selectedAlert.id)}>
                        Mark unread
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => void markNotificationRead(selectedAlert.id)}>
                        Mark read
                      </DropdownMenuItem>
                    )}
                    {alertFolder === 'inbox' ? (
                      <DropdownMenuItem onClick={() => void archiveNotification(selectedAlert.id)}>
                        Archive
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => void restoreNotification(selectedAlert.id)}>
                        Restore to inbox
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-3xl mx-auto rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedAlert.is_read ? 'secondary' : 'default'}>
                      {selectedAlert.is_read ? 'Read' : 'Unread'}
                    </Badge>
                    <Badge variant="outline">{selectedAlert.category}</Badge>
                    {selectedAlertEntityReference && (
                      <span className="text-xs text-muted-foreground">
                        {selectedAlertEntityReference}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-semibold">{selectedAlert.title}</h2>
                  <div className="space-y-2 text-muted-foreground">
                    {linkifyBody(selectedAlert.body || '', selectedAlertTokenRouteMap)}
                  </div>
                  {selectedAlertDeepLink && (
                    <div className="pt-2">
                      <Button asChild variant="outline">
                        <a
                          href={selectedAlertDeepLink}
                          target={isExternalHref(selectedAlertDeepLink) ? '_blank' : undefined}
                          rel={isExternalHref(selectedAlertDeepLink) ? 'noreferrer' : undefined}
                        >
                          <MaterialIcon name="open_in_new" size="sm" className="mr-1" />
                          Open linked record
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MaterialIcon name="notifications" size="xl" className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">Select an alert</p>
                <p className="text-xs mt-1">Choose an alert to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>New Message</DialogTitle>
            <DialogDescription>Send a message to users, roles, or departments</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Recipient Type</Label>
                <Select
                  value={newMessage.recipientType}
                  onValueChange={(v) => setNewMessage((prev) => ({
                    ...prev,
                    recipientType: v as 'user' | 'role' | 'department',
                    recipientIds: [],
                  }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user"><div className="flex items-center gap-2"><MaterialIcon name="person" size="sm" />Individual User</div></SelectItem>
                    <SelectItem value="role"><div className="flex items-center gap-2"><MaterialIcon name="group" size="sm" />Role (All Users)</div></SelectItem>
                    <SelectItem value="department"><div className="flex items-center gap-2"><MaterialIcon name="business" size="sm" />Department</div></SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={newMessage.priority}
                  onValueChange={(v) => setNewMessage((prev) => ({ ...prev, priority: v as 'low' | 'normal' | 'high' | 'urgent' }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-1">
                {recipientOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No {newMessage.recipientType}s available</p>
                ) : newMessage.recipientType === 'user' ? (
                  users.map((user) => (
                    <div
                      key={user.id}
                      className={cn(
                        'flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors',
                        newMessage.recipientIds.includes(user.id) ? 'bg-primary/10' : 'hover:bg-muted'
                      )}
                      onClick={() => {
                        setNewMessage((prev) => ({
                          ...prev,
                          recipientIds: prev.recipientIds.includes(user.id)
                            ? prev.recipientIds.filter((id) => id !== user.id)
                            : [...prev.recipientIds, user.id],
                        }));
                      }}
                    >
                      <Checkbox checked={newMessage.recipientIds.includes(user.id)} onCheckedChange={() => {}} className="pointer-events-none" />
                      <AvatarWithPresence status={getUserStatus(user.id)} indicatorSize="sm">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">{getInitials(user)}</AvatarFallback>
                        </Avatar>
                      </AvatarWithPresence>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {user.first_name || user.last_name ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unnamed'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  recipientOptions.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2 p-2">
                      <Checkbox
                        id={option.value}
                        checked={newMessage.recipientIds.includes(option.value)}
                        onCheckedChange={(checked) => {
                          setNewMessage((prev) => ({
                            ...prev,
                            recipientIds: checked
                              ? [...prev.recipientIds, option.value]
                              : prev.recipientIds.filter((id) => id !== option.value),
                          }));
                        }}
                      />
                      <label htmlFor={option.value} className="text-sm cursor-pointer">{option.label}</label>
                    </div>
                  ))
                )}
              </div>
              {newMessage.recipientIds.length > 0 && (
                <p className="text-xs text-muted-foreground">{newMessage.recipientIds.length} recipient(s) selected</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" value={newMessage.subject} onChange={(e) => setNewMessage((prev) => ({ ...prev, subject: e.target.value }))} placeholder="Message subject" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="body">Message</Label>
              <Textarea id="body" value={newMessage.body} onChange={(e) => setNewMessage((prev) => ({ ...prev, body: e.target.value }))} placeholder="Write your message..." rows={6} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSendMessage}
              disabled={sending || !newMessage.subject.trim() || !newMessage.body.trim() || newMessage.recipientIds.length === 0}
            >
              {sending && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Send Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
