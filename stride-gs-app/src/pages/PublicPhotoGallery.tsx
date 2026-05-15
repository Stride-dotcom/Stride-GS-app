/**
 * PublicPhotoGallery — no-auth shareable attachment gallery page.
 *
 * Rendered directly from App.tsx when the URL hash matches either of
 *   #/shared/attachments/:shareId   (canonical — photos + docs)
 *   #/shared/photos/:shareId        (legacy alias — photos-only links)
 * Bypasses the auth gate entirely. The page uses the Supabase anon
 * key, which the photo_shares / item_photos / documents / storage
 * RLS policies allow for active, non-expired shares (see migrations
 * 20260426120000_photo_shares.sql + 20260514120000_attachment_shares.sql).
 *
 * Header info is read from photo_shares.entity_context (a snapshot
 * taken at share-creation time) so the public page never needs to
 * query inventory_cache, shipments, dt_orders, etc.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ImageIcon, AlertTriangle, Wrench, Loader2, FileText, Download, Paperclip,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  fetchPublicPhotoShare,
  type PhotoShare,
  type EntityShareContext,
} from '../hooks/usePhotoShares';
import { PhotoGrid } from '../components/media/PhotoGrid';
import { PhotoLightbox } from '../components/media/PhotoLightbox';
import type { Photo } from '../hooks/usePhotos';

const PHOTOS_BUCKET = 'photos';
const SIGNED_URL_TTL = 60 * 60; // 1 hour — page refresh re-mints

interface SharedDoc {
  id: string;
  storage_key: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  page_count: number | null;
  created_at: string;
  uploaded_by_name: string | null;
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface Props {
  shareId: string;
}

export function PublicPhotoGallery({ shareId }: Props) {
  const [share, setShare] = useState<PhotoShare | null | undefined>(undefined); // undefined = loading
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [docs, setDocs] = useState<SharedDoc[]>([]);
  // Loaded flags differentiate "haven't fetched yet" from "fetched and
  // got nothing back" — without these the docs section can show
  // "Loading documents…" forever when anon RLS legitimately returns
  // zero rows (e.g. every referenced doc was soft-deleted).
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [docBusyId, setDocBusyId] = useState<string | null>(null);
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});

  // Fetch the document bytes on demand through the get-shared-doc
  // Edge Function. Anon storage RLS (documents_storage_anon_read_via_share)
  // is not reliably live in prod, so the bytes are served by a
  // service-role proxy whose only gate is the share itself. Any
  // failure surfaces as a real inline error instead of a hung spinner.
  async function openDoc(d: SharedDoc) {
    setDocBusyId(d.id);
    setDocErrors(prev => {
      if (!(d.id in prev)) return prev;
      const next = { ...prev };
      delete next[d.id];
      return next;
    });
    try {
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      if (!base) throw new Error('Document service unavailable');
      const proxyUrl = `${base}/functions/v1/get-shared-doc`
        + `?share_id=${encodeURIComponent(shareId)}`
        + `&doc_id=${encodeURIComponent(d.id)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) {
        let msg = `Document unavailable (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* non-JSON error body — keep status message */ }
        throw new Error(msg);
      }
      const data = await res.blob();
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke late so the opened tab has time to load the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setDocErrors(prev => ({
        ...prev,
        [d.id]: e instanceof Error ? e.message : 'Could not open document',
      }));
    } finally {
      setDocBusyId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setShare(undefined);
    setPhotos([]);
    setDocs([]);
    setPhotosLoaded(false);
    setDocsLoaded(false);
    setError(null);

    (async () => {
      const s = await fetchPublicPhotoShare(shareId);
      if (cancelled) return;
      if (!s) {
        setShare(null);
        return;
      }
      setShare(s);

      // Load photos + docs in parallel. Each side is independent — a
      // failure on one shouldn't blank out the other, so errors are
      // collected and surfaced inline rather than thrown.
      await Promise.all([
        loadPhotos(s, () => cancelled, setPhotos, setError).finally(() => {
          if (!cancelled) setPhotosLoaded(true);
        }),
        loadDocs(s, () => cancelled, setDocs, setError).finally(() => {
          if (!cancelled) setDocsLoaded(true);
        }),
      ]);
    })();

    return () => { cancelled = true; };
  }, [shareId]);

  const ctx: EntityShareContext | null = useMemo(
    () => share?.entityContext ?? null,
    [share],
  );

  const hasPhotos = (share?.photoIds.length ?? 0) > 0;
  const hasDocs   = (share?.docIds.length ?? 0) > 0;
  const headerLabel = hasPhotos && hasDocs ? 'Shared attachments'
    : hasDocs ? 'Shared documents'
    : 'Shared photos';
  const HeaderIcon = hasPhotos && hasDocs ? Paperclip
    : hasDocs ? FileText
    : ImageIcon;

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
            <HeaderIcon size={14} /> {headerLabel}
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

        {hasPhotos && (
          !photosLoaded ? (
            <div style={{
              background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center', color: '#6B7280', fontSize: 13,
            }}>Loading photos…</div>
          ) : photos.length === 0 ? (
            <div style={{
              background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
              padding: '40px 20px', textAlign: 'center', color: '#6B7280', fontSize: 13,
            }}>No photos available.</div>
          ) : (
            <PhotoGrid
              photos={photos}
              onPhotoClick={(_, i) => setLightboxIndex(i)}
            />
          )
        )}

        {hasDocs && (
          <section style={{ marginTop: hasPhotos ? 32 : 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#6B7280',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              marginBottom: 10,
            }}>Documents</div>
            {!docsLoaded ? (
              <div style={{
                background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
                padding: '24px 20px', textAlign: 'center', color: '#6B7280', fontSize: 13,
              }}>Loading documents…</div>
            ) : docs.length === 0 ? (
              <div style={{
                background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
                padding: '24px 20px', textAlign: 'center', color: '#6B7280', fontSize: 13,
              }}>No documents available.</div>
            ) : (
              <ul style={{
                listStyle: 'none', margin: 0, padding: 0,
                background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
                overflow: 'hidden',
              }}>
                {docs.map((d, i) => (
                  <li key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px',
                    borderTop: i === 0 ? 'none' : '1px solid #F3F4F6',
                  }}>
                    <FileText size={20} color="#6B7280" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 600, color: '#1F2937',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{d.file_name || 'Document'}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                        {[
                          d.mime_type,
                          formatBytes(d.file_size),
                          d.page_count ? `${d.page_count} page${d.page_count === 1 ? '' : 's'}` : null,
                        ].filter(Boolean).join(' • ')}
                      </div>
                    </div>
                    <div style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'flex-end', gap: 4, flexShrink: 0,
                    }}>
                      <button
                        type="button"
                        onClick={() => openDoc(d)}
                        disabled={docBusyId === d.id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: '#E85D2D', color: '#fff',
                          padding: '6px 12px', borderRadius: 6,
                          fontSize: 12, fontWeight: 600, border: 'none',
                          cursor: docBusyId === d.id ? 'default' : 'pointer',
                          opacity: docBusyId === d.id ? 0.7 : 1,
                        }}
                      >
                        {docBusyId === d.id ? (
                          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                        ) : (
                          <Download size={13} />
                        )}
                        {docBusyId === d.id ? 'Opening…' : 'Open'}
                      </button>
                      {docErrors[d.id] && (
                        <span role="alert" style={{
                          fontSize: 11, color: '#B91C1C',
                          maxWidth: 220, textAlign: 'right',
                        }}>
                          {docErrors[d.id]}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!hasPhotos && !hasDocs && !error && (
          <div style={{
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
            padding: '40px 20px', textAlign: 'center', color: '#6B7280', fontSize: 13,
          }}>No attachments in this share.</div>
        )}

        <footer style={{
          marginTop: 32, padding: '16px 0',
          fontSize: 11, color: '#9CA3AF', textAlign: 'center',
        }}>
          {hasPhotos && 'Right-click a photo to download. '}Powered by Stride Logistics.
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

// ── Data loaders (extracted so the effect stays readable) ────────────
// Both are no-ops when the share carries an empty id list, which is
// the common case for photos-only or docs-only shares.

async function loadPhotos(
  s: PhotoShare,
  isCancelled: () => boolean,
  setPhotos: (p: Photo[]) => void,
  setError: (e: string | null) => void,
): Promise<void> {
  if (s.photoIds.length === 0) return;
  try {
    // Explicit column list — anon role has SELECT on a narrow subset
    // only (migration 20260426130000). select('*') would 401.
    const { data, error: err } = await supabase
      .from('item_photos')
      .select('id, storage_key, thumbnail_key, file_name, photo_type, needs_attention, is_repair, created_at, uploaded_by_name')
      .in('id', s.photoIds);
    if (isCancelled()) return;
    if (err) { setError(err.message); return; }
    const rows = ((data || []) as Photo[]).slice();
    // Preserve the curator's chosen order — don't shuffle by created_at.
    const orderIdx: Record<string, number> = {};
    s.photoIds.forEach((id, i) => { orderIdx[id] = i; });
    rows.sort((a, b) => (orderIdx[a.id] ?? 0) - (orderIdx[b.id] ?? 0));

    const originalKeys = rows.map(r => r.storage_key).filter(Boolean);
    const thumbKeys = rows.map(r => r.thumbnail_key).filter((k): k is string => !!k);
    const [origSigned, thumbSigned] = await Promise.all([
      originalKeys.length
        ? supabase.storage.from(PHOTOS_BUCKET).createSignedUrls(originalKeys, SIGNED_URL_TTL)
        : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
      thumbKeys.length
        ? supabase.storage.from(PHOTOS_BUCKET).createSignedUrls(thumbKeys, SIGNED_URL_TTL)
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
    if (!isCancelled()) setPhotos(rows);
  } catch (e) {
    if (!isCancelled()) setError(e instanceof Error ? e.message : 'Failed to load photos');
  }
}

async function loadDocs(
  s: PhotoShare,
  isCancelled: () => boolean,
  setDocs: (d: SharedDoc[]) => void,
  setError: (e: string | null) => void,
): Promise<void> {
  if (s.docIds.length === 0) return;
  try {
    // Narrow column set matches the anon GRANT in
    // 20260514120000_attachment_shares.sql.
    const { data, error: err } = await supabase
      .from('documents')
      .select('id, storage_key, file_name, mime_type, file_size, page_count, created_at, uploaded_by_name')
      .in('id', s.docIds);
    if (isCancelled()) return;
    if (err) { setError(err.message); return; }
    const rows = ((data || []) as SharedDoc[]).slice();
    // Preserve the order the share was built with (push-order's
    // chronological list of attachments).
    const orderIdx: Record<string, number> = {};
    s.docIds.forEach((id, i) => { orderIdx[id] = i; });
    rows.sort((a, b) => (orderIdx[a.id] ?? 0) - (orderIdx[b.id] ?? 0));

    // Only metadata is loaded here (anon SELECT on documents via
    // documents_anon_read_via_share, which IS live). The bytes are
    // fetched lazily per-click through the get-shared-doc Edge
    // Function (see openDoc) — anon storage RLS for the documents
    // bucket is not reliably live, so a service-role proxy serves
    // the file with the share as the only authorization gate.
    if (!isCancelled()) setDocs(rows);
  } catch (e) {
    if (!isCancelled()) setError(e instanceof Error ? e.message : 'Failed to load documents');
  }
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
