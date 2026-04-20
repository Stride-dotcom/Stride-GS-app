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
import { useState } from 'react';
import { ChevronDown, ChevronRight, ImageIcon, FileText, StickyNote } from 'lucide-react';
import { theme } from '../../styles/theme';
import { PhotoGallery } from '../media/PhotoGallery';
import { DocumentList } from '../media/DocumentList';
import { DocumentUploadButton } from '../media/DocumentUploadButton';
import { DocumentScanButton } from '../media/DocumentScanButton';
import { NotesSection } from '../notes/NotesSection';
import { usePhotos, type EntityType as PhotoEntityType } from '../../hooks/usePhotos';
import { useDocuments, type DocumentContextType } from '../../hooks/useDocuments';
import { useEntityNotes } from '../../hooks/useEntityNotes';

interface PhotosCfg {
  entityType: PhotoEntityType;
  entityId: string | null | undefined;
  tenantId?: string | null;
}
interface DocumentsCfg {
  contextType: DocumentContextType;
  contextId: string;
  tenantId?: string | null;
}
interface NotesCfg {
  entityType: string;
  entityId: string;
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
  entityType, entityId, tenantId, defaultOpen,
}: PhotosCfg & { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { photos } = usePhotos({ entityType, entityId, tenantId });
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
        <PhotoGallery entityType={entityType} entityId={entityId} tenantId={tenantId} naked compact />
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

function NotesSectionCollapsible({
  entityType, entityId, defaultOpen,
}: NotesCfg & { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
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
        <NotesSection entityType={entityType} entityId={entityId} />
      </CollapsibleBody>
    </section>
  );
}
