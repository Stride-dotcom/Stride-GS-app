/**
 * PublicPhotoGallery — no-auth shareable photo gallery.
 *
 * Rendered directly from App.tsx when the URL hash matches
 * #/shared/photos/:shareId — bypasses auth entirely. Uses the Supabase
 * anon key, which is allowed by the photo_shares + item_photos +
 * storage.objects RLS policies in 20260426100000_photo_shares.sql.
 *
 * Header switches between an item-level layout (entity_type='inventory')
 * and a job-level layout (everything else) based on the share row. The
 * header context is a snapshot stamped at share-create time so we don't
 * need to join live entity tables (which live in Sheets and aren't
 * reachable from the anon client).
 */
import { useEffect, useState } from 'react';
import { Loader2, ImageOff, AlertTriangle, Download } from 'lucide-react';
import {
  fetchPublicPhotoShare, fetchSharedPhotos, type PhotoShare,
} from '../hooks/usePhotoShares';
import type { Photo } from '../hooks/usePhotos';
import { PhotoLightbox } from '../components/media/PhotoLightbox';

interface Props { shareId: string; }

const ATTENTION_RING = '#DC2626';
const REPAIR_RING = '#7C3AED';
const ACCENT = '#E85D2D';

export function PublicPhotoGallery({ shareId }: Props) {
  const [status, setStatus] = useState<'loading' | 'not-found' | 'ready'>('loading');
  const [share, setShare] = useState<PhotoShare | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchPublicPhotoShare(shareId);
      if (cancelled) return;
      if (!s) { setStatus('not-found'); return; }
      setShare(s);
      const p = await fetchSharedPhotos(s);
      if (cancelled) return;
      setPhotos(p);
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [shareId]);

  // Signed URLs expire in 1 h. If the recipient leaves the tab open and comes
  // back later, refresh photo URLs whenever the page becomes visible again so
  // thumbnails + lightbox don't 403 on long sessions.
  useEffect(() => {
    if (!share) return;
    let cancelled = false;
    let lastRefresh = Date.now();
    const REFRESH_AFTER_MS = 30 * 60 * 1000;
    const refresh = async () => {
      if (Date.now() - lastRefresh < REFRESH_AFTER_MS) return;
      lastRefresh = Date.now();
      const p = await fetchSharedPhotos(share);
      if (!cancelled) setPhotos(p);
    };
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [share]);

  if (status === 'loading') {
    return (
      <CenterShell>
        <Loader2 size={28} style={{ color: ACCENT, animation: 'spin 1s linear infinite' }} />
        <div style={{ marginTop: 14, fontSize: 13, color: '#666' }}>Loading photos…</div>
      </CenterShell>
    );
  }

  if (status === 'not-found' || !share) {
    return (
      <CenterShell>
        <ImageOff size={36} style={{ color: '#9CA3AF' }} />
        <div style={{ marginTop: 14, fontSize: 15, fontWeight: 600, color: '#1C1C1C' }}>
          Photo gallery not found
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: '#6B7280', maxWidth: 380, textAlign: 'center' }}>
          The link may be incorrect or the share may have been disabled. Please
          contact Stride Logistics if you believe this is an error.
        </div>
      </CenterShell>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F5F2ED',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      color: '#1C1C1C',
    }}>
      <PageHeader share={share} photoCount={photos.length} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 18px 60px' }}>
        {photos.length === 0 ? (
          <div style={{
            background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12,
            padding: 32, textAlign: 'center', color: '#6B7280', fontSize: 13,
          }}>
            <ImageOff size={28} style={{ color: '#9CA3AF', marginBottom: 8 }} />
            <div>No photos in this gallery.</div>
          </div>
        ) : (
          <Grid photos={photos} onClick={i => setLightboxIndex(i)} />
        )}

        <Footer />
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          readOnly
        />
      )}
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function PageHeader({ share, photoCount }: { share: PhotoShare; photoCount: number }) {
  const ctx = share.headerContext || {};
  const isItem = share.entityType === 'inventory';

  return (
    <div style={{
      background: '#1C1C1C',
      color: '#fff',
      padding: '20px 0 22px',
      borderBottom: `3px solid ${ACCENT}`,
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 18px' }}>
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)' }}>
            Stride Logistics · Photo Gallery
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
            {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
          </div>
        </div>

        {/* Title */}
        {share.title && (
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10, lineHeight: 1.25 }}>
            {share.title}
          </div>
        )}

        {/* Context grid */}
        {isItem
          ? <ItemHeaderGrid ctx={ctx} fallbackId={share.entityId} />
          : <JobHeaderGrid ctx={ctx} entityType={share.entityType} fallbackId={share.entityId} />}
      </div>
    </div>
  );
}

function HeaderField({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '' || value === false) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)', marginBottom: 3,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 600, color: '#fff',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </div>
  );
}

function ItemHeaderGrid({ ctx, fallbackId }: { ctx: NonNullable<PhotoShare['headerContext']>; fallbackId: string }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 16,
      paddingTop: 4,
    }}>
      <HeaderField label="Item ID" value={ctx.itemId || fallbackId} />
      <HeaderField label="Vendor" value={ctx.vendor} />
      <HeaderField label="Description" value={ctx.description} />
      <HeaderField label="Quantity" value={ctx.quantity != null ? String(ctx.quantity) : null} />
      <HeaderField label="Reference" value={ctx.reference} />
    </div>
  );
}

function fmtDate(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  const s = typeof value === 'number' ? String(value) : value;
  // Plain YYYY-MM-DD: render as a local-time date with no timezone shift.
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s;
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const JOB_LABELS: Record<string, string> = {
  task: 'Task',
  repair: 'Repair',
  will_call: 'Will Call',
  shipment: 'Shipment',
  claim: 'Claim',
};

function JobHeaderGrid({
  ctx, entityType, fallbackId,
}: {
  ctx: NonNullable<PhotoShare['headerContext']>;
  entityType: string;
  fallbackId: string;
}) {
  const jobLabel = JOB_LABELS[entityType] ?? 'Job';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 16,
      paddingTop: 4,
    }}>
      <HeaderField label={`${jobLabel} ID`} value={ctx.jobId || fallbackId} />
      <HeaderField label="Client" value={ctx.clientName} />
      <HeaderField label="Date" value={fmtDate(ctx.date)} />
      <HeaderField label="Reference" value={ctx.reference} />
    </div>
  );
}

// ── Grid ───────────────────────────────────────────────────────────────────

function Grid({ photos, onClick }: { photos: Photo[]; onClick: (i: number) => void }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 14,
    }}>
      {photos.map((p, i) => (
        <Tile key={p.id} photo={p} onClick={() => onClick(i)} />
      ))}
    </div>
  );
}

function Tile({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  const ringColor = photo.needs_attention
    ? ATTENTION_RING
    : photo.is_repair
    ? REPAIR_RING
    : null;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: '#fff',
        borderRadius: 10,
        overflow: 'hidden',
        cursor: 'zoom-in',
        boxShadow: ringColor
          ? `0 0 0 3px ${ringColor}, 0 1px 4px rgba(0,0,0,0.08)`
          : '0 1px 4px rgba(0,0,0,0.08)',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ aspectRatio: '1 / 1', background: '#F3F0EA', position: 'relative' }}>
        <img
          src={photo.thumbnail_url || photo.storage_url || ''}
          alt={photo.file_name || 'Photo'}
          loading="lazy"
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            display: 'block',
          }}
        />

        {/* Flag badges */}
        {(photo.needs_attention || photo.is_repair) && (
          <div style={{
            position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4,
          }}>
            {photo.needs_attention && (
              <FlagBadge color={ATTENTION_RING} icon={<AlertTriangle size={10} />} label="Attention" />
            )}
            {photo.is_repair && (
              <FlagBadge color={REPAIR_RING} icon={<AlertTriangle size={10} />} label="Repair" />
            )}
          </div>
        )}

        {/* Hover download button */}
        <button
          onClick={handleDownload}
          aria-label="Download photo"
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(15,23,42,0.65)',
            border: 'none', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Download size={14} />
        </button>
      </div>
    </div>
  );
}

function FlagBadge({ color, icon, label }: { color: string; icon: React.ReactNode; label: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: color, color: '#fff',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
      padding: '3px 7px', borderRadius: 100,
    }}>
      {icon}{label}
    </div>
  );
}

// ── Footer / shells ────────────────────────────────────────────────────────

function Footer() {
  return (
    <div style={{
      marginTop: 32, paddingTop: 18,
      borderTop: '1px solid rgba(0,0,0,0.08)',
      fontSize: 11, color: '#888', textAlign: 'center',
    }}>
      Shared via <span style={{ color: ACCENT, fontWeight: 600 }}>Stride Logistics</span> ·
      mystridehub.com
    </div>
  );
}

function CenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#F5F2ED',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24,
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    }}>
      {children}
    </div>
  );
}
