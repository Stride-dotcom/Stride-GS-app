/**
 * Document Scanner Module
 * Cross-platform document scanning with OCR
 */

// Types
export * from './types';

// Platform detection
export {
  getPlatform,
  isNative,
  isIOS,
  isAndroid,
  isWeb,
  getScannerCapabilities,
  hasCameraAccess,
  requestCameraPermission,
} from './platformDetection';

// Scanner service
export {
  scanDocument,
  isScannerAvailable,
  startScannerSession,
  addImageToSession,
  removeImageFromSession,
  replaceImageInSession,
  getSessionImages,
  completeScannerSession,
  cancelScannerSession,
  getScannerErrorMessage,
  createScannerError,
} from './scannerService';

// Web scanner
export {
  captureImageFromCamera,
  fileToDataUrl,
  imagesToPdf,
  createWebScanOutput,
  cleanupScanOutput,
  resizeImage,
} from './webScanner';

// Native scanner
export {
  isNativeScannerAvailable,
  scanWithNativeScanner,
} from './nativeScanner';

// OCR service
export {
  isOcrAvailable,
  recognizeTextFromImage,
  performOcr,
  extractKeywords,
} from './ocrService';

// Upload service
export {
  uploadDocument,
  getDocumentSignedUrl,
  deleteDocument,
  permanentlyDeleteDocument,
} from './uploadService';
export type { UploadOptions, UploadResult } from './uploadService';
