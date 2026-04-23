/**
 * MessageTopBanner — persistent top-of-screen alert for unread incoming
 * messages. Stays visible until the user dismisses it (X button) or
 * clicks it (navigates to /messages, which marks the thread as read).
 *
 * Session 74: replaces the previous transient notifications banner.
 * Driven directly off useMessages.latestUnreadIncoming, so it:
 *   - appears within 1-2 s of a new message landing (Realtime drives
 *     useMessages' inbox refresh, which updates latestUnreadIncoming)
 *   - clears automatically when the message's recipient row is
 *     marked read (opening the thread fires markAllReadInThread)
 *   - doesn't reappear after manual dismiss unless a NEWER unread
 *     message arrives
 *
 * Mount once in AppLayout. Renders nothing when there's nothing to show.
 */
import { MessageSquare, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { theme } from '../../styles/theme';
import { useMessages } from '../../hooks/useMessages';

export function MessageTopBanner() {
  const v2 = theme.v2;
  const navigate = useNavigate();
  const location = useLocation();
  const { latestUnreadIncoming, dismissBanner } = useMessages();

  // Suppress the banner while the user is actively on the Messages page —
  // they'll see the message inline.
  const onMessagesPage = typeof window !== 'undefined'
    && window.location.hash.startsWith('#/messages');
  if (onMessagesPage) return null;

  if (!latestUnreadIncoming) return null;
  const m = latestUnreadIncoming;

  const handleOpen = () => {
    // Mark-as-read happens automatically when MessagesPage opens the thread.
    // We just dismiss the banner now so the UI feels instant.
    dismissBanner(m.id);
    navigate('/messages');
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        zIndex: 2500,
        minHeight: 60,
        background: 'linear-gradient(180deg, rgba(0,122,255,0.98) 0%, rgba(0,102,220,1) 100%)',
        color: '#fff',
        boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 16px',
        fontFamily: theme.typography.fontFamily,
        animation: 'strideMsgBannerIn 0.25s ease-out',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'rgba(255,255,255,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <MessageSquare size={16} color="#fff" />
      </div>
      <button
        onClick={handleOpen}
        style={{
          flex: 1, minWidth: 0, textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'inherit', padding: 0, fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>New message from {m.senderName}</span>
          {m.relatedEntityType && m.relatedEntityId && (
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: v2.radius.badge,
              background: 'rgba(255,255,255,0.22)', color: '#fff',
            }}>
              {m.relatedEntityType} · {m.relatedEntityId}
            </span>
          )}
          <span style={{ fontSize: 11, marginLeft: 'auto', color: 'rgba(255,255,255,0.78)' }}>
            Click to open
          </span>
        </div>
        <div style={{
          fontSize: 13, marginTop: 2, color: 'rgba(255,255,255,0.92)',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>{m.body}</div>
      </button>
      <button
        onClick={() => dismissBanner(m.id)}
        title="Dismiss"
        aria-label="Dismiss"
        style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'rgba(255,255,255,0.18)', color: '#fff',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.32)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
      >
        <X size={14} />
      </button>
      <style>{`
        @keyframes strideMsgBannerIn {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      {/* Route awareness — re-render on location change so the banner
          hides the moment the user navigates to /messages. */}
      <span style={{ display: 'none' }} data-pathname={location.pathname} />
    </div>
  );
}
