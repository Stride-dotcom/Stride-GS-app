/**
 * PhotoGallery — end-to-end photo surface for an entity. Composes usePhotos
 * + PhotoUploadButton + PhotoGrid + PhotoLightbox. Drop it into any detail
 * panel with an `entityType` + `entityId` + `tenantId` and it handles the
 * full lifecycle.
 */
import { useCallback, useMemo, useState } from 'react';
import { ImageIcon, AlertTriangle, Share2, X as XIcon } from 'lucide-react';
import { theme } from '../../styles/theme';
import { usePhotos, type Photo, type EntityType, type PhotoType } from '../../hooks/usePhotos';
import { PhotoGrid } from './PhotoGrid';
import { PhotoUploadButton } from './PhotoUploadButton';
import { PhotoLightbox } from './PhotoLightbox';
import { SharePhotosDialog } from './SharePhotosDialog';
import { EntitySourceTabs } from '../shared/EntitySourceTabs';
import type { PhotoShareHeaderContext } from '../../hooks/usePhotoShares';

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
  /** Snapshot of header fields for the public share gallery. Optional —
   *  when omitted the share still works but the gallery header shows only
   *  generic info (entity ID). Each consumer panel passes whatever it knows
   *  (item details for Item, job details for Shipment/WC etc.). */
  shareContext?: PhotoShareHeaderContext;
  /** Optional title shown in the public gallery header (e.g. "Order 12345 —
   *  Photos for Acme Co"). Defaults to a sensible label per entityType. */
  shareTitle?: string;
  /** Set false to hide the Share button entirely. Defaults to true so every
   *  entity panel that mounts PhotoGallery picks up the feature. */
  enableSharing?: boolean;
}

export function PhotoGallery({
  entityType, entityId, tenantId, itemId,
  defaultPhotoType = 'general',
  readOnly, naked, title = 'Photos', compact,
  enableSourceFilter = false,
  shareContext, shareTitle, enableSharing = true,
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

  // ── Share-selection state ──────────────────────────────────────────────
  // selectionMode: when true, tiles render checkboxes and clicks toggle
  //   selection rather than open the lightbox.
  // selectedIds: which photos the user has picked.
  // shareDialogOpen: when true, mount SharePhotosDialog (which POSTs the
  //   share row and shows the resulting URL).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const toggleSelect = useCallback((p: Photo) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  // Sharing requires a tenant + entity. Without those we can't POST a share
  // row — hide the affordance entirely so the user isn't presented with a
  // button that always errors. (PhotosPanel passes tenantId via its caller.)
  const canShare =
    enableSharing && !readOnly && !!entityId && !!tenantId && photos.length > 0;

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

  const content = (
    <>
      {/* Header + upload + share */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 8 : 12, flexWrap: 'wrap' }}>
        <ImageIcon size={15} color={theme.v2.colors.accent} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100,
          background: theme.v2.colors.bgCard, color: theme.v2.colors.textMuted,
        }}>{photos.length}</span>

        {/* Right-side actions: share + upload. Stack vertically on the
            compact (panel-embedded) layout so each row gets full width. */}
        {(!readOnly || canShare) && (
          <div style={{
            marginLeft: 'auto',
            display: 'flex', gap: 6,
            width: compact ? '100%' : undefined,
            justifyContent: compact ? 'space-between' : 'flex-end',
            flexWrap: 'wrap',
          }}>
            {canShare && !selectionMode && (
              <button
                type="button"
                onClick={enterSelectionMode}
                title="Select photos to share via public link"
                style={shareButtonStyle()}
              >
                <Share2 size={13} /> Share
              </button>
            )}
            {!readOnly && (
              <PhotoUploadButton
                onUpload={handleUpload}
                uploading={uploading}
                disabled={!entityId || selectionMode}
                compact
                onUploadOne={async (file) => {
                  const result = await uploadPhoto(file, defaultPhotoType);
                  return !!result;
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Selection mode bar — replaces the upload affordance with a Share /
          Cancel pair scoped to the picked photos. */}
      {selectionMode && (
        <div
          role="toolbar"
          aria-label="Photo selection"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 10, padding: '8px 10px',
            background: '#FFF7F0',
            border: `1px solid ${theme.v2.colors.accent}`,
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.v2.colors.text }}>
            {selectedIds.size} selected
          </span>
          <span style={{ fontSize: 11, color: theme.v2.colors.textMuted, flex: 1 }}>
            Tap photos to pick what to share
          </span>
          <button
            type="button"
            onClick={exitSelectionMode}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '6px 10px',
              background: 'transparent', color: theme.v2.colors.textSecondary,
              border: `1px solid ${theme.v2.colors.border}`, borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <XIcon size={12} /> Cancel
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setShareDialogOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '6px 12px',
              background: selectedIds.size === 0 ? '#E5E7EB' : theme.v2.colors.accent,
              color: selectedIds.size === 0 ? theme.v2.colors.textMuted : '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 12, fontWeight: 700,
              cursor: selectedIds.size === 0 ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Share2 size={12} /> Share Selected
          </button>
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
          onPhotoClick={(_, i) => setLightboxIndex(i)}
          onToggleAttention={readOnly ? undefined : (p: Photo, next: boolean) => toggleNeedsAttention(p.id, next)}
          onToggleRepair={readOnly ? undefined : (p: Photo, next: boolean) => toggleRepair(p.id, next)}
          onDelete={readOnly ? undefined : (p: Photo) => deletePhoto(p.id)}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      )}

      {/* Lightbox — uses filtered list so arrow navigation respects the active filter.
          Suppressed in selection mode so the click action is unambiguous. */}
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

      {/* Share dialog — POSTs the share row + shows the public URL. Closing
          the dialog clears selection so the user can either start over or
          go back to viewing photos. */}
      {shareDialogOpen && entityId && tenantId && (
        <SharePhotosDialog
          entityType={entityType}
          entityId={entityId}
          tenantId={tenantId}
          photoIds={Array.from(selectedIds)}
          headerContext={shareContext}
          title={shareTitle}
          onClose={() => {
            setShareDialogOpen(false);
            exitSelectionMode();
          }}
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

function shareButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 10px',
    background: '#fff', color: theme.v2.colors.text,
    border: `1px solid ${theme.v2.colors.border}`, borderRadius: 8,
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.12s ease, border-color 0.12s ease',
  };
}
