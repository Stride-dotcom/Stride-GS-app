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
import { ChevronDown, ChevronRight, ImageIcon, FileText, StickyNote } from 'lucide-react';
import { theme } from '../../styles/theme';
import { PhotoGallery } from '../media/PhotoGallery';
import { DocumentList } from '../media/DocumentList';
import { DocumentUploadButton } from '../media/DocumentUploadButton';
import { DocumentScanButton } from '../media/DocumentScanButton';
// NotesSection is still the flat conversation renderer — ThreadedNotes
// wraps it and adds the pill-based thread switcher. We only import the
// ThreadedNotes composition here; the flat one is a transitive dep.
import { ThreadedNotes } from '../notes/ThreadedNotes';
import { NotesSection } from '../notes/NotesSection';
import { usePhotos, type EntityType as PhotoEntityType } from '../../hooks/usePhotos';
import { useDocuments, type DocumentContextType } from '../../hooks/useDocuments';
import { useEntityNotes, useEntityNotesRollup, type EntityNote } from '../../hooks/useEntityNotes';
import { EntitySourceTabs, ENTITY_LABEL } from './EntitySourceTabs';
import type { PhotoShareHeaderContext } from '../../hooks/usePhotoShares';

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
  /** Snapshot of header fields for the public share gallery (item or job
   *  level fields). Each consumer panel passes whatever it knows. Optional. */
  shareContext?: PhotoShareHeaderContext;
  /** Optional title shown in the public gallery (e.g. "Order 12345 — Photos"). */
  shareTitle?: string;
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
          shareContext={photos.shareContext}
          shareTitle={photos.shareTitle}
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
  entityType, entityId, tenantId, itemId, enableSourceFilter,
  shareContext, shareTitle, defaultOpen,
}: PhotosCfg & { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { photos } = usePhotos({ entityType, entityId, tenantId, itemId });
  return (
    <section>
      <SectionHeader
        icon={<ImageIcon size={15} color={theme.colors.orange} />}
        label="Photos"
        count={photos.length}
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
          shareContext={shareContext}
          shareTitle={shareTitle}
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
  const { documents, uploadDocument } = useDocuments({ contextType, contextId, tenantId });
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
          />
          <DocumentList contextType={contextType} contextId={contextId} tenantId={tenantId} />
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
  entityType, entityId, tenantId, itemId, enableSourceFilter,
  shareContext, shareTitle,
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
  /** Snapshot of header fields for the public share gallery. See PhotoGallery. */
  shareContext?: PhotoShareHeaderContext;
  shareTitle?: string;
}) {
  return (
    <PhotoGallery
      entityType={entityType}
      entityId={entityId}
      tenantId={tenantId}
      itemId={itemId}
      enableSourceFilter={enableSourceFilter}
      shareContext={shareContext}
      shareTitle={shareTitle}
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
  const { uploadDocument } = useDocuments({ contextType, contextId, tenantId });
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
        />
      </div>
      <DocumentList contextType={contextType} contextId={contextId} tenantId={tenantId} />
    </div>
  );
}

export function NotesPanel({
  entityType, entityId, relatedEntities, enableSourceFilter, itemId, pinnedNote,
}: {
  entityType: string;
  entityId: string;
  relatedEntities?: Array<{ type: string; id: string; label?: string }>;
  /** v2026-04-22 — opt-in: renders a cross-entity rollup by item_id with
   *  source-entity sub-tabs. When false (default), falls back to the
   *  ThreadedNotes pill switcher so Claim and legacy composition stay
   *  byte-identical. */
  enableSourceFilter?: boolean;
  /** Parent item_id — required when enableSourceFilter=true for the rollup
   *  query. Ignored otherwise. */
  itemId?: string | null;
  /** v2026-04-23 — surface the entity's single-text "XxxNotes" field (which
   *  lives on the Details tab) as a pinned system entry at the top of the
   *  Notes tab so warehouse/admin staff see it in both places. Rendered only
   *  when `text` is non-empty. */
  pinnedNote?: { label: string; text: string | null | undefined };
}) {
  const pinned = pinnedNote && pinnedNote.text && pinnedNote.text.trim()
    ? <PinnedSystemNote label={pinnedNote.label} text={pinnedNote.text} />
    : null;

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
        />
      </div>
    );
  }
  // Heading differentiates the threaded entity_notes system from the
  // single-text "Item Notes" field that lives on the Details tab.
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
      <ThreadedNotes
        entityType={entityType}
        entityId={entityId}
        relatedEntities={relatedEntities}
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
 * NotesRollupView — read view for cross-entity rollup + composer that writes
 * to the primary entity. Loads every entity_notes row with item_id=itemId,
 * shows source sub-tabs (All / Item / Task / Repair / ...), and renders a
 * NotesSection composer at the bottom scoped to the primary entity so a
 * new note always gets its item_id stamped via useEntityNotes.
 */
function NotesRollupView({
  primaryEntityType, primaryEntityId, itemId,
}: {
  primaryEntityType: string;
  primaryEntityId: string;
  itemId: string;
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(n => <RollupNoteRow key={n.id} note={n} />)}
        </div>
      )}

      {/* Composer — always posts to the primary entity. useEntityNotes stamps
          item_id on insert so the rollup above refreshes via its realtime
          channel within ~1s. */}
      <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: 12, marginTop: 4 }}>
        <NotesSection
          entityType={primaryEntityType}
          entityId={primaryEntityId}
          itemId={itemId}
          composerOnly
        />
      </div>
    </div>
  );
}

function RollupNoteRow({ note }: { note: EntityNote }) {
  const sourceLabel = ENTITY_LABEL[note.entityType] ?? note.entityType;
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
          padding: '1px 6px', borderRadius: 10, background: theme.colors.bgSubtle,
          fontWeight: 600, fontSize: 10,
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
  entityType, entityId, relatedEntities, enableSourceFilter, itemId, defaultOpen,
}: NotesCfg & { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // Count reflects only the PRIMARY thread's notes for the header
  // badge — showing a combined cross-thread count would be misleading
  // (other threads' notes are one pill-click away, not "on" this entity).
  const { notes } = useEntityNotes(entityType, entityId);
  return (
    <section>
      <SectionHeader
        icon={<StickyNote size={15} color={theme.colors.orange} />}
        label="Notes"
        count={notes.length}
        open={open}
        onToggle={() => setOpen(o => !o)}
      />
      <CollapsibleBody open={open}>
        {enableSourceFilter && itemId ? (
          // v2026-04-22: rollup view with source-entity sub-tabs + composer
          // that writes to the primary entity. Stamps item_id on insert so
          // the rollup refreshes via realtime.
          <NotesPanel
            entityType={entityType}
            entityId={entityId}
            relatedEntities={relatedEntities}
            enableSourceFilter={true}
            itemId={itemId}
          />
        ) : (
          // Session 74: flat NotesSection replaced by ThreadedNotes. The
          // component renders a pill row for the primary entity + any
          // relatedEntities passed by the parent panel, plus the currently
          // selected thread's notes via the existing NotesSection.
          <ThreadedNotes
            entityType={entityType}
            entityId={entityId}
            relatedEntities={relatedEntities}
          />
        )}
      </CollapsibleBody>
    </section>
  );
}
