/**
 * Scanner Service
 * Unified API for document scanning across platforms
 */

import type { ScanOutput, ScannerConfig, ScannerError, DEFAULT_SCANNER_CONFIG } from './types';
import { isNative, getScannerCapabilities } from './platformDetection';
import { scanWithNativeScanner, isNativeScannerAvailable } from './nativeScanner';
import { createWebScanOutput, cleanupScanOutput } from './webScanner';

export interface ScannerSession {
  id: string;
  startedAt: Date;
  capturedImages: string[];
  isComplete: boolean;
}

// Active scanner sessions
const activeSessions = new Map<string, ScannerSession>();

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Start a new scanner session
 */
export function startScannerSession(): ScannerSession {
  const session: ScannerSession = {
    id: generateSessionId(),
    startedAt: new Date(),
    capturedImages: [],
    isComplete: false,
  };
  
  activeSessions.set(session.id, session);
  return session;
}

/**
 * Add captured image to session
 */
export function addImageToSession(sessionId: string, imageDataUrl: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error('Scanner session not found');
  }
  
  const capabilities = getScannerCapabilities();
  if (session.capturedImages.length >= capabilities.maxPageLimit) {
    throw new Error(`Maximum page limit (${capabilities.maxPageLimit}) reached`);
  }
  
  session.capturedImages.push(imageDataUrl);
}

/**
 * Remove image from session
 */
export function removeImageFromSession(sessionId: string, index: number): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error('Scanner session not found');
  }
  
  if (index < 0 || index >= session.capturedImages.length) {
    throw new Error('Invalid image index');
  }
  
  session.capturedImages.splice(index, 1);
}

/**
 * Get session images
 */
export function getSessionImages(sessionId: string): string[] {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error('Scanner session not found');
  }
  
  return [...session.capturedImages];
}

/**
 * Replace an existing session image (used for crop adjustments).
 */
export function replaceImageInSession(sessionId: string, index: number, imageDataUrl: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error('Scanner session not found');
  }
  if (index < 0 || index >= session.capturedImages.length) {
    throw new Error('Invalid image index');
  }
  session.capturedImages[index] = imageDataUrl;
}

/**
 * Complete session and generate PDF
 */
export async function completeScannerSession(
  sessionId: string
): Promise<ScanOutput> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error('Scanner session not found');
  }
  
  if (session.capturedImages.length === 0) {
    throw new Error('No images captured');
  }
  
  const output = await createWebScanOutput(session.capturedImages);
  session.isComplete = true;
  
  return output;
}

/**
 * Cancel and cleanup session
 */
export function cancelScannerSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    // Clean up any blob URLs
    session.capturedImages.forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
    activeSessions.delete(sessionId);
  }
}

/**
 * Scan document using best available method
 * Always prefers web scanner in browser; native scanners only work in Capacitor/mobile shells.
 */
export async function scanDocument(
  config?: Partial<ScannerConfig>
): Promise<ScanOutput | null> {
  // Check if we're in a Capacitor native environment
  const isCapacitor = typeof window !== 'undefined' && !!(window as any).Capacitor;
  
  if (!isCapacitor) {
    // On web, return null to trigger web scanner dialog UI
    // The DocumentScanner component handles the web flow
    return null;
  }
  
  // If capacitor exists, try native, fallback to null for web UI
  if (isNative()) {
    try {
      const isAvailable = await isNativeScannerAvailable();
      if (isAvailable) {
        return await scanWithNativeScanner(config);
      }
    } catch (error) {
      console.warn('Native scanner failed, falling back to web:', error);
    }
  }
  
  // Return null to indicate web UI should handle capture
  return null;
}

/**
 * Check if scanner is available
 */
export async function isScannerAvailable(): Promise<boolean> {
  const capabilities = getScannerCapabilities();
  
  if (isNative()) {
    return await isNativeScannerAvailable();
  }
  
  return capabilities.hasCameraAccess;
}

/**
 * Get scanner error message for user display
 */
export function getScannerErrorMessage(error: ScannerError): string {
  switch (error.type) {
    case 'permission_denied':
      return 'Camera permission is required to scan documents. Please enable camera access in your device settings.';
    case 'cancelled':
      return 'Scan cancelled';
    case 'unsupported':
      return 'Document scanning is not supported on this device.';
    case 'ocr_failed':
      return 'Text recognition failed. The document was saved but may not be searchable.';
    case 'upload_failed':
      return 'Failed to upload document. Please check your connection and try again.';
    default:
      return error.message || 'An unexpected error occurred during scanning.';
  }
}

/**
 * Create scanner error object
 */
export function createScannerError(
  type: ScannerError['type'],
  message?: string
): ScannerError {
  const defaultMessages: Record<ScannerError['type'], string> = {
    permission_denied: 'Camera permission denied',
    cancelled: 'User cancelled the scan',
    unsupported: 'Scanner not supported on this device',
    ocr_failed: 'OCR processing failed',
    upload_failed: 'Document upload failed',
    unknown: 'An unknown error occurred',
  };
  
  return {
    type,
    message: message || defaultMessages[type],
  };
}
