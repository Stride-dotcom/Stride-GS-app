/**
 * Document Scanner Types
 * Cross-platform document scanning with OCR support
 */

// Scan output from native scanner or web fallback
export interface ScanOutput {
  pdfUri: string;
  pdfBlob?: Blob;
  pageCount: number;
  pageImageUris: string[];
}

// OCR processing result
export interface OcrResult {
  fullText: string;
  pages: OcrPage[];
  confidence?: number;
}

export interface OcrPage {
  pageIndex: number;
  text: string;
  confidence?: number;
}

// Document context types for polymorphic linking
export type DocumentContextType =
  | 'shipment'
  | 'quote'
  | 'employee'
  | 'delivery'
  | 'invoice'
  | 'item'
  | 'task'
  | 'general';

// Context with specific metadata for each type
export type DocumentContext =
  | { type: 'shipment'; shipmentId: string; shipmentNumber?: string; vendor?: string }
  | { type: 'quote'; quoteId: string; quoteNumber?: string }
  | { type: 'employee'; employeeId: string; employeeName?: string }
  | { type: 'delivery'; deliveryId: string; routeStopId?: string }
  | { type: 'invoice'; invoiceNumber?: string; vendorId?: string }
  | { type: 'item'; itemId: string; description?: string }
  | { type: 'task'; taskId: string; title?: string }
  | { type: 'general'; label?: string };

// Scanner state machine
export type ScanState = 
  | 'idle' 
  | 'scanning' 
  | 'reviewing' 
  | 'ocr-processing' 
  | 'uploading' 
  | 'complete' 
  | 'error';

// Scanner error types
export type ScannerError = 
  | { type: 'permission_denied'; message: string }
  | { type: 'cancelled'; message: string }
  | { type: 'unsupported'; message: string }
  | { type: 'ocr_failed'; message: string }
  | { type: 'upload_failed'; message: string }
  | { type: 'unknown'; message: string };

// Document record from database
export interface Document {
  id: string;
  tenant_id: string;
  context_type: DocumentContextType;
  context_id: string | null;
  file_name: string;
  storage_key: string;
  file_size: number | null;
  page_count: number;
  mime_type: string;
  ocr_text: string | null;
  ocr_pages: OcrPage[] | null;
  ocr_status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  label: string | null;
  notes: string | null;
  is_sensitive: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Upload progress tracking
export interface UploadProgress {
  stage: 'preparing' | 'uploading' | 'saving' | 'complete';
  percentage: number;
  bytesUploaded?: number;
  totalBytes?: number;
}

// Scanner configuration
export interface ScannerConfig {
  maxPages: number;
  allowGalleryImport: boolean;
  outputFormat: 'pdf' | 'jpeg' | 'both';
  enableOcr: boolean;
  scanMode: 'full' | 'base' | 'base_with_filter';
}

// Default scanner configuration
export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  maxPages: 20,
  allowGalleryImport: true,
  outputFormat: 'pdf',
  enableOcr: true,
  scanMode: 'full',
};

// Platform detection
export type Platform = 'ios' | 'android' | 'web';

// Scanner capabilities based on platform
export interface ScannerCapabilities {
  platform: Platform;
  hasNativeScanner: boolean;
  hasOcr: boolean;
  hasCameraAccess: boolean;
  maxPageLimit: number;
}
