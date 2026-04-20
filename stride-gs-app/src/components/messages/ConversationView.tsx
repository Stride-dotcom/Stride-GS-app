/**
 * ConversationView — iMessage-style thread of messages.
 *
 * Ported from the Stride WMS app. Groups consecutive messages from the
 * same sender and inserts date separators ("Today", "Yesterday", or
 * full date) when the date changes. Auto-scrolls to the bottom on mount
 * and whenever new messages arrive.
 */
import { useEffect, useMemo, useRef } from 'react';
import { theme } from '../../styles/theme';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../../hooks/useMessages';

interface Props {
  messages: Message[];
  currentUserId: string | null;
  /** True while fetching the next page of messages — dims the list. */
  loading?: boolean;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today';
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const ageDays = (now.getTime() - d.getTime()) / 86400000;
  if (ageDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

interface DisplayItem {
  kind: 'separator' | 'bubble';
  id: string;
  // Only set for bubbles:
  message?: Message;
  showHeader?: boolean;
  showFooter?: boolean;
  isOwn?: boolean;
  // Only set for separators:
  label?: string;
}

export function ConversationView({ messages, currentUserId, loading = false }: Props) {
  const v2 = theme.v2;
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    let lastDateLabel = '';
    let lastSenderId: string | null | undefined = undefined;

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const label = formatDateLabel(m.createdAt);
      if (label !== lastDateLabel) {
        out.push({ kind: 'separator', id: `sep-${i}`, label });
        lastDateLabel = label;
        lastSenderId = undefined; // force header on next bubble after a date break
      }

      // Session 74 fix: compare case-insensitive on trimmed strings. Both
      // sides are uuids from auth.uid() so === works in practice, but this
      // is a belt-and-suspenders guard against any stray whitespace/case
      // drift that would otherwise make sent bubbles render as received
      // (grey on the wrong side of the thread).
      const isOwn = !!currentUserId
        && (m.senderId || '').trim().toLowerCase() === currentUserId.trim().toLowerCase();
      const prev = messages[i - 1];
      const next = messages[i + 1];

      // Header (avatar + name) only on the first bubble of a consecutive run.
      const showHeader = lastSenderId !== m.senderId
        || !prev
        || formatDateLabel(prev.createdAt) !== label;

      // Footer (timestamp) on the last bubble of a consecutive run or if the
      // next bubble is on a different day.
      const showFooter = !next
        || next.senderId !== m.senderId
        || formatDateLabel(next.createdAt) !== label;

      out.push({
        kind: 'bubble',
        id: m.id,
        message: m,
        isOwn,
        showHeader: !isOwn && showHeader,
        showFooter,
      });
      lastSenderId = m.senderId;
    }
    return out;
  }, [messages, currentUserId]);

  // Auto-scroll to bottom on mount + whenever the thread grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1, overflowY: 'auto',
        padding: '12px 16px',
        background: v2.colors.bgPage,
        fontFamily: theme.typography.fontFamily,
        opacity: loading ? 0.7 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {messages.length === 0 && !loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', color: v2.colors.textMuted, fontSize: 13,
        }}>
          No messages yet. Start the conversation.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map(item => item.kind === 'separator' ? (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '14px 0 8px',
            color: v2.colors.textMuted,
          }}>
            <div style={{ flex: 1, height: 1, background: v2.colors.border }} />
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
            }}>{item.label}</span>
            <div style={{ flex: 1, height: 1, background: v2.colors.border }} />
          </div>
        ) : (
          <MessageBubble
            key={item.id}
            message={item.message!}
            isOwn={!!item.isOwn}
            showHeader={!!item.showHeader}
            showFooter={!!item.showFooter}
          />
        ))}
      </div>
    </div>
  );
}
