/**
 * NotesSection — chronological thread of notes for any entity.
 *
 * Ported from the Stride WMS app's UnifiedNotesSection. Renders the
 * newest-first (or oldest-first toggleable) list of notes with an
 * explicit "Internal" treatment so nobody accidentally leaks sensitive
 * info in the wrong mode.
 *
 * Visibility model (session 73 follow-up — see migration
 * 20260420020337_entity_notes_drop_staff_only):
 *   • public   — everyone with access sees it (default)
 *   • internal — admin/staff only; RLS enforces, UI warns loudly
 *
 * Props: entityType, entityId. Pass these on any entity detail view
 * (Repair, Will Call, Inventory item, Shipment, …) — the hook does
 * the rest.
 */
import { useMemo, useState } from 'react';
import { Send, Trash2, Info, Lock, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useAuth } from '../../contexts/AuthContext';
import {
  useEntityNotes, type EntityNote, type NoteVisibility,
} from '../../hooks/useEntityNotes';

interface Props {
  entityType: string;
  entityId: string;
  /** v2026-04-22 — parent item_id stamped on inserts so the rollup can find
   *  this note. Forwarded to useEntityNotes; null/undefined for container or
   *  OOS entity types (will_call/shipment/claim). */
  itemId?: string | null;
  /** v2026-04-22 — when true, only the composer renders (header + list are
   *  hidden). Used by NotesRollupView which supplies its own rollup list. */
  composerOnly?: boolean;
  /** Oldest-first is default so the thread reads chronologically; toggle via UI. */
  initialOrder?: 'newest' | 'oldest';
}

// ── Colors for the internal-note treatment ──────────────────────────────────
// Warning red is distinct from the Stride orange used for primary actions,
// which keeps the signal "this is sensitive" unambiguous.
const INTERNAL_RED       = '#B45A5A';
const INTERNAL_RED_DARK  = '#8C3E3E';
const INTERNAL_BG_INPUT  = 'rgba(180,90,90,0.06)';
const INTERNAL_BG_NOTE   = 'rgba(180,90,90,0.08)';
const INTERNAL_BORDER    = 'rgba(180,90,90,0.45)';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  if (same) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function colorForAuthor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 50%)`;
}

export function NotesSection({ entityType, entityId, itemId, composerOnly, initialOrder = 'oldest' }: Props) {
  const v2 = theme.v2;
  const { user } = useAuth();
  const { notes, loading, error, addNote, deleteNote } = useEntityNotes(entityType, entityId, itemId);

  const [draft, setDraft] = useState('');
  const [visibility, setVisibility] = useState<NoteVisibility>('public');
  const [order, setOrder] = useState<'newest' | 'oldest'>(initialOrder);
  const [sending, setSending] = useState(false);

  const isClient = user?.role === 'client';
  const isAdmin = user?.role === 'admin';
  const isInternalMode = visibility === 'internal';

  // Client users can't post internal notes (RLS would block anyway).
  // Server-side RLS already filters internal notes out of client reads;
  // this is a defensive UI filter on top.
  const visibleNotes = useMemo(() => {
    const filtered = isClient ? notes.filter(n => n.visibility === 'public') : notes;
    return order === 'oldest' ? [...filtered].reverse() : filtered;
  }, [notes, isClient, order]);

  const handleSend = async () => {
    if (sending || !draft.trim()) return;
    setSending(true);
    const result = await addNote(draft, visibility);
    setSending(false);
    if (result) {
      setDraft('');
      // Reset to 'public' after an internal note goes out — the safer
      // default for the next message so it can't accidentally be
      // marked internal.
      if (isInternalMode) setVisibility('public');
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ─── Styles ──────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: v2.colors.bgCard,
    borderRadius: v2.radius.card,
    padding: v2.card.padding,
    fontFamily: theme.typography.fontFamily,
  };

  return (
    <div style={composerOnly ? { fontFamily: theme.typography.fontFamily } : card}>
      {/* Header + thread — hidden in composerOnly mode (NotesRollupView owns them) */}
      {!composerOnly && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
            <div>
              <div style={{ ...v2.typography.cardTitle, color: v2.colors.text }}>Notes</div>
              <div style={{ fontSize: 11, color: v2.colors.textMuted, marginTop: 2 }}>
                {loading ? 'Loading…' : `${notes.length} note${notes.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <button
              onClick={() => setOrder(o => o === 'newest' ? 'oldest' : 'newest')}
              style={{
                padding: '6px 12px', borderRadius: v2.radius.badge,
                border: `1px solid ${v2.colors.border}`, background: v2.colors.bgWhite,
                color: v2.colors.textSecondary,
                fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {order === 'oldest' ? 'Oldest first' : 'Newest first'}
            </button>
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', marginBottom: 12, fontSize: 12,
              background: 'rgba(180,90,90,0.10)', color: INTERNAL_RED,
              borderRadius: v2.radius.input,
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {visibleNotes.length === 0 && !loading && (
              <div style={{
                padding: '24px 16px', textAlign: 'center',
                background: v2.colors.bgWhite, border: `1px dashed ${v2.colors.border}`,
                borderRadius: v2.radius.input, color: v2.colors.textMuted, fontSize: 13,
              }}>
                No notes yet. Be the first to add one.
              </div>
            )}
            {visibleNotes.map(n => (
              <NoteItem
                key={n.id}
                note={n}
                canDelete={isAdmin}
                onDelete={() => { void deleteNote(n.id); }}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Compose ───────────────────────────────────────────────────────── */}
      {/* Wrapper switches styling completely when Internal is selected so it's
         impossible to miss which mode you're typing in. */}
      <div style={{
        border: `2px solid ${isInternalMode ? INTERNAL_RED : v2.colors.border}`,
        background: isInternalMode ? INTERNAL_BG_INPUT : v2.colors.bgWhite,
        borderRadius: v2.radius.input,
        padding: 10,
        transition: 'border-color 0.15s, background 0.15s',
      }}>
        {/* Internal-mode warning strip */}
        {isInternalMode && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', marginBottom: 10,
            background: INTERNAL_RED, color: '#fff',
            borderRadius: v2.radius.input,
            fontSize: 12, fontWeight: 600, letterSpacing: '0.5px',
          }}>
            <AlertTriangle size={14} />
            <span style={{ flex: 1 }}>🔒 INTERNAL — only visible to staff and admin. Clients will NOT see this note.</span>
          </div>
        )}

        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder={isInternalMode
            ? 'Write an internal note (staff/admin only)…'
            : 'Add a note… (⌘↵ to send)'}
          rows={3}
          style={{
            width: '100%', border: 'none', outline: 'none', resize: 'vertical',
            fontFamily: 'inherit', fontSize: 13,
            color: v2.colors.text,
            background: 'transparent',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          {!isClient && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} role="radiogroup" aria-label="Visibility">
              <VisibilityPill
                active={!isInternalMode}
                onClick={() => setVisibility('public')}
                label="Public"
                icon={<Info size={11} />}
                activeBg={v2.colors.bgDark}
                activeColor="#fff"
              />
              <VisibilityPill
                active={isInternalMode}
                onClick={() => setVisibility('internal')}
                label="Internal"
                icon={<Lock size={11} />}
                activeBg={INTERNAL_RED}
                activeColor="#fff"
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={handleSend}
            disabled={sending || !draft.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: v2.radius.button,
              background: (sending || !draft.trim())
                ? v2.colors.border
                : (isInternalMode ? INTERNAL_RED : v2.colors.accent),
              color: '#fff', border: 'none',
              fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
              cursor: (sending || !draft.trim()) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Send size={12} />
            {sending ? 'Sending…' : (isInternalMode ? 'Send internal' : 'Send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Visibility pill ────────────────────────────────────────────────────────

function VisibilityPill({
  active, onClick, label, icon, activeBg, activeColor,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  activeBg: string;
  activeColor: string;
}) {
  const v2 = theme.v2;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 10px', borderRadius: v2.radius.badge,
        border: active ? 'none' : `1px solid ${v2.colors.border}`,
        background: active ? activeBg : v2.colors.bgWhite,
        color: active ? activeColor : v2.colors.textSecondary,
        fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Single note row ────────────────────────────────────────────────────────

function NoteItem({ note, canDelete, onDelete }: { note: EntityNote; canDelete: boolean; onDelete: () => void }) {
  const v2 = theme.v2;

  // System-generated status/audit notes render in a de-emphasized row.
  if (note.isSystem) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        fontSize: 11, color: v2.colors.textMuted,
      }}>
        <Info size={11} />
        <span style={{ flex: 1 }}>{note.body}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(note.createdAt)}</span>
      </div>
    );
  }

  const isInternal = note.visibility === 'internal';
  const authorKey = note.authorId || note.authorName || 'anon';

  return (
    <div style={{
      display: 'flex', gap: 10,
      padding: '10px 12px',
      background: isInternal ? INTERNAL_BG_NOTE : v2.colors.bgWhite,
      border: `1px solid ${isInternal ? INTERNAL_BORDER : v2.colors.border}`,
      borderLeft: isInternal ? `4px solid ${INTERNAL_RED_DARK}` : `1px solid ${v2.colors.border}`,
      borderRadius: v2.radius.input,
      position: 'relative',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: colorForAuthor(authorKey),
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, flexShrink: 0,
      }}>{initialsFromName(note.authorName || '?')}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: v2.colors.text }}>
            {note.authorName || 'Unknown'}
          </span>
          {note.authorRole && (
            <span style={{
              fontSize: 9, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
              padding: '2px 6px', borderRadius: v2.radius.badge,
              background: v2.colors.bgCard, color: v2.colors.textSecondary,
            }}>{note.authorRole}</span>
          )}
          {isInternal && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 9, fontWeight: 700, letterSpacing: '0.75px', textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: v2.radius.badge,
              background: INTERNAL_RED, color: '#fff',
            }}>
              <Lock size={9} /> Internal
            </span>
          )}
          <span style={{ fontSize: 11, color: v2.colors.textMuted, marginLeft: 'auto' }}>
            {formatTimestamp(note.createdAt)}
          </span>
          {canDelete && (
            <button
              onClick={onDelete}
              title="Delete note"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                padding: 2, color: v2.colors.textMuted, display: 'flex',
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        <div style={{
          fontSize: 13,
          color: isInternal ? INTERNAL_RED_DARK : v2.colors.text,
          marginTop: 4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontWeight: isInternal ? 500 : 400,
        }}>
          {note.body}
        </div>
      </div>
    </div>
  );
}
