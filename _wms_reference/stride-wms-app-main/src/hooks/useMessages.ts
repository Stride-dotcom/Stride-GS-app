import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface Message {
  id: string;
  tenant_id: string;
  sender_id: string;
  subject: string;
  body: string;
  message_type: 'message' | 'alert' | 'system';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  related_entity_type?: string;
  related_entity_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  sender?: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

export interface MessageRecipient {
  id: string;
  message_id: string;
  recipient_type: 'user' | 'role' | 'department';
  recipient_id: string;
  user_id: string;
  is_read: boolean;
  read_at?: string;
  is_archived: boolean;
  created_at: string;
  message?: Message;
}

export interface InAppNotification {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  body?: string;
  icon?: string;
  category: string;
  related_entity_type?: string;
  related_entity_id?: string;
  action_url?: string;
  is_read: boolean;
  is_archived?: boolean;
  read_at?: string;
  archived_at?: string;
  priority: string;
  created_at: string;
}

export interface SendMessageParams {
  subject: string;
  body: string;
  recipients: {
    type: 'user' | 'role' | 'department';
    id: string;
  }[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  related_entity_type?: string;
  related_entity_id?: string;
  metadata?: Record<string, unknown>;
  threadKey?: string;
}

interface FetchMessageOptions {
  archived?: boolean;
}

interface FetchNotificationOptions {
  archived?: boolean;
}

export function useMessages() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [messages, setMessages] = useState<MessageRecipient[]>([]);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async (options: FetchMessageOptions = {}) => {
    if (!profile?.id) return;
    const archived = options.archived === true;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('message_recipients')
        .select(`
          id, message_id, recipient_type, recipient_id, user_id,
          is_read, read_at, is_archived, created_at,
          messages!inner (
            id, tenant_id, sender_id, subject, body, message_type, priority,
            related_entity_type, related_entity_id, metadata, created_at,
            users!messages_sender_id_fkey (first_name, last_name, email)
          )
        `)
        .eq('user_id', profile.id)
        .is('deleted_at', null)
        .eq('is_archived', archived)
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) throw error;

      const transformed = (data || []).map((r: any) => ({
        ...r,
        message: {
          ...r.messages,
          sender: r.messages?.users,
        },
      }));

      // Include sent messages so the conversation shows complete threads.
      const { data: sentData, error: sentError } = await (supabase as any)
        .from('messages')
        .select(`
          id, tenant_id, sender_id, subject, body, message_type, priority,
          related_entity_type, related_entity_id, metadata, created_at,
          sender:users!messages_sender_id_fkey (first_name, last_name, email),
          recipients:message_recipients (
            id, message_id, recipient_type, recipient_id, user_id,
            is_read, read_at, is_archived, created_at
          )
        `)
        .eq('sender_id', profile.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(300);

      if (sentError) throw sentError;

      const sentTransformed = (sentData || []).flatMap((msg: any) =>
        (msg.recipients || [])
          .filter((r: any) => Boolean(r.user_id))
          .filter((r: any) => archived ? r.is_archived === true : r.is_archived !== true)
          .map((r: any) => ({
            ...r,
            message: {
              id: msg.id,
              tenant_id: msg.tenant_id,
              sender_id: msg.sender_id,
              subject: msg.subject,
              body: msg.body,
              message_type: msg.message_type,
              priority: msg.priority,
              related_entity_type: msg.related_entity_type,
              related_entity_id: msg.related_entity_id,
              metadata: msg.metadata,
              created_at: msg.created_at,
              sender: msg.sender,
            },
          }))
      );

      const allMessages = [...transformed, ...sentTransformed];
      const seen = new Set<string>();
      const deduped = allMessages.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

      setMessages(deduped);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load messages',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.id, toast]);

  const fetchNotifications = useCallback(async (options: FetchNotificationOptions = {}) => {
    if (!profile?.id) return;
    const archived = options.archived === true;

    try {
      const { data, error } = await (supabase as any)
        .from('in_app_notifications')
        .select('*')
        .eq('user_id', profile.id)
        .eq('is_archived', archived)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) throw error;
      setNotifications((data || []) as InAppNotification[]);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  }, [profile?.id]);

  const fetchUnreadCount = useCallback(async () => {
    if (!profile?.id) return;

    try {
      const { data, error } = await (supabase as any).rpc('get_total_unread_count', {
        p_user_id: profile.id,
      });

      if (error) throw error;
      setUnreadCount(data || 0);
    } catch (error) {
      console.error('Error fetching unread count:', error);

      const { count: msgCount } = await supabase
        .from('message_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false)
        .eq('is_archived', false)
        .is('deleted_at', null);

      const { count: notifCount } = await (supabase as any)
        .from('in_app_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false)
        .eq('is_archived', false)
        .is('deleted_at', null);

      setUnreadCount((msgCount || 0) + (notifCount || 0));
    }
  }, [profile?.id]);

  const sendMessage = useCallback(async (params: SendMessageParams): Promise<boolean> => {
    if (!profile?.id || !profile?.tenant_id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Not authenticated' });
      return false;
    }

    try {
      const metadata = { ...(params.metadata || {}) };
      if (params.threadKey && !metadata.thread_key) {
        metadata.thread_key = params.threadKey;
      }

      const noteThreadRootId =
        typeof metadata.note_thread_root_id === 'string' && metadata.note_thread_root_id.trim()
          ? metadata.note_thread_root_id.trim()
          : null;
      const noteReplyParentId =
        typeof metadata.note_reply_parent_id === 'string' && metadata.note_reply_parent_id.trim()
          ? metadata.note_reply_parent_id.trim()
          : null;

      if (noteThreadRootId && params.related_entity_type && params.related_entity_id) {
        const rawNoteType =
          typeof metadata.note_type === 'string' ? metadata.note_type.toLowerCase() : 'internal';
        const noteType =
          rawNoteType === 'public' || rawNoteType === 'exception' ? rawNoteType : 'internal';
        const noteParentId = noteReplyParentId || noteThreadRootId;

        const { data: createdReplyNoteId, error: noteError } = await (supabase as any).rpc(
          'create_unified_note',
          {
            p_entity_type: params.related_entity_type,
            p_entity_id: params.related_entity_id,
            p_note_text: params.body,
            p_note_type: noteType,
            p_parent_note_id: noteParentId,
            p_source_entity_number:
              typeof metadata.entity_number === 'string' ? metadata.entity_number : null,
            p_metadata: {
              source: 'message_thread_reply',
              from_messages_inbox: true,
              thread_key: metadata.thread_key || params.threadKey || null,
            },
          }
        );

        if (noteError) throw noteError;
        if (createdReplyNoteId) {
          metadata.note_id = createdReplyNoteId;
          metadata.note_reply_parent_id = createdReplyNoteId;
        }
      }

      const { data: message, error: msgError } = await (supabase as any)
        .from('messages')
        .insert({
          tenant_id: profile.tenant_id,
          sender_id: profile.id,
          subject: params.subject,
          body: params.body,
          message_type: 'message',
          priority: params.priority || 'normal',
          related_entity_type: params.related_entity_type || null,
          related_entity_id: params.related_entity_id || null,
          metadata,
        })
        .select('id')
        .single();

      if (msgError) throw msgError;

      const recipientInserts = params.recipients.map((r) => ({
        message_id: message.id,
        recipient_type: r.type,
        recipient_id: r.id,
        user_id: r.type === 'user' ? r.id : null,
      }));

      const { error: recipError } = await supabase
        .from('message_recipients')
        .insert(recipientInserts);

      if (recipError) throw recipError;

      return true;
    } catch (error: any) {
      console.error('Error sending message:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to send message',
      });
      return false;
    }
  }, [profile?.id, profile?.tenant_id, toast]);

  const markMessageRead = useCallback(async (messageId: string): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { error } = await supabase.rpc('mark_message_read', {
        p_message_id: messageId,
        p_user_id: profile.id,
      });
      if (error) throw error;

      setMessages((prev) =>
        prev.map((m) => (m.message_id === messageId ? { ...m, is_read: true, read_at: new Date().toISOString() } : m))
      );
      return true;
    } catch (error) {
      console.error('Error marking message read:', error);
      return false;
    }
  }, [profile?.id]);

  const markMessageUnread = useCallback(async (messageId: string): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { error } = await (supabase as any).rpc('mark_message_unread', {
        p_message_id: messageId,
        p_user_id: profile.id,
      });
      if (error) throw error;

      setMessages((prev) =>
        prev.map((m) => (m.message_id === messageId ? { ...m, is_read: false, read_at: undefined } : m))
      );
      return true;
    } catch (error) {
      console.error('Error marking message unread:', error);
      return false;
    }
  }, [profile?.id]);

  const markAllMessagesRead = useCallback(async (): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { error } = await (supabase as any).rpc('mark_all_messages_read');
      if (error) throw error;
      setMessages((prev) => prev.map((m) => ({ ...m, is_read: true, read_at: new Date().toISOString() })));
      await fetchUnreadCount();
      return true;
    } catch (error) {
      console.error('Error marking all messages read:', error);
      return false;
    }
  }, [profile?.id, fetchUnreadCount]);

  const archiveMessage = useCallback(async (messageId: string): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { error } = await (supabase as any).rpc('archive_message_for_me', {
        p_message_id: messageId,
      });
      if (error) throw error;
      setMessages((prev) => prev.filter((m) => m.message_id !== messageId));
      await fetchUnreadCount();
      return true;
    } catch (error) {
      console.error('Error archiving message:', error);
      return false;
    }
  }, [profile?.id, fetchUnreadCount]);

  const restoreMessage = useCallback(async (messageId: string): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { error } = await (supabase as any).rpc('restore_message_for_me', {
        p_message_id: messageId,
      });
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error restoring message:', error);
      return false;
    }
  }, [profile?.id]);

  const markNotificationRead = useCallback(async (notificationId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase as any)
        .from('in_app_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);
      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
      );
      await fetchUnreadCount();
      return true;
    } catch (error) {
      console.error('Error marking notification read:', error);
      return false;
    }
  }, [fetchUnreadCount]);

  const markNotificationUnread = useCallback(async (notificationId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase as any).rpc('mark_notification_unread', {
        p_notification_id: notificationId,
      });
      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: false, read_at: undefined } : n))
      );
      await fetchUnreadCount();
      return true;
    } catch (error) {
      console.error('Error marking notification unread:', error);
      return false;
    }
  }, [fetchUnreadCount]);

  const markAllNotificationsRead = useCallback(async (): Promise<boolean> => {
    if (!profile?.id) return false;
    try {
      const { error } = await (supabase as any).rpc('mark_all_alert_notifications_read');
      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
      );
      await fetchUnreadCount();
      return true;
    } catch (error) {
      console.error('Error marking all notifications read:', error);
      return false;
    }
  }, [profile?.id, fetchUnreadCount]);

  const archiveNotification = useCallback(async (notificationId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase as any).rpc('archive_notification_for_me', {
        p_notification_id: notificationId,
      });
      if (error) throw error;
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      await fetchUnreadCount();
      return true;
    } catch (error) {
      console.error('Error archiving notification:', error);
      return false;
    }
  }, [fetchUnreadCount]);

  const restoreNotification = useCallback(async (notificationId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase as any).rpc('restore_notification_for_me', {
        p_notification_id: notificationId,
      });
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error restoring notification:', error);
      return false;
    }
  }, []);

  useEffect(() => {
    if (profile?.id) {
      fetchMessages({ archived: false });
      fetchNotifications({ archived: false });
      fetchUnreadCount();
    }
  }, [profile?.id, fetchMessages, fetchNotifications, fetchUnreadCount]);

  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel('messages-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_recipients',
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          fetchMessages({ archived: false });
          fetchUnreadCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'in_app_notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          fetchNotifications({ archived: false });
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, fetchMessages, fetchNotifications, fetchUnreadCount]);

  return {
    messages,
    notifications,
    unreadCount,
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
    // Backward compatibility with existing call sites
    deleteNotification: archiveNotification,
    refetchMessages: fetchMessages,
    refetchNotifications: fetchNotifications,
    refetchUnreadCount: fetchUnreadCount,
  };
}
