/**
 * PhotoGallery — end-to-end photo surface for an entity. Composes usePhotos
 * + PhotoUploadButton + PhotoGrid + PhotoLightbox. Drop it into any detail
 * panel with an `entityType` + `entityId` + `tenantId` and it handles the
 * full lifecycle.
 */
import { useCallback, useMemo, useState } from 'react';
import { ImageIcon, AlertTriangle, Share2, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import { usePhotos, type Photo, type EntityType, type PhotoType } from '../../hooks/usePhotos';
import { PhotoGrid } from './PhotoGrid';
import { PhotoUploadButton } from './PhotoUploadButton';
import { PhotoLightbox } from './PhotoLightbox';
import { PhotoShareDialog } from './PhotoShareDialog';
import { EntitySourceTabs } from '../shared/EntitySourceTabs';
import type { PhotoShareHeader } from '../../hooks/usePhotoShares';

interface Props {
  entityType: EntityType;
  entityId: string | null | undefined;
  tenantId?: string | null;
  /** v38.93.0 — parent item ID for cross-entity photo rollup. */
  itemId?: string | null;
  /** Photo type applied to all uploads from this gallery. Default 'general'. */
  defaultPhotoType?: PhotoType;
  /** Hide upload + action controls (for viewers without write permission). */
  readOnly?: boolean;
  /** Hide the outer card chrome — when the parent already provides it. */
  naked?: boolean;
  title?: string;
  compact?: boolean;
  /** v2026-04-22 — when true, renders EntitySourceTabs above the grid so the
   *  user can filter a cross-entity rollup by source entity_type.
   *  Only meaningful when the returned `photos` span multiple entity_types
   *  (e.g. Item panel with itemId rollup, or Task/Repair panels with item_id
   *  rollup). Default false so legacy callers (Claim) are byte-identical. */
  enableSourceFilter?: boolean;
  /** Snapshot of entity context (vendor/desc/qty/ref or jobId/clientName/date)
   *  captured when the user creates a public share link. Frozen into the
   *  photo_shares row so the public gallery can render rich metadata without
   *  ever querying entity tables. When omitted, sharing is still allowed but
   *  the public page falls back to a generic header. */
  entityHeader?: PhotoShareHeader;
}

export function PhotoGallery({
  entityType, entityId, tenantId, itemId,
  defaultPhotoType = 'general',
  readOnly, naked, title = 'Photos', compact,
  enableSourceFilter = false,
  entityHeader,
}: Props) {
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  // Session 74: `setPrimaryPhoto` is still exported by usePhotos for
  // interface compatibility but no longer consumed here — the "Make
  // Primary" feature was removed from the UI.
  const {
    photos, loading, error,
    uploadPhoto, toggleNeedsAttention, toggleRepair, deletePhoto,
  } = usePhotos({ entityType, entityId, tenantId, itemId });
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Selection mode for the public-share flow. The set is keyed by photo.id
  // so it survives the source-tab filter swap (selected items stay selected
  // even if the active filter would hide them; we surface the count and
  // offer a Clear).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const enterSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(true);
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelect = useCallback((photoId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  // Filtered list respects the source-entity sub-tab. When filtering is
  // disabled or set to 'all', this is the raw photos list (referentially
  // stable so no extra renders).
  const filteredPhotos = useMemo(() => {
    if (!enableSourceFilter || sourceFilter === 'all' || sourceFilter === '') return photos;
    return photos.filter(p => String(p.entity_type ?? '') === sourceFilter);
  }, [photos, enableSourceFilter, sourceFilter]);

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

  const canShare = !readOnly && !!tenantId && !!entityId && photos.length > 0;
  const selectedCount = selectedIds.size;

  const shareInput = useMemo(() => {
    if (!tenantId || !entityId) return null;
    return {
      tenantId,
      entityType,
      entityId,
      photoIds: Array.from(selectedIds),
      header: entityHeader ?? { kind: 'generic' as const },
    };
  }, [tenantId, entityType, entityId, selectedIds, entityHeader]);

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
        {!readOnly && !selectionMode && (
          <div style={{
            marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center',
            width: compact ? '100%' : undefined,
            flexWrap: 'wrap', justifyContent: compact ? 'flex-start' : 'flex-end',
          }}>
            {canShare && (
              <button
                type="button"
                onClick={enterSelection}
                title="Select photos to share via public link"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px',
                  border: `1px solid ${theme.v2.colors.border}`,
                  borderRadius: 8,
                  background: '#fff',
                  color: theme.v2.colors.text,
                  fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <Share2 size={13} /> Share
              </button>
            )}
            <PhotoUploadButton
              onUpload={handleUpload}
              uploading={uploading}
              disabled={!entityId}
              compact
              onUploadOne={async (file) => {
                const result = await uploadPhoto(file, defaultPhotoType);
                return !!result;
              }}
            />
          </div>
        )}
      </div>

      {/* Selection-mode action bar — replaces the upload row while picking
          photos to share. Counts only items currently selected; "Create link"
          is gated on at least one selection. */}
      {selectionMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', marginBottom: 10,
          borderRadius: 10,
          background: `${theme.v2.colors.accent}10`,
          border: `1px solid ${theme.v2.colors.accent}40`,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.v2.colors.text }}>
            {selectedCount === 0
              ? 'Select photos to share'
              : `${selectedCount} selected`}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={exitSelection}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '6px 10px',
                border: `1px solid ${theme.v2.colors.border}`,
                borderRadius: 8,
                background: '#fff',
                color: theme.v2.colors.textSecondary,
                fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <X size={12} /> Cancel
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => setShareDialogOpen(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '6px 12px',
                border: 'none', borderRadius: 8,
                background: selectedCount === 0
                  ? theme.v2.colors.border
                  : theme.v2.colors.accent,
                color: '#fff',
                fontSize: 12, fontWeight: 600,
                cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: selectedCount === 0 ? 0.7 : 1,
              }}
            >
              <Share2 size={12} /> Create link
            </button>
          </div>
        </div>
      )}

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

      {/* Source-entity sub-tabs (v2026-04-22). Opt-in via enableSourceFilter.
          v2026-04-22b — renders even at photos.length=0 so the affordance is
          visible before the user uploads anything (matches the original
          mockup: "All (0) / Item (0) / Task (0) / Repair (0)"). */}
      {enableSourceFilter && (
        <EntitySourceTabs
          items={photos}
          activeType={sourceFilter}
          onChange={setSourceFilter}
          variant="photo"
        />
      )}

      {/* Grid */}
      {loading && filteredPhotos.length === 0 && photos.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: theme.v2.colors.textMuted, fontSize: 12 }}>
          Loading photos…
        </div>
      ) : (
        <PhotoGrid
          photos={filteredPhotos}
          compact={compact}
          onPhotoClick={selectionMode ? undefined : (_, i) => setLightboxIndex(i)}
          onToggleAttention={readOnly ? undefined : (p: Photo, next: boolean) => toggleNeedsAttention(p.id, next)}
          onToggleRepair={readOnly ? undefined : (p: Photo, next: boolean) => toggleRepair(p.id, next)}
          onDelete={readOnly ? undefined : (p: Photo) => deletePhoto(p.id)}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      )}

      {/* Lightbox — uses filtered list so arrow navigation respects the active
          filter. Suppressed in selection mode so a tile click selects instead. */}
      {!selectionMode && lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
        <PhotoLightbox
          photos={filteredPhotos}
          startIndex={lightboxIndex}
          readOnly={readOnly}
          onClose={() => setLightboxIndex(null)}
          onToggleAttention={(p: Photo, next: boolean) => toggleNeedsAttention(p.id, next)}
          onToggleRepair={(p: Photo, next: boolean) => toggleRepair(p.id, next)}
          onDelete={(p: Photo) => deletePhoto(p.id)}
        />
      )}

      {/* Public-share dialog — handles createPhotoShare + shows the URL.
          Closing it leaves the user in selection mode so they can adjust the
          set and create another link if needed; the user explicitly cancels
          via the action bar. */}
      {shareDialogOpen && shareInput && selectedCount > 0 && (
        <PhotoShareDialog
          input={shareInput}
          photoCount={selectedCount}
          onClose={() => setShareDialogOpen(false)}
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
