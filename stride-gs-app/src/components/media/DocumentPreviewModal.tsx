/**
 * DocumentPreviewModal — inline preview of an attached document, so staff can
 * SEE a BOL / packing slip / scan without opening a new tab.
 *
 *   image/*  → <img>           (scans, photos)
 *   pdf      → <iframe>         (browsers render PDFs natively)
 *   other    → icon + Download/Open fallback (DOCX/XLSX have no inline preview)
 *
 * Documents live in a PRIVATE bucket, so we fetch a short-lived signed URL when
 * the active document changes (one call per view — not per row). Prev/next walks
 * the supplied list; Esc / backdrop / X closes. Rendered through a portal to
 * document.body so a transformed ancestor (the slide-in detail panels) can't
 * clip or mis-position the fixed overlay.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { DocumentRow } from '../../hooks/useDocuments';

interface Props {
  documents: DocumentRow[];
  startIndex: number;
  getSignedUrl: (storageKey: string, expiresInSeconds?: number) => Promise<string | null>;
  onClose: () => void;
}

function kindOf(mime: string | null | undefined): 'image' | 'pdf' | 'other' {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.includes('pdf')) return 'pdf';
  return 'other';
}

export function DocumentPreviewModal({ documents, startIndex, getSignedUrl, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const doc = documents[index];
  const kind = kindOf(doc?.mime_type);

  // Fetch a signed URL whenever the active document changes.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setLoading(true); setErr(null); setUrl(null);
    (async () => {
      try {
        const u = await getSignedUrl(doc.storage_key);
        if (cancelled) return;
        if (!u) setErr('Could not generate a preview link.');
        else setUrl(u);
      } catch {
        if (!cancelled) setErr('Could not generate a preview link.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, getSignedUrl]);

  const go = useCallback((delta: number) => {
    setIndex(i => {
      const n = i + delta;
      return (n < 0 || n >= documents.length) ? i : n;
    });
  }, [documents.length]);

  // Keyboard: Esc closes, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go]);

  const handleDownload = useCallback(async () => {
    if (!url || !doc) return;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl; a.download = doc.file_name || 'document';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch { /* swallow — Open-in-new-tab is the fallback */ }
  }, [url, doc]);

  if (!doc) return null;

  return createPortal(
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.82)', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', color: '#fff' }}>
        <FileText size={16} style={{ flexShrink: 0, opacity: 0.85 }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {doc.file_name}
        </div>
        <span style={{ fontSize: 11, opacity: 0.7, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {index + 1} / {documents.length}
        </span>
        {url && (
          <>
            <button onClick={handleDownload} title="Download" style={iconBtn}><Download size={15} /></button>
            <button onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} title="Open in new tab" style={iconBtn}><ExternalLink size={15} /></button>
          </>
        )}
        <button onClick={onClose} title="Close (Esc)" style={iconBtn}><X size={18} /></button>
      </div>

      {/* Body */}
      <div onClick={e => e.stopPropagation()} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 0, padding: '0 8px 16px' }}>
        {documents.length > 1 && (
          <button onClick={() => go(-1)} disabled={index === 0} style={{ ...navBtn, left: 8, opacity: index === 0 ? 0.3 : 1 }} title="Previous">
            <ChevronLeft size={24} />
          </button>
        )}

        {loading ? (
          <div style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Loading preview…
          </div>
        ) : err ? (
          <div style={{ color: '#fff', textAlign: 'center' }}>
            <AlertTriangle size={20} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 13 }}>{err}</div>
          </div>
        ) : kind === 'image' && url ? (
          <img src={url} alt={doc.file_name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff', borderRadius: 6 }} />
        ) : kind === 'pdf' && url ? (
          <iframe title={doc.file_name} src={url} style={{ width: '100%', height: '100%', border: 'none', borderRadius: 6, background: '#fff' }} />
        ) : (
          <div style={{ color: '#fff', textAlign: 'center', maxWidth: 360 }}>
            <FileText size={40} style={{ opacity: 0.7, marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, wordBreak: 'break-word' }}>{doc.file_name}</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 14 }}>This file type can’t be previewed inline.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={handleDownload} disabled={!url} style={ctaBtn}><Download size={14} /> Download</button>
              {url && <button onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} style={ctaBtn}><ExternalLink size={14} /> Open</button>}
            </div>
          </div>
        )}

        {documents.length > 1 && (
          <button onClick={() => go(1)} disabled={index === documents.length - 1} style={{ ...navBtn, right: 8, opacity: index === documents.length - 1 ? 0.3 : 1 }} title="Next">
            <ChevronRight size={24} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
  background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', cursor: 'pointer',
};
const navBtn: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  width: 40, height: 40, borderRadius: '50%',
  background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const ctaBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8,
  background: theme.v2.colors.accent, color: '#fff', border: 'none',
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
};
