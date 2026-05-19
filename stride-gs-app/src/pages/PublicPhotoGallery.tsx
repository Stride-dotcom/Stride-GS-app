/**
 * PublicPhotoGallery — no-auth shareable photo gallery page.
 *
 * Rendered directly from App.tsx when the URL hash matches
 * #/shared/photos/:shareId — bypasses the auth gate entirely.
 *
 * All data (share row + per-photo signed URLs) is fetched through the
 * `get-shared-photos` Edge Function with the service role. The browser
 * never tries to mint signed URLs itself: the anon role can read the
 * `item_photos` rows via the narrow-column public policy, but cannot
 * call `storage.createSignedUrls` on the private `photos` bucket — that
 * silently returned empty URLs for every client opening a share link.
 *
 * Header info comes straight from photo_shares.entity_context (a snapshot
 * taken at share-creation time) so the public page never needs to query
 * inventory_cache, shipments, etc.
 */
import { useEffect, useMemo, useState } from 'react';
import { ImageIcon, AlertTriangle, Wrench, Loader2 } from 'lucide-react';
import type { EntityShareContext } from '../hooks/usePhotoShares';
import { PhotoGrid } from '../components/media/PhotoGrid';
import { PhotoLightbox } from '../components/media/PhotoLightbox';
import type { Photo, PhotoType, EntityType } from '../hooks/usePhotos';

interface Props {
  shareId: string;
}

// Narrow render-time shape. We only need entityContext from the share row —
// the full PhotoShare object is irrelevant here.
interface PublicShareView {
  entityContext: EntityShareContext;
}

// What the Edge Function returns per photo. camelCase keys; we accept
// snake_case fallbacks so the page stays robust if the EF ever standardizes
// on the DB column names.
interface EdgePhoto {
  id: string;
  signedUrl?: string | null;
  storageUrl?: string | null;
  storage_url?: string | null;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
  fileName?: string | null;
  file_name?: string | null;
  fileSize?: number | null;
  file_size?: number | null;
  mimeType?: string | null;
  mime_type?: string | null;
  photoType?: PhotoType | null;
  photo_type?: PhotoType | null;
  needsAttention?: boolean | null;
  needs_attention?: boolean | null;
  isRepair?: boolean | null;
  is_repair?: boolean | null;
  isPrimary?: boolean | null;
  is_primary?: boolean | null;
  createdAt?: string | null;
  created_at?: string | null;
  uploadedByName?: string | null;
  uploaded_by_name?: string | null;
}

interface EdgeResponse {
  ok: boolean;
  share?: { entity_context?: EntityShareContext | null } | null;
  photos?: EdgePhoto[];
  error?: string;
}

function mapEdgePhoto(p: EdgePhoto): Photo {
  const storageUrl = p.signedUrl ?? p.storageUrl ?? p.storage_url ?? null;
  const thumbnailUrl = p.thumbnailUrl ?? p.thumbnail_url ?? storageUrl;
  return {
    id: p.id,
    // Fields the UI never reads but the Photo type requires.
    tenant_id: '',
    entity_type: 'inventory' as EntityType,
    entity_id: '',
    item_id: null,
    storage_key: '',
    storage_url: storageUrl,
    thumbnail_key: null,
    thumbnail_url: thumbnailUrl,
    file_name: p.fileName ?? p.file_name ?? '',
    file_size: p.fileSize ?? p.file_size ?? null,
    mime_type: p.mimeType ?? p.mime_type ?? null,
    is_primary: p.isPrimary ?? p.is_primary ?? false,
    needs_attention: p.needsAttention ?? p.needs_attention ?? false,
    is_repair: p.isRepair ?? p.is_repair ?? false,
    photo_type: (p.photoType ?? p.photo_type ?? 'general') as PhotoType,
    uploaded_by: null,
    uploaded_by_name: p.uploadedByName ?? p.uploaded_by_name ?? null,
    created_at: p.createdAt ?? p.created_at ?? '',
    updated_at: p.createdAt ?? p.created_at ?? '',
  };
}

export function PublicPhotoGallery({ shareId }: Props) {
  const [share, setShare] = useState<PublicShareView | null | undefined>(undefined); // undefined = loading
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setShare(undefined);
    setPhotos([]);
    setError(null);

    (async () => {
      // The Edge Function runs with the service role and bypasses storage
      // RLS, so it can mint signed URLs for anon visitors. verify_jwt=false
      // on the function, but Supabase's gateway still requires an apikey
      // header — the anon key works for that.
      const projectUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      if (!projectUrl || !anonKey) {
        if (!cancelled) {
          setError('Service not configured. Refresh the page or contact the sender.');
          setShare(null);
        }
        return;
      }

      try {
        const url = `${projectUrl}/functions/v1/get-shared-photos?shareId=${encodeURIComponent(shareId)}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        });
        if (cancelled) return;

        if (!res.ok) {
          // 404/410/etc — surface the "no longer available" empty state,
          // same as the prior fetchPublicPhotoShare(null) path.
          setShare(null);
          return;
        }
        const json = (await res.json()) as EdgeResponse;
        if (cancelled) return;
        if (!json.ok || !json.share) {
          setShare(null);
          return;
        }

        const ctx: EntityShareContext = json.share.entity_context ?? { label: 'Shared photos' };
        setShare({ entityContext: ctx });

        const mapped = (json.photos ?? []).map(mapEdgePhoto);
        setPhotos(mapped);
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
          }}>{ctx?.label || 'Shared photos'}</h1>
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
