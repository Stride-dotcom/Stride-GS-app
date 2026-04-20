/**
 * DocumentScanButton — batch document scanner powered by MultiCapture.
 *
 * Previously this was a single-shot camera wrapper. Warehouse workflows
 * almost always need multiple pages (BOL + packing slip + damage photo),
 * so the button now opens MultiCapture in `document` mode: tap "Scan
 * Document" repeatedly to queue pages, then one "Save N Documents" commits
 * them all via useDocuments.uploadDocument.
 *
 * Each scan gets renamed to `scan-YYYY-MM-DD-HH-MM.jpg` before upload so
 * the storage listing is obviously a scan, not a photo or a user-chosen
 * filename.
 *
 * Admins / staff only — camera capture is a warehouse-floor operation.
 */
import { useCallback, useState } from 'react';
import { useDocuments, type DocumentContextType } from '../../hooks/useDocuments';
import { MultiCapture } from './MultiCapture';

interface Props {
  contextType: DocumentContextType;
  contextId: string | null | undefined;
  tenantId?: string | null;
  /** Fires after a batch save completes so the parent can refetch. */
  onScanned?: (result: { saved: number; failed: number }) => void;
  /** Override the button label. Defaults to "Scan Document". */
  label?: string;
  disabled?: boolean;
}

export function DocumentScanButton({
  contextType, contextId, tenantId, onScanned,
  label, disabled,
}: Props) {
  const { uploadDocument } = useDocuments({ contextType, contextId, tenantId });
  const [savedThisSession, setSavedThisSession] = useState(0);

  // Rename each scan so the Supabase listing makes it obvious this came
  // from the in-app scanner, not an uploaded file. MultiCapture supplies
  // raw camera Files so we wrap them here.
  const handleUploadOne = useCallback(async (raw: File) => {
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const renamed = new File([raw], `scan-${ts}.jpg`, {
      type: raw.type || 'image/jpeg',
    });
    const result = await uploadDocument(renamed);
    return !!result;
  }, [uploadDocument]);

  const handleBatchSaved = useCallback((result: { saved: number; failed: number }) => {
    setSavedThisSession(n => n + result.saved);
    onScanned?.(result);
  }, [onScanned]);

  const effectivelyDisabled = disabled || !contextId;

  return (
    <div>
      <MultiCapture
        mode="document"
        onUpload={handleUploadOne}
        onSaved={handleBatchSaved}
        disabled={effectivelyDisabled}
        label={label}
      />
      {savedThisSession > 0 && (
        <div style={{
          marginTop: 8, fontSize: 11, fontWeight: 600,
          color: '#2F6B42',
        }}>
          {savedThisSession} document{savedThisSession === 1 ? '' : 's'} saved this session.
        </div>
      )}
    </div>
  );
}
