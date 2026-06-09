/**
 * DocumentList — tabular list of documents for an entity. Each row shows
 * filename (click → opens signed URL in a new tab), size, upload date, and
 * uploader. Staff/admin see a Delete (soft) button.
 *
 * Uses useDocuments internally when no `documents` prop is supplied, or
 * accepts a pre-fetched list for composition inside a parent that already
 * owns the hook.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, File as FileIcon, Trash2, ExternalLink, Download, Loader2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { fmtDateTime } from '../../lib/constants';
import { useDocuments, type DocumentContextType, type DocumentRow, type UseDocumentsResult } from '../../hooks/useDocuments';
import { DocumentPreviewModal } from './DocumentPreviewModal';

interface Props {
  contextType: DocumentContextType;
  contextId: string | null | undefined;
  tenantId?: string | null;
  /** Hide the delete button even for admins. */
  readOnly?: boolean;
  /** Compact row styling (for side panels). */
  compact?: boolean;
  /** Optional parent-owned `useDocuments` result. When supplied, DocumentList
   *  renders from it instead of spinning up its OWN second hook instance.
   *  This avoids the dual-instance desync where a parent that hosts both the
   *  upload action (its own useDocuments) and this list (a separate
   *  useDocuments) only updates the uploader's instance: both instances open a
   *  Supabase Realtime channel with the SAME topic name (`documents_<ctx>_<id>`),
   *  they collide, and the list's instance never receives the change event —
   *  so an uploaded doc shows in a header count but never in the list. Passing
   *  the parent's single instance here makes the optimistic insert + explicit
   *  refetch flow straight into the list with no Realtime round-trip. The
   *  internal hook is disabled (`enabled:false`) so there's no duplicate
   *  fetch/subscription. */
  source?: UseDocumentsResult;
}

function iconFor(mime: string | null | undefined) {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon size={14} />;
  if (m.includes('pdf')) return <FileText size={14} />;
  return <FileIcon size={14} />;
}

/** Row thumbnail. Image docs show the actual image (signed URL); PDF docs
 *  render their first page to a small bitmap via pdf.js (lazy-loaded — the lib
 *  is a separate chunk that only loads when a PDF row mounts); everything else
 *  shows the type icon. One signed-URL fetch per image/PDF row (documents live
 *  in a private bucket). Falls back to the icon on any render error. */
function DocThumb({ doc, getSignedUrl }: {
  doc: DocumentRow;
  getSignedUrl: (storageKey: string, expiresInSeconds?: number) => Promise<string | null>;
}) {
  const mime = (doc.mime_type || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isPdf = mime.includes('pdf');
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage && !isPdf) return;
    let cancelled = false;
    (async () => {
      const signed = await getSignedUrl(doc.storage_key);
      if (cancelled || !signed) return;
      if (isImage) { setThumb(signed); return; }
      // PDF → render page 1 to a bitmap. pdf.js (+ its worker) load lazily.
      try {
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc =
            (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        }
        const buf = await (await fetch(signed)).arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (96 * 2) / base.width }); // ~96px wide @2x
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        if (cancelled) return;
        setThumb(canvas.toDataURL('image/png'));
        try { pdf.cleanup(); } catch { /* noop */ }
      } catch { /* fall back to the icon */ }
    })();
    return () => { cancelled = true; };
  }, [isImage, isPdf, doc.storage_key, getSignedUrl]);

  const box: React.CSSProperties = {
    width: 40, height: 40, borderRadius: 6, flexShrink: 0,
    border: `1px solid ${theme.v2.colors.border}`,
  };
  if (thumb) {
    // PDFs are portrait — anchor to top so the header/logo shows in the crop.
    return <div style={{ ...box, background: `#F3F4F6 url(${thumb}) center top / cover` }} aria-hidden />;
  }
  return (
    <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.v2.colors.bgCard, color: theme.v2.colors.accent }} aria-hidden>
      {iconFor(doc.mime_type)}
    </div>
  );
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
    return fmtDateTime(iso);
  } catch { return iso; }
}

export function DocumentList({ contextType, contextId, tenantId, readOnly, compact, source }: Props) {
  // Always call the hook (rules of hooks), but disable it when a parent-owned
  // instance is injected via `source` so we don't open a duplicate fetch /
  // Realtime subscription. `source ?? internal` then drives the UI.
  const internal = useDocuments({
    contextType, contextId, tenantId, enabled: !source,
  });
  const { documents, loading, error, getSignedUrl, deleteDocument, refetch } = source ?? internal;
  const [opening, setOpening] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  // Index into `documents` of the doc shown in the inline preview modal (null = closed).
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

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

  const handleDownload = useCallback(async (doc: DocumentRow) => {
    setDownloading(doc.id); setOpenError(null);
    try {
      const url = await getSignedUrl(doc.storage_key);
      if (!url) { setOpenError('Failed to generate signed URL'); return; }
      const resp = await fetch(url);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = doc.file_name || 'document';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setOpenError('Download failed');
    } finally {
      setDownloading(null);
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
              <button
                type="button"
                onClick={() => setPreviewIndex(i)}
                title="Preview"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <DocThumb doc={d} getSignedUrl={getSignedUrl} />
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
              </button>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => handleDownload(d)}
                  disabled={downloading === d.id}
                  style={rowBtn}
                  title="Download"
                >
                  {downloading === d.id
                    ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Download size={12} />}
                </button>
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

      {previewIndex !== null && documents[previewIndex] && (
        <DocumentPreviewModal
          documents={documents}
          startIndex={previewIndex}
          getSignedUrl={getSignedUrl}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}

const rowBtn: React.CSSProperties = {
  width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: '#fff', border: `1px solid ${theme.v2.colors.border}`, borderRadius: 6,
  color: theme.v2.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit',
};
