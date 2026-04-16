import { useEffect, useRef } from 'react';
import { useAppleBanner } from './useAppleBanner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from 'react-router-dom';

export function useMessageNotifications() {
  const { showBanner } = useAppleBanner();
  const { profile } = useAuth();
  const location = useLocation();
  const processedIds = useRef(new Set<string>());
  const locationRef = useRef(location.pathname);

  // Keep location ref in sync
  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel('message-banner-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_recipients',
          filter: `user_id=eq.${profile.id}`,
        },
        async (payload) => {
          const recipient = payload.new as {
            id: string;
            message_id: string;
            user_id: string;
          };

          // Don't notify if user is already on the Messages page
          if (locationRef.current.startsWith('/messages')) return;

          // Dedup
          if (processedIds.current.has(recipient.id)) return;
          processedIds.current.add(recipient.id);

          // Fetch full message details
          const { data: message } = await supabase
            .from('messages')
            .select('id, sender_id, subject, body, sender:profiles!messages_sender_id_fkey(first_name, last_name)')
            .eq('id', recipient.message_id)
            .single();

          if (!message) return;

          // Don't notify for own messages
          if (message.sender_id === profile.id) return;

          const sender = message.sender as unknown as { first_name: string | null; last_name: string | null } | null;
          const senderName = sender
            ? `${sender.first_name || ''} ${sender.last_name || ''}`.trim()
            : 'New Message';

          // Play notification sound
          try {
            const audio = new Audio('/sounds/message-notification.mp3');
            audio.volume = 0.3;
            audio.play().catch(() => {});
          } catch {
            // Audio not available
          }

          // Haptic feedback on mobile
          if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
          }

          // Trigger persistent banner
          showBanner({
            title: senderName || 'New Message',
            messagePreview: message.body?.substring(0, 120) || 'Sent you a message',
            type: 'info',
            persistent: true,
            navigateTo: '/messages',
            icon: 'chat',
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, showBanner]);
}
