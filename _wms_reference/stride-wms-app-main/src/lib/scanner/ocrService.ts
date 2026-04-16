/**
 * OCR Service
 * On-device text recognition for scanned documents
 */

import type { OcrResult, OcrPage } from './types';
import { isNative, isIOS, isAndroid } from './platformDetection';

// Type definitions for ML Kit Text Recognition
interface TextRecognitionResult {
  text: string;
  blocks: Array<{
    text: string;
    confidence?: number;
    boundingBox?: {
      origin: { x: number; y: number };
      size: { width: number; height: number };
    };
  }>;
}

interface TextRecognitionPlugin {
  recognizeText(options: { imageUri: string }): Promise<TextRecognitionResult>;
}

// Dynamic import for OCR plugin
let ocrPlugin: TextRecognitionPlugin | null = null;

/**
 * Load the OCR plugin dynamically
 */
async function loadOcrPlugin(): Promise<TextRecognitionPlugin | null> {
  if (ocrPlugin) {
    return ocrPlugin;
  }
  
  if (!isNative()) {
    return null;
  }
  
  try {
    // Try to load ML Kit Text Recognition plugin dynamically
    // This plugin needs to be installed separately for native builds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const module = await (Function('return import("@capacitor-mlkit/text-recognition")')() as Promise<any>);
    ocrPlugin = module.TextRecognition as TextRecognitionPlugin;
    return ocrPlugin;
  } catch (error) {
    console.warn('OCR plugin not available:', error);
    return null;
  }
}

/**
 * Check if OCR is available on current platform
 */
export async function isOcrAvailable(): Promise<boolean> {
  if (!isNative()) {
    return false;
  }
  
  const plugin = await loadOcrPlugin();
  return plugin !== null;
}

/**
 * Perform OCR on a single image
 */
export async function recognizeTextFromImage(imageUri: string): Promise<string> {
  const plugin = await loadOcrPlugin();
  
  if (!plugin) {
    throw new Error('OCR is not available on this platform');
  }
  
  const result = await plugin.recognizeText({ imageUri });
  return result.text;
}

/**
 * Perform OCR on multiple page images
 */
export async function performOcr(
  pageImageUris: string[],
  onProgress?: (pageIndex: number, totalPages: number) => void
): Promise<OcrResult> {
  const plugin = await loadOcrPlugin();
  
  if (!plugin) {
    // Return empty result if OCR not available
    return {
      fullText: '',
      pages: [],
      confidence: 0,
    };
  }
  
  const pages: OcrPage[] = [];
  const allText: string[] = [];
  
  for (let i = 0; i < pageImageUris.length; i++) {
    onProgress?.(i + 1, pageImageUris.length);
    
    try {
      const result = await plugin.recognizeText({ imageUri: pageImageUris[i] });
      
      pages.push({
        pageIndex: i,
        text: result.text,
        confidence: calculateAverageConfidence(result.blocks),
      });
      
      if (result.text.trim()) {
        allText.push(result.text);
      }
    } catch (error) {
      console.warn(`OCR failed for page ${i + 1}:`, error);
      pages.push({
        pageIndex: i,
        text: '',
        confidence: 0,
      });
    }
  }
  
  const fullText = allText.join('\n\n--- Page Break ---\n\n');
  const avgConfidence = pages.length > 0
    ? pages.reduce((sum, p) => sum + (p.confidence ?? 0), 0) / pages.length
    : 0;
  
  return {
    fullText,
    pages,
    confidence: avgConfidence,
  };
}

/**
 * Calculate average confidence from text blocks
 */
function calculateAverageConfidence(
  blocks: TextRecognitionResult['blocks']
): number {
  const confidences = blocks
    .filter(b => b.confidence !== undefined)
    .map(b => b.confidence!);
  
  if (confidences.length === 0) {
    return 0;
  }
  
  return confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
}

/**
 * Extract keywords from OCR text for search indexing
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];
  
  // Remove special characters and normalize whitespace
  const cleaned = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Split into words and filter
  const words = cleaned.split(' ');
  
  // Remove common stop words and short words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
    'that', 'these', 'those', 'it', 'its'
  ]);
  
  const keywords = words.filter(word => 
    word.length > 2 && !stopWords.has(word)
  );
  
  // Return unique keywords
  return [...new Set(keywords)];
}
