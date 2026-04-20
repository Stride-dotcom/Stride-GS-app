/**
 * ReceivingRowMedia — inline media strip for a single Receiving row's
 * expanded section. Compact alternative to PhotoGallery / DocumentList:
 *   - Camera + file upload buttons (no drop-zone)
 *   - 3-column photo strip (thumbnails only)
 *   - Document upload + compact count pill
 *   - One-line note input (Enter to send)
 *
 * Gated on `itemId` because photos/docs/notes attach to `entity_id = itemId`
 * (entity_type='inventory'). Until the user types or auto-assigns an Item
 * ID, the section shows a dashed placeholder — no orphan rows get created.
 */
import { useCallback, useState } from 'react';
import { Upload, FileText, StickyNote, Loader2, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import { usePhotos } from '../../hooks/usePhotos';
import { useDocuments } from '../../hooks/useDocuments';
import { useEntityNotes } from '../../hooks/useEntityNotes';
import { MultiCapture } from './MultiCapture';

interface Props {
  itemId: string;
  tenantId?: string | null;
}

export function ReceivingRowMedia({ itemId, tenantId }: Props) {
  const hasItemId = !!itemId.trim();

  if (!hasItemId) {
    return (
      <div style={placeholderStyle}>
        Enter an Item ID to attach photos, documents, and notes.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PhotoStrip itemId={itemId} tenantId={tenantId} />
      <DocRow itemId={itemId} tenantId={tenantId} />
      <NoteRow itemId={itemId} />
    </div>
  );
}

// ─── Photos ────────────────────────────────────────────────────────────────
function PhotoStrip({ itemId, tenantId }: Props) {
  const { photos, uploadPhoto } = usePhotos({
    entityType: 'inventory', entityId: itemId, tenantId,
  });
  const [uploading, setUploading] = useState(false);

  // Gallery upload path — instant, one-at-a-time, kept intact. Batch
  // camera capture goes through MultiCapture below.
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        await uploadPhoto(f, 'receiving');
      }
    } finally { setUploading(false); }
  }, [uploadPhoto]);

  const handleBatchUpload = useCallback(async (file: File) => {
    const result = await uploadPhoto(file, 'receiving');
    return !!result;
  }, [uploadPhoto]);

  return (
    <div style={blockStyle}>
      <div style={labelStyle}>Photos ({photos.length})</div>
      {/* Batch camera — take many, save once. */}
      <MultiCapture
        mode="photo"
        onUpload={handleBatchUpload}
        compact
        label="Take Photos"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <label style={iconBtn(uploading)} title="Upload photos from files">
          {uploading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
          <input type="file" accept="image/*" multiple onChange={e => { void handleFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
        </label>
        {photos.slice(0, 6).map(p => (
          <div
            key={p.id}
            style={{
              width: 44, height: 44, borderRadius: 6,
              background: `#E5E7EB url(${p.thumbnail_url || p.storage_url || ''}) center/cover`,
              flexShrink: 0,
              // Session 74: primary amber ring removed — "Make Primary" is gone.
              border: p.needs_attention ? '2px solid #DC2626'
                : p.is_repair ? '2px solid #7C3AED'
                : '1px solid rgba(0,0,0,0.08)',
            }}
            title={p.file_name}
          />
        ))}
        {photos.length > 6 && (
          <span style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600 }}>
            +{photos.length - 6}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Documents ─────────────────────────────────────────────────────────────
function DocRow({ itemId, tenantId }: Props) {
  const { documents, uploadDocument } = useDocuments({
    contextType: 'item', contextId: itemId, tenantId,
  });
  const [uploading, setUploading] = useState(false);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) await uploadDocument(f);
    } finally { setUploading(false); }
  }, [uploadDocument]);

  const handleBatchScan = useCallback(async (raw: File) => {
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const renamed = new File([raw], `scan-${ts}.jpg`, { type: raw.type || 'image/jpeg' });
    const result = await uploadDocument(renamed);
    return !!result;
  }, [uploadDocument]);

  return (
    <div style={blockStyle}>
      <div style={labelStyle}>Documents ({documents.length})</div>
      {/* Batch scan — same pattern as photos. */}
      <MultiCapture
        mode="document"
        onUpload={handleBatchScan}
        compact
        label="Scan Docs"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <label style={iconBtn(uploading)} title="Upload BOL, receipt, etc.">
          {uploading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={13} />}
          <input
            type="file"
            accept="application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            onChange={e => { void handleFiles(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }}
          />
        </label>
        {documents.slice(0, 4).map(d => (
          <span key={d.id} style={docChip} title={d.file_name}>
            {d.file_name.length > 22 ? `${d.file_name.slice(0, 22)}…` : d.file_name}
          </span>
        ))}
        {documents.length > 4 && (
          <span style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600 }}>
            +{documents.length - 4}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Notes ─────────────────────────────────────────────────────────────────
function NoteRow({ itemId }: { itemId: string }) {
  const { notes, addNote, deleteNote } = useEntityNotes('inventory', itemId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const result = await addNote(draft, 'public');
      if (result) setDraft('');
    } finally { setSending(false); }
  }, [draft, sending, addNote]);

  return (
    <div style={blockStyle}>
      <div style={labelStyle}>Quick Notes ({notes.length})</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StickyNote size={13} color={theme.colors.textMuted} />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSend(); } }}
          placeholder="Add a quick note (Enter to save)…"
          disabled={sending}
          style={{
            flex: 1, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit',
            border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6, outline: 'none',
            background: '#fff',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 600,
            border: 'none', borderRadius: 6,
            background: draft.trim() && !sending ? theme.colors.orange : theme.colors.border,
            color: '#fff', cursor: draft.trim() && !sending ? 'pointer' : 'default',
            fontFamily: 'inherit',
          }}
        >
          {sending ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : 'Add'}
        </button>
      </div>
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {notes.slice(0, 3).map(n => (
            <div key={n.id} style={noteRow}>
              <span style={{ flex: 1, fontSize: 11, color: theme.colors.text }}>
                {n.body}
              </span>
              <button
                onClick={() => { void deleteNote(n.id); }}
                title="Delete note"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 2, display: 'flex' }}
              ><X size={11} /></button>
            </div>
          ))}
          {notes.length > 3 && (
            <span style={{ fontSize: 10, color: theme.colors.textMuted, fontStyle: 'italic' }}>
              +{notes.length - 3} more (view in detail panel)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const blockStyle: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${theme.colors.borderLight}`,
  borderRadius: 8,
  padding: '8px 10px',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600,
  color: theme.colors.textMuted,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  marginBottom: 6,
};
const placeholderStyle: React.CSSProperties = {
  fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic',
  padding: '8px 10px',
  border: `1px dashed ${theme.colors.borderLight}`,
  borderRadius: 8, textAlign: 'center',
};
const docChip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 8px', fontSize: 11, fontWeight: 500,
  background: '#F3F4F6', color: theme.colors.textSecondary,
  borderRadius: 4, whiteSpace: 'nowrap',
};
const noteRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '4px 8px',
  background: '#FAFBFC', borderRadius: 4,
  border: `1px solid ${theme.colors.borderLight}`,
};
function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 30, height: 30, borderRadius: 6,
    background: theme.colors.orange, color: '#fff',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    flexShrink: 0,
  };
}
