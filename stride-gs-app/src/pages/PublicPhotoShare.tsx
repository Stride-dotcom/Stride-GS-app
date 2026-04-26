/**
 * PublicPhotoShare — no-auth shareable photo gallery page.
 *
 * Rendered directly from App.tsx when the URL hash matches
 * #/shared/photos/:shareId — bypasses auth entirely. Uses the
 * Supabase anon key, gated by the photo_shares public_read,
 * item_photos_select_via_share, and photos_select_via_share RLS
 * policies (see migration 20260426090000_photo_shares.sql).
 *
 * The share row carries:
 *   - photoIds — explicit list of item_photos.id values
 *   - header   — JSONB snapshot of entity context (vendor/desc/qty
 *                or jobId/clientName/date/ref). Frozen at create
 *                time so this page never queries entity tables.
 *   - title    — optional human-readable label
 *
 * Photo display reuses PhotoLightbox in readOnly mode so action
 * buttons (flag/repair/delete) are hidden. Flag rings + chips
 * still render so attention/repair callouts are visible to the
 * client.
 *
 * Storage URLs are signed (1h TTL) on each page load via the
 * `photos_select_via_share` storage policy. The share link is
 * permanent — only the per-render signed URLs expire.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  fetchPublicPhotoShare,
  type PhotoShare,
  type PhotoShareHeader,
} from '../hooks/usePhotoShares';
import type { Photo } from '../hooks/usePhotos';
import { PhotoLightbox } from '../components/media/PhotoLightbox';

// ─── Style tokens (mirrors PublicRates) ──────────────────────────────────────
const BG_PAGE  = '#F5F2EE';
const BG_CARD  = '#FFFFFF';
const BG_DARK  = '#1C1C1C';
const ACCENT   = '#E85D2D';
const TEXT     = '#1C1C1C';
const TEXT_MUT = '#888888';
const BORDER   = 'rgba(0,0,0,0.07)';
const RADIUS   = '16px';
const FONT     = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const ATTENTION_RING = '#DC2626';
const REPAIR_RING    = '#7C3AED';

const BUCKET = 'photos';
const SIGNED_URL_TTL = 60 * 60;

interface Props { shareId: string }

interface PhotoRow {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  storage_key: string;
  storage_url: string | null;
  thumbnail_key: string | null;
  thumbnail_url: string | null;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  is_primary: boolean;
  needs_attention: boolean;
  is_repair: boolean;
  photo_type: string;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPhoto(r: PhotoRow): Photo {
  return r as unknown as Photo;
}

export function PublicPhotoShare({ shareId }: Props) {
  const [share, setShare] = useState<PhotoShare | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchPublicPhotoShare(shareId);
      if (cancelled) return;
      if (!s || s.photoIds.length === 0) {
        setStatus('unavailable');
        return;
      }
      setShare(s);

      // Fetch the explicit photo rows. The share row is the gate; a leaked
      // share_id grants access only to the photos pinned to it.
      const { data: rows, error } = await supabase
        .from('item_photos')
        .select('*')
        .in('id', s.photoIds);
      if (cancelled) return;
      if (error) { setStatus('unavailable'); return; }
      const photoRows = (rows ?? []) as PhotoRow[];

      // Preserve the order in which the user picked photos when creating the
      // share — the IN() result order is undefined.
      const idIndex: Record<string, number> = {};
      s.photoIds.forEach((id, i) => { idIndex[id] = i; });
      photoRows.sort((a, b) => (idIndex[a.id] ?? Number.MAX_SAFE_INTEGER) - (idIndex[b.id] ?? Number.MAX_SAFE_INTEGER));

      // Sign storage URLs. The photos bucket is private; anon SELECT is
      // gated by `photos_select_via_share`, which only matches keys that
      // belong to a photo in some active share.
      try {
        const originalKeys = photoRows.map(r => r.storage_key).filter(Boolean);
        const thumbKeys = photoRows.map(r => r.thumbnail_key).filter((k): k is string => !!k);
        const [origSigned, thumbSigned] = await Promise.all([
          originalKeys.length
            ? supabase.storage.from(BUCKET).createSignedUrls(originalKeys, SIGNED_URL_TTL)
            : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
          thumbKeys.length
            ? supabase.storage.from(BUCKET).createSignedUrls(thumbKeys, SIGNED_URL_TTL)
            : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
        ]);
        const origMap: Record<string, string> = {};
        for (const item of origSigned.data || []) {
          if (item.path && item.signedUrl) origMap[item.path] = item.signedUrl;
        }
        const thumbMap: Record<string, string> = {};
        for (const item of thumbSigned.data || []) {
          if (item.path && item.signedUrl) thumbMap[item.path] = item.signedUrl;
        }
        for (const r of photoRows) {
          const oSigned = origMap[r.storage_key];
          if (oSigned) r.storage_url = oSigned;
          if (r.thumbnail_key) {
            const tSigned = thumbMap[r.thumbnail_key];
            if (tSigned) r.thumbnail_url = tSigned;
            else if (oSigned) r.thumbnail_url = oSigned;
          } else if (oSigned) {
            r.thumbnail_url = oSigned;
          }
        }
      } catch {
        // Non-fatal — unsigned URLs will 403 but the page still renders.
      }

      if (cancelled) return;
      setPhotos(photoRows.map(rowToPhoto));
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [shareId]);

  const headerLabel = useMemo(() => {
    if (!share) return '';
    return formatHeaderTitle(share.header, share.title);
  }, [share]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div style={{ fontFamily: FONT, minHeight: '100vh', background: BG_PAGE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: TEXT_MUT, fontSize: 14 }}>Loading photos…</div>
      </div>
    );
  }

  // ── Unavailable ────────────────────────────────────────────────────────────
  if (status === 'unavailable' || !share) {
    return (
      <div style={{ fontFamily: FONT, minHeight: '100vh', background: BG_PAGE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ fontSize: 32, color: TEXT_MUT }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: TEXT }}>This link is no longer available</div>
        <div style={{ fontSize: 14, color: TEXT_MUT }}>The photo link may have been deactivated.</div>
        <a href="https://www.stridenw.com" style={{ marginTop: 8, color: ACCENT, textDecoration: 'none', fontSize: 14 }}>Visit stridenw.com</a>
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: FONT, minHeight: '100vh', background: BG_PAGE, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: BG_DARK, padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img
              src="https://www.mystridehub.com/stride-logo.png"
              alt="Stride"
              style={{ height: 36, width: 36, objectFit: 'contain' }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '2px', color: '#FFFFFF', lineHeight: 1.1 }}>STRIDE</div>
              <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: '5px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', lineHeight: 1 }}>LOGISTICS</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', letterSpacing: '0.5px' }}>{headerLabel || 'Shared photos'}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
              {photos.length} photo{photos.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, maxWidth: 1100, width: '100%', margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Entity header card */}
        <EntityHeaderCard header={share.header} title={share.title} />

        {/* Photo grid */}
        {photos.length === 0 ? (
          <div style={{
            background: BG_CARD, borderRadius: RADIUS, border: `1px solid ${BORDER}`,
            padding: '48px 24px', textAlign: 'center',
            color: TEXT_MUT, fontSize: 14,
          }}>
            No photos in this share.
          </div>
        ) : (
          <div style={{
            background: BG_CARD, borderRadius: RADIUS, border: `1px solid ${BORDER}`,
            padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}>
            <PublicPhotoGrid
              photos={photos}
              onOpen={i => setLightboxIndex(i)}
            />
          </div>
        )}

        <p style={{ fontSize: 12, color: TEXT_MUT, textAlign: 'center', margin: 0, lineHeight: 1.6 }}>
          Right-click (or long-press on mobile) any photo to save it.
        </p>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: '20px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: TEXT_MUT }}>Stride Logistics · Kent, WA</span>
          <span style={{ color: BORDER }}>·</span>
          <a href="https://www.stridenw.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: ACCENT, textDecoration: 'none' }}>stridenw.com</a>
          <span style={{ color: BORDER }}>·</span>
          <a href="mailto:info@stridenw.com" style={{ fontSize: 12, color: TEXT_MUT, textDecoration: 'none' }}>info@stridenw.com</a>
        </div>
      </footer>

      {/* Lightbox — readOnly so flag/repair/delete buttons are hidden */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxIndex}
          readOnly
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

// ─── Entity header card ──────────────────────────────────────────────────────

function EntityHeaderCard({ header, title }: { header: PhotoShareHeader; title: string | null }) {
  const fields = headerFields(header);
  // Empty header → render nothing rather than a blank card.
  if (fields.length === 0 && !title) return null;

  return (
    <div style={{
      background: BG_CARD, borderRadius: RADIUS, border: `1px solid ${BORDER}`,
      padding: '20px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
    }}>
      {title && (
        <div style={{
          fontSize: 18, fontWeight: 600, color: TEXT,
          marginBottom: fields.length > 0 ? 14 : 0,
        }}>
          {title}
        </div>
      )}
      {fields.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 16,
        }}>
          {fields.map(f => (
            <div key={f.label}>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '1.5px',
                textTransform: 'uppercase', color: TEXT_MUT, marginBottom: 4,
              }}>{f.label}</div>
              <div style={{ fontSize: 14, color: TEXT, fontWeight: 500 }}>{f.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface HeaderField { label: string; value: string }

function headerFields(h: PhotoShareHeader): HeaderField[] {
  const out: HeaderField[] = [];
  const push = (label: string, v: string | number | null | undefined) => {
    if (v === null || v === undefined) return;
    const s = typeof v === 'number' ? String(v) : v.trim();
    if (s) out.push({ label, value: s });
  };
  if (h.kind === 'item') {
    push('ID#',         h.itemId);
    push('Vendor',      h.vendor);
    push('Description', h.description);
    push('Quantity',    h.quantity ?? null);
    push('Reference',   h.reference);
    push('Client',      h.clientName);
  } else if (h.kind === 'job') {
    push('Job',       h.jobLabel ?? h.jobId);
    push('Client',    h.clientName);
    push('Date',      h.date);
    push('Reference', h.reference);
    push('Status',    h.status);
  } else {
    push('Label',     h.label);
    push('Reference', h.reference);
    push('Client',    h.clientName);
  }
  return out;
}

function formatHeaderTitle(h: PhotoShareHeader, title: string | null): string {
  if (title && title.trim()) return title.trim();
  if (h.kind === 'item') {
    const parts = [h.itemId, h.description].filter((s): s is string => !!s && !!s.trim());
    if (parts.length > 0) return parts.join(' · ');
    return 'Inventory photos';
  }
  if (h.kind === 'job') {
    const label = h.jobLabel ?? h.jobId;
    const parts = [label, h.clientName].filter((s): s is string => !!s && !!s.trim());
    if (parts.length > 0) return parts.join(' · ');
    return 'Job photos';
  }
  return h.label?.trim() || 'Shared photos';
}

// ─── Public photo grid ───────────────────────────────────────────────────────
// Lightweight read-only grid. Lives here (not PhotoGrid.tsx) so the public
// page never imports the auth-bound action callbacks indirectly via tree
// shaking edge cases — and to keep the public surface area minimal.

function PublicPhotoGrid({ photos, onOpen }: { photos: Photo[]; onOpen: (i: number) => void }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: 10,
    }}>
      {photos.map((p, i) => {
        const ring = p.needs_attention ? ATTENTION_RING : p.is_repair ? REPAIR_RING : null;
        const src = p.thumbnail_url || p.storage_url || '';
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(i)}
            style={{
              position: 'relative',
              aspectRatio: '1 / 1',
              borderRadius: 10,
              overflow: 'hidden',
              cursor: 'pointer',
              background: '#E5E7EB',
              padding: 0, border: 'none',
              boxShadow: ring
                ? `0 0 0 4px ${ring}, 0 2px 8px rgba(0,0,0,0.12)`
                : '0 2px 8px rgba(0,0,0,0.06)',
              transition: 'transform 0.12s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {src ? (
              <img
                src={src}
                alt={p.file_name || 'Photo'}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUT, fontSize: 11 }}>
                No preview
              </div>
            )}
            {/* Flag chips — same visual language as the in-app PhotoGrid */}
            <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4, pointerEvents: 'none' }}>
              {p.needs_attention && (
                <span style={chipStyle(ATTENTION_RING)} title="Needs attention">
                  <AlertTriangle size={10} /> FLAG
                </span>
              )}
              {p.is_repair && (
                <span style={chipStyle(REPAIR_RING)} title="Repair">
                  <Wrench size={10} /> REPAIR
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
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
