/**
 * EntityNotesInline — pluggable Details-tab preview of the entity_notes thread.
 *
 * Drop into any entity detail panel's Details body so clients (and staff)
 * can see the most recent threaded notes without switching to the Notes
 * tab. Same pattern as ClientAcceptAsIsAction — host panel includes one
 * line, the component handles its own data, formatting, and empty state.
 *
 *   <EntityNotesInline
 *     entityType="task"
 *     entityId={task.taskId}
 *     itemId={task.itemId ? String(task.itemId) : null}
 *     tenantId={tenantId}
 *     onViewAllClick={() => setActiveTab('notes')}  // optional
 *   />
 *
 * Why a separate component vs. embedding NotesSection?
 * - NotesSection mounts the composer and full thread; this is purely a
 *   read-only preview (the composer already lives in the Notes tab).
 * - The Details tab is dense — we want a compact "Recent Notes" card with
 *   capped height, not a 500-row scroll.
 * - The Notes tab uses the rollup view across all related entity_types.
 *   This preview shows ONLY notes attached to the host entity, since
 *   that's what users expect when they look at "this task's notes".
 */
import { useMemo } from 'react';
import { MessageSquare, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import { v2 } from '../../styles/theme.v2';
import { useEntityNotes } from '../../hooks/useEntityNotes';

interface Props {
  entityType: string;
  entityId: string;
  itemId?: string | null;
  tenantId?: string | null;
  /** How many notes to show inline. Older notes collapse behind the
   *  "View all (N) →" link. Defaults to 3. */
  limit?: number;
  /** Optional click handler for the "View all in Notes" CTA. Host panels
   *  that own tab state should switch to the Notes tab here. If omitted,
   *  the CTA still renders but does nothing on click — the user can
   *  click the Notes tab themselves. */
  onViewAllClick?: () => void;
  /** Override the section title. Defaults to "Recent Notes". */
  title?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    + ' · '
    + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function EntityNotesInline({
  entityType, entityId, itemId, tenantId, limit = 3, onViewAllClick, title,
}: Props) {
  const { notes, loading } = useEntityNotes(entityType, entityId, itemId, tenantId);

  // Filter out internal/staff-only notes from the client-facing preview is
  // unnecessary here — RLS already gates that at read time. Just trim to
  // the requested limit. The hook returns newest-first.
  const visible = useMemo(() => notes.slice(0, limit), [notes, limit]);
  const overflow = Math.max(0, notes.length - limit);

  // Empty state: render nothing so the Details tab stays clean. The host
  // panel can include this component unconditionally without worrying
  // about layout drift on a fresh entity.
  if (loading) return null;
  if (notes.length === 0) return null;

  return (
    <div style={{
      marginBottom: 16,
      borderRadius: v2.radius.input,
      border: `1px solid ${theme.colors.border}`,
      background: '#FFFFFF',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: `1px solid ${theme.colors.borderLight}`,
        background: theme.colors.bgSubtle,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageSquare size={14} color={theme.colors.orange} />
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>
            {title ?? 'Recent Notes'}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 600,
            padding: '2px 7px', borderRadius: 999,
            background: theme.colors.orange, color: '#FFFFFF',
          }}>{notes.length}</span>
        </div>
        {/* Overflow hint. Tab-switching from here would require lifting
            TabbedDetailPanel's activeId state up; for now the CTA renders
            as a clickable link only when the host wires onViewAllClick,
            otherwise it's a static "+N more" pointer toward the Notes
            tab the user clicks themselves. */}
        {overflow > 0 && (
          onViewAllClick ? (
            <button
              onClick={onViewAllClick}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 2,
                background: 'none', border: 'none', padding: 0,
                fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                color: theme.colors.orange, cursor: 'pointer',
              }}
            >
              View all {notes.length}<ChevronRight size={12} />
            </button>
          ) : (
            <span style={{
              fontSize: 11, fontWeight: 500,
              color: theme.colors.textMuted,
            }}>+{overflow} in Notes tab</span>
          )
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visible.map((note, idx) => (
          <div
            key={note.id}
            style={{
              padding: '10px 14px',
              borderTop: idx === 0 ? 'none' : `1px solid ${theme.colors.borderLight}`,
              background: note.isSystem ? theme.colors.bgSubtle : '#FFFFFF',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: theme.colors.textMuted, marginBottom: 3,
            }}>
              <span style={{ fontWeight: 600, color: theme.colors.text }}>
                {note.authorName || 'Unknown'}
              </span>
              {note.authorRole && (
                <span style={{
                  textTransform: 'uppercase',
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                  color: note.authorRole === 'client' ? '#1D4ED8' : theme.colors.textMuted,
                  padding: '1px 5px', borderRadius: 4,
                  background: note.authorRole === 'client' ? '#DBEAFE' : theme.colors.bgSubtle,
                }}>{note.authorRole}</span>
              )}
              <span>·</span>
              <span>{formatTime(note.createdAt)}</span>
              {note.visibility === 'internal' && (
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                  color: '#92400E',
                  padding: '1px 5px', borderRadius: 4,
                  background: '#FEF3C7',
                }}>INTERNAL</span>
              )}
            </div>
            <div style={{
              fontSize: 13, color: theme.colors.text,
              whiteSpace: 'pre-wrap', lineHeight: 1.45,
              fontStyle: note.isSystem ? 'italic' : 'normal',
              opacity: note.isSystem ? 0.85 : 1,
            }}>{note.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
