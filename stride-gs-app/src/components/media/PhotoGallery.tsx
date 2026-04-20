/**
 * PhotoGallery — end-to-end photo surface for an entity. Composes usePhotos
 * + PhotoUploadButton + PhotoGrid + PhotoLightbox. Drop it into any detail
 * panel with an `entityType` + `entityId` + `tenantId` and it handles the
 * full lifecycle.
 */
import { useCallback, useState } from 'react';
import { ImageIcon, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { usePhotos, type Photo, type EntityType, type PhotoType } from '../../hooks/usePhotos';
import { PhotoGrid } from './PhotoGrid';
import { PhotoUploadButton } from './PhotoUploadButton';
import { PhotoLightbox } from './PhotoLightbox';

interface Props {
  entityType: EntityType;
  entityId: string | null | undefined;
  tenantId?: string | null;
  /** Photo type applied to all uploads from this gallery. Default 'general'. */
  defaultPhotoType?: PhotoType;
  /** Hide upload + action controls (for viewers without write permission). */
  readOnly?: boolean;
  /** Hide the outer card chrome — when the parent already provides it. */
  naked?: boolean;
  title?: string;
  compact?: boolean;
}

export function PhotoGallery({
  entityType, entityId, tenantId,
  defaultPhotoType = 'general',
  readOnly, naked, title = 'Photos', compact,
}: Props) {
  // Session 74: `setPrimaryPhoto` is still exported by usePhotos for
  // interface compatibility but no longer consumed here — the "Make
  // Primary" feature was removed from the UI.
  const {
    photos, loading, error,
    uploadPhoto, toggleNeedsAttention, toggleRepair, deletePhoto,
  } = usePhotos({ entityType, entityId, tenantId });
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true); setUploadError(null);
    try {
      for (const f of files) {
        const result = await uploadPhoto(f, defaultPhotoType);
        if (!result) {
          setUploadError('Some photos failed to upload.');
          break;
        }
      }
    } finally {
      setUploading(false);
    }
  }, [uploadPhoto, defaultPhotoType]);

  const content = (
    <>
      {/* Header + upload */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 8 : 12, flexWrap: 'wrap' }}>
        <ImageIcon size={15} color={theme.v2.colors.accent} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100,
          background: theme.v2.colors.bgCard, color: theme.v2.colors.textMuted,
        }}>{photos.length}</span>
        {!readOnly && (
          <div style={{ marginLeft: 'auto' }}>
            <PhotoUploadButton
              onUpload={handleUpload}
              uploading={uploading}
              disabled={!entityId}
              compact
            />
          </div>
        )}
      </div>

      {/* Error banners */}
      {(uploadError || error) && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
          borderRadius: 8, padding: '6px 10px', fontSize: 11, marginBottom: 10,
        }}>
          <AlertTriangle size={12} /> {uploadError || error}
        </div>
      )}

      {/* Grid */}
      {loading && photos.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: theme.v2.colors.textMuted, fontSize: 12 }}>
          Loading photos…
        </div>
      ) : (
        <PhotoGrid
          photos={photos}
          compact={compact}
          onPhotoClick={(_, i) => setLightboxIndex(i)}
          onToggleAttention={readOnly ? undefined : (p: Photo, next: boolean) => toggleNeedsAttention(p.id, next)}
          onToggleRepair={readOnly ? undefined : (p: Photo, next: boolean) => toggleRepair(p.id, next)}
          onDelete={readOnly ? undefined : (p: Photo) => deletePhoto(p.id)}
        />
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxIndex}
          readOnly={readOnly}
          onClose={() => setLightboxIndex(null)}
          onToggleAttention={(p: Photo, next: boolean) => toggleNeedsAttention(p.id, next)}
          onToggleRepair={(p: Photo, next: boolean) => toggleRepair(p.id, next)}
          onDelete={(p: Photo) => deletePhoto(p.id)}
        />
      )}
    </>
  );

  if (naked) return <div>{content}</div>;

  return (
    <div style={{
      background: '#fff', border: `1px solid ${theme.v2.colors.border}`,
      borderRadius: theme.v2.radius.card,
      padding: compact ? '12px 14px' : '16px 18px',
    }}>
      {content}
    </div>
  );
}
