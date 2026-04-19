/**
 * MessageList — scrollable conversation list (left pane of the Messages page).
 *
 * Ported from the Stride WMS app. Each row shows: avatar, title (other party
 * name or "RE: Repair RPR-0089"), last-message preview, relative timestamp,
 * and an unread-count badge. Click selects the conversation. A sticky
 * search bar filters conversations by title/preview client-side.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { Conversation } from '../../hooks/useMessages';

interface Props {
  conversations: Conversation[];
  activeKey: string | null;
  loading?: boolean;
  onSelect: (conversation: Conversation) => void;
}

function initialsFromTitle(title: string): string {
  // Strip the "RE: " prefix and any entity type/ID prefix for initial-letter
  const stripped = title.replace(/^RE:\s*/i, '').trim();
  const parts = stripped.split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function colorForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 50%)`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

export function MessageList({ conversations, activeKey, loading = false, onSelect }: Props) {
  const v2 = theme.v2;
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(c =>
      c.title.toLowerCase().includes(q) || c.lastMessagePreview.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: v2.colors.bgWhite,
      borderRight: `1px solid ${v2.colors.border}`,
      minWidth: 0,
      fontFamily: theme.typography.fontFamily,
    }}>
      {/* Search */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${v2.colors.border}` }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: v2.colors.textMuted, pointerEvents: 'none',
          }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search messages…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px 8px 32px',
              border: `1px solid ${v2.colors.border}`,
              borderRadius: v2.radius.input,
              background: v2.colors.bgPage,
              fontSize: 13, color: v2.colors.text, fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && conversations.length === 0 && (
          <div style={{ padding: 32, color: v2.colors.textMuted, fontSize: 13, textAlign: 'center' }}>
            Loading…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 32, color: v2.colors.textMuted, fontSize: 13, textAlign: 'center' }}>
            {search ? 'No conversations match your search.' : 'No conversations yet.'}
          </div>
        )}
        {filtered.map(c => {
          const active = c.key === activeKey;
          return (
            <button
              key={c.key}
              onClick={() => onSelect(c)}
              style={{
                width: '100%', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px',
                border: 'none',
                borderBottom: `1px solid ${v2.colors.border}`,
                background: active ? v2.colors.bgCard : 'transparent',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = v2.colors.bgPage; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {/* Avatar */}
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: colorForKey(c.key), color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 600, flexShrink: 0,
              }}>{initialsFromTitle(c.title)}</div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{
                    fontSize: 14, fontWeight: c.unreadCount > 0 ? 600 : 500,
                    color: v2.colors.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1, minWidth: 0,
                  }}>{c.title}</span>
                  <span style={{ fontSize: 11, color: v2.colors.textMuted, flexShrink: 0 }}>
                    {formatRelative(c.lastMessageAt)}
                  </span>
                </div>
                <div style={{
                  fontSize: 13,
                  color: c.unreadCount > 0 ? v2.colors.text : v2.colors.textSecondary,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginTop: 2,
                }}>{c.lastMessagePreview || '\u00A0'}</div>
              </div>

              {/* Unread badge */}
              {c.unreadCount > 0 && (
                <span style={{
                  minWidth: 18, height: 18, padding: '0 6px',
                  borderRadius: 9,
                  background: '#007AFF', color: '#fff',
                  fontSize: 11, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
