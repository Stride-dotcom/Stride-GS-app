/**
 * PhotoUploadButton — orange pill "Upload Photos" that opens the file picker,
 * plus a drag-and-drop zone below. On mobile the `capture` attribute hints
 * the camera instead of the gallery.
 *
 * Accepts one or more image files; hands them off via `onUpload(files)`.
 * The parent handles the actual upload call; this component just captures
 * the files and renders progress.
 */
import { useCallback, useRef, useState } from 'react';
import { Camera, UploadCloud, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';

interface Props {
  /** Called with the user-selected files. May be invoked multiple times. */
  onUpload: (files: File[]) => void | Promise<void>;
  multiple?: boolean;
  /** MIME types; defaults to images only. */
  accept?: string;
  /** Disable the button (e.g., during a parent-level upload). */
  disabled?: boolean;
  /** Upload-in-progress indicator shown on the primary button. */
  uploading?: boolean;
  /** Optional custom label; defaults to "Upload Photos". */
  label?: string;
  /** Hide the drag-and-drop zone (compact mode). */
  compact?: boolean;
}

export function PhotoUploadButton({
  onUpload, multiple = true, accept = 'image/*',
  disabled, uploading, label = 'Upload Photos', compact,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    await onUpload(arr);
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false);
    void handleFiles(e.dataTransfer?.files ?? null);
  }, [handleFiles]);

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
      <input
        ref={cameraInputRef}
        type="file"
        accept={accept}
        capture="environment"
        onChange={e => { void handleFiles(e.target.files); e.target.value = ''; }}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          style={primaryBtn(busy || !!disabled)}
        >
          {busy
            ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : <UploadCloud size={14} />}
          {busy ? 'Uploading…' : label}
        </button>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled || busy}
          style={ghostBtn(busy || !!disabled)}
          title="Open camera"
        >
          <Camera size={14} /> Camera
        </button>
      </div>

      {!compact && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? theme.v2.colors.accent : theme.v2.colors.border}`,
            background: dragOver ? theme.v2.colors.accentLight : theme.v2.colors.bgCard,
            color: theme.v2.colors.textMuted,
            borderRadius: 14,
            padding: '18px 16px',
            textAlign: 'center',
            fontSize: 12,
            cursor: (disabled || busy) ? 'default' : 'pointer',
            transition: 'background 0.15s ease, border-color 0.15s ease',
          }}
        >
          <UploadCloud size={18} style={{ opacity: 0.6, marginBottom: 6 }} />
          <div>Drop images here, or click to browse</div>
          <div style={{ fontSize: 10, marginTop: 3, color: theme.v2.colors.textMuted }}>
            JPG, PNG, HEIC · up to 25 MB each
          </div>
        </div>
      )}
    </div>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
    border: 'none', borderRadius: theme.v2.radius.button,
    background: disabled ? theme.colors.border : theme.v2.colors.accent,
    color: '#fff',
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
  };
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
    border: `1px solid ${theme.v2.colors.border}`, borderRadius: theme.v2.radius.button,
    background: '#fff', color: theme.v2.colors.textSecondary,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
  };
}
