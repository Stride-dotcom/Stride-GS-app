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
import { ArrowLeft, Tag, Edit3 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMessages, type Conversation } from '../../hooks/useMessages';
import { MessageList } from './MessageList';
import { ConversationView } from './ConversationView';
import { MessageInputBar } from './MessageInputBar';
import { ComposeMessageModal } from './ComposeMessageModal';

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
    deleteConversation,
  } = useMessages();

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthUserId(data.session?.user.id ?? null));
  }, []);

  // After compose: open the newly-sent thread so the user lands on their
  // message. Entity-linked threads open via entity key; direct threads open
  // via the first recipient's id.
  const handleCompose = async (params: Parameters<typeof sendMessage>[0]) => {
    const msg = await sendMessage(params);
    if (msg) {
      if (params.entityType && params.entityId) {
        void openThread({ entityType: params.entityType, entityId: params.entityId });
      } else if (params.recipientIds.length > 0) {
        // Session 74 fix: pass the object form so useMessages builds the
        // canonical sorted `direct:<uidA>:<uidB>` key. The earlier string
        // form `direct:<recipient_uid>` produced a malformed key (second
        // uid = undefined) which stored an invalid activeThreadKey and
        // caused subsequent replies to split into a new conversation bucket.
        void openThread({ otherUserId: params.recipientIds[0] });
      }
    }
    return msg;
  };

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
    // Recipient resolution: direct threads → the OTHER party's user id
    // (key format is `direct:<uidA>:<uidB>` sorted-stable; pick whichever
    // isn't self). Entity threads → we can't know recipients from the
    // list alone, so we send to the last sender (the person currently
    // talking to you). Minimum-viable send path; full recipient-picker
    // UI lives in a separate follow-up component.
    let recipientIds: string[] = [];
    if (active.key.startsWith('direct:')) {
      // Session 74 hotfix: the previous `.slice('direct:'.length)` returned
      // the concatenated `uidA:uidB` blob as a single string, which then
      // became a malformed uuid in message_recipients.user_id and the
      // insert failed silently. Split properly and pick the non-self side.
      const parts = active.key.split(':'); // ['direct', uidA, uidB]
      const [a, b] = [parts[1], parts[2]];
      const other = a === authUserId ? b : a;
      if (other) recipientIds = [other];
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
          <>
            <ComposeHeader onCompose={() => setComposeOpen(true)} />
            <MessageList
              conversations={conversations}
              activeKey={activeThreadKey}
              loading={loading}
              onSelect={handleSelect}
            />
          </>
        ) : (
          <>
            <ThreadHeader conversation={active} onBack={() => closeThread()} showBack />
            <ConversationView messages={thread} currentUserId={authUserId} loading={threadLoading} />
            <MessageInputBar onSend={handleSend} />
          </>
        )}
        {composeOpen && (
          <ComposeMessageModal
            onClose={() => setComposeOpen(false)}
            onSend={handleCompose}
            currentUserId={authUserId}
          />
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
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: `1px solid ${v2.colors.border}` }}>
        <ComposeHeader onCompose={() => setComposeOpen(true)} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <MessageList
            conversations={conversations}
            activeKey={activeThreadKey}
            loading={loading}
            onSelect={handleSelect}
            onDelete={(c) => { void deleteConversation(c.key); }}
          />
        </div>
      </div>
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
      {composeOpen && (
        <ComposeMessageModal
          onClose={() => setComposeOpen(false)}
          onSend={handleCompose}
          currentUserId={authUserId}
        />
      )}
    </div>
  );
}

// ─── Compose header (top of the conversation list) ─────────────────────────

function ComposeHeader({ onCompose }: { onCompose: () => void }) {
  const v2 = theme.v2;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: '10px 14px',
      background: v2.colors.bgWhite,
      borderBottom: `1px solid ${v2.colors.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: v2.colors.text }}>Messages</div>
      <button
        onClick={onCompose}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', fontSize: 11, fontWeight: 700,
          letterSpacing: '1.5px', textTransform: 'uppercase',
          border: 'none', borderRadius: 100,
          background: v2.colors.accent, color: '#fff',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Edit3 size={12} /> New Message
      </button>
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
