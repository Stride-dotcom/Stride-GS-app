/**
 * DocumentUploadButton Component
 * A button that opens a file picker for uploading documents
 */

import { useRef, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { DropZone } from '@/components/common/DropZone';
import { useToast } from '@/hooks/use-toast';
import { uploadDocument } from '@/lib/scanner/uploadService';
import { fileToDataUrl, resizeImage, createWebScanOutput } from '@/lib/scanner/webScanner';
import type { DocumentContext } from '@/lib/scanner/types';

interface DocumentUploadButtonProps {
  context: DocumentContext;
  onSuccess?: (documentId: string) => void;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  label?: string;
  ocrEnabled?: boolean;
}

export function DocumentUploadButton({
  context,
  onSuccess,
  variant = 'outline',
  size = 'default',
  className,
  label = 'Upload',
  ocrEnabled = true,
}: DocumentUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
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

          // Cleanup blob URL
          if (scanOutput.pdfUri?.startsWith('blob:')) {
            URL.revokeObjectURL(scanOutput.pdfUri);
          }

          onSuccess?.(result.documentId);
        } else if (file.type === 'application/pdf') {
          // Upload PDF directly
          const pdfUri = URL.createObjectURL(file);

          const result = await uploadDocument(
            {
              pdfUri,
              pdfBlob: file,
              pageCount: 1,
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

          URL.revokeObjectURL(pdfUri);
          onSuccess?.(result.documentId);
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
              enableOcr: false,
              mimeType: file.type || 'application/octet-stream',
            }
          );

          URL.revokeObjectURL(fileUri);
          onSuccess?.(result.documentId);
        }
      }

      toast({
        title: 'Upload complete',
        description: `${files.length} document(s) uploaded successfully.`,
      });
    } catch (error: any) {
      console.error('Document upload error:', error);
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error.message || 'Failed to upload document.',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(Array.from(files));
  };

  return (
    <DropZone
      onFiles={processFiles}
      accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
      disabled={uploading}
      hint="Drag and drop documents here, or click to upload"
    >
      <Button
        variant={variant}
        size={size}
        onClick={() => fileInputRef.current?.click()}
        className={className}
        disabled={uploading}
      >
        {uploading ? (
          <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
        ) : (
          <MaterialIcon name="upload" size="sm" className="mr-2" />
        )}
        {uploading ? 'Uploading...' : label}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </DropZone>
  );
}
