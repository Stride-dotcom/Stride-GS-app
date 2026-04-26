/**
 * PublicPhotoGallery — no-auth shareable photo gallery page.
 *
 * Rendered directly from App.tsx when the URL hash matches
 * #/shared/photos/:shareId — bypasses the auth gate entirely. The
 * page uses the Supabase anon key, which the photo_shares /
 * item_photos / storage RLS policies allow for active, non-expired
 * shares (see migration 20260426120000_photo_shares.sql).
 *
 * Header info is read straight from photo_shares.entity_context (a
 * snapshot taken at share-creation time) so the public page never
 * needs to query inventory_cache, shipments, etc.
 */
import { useEffect, useMemo, useState } from 'react';
import { ImageIcon, AlertTriangle, Wrench, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  fetchPublicPhotoShare,
  type PhotoShare,
  type EntityShareContext,
} from '../hooks/usePhotoShares';
import { PhotoGrid } from '../components/media/PhotoGrid';
import { PhotoLightbox } from '../components/media/PhotoLightbox';
import type { Photo } from '../hooks/usePhotos';

const BUCKET = 'photos';
const SIGNED_URL_TTL = 60 * 60; // 1 hour — page refresh re-mints

interface Props {
  shareId: string;
}

export function PublicPhotoGallery({ shareId }: Props) {
  const [share, setShare] = useState<PhotoShare | null | undefined>(undefined); // undefined = loading
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setShare(undefined);
    setPhotos([]);
    setError(null);

    (async () => {
      const s = await fetchPublicPhotoShare(shareId);
      if (cancelled) return;
      if (!s) {
        setShare(null);
        return;
      }
      setShare(s);

      // Load the photo rows whose ids are in the share, then mint signed
      // URLs for both originals + thumbnails. Same shape as usePhotos's
      // refetch — kept inline here so the public page has zero dependency
      // on the auth-aware hook.
      try {
        // Explicit column list — the anon role only has SELECT on the
        // public-safe subset (see migration
        // 20260426130000_photo_shares_narrow_anon_columns.sql). `select('*')`
        // would 401 on the restricted columns.
        const { data, error: err } = await supabase
          .from('item_photos')
          .select('id, storage_key, thumbnail_key, file_name, photo_type, needs_attention, is_repair, created_at, uploaded_by_name')
          .in('id', s.photoIds);
        if (cancelled) return;
        if (err) {
          setError(err.message);
          return;
        }
        const rows = ((data || []) as Photo[]).slice();
        // Preserve the order the sharer chose so the gallery doesn't shuffle
        // by created_at — the shared link should feel curated, not random.
        const orderIdx: Record<string, number> = {};
        s.photoIds.forEach((id, i) => { orderIdx[id] = i; });
        rows.sort((a, b) => (orderIdx[a.id] ?? 0) - (orderIdx[b.id] ?? 0));

        const originalKeys = rows.map(r => r.storage_key).filter(Boolean);
        const thumbKeys = rows.map(r => r.thumbnail_key).filter((k): k is string => !!k);
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
        for (const r of rows) {
          const oSigned = origMap[r.storage_key];
          if (oSigned) r.storage_url = oSigned;
          if (r.thumbnail_key) {
            const tSigned = thumbMap[r.thumbnail_key];
            if (tSigned) r.thumbnail_url = tSigned;
          } else if (oSigned) {
            r.thumbnail_url = oSigned;
          }
        }
        if (!cancelled) setPhotos(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load photos');
      }
    })();

    return () => { cancelled = true; };
  }, [shareId]);

  const ctx: EntityShareContext | null = useMemo(
    () => share?.entityContext ?? null,
    [share],
  );

  // ── Render states ────────────────────────────────────────────────────
  if (share === undefined) {
    return <CenteredMessage>
      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
      <span>Loading shared gallery…</span>
    </CenteredMessage>;
  }

  if (share === null) {
    return <CenteredMessage>
      <AlertTriangle size={28} color="#B91C1C" />
      <div style={{ fontSize: 16, fontWeight: 600 }}>This share link is no longer available.</div>
      <div style={{ fontSize: 13, color: '#6B7280', textAlign: 'center', maxWidth: 360 }}>
        It may have been revoked or has expired. If you need access, ask whoever sent you the link to share it again.
      </div>
    </CenteredMessage>;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F8F8F6',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      color: '#1F2937',
    }}>
      {/* Header bar */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #E5E7EB',
        padding: '20px 24px',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: '#E85D2D', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            marginBottom: 6,
          }}>
            <ImageIcon size={14} /> Shared photos
          </div>
          <h1 style={{
            margin: 0, fontSize: 24, fontWeight: 700,
            color: '#111827',
          }}>{ctx?.label || share.entityId}</h1>
          {ctx?.title && (
            <div style={{ marginTop: 6, fontSize: 15, color: '#374151' }}>{ctx.title}</div>
          )}
          {ctx?.subtitle && (
            <div style={{ marginTop: 2, fontSize: 13, color: '#6B7280' }}>{ctx.subtitle}</div>
          )}
          {ctx?.meta && Object.keys(ctx.meta).length > 0 && (
            <dl style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '8px 24px',
              marginTop: 14, marginBottom: 0,
            }}>
              {Object.entries(ctx.meta)
                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                .map(([k, v]) => (
                  <div key={k}>
                    <dt style={{
                      fontSize: 10, fontWeight: 600, color: '#9CA3AF',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>{k}</dt>
                    <dd style={{ margin: '2px 0 0', fontSize: 13, color: '#1F2937' }}>{String(v)}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        {/* Flag legend — only render when at least one photo carries a flag */}
        {photos.some(p => p.needs_attention || p.is_repair) && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16,
            fontSize: 12, color: '#6B7280',
          }}>
            {photos.some(p => p.needs_attention) && (
              <span style={legendStyle('#DC2626')}>
                <AlertTriangle size={11} /> Needs attention
              </span>
            )}
            {photos.some(p => p.is_repair) && (
              <span style={legendStyle('#7C3AED')}>
                <Wrench size={11} /> Repair
              </span>
            )}
          </div>
        )}

        {error && (
          <div role="alert" style={{
            background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 12,
          }}>{error}</div>
        )}

        {photos.length === 0 && !error ? (
          <div style={{
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
            padding: '40px 20px', textAlign: 'center', color: '#6B7280', fontSize: 13,
          }}>Loading photos…</div>
        ) : (
          <PhotoGrid
            photos={photos}
            onPhotoClick={(_, i) => setLightboxIndex(i)}
          />
        )}

        <footer style={{
          marginTop: 32, padding: '16px 0',
          fontSize: 11, color: '#9CA3AF', textAlign: 'center',
        }}>
          Right-click a photo to download. Powered by Stride Logistics.
        </footer>
      </main>

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

function legendStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: `${color}10`, color, fontWeight: 600,
    padding: '4px 10px', borderRadius: 100,
    border: `1px solid ${color}40`,
  };
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#F8F8F6',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: 24,
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      color: '#374151',
    }}>{children}</div>
  );
}
