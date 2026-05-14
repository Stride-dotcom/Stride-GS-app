/**
 * uploadOrderAttachments — one-shot upload helper called from order-
 * entry surfaces (CreateDeliveryOrderModal + PublicServiceRequest)
 * after the parent dt_order row has been created.
 *
 * Mirrors what usePhotos.uploadPhoto + useDocuments.uploadDocument do,
 * but as a free function so it can run AFTER order create without
 * having to stand up two hooks bound to a not-yet-existing entityId.
 *
 * The standard Supabase client is used as-is: when called from the
 * staff modal it carries the operator's JWT and RLS evaluates as
 * authenticated; when called from the anonymous public form the
 * anon role applies, gated by the `*_anon_insert_public_form`
 * policies added in 20260514150000_order_attachments_anon_writes.sql.
 *
 * Best-effort: each file is independent, a failure on one file does
 * not abort the rest. Returns a summary the caller can surface as a
 * toast / inline notice.
 */
import { supabase } from './supabase';

const PHOTOS_BUCKET = 'photos';
const DOCS_BUCKET   = 'documents';

function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);
}

function sanitizeTenantForPath(tenantId: string | null): string {
  // Public-form orders carry null tenant. A literal "public" segment
  // is what the storage anon-insert policy keys off — keep this in
  // lock-step with the policy's path-prefix check.
  if (!tenantId) return 'public';
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function sanitizeEntityForPath(entityId: string): string {
  return entityId.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function kindOf(file: File): 'photo' | 'doc' {
  return (file.type || '').startsWith('image/') ? 'photo' : 'doc';
}

export interface UploadOrderAttachmentsResult {
  uploaded: number;
  failed: number;
  errors: string[];
}

export interface UploadOrderAttachmentsOpts {
  orderId: string;
  /** Null is allowed for public-form orders. */
  tenantId: string | null;
  /** Display name for `uploaded_by_name`. The submitter's email for
   *  the public form, the operator's email for the staff modal. */
  uploaderName: string | null;
  files: File[];
  /** Optional progress callback fired after each file completes
   *  (success or fail). Lets the parent show "Uploading 2 of 5…". */
  onProgress?: (done: number, total: number) => void;
}

export async function uploadOrderAttachments({
  orderId, tenantId, uploaderName, files, onProgress,
}: UploadOrderAttachmentsOpts): Promise<UploadOrderAttachmentsResult> {
  const result: UploadOrderAttachmentsResult = { uploaded: 0, failed: 0, errors: [] };
  if (files.length === 0) return result;

  // Truncate the display name field. uploaded_by_name is purely a
  // label rendered in the Photos / Documents tab — not an identity
  // check — but an abuse path could shove kilobytes of junk into the
  // column if we passed it through verbatim. 200 chars fits any real
  // email + display name combo.
  const safeUploaderName = uploaderName ? uploaderName.slice(0, 200) : null;

  const safeTenant = sanitizeTenantForPath(tenantId);
  const safeOrder  = sanitizeEntityForPath(orderId);
  const basePath   = `${safeTenant}/dt_order-${safeOrder}`;

  let done = 0;
  for (const file of files) {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safeName = sanitizeName(file.name || (kindOf(file) === 'photo' ? `photo-${ts}.jpg` : `document-${ts}`));
    const storageKey = `${basePath}/${ts}-${rand}-${safeName}`;
    const bucket = kindOf(file) === 'photo' ? PHOTOS_BUCKET : DOCS_BUCKET;

    try {
      const { error: upErr } = await supabase.storage.from(bucket).upload(storageKey, file, {
        contentType: file.type || (kindOf(file) === 'photo' ? 'image/jpeg' : 'application/octet-stream'),
        upsert: false,
      });
      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

      if (kindOf(file) === 'photo') {
        // No thumbnail generation here — keeps the helper synchronous
        // and dependency-free. The OrderPage Photos tab handles thumbs
        // for inventory photos; dt_order attachments tend to be small
        // enough that the public viewer signs the original URL anyway.
        const { error: insErr } = await supabase.from('item_photos').insert({
          tenant_id:        tenantId,
          entity_type:      'dt_order',
          entity_id:        orderId,
          item_id:          null,
          storage_key:      storageKey,
          file_name:        file.name,
          file_size:        file.size,
          mime_type:        file.type || 'image/jpeg',
          is_primary:       false,
          needs_attention:  false,
          is_repair:        false,
          photo_type:       'general',
          uploaded_by:      null,
          uploaded_by_name: safeUploaderName,
        });
        if (insErr) throw new Error(`item_photos insert failed: ${insErr.message}`);
      } else {
        const { error: insErr } = await supabase.from('documents').insert({
          tenant_id:        tenantId,
          context_type:     'dt_order',
          context_id:       orderId,
          storage_key:      storageKey,
          file_name:        file.name,
          file_size:        file.size,
          mime_type:        file.type || 'application/octet-stream',
          uploaded_by:      null,
          uploaded_by_name: safeUploaderName,
        });
        if (insErr) throw new Error(`documents insert failed: ${insErr.message}`);
      }
      result.uploaded += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(`${file.name}: ${(err as Error).message}`);
      console.warn('[uploadOrderAttachments]', file.name, err);
    } finally {
      done += 1;
      onProgress?.(done, files.length);
    }
  }

  return result;
}
