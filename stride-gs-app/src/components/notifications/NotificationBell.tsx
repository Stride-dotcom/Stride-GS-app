/**
 * NotificationBell — simplified to a pure Messages quick-link.
 *
 * Session 74: the "notifications" concept was removed. This icon is now
 * only about unread messages — click navigates to /messages, and the red
 * badge shows the count from useMessages.unreadCount. No dropdown, no
 * recent-notification buffer, no persistent banner. When a user opens
 * their thread and markAllReadInThread fires, unreadCount drops and the
 * badge clears automatically (useMessages drives it off the current
 * recipient rows).
 */
import { MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../../styles/theme';
import { useMessages } from '../../hooks/useMessages';

export function NotificationBell() {
  const v2 = theme.v2;
  const navigate = useNavigate();
  const { unreadCount } = useMessages();

  return (
    <button
      onClick={() => navigate('/messages')}
      title={unreadCount > 0 ? `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}` : 'Messages'}
      aria-label="Messages"
      style={{
        position: 'relative',
        width: 36, height: 36, borderRadius: '50%',
        background: 'transparent',
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: v2.colors.text,
        transition: 'background 0.15s',
        fontFamily: theme.typography.fontFamily,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = v2.colors.bgCard; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <MessageSquare size={18} />
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
  );
}
