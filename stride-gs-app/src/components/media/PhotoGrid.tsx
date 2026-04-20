/**
 * PhotoGrid — responsive thumbnail grid. 4 columns on desktop, 2 on mobile.
 * Primary photo: amber outline. Needs-attention: red outline. Repair: purple.
 * Click the thumbnail → opens the lightbox (via onPhotoClick). Click the
 * 3-dot corner button → opens a quick-action bottom-sheet (works on touch
 * and mouse alike; no hover-required controls).
 */
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Wrench, Star, MoreVertical, X, Loader2, Download, Trash2, StarOff,
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
   *  Each returns a boolean indicating success (so the sheet can close cleanly). */
  onSetPrimary?: (photo: Photo) => Promise<boolean> | boolean;
  onToggleAttention?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onToggleRepair?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onDelete?: (photo: Photo) => Promise<boolean> | boolean;
}

const PRIMARY_RING = '#D97706';      // amber
const ATTENTION_RING = '#DC2626';     // red
const REPAIR_RING = '#7C3AED';        // purple

function ringColor(p: Photo): string | null {
  if (p.needs_attention) return ATTENTION_RING;
  if (p.is_repair) return REPAIR_RING;
  if (p.is_primary) return PRIMARY_RING;
  return null;
}

export function PhotoGrid({
  photos, onPhotoClick, compact,
  onSetPrimary, onToggleAttention, onToggleRepair, onDelete,
}: Props) {
  const { isMobile } = useIsMobile();
  const cols = isMobile ? 2 : compact ? 3 : 4;
  const radius = compact ? 8 : 12;

  const [actionPhoto, setActionPhoto] = useState<Photo | null>(null);
  const hasActions = !!(onSetPrimary || onToggleAttention || onToggleRepair || onDelete);

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
          return (
            <div
              key={p.id}
              onClick={onPhotoClick ? () => onPhotoClick(p, i) : undefined}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                borderRadius: radius,
                overflow: 'hidden',
                cursor: onPhotoClick ? 'pointer' : 'default',
                background: '#E5E7EB',
                boxShadow: ring ? `0 0 0 3px ${ring}, 0 2px 8px rgba(0,0,0,0.08)` : '0 2px 8px rgba(0,0,0,0.06)',
                transition: 'transform 0.12s ease, box-shadow 0.12s ease',
              }}
              onMouseEnter={e => { if (onPhotoClick) e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { if (onPhotoClick) e.currentTarget.style.transform = 'translateY(0)'; }}
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
              {/* Indicator chips */}
              <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4, pointerEvents: 'none' }}>
                {p.is_primary && (
                  <span style={chipStyle(PRIMARY_RING)} title="Primary photo"><Star size={10} /> PRIMARY</span>
                )}
                {p.needs_attention && (
                  <span style={chipStyle(ATTENTION_RING)} title="Needs attention"><AlertTriangle size={10} /> FLAG</span>
                )}
                {p.is_repair && (
                  <span style={chipStyle(REPAIR_RING)} title="Repair photo"><Wrench size={10} /> REPAIR</span>
                )}
              </div>
              {/* 3-dot quick-action button — only rendered when caller wires callbacks.
                  Always visible on mobile (touch), fades in on hover on desktop
                  via inline event handlers below. */}
              {hasActions && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setActionPhoto(p); }}
                  aria-label="Photo actions"
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                    border: 'none', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    opacity: isMobile ? 1 : 0.85,
                    backdropFilter: 'blur(4px)',
                    WebkitBackdropFilter: 'blur(4px)',
                    transition: 'opacity 0.12s ease, background 0.12s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(0,0,0,0.75)'; }}
                  onMouseLeave={e => { if (!isMobile) e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.background = 'rgba(0,0,0,0.55)'; }}
                >
                  <MoreVertical size={14} />
                </button>
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
          onSetPrimary={onSetPrimary}
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
  onSetPrimary?: (photo: Photo) => Promise<boolean> | boolean;
  onToggleAttention?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onToggleRepair?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onDelete?: (photo: Photo) => Promise<boolean> | boolean;
}

function PhotoActionSheet({
  photo, isMobile, onClose,
  onSetPrimary, onToggleAttention, onToggleRepair, onDelete,
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

  const handleDownload = useCallback(() => {
    const url = photo.storage_url;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = photo.file_name || 'photo.jpg';
    document.body.appendChild(a); a.click(); a.remove();
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

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {onSetPrimary && !photo.is_primary && (
            <ActionRow
              icon={<Star size={15} />}
              label="Make Primary"
              color={PRIMARY_RING}
              busy={busy === 'primary'}
              onClick={() => runAction('primary', () => onSetPrimary(photo))}
            />
          )}
          {onSetPrimary && photo.is_primary && (
            <ActionRow
              icon={<StarOff size={15} />}
              label="Already Primary"
              color={PRIMARY_RING}
              disabled
            />
          )}
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
