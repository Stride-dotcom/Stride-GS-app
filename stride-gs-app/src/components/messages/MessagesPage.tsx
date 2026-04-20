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
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Edit3, ExternalLink } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMessages, type Conversation, type Message } from '../../hooks/useMessages';
import { useProfiles } from '../../hooks/useProfiles';
import { useAuth } from '../../contexts/AuthContext';
import { MessageList } from './MessageList';
import { ConversationView } from './ConversationView';
import { MessageInputBar } from './MessageInputBar';
import { ComposeMessageModal } from './ComposeMessageModal';

export function MessagesPage() {
  const v2 = theme.v2;
  const { isMobile } = useIsMobile();
  const {
    authUserId,
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

  // Session 74: authUserId comes from the shared useMessages provider —
  // same source the hook itself uses for RLS matching + realtime filtering.
  // The previous local `supabase.auth.getSession()` lookup raced first-render
  // sends: on the initial render it was null, handleSend's "pick non-self"
  // logic then derived the wrong "other" uid (often picking the sender
  // themselves), and the message was effectively sent to nobody — the
  // sender's thread stayed empty while the DB insert "succeeded" with a
  // malformed recipient set.

  const [composeOpen, setComposeOpen] = useState(false);

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
    // Session 74: bail if authUserId isn't resolved yet. Without it the
    // "other party" detection below would mis-classify self as other and
    // send the message to the wrong recipient (or no recipient at all).
    if (!authUserId) {
      console.warn('[MessagesPage] handleSend: authUserId not ready, ignoring send');
      return;
    }
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
            <ThreadHeader conversation={active} thread={thread} currentUserId={authUserId} onBack={() => closeThread()} showBack />
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
            <ThreadHeader conversation={active} thread={thread} currentUserId={authUserId} onBack={closeThread} showBack={false} />
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
//
// Entity-linked threads used to render only "RE: inventory 62408" as a title
// with a tiny grey INVENTORY badge — you couldn't tell who was in the thread
// and the entity id wasn't clickable. WhatsApp-style fix:
//   • Line 1: thread title (entity label or other party's name)
//   • Line 2: comma-separated participant names (everyone on the thread minus
//     self). Computed from thread messages (senders + recipientUserIds) and
//     mapped to display names via profiles. Falls back silently if profiles
//     aren't loaded yet.
//   • Trailing chip: entity deep-link — e.g. "Inventory 62408" with an
//     external-link icon. Opens in a new tab (target=_blank) so the user
//     keeps the chat open while reviewing entity details. Uses the standard
//     query-param deep-link format (CLAUDE.md "Deep Links" section). When
//     the current user is a client-role, &client=<their tenant> is appended
//     so the list page's deep-link handler can resolve immediately; staff/
//     admin get the entity-only URL (they can pick the client on arrival).

const ENTITY_ROUTE: Record<string, string> = {
  inventory: 'inventory',
  task: 'tasks',
  repair: 'repairs',
  will_call: 'will-calls',
  shipment: 'shipments',
  claim: 'claims',
};

const ENTITY_LABEL: Record<string, string> = {
  inventory: 'Inventory',
  task: 'Task',
  repair: 'Repair',
  will_call: 'Will Call',
  shipment: 'Shipment',
  claim: 'Claim',
};

// Per CLAUDE.md "Deep Links" section: deep-link URLs MUST include
// `&client=<spreadsheetId>` or the list page's deep-link handler never
// resolves and the detail panel never opens. Each entity lives in its
// own Supabase mirror with a `tenant_id` column that maps to the CB
// Clients spreadsheetId, so we look it up on demand and cache it in a
// module-level Map so repeat thread opens don't re-query.
interface EntityTenantLookup {
  table: string;
  idColumn: string;
}
const ENTITY_TENANT_TABLE: Record<string, EntityTenantLookup> = {
  inventory: { table: 'item_id_ledger', idColumn: 'item_id' },
  task:      { table: 'tasks',          idColumn: 'task_id' },
  repair:    { table: 'repairs',        idColumn: 'repair_id' },
  will_call: { table: 'will_calls',     idColumn: 'wc_number' },
  shipment:  { table: 'shipments',      idColumn: 'shipment_number' },
};
const tenantCache = new Map<string, string | null>(); // key: `${type}:${id}`

async function resolveEntityTenant(type: string, id: string): Promise<string | null> {
  const cacheKey = `${type}:${id}`;
  if (tenantCache.has(cacheKey)) return tenantCache.get(cacheKey) ?? null;
  const lookup = ENTITY_TENANT_TABLE[type.toLowerCase()];
  if (!lookup) { tenantCache.set(cacheKey, null); return null; }
  const { data } = await supabase
    .from(lookup.table)
    .select('tenant_id')
    .eq(lookup.idColumn, id)
    .limit(1)
    .maybeSingle();
  const tid = (data as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  tenantCache.set(cacheKey, tid);
  return tid;
}

interface ThreadHeaderProps {
  conversation: Conversation | null;
  thread: Message[];
  currentUserId: string | null;
  onBack: () => void;
  showBack: boolean;
}

function ThreadHeader({ conversation, thread, currentUserId, onBack, showBack }: ThreadHeaderProps) {
  const v2 = theme.v2;
  const { profiles } = useProfiles(true);
  const { user } = useAuth();
  const [resolvedTenant, setResolvedTenant] = useState<string | null>(null);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.displayName || p.email);
    return m;
  }, [profiles]);

  // Resolve the entity's clientSheetId from Supabase so deep links always
  // include &client=<tenant> (CLAUDE.md rule #2 for deep links). For
  // client-role users we short-circuit to their bound tenant; for staff/
  // admin we query the entity's mirror table. Result is cached in a
  // module-level Map so rapidly switching between threads doesn't re-query.
  useEffect(() => {
    const type = conversation?.entityType;
    const id = conversation?.entityId;
    if (!type || !id) { setResolvedTenant(null); return; }
    // Client-role users always message about their own tenant — skip the
    // lookup and use their binding directly.
    if (user?.role === 'client' && user.clientSheetId) {
      setResolvedTenant(user.clientSheetId);
      return;
    }
    let cancelled = false;
    void resolveEntityTenant(type, id).then(tid => {
      if (!cancelled) setResolvedTenant(tid);
    });
    return () => { cancelled = true; };
  }, [conversation?.entityType, conversation?.entityId, user?.role, user?.clientSheetId]);

  // Collect every non-self participant from the thread. Using both senderId
  // and recipientUserIds covers brand-new threads where only one side has
  // spoken so far (senderId gives us the initiator even before recipients
  // reply).
  const participantNames = useMemo(() => {
    if (!thread.length) return [] as string[];
    const ids = new Set<string>();
    for (const m of thread) {
      if (m.senderId && m.senderId !== currentUserId) ids.add(m.senderId);
      for (const uid of m.recipientUserIds) {
        if (uid && uid !== currentUserId) ids.add(uid);
      }
    }
    return Array.from(ids).map(uid => nameById.get(uid) ?? 'Unknown').sort();
  }, [thread, currentUserId, nameById]);

  if (!conversation) return null;
  const hasEntity = !!(conversation.entityType && conversation.entityId);
  const route = hasEntity ? ENTITY_ROUTE[conversation.entityType!.toLowerCase()] : null;
  const label = hasEntity ? (ENTITY_LABEL[conversation.entityType!.toLowerCase()] ?? conversation.entityType!) : '';
  // CLAUDE.md deep-link rule: ALWAYS include &client=<spreadsheetId>. The
  // list page's deep-link handler keys on it to pick the right client in
  // the dropdown and auto-open the detail panel. Without it the user lands
  // on an empty list. We only render the chip once the tenant has resolved
  // to avoid shipping a half-formed URL.
  const deepLinkHref = hasEntity && route && resolvedTenant
    ? `${window.location.origin}/#/${route}?open=${encodeURIComponent(conversation.entityId!)}&client=${encodeURIComponent(resolvedTenant)}`
    : null;

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
        {participantNames.length > 0 && (
          <div
            title={participantNames.join(', ')}
            style={{
              fontSize: 11, color: v2.colors.textMuted, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {participantNames.join(', ')}
          </div>
        )}
      </div>
      {hasEntity && deepLinkHref && (
        <a
          href={deepLinkHref}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${label} ${conversation.entityId} in a new tab`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 600,
            padding: '5px 10px', borderRadius: 100,
            background: '#FFF7F0', color: '#B34710',
            border: '1px solid rgba(232,105,42,0.3)',
            textDecoration: 'none', flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {label} {conversation.entityId}
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}
