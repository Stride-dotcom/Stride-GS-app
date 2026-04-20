/**
 * PhotoLightbox — fullscreen photo viewer with left/right navigation, swipe
 * support, metadata panel, and per-photo action buttons (primary, attention,
 * repair, download, delete). Rendered via a portal so it stacks above any
 * side panel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronLeft, ChevronRight, Star, AlertTriangle, Wrench, Download, Trash2, Loader2,
} from 'lucide-react';
import type { Photo } from '../../hooks/usePhotos';

interface Props {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
  onSetPrimary?: (photo: Photo) => Promise<boolean> | boolean;
  onToggleAttention?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onToggleRepair?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onDelete?: (photo: Photo) => Promise<boolean> | boolean;
  /** Read-only mode hides the action buttons. */
  readOnly?: boolean;
}

const PRIMARY_RING = '#D97706';
const ATTENTION_RING = '#DC2626';
const REPAIR_RING = '#7C3AED';

function fmtBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso; }
}

export function PhotoLightbox({
  photos, startIndex, onClose,
  onSetPrimary, onToggleAttention, onToggleRepair, onDelete,
  readOnly,
}: Props) {
  const [index, setIndex] = useState(Math.max(0, Math.min(startIndex, photos.length - 1)));
  const [busy, setBusy] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  const photo = photos[index] || null;

  const goPrev = useCallback(() => setIndex(i => (i > 0 ? i - 1 : i)), []);
  const goNext = useCallback(() => setIndex(i => (i < photos.length - 1 ? i + 1 : i)), [photos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext]);

  if (!photo) return null;

  const handleDownload = () => {
    const url = photo.storage_url;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = photo.file_name || 'photo.jpg';
    document.body.appendChild(a); a.click(); a.remove();
  };

  const runAction = async (label: string, fn: () => Promise<boolean> | boolean) => {
    setBusy(label);
    try { await fn(); } finally { setBusy(null); }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const dx = endX - touchStartX.current;
    if (Math.abs(dx) > 50) { if (dx > 0) goPrev(); else goNext(); }
    touchStartX.current = null;
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.92)',
        zIndex: 2500, display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', color: '#fff' }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {index + 1} / {photos.length} · {photo.file_name || 'Photo'}
        </div>
        <button onClick={onClose} style={iconBtnDark} aria-label="Close"><X size={18} /></button>
      </div>

      {/* Image area */}
      <div
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', minHeight: 0,
        }}
      >
        {index > 0 && (
          <button onClick={goPrev} style={{ ...navBtn, left: 12 }} aria-label="Previous">
            <ChevronLeft size={22} />
          </button>
        )}
        <img
          src={photo.storage_url || ''}
          alt={photo.file_name || 'Photo'}
          style={{ maxWidth: '96vw', maxHeight: 'calc(100vh - 200px)', objectFit: 'contain', borderRadius: 8 }}
        />
        {index < photos.length - 1 && (
          <button onClick={goNext} style={{ ...navBtn, right: 12 }} aria-label="Next">
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      {/* Metadata + actions */}
      <div onClick={e => e.stopPropagation()} style={{
        background: 'rgba(28,28,28,0.92)', color: '#fff',
        padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'center',
        flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'rgba(255,255,255,0.7)', flexWrap: 'wrap' }}>
          <Meta label="Type" value={photo.photo_type} />
          <Meta label="Size" value={fmtBytes(photo.file_size)} />
          <Meta label="Uploaded" value={fmtWhen(photo.created_at)} />
          {photo.uploaded_by_name && <Meta label="By" value={photo.uploaded_by_name} />}
        </div>

        {!readOnly && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {onSetPrimary && !photo.is_primary && (
              <ActionBtn
                icon={<Star size={13} />}
                label="Make Primary"
                color={PRIMARY_RING}
                busy={busy === 'primary'}
                onClick={() => runAction('primary', () => onSetPrimary(photo))}
              />
            )}
            {onToggleAttention && (
              <ActionBtn
                icon={<AlertTriangle size={13} />}
                label={photo.needs_attention ? 'Clear Flag' : 'Flag Attention'}
                color={ATTENTION_RING}
                active={photo.needs_attention}
                busy={busy === 'attention'}
                onClick={() => runAction('attention', () => onToggleAttention(photo, !photo.needs_attention))}
              />
            )}
            {onToggleRepair && (
              <ActionBtn
                icon={<Wrench size={13} />}
                label={photo.is_repair ? 'Clear Repair' : 'Mark Repair'}
                color={REPAIR_RING}
                active={photo.is_repair}
                busy={busy === 'repair'}
                onClick={() => runAction('repair', () => onToggleRepair(photo, !photo.is_repair))}
              />
            )}
            <ActionBtn
              icon={<Download size={13} />}
              label="Download"
              color="#4A8A5C"
              onClick={handleDownload}
            />
            {onDelete && (
              <ActionBtn
                icon={<Trash2 size={13} />}
                label="Delete"
                color={ATTENTION_RING}
                busy={busy === 'delete'}
                onClick={async () => {
                  if (!window.confirm('Delete this photo?')) return;
                  await runAction('delete', async () => {
                    const ok = await onDelete(photo);
                    if (ok && photos.length === 1) onClose();
                    else if (ok) setIndex(i => Math.max(0, Math.min(i, photos.length - 2)));
                    return ok;
                  });
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span><span style={{ opacity: 0.55, textTransform: 'uppercase', letterSpacing: '1px', fontSize: 9, marginRight: 5 }}>{label}</span>{value}</span>
  );
}

function ActionBtn({
  icon, label, color, active, busy, onClick,
}: { icon: React.ReactNode; label: string; color: string; active?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '6px 10px', fontSize: 11, fontWeight: 600,
        background: active ? color : 'rgba(255,255,255,0.08)',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.18)'}`,
        color: '#fff', borderRadius: 100, cursor: busy ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {busy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
      {label}
    </button>
  );
}

const iconBtnDark: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8, width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
};

const navBtn: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.15)',
  color: '#fff', borderRadius: '50%', cursor: 'pointer',
};

