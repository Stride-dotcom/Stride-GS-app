/**
 * PhotoLightbox — fullscreen photo viewer with left/right navigation, swipe
 * support, metadata panel, and per-photo action buttons (primary, attention,
 * repair, download, delete). Rendered via a portal so it stacks above any
 * side panel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronLeft, ChevronRight, AlertTriangle, Wrench, Download, Trash2, Loader2,
} from 'lucide-react';
import type { Photo } from '../../hooks/usePhotos';
import { useIsMobile } from '../../hooks/useIsMobile';

interface Props {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
  // Session 74: onSetPrimary removed — "Make Primary" gone.
  onToggleAttention?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onToggleRepair?: (photo: Photo, next: boolean) => Promise<boolean> | boolean;
  onDelete?: (photo: Photo) => Promise<boolean> | boolean;
  /** Read-only mode hides the action buttons. */
  readOnly?: boolean;
}

// Session 74: PRIMARY_RING removed — no "Make Primary" action in the lightbox.
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
  onToggleAttention, onToggleRepair, onDelete,
  readOnly,
}: Props) {
  const [index, setIndex] = useState(Math.max(0, Math.min(startIndex, photos.length - 1)));
  const [busy, setBusy] = useState<string | null>(null);
  // Optimistic flag overrides so the UI updates instantly on tap — before
  // the Supabase refetch (1-3 s) propagates new props from the parent.
  const [localFlags, setLocalFlags] = useState<Record<string, { needs_attention?: boolean; is_repair?: boolean }>>({});
  const touchStartX = useRef<number | null>(null);
  const { isTablet } = useIsMobile();

  const photo = photos[index] || null;
  // Effective flag values: local override takes precedence while the async
  // refetch is in flight; once parent props arrive they'll match.
  const effectiveNeedsAttention = photo ? (localFlags[photo.id]?.needs_attention ?? photo.needs_attention) : false;
  const effectiveIsRepair = photo ? (localFlags[photo.id]?.is_repair ?? photo.is_repair) : false;

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

  const handleDownload = async () => {
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
          style={{
            maxWidth: '96vw', maxHeight: 'calc(100vh - 200px)', objectFit: 'contain', borderRadius: 8,
            boxShadow: effectiveNeedsAttention
              ? `0 0 0 5px ${ATTENTION_RING}, 0 0 0 9px rgba(220,38,38,0.25)`
              : effectiveIsRepair
              ? `0 0 0 5px ${REPAIR_RING}, 0 0 0 9px rgba(124,58,237,0.25)`
              : undefined,
            transition: 'box-shadow 0.2s ease',
          }}
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
            {/* Primary action removed in session 74. */}
            {onToggleAttention && (
              <ActionBtn
                icon={<AlertTriangle size={isTablet ? 15 : 13} />}
                label={effectiveNeedsAttention ? 'Clear Flag' : 'Flag Attention'}
                color={ATTENTION_RING}
                active={effectiveNeedsAttention}
                busy={busy === 'attention'}
                tablet={isTablet}
                onClick={() => {
                  const next = !effectiveNeedsAttention;
                  setLocalFlags(prev => ({ ...prev, [photo.id]: { ...prev[photo.id], needs_attention: next } }));
                  void runAction('attention', async () => {
                    const ok = await onToggleAttention(photo, next);
                    if (!ok) setLocalFlags(prev => ({ ...prev, [photo.id]: { ...prev[photo.id], needs_attention: !next } }));
                    return ok ?? false;
                  });
                }}
              />
            )}
            {onToggleRepair && (
              <ActionBtn
                icon={<Wrench size={isTablet ? 15 : 13} />}
                label={effectiveIsRepair ? 'Clear Repair' : 'Mark Repair'}
                color={REPAIR_RING}
                active={effectiveIsRepair}
                busy={busy === 'repair'}
                tablet={isTablet}
                onClick={() => {
                  const next = !effectiveIsRepair;
                  setLocalFlags(prev => ({ ...prev, [photo.id]: { ...prev[photo.id], is_repair: next } }));
                  void runAction('repair', async () => {
                    const ok = await onToggleRepair(photo, next);
                    if (!ok) setLocalFlags(prev => ({ ...prev, [photo.id]: { ...prev[photo.id], is_repair: !next } }));
                    return ok ?? false;
                  });
                }}
              />
            )}
            <ActionBtn
              icon={<Download size={isTablet ? 15 : 13} />}
              label="Download"
              color="#4A8A5C"
              tablet={isTablet}
              onClick={handleDownload}
            />
            {onDelete && (
              <ActionBtn
                icon={<Trash2 size={isTablet ? 15 : 13} />}
                label="Delete"
                color={ATTENTION_RING}
                busy={busy === 'delete'}
                tablet={isTablet}
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
  icon, label, color, active, busy, onClick, tablet,
}: { icon: React.ReactNode; label: string; color: string; active?: boolean; busy?: boolean; onClick: () => void; tablet?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: tablet ? 7 : 5,
        padding: tablet ? '9px 14px' : '6px 10px', fontSize: tablet ? 13 : 11, fontWeight: 600,
        background: active ? color : 'rgba(255,255,255,0.08)',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.18)'}`,
        color: '#fff', borderRadius: 100, cursor: busy ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {busy ? <Loader2 size={tablet ? 15 : 13} style={{ animation: 'spin 1s linear infinite' }} /> : icon}
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

