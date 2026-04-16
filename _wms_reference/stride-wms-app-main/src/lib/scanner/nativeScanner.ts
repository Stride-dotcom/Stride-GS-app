/**
 * Native Scanner Implementation
 * Uses @capacitor-mlkit/document-scanner for iOS/Android
 */

import type { ScanOutput, ScannerConfig, DEFAULT_SCANNER_CONFIG } from './types';
import { isNative, isIOS, isAndroid } from './platformDetection';

// Type definitions for the ML Kit Document Scanner plugin
// These will be properly typed when the plugin is installed
interface DocumentScannerResult {
  scannedImages?: string[];
  pdf?: {
    uri: string;
    pageCount: number;
  };
  status: 'success' | 'canceled';
}

interface DocumentScannerPlugin {
  scanDocument(options?: {
    galleryImportAllowed?: boolean;
    pageLimit?: number;
    resultFormats?: string;
    scannerMode?: string;
  }): Promise<DocumentScannerResult>;
}

// Dynamic import for the scanner plugin
let scannerPlugin: DocumentScannerPlugin | null = null;

/**
 * Load the native scanner plugin dynamically
 */
async function loadScannerPlugin(): Promise<DocumentScannerPlugin> {
  if (scannerPlugin) {
    return scannerPlugin;
  }
  
  if (!isNative()) {
    throw new Error('Native scanner is only available on iOS and Android');
  }
  
  try {
    // Dynamic import to avoid bundling issues on web
    const { DocumentScanner } = await import('@capacitor-mlkit/document-scanner');
    scannerPlugin = DocumentScanner as unknown as DocumentScannerPlugin;
    return scannerPlugin;
  } catch (error) {
    console.error('Failed to load document scanner plugin:', error);
    throw new Error('Document scanner plugin not available. Make sure it is installed.');
  }
}

/**
 * Check if native scanner is available
 */
export async function isNativeScannerAvailable(): Promise<boolean> {
  if (!isNative()) {
    return false;
  }
  
  try {
    await loadScannerPlugin();
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan documents using native scanner
 */
export async function scanWithNativeScanner(
  config: Partial<ScannerConfig> = {}
): Promise<ScanOutput | null> {
  const scanner = await loadScannerPlugin();
  
  const options = {
    galleryImportAllowed: config.allowGalleryImport ?? true,
    pageLimit: config.maxPages ?? 20,
    resultFormats: config.outputFormat === 'jpeg' ? 'JPEG' : 'PDF,JPEG',
    scannerMode: config.scanMode === 'base' ? 'BASE' : 
                 config.scanMode === 'base_with_filter' ? 'BASE_WITH_FILTER' : 
                 'FULL',
  };
  
  const result = await scanner.scanDocument(options);
  
  if (result.status === 'canceled') {
    return null;
  }
  
  if (!result.pdf && (!result.scannedImages || result.scannedImages.length === 0)) {
    throw new Error('No document was scanned');
  }
  
  return {
    pdfUri: result.pdf?.uri ?? '',
    pageCount: result.pdf?.pageCount ?? result.scannedImages?.length ?? 0,
    pageImageUris: result.scannedImages ?? [],
  };
}

/**
 * Get scanner mode description
 */
export function getScannerModeDescription(mode: ScannerConfig['scanMode']): string {
  switch (mode) {
    case 'full':
      return 'Full mode with automatic edge detection, cropping, and image enhancement';
    case 'base':
      return 'Basic mode with manual cropping only';
    case 'base_with_filter':
      return 'Basic mode with manual cropping and image filters';
    default:
      return 'Unknown mode';
  }
}
