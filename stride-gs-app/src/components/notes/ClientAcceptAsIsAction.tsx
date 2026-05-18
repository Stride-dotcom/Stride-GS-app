/**
 * ClientAcceptAsIsAction — pluggable footer action for any entity detail panel.
 *
 * Renders a green pill button ("Accept As-Is") plus its own modal. Drop into
 * any detail panel's footer:
 *
 *   <ClientAcceptAsIsAction
 *     entityType="task"          // 'task' | 'repair' | 'inventory' | …
 *     entityId={task.taskId}
 *     itemId={task.itemId}
 *     tenantId={tenantId}
 *     eligible={isFailedInspection}
 *   />
 *
 * The component renders nothing unless ALL of:
 *   - `eligible` (caller-supplied — usually a status/type guard)
 *   - `user.role === 'client'`
 *   - no prior acceptance note exists on this entity
 *
 * Click flow:
 *   1. Opens a modal with an optional comment textarea + "Acknowledge" button.
 *   2. On Acknowledge: writes a system acceptance note (is_system=true,
 *      body "✓ Accepted as-is by [name] on [date]"). If the textarea has
 *      text, ALSO writes a normal public note with that text. Both inserts
 *      go through useEntityNotes.addNote so the office-notification
 *      edge function (notify-task-client-note) fires server-side for each.
 *   3. Modal closes, button hides (the existing acceptance is now in the
 *      timeline).
 *
 * Idempotent: detection is body-prefix based ("✓ Accepted as-is"), matching
 * the old InspectionAcceptAsIs marker. Tap the button twice and the second
 * mount reads the existing note and doesn't re-render the button.
 */
import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useEntityNotes } from '../../hooks/useEntityNotes';
import { BtnSpinner } from '../ui/BtnSpinner';
import { fmtDateTime } from '../../lib/constants';

const ACCEPT_PREFIX = '✓ Accepted as-is';

function formatAcceptanceDate(iso: string): string {
  return fmtDateTime(iso);
}

interface Props {
  entityType: string;
  entityId: string;
  itemId?: string | null;
  tenantId?: string | null;
  /** Caller-supplied eligibility — usually a status/type guard like
   *  `task.type === 'INSP' && task.result === 'Fail'`. Component still
   *  hides itself for non-client users regardless. */
  eligible: boolean;
  /** Override the button style if the host footer needs a different size /
   *  shape. Defaults to a green pill that matches Task/Repair footer pills. */
  pillStyle?: React.CSSProperties;
  /** Override label text. Defaults to "Accept As-Is". */
  label?: string;
}

export function ClientAcceptAsIsAction({
  entityType, entityId, itemId, tenantId, eligible, pillStyle, label,
}: Props) {
  const { user } = useAuth();
  const { notes, addNote } = useEntityNotes(entityType, entityId, itemId, tenantId);

  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyAccepted = useMemo(
    () => notes.some(n => n.body.startsWith(ACCEPT_PREFIX)),
    [notes],
  );

  // Bail out before any UI when the action shouldn't render. Hooks above
  // run unconditionally so we don't violate rules-of-hooks.
  if (!eligible) return null;
  if (user?.role !== 'client') return null;
  if (alreadyAccepted) return null;

  const defaultPill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 6, flex: '0 0 auto',
    minWidth: 110,
    padding: '10px 18px',
    borderRadius: 10, border: 'none',
    background: '#15803D', color: '#fff',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    letterSpacing: '0.3px', cursor: 'pointer', whiteSpace: 'nowrap',
  };

  const handleAcknowledge = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const name = user?.displayName || user?.email || 'Client';
      const when = formatAcceptanceDate(new Date().toISOString());
      const body = `${ACCEPT_PREFIX} by ${name} on ${when}`;
      const acceptanceResult = await addNote(body, 'public', [], { isSystem: true });
      if (!acceptanceResult) {
        setError('Could not save acceptance. Please try again.');
        return;
      }
      const trimmed = comment.trim();
      if (trimmed) {
        // Best-effort comment — if it fails, the acceptance is already
        // saved so we close the modal anyway and surface the warning.
        const commentResult = await addNote(trimmed, 'public', []);
        if (!commentResult) {
          setError('Acceptance saved, but the comment failed to post. Try again from the Notes tab.');
          return;
        }
      }
      setOpen(false);
      setComment('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ ...defaultPill, ...pillStyle }}
      >
        <Check size={14} />
        {label ?? 'Accept As-Is'}
      </button>
      {open && (
        <Modal
          comment={comment}
          onCommentChange={setComment}
          onClose={() => { if (!submitting) { setOpen(false); setError(null); } }}
          onAcknowledge={handleAcknowledge}
          submitting={submitting}
          error={error}
        />
      )}
    </>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

interface ModalProps {
  comment: string;
  onCommentChange: (next: string) => void;
  onClose: () => void;
  onAcknowledge: () => void;
  submitting: boolean;
  error: string | null;
}

function Modal({ comment, onCommentChange, onClose, onAcknowledge, submitting, error }: ModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#FFFFFF',
          borderRadius: 14,
          width: '100%', maxWidth: 460,
          fontFamily: theme.typography.fontFamily,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${theme.colors.borderLight}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.colors.text }}>
            Accept As-Is
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'none', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer',
              color: theme.colors.textMuted, padding: 4, display: 'flex',
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '16px 18px' }}>
          <p style={{ margin: 0, fontSize: 13, color: theme.colors.text, lineHeight: 1.5 }}>
            By clicking <strong>Acknowledge</strong>, you accept this item as-is.
            Adding a comment is optional — it's posted to the task notes alongside
            your acknowledgement.
          </p>

          <label style={{
            display: 'block', marginTop: 16, marginBottom: 6,
            fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
            color: theme.colors.textMuted, textTransform: 'uppercase',
          }}>
            Comment (optional)
          </label>
          <textarea
            value={comment}
            onChange={e => onCommentChange(e.target.value)}
            placeholder="Add a note for the warehouse team…"
            rows={3}
            disabled={submitting}
            style={{
              width: '100%', padding: '10px 12px', fontSize: 13,
              fontFamily: 'inherit', color: theme.colors.text,
              border: `1px solid ${theme.colors.border}`, borderRadius: 8,
              outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              background: submitting ? theme.colors.bgSubtle : '#FFFFFF',
            }}
          />

          {error && (
            <div style={{
              marginTop: 10, padding: '8px 10px',
              fontSize: 12, color: '#B91C1C',
              background: '#FEF2F2', border: `1px solid #FECACA`,
              borderRadius: 8,
            }}>{error}</div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 18px',
          background: theme.colors.bgSubtle,
          borderTop: `1px solid ${theme.colors.borderLight}`,
        }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '9px 16px', borderRadius: 10,
              border: `1px solid ${theme.colors.border}`, background: '#FFFFFF',
              color: theme.colors.textSecondary, fontFamily: 'inherit',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.3px',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >Cancel</button>
          <button
            onClick={onAcknowledge}
            disabled={submitting}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 18px', borderRadius: 10,
              background: '#15803D', color: '#FFFFFF', border: 'none',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.3px', cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? <BtnSpinner size={12} color="#fff" /> : <Check size={14} />}
            {submitting ? 'Saving…' : 'Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  );
}
