/**
 * MessageBubble — single iMessage-style message bubble.
 *
 * Sent (own) messages use the iMessage-blue gradient with 18px top / 4px
 * bottom-right corner; received messages use a light-gray gradient mirrored.
 * Optional avatar + sender name on received bubbles (first bubble in a
 * consecutive group). On the LATEST own bubble in a thread we render an
 * iMessage-style "Delivered" / "Read HH:MM" line below — driven by the
 * other party's recipient row read state (RLS lets the sender see it).
 */
import { Fragment } from 'react';
import { theme } from '../../styles/theme';
import type { Message } from '../../hooks/useMessages';

interface Props {
  message: Message;
  isOwn: boolean;
  /** Current user's auth uid — used to exclude own row from read-receipt aggregation. */
  currentUserId: string | null;
  /** First bubble in a consecutive group from the same sender — shows avatar + name. */
  showHeader?: boolean;
  /** Last bubble in a consecutive group — shows timestamp. */
  showFooter?: boolean;
  /** True iff this is the latest OWN bubble in the entire thread.
   *  Drives whether to render the "Delivered" / "Read" iMessage receipt below. */
  isLatestOwn?: boolean;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function colorForUser(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 50%)`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// URL detection — http(s)://, www., or bare domain.tld/path. Captures the
// match so we can rebuild the body with <a> elements interleaved between
// plain text segments.
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>]*)?)/gi;

function linkify(text: string, isOwn: boolean) {
  const segments: Array<string | { url: string; href: string }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push(text.slice(lastIndex, start));
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    segments.push({ url, href });
    lastIndex = start + url.length;
  }
  if (lastIndex < text.length) segments.push(text.slice(lastIndex));
  return segments.map((s, i) =>
    typeof s === 'string'
      ? <Fragment key={i}>{s}</Fragment>
      : <a
          key={i}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            color: isOwn ? '#fff' : '#007AFF',
            textDecoration: 'underline',
            wordBreak: 'break-all',
          }}
        >{s.url}</a>
  );
}

/** "Delivered" or "Read HH:MM" based on other-party recipient read state. */
function readReceiptText(message: Message, currentUserId: string | null): string | null {
  if (!currentUserId) return null;
  const others = message.recipientReads.filter(r => r.userId !== currentUserId);
  if (others.length === 0) return 'Sent';
  const allRead = others.every(r => r.isRead);
  if (allRead) {
    // Use the most recent readAt among other recipients.
    const readAts = others.map(r => r.readAt).filter((s): s is string => !!s);
    if (readAts.length > 0) {
      readAts.sort();
      return `Read ${formatTime(readAts[readAts.length - 1])}`;
    }
    return 'Read';
  }
  return 'Delivered';
}

export function MessageBubble({
  message,
  isOwn,
  currentUserId,
  showHeader = true,
  showFooter = true,
  isLatestOwn = false,
}: Props) {
  const key = message.senderId || message.senderName || 'x';
  const avatarColor = colorForUser(key);

  const sentBg = 'linear-gradient(180deg, #2997FF 0%, #007AFF 100%)';
  const recvBg = 'linear-gradient(180deg, #F2F2F7 0%, #E5E5EA 100%)';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isOwn ? 'flex-end' : 'flex-start',
      padding: '2px 0',
      fontFamily: theme.typography.fontFamily,
    }}>
      {!isOwn && (
        <div style={{ width: 32, marginRight: 8, display: 'flex', alignItems: 'flex-end' }}>
          {showHeader && (
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: avatarColor, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600,
            }}>{initialsFromName(message.senderName || '?')}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start', maxWidth: '74%' }}>
        {!isOwn && showHeader && (
          <div style={{ fontSize: 11, color: theme.v2.colors.textMuted, marginBottom: 2, paddingLeft: 4 }}>
            {message.senderName}
          </div>
        )}

        <div style={{
          background: isOwn ? sentBg : recvBg,
          color: isOwn ? '#fff' : theme.v2.colors.text,
          padding: '8px 13px',
          fontSize: 15,
          lineHeight: 1.35,
          borderRadius: isOwn
            ? '18px 18px 4px 18px'
            : '18px 18px 18px 4px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          boxShadow: '0 1px 1px rgba(0,0,0,0.06)',
        }}>
          {linkify(message.body, isOwn)}
        </div>

        {showFooter && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: theme.v2.colors.textMuted,
            marginTop: 3,
            paddingLeft: isOwn ? 0 : 6,
            paddingRight: isOwn ? 6 : 0,
          }}>
            <span>{formatTime(message.createdAt)}</span>
          </div>
        )}

        {isOwn && isLatestOwn && (() => {
          const text = readReceiptText(message, currentUserId);
          if (!text) return null;
          const isRead = text.startsWith('Read');
          return (
            <div style={{
              fontSize: 10,
              fontWeight: isRead ? 600 : 500,
              color: isRead ? '#007AFF' : theme.v2.colors.textMuted,
              marginTop: 2,
              paddingRight: 6,
            }}>{text}</div>
          );
        })()}
      </div>
    </div>
  );
}
