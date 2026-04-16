/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_TENANT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// BarcodeDetector API (available in Chrome/Edge, experimental)
interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  boundingBox: DOMRectReadOnly;
  cornerPoints: { x: number; y: number }[];
  format: string;
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new(options?: BarcodeDetectorOptions): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

declare const BarcodeDetector: BarcodeDetectorConstructor | undefined;

// Build-time constants injected by vite.config.ts (TEMPORARY - build stamp)
declare const __BUILD_TIMESTAMP__: string;
declare const __COMMIT_HASH__: string;
