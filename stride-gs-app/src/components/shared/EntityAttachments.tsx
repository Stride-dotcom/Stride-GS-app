/**
 * EntityAttachments — drop-in block for any detail panel that composes the
 * three new entity modules (Photos / Documents / Notes) into collapsible,
 * mobile-friendly sections. Every detail panel (Item / Task / Repair / WC /
 * Shipment) mounts this at the bottom of its body so the wiring + styling
 * stays in one place.
 *
 * Mobile-first:
 *   - Large tap-target section headers (min-height 44px)
 *   - Sections render stacked on phones (no horizontal grids)
 *   - PhotoGallery / DocumentList / NotesSection already adapt internally
 *
 * Usage:
 *   <EntityAttachments
 *     photos={{ entityType: 'task', entityId: task.taskId }}
 *     documents={{ contextType: 'task', contextId: task.taskId }}
 *     notes={{ entityType: 'task', entityId: task.taskId }}
 *   />
 * Any of the three blocks can be omitted.
 */
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ImageIcon, FileText, StickyNote, ArrowDownAZ, Package } from 'lucide-react';
import { theme } from '../../styles/theme';
import { PhotoGallery } from '../media/PhotoGallery';
import { DocumentList } from '../media/DocumentList';
import { DocumentUploadButton } from '../media/DocumentUploadButton';
import { DocumentScanButton } from '../media/DocumentScanButton';
// v2026-05-08 — single composer + unified timeline. The ThreadedNotes pill
// switcher is gone; staff kept picking the wrong pill and posting on the
// wrong entity. Composer is now ALWAYS scoped to the host entity (the
// detail panel's primary entity), and the timeline rolls up notes across
// related entities (Item / Task / Repair / WC / Shipment) via the existing
// rollup hooks. Without an item_id rollup, we just render NotesSection
// for the host directly.
import { NotesSection } from '../notes/NotesSection';
import { usePhotos, type EntityType as PhotoEntityType } from '../../hooks/usePhotos';
import { useDocuments, type DocumentContextType } from '../../hooks/useDocuments';
import { useEntityNotes, useEntityNotesRollup, type EntityNote } from '../../hooks/useEntityNotes';
import { useNoteGraphRollup, usePhotoGraphRollup, type RollupContext } from '../../hooks/useGraphRollup';
import { EntitySourceTabs, ENTITY_LABEL } from './EntitySourceTabs';

// v2026-05-08 — entity-type accent colors for the source-of-note badge in the
// rollup timeline. Mirrors the palette used elsewhere (TaskDetailPanel
// TYPE_CFG, ThreadedNotes ENTITY_META) so a "Task" note tag in the Notes
// timeline reads with the same orange that "INSP" gets on the task badge.
const ENTITY_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  inventory: { bg: '#EFF6FF', color: '#1D4ED8' }, // Item — blue
  task:      { bg: '#FEF3EE', color: '#E85D2D' }, // Task — orange
  repair:    { bg: '#FEF3C7', color: '#B45309' }, // Repair — amber
  shipment:  { bg: '#ECFDF5', color: '#0F766E' }, // Shipment — teal
  will_call: { bg: '#FCE7F3', color: '#BE185D' }, // Will Call — pink
  claim:     { bg: '#F5F3FF', color: '#6D28D9' }, // Claim — violet
};

function composerPlaceholderFor(entityType: string): string {
  const label = ENTITY_LABEL[entityType] ?? entityType;
  return `Add ${label} note…`;
}

interface PhotosCfg {
  entityType: PhotoEntityType;
  entityId: string | null | undefined;
  tenantId?: string | null;
  /** v38.93.0 — parent item ID for cross-entity photo rollup. Pass on Task
   *  and Repair detail panels so photos uploaded there also appear on the
   *  Item detail panel's Photos section. */
  itemId?: string | null;
  /** v2026-04-22 — opt-in source-entity sub-tabs (All / Item / Task / Repair...)
   *  when the rollup spans multiple entity_types. Off by default so Claim
   *  and other legacy consumers stay byte-identical. */
  enableSourceFilter?: boolean;
  /** v2026-05-04 — graph rollup context. When provided, the gallery shows
   *  every photo across the entity's neighborhood (linked shipments, will
   *  calls, claim items, etc.). Mutations still target the host (entityType,
   *  entityId). */
  rollupCtx?: RollupContext | null;
}
interface DocumentsCfg {
  contextType: DocumentContextType;
  contextId: string;
  tenantId?: string | null;
}
interface NotesCfg {
  entityType: string;
  entityId: string;
  /** Session 74: extra threads for this panel — e.g. Item panel shows
   *  linked task and repair threads so staff can cross-reference
   *  without leaving the detail view. Optional and deduped against
   *  the primary entity inside ThreadedNotes. */
  relatedEntities?: Array<{ type: string; id: string; label?: string }>;
  /** v2026-04-22 — opt-in cross-entity rollup by item_id with source sub-tabs.
   *  Requires itemId. When false (default), falls back to the ThreadedNotes
   *  pill switcher so Claim stays byte-identical. */
  enableSourceFilter?: boolean;
  /** Parent item_id; ignored unless enableSourceFilter=true. */
  itemId?: string | null;
  /** v2026-05-04 — entity tenant id, stamped on note inserts. Required for
   *  admin/staff posting on a client task; otherwise the row is saved with
   *  NULL tenant_id and disappears from rollup queries. */
  tenantId?: string | null;
  /** v2026-05-04 — graph rollup context. When provided AND
   *  enableSourceFilter is true, the rollup view reads from the multi-scope
   *  graph hook so notes from linked shipments / will calls / claim items
   *  show up too. Composer still writes against the primary entity. */
  rollupCtx?: RollupContext | null;
}

interface Props {
  photos?: PhotosCfg;
  documents?: DocumentsCfg;
  notes?: NotesCfg;
  /** Default open state per section (defaults: photos open, others closed). */
  defaultOpen?: { photos?: boolean; documents?: boolean; notes?: boolean };
}

export function EntityAttachments({ photos, documents, notes, defaultOpen }: Props) {
  return (
    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {photos && (
        <PhotosSection
          // Session 74: collapsed by default — keeps the detail panel
          // compact on open so the item list + action row stay visible.
          // The count badge on the header still shows "N" so the user
          // knows content exists.
          defaultOpen={defaultOpen?.photos ?? false}
          entityType={photos.entityType}
          entityId={photos.entityId}
          tenantId={photos.tenantId}
          itemId={photos.itemId}
          enableSourceFilter={photos.enableSourceFilter}
          rollupCtx={photos.rollupCtx}
        />
      )}
      {documents && (
        <DocumentsSection
          defaultOpen={defaultOpen?.documents ?? false}
          contextType={documents.contextType}
          contextId={documents.contextId}
          tenantId={documents.tenantId}
        />
      )}
      {notes && (
        <NotesSectionCollapsible
          defaultOpen={defaultOpen?.notes ?? false}
          entityType={notes.entityType}
          entityId={notes.entityId}
          relatedEntities={notes.relatedEntities}
          enableSourceFilter={notes.enableSourceFilter}
          itemId={notes.itemId}
          tenantId={notes.tenantId}
          rollupCtx={notes.rollupCtx}
        />
      )}
    </div>
  );
}

// Session 74: shared collapsible wrapper. Previously each section did
// `{open && <div>...</div>}` — unmounting on collapse, mounting on expand,
// with no animation. The new pattern always keeps the body in the DOM
// but clips it with `max-height` + `overflow: hidden` so it animates
// smoothly in and out. Content flows DOWN (normal document flow) —
// expanded content pushes everything below it further down the panel.
function CollapsibleBody({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        overflow: 'hidden',
        maxHeight: open ? 4000 : 0,
        opacity: open ? 1 : 0,
        transition: 'max-height 260ms ease, opacity 180ms ease',
      }}
      aria-hidden={!open}
    >
      <div style={{ padding: open ? '12px 4px 4px' : '0 4px' }}>
        {children}
      </div>
    </div>
  );
}

// ── Section shells ──────────────────────────────────────────────────────

function SectionHeader({
  icon, label, count, open, onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  count: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        minHeight: 44, padding: '10px 14px',
        background: theme.colors.bgSubtle,
        border: `1px solid ${theme.colors.borderLight}`,
        borderRadius: 10,
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      }}
    >
      {open ? <ChevronDown size={14} color={theme.colors.textSecondary} /> : <ChevronRight size={14} color={theme.colors.textSecondary} />}
      {icon}
      <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>{label}</span>
      {count !== null && count > 0 && (
        <span style={{
          marginLeft: 'auto',
          fontSize: 11, fontWeight: 700,
          padding: '2px 9px', borderRadius: 100,
          background: theme.colors.orange, color: '#fff',
          fontVariantNumeric: 'tabular-nums',
        }}>{count}</span>
      )}
    </button>
  );
}

function PhotosSection({
  entityType, entityId, tenantId, itemId, enableSourceFilter, rollupCtx, defaultOpen,
}: PhotosCfg & { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // Header count: when a rollup context is supplied, count reflects the
  // graph rollup; otherwise the host-entity-scoped count. Both hooks are
  // called unconditionally (rules of hooks) but the disabled side bails
  // out without a network round-trip.
  const { photos: hostPhotos } = usePhotos({
    entityType, entityId, tenantId, itemId,
    enabled: !rollupCtx,
  });
  const { photos: rollupPhotos } = usePhotoGraphRollup(
    rollupCtx ?? { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
  const photoCount = rollupCtx ? rollupPhotos.length : hostPhotos.length;
  return (
    <section>
      <SectionHeader
        icon={<ImageIcon size={15} color={theme.colors.orange} />}
        label="Photos"
        count={photoCount}
        open={open}
        onToggle={() => setOpen(o => !o)}
      />
      <CollapsibleBody open={open}>
        <PhotoGallery
          entityType={entityType}
          entityId={entityId}
          tenantId={tenantId}
          itemId={itemId}
          enableSourceFilter={enableSourceFilter}
          rollupCtx={rollupCtx}
          naked
          compact
        />
      </CollapsibleBody>
    </section>
  );
}

function DocumentsSection({
  contextType, contextId, tenantId, defaultOpen,
}: DocumentsCfg & { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // ONE useDocuments instance backs both the upload action AND the list below
  // (passed to DocumentList via `source`). Two separate instances on the same
  // context each open a Realtime channel with the same topic name, collide,
  // and leave the list stale after an upload (see DocumentList `source` prop).
  const docs = useDocuments({ contextType, contextId, tenantId });
  const { documents, uploadDocument } = docs;
  const [uploading, setUploading] = useState(false);
  const handleUpload = async (files: File[]) => {
    setUploading(true);
    try { for (const f of files) { await uploadDocument(f); } }
    finally { setUploading(false); }
  };
  return (
    <section>
      <SectionHeader
        icon={<FileText size={15} color={theme.colors.orange} />}
        label="Documents"
        count={documents.length}
        open={open}
        onToggle={() => setOpen(o => !o)}
      />
      <CollapsibleBody open={open}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <DocumentUploadButton onUpload={handleUpload} uploading={uploading} compact />
          {/* Batch scan — MultiCapture wrapped for document mode. Mounted
              even when collapsed now (for transition smoothness); the
              camera input is lazy-initialized inside DocumentScanButton. */}
          <DocumentScanButton
            contextType={contextType}
            contextId={contextId}
            tenantId={tenantId}
            source={docs}
          />
          <DocumentList contextType={contextType} contextId={contextId} tenantId={tenantId} source={docs} />
        </div>
      </CollapsibleBody>
    </section>
  );
}

// ── Tab-mode sibling components ──────────────────────────────────────────
//
// Session 79 Phase A: export three standalone bodies (no SectionHeader /
// CollapsibleBody wrapper) so the new TabbedDetailPanel shell can render
// them as tab contents. The existing `EntityAttachments` composition above
// is unchanged — the other 5 detail panels (Task / Repair / WillCall /
// Shipment / Claim) still use it and see no difference. Purely additive.

export function PhotosPanel({
  entityType, entityId, tenantId, itemId, enableSourceFilter, relatedEntities, rollupCtx,
}: {
  entityType: PhotoEntityType;
  entityId: string | null | undefined;
  tenantId?: string | null;
  itemId?: string | null;
  /** v2026-04-22 — opt-in: renders a source-entity sub-tab row above the grid
   *  (All / Item / Task / Repair / ...) filtering a cross-entity rollup. Only
   *  the migrated tabbed panels pass this; legacy composition leaves it off
   *  so Claim's UI is byte-identical. */
  enableSourceFilter?: boolean;
  /** Related task / repair / will-call / shipment ids so uploads from a
   *  filtered sub-tab route to the right entity instead of the host item. */
  relatedEntities?: Array<{ type: string; id: string }>;
  /** v2026-05-04 — graph rollup context. See PhotoGallery for semantics. */
  rollupCtx?: RollupContext | null;
}) {
  return (
    <PhotoGallery
      entityType={entityType}
      entityId={entityId}
      tenantId={tenantId}
      itemId={itemId}
      enableSourceFilter={enableSourceFilter}
      relatedEntities={relatedEntities}
      rollupCtx={rollupCtx}
      naked
      compact
    />
  );
}

export function DocumentsPanel({
  contextType, contextId, tenantId,
}: {
  contextType: DocumentContextType;
  contextId: string;
  tenantId?: string | null;
}) {
  // Single useDocuments instance backs the upload action AND the list (via
  // `source`) — avoids the dual-instance Realtime-channel collision that left
  // the list stale after an upload. See DocumentList's `source` prop.
  const docs = useDocuments({ contextType, contextId, tenantId });
  const { uploadDocument } = docs;
  const [uploading, setUploading] = useState(false);
  const handleUpload = async (files: File[]) => {
    setUploading(true);
    try { for (const f of files) { await uploadDocument(f); } }
    finally { setUploading(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* v2026-04-22 — Upload Document on the left, Scan Document on the right
          — pill-shaped, auto-width, anchored at opposite edges via
          space-between so they read as two distinct actions. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <DocumentUploadButton onUpload={handleUpload} uploading={uploading} compact />
        <DocumentScanButton
          contextType={contextType}
          contextId={contextId}
          tenantId={tenantId}
          source={docs}
        />
      </div>
      <DocumentList contextType={contextType} contextId={contextId} tenantId={tenantId} source={docs} />
    </div>
  );
}

export function NotesPanel({
  entityType, entityId, enableSourceFilter, itemId, tenantId, pinnedNote, rollupCtx,
}: {
  entityType: string;
  entityId: string;
  /** v2026-05-08 — accepted for back-compat with TabbedDetailPanel + the
   *  collapsible wrapper, but no longer consumed. The previous ThreadedNotes
   *  pill switcher used these to build extra threads; the unified-timeline
   *  refactor reads from the rollup hooks (item_id / graph) instead, which
   *  pull every related thread automatically. Kept in the type so callers
   *  still compile without churn. */
  relatedEntities?: Array<{ type: string; id: string; label?: string }>;
  /** v2026-04-22 — opt-in: renders a cross-entity rollup by item_id with
   *  source-entity sub-tabs. When false, the panel renders a single-thread
   *  NotesSection scoped to the host entity. */
  enableSourceFilter?: boolean;
  /** Parent item_id — required when enableSourceFilter=true for the rollup
   *  query. Ignored otherwise. */
  itemId?: string | null;
  /** v2026-05-04 — entity tenant id, stamped on note inserts. Required for
   *  admin/staff users so notes don't get NULL tenant_id and disappear
   *  from rollup queries. */
  tenantId?: string | null;
  /** v2026-04-23 — surface the entity's single-text "XxxNotes" field (which
   *  lives on the Details tab) as a pinned system entry at the top of the
   *  Notes tab so warehouse/admin staff see it in both places. Rendered only
   *  when `text` is non-empty. */
  pinnedNote?: { label: string; text: string | null | undefined };
  /** v2026-05-04 — graph rollup context. When provided alongside
   *  enableSourceFilter, the rollup view pulls notes from every linked
   *  entity (shipment / WC / claim items) instead of just item_id matches. */
  rollupCtx?: RollupContext | null;
}) {
  // Graph rollup ctx already carries tenantId; fall back to the explicit
  // prop or null for the legacy paths that don't take ctx.
  const effectiveTenantId = rollupCtx?.tenantId ?? tenantId ?? null;
  const pinned = pinnedNote && pinnedNote.text && pinnedNote.text.trim()
    ? <PinnedSystemNote label={pinnedNote.label} text={pinnedNote.text} />
    : null;

  // Graph rollup wins when both enableSourceFilter and rollupCtx are set —
  // it's a strict superset of the item_id-only rollup.
  if (enableSourceFilter && rollupCtx) {
    return (
      <div>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
          color: theme.colors.textMuted, textTransform: 'uppercase',
          marginBottom: 10,
        }}>
          Threaded Notes
        </div>
        {pinned}
        <NotesGraphRollupView
          primaryEntityType={entityType}
          primaryEntityId={entityId}
          itemId={itemId ?? null}
          tenantId={effectiveTenantId}
          rollupCtx={rollupCtx}
        />
      </div>
    );
  }

  if (enableSourceFilter && itemId) {
    return (
      <div>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
          color: theme.colors.textMuted, textTransform: 'uppercase',
          marginBottom: 10,
        }}>
          Threaded Notes
        </div>
        {pinned}
        <NotesRollupView
          primaryEntityType={entityType}
          primaryEntityId={entityId}
          itemId={itemId}
          tenantId={effectiveTenantId}
        />
      </div>
    );
  }
  // No rollup context (no parent item, or this entity_type doesn't roll up
  // — e.g. will_call / shipment / claim). Render a single-thread NotesSection
  // directly; the composer is locked to the host entity, no pill switcher
  // that could send a note to the wrong place.
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
        color: theme.colors.textMuted, textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        Notes
      </div>
      {pinned}
      <NotesSection
        entityType={entityType}
        entityId={entityId}
        tenantId={effectiveTenantId}
        composerPlaceholder={composerPlaceholderFor(entityType)}
      />
    </div>
  );
}

/** Styled read-only card for the entity's single-text notes field, pinned at
 *  the top of the Notes tab. Distinct visual treatment (orange accent, "Pinned"
 *  label) so it doesn't get confused with a threaded note. */
function PinnedSystemNote({ label, text }: { label: string; text: string }) {
  return (
    <div style={{
      background: '#FFF7F0',
      border: `1px solid ${theme.v2.colors.accent}`,
      borderLeft: `4px solid ${theme.v2.colors.accent}`,
      borderRadius: 10,
      padding: '10px 12px',
      marginBottom: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 4,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: theme.v2.colors.accent,
          background: '#fff', padding: '1px 6px', borderRadius: 4,
          border: `1px solid ${theme.v2.colors.accent}`,
        }}>Pinned</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: theme.v2.colors.text }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 13, color: theme.v2.colors.text, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
        {text}
      </div>
      <div style={{ fontSize: 10, color: theme.v2.colors.textMuted, marginTop: 4, fontStyle: 'italic' }}>
        Shown here + on the Details tab. Edit on the Details tab.
      </div>
    </div>
  );
}

/**
 * v2026-05-14 — Reusable sort + group controls for note rollup views.
 * Returns the sorted/grouped list ready for render. Group toggle is
 * suppressed when fewer than two distinct items contribute notes, so
 * the control only appears when grouping is actually useful.
 */
function useSortedGroupedNotes(notes: EntityNote[]): {
  sortOrder: 'newest' | 'oldest';
  setSortOrder: (v: 'newest' | 'oldest') => void;
  groupByItem: boolean;
  setGroupByItem: (v: boolean) => void;
  canGroupByItem: boolean;
  sortedNotes: EntityNote[];
  groupedNotes: Array<{ key: string; label: string; notes: EntityNote[] }> | null;
} {
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [groupByItem, setGroupByItem] = useState(false);

  const sortedNotes = useMemo(() => {
    const arr = [...notes];
    if (sortOrder === 'newest') {
      arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } else {
      arr.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    return arr;
  }, [notes, sortOrder]);

  const canGroupByItem = useMemo(() => {
    const s = new Set<string>();
    for (const n of sortedNotes) if (n.itemId) s.add(n.itemId);
    return s.size >= 2;
  }, [sortedNotes]);

  const groupedNotes = useMemo(() => {
    if (!groupByItem || !canGroupByItem) return null;
    const byItem = new Map<string, EntityNote[]>();
    const unassigned: EntityNote[] = [];
    const seenOrder: string[] = [];
    for (const n of sortedNotes) {
      if (!n.itemId) { unassigned.push(n); continue; }
      const existing = byItem.get(n.itemId);
      if (existing) existing.push(n);
      else { byItem.set(n.itemId, [n]); seenOrder.push(n.itemId); }
    }
    const groups: Array<{ key: string; label: string; notes: EntityNote[] }> = [];
    for (const iid of seenOrder) {
      const arr = byItem.get(iid);
      if (arr) groups.push({ key: iid, label: iid, notes: arr });
    }
    if (unassigned.length > 0) groups.push({ key: '__unassigned__', label: 'Unassigned', notes: unassigned });
    return groups;
  }, [sortedNotes, groupByItem, canGroupByItem]);

  return { sortOrder, setSortOrder, groupByItem, setGroupByItem, canGroupByItem, sortedNotes, groupedNotes };
}

/**
 * Renders the sort + group control bar. Only renders when there are ≥2 notes
 * (so the controls aren't noise on empty / single-note views).
 */
function NoteSortGroupControls({
  visible, sortOrder, setSortOrder, groupByItem, setGroupByItem, canGroupByItem,
}: {
  visible: boolean;
  sortOrder: 'newest' | 'oldest';
  setSortOrder: (v: 'newest' | 'oldest') => void;
  groupByItem: boolean;
  setGroupByItem: (v: boolean) => void;
  canGroupByItem: boolean;
}) {
  if (!visible) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <label
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, color: theme.v2.colors.textSecondary,
          background: '#fff', border: `1px solid ${theme.v2.colors.border}`,
          borderRadius: 8, padding: '4px 8px',
        }}
      >
        <ArrowDownAZ size={12} />
        <select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value as 'newest' | 'oldest')}
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: 11, fontFamily: 'inherit', color: theme.v2.colors.text,
            cursor: 'pointer',
          }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </label>
      {canGroupByItem && (
        <button
          type="button"
          onClick={() => setGroupByItem(!groupByItem)}
          title={groupByItem ? 'Show one combined timeline' : 'Group notes by item ID'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600,
            color: groupByItem ? '#fff' : theme.v2.colors.textSecondary,
            background: groupByItem ? theme.v2.colors.accent : '#fff',
            border: `1px solid ${groupByItem ? theme.v2.colors.accent : theme.v2.colors.border}`,
            borderRadius: 8, padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Package size={12} /> Group by item
        </button>
      )}
    </div>
  );
}

/**
 * Renders notes as a flat list or a list of per-item groups, depending on
 * which one is provided. Hands the row to RollupNoteRow either way.
 */
function NoteListBody({
  groupedNotes, sortedNotes,
}: {
  groupedNotes: Array<{ key: string; label: string; notes: EntityNote[] }> | null;
  sortedNotes: EntityNote[];
}) {
  if (groupedNotes) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groupedNotes.map(g => (
          <div key={g.key}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 600, color: theme.v2.colors.textSecondary,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              marginBottom: 6,
            }}>
              <Package size={11} />
              <span style={{ fontFamily: 'monospace', textTransform: 'none', letterSpacing: 0, color: theme.v2.colors.text }}>{g.label}</span>
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 99,
                background: theme.v2.colors.bgCard, color: theme.v2.colors.textMuted,
                letterSpacing: 0,
              }}>{g.notes.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.notes.map(n => <RollupNoteRow key={n.id} note={n} />)}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sortedNotes.map(n => <RollupNoteRow key={n.id} note={n} />)}
    </div>
  );
}

/**
 * NotesRollupView — read view for cross-entity rollup + composer that writes
 * to the primary entity. Loads every entity_notes row with item_id=itemId,
 * shows source sub-tabs (All / Item / Task / Repair / ...), and renders a
 * NotesSection composer at the bottom scoped to the primary entity so a
 * new note always gets its item_id stamped via useEntityNotes.
 */
function NotesRollupView({
  primaryEntityType, primaryEntityId, itemId, tenantId,
}: {
  primaryEntityType: string;
  primaryEntityId: string;
  itemId: string;
  tenantId?: string | null;
}) {
  const { notes: rolled, loading: rollupLoading } = useEntityNotesRollup(itemId);
  const [filter, setFilter] = useState<string>('all');

  // Shape into the { entity_type } shape EntitySourceTabs expects.
  const sourceItems = useMemo(
    () => rolled.map(n => ({ entity_type: n.entityType, _note: n })),
    [rolled],
  );
  const visible: EntityNote[] = useMemo(
    () => (filter === 'all' ? rolled : rolled.filter(n => n.entityType === filter)),
    [rolled, filter],
  );
  const sortGroup = useSortedGroupedNotes(visible);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* v2026-04-22b — render even when rolled is empty so the filter
          affordance is visible before any note is posted. Matches Photos tab. */}
      {true && (
        <EntitySourceTabs
          items={sourceItems}
          activeType={filter}
          onChange={setFilter}
          variant="note"
        />
      )}

      <NoteSortGroupControls
        visible={visible.length >= 2}
        sortOrder={sortGroup.sortOrder}
        setSortOrder={sortGroup.setSortOrder}
        groupByItem={sortGroup.groupByItem}
        setGroupByItem={sortGroup.setGroupByItem}
        canGroupByItem={sortGroup.canGroupByItem}
      />

      {rollupLoading && rolled.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '12px 0' }}>
          Loading notes…
        </div>
      ) : visible.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '12px 0', fontStyle: 'italic' }}>
          {filter === 'all'
            ? 'No notes on this item yet.'
            : `No ${ENTITY_LABEL[filter] ?? filter} notes for this item.`}
        </div>
      ) : (
        <NoteListBody groupedNotes={sortGroup.groupedNotes} sortedNotes={sortGroup.sortedNotes} />
      )}

      {/* Composer — always posts to the primary entity. useEntityNotes stamps
          item_id on insert so the rollup above refreshes via its realtime
          channel within ~1s. */}
      <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: 12, marginTop: 4 }}>
        <NotesSection
          entityType={primaryEntityType}
          entityId={primaryEntityId}
          itemId={itemId}
          tenantId={tenantId}
          composerOnly
          composerPlaceholder={composerPlaceholderFor(primaryEntityType)}
        />
      </div>
    </div>
  );
}

/**
 * NotesGraphRollupView — graph-aware version of NotesRollupView. Reads via
 * useNoteGraphRollup so notes from linked shipments / will calls / claim
 * items roll up alongside the item-centric notes. Composer still writes
 * against the primary entity (whatever panel hosts this view), so the
 * `entity_notes` row's (entity_type, entity_id, item_id) stamping stays
 * authoritative for the host.
 */
function NotesGraphRollupView({
  primaryEntityType, primaryEntityId, itemId, tenantId, rollupCtx,
}: {
  primaryEntityType: string;
  primaryEntityId: string;
  itemId: string | null;
  tenantId?: string | null;
  rollupCtx: RollupContext;
}) {
  const { notes: rolled, loading: rollupLoading } = useNoteGraphRollup(rollupCtx);
  const [filter, setFilter] = useState<string>('all');

  const sourceItems = useMemo(
    () => rolled.map(n => ({ entity_type: n.entityType, _note: n })),
    [rolled],
  );
  const visible: EntityNote[] = useMemo(
    () => (filter === 'all' ? rolled : rolled.filter(n => n.entityType === filter)),
    [rolled, filter],
  );
  const sortGroup = useSortedGroupedNotes(visible);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <EntitySourceTabs
        items={sourceItems}
        activeType={filter}
        onChange={setFilter}
        variant="note"
      />

      <NoteSortGroupControls
        visible={visible.length >= 2}
        sortOrder={sortGroup.sortOrder}
        setSortOrder={sortGroup.setSortOrder}
        groupByItem={sortGroup.groupByItem}
        setGroupByItem={sortGroup.setGroupByItem}
        canGroupByItem={sortGroup.canGroupByItem}
      />

      {rollupLoading && rolled.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '12px 0' }}>
          Loading notes…
        </div>
      ) : visible.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '12px 0', fontStyle: 'italic' }}>
          {filter === 'all'
            ? 'No related notes yet.'
            : `No ${ENTITY_LABEL[filter] ?? filter} notes here.`}
        </div>
      ) : (
        <NoteListBody groupedNotes={sortGroup.groupedNotes} sortedNotes={sortGroup.sortedNotes} />
      )}

      <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: 12, marginTop: 4 }}>
        <NotesSection
          entityType={primaryEntityType}
          entityId={primaryEntityId}
          itemId={itemId ?? undefined}
          tenantId={tenantId}
          composerOnly
          composerPlaceholder={composerPlaceholderFor(primaryEntityType)}
        />
      </div>
    </div>
  );
}

function RollupNoteRow({ note }: { note: EntityNote }) {
  const sourceLabel = ENTITY_LABEL[note.entityType] ?? note.entityType;
  const badgeColor = ENTITY_BADGE_COLORS[note.entityType] ?? { bg: theme.colors.bgSubtle, color: theme.colors.textSecondary };
  const isInternal = note.visibility === 'internal';
  return (
    <div style={{
      padding: 10,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: 8,
      background: isInternal ? '#FFFBEB' : '#FFFFFF',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
        fontSize: 11, color: theme.colors.textMuted,
      }}>
        <span style={{
          padding: '2px 8px', borderRadius: 10,
          background: badgeColor.bg, color: badgeColor.color,
          fontWeight: 700, fontSize: 10, letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>{sourceLabel}</span>
        <span style={{ fontWeight: 600, color: theme.colors.text }}>
          {note.authorName || 'Unknown'}
        </span>
        <span>{new Date(note.createdAt).toLocaleString()}</span>
        {isInternal && (
          <span style={{
            marginLeft: 'auto', padding: '1px 6px', borderRadius: 10,
            background: '#FEF3C7', color: '#92400E', fontWeight: 600, fontSize: 10,
          }}>Internal</span>
        )}
      </div>
      <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
        {note.body}
      </div>
    </div>
  );
}

function NotesSectionCollapsible({
  entityType, entityId, relatedEntities, enableSourceFilter, itemId, tenantId, rollupCtx, defaultOpen,
}: NotesCfg & { defaultOpen: boolean }) {
  const effectiveTenantId = rollupCtx?.tenantId ?? tenantId ?? null;
  const [open, setOpen] = useState(defaultOpen);
  // Count: graph rollup count when rollupCtx is set, else the primary
  // thread's note count. Both hooks are called unconditionally; the
  // disabled side returns empty without a network call.
  const { notes: hostNotes } = useEntityNotes(entityType, entityId);
  const { notes: rolledNotes } = useNoteGraphRollup(
    rollupCtx ?? { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
  const noteCount = rollupCtx ? rolledNotes.length : hostNotes.length;
  return (
    <section>
      <SectionHeader
        icon={<StickyNote size={15} color={theme.colors.orange} />}
        label="Notes"
        count={noteCount}
        open={open}
        onToggle={() => setOpen(o => !o)}
      />
      <CollapsibleBody open={open}>
        {enableSourceFilter && (rollupCtx || itemId) ? (
          // v2026-04-22: rollup view with source-entity sub-tabs + composer
          // that writes to the primary entity. v2026-05-04: when rollupCtx
          // is supplied, the read uses graph rollup (catches container
          // notes too); otherwise falls back to item_id-only rollup.
          <NotesPanel
            entityType={entityType}
            entityId={entityId}
            relatedEntities={relatedEntities}
            enableSourceFilter={true}
            itemId={itemId}
            tenantId={effectiveTenantId}
            rollupCtx={rollupCtx}
          />
        ) : (
          // v2026-05-08 — single composer + single thread, scoped to the host
          // entity. Replaces ThreadedNotes' pill switcher (which let users
          // accidentally post a note on the wrong entity by clicking a
          // related-entity pill before composing).
          <NotesSection
            entityType={entityType}
            entityId={entityId}
            tenantId={effectiveTenantId}
            composerPlaceholder={composerPlaceholderFor(entityType)}
          />
        )}
      </CollapsibleBody>
    </section>
  );
}
