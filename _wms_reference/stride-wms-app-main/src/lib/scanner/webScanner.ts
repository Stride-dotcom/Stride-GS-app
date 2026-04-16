/**
 * Web Scanner Implementation
 * Camera capture + jsPDF conversion for web fallback
 */

import { jsPDF } from 'jspdf';
import type { ScanOutput } from './types';

export interface WebScannerOptions {
  maxPages?: number;
  imageQuality?: number;
  pageWidth?: number;
  pageHeight?: number;
  /**
   * Document scanning should default to a "scanner" look (black & white).
   * This keeps PDFs readable and smaller than full-color images.
   */
  filter?: 'color' | 'grayscale' | 'bw';
}

const DEFAULT_OPTIONS: Required<WebScannerOptions> = {
  maxPages: 20,
  imageQuality: 0.85,
  pageWidth: 210, // A4 width in mm
  pageHeight: 297, // A4 height in mm
  filter: 'bw',
};

async function applyScanFilter(
  dataUrl: string,
  filter: WebScannerOptions['filter'],
  quality: number
): Promise<string> {
  if (!filter || filter === 'color') return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data } = imageData;

      // Simple grayscale + optional thresholding for "black & white".
      // Threshold tuned for paperwork; avoids too-aggressive clipping.
      const threshold = 185;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

        if (filter === 'bw') {
          const v = gray > threshold ? 255 : 0;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
        } else {
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }
        // alpha stays as-is
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Capture image from camera stream
 */
export async function captureImageFromCamera(
  videoElement: HTMLVideoElement
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  ctx.drawImage(videoElement, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Convert file input to data URL
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Get image dimensions from data URL
 */
export async function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Convert array of images to PDF
 */
export async function imagesToPdf(
  imageDataUrls: string[],
  options: WebScannerOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (imageDataUrls.length === 0) {
    throw new Error('No images to convert');
  }
  
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  
  for (let i = 0; i < imageDataUrls.length; i++) {
    const rawDataUrl = imageDataUrls[i];
    const dataUrl = await applyScanFilter(rawDataUrl, opts.filter, opts.imageQuality);
    const dimensions = await getImageDimensions(dataUrl);
    
    // Calculate scaling to fit A4 page while maintaining aspect ratio
    const pageWidth = opts.pageWidth;
    const pageHeight = opts.pageHeight;
    
    const imgAspect = dimensions.width / dimensions.height;
    const pageAspect = pageWidth / pageHeight;
    
    let imgWidth: number;
    let imgHeight: number;
    
    if (imgAspect > pageAspect) {
      // Image is wider than page
      imgWidth = pageWidth;
      imgHeight = pageWidth / imgAspect;
    } else {
      // Image is taller than page
      imgHeight = pageHeight;
      imgWidth = pageHeight * imgAspect;
    }
    
    // Center the image on the page
    const x = (pageWidth - imgWidth) / 2;
    const y = (pageHeight - imgHeight) / 2;
    
    if (i > 0) {
      pdf.addPage();
    }
    
    pdf.addImage(dataUrl, 'JPEG', x, y, imgWidth, imgHeight);
  }
  
  return pdf.output('blob');
}

/**
 * Create a web-based scan output from captured images
 */
export async function createWebScanOutput(
  imageDataUrls: string[],
  options: WebScannerOptions = {}
): Promise<ScanOutput> {
  const pdfBlob = await imagesToPdf(imageDataUrls, options);
  const pdfUri = URL.createObjectURL(pdfBlob);
  
  return {
    pdfUri,
    pdfBlob,
    pageCount: imageDataUrls.length,
    pageImageUris: imageDataUrls,
  };
}

/**
 * Clean up blob URLs to prevent memory leaks
 */
export function cleanupScanOutput(scanOutput: ScanOutput): void {
  if (scanOutput.pdfUri.startsWith('blob:')) {
    URL.revokeObjectURL(scanOutput.pdfUri);
  }
  
  scanOutput.pageImageUris.forEach(uri => {
    if (uri.startsWith('blob:')) {
      URL.revokeObjectURL(uri);
    }
  });
}

/**
 * Resize image to reduce file size
 */
export async function resizeImage(
  dataUrl: string,
  maxWidth: number = 1920,
  maxHeight: number = 1920,
  quality: number = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      
      // Calculate new dimensions
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
