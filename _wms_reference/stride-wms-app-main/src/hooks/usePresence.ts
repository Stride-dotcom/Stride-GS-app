import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PresenceUser {
  user_id: string;
  online_at: string;
  status: 'online' | 'away' | 'offline';
}

export interface UserPresenceState {
  [userId: string]: PresenceUser;
}

/**
 * Hook for tracking user presence using Supabase Realtime
 * Updates the user's presence status and tracks other online users
 */
export function usePresence() {
  const { profile } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<UserPresenceState>({});
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Track my own presence
  const trackPresence = useCallback(async () => {
    if (!profile?.id || !profile?.tenant_id) return;

    const channel = supabase.channel(`presence:${profile.tenant_id}`, {
      config: {
        presence: {
          key: profile.id,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceUser>();
        const users: UserPresenceState = {};

        // Convert the presence state to a more usable format
        Object.keys(state).forEach((userId) => {
          const presences = state[userId];
          if (presences && presences.length > 0) {
            // Take the most recent presence
            const latest = presences[presences.length - 1];
            users[userId] = {
              user_id: userId,
              online_at: latest.online_at || new Date().toISOString(),
              status: latest.status || 'online',
            };
          }
        });

        setOnlineUsers(users);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (newPresences && newPresences.length > 0) {
          const latest = newPresences[newPresences.length - 1] as unknown as PresenceUser;
          setOnlineUsers((prev) => ({
            ...prev,
            [key]: {
              user_id: key,
              online_at: latest.online_at || new Date().toISOString(),
              status: latest.status || 'online',
            },
          }));
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setOnlineUsers((prev) => {
          const newState = { ...prev };
          delete newState[key];
          return newState;
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          // Track my presence
          await channel.track({
            user_id: profile.id,
            online_at: new Date().toISOString(),
            status: 'online' as const,
          });
        } else {
          setIsConnected(false);
        }
      });

    channelRef.current = channel;

    return channel;
  }, [profile?.id, profile?.tenant_id]);

  // Set up presence tracking
  useEffect(() => {
    let channel: RealtimeChannel | undefined;

    const setup = async () => {
      channel = await trackPresence();
    };

    setup();

    // Handle visibility change (away when tab is hidden)
    const handleVisibilityChange = async () => {
      if (!channelRef.current || !profile?.id) return;

      if (document.hidden) {
        await channelRef.current.track({
          user_id: profile.id,
          online_at: new Date().toISOString(),
          status: 'away' as const,
        });
      } else {
        await channelRef.current.track({
          user_id: profile.id,
          online_at: new Date().toISOString(),
          status: 'online' as const,
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (channel) {
        channel.unsubscribe();
      }
    };
  }, [trackPresence, profile?.id]);

  // Check if a specific user is online
  const isUserOnline = useCallback(
    (userId: string): boolean => {
      return !!onlineUsers[userId] && onlineUsers[userId].status !== 'offline';
    },
    [onlineUsers]
  );

  // Get a user's presence status
  const getUserStatus = useCallback(
    (userId: string): 'online' | 'away' | 'offline' => {
      const presence = onlineUsers[userId];
      if (!presence) return 'offline';
      return presence.status;
    },
    [onlineUsers]
  );

  return {
    onlineUsers,
    isUserOnline,
    getUserStatus,
    isConnected,
    onlineCount: Object.keys(onlineUsers).length,
  };
}
