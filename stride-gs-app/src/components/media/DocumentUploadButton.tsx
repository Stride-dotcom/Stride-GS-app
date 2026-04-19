/**
 * DocumentUploadButton — file picker for arbitrary documents (PDFs, images,
 * Office files). Orange pill primary + optional compact mode. Hands off the
 * selected files via `onUpload`.
 */
import { useCallback, useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';

const DEFAULT_ACCEPT = [
  'application/pdf',
  'image/*',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
].join(',');

interface Props {
  onUpload: (files: File[]) => void | Promise<void>;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  uploading?: boolean;
  label?: string;
  /** Render compact (no drag-and-drop zone). */
  compact?: boolean;
}

export function DocumentUploadButton({
  onUpload, multiple = true, accept = DEFAULT_ACCEPT,
  disabled, uploading, label = 'Upload Document', compact,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    await onUpload(arr);
  }, [onUpload]);

  const busy = !!uploading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 10 }}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={e => { void handleFiles(e.target.files); e.target.value = ''; }}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 18px', fontSize: 11, fontWeight: 700,
          letterSpacing: '1.5px', textTransform: 'uppercase',
          border: 'none', borderRadius: theme.v2.radius.button,
          background: (busy || disabled) ? theme.colors.border : theme.v2.colors.accent,
          color: '#fff',
          cursor: (busy || disabled) ? 'default' : 'pointer',
          fontFamily: 'inherit',
          opacity: (busy || disabled) ? 0.6 : 1,
          alignSelf: 'flex-start',
        }}
      >
        {busy
          ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          : <FileUp size={14} />}
        {busy ? 'Uploading…' : label}
      </button>

      {!compact && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer?.files ?? null); }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? theme.v2.colors.accent : theme.v2.colors.border}`,
            background: dragOver ? theme.v2.colors.accentLight : theme.v2.colors.bgCard,
            color: theme.v2.colors.textMuted,
            borderRadius: 14, padding: '18px 16px',
            textAlign: 'center', fontSize: 12,
            cursor: (disabled || busy) ? 'default' : 'pointer',
            transition: 'background 0.15s ease, border-color 0.15s ease',
          }}
        >
          <FileUp size={18} style={{ opacity: 0.6, marginBottom: 6 }} />
          <div>Drop files here, or click to browse</div>
          <div style={{ fontSize: 10, marginTop: 3 }}>PDF · DOCX · XLSX · images · CSV</div>
        </div>
      )}
    </div>
  );
}
