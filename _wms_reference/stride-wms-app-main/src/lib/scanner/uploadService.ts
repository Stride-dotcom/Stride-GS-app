/**
 * Document Upload Service
 * Handles uploading scanned documents to Supabase storage
 */

import { supabase } from '@/integrations/supabase/client';
import { logActivity, type ActivityEntityType } from '@/lib/activity/logActivity';
import type {
  DocumentContext,
  DocumentContextType,
  ScanOutput,
  OcrResult,
  UploadProgress,
  Document,
} from './types';

export interface UploadOptions {
  fileName?: string;
  label?: string;
  notes?: string;
  isSensitive?: boolean;
  enableOcr?: boolean;
  /** Overrides stored mime_type + storage contentType (defaults to application/pdf) */
  mimeType?: string;
}

export interface UploadResult {
  documentId: string;
  storageKey: string;
  publicUrl?: string;
}

function toActivityEntityType(contextType: DocumentContextType): ActivityEntityType | null {
  if (contextType === 'item') return 'item';
  if (contextType === 'shipment') return 'shipment';
  if (contextType === 'task') return 'task';
  return null;
}

/**
 * Generate storage path for document
 */
function generateStoragePath(
  tenantId: string,
  contextType: DocumentContextType,
  contextId: string | null,
  fileName: string
): string {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  
  if (contextId) {
    return `${tenantId}/${contextType}/${contextId}/${timestamp}_${sanitizedFileName}`;
  }
  return `${tenantId}/${contextType}/general/${timestamp}_${sanitizedFileName}`;
}

/**
 * Extract context ID and type from DocumentContext
 */
function parseContext(context: DocumentContext): {
  type: DocumentContextType;
  id: string | null
} {
  switch (context.type) {
    case 'shipment':
      return { type: 'shipment', id: context.shipmentId };
    case 'quote':
      return { type: 'quote', id: context.quoteId };
    case 'employee':
      return { type: 'employee', id: context.employeeId };
    case 'delivery':
      return { type: 'delivery', id: context.deliveryId };
    case 'invoice':
      return { type: 'invoice', id: context.vendorId ?? null };
    case 'item':
      return { type: 'item', id: context.itemId };
    case 'task':
      return { type: 'task', id: context.taskId };
    case 'general':
      return { type: 'general', id: null };
    default:
      return { type: 'general', id: null };
  }
}

/**
 * Get current user's tenant ID
 */
async function getCurrentTenantId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  const { data: userData, error } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();
  
  if (error || !userData) {
    throw new Error('Failed to get tenant ID');
  }
  
  return userData.tenant_id;
}

/**
 * Upload document to storage and create database record
 */
export async function uploadDocument(
  scanOutput: ScanOutput,
  context: DocumentContext,
  ocrResult: OcrResult | null,
  options: UploadOptions = {},
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const { type: contextType, id: contextId } = parseContext(context);
  
  // Get tenant ID
  onProgress?.({ stage: 'preparing', percentage: 0 });
  const tenantId = await getCurrentTenantId();
  
  // Get current user ID
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  // Generate file name
  const fileName = options.fileName || `scan_${Date.now()}.pdf`;
  const storageKey = generateStoragePath(tenantId, contextType, contextId, fileName);
  
  const mimeType = options.mimeType || 'application/pdf';

  // Get the file blob (PDF for scans, but may be other types for uploads)
  let fileBlob: Blob;
  if (scanOutput.pdfBlob) {
    fileBlob = scanOutput.pdfBlob;
  } else if (scanOutput.pdfUri) {
    // Fetch blob from URI
    const response = await fetch(scanOutput.pdfUri);
    fileBlob = await response.blob();
  } else {
    throw new Error('No file data available');
  }
  
  // Upload to storage
  onProgress?.({ 
    stage: 'uploading', 
    percentage: 25,
    totalBytes: fileBlob.size 
  });
  
  const { error: uploadError } = await supabase.storage
    .from('documents-private')
    .upload(storageKey, fileBlob, {
      contentType: mimeType,
      upsert: false,
    });
  
  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    throw new Error(`Failed to upload document: ${uploadError.message}`);
  }
  
  // Create database record
  onProgress?.({ stage: 'saving', percentage: 75 });
  
  // Generate label from context if not provided
  let label = options.label;
  if (!label) {
    switch (context.type) {
      case 'shipment':
        label = context.vendor ? `Shipment - ${context.vendor}` : 'Shipment Document';
        break;
      case 'quote':
        label = context.quoteNumber ? `Quote ${context.quoteNumber}` : 'Quote Document';
        break;
      case 'employee':
        label = context.employeeName ? `${context.employeeName} Document` : 'Employee Document';
        break;
      case 'item':
        label = context.description ? `Item - ${context.description}` : 'Item Document';
        break;
      case 'invoice':
        label = context.invoiceNumber ? `Invoice ${context.invoiceNumber}` : 'Invoice';
        break;
      case 'delivery':
        label = 'Delivery Document';
        break;
      case 'general':
        label = context.label || 'General Document';
        break;
    }
  }
  
  const documentData = {
    tenant_id: tenantId,
    context_type: contextType as string,
    context_id: contextId,
    file_name: fileName,
    storage_key: storageKey,
    file_size: fileBlob.size,
    page_count: scanOutput.pageCount,
    mime_type: mimeType,
    ocr_text: ocrResult?.fullText || null,
    ocr_pages: ocrResult?.pages ? JSON.parse(JSON.stringify(ocrResult.pages)) : null,
    ocr_status: ocrResult ? 'completed' : 'skipped',
    label,
    notes: options.notes || null,
    is_sensitive: options.isSensitive ?? (contextType === 'employee'),
    created_by: user.id,
  };
  
  // Create document record via Edge Function (preferred).
  // Fallback to direct insert if the function isn't deployed / errors out.
  let createdDocumentId: string | null = null;
  try {
    const { data: createData, error: createError } = await supabase.functions.invoke(
      'create-document',
      {
        body: {
          context_type: documentData.context_type,
          context_id: documentData.context_id,
          file_name: documentData.file_name,
          storage_key: documentData.storage_key,
          file_size: documentData.file_size,
          page_count: documentData.page_count,
          mime_type: documentData.mime_type,
          ocr_text: documentData.ocr_text,
          ocr_pages: documentData.ocr_pages,
          ocr_status: documentData.ocr_status,
          label: documentData.label,
          notes: documentData.notes,
          is_sensitive: documentData.is_sensitive,
        },
      }
    );

    if (!createError && createData?.ok && createData?.document?.id) {
      createdDocumentId = createData.document.id as string;
    } else {
      // Edge function returned an error response; fall back to direct insert below.
      console.warn('[uploadDocument] create-document failed, falling back to direct insert:', createError || createData);
    }
  } catch (invokeErr) {
    // Function may not exist on older projects (404), or may be temporarily unavailable.
    console.warn('[uploadDocument] create-document invoke threw, falling back to direct insert:', invokeErr);
  }

  if (!createdDocumentId) {
    const { data: directDoc, error: directErr } = await (supabase.from('documents') as any)
      .insert(documentData)
      .select('id')
      .single();

    if (directErr || !directDoc?.id) {
      // Try to clean up the uploaded file
      await supabase.storage.from('documents-private').remove([storageKey]);
      console.error('[uploadDocument] direct documents insert error:', directErr);
      const message = directErr?.message || 'Failed to create document record';
      throw new Error(`Failed to save document record: ${message}`);
    }

    createdDocumentId = directDoc.id as string;
  }
  
  onProgress?.({ stage: 'complete', percentage: 100 });

  // Activity log (best-effort). This is intentionally non-blocking and should
  // never break uploads if activity tables / RLS aren't configured.
  try {
    const docId = createdDocumentId as string;
    if (contextType === 'item' && contextId) {
      void logActivity({
        entityType: 'item',
        tenantId,
        entityId: contextId,
        actorUserId: user.id,
        eventType: 'item_document_added',
        eventLabel: `Document uploaded: ${label || fileName}`,
        details: {
          document_id: docId,
          mime_type: mimeType,
          document: { storage_key: storageKey, file_name: fileName, label: label || null },
        },
      });
    } else if (contextType === 'shipment' && contextId) {
      void logActivity({
        entityType: 'shipment',
        tenantId,
        entityId: contextId,
        actorUserId: user.id,
        eventType: 'document_added',
        eventLabel: `Document uploaded: ${label || fileName}`,
        details: {
          document_id: docId,
          mime_type: mimeType,
          document: { storage_key: storageKey, file_name: fileName, label: label || null },
        },
      });
    } else if (contextType === 'task' && contextId) {
      void logActivity({
        entityType: 'task',
        tenantId,
        entityId: contextId,
        actorUserId: user.id,
        eventType: 'document_added',
        eventLabel: `Document uploaded: ${label || fileName}`,
        details: {
          document_id: docId,
          mime_type: mimeType,
          document: { storage_key: storageKey, file_name: fileName, label: label || null },
        },
      });
    }
  } catch {
    // ignore
  }
  
  return {
    documentId: createdDocumentId,
    storageKey,
  };
}

/**
 * Get a signed URL for viewing a document
 */
export async function getDocumentSignedUrl(
  storageKey: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('documents-private')
    .createSignedUrl(storageKey, expiresIn);
  
  if (error) {
    throw new Error(`Failed to get signed URL: ${error.message}`);
  }
  
  // Handle case where signedUrl is a relative path
  let signedUrl = data.signedUrl;
  if (signedUrl.startsWith('/')) {
    // Get Supabase URL and construct full URL
    const supabaseUrl = (supabase as any).supabaseUrl || 
      (supabase as any).storageUrl?.replace('/storage/v1', '') ||
      import.meta.env.VITE_SUPABASE_URL;
    if (supabaseUrl) {
      signedUrl = `${supabaseUrl}/storage/v1${signedUrl}`;
    }
  }
  
  return signedUrl;
}

/**
 * Delete a document (soft delete)
 */
export async function deleteDocument(documentId: string): Promise<void> {
  // Fetch document metadata for activity logging
  let doc: {
    id: string;
    tenant_id: string;
    context_type: string;
    context_id: string | null;
    file_name: string;
    label: string | null;
    storage_key: string;
  } | null = null;

  try {
    const { data } = await supabase
      .from('documents')
      .select('id, tenant_id, context_type, context_id, file_name, label, storage_key')
      .eq('id', documentId)
      .single();
    doc = (data as any) || null;
  } catch {
    // Continue; deletion still proceeds
  }

  const { error } = await supabase
    .from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', documentId);
  
  if (error) {
    throw new Error(`Failed to delete document: ${error.message}`);
  }

  // Activity logging for supported entity types
  try {
    if (!doc?.tenant_id || !doc.context_id) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;

    const contextType = doc.context_type as DocumentContextType;
    const entityType = toActivityEntityType(contextType);
    if (!entityType) return;

    void logActivity({
      entityType,
      tenantId: doc.tenant_id,
      entityId: doc.context_id,
      actorUserId: userId,
      eventType: 'document_removed',
      eventLabel: `Document removed: ${doc.file_name}`,
      details: {
        document_id: doc.id,
        file_name: doc.file_name,
        label: doc.label,
        storage_key: doc.storage_key,
      },
    });
  } catch {
    // Ignore activity logging errors
  }
}

/**
 * Permanently delete a document and its storage file
 */
export async function permanentlyDeleteDocument(
  documentId: string,
  storageKey: string
): Promise<void> {
  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from('documents-private')
    .remove([storageKey]);
  
  if (storageError) {
    console.warn('Failed to delete storage file:', storageError);
  }
  
  // Delete from database
  const { error: dbError } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId);
  
  if (dbError) {
    throw new Error(`Failed to delete document record: ${dbError.message}`);
  }
}
