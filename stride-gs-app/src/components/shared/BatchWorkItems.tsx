/**
 * BatchWorkItems — shared per-item work UI for batch jobs.
 *
 * Drop-in module any batch entity page (repairs, tasks, future types) renders
 * to manage the items inside the batch: each item card carries its own
 * Pending → In Progress → Pass/Fail lifecycle, a notes field, and a photo
 * strip whose uploads are tagged to BOTH the item (item_id) and the batch
 * entity (entity_type + entity_id) — so they surface on the item's detail
 * page rollup AND the batch's Photos tab without double-uploading.
 *
 * Single-item entities render the same component with one card, so staff get
 * a uniform workflow whether a repair/task covers 1 item or 12.
 *
 * Data + writes live in useBatchWorkItems (update_batch_work_item RPC —
 * SECURITY DEFINER, admin/staff gated). Status vocabulary is fixed by the DB
 * CHECK constraint ('Pending' | 'In Progress' | 'Pass' | 'Fail'), which is
 * why this component doesn't take a statusOptions prop.
 *
 * Parent orchestration contract:
 *  - onItemStatusChange fires after every successful per-item write — parents
 *    use it to auto-start the batch (e.g. startRepair) when work begins on an
 *    item of a not-yet-started batch.
 *  - onBatchComplete fires exactly once, on the write that resolves the LAST
 *    item, with the aggregate result ('Pass' when every item passed, 'Fail'
 *    when any failed). Parents call their existing complete flow (billing,
 *    email, PDF) from it — this module never writes parent status itself.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Package, Play, CheckCircle2, XCircle, Camera, Loader2, MapPin, Trash2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { DeepLink } from './DeepLink';
import {
  useBatchWorkItems,
  type BatchEntityType,
  type BatchItemStatus,
  type BatchStatusSummary,
  type BatchWorkItem,
} from '../../hooks/useBatchWorkItems';
import type { Photo } from '../../hooks/usePhotos';

const STATUS_CFG: Record<BatchItemStatus, { bg: string; color: string; label: string }> = {
  'Pending':     { bg: '#F3F4F6', color: '#6B7280', label: 'Pending' },
  'In Progress': { bg: '#EDE9FE', color: '#7C3AED', label: 'In Progress' },
  'Pass':        { bg: '#F0FDF4', color: '#15803D', label: '✓ Pass' },
  'Fail':        { bg: '#FEF2F2', color: '#B91C1C', label: '✗ Fail' },
};

export interface BatchWorkItemsProps {
  entityType: BatchEntityType;
  entityId: string;
  /** Tenant (client spreadsheet ID) the batch belongs to. */
  tenantId: string;
  /** Per-item action buttons + notes + uploads enabled. Parents gate this on
   *  role (admin/staff) and parent status (e.g. not Cancelled/Complete). */
  actionsEnabled: boolean;
  /** Shown under the header when actionsEnabled is false (e.g. "Approve the
   *  quote to begin item work"). Read-only cards still render. */
  disabledReason?: string;
  /** Legacy fallback: parent's single item, rendered as one synthetic card
   *  when the items table has no rows yet (pre-task_items tasks). */
  fallbackItem?: { itemId: string; qty?: number | null } | null;
  /** Extra header control (e.g. the repair panel's Edit Items button). */
  headerAction?: React.ReactNode;
  /** Render slot next to each card's item ID (e.g. ItemIdBadges). */
  renderItemBadges?: (itemId: string) => React.ReactNode;
  onItemStatusChange?: (itemId: string, newStatus: BatchItemStatus, summary: BatchStatusSummary) => void;
  onBatchComplete?: (aggregate: 'Pass' | 'Fail', summary: BatchStatusSummary) => void;
  /** Fires whenever the batch summary recomputes (load, write, realtime) —
   *  parents use it to gate their own manual Complete buttons until every
   *  item has a result. */
  onSummaryChange?: (summary: BatchStatusSummary) => void;
}

function StatusBadge({ status }: { status: BatchItemStatus }) {
  const c = STATUS_CFG[status];
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
      {c.label}
    </span>
  );
}

const actionBtn = (kind: 'start' | 'pass' | 'fail', disabled: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  border: `1px solid ${kind === 'pass' ? '#BBF7D0' : kind === 'fail' ? '#FECACA' : theme.colors.borderDefault}`,
  background: kind === 'pass' ? '#F0FDF4' : kind === 'fail' ? '#FEF2F2' : '#fff',
  color: kind === 'pass' ? '#15803D' : kind === 'fail' ? '#B91C1C' : theme.colors.textPrimary,
});

function ItemPhotoStrip({
  itemId, photos, canUpload, uploading, onUpload, onDelete,
}: {
  itemId: string;
  photos: Photo[];
  canUpload: boolean;
  uploading: boolean;
  onUpload: (itemId: string, file: File) => void;
  onDelete: (photoId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {photos.map(p => (
        <div key={p.id} style={{ position: 'relative' }}>
          <a href={p.storage_url || undefined} target="_blank" rel="noopener noreferrer" title={p.file_name}>
            <img
              src={p.thumbnail_url || p.storage_url || undefined}
              alt={p.file_name}
              style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: `1px solid ${theme.colors.border}`, display: 'block' }}
            />
          </a>
          {canUpload && (
            <button
              onClick={() => { if (window.confirm('Delete this photo?')) onDelete(p.id); }}
              title="Delete photo"
              style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: 'none', background: '#fff', boxShadow: '0 0 0 1px ' + theme.colors.border, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
            >
              <Trash2 size={10} color="#B91C1C" />
            </button>
          )}
        </div>
      ))}
      {canUpload && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              const files = Array.from(e.target.files || []);
              files.forEach(f => onUpload(itemId, f));
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Add photos — tagged to this item and the batch"
            style={{ width: 52, height: 52, borderRadius: 6, border: `1px dashed ${theme.colors.borderDefault}`, background: theme.colors.bgCard, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'default' : 'pointer', color: theme.colors.textMuted }}
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          </button>
        </>
      )}
    </div>
  );
}

function ItemCard({
  item, tenantId, actionsEnabled, busy, photos, uploadingItemId,
  onStatus, onSaveNotes, onUpload, onDeletePhoto, renderItemBadges,
}: {
  item: BatchWorkItem;
  tenantId: string;
  actionsEnabled: boolean;
  busy: boolean;
  photos: Photo[];
  uploadingItemId: string | null;
  onStatus: (itemId: string, status: BatchItemStatus) => void;
  onSaveNotes: (itemId: string, notes: string) => void;
  onUpload: (itemId: string, file: File) => void;
  onDeletePhoto: (photoId: string) => void;
  renderItemBadges?: (itemId: string) => React.ReactNode;
}) {
  const [notesDraft, setNotesDraft] = useState(item.notes);
  // Re-sync the draft if a realtime refetch changes the stored notes and the
  // user isn't mid-edit (cheap heuristic: drafts only diverge while focused).
  const [editing, setEditing] = useState(false);
  React.useEffect(() => { if (!editing) setNotesDraft(item.notes); }, [item.notes, editing]);

  const terminal = item.status === 'Pass' || item.status === 'Fail';
  const disabled = !actionsEnabled || busy;

  return (
    <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, fontWeight: 600 }}>
            <DeepLink kind="inventory" id={item.itemId} clientSheetId={tenantId} />
            {renderItemBadges?.(item.itemId)}
            {item.qty > 1 && <span style={{ fontSize: 11, color: theme.colors.textMuted }}>× {item.qty}</span>}
            {item.location && (
              <span title="Warehouse location" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1D4ED8', fontSize: 10, fontWeight: 600 }}>
                <MapPin size={10} /> {item.location}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: theme.colors.textMuted, flexWrap: 'wrap' }}>
            {item.vendor && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Vendor:</strong> {item.vendor}</span>}
            {item.sidemark && <span><strong style={{ color: theme.colors.text, fontWeight: 600 }}>Sidemark:</strong> {item.sidemark}</span>}
          </div>
          {item.description && <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{item.description}</div>}
        </div>
        <StatusBadge status={item.status} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {!terminal && item.status !== 'In Progress' && (
          <button style={actionBtn('start', disabled)} disabled={disabled} onClick={() => onStatus(item.itemId, 'In Progress')}>
            <Play size={12} /> Start
          </button>
        )}
        {!terminal && (
          <>
            <button style={actionBtn('pass', disabled)} disabled={disabled} onClick={() => onStatus(item.itemId, 'Pass')}>
              <CheckCircle2 size={12} /> Pass
            </button>
            <button style={actionBtn('fail', disabled)} disabled={disabled} onClick={() => onStatus(item.itemId, 'Fail')}>
              <XCircle size={12} /> Fail
            </button>
          </>
        )}
        {terminal && item.completedAt && (
          <span style={{ fontSize: 10, color: theme.colors.textMuted }}>
            Resolved {new Date(item.completedAt).toLocaleString()}
          </span>
        )}
      </div>

      {(actionsEnabled || item.notes) && (
        <textarea
          value={notesDraft}
          readOnly={!actionsEnabled}
          placeholder="Item notes…"
          onFocus={() => setEditing(true)}
          onChange={e => setNotesDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (notesDraft !== item.notes) onSaveNotes(item.itemId, notesDraft);
          }}
          rows={2}
          style={{ width: '100%', marginTop: 8, padding: '6px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, outline: 'none', fontFamily: 'inherit', resize: 'vertical', background: actionsEnabled ? '#fff' : theme.colors.bgSubtle, boxSizing: 'border-box' }}
        />
      )}

      <ItemPhotoStrip
        itemId={item.itemId}
        photos={photos}
        canUpload={actionsEnabled}
        uploading={uploadingItemId === item.itemId}
        onUpload={onUpload}
        onDelete={onDeletePhoto}
      />
    </div>
  );
}

export function BatchWorkItems({
  entityType, entityId, tenantId, actionsEnabled, disabledReason,
  fallbackItem, headerAction, renderItemBadges,
  onItemStatusChange, onBatchComplete, onSummaryChange,
}: BatchWorkItemsProps) {
  const {
    items, loading, error, batchStatus,
    updateItemStatus, updateItemNotes, photosByItem, uploadPhoto, deletePhoto,
  } = useBatchWorkItems({ entityType, entityId, tenantId, fallbackItem });

  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Keep the parent's view of batch progress current — ref'd callback so a
  // parent passing a fresh closure each render doesn't loop the effect.
  const onSummaryChangeRef = useRef(onSummaryChange);
  onSummaryChangeRef.current = onSummaryChange;
  useEffect(() => { onSummaryChangeRef.current?.(batchStatus); }, [batchStatus]);

  const handleStatus = async (itemId: string, status: BatchItemStatus) => {
    if (busyItemId) return;
    setBusyItemId(itemId);
    const wasComplete = batchStatus.isAllComplete;
    try {
      const summary = await updateItemStatus(itemId, status);
      if (!summary) return; // hook surfaced the error + rolled back
      onItemStatusChange?.(itemId, status, summary);
      // Fire batch completion exactly once: on the write that resolved the
      // last open item. A batch already complete on mount never re-fires.
      if (summary.isAllComplete && !wasComplete) {
        onBatchComplete?.(summary.anyFail ? 'Fail' : 'Pass', summary);
      }
    } finally {
      setBusyItemId(null);
    }
  };

  const handleUpload = async (itemId: string, file: File) => {
    setUploadError(null);
    setUploadingItemId(itemId);
    try {
      const photo = await uploadPhoto(itemId, file);
      if (!photo) setUploadError('Photo upload failed — please retry.');
    } finally {
      setUploadingItemId(null);
    }
  };

  const progressPct = batchStatus.total > 0 ? Math.round((batchStatus.done / batchStatus.total) * 100) : 0;

  return (
    <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Package size={14} color={theme.colors.orange} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            Items{batchStatus.total > 0 ? ` — ${batchStatus.done} of ${batchStatus.total} complete` : ''}
          </span>
          {batchStatus.anyFail && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 10, background: '#FEF2F2', color: '#B91C1C' }}>
              {batchStatus.failed} failed
            </span>
          )}
        </div>
        {headerAction}
      </div>

      {batchStatus.total > 1 && (
        <div style={{ height: 4, borderRadius: 2, background: theme.colors.border, marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, borderRadius: 2, background: batchStatus.anyFail ? '#B91C1C' : '#15803D', transition: 'width 0.25s ease' }} />
        </div>
      )}

      {!actionsEnabled && disabledReason && (
        <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 10 }}>{disabledReason}</div>
      )}
      {(error || uploadError) && (
        <div style={{ fontSize: 11, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '6px 10px', marginBottom: 10 }}>
          {error || uploadError}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>Loading items…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>No items on this {entityType}.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(it => (
            <ItemCard
              key={it.itemId}
              item={it}
              tenantId={tenantId}
              actionsEnabled={actionsEnabled}
              busy={busyItemId === it.itemId}
              photos={photosByItem.get(it.itemId) || []}
              uploadingItemId={uploadingItemId}
              onStatus={handleStatus}
              onSaveNotes={(id, notes) => void updateItemNotes(id, notes)}
              onUpload={handleUpload}
              onDeletePhoto={id => void deletePhoto(id)}
              renderItemBadges={renderItemBadges}
            />
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 10 }}>
        Per-item results are informational — billing stays on the {entityType} as a whole.
        Photos added here also appear on each item's detail page.
      </div>
    </div>
  );
}
