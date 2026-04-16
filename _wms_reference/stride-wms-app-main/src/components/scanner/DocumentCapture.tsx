/**
 * DocumentCapture Component
 * Full document capture card with thumbnail grid, Scan and Upload buttons
 * Matches the PhotoCapture component layout
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useDocuments } from '@/hooks/useDocuments';
import { useIsMobile } from '@/hooks/use-mobile';
import { DocumentThumbnail } from './DocumentThumbnail';
import { DocumentScanner } from './DocumentScanner';
import { uploadDocument } from '@/lib/scanner/uploadService';
import { fileToDataUrl, resizeImage, createWebScanOutput } from '@/lib/scanner/webScanner';
import type { DocumentContext, Document } from '@/lib/scanner/types';

interface DocumentCaptureProps {
  context: DocumentContext;
  maxDocuments?: number;
  ocrEnabled?: boolean;
  /** If false, hide scan button and scanner modal (upload-only mode). */
  scanEnabled?: boolean;
  /** If false, users can view but cannot add/remove. */
  canEdit?: boolean;
  onDocumentAdded?: (documentId: string) => void;
  onDocumentRemoved?: (documentId: string) => void;
  /** Change this value to trigger an internal refetch without remounting */
  refetchKey?: number;
}

export function DocumentCapture({
  context,
  maxDocuments = 10,
  ocrEnabled = true,
  scanEnabled = true,
  canEdit = true,
  onDocumentAdded,
  onDocumentRemoved,
  refetchKey,
}: DocumentCaptureProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  
  const [scannerOpen, setScannerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Get context type and ID for the hook
  const contextType = context.type;
  const contextId =
    context.type === 'shipment' ? context.shipmentId :
    context.type === 'quote' ? context.quoteId :
    context.type === 'item' ? context.itemId :
    context.type === 'task' ? context.taskId :
    context.type === 'employee' ? context.employeeId :
    context.type === 'delivery' ? context.deliveryId :
    // NOTE: invoice context is historically inconsistent in this codebase.
    // Prefer vendorId if present, otherwise fall back to invoiceNumber.
    context.type === 'invoice' ? (context.vendorId || context.invoiceNumber) :
    undefined;

  const { documents, loading, deleteDocument, refetch } = useDocuments({
    contextType,
    contextId,
  });

  // Refetch when refetchKey changes (without forcing a remount via React key)
  useEffect(() => {
    if (refetchKey !== undefined && refetchKey > 0) {
      void refetch();
    }
  }, [refetchKey, refetch]);

  const handleScanSuccess = useCallback((documentId: string) => {
    setScannerOpen(false);
    refetch();
    onDocumentAdded?.(documentId);
    toast({
      title: 'Document scanned',
      description: 'The document has been saved.',
    });
  }, [refetch, onDocumentAdded, toast]);

  const handleScanError = useCallback((error: Error) => {
    setScannerOpen(false);
    toast({
      title: 'Scan failed',
      description: error.message,
      variant: 'destructive',
    });
  }, [toast]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = maxDocuments - documents.length;
    if (remainingSlots <= 0) {
      toast({
        title: 'Maximum documents reached',
        description: `You can only upload up to ${maxDocuments} documents.`,
        variant: 'destructive',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const filesToUpload = Array.from(files).slice(0, remainingSlots);
    setUploading(true);

    try {
      for (const file of filesToUpload) {
        if (file.type.startsWith('image/')) {
          // Convert image to PDF
          const dataUrl = await fileToDataUrl(file);
          const resized = await resizeImage(dataUrl, 1920, 1920, 0.85);
          const scanOutput = await createWebScanOutput([resized]);
          
          const result = await uploadDocument(
            scanOutput,
            context,
            null,
            {
              label: file.name.replace(/\.[^/.]+$/, ''),
              enableOcr: ocrEnabled,
            }
          );
          onDocumentAdded?.(result.documentId);
          
          // Cleanup blob URL
          if (scanOutput.pdfUri?.startsWith('blob:')) {
            URL.revokeObjectURL(scanOutput.pdfUri);
          }
        } else if (file.type === 'application/pdf') {
          // Upload PDF directly - create a minimal scan output
          const pdfBlob = file;
          const pdfUri = URL.createObjectURL(pdfBlob);
          
          const result = await uploadDocument(
            {
              pdfUri,
              pdfBlob,
              pageCount: 1, // We don't know actual page count
              pageImageUris: [],
            },
            context,
            null,
            {
              fileName: file.name,
              label: file.name.replace(/\.[^/.]+$/, ''),
              enableOcr: ocrEnabled,
              mimeType: file.type,
            }
          );
          onDocumentAdded?.(result.documentId);
          
          URL.revokeObjectURL(pdfUri);
        } else {
          // For other file types (Word, Excel, etc.)
          const fileUri = URL.createObjectURL(file);
          
          const result = await uploadDocument(
            {
              pdfUri: fileUri,
              pdfBlob: file,
              pageCount: 1,
              pageImageUris: [],
            },
            context,
            null,
            {
              fileName: file.name,
              label: file.name.replace(/\.[^/.]+$/, ''),
              enableOcr: false, // OCR only works on images/PDFs
              mimeType: file.type || 'application/octet-stream',
            }
          );
          onDocumentAdded?.(result.documentId);
          
          URL.revokeObjectURL(fileUri);
        }
      }

      await refetch();
      toast({
        title: 'Upload complete',
        description: `${filesToUpload.length} document(s) uploaded successfully.`,
      });
    } catch (error: any) {
      console.error('Error uploading files:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Some files failed to upload. Please try again.';
      if (error.message?.includes('storage')) {
        errorMessage = 'Storage error: Unable to save files. Please check your connection and try again.';
      } else if (error.message?.includes('size') || error.message?.includes('large')) {
        errorMessage = 'One or more files are too large. Please use smaller files (under 10MB each).';
      } else if (error.message?.includes('permission') || error.message?.includes('unauthorized')) {
        errorMessage = 'Permission denied. Please refresh the page and try again.';
      } else if (error.message) {
        errorMessage = `Upload failed: ${error.message}`;
      }
      
      toast({
        title: 'Upload failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveDocument = async (doc: Document) => {
    try {
      await deleteDocument(doc.id);
      onDocumentRemoved?.(doc.id);
      toast({
        title: 'Document removed',
        description: 'The document has been deleted.',
      });
    } catch (error) {
      console.error('Error removing document:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove document.',
        variant: 'destructive',
      });
    }
  };

  // "Real scan" is mobile/tablet-focused; desktop uses upload.
  const canWebScan =
    isMobile ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches);
  const effectiveScanEnabled = scanEnabled && canWebScan;
  const canAddMore = canEdit && documents.length < maxDocuments;

  return (
    <div className="space-y-3">
      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-2 text-sm text-muted-foreground">
          <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
          Loading documents…
        </div>
      )}

      {/* Document Thumbnail Grid */}
      {!loading && documents.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {documents.map((doc) => (
            <DocumentThumbnail
              key={doc.id}
              documentId={doc.id}
              storageKey={doc.storage_key}
              fileName={doc.file_name}
              label={doc.label}
              mimeType={doc.mime_type}
              onRemove={canEdit ? () => handleRemoveDocument(doc) : undefined}
            />
          ))}
        </div>
      )}

      {!loading && documents.length === 0 && (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No documents yet.
        </div>
      )}

      {/* Upload Buttons */}
      {canAddMore && (
        <div className={effectiveScanEnabled ? 'flex gap-2' : undefined}>
          {effectiveScanEnabled ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setScannerOpen(true)}
              disabled={uploading}
              className="flex-1"
            >
              <MaterialIcon name="document_scanner" size="sm" className="mr-2" />
              Scan
            </Button>
          ) : null}

          {/* Upload Button - File picker (overlay input for mobile reliability) */}
          <div className={effectiveScanEnabled ? 'relative flex-1' : 'relative w-full'}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full"
            >
              {uploading ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="upload" size="sm" className="mr-2" />
              )}
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              multiple
              onChange={handleFileSelect}
              disabled={uploading}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Upload document"
            />
          </div>
        </div>
      )}

      {/* Counter */}
      <p className="text-xs text-muted-foreground" style={{ fontFamily: 'inherit' }}>
        <span>{String(documents.length)}</span>/{maxDocuments} documents uploaded
      </p>

      {/* Document Scanner Dialog - Opens directly to camera */}
      {effectiveScanEnabled && canEdit ? (
        <DocumentScanner
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          context={context}
          isSensitive={false}
          enableOcr={ocrEnabled}
          onSuccess={handleScanSuccess}
          onError={handleScanError}
          initialMode="camera"
        />
      ) : null}
    </div>
  );
}
