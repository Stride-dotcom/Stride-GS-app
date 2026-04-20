/**
 * DocumentList — tabular list of documents for an entity. Each row shows
 * filename (click → opens signed URL in a new tab), size, upload date, and
 * uploader. Staff/admin see a Delete (soft) button.
 *
 * Uses useDocuments internally when no `documents` prop is supplied, or
 * accepts a pre-fetched list for composition inside a parent that already
 * owns the hook.
 */
import { useCallback, useState } from 'react';
import { FileText, Image as ImageIcon, File as FileIcon, Trash2, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useDocuments, type DocumentContextType, type DocumentRow } from '../../hooks/useDocuments';

interface Props {
  contextType: DocumentContextType;
  contextId: string | null | undefined;
  tenantId?: string | null;
  /** Hide the delete button even for admins. */
  readOnly?: boolean;
  /** Compact row styling (for side panels). */
  compact?: boolean;
}

function iconFor(mime: string | null | undefined) {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon size={14} />;
  if (m.includes('pdf')) return <FileText size={14} />;
  return <FileIcon size={14} />;
}

function fmtBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function DocumentList({ contextType, contextId, tenantId, readOnly, compact }: Props) {
  const { documents, loading, error, getSignedUrl, deleteDocument, refetch } = useDocuments({
    contextType, contextId, tenantId,
  });
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleOpen = useCallback(async (doc: DocumentRow) => {
    setOpening(doc.id); setOpenError(null);
    try {
      const url = await getSignedUrl(doc.storage_key);
      if (!url) { setOpenError('Failed to generate signed URL'); return; }
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setOpening(null);
    }
  }, [getSignedUrl]);

  const handleDelete = useCallback(async (doc: DocumentRow) => {
    if (!window.confirm(`Delete "${doc.file_name}"? This can be restored by an admin.`)) return;
    setDeleting(doc.id);
    try {
      const ok = await deleteDocument(doc.id);
      if (ok) await refetch();
    } finally { setDeleting(null); }
  }, [deleteDocument, refetch]);

  const rowPadding = compact ? '8px 10px' : '10px 14px';

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${theme.v2.colors.border}`,
      borderRadius: theme.v2.radius.table,
      overflow: 'hidden',
    }}>
      {(error || openError) && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#FEF2F2', borderBottom: '1px solid #FCA5A5', color: '#B91C1C',
          padding: '6px 12px', fontSize: 11,
        }}>
          <AlertTriangle size={12} /> {error || openError}
        </div>
      )}

      {loading && documents.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: theme.v2.colors.textMuted, fontSize: 12 }}>
          Loading documents…
        </div>
      ) : documents.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: theme.v2.colors.textMuted, fontSize: 12 }}>
          No documents attached yet.
        </div>
      ) : (
        <div>
          {documents.map((d, i) => (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: rowPadding,
                borderBottom: i < documents.length - 1 ? `1px solid ${theme.v2.colors.border}` : 'none',
              }}
            >
              <div style={{ color: theme.v2.colors.accent, display: 'flex', flexShrink: 0 }}>
                {iconFor(d.mime_type)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, color: theme.v2.colors.text,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {d.file_name}
                </div>
                <div style={{ fontSize: 10, color: theme.v2.colors.textMuted, marginTop: 2 }}>
                  {fmtBytes(d.file_size)} · {fmtDate(d.created_at)}
                  {d.uploaded_by_name && <> · {d.uploaded_by_name}</>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => handleOpen(d)}
                  disabled={opening === d.id}
                  style={rowBtn}
                  title="Open in new tab"
                >
                  {opening === d.id
                    ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    : <ExternalLink size={12} />}
                </button>
                {!readOnly && (
                  <button
                    onClick={() => handleDelete(d)}
                    disabled={deleting === d.id}
                    style={{ ...rowBtn, color: '#DC2626' }}
                    title="Delete"
                  >
                    {deleting === d.id
                      ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      : <Trash2 size={12} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const rowBtn: React.CSSProperties = {
  width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: '#fff', border: `1px solid ${theme.v2.colors.border}`, borderRadius: 6,
  color: theme.v2.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit',
};
