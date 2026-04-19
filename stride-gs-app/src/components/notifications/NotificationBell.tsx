/**
 * NotificationBell — header bell with unread badge + dropdown.
 *
 * Ported from the Stride WMS app. Shows the total unread message count
 * in a red pill on the bell icon; click opens a dropdown listing the most
 * recent notification events (buffered by useNotifications). Each row
 * links to the related entity or the Messages page. "Mark all read" wires
 * through useMessages.markRead for any currently-unread items.
 *
 * Expects to be mounted inside a react-router tree so useNavigate works.
 */
import { useEffect, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../../styles/theme';
import { useMessages } from '../../hooks/useMessages';
import {
  getRecentNotifications,
  subscribeNotifications,
  type NotificationEvent,
} from '../../hooks/useNotifications';

export function NotificationBell() {
  const v2 = theme.v2;
  const navigate = useNavigate();
  const { unreadCount, markRead, refetch } = useMessages();

  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<NotificationEvent[]>(() => getRecentNotifications());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Subscribe to live notifications → prepend to the dropdown list.
  useEffect(() => {
    const unsub = subscribeNotifications(evt => {
      setRecent(prev => [evt, ...prev].slice(0, 20));
    });
    return unsub;
  }, []);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleNavigate = (evt: NotificationEvent) => {
    setOpen(false);
    if (evt.entityType && evt.entityId) {
      // Route conventions used across the app
      const base = evt.entityType === 'repair' ? '/repairs'
        : evt.entityType === 'task' ? '/tasks'
        : evt.entityType === 'will_call' ? '/will-calls'
        : evt.entityType === 'shipment' ? '/shipments'
        : null;
      if (base) { navigate(`${base}/${encodeURIComponent(evt.entityId)}`); return; }
    }
    navigate('/messages');
  };

  const handleMarkAllRead = async () => {
    // useMessages exposes per-recipient markRead; the recent buffer stores
    // recipient ids. Fire them in parallel then refetch the inbox so the
    // global counter drops.
    await Promise.all(recent.map(r => markRead(r.recipientId)));
    await refetch();
    setRecent([]);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', fontFamily: theme.typography.fontFamily }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          position: 'relative',
          width: 36, height: 36, borderRadius: '50%',
          background: open ? v2.colors.bgCard : 'transparent',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: v2.colors.text,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = v2.colors.bgCard; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8,
            background: '#FF3B30', color: '#fff',
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 0 2px ' + v2.colors.bgWhite,
          }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 44, right: 0,
          width: 340, maxHeight: 440,
          background: v2.colors.bgWhite,
          border: `1px solid ${v2.colors.border}`,
          borderRadius: v2.radius.card,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          zIndex: 50,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px',
            borderBottom: `1px solid ${v2.colors.border}`,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: v2.colors.text }}>Notifications</div>
              <div style={{ fontSize: 11, color: v2.colors.textMuted, marginTop: 2 }}>
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </div>
            </div>
            {recent.length > 0 && (
              <button
                onClick={() => { void handleMarkAllRead(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: v2.radius.badge,
                  background: 'transparent',
                  border: `1px solid ${v2.colors.border}`,
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
                  color: v2.colors.textSecondary,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <Check size={11} /> Mark all read
              </button>
            )}
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {recent.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>
                No recent notifications.
              </div>
            ) : recent.map((evt) => (
              <button
                key={evt.recipientId}
                onClick={() => handleNavigate(evt)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                  width: '100%', textAlign: 'left',
                  padding: '10px 14px',
                  border: 'none',
                  borderBottom: `1px solid ${v2.colors.border}`,
                  background: 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = v2.colors.bgCard; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: v2.colors.text }}>
                    {evt.senderName}
                  </span>
                  {evt.entityType && evt.entityId && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
                      padding: '1px 6px', borderRadius: v2.radius.badge,
                      background: v2.colors.bgCard, color: v2.colors.textSecondary,
                    }}>{evt.entityType}</span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: v2.colors.textMuted }}>
                    {new Date(evt.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{
                  fontSize: 12, color: v2.colors.textSecondary,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}>{evt.body}</div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div style={{ borderTop: `1px solid ${v2.colors.border}`, padding: 8, textAlign: 'center' }}>
            <button
              onClick={() => { setOpen(false); navigate('/messages'); }}
              style={{
                padding: '6px 14px', borderRadius: v2.radius.badge,
                border: 'none', background: 'transparent',
                color: '#007AFF', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Open Messages
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
