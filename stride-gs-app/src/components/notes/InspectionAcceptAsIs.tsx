/**
 * InspectionAcceptAsIs — client-only acknowledgement on a failed inspection.
 *
 * Use case: an INSP task lands in Completed/Fail state. Before staff can
 * proceed (re-inspect, repair quote, dispose), the client confirms they've
 * seen the finding. This component is the one-tap acknowledge.
 *
 * Visibility:
 *   - Renders only when type='INSP' AND status='Completed' AND result='Fail'
 *     AND the viewing user has role='client'. Staff/admin see the resulting
 *     note in the timeline but not the button itself (they have Reopen Task
 *     for corrections — different workflow).
 *
 * Idempotency:
 *   - Once an acceptance note exists on this task, the button is replaced by
 *     a green "Accepted by X on Y" badge. Detection is body-prefix based
 *     ('✓ Accepted as-is') because the schema doesn't carry a note_type
 *     column — is_system + body shape is the marker.
 *
 * Optional reply:
 *   - "Add comment" expander posts a regular (non-system) note on the task
 *     so the client can leave context (preferred shipping method, etc.) in
 *     the same place. The composer in the Notes tab is the canonical path,
 *     this is a convenience for the most common acknowledge-and-comment
 *     flow.
 */
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useEntityNotes } from '../../hooks/useEntityNotes';
import { BtnSpinner } from '../ui/BtnSpinner';

const ACCEPT_PREFIX = '✓ Accepted as-is';

interface Props {
  taskId: string;
  itemId?: string | null;
  tenantId?: string | null;
}

function formatAcceptanceDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at '
    + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function InspectionAcceptAsIs({ taskId, itemId, tenantId }: Props) {
  const { user } = useAuth();
  const { notes, addNote } = useEntityNotes('task', taskId, itemId, tenantId);

  const [accepting, setAccepting] = useState(false);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [comment, setComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptanceNote = useMemo(
    () => notes.find(n => n.body.startsWith(ACCEPT_PREFIX)),
    [notes],
  );

  const handleAccept = async () => {
    if (accepting || acceptanceNote) return;
    setError(null);
    setAccepting(true);
    const name = user?.displayName || user?.email || 'Client';
    const when = formatAcceptanceDate(new Date().toISOString());
    const body = `${ACCEPT_PREFIX} by ${name} on ${when}`;
    const result = await addNote(body, 'public', [], { isSystem: true });
    setAccepting(false);
    if (!result) setError('Could not save acceptance. Please try again.');
  };

  const handlePostComment = async () => {
    const trimmed = comment.trim();
    if (!trimmed || postingComment) return;
    setError(null);
    setPostingComment(true);
    const result = await addNote(trimmed, 'public', []);
    setPostingComment(false);
    if (result) {
      setComment('');
      setShowCommentBox(false);
    } else {
      setError('Could not post comment. Please try again.');
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 14px',
      background: '#FFFBEB',
      border: `1px solid #FDE68A`,
      borderRadius: 10,
      fontFamily: 'inherit',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E' }}>
        Inspection failed — your acknowledgement is requested.
      </div>

      {acceptanceNote ? (
        <AcceptedBadge
          authorName={acceptanceNote.authorName || 'Client'}
          createdAt={acceptanceNote.createdAt}
        />
      ) : (
        <button
          onClick={() => { void handleAccept(); }}
          disabled={accepting}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '9px 16px', borderRadius: 10,
            background: '#15803D', color: '#fff',
            border: 'none', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.4px',
            cursor: accepting ? 'wait' : 'pointer',
            alignSelf: 'flex-start',
            opacity: accepting ? 0.7 : 1,
          }}
        >
          {accepting ? <BtnSpinner size={12} color="#fff" /> : <Check size={14} />}
          {accepting ? 'Saving…' : 'Accept As-Is'}
        </button>
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#B91C1C' }}>{error}</div>
      )}

      {showCommentBox ? (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: 10, background: '#FFFFFF',
          border: `1px solid ${theme.colors.border}`, borderRadius: 8,
        }}>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment (optional)…"
            rows={2}
            style={{
              width: '100%', border: 'none', outline: 'none', resize: 'vertical',
              fontFamily: 'inherit', fontSize: 13, color: theme.colors.text,
              background: 'transparent', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowCommentBox(false); setComment(''); }}
              disabled={postingComment}
              style={{
                padding: '6px 12px', borderRadius: 8,
                border: `1px solid ${theme.colors.border}`, background: '#fff',
                color: theme.colors.textSecondary, fontFamily: 'inherit',
                fontSize: 11, fontWeight: 600, letterSpacing: '0.3px',
                cursor: postingComment ? 'not-allowed' : 'pointer',
              }}
            >Cancel</button>
            <button
              onClick={() => { void handlePostComment(); }}
              disabled={postingComment || !comment.trim()}
              style={{
                padding: '6px 14px', borderRadius: 8,
                background: theme.colors.orange, color: '#fff',
                border: 'none', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.3px',
                cursor: (postingComment || !comment.trim()) ? 'not-allowed' : 'pointer',
                opacity: (postingComment || !comment.trim()) ? 0.6 : 1,
              }}
            >{postingComment ? 'Posting…' : 'Post comment'}</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCommentBox(true)}
          style={{
            background: 'none', border: 'none', padding: 0,
            color: '#92400E', fontFamily: 'inherit',
            fontSize: 11, fontWeight: 600,
            textDecoration: 'underline', textAlign: 'left',
            cursor: 'pointer', alignSelf: 'flex-start',
          }}
        >
          + Add comment
        </button>
      )}
    </div>
  );
}

function AcceptedBadge({ authorName, createdAt }: { authorName: string; createdAt: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '8px 14px', borderRadius: 10,
      background: '#DCFCE7', color: '#166534',
      border: `1px solid #86EFAC`,
      fontSize: 12, fontWeight: 600,
      alignSelf: 'flex-start',
    }}>
      <Check size={14} />
      <span>Accepted by {authorName} on {formatAcceptanceDate(createdAt)}</span>
    </div>
  );
}
