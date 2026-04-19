/**
 * DocumentScanButton — placeholder camera-to-PDF scanner. The full scanner
 * (B&W threshold, edge detection, multi-page PDF assembly) is planned for a
 * follow-up session. For now this opens the device camera, captures one
 * photo, and uploads it as a JPEG document attached to the current context.
 *
 * Admins/staff only — scanning is a warehouse-floor operation.
 */
import { useCallback, useRef, useState } from 'react';
import { ScanLine, Loader2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useDocuments, type DocumentContextType } from '../../hooks/useDocuments';

interface Props {
  contextType: DocumentContextType;
  contextId: string | null | undefined;
  tenantId?: string | null;
  /** Fires after a successful scan upload so the parent can refetch. */
  onScanned?: () => void;
  label?: string;
  disabled?: boolean;
}

export function DocumentScanButton({
  contextType, contextId, tenantId, onScanned,
  label = 'Scan Document', disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadDocument } = useDocuments({ contextType, contextId, tenantId });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleCapture = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const raw = files[0];
      // Rename so the Drive/Supabase listing makes it obvious this was a scan.
      const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const renamed = new File([raw], `scan-${ts}.jpg`, { type: raw.type || 'image/jpeg' });
      const result = await uploadDocument(renamed);
      if (!result) {
        setErr('Scan upload failed.');
        return;
      }
      onScanned?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [uploadDocument, onScanned]);

  const effectivelyDisabled = disabled || busy || !contextId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={e => { void handleCapture(e.target.files); e.target.value = ''; }}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={effectivelyDisabled}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', fontSize: 11, fontWeight: 700,
          letterSpacing: '1.5px', textTransform: 'uppercase',
          border: `1px solid ${theme.v2.colors.border}`, borderRadius: theme.v2.radius.button,
          background: '#fff', color: theme.v2.colors.textSecondary,
          cursor: effectivelyDisabled ? 'default' : 'pointer',
          fontFamily: 'inherit',
          opacity: effectivelyDisabled ? 0.55 : 1,
          alignSelf: 'flex-start',
        }}
        title="Open camera and capture a document photo"
      >
        {busy
          ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          : <ScanLine size={14} />}
        {busy ? 'Scanning…' : label}
      </button>
      {err && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
          borderRadius: 6, padding: '4px 8px', fontSize: 11,
        }}>
          <AlertTriangle size={11} /> {err}
        </div>
      )}
    </div>
  );
}
