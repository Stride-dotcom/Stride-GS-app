/**
 * useNotifications — side-effect hook for incoming message alerts.
 *
 * Ported from the Stride WMS app. Mount once in AppLayout. Subscribes to
 * public.message_recipients filtered by the current user's auth.users.id
 * and, on any INSERT that's unread and unarchived:
 *   1. Fetches the parent message row for preview + sender info.
 *   2. Emits a NotificationEvent on the module-level emitter so any mounted
 *      listener (PersistentBanner, NotificationBell) can react.
 *   3. Plays a short notification tone via Web Audio API.
 *   4. Vibrates the device (navigator.vibrate) when available.
 *
 * Skips all side-effects when the user is already on /messages (they'll
 * see the new message inline) OR when document.hidden is true but the
 * browser is about to surface its own system notification.
 *
 * Processed IDs are tracked in a module-level Set so the same event
 * received twice (reconnect, tab visibility change) doesn't double-alert.
 */
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ─── Public types + event bus (used by PersistentBanner + NotificationBell) ─

export interface NotificationEvent {
  recipientId: string;
  messageId: string;
  senderName: string;
  senderId: string | null;
  body: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

type Listener = (evt: NotificationEvent) => void;
const listeners = new Set<Listener>();

export function subscribeNotifications(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(evt: NotificationEvent): void {
  for (const fn of listeners) {
    try { fn(evt); } catch { /* swallow */ }
  }
}

/** Exposed so the banner can dismiss past notifications when the user
 *  clears them; also lets the bell retrieve a "recent notifications" buffer. */
const recentBuffer: NotificationEvent[] = [];
const MAX_RECENT = 20;
export function getRecentNotifications(): NotificationEvent[] { return recentBuffer.slice(); }
export function clearRecentNotifications(): void { recentBuffer.length = 0; }

// ─── Processed-id tracking to avoid duplicate alerts ───────────────────────
const processed = new Set<string>();

// ─── Sound + haptic helpers ────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null;
function playPing(): void {
  try {
    if (!_audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      _audioCtx = new AC();
    }
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Two-tone iMessage-like ping: 880 Hz → 1320 Hz
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch { /* autoplay blocked; silent */ }
}

function vibrate(): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
    if (typeof nav.vibrate === 'function') nav.vibrate([15, 40, 15]);
  } catch { /* unsupported */ }
}

// ─── Row shape for the realtime payload ───────────────────────────────────

interface RecipientRow {
  id: string;
  message_id: string;
  recipient_id: string;
  is_read: boolean | null;
  is_archived: boolean | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  thread_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  body: string;
  sender_id: string | null;
  sender_name: string | null;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useNotifications(): void {
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;
    let authUserId: string | null = null;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      authUserId = data.session?.user.id ?? null;
    });

    const onInsert = async (payload: { new?: RecipientRow }) => {
      const row = payload.new;
      if (!row || !authUserId) return;
      if (row.recipient_id !== authUserId) return;
      if (row.is_read || row.is_archived) return;
      if (processed.has(row.id)) return;
      processed.add(row.id);

      // Don't spam notifications while the user is actively on the messages
      // page — they see them inline. Check after the dedup so repeated events
      // while on /messages still get tracked as processed.
      const onMessagesPage = typeof window !== 'undefined'
        && window.location.hash.startsWith('#/messages');

      // Fetch the parent message for the preview.
      const { data: msgData } = await supabase
        .from('messages')
        .select('id, thread_id, entity_type, entity_id, body, sender_id, sender_name')
        .eq('id', row.message_id)
        .single();
      const msg = msgData as MessageRow | null;
      if (!msg) return;

      const evt: NotificationEvent = {
        recipientId: row.id,
        messageId: msg.id,
        senderName: msg.sender_name ?? 'Unknown',
        senderId: msg.sender_id,
        body: msg.body,
        entityType: msg.entity_type,
        entityId: msg.entity_id,
        createdAt: row.created_at,
      };

      // Ring buffer for the bell's "recent" list.
      recentBuffer.unshift(evt);
      if (recentBuffer.length > MAX_RECENT) recentBuffer.length = MAX_RECENT;

      if (!onMessagesPage) {
        playPing();
        vibrate();
        emit(evt);
      }
    };

    // We subscribe even before authUserId resolves — the check inside onInsert
    // skips stray events until we have it.
    const channel = supabase
      .channel('messages_notifier')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_recipients' },
        (payload) => { void onInsert(payload as { new?: RecipientRow }); })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [user]);
}
