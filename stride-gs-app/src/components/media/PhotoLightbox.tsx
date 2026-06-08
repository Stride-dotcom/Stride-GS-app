/**
 * PhotoLightbox — fullscreen photo viewer with left/right navigation, swipe
 * support, zoom/pan, metadata panel, and per-photo action buttons (attention,
 * repair, download, delete). Rendered via a portal so it stacks above any
 * side panel.
 *
 * Zoom/pan (v2026-05-xx): unified Pointer Events drive all three platforms —
 *   • Desktop: mouse-wheel zooms toward the cursor; +/−/reset buttons; double-
 *     click toggles 1×↔2.5× toward the click; drag pans when zoomed.
 *   • Touch (tablet/phone): two-finger pinch zooms toward the midpoint; one-
 *     finger drag pans when zoomed; double-tap toggles zoom; one-finger swipe
 *     navigates prev/next ONLY at fit-scale (so panning never fights nav).
 * Zoom/pan resets whenever the photo changes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, ChevronLeft, ChevronRight, AlertTriangle, Wrench, Download, Trash2, Loader2,
  ZoomIn, ZoomOut, Maximize2,
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

// Zoom limits + the level a double-click / double-tap jumps to.
const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;
const WHEEL_STEP = 0.0018;   // per wheel delta unit
const BUTTON_STEP = 0.5;     // per +/− button press
const SWIPE_THRESHOLD = 50;  // px — single-finger swipe nav at fit-scale
const DOUBLE_TAP_MS = 300;
const TAP_MOVE_TOLERANCE = 8; // px — movement under this still counts as a tap

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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
  const { isTablet } = useIsMobile();

  // ── Zoom / pan state ──────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Suppress the CSS transition during active drag/pinch so the image tracks
  // the finger/cursor 1:1; re-enable it for button + double-tap zooms.
  const [animate, setAnimate] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // The image's rendered size at scale=1 (post object-fit:contain). Used to
  // clamp pan so the photo can't be dragged entirely off-screen.
  const baseSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  // Live transform values mirrored into refs so pointer handlers (which don't
  // re-bind every render) read current values without stale closures.
  const stateRef = useRef({ scale: 1, tx: 0, ty: 0 });
  stateRef.current = { scale, tx, ty };

  // Active pointers for pinch/pan/swipe gesture tracking.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    mode: 'none' | 'pan' | 'pinch' | 'swipe';
    startTx: number; startTy: number;
    startScale: number; startDist: number;
    startMidX: number; startMidY: number;
    swipeStartX: number; swipeStartY: number;
    moved: boolean;
  }>({
    mode: 'none', startTx: 0, startTy: 0, startScale: 1, startDist: 0,
    startMidX: 0, startMidY: 0, swipeStartX: 0, swipeStartY: 0, moved: false,
  });
  const lastTapRef = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });

  const photo = photos[index] || null;
  const effectiveNeedsAttention = photo ? (localFlags[photo.id]?.needs_attention ?? photo.needs_attention) : false;
  const effectiveIsRepair = photo ? (localFlags[photo.id]?.is_repair ?? photo.is_repair) : false;

  // Measure the image's fit-scale rendered size so we can clamp pan. Runs on
  // load + whenever the window resizes (the contained size is viewport-driven).
  const measureBase = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    // getBoundingClientRect reflects the CURRENT transform, so divide out the
    // active scale to recover the scale=1 footprint.
    const r = img.getBoundingClientRect();
    const s = stateRef.current.scale || 1;
    baseSizeRef.current = { w: r.width / s, h: r.height / s };
  }, []);

  useEffect(() => {
    const onResize = () => measureBase();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureBase]);

  // Clamp pan offsets so at least part of the image stays on screen — never
  // let the user fling it fully out of the viewport.
  const clampPan = useCallback((nx: number, ny: number, s: number): { x: number; y: number } => {
    const container = containerRef.current;
    const base = baseSizeRef.current;
    if (!container || !base.w || !base.h) return { x: nx, y: ny };
    const cr = container.getBoundingClientRect();
    const scaledW = base.w * s;
    const scaledH = base.h * s;
    // Max pan = half the overflow beyond the container on each axis. When the
    // scaled image is smaller than the container on an axis, lock pan to 0.
    const maxX = Math.max(0, (scaledW - cr.width) / 2);
    const maxY = Math.max(0, (scaledH - cr.height) / 2);
    return { x: clamp(nx, -maxX, maxX), y: clamp(ny, -maxY, maxY) };
  }, []);

  // Apply a new scale while keeping the content point under (focusX, focusY)
  // — viewport coordinates — visually stationary. focus omitted → zoom about
  // the container center.
  const applyZoom = useCallback((nextScaleRaw: number, focusX?: number, focusY?: number, withAnim = false) => {
    const container = containerRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;
    const fx = focusX ?? cx;
    const fy = focusY ?? cy;
    const { scale: s0, tx: tx0, ty: ty0 } = stateRef.current;
    const s1 = clamp(nextScaleRaw, MIN_SCALE, MAX_SCALE);
    if (s1 === s0) return;
    // Keep the focus point fixed: tx' = tx + dx*(1 - s1/s0), dx = fx - cx - tx.
    const dx = fx - cx - tx0;
    const dy = fy - cy - ty0;
    let nx = tx0 + dx * (1 - s1 / s0);
    let ny = ty0 + dy * (1 - s1 / s0);
    if (s1 <= MIN_SCALE) { nx = 0; ny = 0; }
    const clamped = clampPan(nx, ny, s1);
    setAnimate(withAnim);
    setScale(s1);
    setTx(clamped.x);
    setTy(clamped.y);
  }, [clampPan]);

  const resetZoom = useCallback((withAnim = true) => {
    setAnimate(withAnim);
    setScale(1); setTx(0); setTy(0);
  }, []);

  const goPrev = useCallback(() => { resetZoom(false); setIndex(i => (i > 0 ? i - 1 : i)); }, [resetZoom]);
  const goNext = useCallback(() => { resetZoom(false); setIndex(i => (i < photos.length - 1 ? i + 1 : i)); }, [resetZoom, photos.length]);

  // Reset zoom + re-measure whenever the displayed photo changes.
  useLayoutEffect(() => {
    setScale(1); setTx(0); setTy(0);
    // Defer measure until the new <img> has laid out.
    const id = window.requestAnimationFrame(() => measureBase());
    return () => window.cancelAnimationFrame(id);
  }, [index, measureBase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === '+' || e.key === '=') applyZoom(stateRef.current.scale + BUTTON_STEP, undefined, undefined, true);
      else if (e.key === '-' || e.key === '_') applyZoom(stateRef.current.scale - BUTTON_STEP, undefined, undefined, true);
      else if (e.key === '0') resetZoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext, applyZoom, resetZoom]);

  // ── Pointer gesture handlers (mouse + touch + pen unified) ─────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    const { scale: s, tx: x, ty: y } = stateRef.current;

    if (pointersRef.current.size === 2) {
      // Begin pinch — record start distance + midpoint + start scale.
      const pts = [...pointersRef.current.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      g.mode = 'pinch';
      g.startDist = Math.hypot(dx, dy) || 1;
      g.startScale = s;
      g.startMidX = (pts[0].x + pts[1].x) / 2;
      g.startMidY = (pts[0].y + pts[1].y) / 2;
      g.startTx = x; g.startTy = y;
      g.moved = true;
      return;
    }

    // Single pointer.
    g.startTx = x; g.startTy = y;
    g.swipeStartX = e.clientX; g.swipeStartY = e.clientY;
    g.moved = false;
    g.mode = s > 1 ? 'pan' : 'swipe';
    if (s > 1) setDragging(true);
    setAnimate(false);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = pointersRef.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    const g = gestureRef.current;

    if (g.mode === 'pinch' && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      const nextScale = g.startScale * (dist / g.startDist);
      applyZoom(nextScale, g.startMidX, g.startMidY, false);
      return;
    }

    if (g.mode === 'pan') {
      const ddx = e.clientX - g.swipeStartX;
      const ddy = e.clientY - g.swipeStartY;
      if (Math.abs(ddx) > TAP_MOVE_TOLERANCE || Math.abs(ddy) > TAP_MOVE_TOLERANCE) g.moved = true;
      const clamped = clampPan(g.startTx + ddx, g.startTy + ddy, stateRef.current.scale);
      setTx(clamped.x); setTy(clamped.y);
      return;
    }

    if (g.mode === 'swipe') {
      const ddx = e.clientX - g.swipeStartX;
      const ddy = e.clientY - g.swipeStartY;
      if (Math.abs(ddx) > TAP_MOVE_TOLERANCE || Math.abs(ddy) > TAP_MOVE_TOLERANCE) g.moved = true;
    }
  }, [applyZoom, clampPan]);

  const endGesture = useCallback((e: React.PointerEvent) => {
    const g = gestureRef.current;
    const wasMode = g.mode;
    pointersRef.current.delete(e.pointerId);

    // Pinch ends when fewer than 2 pointers remain.
    if (wasMode === 'pinch') {
      if (pointersRef.current.size < 2) {
        g.mode = pointersRef.current.size === 1 && stateRef.current.scale > 1 ? 'pan' : 'none';
        // Re-seat pan origin to the surviving pointer so it doesn't jump.
        const rest = [...pointersRef.current.values()][0];
        if (rest) { g.swipeStartX = rest.x; g.swipeStartY = rest.y; g.startTx = stateRef.current.tx; g.startTy = stateRef.current.ty; }
        // Snap back to fit if pinched below 1×.
        if (stateRef.current.scale <= 1.01) resetZoom();
      }
      return;
    }

    setDragging(false);

    // Double-tap / double-click → toggle zoom. Only when the pointer barely
    // moved (a real tap, not the tail of a drag/swipe).
    if (!g.moved) {
      const now = Date.now();
      const last = lastTapRef.current;
      const isDouble = now - last.t < DOUBLE_TAP_MS
        && Math.abs(e.clientX - last.x) < 24 && Math.abs(e.clientY - last.y) < 24;
      if (isDouble) {
        if (stateRef.current.scale > 1) resetZoom();
        else applyZoom(DOUBLE_TAP_SCALE, e.clientX, e.clientY, true);
        lastTapRef.current = { t: 0, x: 0, y: 0 };
      } else {
        lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
      }
      g.mode = 'none';
      return;
    }

    // Single-finger swipe at fit-scale → navigate.
    if (wasMode === 'swipe' && stateRef.current.scale <= 1) {
      const ddx = e.clientX - g.swipeStartX;
      const ddy = e.clientY - g.swipeStartY;
      if (Math.abs(ddx) > SWIPE_THRESHOLD && Math.abs(ddx) > Math.abs(ddy)) {
        if (ddx > 0) goPrev(); else goNext();
      }
    }
    g.mode = 'none';
  }, [applyZoom, resetZoom, goPrev, goNext]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    // Trackpad/mouse-wheel zoom toward the cursor. We don't preventDefault
    // (passive listener) — the scale change is enough and avoids the React
    // passive-wheel warning; the container has no native scroll anyway.
    const delta = -e.deltaY;
    const next = stateRef.current.scale * (1 + delta * WHEEL_STEP);
    applyZoom(next, e.clientX, e.clientY, false);
  }, [applyZoom]);

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

  const zoomed = scale > 1.01;

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
        ref={containerRef}
        onClick={e => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onWheel={onWheel}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', minHeight: 0, overflow: 'hidden',
          // Disable native touch gestures so our pointer handlers own pinch/pan.
          touchAction: 'none',
          cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
      >
        {/* Nav arrows — hidden while zoomed so panning doesn't fight them. */}
        {!zoomed && index > 0 && (
          <button onClick={goPrev} style={{ ...navBtn, left: 12 }} aria-label="Previous">
            <ChevronLeft size={22} />
          </button>
        )}
        <img
          ref={imgRef}
          src={photo.storage_url || ''}
          alt={photo.file_name || 'Photo'}
          draggable={false}
          onLoad={measureBase}
          style={{
            maxWidth: '96vw', maxHeight: 'calc(100vh - 200px)', objectFit: 'contain', borderRadius: 8,
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: animate ? 'transform 0.18s ease, box-shadow 0.2s ease' : 'box-shadow 0.2s ease',
            boxShadow: effectiveNeedsAttention
              ? `0 0 0 5px ${ATTENTION_RING}, 0 0 0 9px rgba(220,38,38,0.25)`
              : effectiveIsRepair
              ? `0 0 0 5px ${REPAIR_RING}, 0 0 0 9px rgba(124,58,237,0.25)`
              : undefined,
            userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
          }}
        />
        {!zoomed && index < photos.length - 1 && (
          <button onClick={goNext} style={{ ...navBtn, right: 12 }} aria-label="Next">
            <ChevronRight size={22} />
          </button>
        )}

        {/* Zoom control cluster — bottom-center, above the metadata bar. */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 100, padding: '4px 6px', backdropFilter: 'blur(4px)',
          }}
        >
          <button
            onClick={() => applyZoom(stateRef.current.scale - BUTTON_STEP, undefined, undefined, true)}
            disabled={scale <= MIN_SCALE}
            style={{ ...zoomBtn, opacity: scale <= MIN_SCALE ? 0.4 : 1 }}
            aria-label="Zoom out"
          ><ZoomOut size={isTablet ? 20 : 17} /></button>
          <button
            onClick={() => resetZoom()}
            disabled={!zoomed}
            title="Reset zoom"
            style={{ ...zoomBtn, opacity: zoomed ? 1 : 0.4, minWidth: isTablet ? 52 : 44, fontSize: isTablet ? 13 : 11, fontWeight: 700 }}
            aria-label="Reset zoom"
          >{zoomed ? `${Math.round(scale * 100)}%` : <Maximize2 size={isTablet ? 18 : 15} />}</button>
          <button
            onClick={() => applyZoom(stateRef.current.scale + BUTTON_STEP, undefined, undefined, true)}
            disabled={scale >= MAX_SCALE}
            style={{ ...zoomBtn, opacity: scale >= MAX_SCALE ? 0.4 : 1 }}
            aria-label="Zoom in"
          ><ZoomIn size={isTablet ? 20 : 17} /></button>
        </div>
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
  color: '#fff', borderRadius: '50%', cursor: 'pointer', zIndex: 3,
};

const zoomBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 34, minWidth: 34, borderRadius: 100, padding: '0 6px', fontFamily: 'inherit',
};
