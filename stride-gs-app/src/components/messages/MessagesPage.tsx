/**
 * MessagesPage — split-view layout: conversation list on the left, active
 * thread on the right (desktop). On mobile it collapses to a single view
 * with a back button.
 *
 * Not a routed page component — this is the layout piece that a page-level
 * file can render. Drop it inside a Page when routing is wired up.
 *
 * Ported from the Stride WMS app.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Tag } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMessages, type Conversation } from '../../hooks/useMessages';
import { MessageList } from './MessageList';
import { ConversationView } from './ConversationView';
import { MessageInputBar } from './MessageInputBar';

export function MessagesPage() {
  const v2 = theme.v2;
  const { isMobile } = useIsMobile();
  const {
    conversations,
    thread,
    threadLoading,
    loading,
    activeThreadKey,
    openThread,
    closeThread,
    sendMessage,
    markAllReadInThread,
  } = useMessages();

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthUserId(data.session?.user.id ?? null));
  }, []);

  // Mark the whole thread read whenever it changes (and is non-empty).
  useEffect(() => {
    if (activeThreadKey && thread.length > 0) {
      void markAllReadInThread();
    }
  }, [activeThreadKey, thread.length, markAllReadInThread]);

  const active = conversations.find(c => c.key === activeThreadKey) || null;

  const handleSelect = (c: Conversation) => { void openThread(c.key); };

  const handleSend = async (body: string) => {
    if (!active) return;
    // Recipient resolution: direct threads → the other party's user id
    // lives in the key. Entity threads → we can't know recipients from
    // the list alone, so we send to the last sender (the person currently
    // talking to you). This keeps a minimum-viable send path; full
    // recipient-picker UI lives in a separate follow-up component.
    let recipientIds: string[] = [];
    if (active.key.startsWith('direct:')) {
      recipientIds = [active.key.slice('direct:'.length)];
    } else if (thread.length > 0) {
      const lastOther = [...thread].reverse().find(m => m.senderId !== authUserId);
      if (lastOther?.senderId) recipientIds = [lastOther.senderId];
    }

    await sendMessage({
      body,
      recipientIds,
      threadId: active.threadId ?? undefined,
      entityType: active.entityType ?? undefined,
      entityId: active.entityId ?? undefined,
    });
  };

  // ── Single-view mobile ──
  if (isMobile) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: '100%', background: v2.colors.bgPage,
        fontFamily: theme.typography.fontFamily,
      }}>
        {!activeThreadKey ? (
          <MessageList
            conversations={conversations}
            activeKey={activeThreadKey}
            loading={loading}
            onSelect={handleSelect}
          />
        ) : (
          <>
            <ThreadHeader conversation={active} onBack={() => closeThread()} showBack />
            <ConversationView messages={thread} currentUserId={authUserId} loading={threadLoading} />
            <MessageInputBar onSend={handleSend} />
          </>
        )}
      </div>
    );
  }

  // ── Desktop split view ──
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '360px 1fr',
      height: '100%',
      background: v2.colors.bgPage,
      fontFamily: theme.typography.fontFamily,
    }}>
      <MessageList
        conversations={conversations}
        activeKey={activeThreadKey}
        loading={loading}
        onSelect={handleSelect}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {active ? (
          <>
            <ThreadHeader conversation={active} onBack={closeThread} showBack={false} />
            <ConversationView messages={thread} currentUserId={authUserId} loading={threadLoading} />
            <MessageInputBar onSend={handleSend} />
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: v2.colors.textMuted, fontSize: 13,
          }}>
            Select a conversation to start messaging.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thread header ──────────────────────────────────────────────────────────

function ThreadHeader({ conversation, onBack, showBack }: { conversation: Conversation | null; onBack: () => void; showBack: boolean }) {
  const v2 = theme.v2;
  if (!conversation) return null;
  const hasEntity = conversation.entityType && conversation.entityId;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 14px',
      borderBottom: `1px solid ${v2.colors.border}`,
      background: v2.colors.bgWhite,
    }}>
      {showBack && (
        <button
          onClick={onBack}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: v2.colors.textSecondary, padding: 4, display: 'flex',
          }}
        >
          <ArrowLeft size={18} />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: v2.colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conversation.title}
        </div>
      </div>
      {hasEntity && (
        <span style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
          padding: '3px 8px', borderRadius: v2.radius.badge,
          background: v2.colors.bgCard, color: v2.colors.textSecondary,
        }}>
          <Tag size={10} /> {conversation.entityType}
        </span>
      )}
    </div>
  );
}
