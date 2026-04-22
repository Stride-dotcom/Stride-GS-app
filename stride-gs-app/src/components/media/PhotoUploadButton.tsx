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
import { UploadCloud, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { MultiCapture } from './MultiCapture';

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
  /** Per-file uploader for batch camera capture. When provided, the
   *  `Camera` button is replaced by `<MultiCapture mode="photo">` so users
   *  can take multiple shots in a row and save them in one batch. Parent
   *  provides this because it owns the usePhotos hook. Callers that only
   *  want the file-picker path can omit this — a quiet no-op (no camera
   *  button rendered at all, since the single-shot camera path was the
   *  regression this replaces). */
  onUploadOne?: (file: File) => Promise<boolean>;
  /** Fires after a batch save completes so the parent can show a toast. */
  onBatchSaved?: (result: { saved: number; failed: number }) => void;
}

export function PhotoUploadButton({
  onUpload, multiple = true, accept = 'image/*',
  disabled, uploading, label = 'Upload Photos', compact,
  onUploadOne, onBatchSaved,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
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

      {/* v2026-04-22 — Upload Photos on the left, Take Photo on the right —
          pill-shaped, auto-width, anchored at opposite edges via
          space-between so they read as two distinct actions rather than a
          stacked list. Wraps to two rows on very narrow viewports. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
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

        {/* Batch camera capture — right-anchored pill. */}
        {onUploadOne && (
          <MultiCapture
            mode="photo"
            onUpload={onUploadOne}
            onSaved={onBatchSaved}
            disabled={disabled || busy}
            compact={compact}
          />
        )}
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

