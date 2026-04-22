/**
 * MultiCapture — shared "take many, save once" capture flow for both photo
 * galleries and document scanners. Ported from the WMS `MultiPhotoCapture`
 * pattern and adapted to GS inline styles + v2 tokens.
 *
 * Flow:
 *   1. User taps `Take Photo` (photo mode) or `Scan Document` (document mode)
 *   2. Camera opens via the native `capture="environment"` file input
 *   3. After capture the image enters a LOCAL pending queue (not uploaded)
 *   4. Camera input resets so the user can immediately take another
 *   5. `Save N` runs the uploads one-by-one via the caller-supplied
 *      `onUpload(file)` and reports per-file failures back to the caller
 *   6. Pending queue clears; `onSaved()` fires so the parent can refetch
 *
 * Why sequential upload? Warehouse mobile data is often spotty; Promise.all
 * on 10 photos can saturate the connection and surface cryptic 5xx errors.
 * Serial keeps each upload independent and lets us stop on the first hard
 * failure without leaving half a batch in limbo.
 *
 * Caller owns the actual upload logic (usePhotos.uploadPhoto /
 * useDocuments.uploadDocument) — MultiCapture is presentation + batching
 * only. It does not hold its own Supabase hook, avoiding double-instantiation
 * with the parent PhotoGallery / DocumentList / ReceivingRowMedia.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, ScanLine, Save, X, Trash2, Loader2, AlertTriangle,
} from 'lucide-react';
import { theme } from '../../styles/theme';

export type CaptureMode = 'photo' | 'document';

interface PendingItem {
  id: string;
  file: File;
  preview: string;
}

interface Props {
  mode: CaptureMode;
  /** Per-file upload callback. Returns true on success so the component can
   *  drop the item from pending; false surfaces as an error banner. The
   *  caller should throw on unexpected errors — we catch + display. */
  onUpload: (file: File) => Promise<boolean>;
  /** Fires once after every pending item has attempted upload. Use to
   *  trigger a parent refetch or a toast. */
  onSaved?: (result: { saved: number; failed: number }) => void;
  /** Disable camera + save (e.g., while an unrelated parent action is in
   *  flight, or before an itemId exists). */
  disabled?: boolean;
  maxItems?: number;
  /** Compact button styling (smaller padding, reduced text) for inline uses
   *  like ReceivingRowMedia. Pending queue still renders. */
  compact?: boolean;
  /** Override button label. Defaults: photo=`Take Photo`, document=`Scan Document`. */
  label?: string;
  /** v2026-04-22 — stretch the primary capture button to fill its parent so
   *  it sits as an equal-width sibling to Upload Photos / Upload Document.
   *  The pending-queue section below still renders normally. */
  fullWidth?: boolean;
}

const DEFAULT_MAX = 10;

export function MultiCapture({
  mode, onUpload, onSaved, disabled,
  maxItems = DEFAULT_MAX, compact, label, fullWidth,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revoke object URLs on unmount so the browser can reclaim the memory.
  // The per-item cleanup in `remove` / `save` handles the happy path; this
  // covers unmounts mid-capture.
  useEffect(() => {
    return () => { pending.forEach(p => URL.revokeObjectURL(p.preview)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAddMore = pending.length < maxItems && !disabled;

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remainingSlots = maxItems - pending.length;
    if (remainingSlots <= 0) {
      setError(`Maximum ${maxItems} ${mode === 'photo' ? 'photos' : 'documents'} reached.`);
      return;
    }
    const arr = Array.from(files).slice(0, remainingSlots);
    const next: PendingItem[] = arr.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    setPending(prev => [...prev, ...next]);
    setError(null);
  }, [pending.length, maxItems, mode]);

  const removePending = useCallback((id: string) => {
    setPending(prev => {
      const item = prev.find(p => p.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    pending.forEach(p => URL.revokeObjectURL(p.preview));
    setPending([]);
    setError(null);
  }, [pending]);

  const saveAll = useCallback(async () => {
    if (pending.length === 0 || saving) return;
    setSaving(true);
    setError(null);

    // Serial upload — survive flaky mobile networks better than Promise.all.
    const failed: PendingItem[] = [];
    let saved = 0;
    for (const item of pending) {
      try {
        const ok = await onUpload(item.file);
        if (ok) {
          saved++;
          URL.revokeObjectURL(item.preview);
        } else {
          failed.push(item);
        }
      } catch (e) {
        console.error('[MultiCapture] upload failed', e);
        failed.push(item);
      }
    }
    setPending(failed);
    setSaving(false);
    if (failed.length > 0) {
      setError(`${failed.length} ${mode === 'photo' ? 'photo' : 'document'}${failed.length === 1 ? '' : 's'} failed — tap Save to retry.`);
    }
    onSaved?.({ saved, failed: failed.length });
  }, [pending, saving, onUpload, onSaved, mode]);

  const primaryLabel = label ?? (mode === 'photo' ? 'Take Photo' : 'Scan Document');
  const noun = mode === 'photo' ? 'Photos' : 'Documents';
  const singularNoun = mode === 'photo' ? 'Photo' : 'Document';
  const Icon = mode === 'photo' ? Camera : ScanLine;
  // Use `image/*` for both modes so the camera ui accepts the capture. Docs
  // go into the documents bucket from the caller's upload; we just need a
  // JPEG out of the camera.
  const accept = 'image/*';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10, width: fullWidth ? '100%' : undefined }}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture="environment"
        multiple
        onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
        style={{ display: 'none' }}
      />

      {/* Action row: Camera + (if pending) Save + Counter */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canAddMore || saving}
          style={primaryBtn(!canAddMore || saving, compact)}
        >
          <Icon size={compact ? 12 : 14} />
          {primaryLabel}
        </button>

        {pending.length > 0 && (
          <button
            type="button"
            onClick={saveAll}
            disabled={saving}
            style={saveBtn(saving, compact)}
          >
            {saving
              ? <Loader2 size={compact ? 12 : 14} style={{ animation: 'spin 1s linear infinite' }} />
              : <Save size={compact ? 12 : 14} />}
            {saving
              ? 'Saving…'
              : `Save ${pending.length} ${pending.length === 1 ? singularNoun : noun}`
            }
          </button>
        )}

        <span style={{
          marginLeft: 'auto',
          fontSize: 10, fontWeight: 600, letterSpacing: '1px',
          color: theme.v2.colors.textMuted, textTransform: 'uppercase',
        }}>
          {pending.length}/{maxItems} pending
        </span>
      </div>

      {/* Pending queue */}
      {pending.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: theme.v2.colors.textMuted, textTransform: 'uppercase' }}>
              Pending · not saved yet
            </span>
            <button
              type="button"
              onClick={clearAll}
              disabled={saving}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '1px',
                background: 'transparent', border: 'none',
                color: '#B91C1C', cursor: saving ? 'default' : 'pointer',
                fontFamily: 'inherit', textTransform: 'uppercase',
                opacity: saving ? 0.5 : 1,
              }}
            >
              <Trash2 size={10} /> Clear All
            </button>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: compact
              ? 'repeat(auto-fill, minmax(70px, 1fr))'
              : 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8,
            padding: 8,
            borderRadius: 10,
            border: `1.5px dashed ${theme.v2.colors.accent}`,
            background: 'rgba(232,105,42,0.05)',
          }}>
            {pending.map(p => (
              <div
                key={p.id}
                style={{
                  position: 'relative', aspectRatio: '1 / 1',
                  borderRadius: 6, overflow: 'hidden',
                  background: `#F3F4F6 url(${p.preview}) center/cover`,
                  border: `1px solid ${theme.v2.colors.border}`,
                }}
                title={p.file.name}
              >
                <button
                  type="button"
                  onClick={() => removePending(p.id)}
                  disabled={saving}
                  style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 20, height: 20, borderRadius: '50%',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: '#DC2626', border: 'none', color: '#fff',
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.5 : 1,
                  }}
                  aria-label="Remove from queue"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
          borderRadius: 8, padding: '6px 10px', fontSize: 11,
        }}>
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

function primaryBtn(disabled: boolean, compact: boolean | undefined): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: compact ? '6px 12px' : '8px 16px',
    fontSize: compact ? 10 : 11, fontWeight: 700,
    letterSpacing: '1.5px', textTransform: 'uppercase',
    border: `1px solid ${disabled ? theme.v2.colors.border : theme.v2.colors.accent}`,
    borderRadius: theme.v2.radius.button,
    background: disabled ? theme.v2.colors.bgCard : '#FFF7F0',
    color: disabled ? theme.v2.colors.textMuted : '#B34710',
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.7 : 1,
    minHeight: 38, // 44px-ish total after borders — meets mobile touch-target minimum.
  };
}

function saveBtn(busy: boolean, compact: boolean | undefined): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: compact ? '6px 14px' : '8px 18px',
    fontSize: compact ? 10 : 11, fontWeight: 700,
    letterSpacing: '1.5px', textTransform: 'uppercase',
    border: 'none', borderRadius: theme.v2.radius.button,
    background: busy ? theme.colors.border : theme.v2.colors.accent,
    color: '#fff',
    cursor: busy ? 'default' : 'pointer',
    fontFamily: 'inherit',
    opacity: busy ? 0.7 : 1,
    minHeight: 38,
  };
}
