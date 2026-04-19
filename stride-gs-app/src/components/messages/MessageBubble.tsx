/**
 * MessageBubble — single iMessage-style message bubble.
 *
 * Ported from the Stride WMS app. Sent (own) messages use the iMessage-blue
 * gradient with 18px top / 4px bottom-right corner; received messages use a
 * light-gray gradient mirrored. Optional avatar + sender name on received
 * bubbles (first bubble in a consecutive group).
 */
import { Check, CheckCheck } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { Message } from '../../hooks/useMessages';

interface Props {
  message: Message;
  isOwn: boolean;
  /** First bubble in a consecutive group from the same sender — shows avatar + name. */
  showHeader?: boolean;
  /** Last bubble in a consecutive group — shows timestamp + read receipts. */
  showFooter?: boolean;
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

export function MessageBubble({ message, isOwn, showHeader = true, showFooter = true }: Props) {
  const key = message.senderId || message.senderName || 'x';
  const avatarColor = colorForUser(key);

  // iMessage blue + received-gray gradients.
  const sentBg = 'linear-gradient(180deg, #2997FF 0%, #007AFF 100%)';
  const recvBg = 'linear-gradient(180deg, #F2F2F7 0%, #E5E5EA 100%)';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isOwn ? 'flex-end' : 'flex-start',
      padding: '2px 0',
      fontFamily: theme.typography.fontFamily,
    }}>
      {/* Received avatar column */}
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
        {/* Sender name on received bubble */}
        {!isOwn && showHeader && (
          <div style={{ fontSize: 11, color: theme.v2.colors.textMuted, marginBottom: 2, paddingLeft: 4 }}>
            {message.senderName}
          </div>
        )}

        {/* Bubble */}
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
          {message.body}
        </div>

        {/* Footer: timestamp + read receipts (own bubbles only for receipts) */}
        {showFooter && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 10, color: theme.v2.colors.textMuted,
            marginTop: 3,
            paddingLeft: isOwn ? 0 : 6,
            paddingRight: isOwn ? 6 : 0,
          }}>
            <span>{formatTime(message.createdAt)}</span>
            {isOwn && (
              message.myRecipient?.isRead
                ? <CheckCheck size={11} color="#007AFF" />
                : <Check size={11} color={theme.v2.colors.textMuted} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
