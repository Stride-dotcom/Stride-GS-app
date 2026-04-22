/**
 * PhotoGrid — responsive thumbnail grid. 4 columns on desktop, 2 on mobile.
 * Primary photo: amber outline. Needs-attention: red outline. Repair: purple.
 *
 * Click the thumbnail → opens the lightbox (via onPhotoClick).
 *
 * Action affordance depends on device:
 *   - Desktop: semi-transparent dark overlay appears on hover with four
 *     direct-action icons (Star, AlertTriangle, Wrench, Trash). One click,
 *     no menu. Delete is 2-step via a confirm dialog.
 *   - Mobile: a 3-dot corner button is always visible; tapping it opens a
 *     bottom action sheet with the same actions as full-width rows.
 *
 * The split keeps mouse users fast (single click) while respecting the lack
 * of hover on touch.
 */
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Wrench, MoreVertical, X, Loader2, Download, Trash2,
} from 'lucide-react';
import { theme } from '../../styles/theme';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { Photo } from '../../hooks/usePhotos';

interface Props {
  photos: Photo[];
  onPhotoClick?: (photo: Photo, index: number) => void;
  /** Render compact tiles (smaller padding + radius) when embedded in a side panel. */
  compact?: boolean;
  /** Quick-action callbacks. When provided, a 3-dot menu appears on each tile.
   *  Each returns a boolean indicating success (so the sheet can close cleanly).
   *  Session 74: `onSetPrimary` removed — "Make Primary" feature gone. */
  onToggleAttention?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onToggleRepair?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onDelete?: (photo: Photo) => Promise<boolean> | boolean;
}

// Session 74: PRIMARY_RING removed — "Make Primary" feature is gone.
// is_primary stays on the DB table but is never surfaced in the UI.
const ATTENTION_RING = '#DC2626';     // red
const REPAIR_RING = '#7C3AED';        // purple

function ringColor(p: Photo): string | null {
  if (p.needs_attention) return ATTENTION_RING;
  if (p.is_repair) return REPAIR_RING;
  return null;
}

export function PhotoGrid({
  photos, onPhotoClick, compact,
  onToggleAttention, onToggleRepair, onDelete,
}: Props) {
  const { isMobile, isTablet } = useIsMobile();
  const cols = isMobile ? 2 : compact ? 3 : 4;
  const radius = compact ? 8 : 12;

  const [actionPhoto, setActionPhoto] = useState<Photo | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null); // `${photoId}:${kind}`
  const hasActions = !!(onToggleAttention || onToggleRepair || onDelete);

  // Inline handler used by desktop hover-overlay icons. Runs optimistically
  // (Realtime refetch will confirm) and keeps the overlay responsive by
  // flipping a per-photo "pending" flag.
  const runInline = useCallback(async (photoId: string, kind: string, fn: () => Promise<boolean> | boolean) => {
    setPendingAction(`${photoId}:${kind}`);
    try { await fn(); } finally { setPendingAction(null); }
  }, []);

  if (photos.length === 0) {
    return (
      <div style={{
        padding: '32px 16px', textAlign: 'center',
        background: theme.v2.colors.bgCard, borderRadius: radius,
        color: theme.v2.colors.textMuted, fontSize: 13,
      }}>
        No photos yet.
      </div>
    );
  }

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: compact ? 6 : 10,
      }}>
        {photos.map((p, i) => {
          const ring = ringColor(p);
          const src = p.thumbnail_url || p.storage_url || '';
          const isHovered = hoverId === p.id;
          const showDesktopOverlay = hasActions && !isMobile && isHovered;
          return (
            <div
              key={p.id}
              onClick={onPhotoClick ? () => onPhotoClick(p, i) : undefined}
              onMouseEnter={e => {
                setHoverId(p.id);
                if (onPhotoClick) e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={e => {
                setHoverId(prev => (prev === p.id ? null : prev));
                if (onPhotoClick) e.currentTarget.style.transform = 'translateY(0)';
              }}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                borderRadius: radius,
                overflow: 'hidden',
                cursor: onPhotoClick ? 'pointer' : 'default',
                background: '#E5E7EB',
                boxShadow: ring ? `0 0 0 5px ${ring}, 0 2px 8px rgba(0,0,0,0.12)` : '0 2px 8px rgba(0,0,0,0.06)',
                transition: 'transform 0.12s ease, box-shadow 0.12s ease',
              }}
            >
              {src ? (
                <img
                  src={src}
                  alt={p.file_name || 'Photo'}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.v2.colors.textMuted, fontSize: 11 }}>
                  No preview
                </div>
              )}

              {/* Indicator chips — primary chip removed in session 74 */}
              <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4, pointerEvents: 'none', zIndex: 2 }}>
                {p.needs_attention && (
                  <span style={chipStyle(ATTENTION_RING)} title="Needs attention"><AlertTriangle size={10} /> FLAG</span>
                )}
                {p.is_repair && (
                  <span style={chipStyle(REPAIR_RING)} title="Repair photo"><Wrench size={10} /> REPAIR</span>
                )}
              </div>

              {/* Mobile/tablet: always-visible 3-dot → bottom sheet.
                  Hidden on desktop where the hover overlay provides direct actions.
                  Tablet uses the same sheet (no hover on touch) but with a larger tap target. */}
              {hasActions && (isMobile || isTablet) && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setActionPhoto(p); }}
                  aria-label="Photo actions"
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    width: isTablet ? 38 : 28, height: isTablet ? 38 : 28, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                    border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(4px)',
                    WebkitBackdropFilter: 'blur(4px)',
                    zIndex: 3,
                  }}
                >
                  <MoreVertical size={isTablet ? 20 : 14} />
                </button>
              )}

              {/* Desktop: semi-transparent hover overlay with direct-action icons.
                  v38.93.0 — overlay background click now bubbles up to the
                  container's onClick so clicking the photo (outside the
                  action buttons) opens the lightbox. Previously the overlay
                  swallowed every click with `stopPropagation` on the whole
                  div, so desktop users couldn't open the fullscreen view.
                  The button-row keeps its own stopPropagation so button
                  presses don't ALSO open the lightbox. */}
              {hasActions && !isMobile && !isTablet && (
                <div
                  style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.55) 100%)',
                    opacity: showDesktopOverlay ? 1 : 0,
                    transition: 'opacity 0.15s ease',
                    pointerEvents: showDesktopOverlay ? 'auto' : 'none',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    padding: compact ? 6 : 10,
                    zIndex: 1,
                    cursor: onPhotoClick ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    {onToggleAttention && (
                      <OverlayIconButton
                        label={p.needs_attention ? 'Clear flag' : 'Flag attention'}
                        icon={<AlertTriangle size={15} />}
                        active={p.needs_attention}
                        activeColor={ATTENTION_RING}
                        busy={pendingAction === `${p.id}:attention`}
                        onClick={() => void runInline(p.id, 'attention', () => onToggleAttention(p, !p.needs_attention))}
                      />
                    )}
                    {onToggleRepair && (
                      <OverlayIconButton
                        label={p.is_repair ? 'Unmark repair' : 'Mark repair'}
                        icon={<Wrench size={15} />}
                        active={p.is_repair}
                        activeColor={REPAIR_RING}
                        busy={pendingAction === `${p.id}:repair`}
                        onClick={() => void runInline(p.id, 'repair', () => onToggleRepair(p, !p.is_repair))}
                      />
                    )}
                    {/* v38.93.0 — desktop Download button (mirrors PhotoActionSheet
                        behavior on mobile). Opens the photo in a new tab for
                        clients who can't right-click save due to CORS on
                        signed URLs, and downloads the file for staff who can. */}
                    <OverlayIconButton
                      label="Download"
                      icon={<Download size={15} />}
                      activeColor="#4A8A5C"
                      onClick={() => {
                        const url = p.storage_url;
                        if (!url) return;
                        fetch(url)
                          .then(r => r.blob())
                          .then(blob => {
                            const objectUrl = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = objectUrl;
                            a.download = p.file_name || 'photo.jpg';
                            document.body.appendChild(a); a.click(); a.remove();
                            URL.revokeObjectURL(objectUrl);
                          })
                          .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
                      }}
                    />
                    {onDelete && (
                      <OverlayIconButton
                        label="Delete"
                        icon={<Trash2 size={15} />}
                        danger
                        busy={pendingAction === `${p.id}:delete`}
                        onClick={() => {
                          if (!window.confirm('Delete this photo?')) return;
                          void runInline(p.id, 'delete', () => onDelete(p));
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {actionPhoto && (
        <PhotoActionSheet
          photo={actionPhoto}
          isMobile={isMobile}
          onClose={() => setActionPhoto(null)}
          onToggleAttention={onToggleAttention}
          onToggleRepair={onToggleRepair}
          onDelete={onDelete}
        />
      )}
    </>
  );
}

function chipStyle(bg: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    background: bg, color: '#fff',
    fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
    padding: '2px 6px', borderRadius: 4,
    textShadow: '0 1px 1px rgba(0,0,0,0.25)',
  };
}

// ─── Quick-action sheet ─────────────────────────────────────────────────────
// On mobile: bottom-anchored sheet. On desktop: centered compact menu.
// Same actions either way so the business logic stays in one place.

interface SheetProps {
  photo: Photo;
  isMobile: boolean;
  onClose: () => void;
  // Session 74: onSetPrimary removed.
  onToggleAttention?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onToggleRepair?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onDelete?: (photo: Photo) => Promise<boolean> | boolean;
}

function PhotoActionSheet({
  photo, isMobile, onClose,
  onToggleAttention, onToggleRepair, onDelete,
}: SheetProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const runAction = useCallback(async (label: string, fn: () => Promise<boolean> | boolean) => {
    setBusy(label);
    try {
      const ok = await fn();
      if (ok) onClose();
    } finally {
      setBusy(null);
    }
  }, [onClose]);

  const handleDownload = useCallback(async () => {
    const url = photo.storage_url;
    if (!url) return;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = photo.file_name || 'photo.jpg';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    onClose();
  }, [photo, onClose]);

  const sheetWrap: React.CSSProperties = isMobile ? {
    position: 'fixed',
    left: 0, right: 0, bottom: 0,
    background: '#fff',
    borderRadius: '18px 18px 0 0',
    padding: '12px 14px calc(14px + env(safe-area-inset-bottom, 0px))',
    boxShadow: '0 -8px 32px rgba(0,0,0,0.2)',
    animation: 'slideIn 0.18s ease-out',
  } : {
    position: 'fixed',
    left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    background: '#fff',
    borderRadius: 14,
    padding: 10,
    minWidth: 260,
    boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: isMobile ? 'rgba(15,23,42,0.45)' : 'rgba(15,23,42,0.35)',
        zIndex: 2600,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={sheetWrap}>
        {/* Mobile drag-affordance */}
        {isMobile && (
          <div style={{
            width: 36, height: 4, borderRadius: 2,
            background: theme.v2.colors.border,
            margin: '0 auto 10px',
          }} />
        )}
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: theme.v2.colors.textMuted,
            textTransform: 'uppercase', letterSpacing: '1.5px',
          }}>Photo</div>
          {!isMobile && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.v2.colors.textMuted, padding: 4, display: 'flex' }}
            ><X size={16} /></button>
          )}
        </div>

        {/* Actions — primary action row removed in session 74 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {onToggleAttention && (
            <ActionRow
              icon={<AlertTriangle size={15} />}
              label={photo.needs_attention ? 'Clear Attention Flag' : 'Flag Attention'}
              color={ATTENTION_RING}
              active={photo.needs_attention}
              busy={busy === 'attention'}
              onClick={() => runAction('attention', () => onToggleAttention(photo, !photo.needs_attention))}
            />
          )}
          {onToggleRepair && (
            <ActionRow
              icon={<Wrench size={15} />}
              label={photo.is_repair ? 'Unmark Repair' : 'Mark Repair'}
              color={REPAIR_RING}
              active={photo.is_repair}
              busy={busy === 'repair'}
              onClick={() => runAction('repair', () => onToggleRepair(photo, !photo.is_repair))}
            />
          )}
          <ActionRow
            icon={<Download size={15} />}
            label="Download"
            color="#4A8A5C"
            onClick={handleDownload}
          />
          {onDelete && (
            <ActionRow
              icon={<Trash2 size={15} />}
              label="Delete"
              color={ATTENTION_RING}
              danger
              busy={busy === 'delete'}
              onClick={async () => {
                if (!window.confirm('Delete this photo?')) return;
                await runAction('delete', () => onDelete(photo));
              }}
            />
          )}
        </div>

        {isMobile && (
          <button
            onClick={onClose}
            style={{
              width: '100%', marginTop: 10, padding: '12px',
              border: `1px solid ${theme.v2.colors.border}`, borderRadius: 12,
              background: '#fff', color: theme.v2.colors.textSecondary,
              fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Cancel</button>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface ActionRowProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

// ─── Desktop hover-overlay icon button ─────────────────────────────────────

interface OverlayIconButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  /** When true, apply the active/state color (e.g., already flagged/repair). */
  active?: boolean;
  /** Color to use when `active` — defaults to white. */
  activeColor?: string;
  /** When true, render in the attention-red tone. Used for Delete. */
  danger?: boolean;
}

function OverlayIconButton({ icon, label, onClick, busy, active, activeColor, danger }: OverlayIconButtonProps) {
  const tint = danger ? ATTENTION_RING : active ? (activeColor ?? '#fff') : '#fff';
  const bg = active ? `${activeColor ?? '#fff'}33` : 'rgba(255,255,255,0.15)';
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      style={{
        width: 32, height: 32, borderRadius: 8,
        background: bg,
        color: tint,
        border: `1px solid rgba(255,255,255,0.25)`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: busy ? 'default' : 'pointer',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        transition: 'background 0.12s ease, color 0.12s ease, transform 0.12s ease',
      }}
      onMouseEnter={e => {
        if (!busy) {
          e.currentTarget.style.background = danger
            ? 'rgba(220,38,38,0.85)'
            : (active ? `${activeColor ?? '#fff'}55` : 'rgba(255,255,255,0.28)');
          e.currentTarget.style.color = danger || active ? '#fff' : '#fff';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = bg;
        e.currentTarget.style.color = tint;
      }}
    >
      {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
    </button>
  );
}

function ActionRow({ icon, label, color, active, busy, disabled, danger, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px',
        border: 'none', borderRadius: 10,
        background: active ? `${color}14` : 'transparent',
        color: danger ? color : (active ? color : theme.v2.colors.text),
        cursor: (disabled || busy) ? 'default' : 'pointer',
        fontFamily: 'inherit', fontSize: 14, fontWeight: 500,
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
        minHeight: 44, // iOS touch target
      }}
      onMouseEnter={e => { if (!disabled && !busy) e.currentTarget.style.background = `${color}1A`; }}
      onMouseLeave={e => { e.currentTarget.style.background = active ? `${color}14` : 'transparent'; }}
    >
      <span style={{ color, display: 'flex' }}>
        {busy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}
