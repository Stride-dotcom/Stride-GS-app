/**
 * AttachmentUploadField — single multi-file picker used at the bottom
 * of the order-entry surfaces (CreateDeliveryOrderModal +
 * PublicServiceRequest) so customers can attach photos AND docs in one
 * step before submitting.
 *
 * The component itself never uploads. It collects File objects in
 * controlled-component state (driven by the parent) and lets the
 * parent flush them to Supabase Storage AFTER the dt_order row has
 * been created — at that point a stable order id exists to scope the
 * uploads against. This keeps the upload site at exactly one place
 * per surface and avoids the "draft order id" plumbing that immediate
 * uploads would force.
 *
 * Mime classification:
 *   • image/* → goes into the photos bucket (item_photos table)
 *   • everything else → goes into the documents bucket
 *
 * The classification is exposed via `kindOf(file)` so callers can
 * split the list at upload time without re-running mime checks.
 */
import { useRef } from 'react';
import { Paperclip, Image as ImageIcon, FileText, X, Loader2 } from 'lucide-react';

export type AttachmentKind = 'photo' | 'doc';

export function kindOf(file: File): AttachmentKind {
  return (file.type || '').startsWith('image/') ? 'photo' : 'doc';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  /** Upload progress message shown next to the field when the parent
   *  is mid-upload (e.g. "Uploading 2 of 5…"). Hides the picker so
   *  the user can't add files mid-flush. */
  uploading?: boolean;
  uploadingMessage?: string;
  disabled?: boolean;
  /** Caption shown above the picker. Defaults to a generic prompt;
   *  surfaces can override (e.g. the public form uses different
   *  wording than the staff modal). */
  label?: string;
  /** Help text shown below the picker. */
  helpText?: string;
}

export function AttachmentUploadField({
  files,
  onChange,
  uploading = false,
  uploadingMessage,
  disabled = false,
  label = 'Photos & documents',
  helpText = 'Attach photos of the items or any reference documents (PO, packing list, etc.) — they’ll travel with the order to dispatch and the driver.',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePick = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    const next: File[] = [...files];
    for (const f of Array.from(picked)) {
      // Dedup by (name, size, lastModified) — same browser file picker
      // re-selection shouldn't create duplicate uploads.
      const dup = next.find(x => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified);
      if (!dup) next.push(f);
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRemove = (idx: number) => {
    const next = files.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <section style={{
      border: '1px solid #E5E7EB',
      borderRadius: 10,
      padding: 16,
      background: '#FAFAFA',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 6,
      }}>
        <Paperclip size={16} color="#E85D2D" />
        <h3 style={{
          margin: 0, fontSize: 14, fontWeight: 700, color: '#111827',
        }}>{label}</h3>
        {files.length > 0 && (
          <span style={{
            fontSize: 11, color: '#6B7280', fontWeight: 500,
            background: '#fff', border: '1px solid #E5E7EB',
            borderRadius: 100, padding: '1px 8px',
          }}>{files.length} attached</span>
        )}
      </header>

      <p style={{
        margin: '0 0 12px', fontSize: 12, color: '#6B7280', lineHeight: 1.4,
      }}>{helpText}</p>

      {!uploading ? (
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 8,
          background: disabled ? '#E5E7EB' : '#1F2937',
          color: disabled ? '#9CA3AF' : '#fff',
          fontSize: 13, fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: 'none',
        }}>
          <Paperclip size={14} />
          {files.length === 0 ? 'Choose files' : 'Add more files'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg"
            style={{ display: 'none' }}
            disabled={disabled}
            onChange={(e) => handlePick(e.target.files)}
          />
        </label>
      ) : (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 8,
          background: '#FEF3C7', color: '#92400E',
          fontSize: 13, fontWeight: 600,
        }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          {uploadingMessage || 'Uploading…'}
        </div>
      )}

      {files.length > 0 && (
        <ul style={{
          listStyle: 'none', margin: '12px 0 0', padding: 0,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {files.map((f, i) => {
            const k = kindOf(f);
            const Icon = k === 'photo' ? ImageIcon : FileText;
            return (
              <li key={`${f.name}-${f.size}-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                background: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
              }}>
                <Icon size={16} color={k === 'photo' ? '#E85D2D' : '#6B7280'} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, color: '#1F2937', fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                    {k === 'photo' ? 'Photo' : 'Document'} · {formatBytes(f.size)}
                  </div>
                </div>
                {!uploading && (
                  <button
                    type="button"
                    onClick={() => handleRemove(i)}
                    aria-label={`Remove ${f.name}`}
                    style={{
                      background: 'transparent', border: 'none', padding: 4,
                      borderRadius: 6, color: '#9CA3AF', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center',
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
