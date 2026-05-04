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
import { usePhotoGraphRollup, type RollupContext } from '../../hooks/useGraphRollup';

type RelatedEntity = { type: string; id: string };
import { PhotoGrid } from './PhotoGrid';
import { PhotoUploadButton } from './PhotoUploadButton';
import { PhotoLightbox } from './PhotoLightbox';
import { PhotoShareDialog } from './PhotoShareDialog';
import { EntitySourceTabs } from '../shared/EntitySourceTabs';

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
  /** When the source filter selects a sub-tab (e.g. "Repair") that maps to a
   *  related entity, uploads route to that entity instead of the host. Pass
   *  the item's tasks / repairs / will-calls / shipment so the gallery knows
   *  what targets are available. Ambiguous selections (multiple matches)
   *  disable the upload button. */
  relatedEntities?: RelatedEntity[];
  /** v2026-05-04 — graph rollup. When supplied, the displayed photo list is
   *  the multi-scope rollup result (item_ids ∪ entity scopes) instead of the
   *  host-entity-scoped list from usePhotos. Mutations (upload / toggle /
   *  delete) still flow through the host entity's usePhotos hook so they
   *  land in the right (entity_type, entity_id, item_id) bucket; the rollup
   *  picks them up via realtime. Pass null/undefined to keep the legacy
   *  host-only behavior. */
  rollupCtx?: RollupContext | null;
}

export function PhotoGallery({
  entityType, entityId, tenantId, itemId,
  defaultPhotoType = 'general',
  readOnly, naked, title = 'Photos', compact,
  enableSourceFilter = false,
  relatedEntities,
  rollupCtx,
}: Props) {
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  // Session 74: `setPrimaryPhoto` is still exported by usePhotos for
  // interface compatibility but no longer consumed here — the "Make
  // Primary" feature was removed from the UI.
  const useRollup = !!rollupCtx;
  // When a rollup context is supplied, the read view comes from the rollup
  // hook; mutations always go through the host hook so the (entity_type,
  // entity_id, item_id) stamping rules in usePhotos.uploadPhoto stay
  // authoritative. Realtime in the rollup hook picks the change up.
  // The host hook is disabled in rollup mode — its mutation functions still
  // work (they don't depend on `enabled`), but its read query and realtime
  // subscription are skipped to avoid duplicate channels and wasted reads.
  const hostHook = usePhotos({ entityType, entityId, tenantId, itemId, enabled: !useRollup });
  const rollupHook = usePhotoGraphRollup(rollupCtx ?? { tenantId, itemIds: [], scopes: [], enabled: false });
  const photos = useRollup ? rollupHook.photos : hostHook.photos;
  const loading = useRollup ? rollupHook.loading : hostHook.loading;
  const error = (useRollup ? rollupHook.error : null) ?? hostHook.error;
  const { uploadPhoto, toggleNeedsAttention, toggleRepair, deletePhoto } = hostHook;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Share-link selection mode ─────────────────────────────────────────
  // When the user clicks Share, we enter selection mode: tile clicks
  // toggle selection (instead of opening the lightbox), action overlays
  // are suppressed, and a confirm-bar appears with Share / Cancel.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);

  const toggleSelect = useCallback((photoId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  // Sharing requires a tenantId to write the share row, and at least one
  // selected photo. The Share button is only meaningful when there are
  // photos to choose from, hence the `photos.length > 0` gate at render.
  const canShare = !readOnly && !!entityId && !!tenantId;

  // Filtered list respects the source-entity sub-tab. When filtering is
  // disabled or set to 'all', this is the raw photos list (referentially
  // stable so no extra renders).
  const filteredPhotos = useMemo(() => {
    if (!enableSourceFilter || sourceFilter === 'all' || sourceFilter === '') return photos;
    return photos.filter(p => String(p.entity_type ?? '') === sourceFilter);
  }, [photos, enableSourceFilter, sourceFilter]);

  // Resolve the upload target based on the active source-filter sub-tab.
  // - 'all' or filter matching the host entity → upload to the host entity.
  // - any other entity_type → look up matching related entities. If exactly
  //   one, route uploads there; if zero or many, disable the button so the
  //   photo can't land in the wrong place.
  const uploadTarget = useMemo<
    | { kind: 'ok'; override?: { entityType: EntityType; entityId: string } }
    | { kind: 'disabled'; reason: string }
  >(() => {
    if (!enableSourceFilter || sourceFilter === 'all' || sourceFilter === '' || sourceFilter === entityType) {
      return { kind: 'ok' };
    }
    const matches = (relatedEntities ?? []).filter(r => r.type === sourceFilter);
    if (matches.length === 1) {
      return { kind: 'ok', override: { entityType: sourceFilter as EntityType, entityId: matches[0].id } };
    }
    if (matches.length === 0) {
      return { kind: 'disabled', reason: `No ${sourceFilter.replace('_', ' ')} on this item to upload to.` };
    }
    return { kind: 'disabled', reason: `Multiple ${sourceFilter.replace('_', ' ')}s — open the specific record to upload.` };
  }, [enableSourceFilter, sourceFilter, entityType, relatedEntities]);

  const handleUpload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (uploadTarget.kind === 'disabled') { setUploadError(uploadTarget.reason); return; }
    setUploading(true); setUploadError(null);
    try {
      for (const f of files) {
        const result = await uploadPhoto(f, defaultPhotoType, uploadTarget.override);
        if (!result) {
          setUploadError('Some photos failed to upload.');
          break;
        }
      }
    } finally {
      setUploading(false);
    }
  }, [uploadPhoto, defaultPhotoType, uploadTarget]);

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
        {!readOnly && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {canShare && photos.length > 0 && !selectionMode && (
              <button
                type="button"
                onClick={enterSelectionMode}
                title="Share photos via public link"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: '#fff', color: theme.v2.colors.textSecondary,
                  border: `1px solid ${theme.v2.colors.border}`,
                  borderRadius: 8, padding: '5px 10px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <Share2 size={13} /> Share
              </button>
            )}
            <PhotoUploadButton
              onUpload={handleUpload}
              uploading={uploading}
              disabled={!entityId || selectionMode || uploadTarget.kind === 'disabled'}
              disabledReason={uploadTarget.kind === 'disabled' ? uploadTarget.reason : undefined}
              compact
              onUploadOne={async (file) => {
                if (uploadTarget.kind === 'disabled') { setUploadError(uploadTarget.reason); return false; }
                const result = await uploadPhoto(file, defaultPhotoType, uploadTarget.override);
                return !!result;
              }}
            />
          </div>
        )}
      </div>

      {/* Selection-mode action bar — only visible while picking photos. */}
      {selectionMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: `${theme.v2.colors.accent}10`,
          border: `1px solid ${theme.v2.colors.accent}40`,
          borderRadius: 10, padding: '8px 12px', marginBottom: 10,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.v2.colors.text }}>
            {selectedIds.size === 0
              ? 'Tap photos to include in the share link'
              : `${selectedIds.size} photo${selectedIds.size === 1 ? '' : 's'} selected`}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={exitSelectionMode}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: '#fff', color: theme.v2.colors.textSecondary,
                border: `1px solid ${theme.v2.colors.border}`,
                borderRadius: 8, padding: '5px 10px',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <X size={12} /> Cancel
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              disabled={selectedIds.size === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: theme.v2.colors.accent, color: '#fff',
                border: 'none', borderRadius: 8, padding: '5px 12px',
                fontSize: 12, fontWeight: 600,
                cursor: selectedIds.size === 0 ? 'default' : 'pointer',
                opacity: selectedIds.size === 0 ? 0.5 : 1,
                fontFamily: 'inherit',
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
          Suppressed in selection mode so a tile click only toggles the picker. */}
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

      {/* Share dialog — only renders when the user has confirmed a selection.
          Closing it via Done leaves selection mode (the picker has already
          done its job). Closing via X / backdrop just dismisses the modal so
          the user can adjust their picks. */}
      {shareOpen && entityId && tenantId && (
        <PhotoShareDialog
          entityType={entityType}
          entityId={entityId}
          tenantId={tenantId}
          photoIds={Array.from(selectedIds)}
          onClose={() => {
            setShareOpen(false);
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
