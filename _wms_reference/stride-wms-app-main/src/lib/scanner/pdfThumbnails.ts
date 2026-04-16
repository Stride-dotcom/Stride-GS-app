/**
 * PDF thumbnail helpers (client-side).
 *
 * We render the first page of a PDF into a small image for use in thumbnail grids.
 * This intentionally uses dynamic imports so the heavy PDF.js code is only loaded
 * when we actually need to preview a PDF.
 */
type PdfJsModule = typeof import('pdfjs-dist');

let pdfJsLoadPromise: Promise<PdfJsModule> | null = null;
let workerConfigured = false;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsLoadPromise) {
    pdfJsLoadPromise = import('pdfjs-dist');
  }
  return pdfJsLoadPromise;
}

async function ensureWorkerConfigured(pdfjs: PdfJsModule) {
  if (workerConfigured) return;

  // Vite supports importing a file URL using ?url.
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  (pdfjs as any).GlobalWorkerOptions.workerSrc = (worker as any).default || worker;
  workerConfigured = true;
}

export interface PdfThumbnailOptions {
  /** Long edge size in pixels. */
  maxDim?: number;
  /** JPEG quality (0..1). */
  quality?: number;
}

export async function renderPdfFirstPageThumbnail(
  pdfUrl: string,
  options: PdfThumbnailOptions = {}
): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('PDF thumbnail rendering requires a browser environment');
  }

  const maxDim = options.maxDim ?? 320;
  const quality = options.quality ?? 0.8;

  const pdfjs = await loadPdfJs();
  await ensureWorkerConfigured(pdfjs);

  const loadingTask = (pdfjs as any).getDocument({ url: pdfUrl });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });

    const scale = Math.min(maxDim / viewport.width, maxDim / viewport.height);
    const scaledViewport = page.getViewport({ scale: Number.isFinite(scale) && scale > 0 ? scale : 1 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(scaledViewport.width));
    canvas.height = Math.max(1, Math.floor(scaledViewport.height));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create canvas context for PDF thumbnail');
    }

    const renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport });
    await renderTask.promise;

    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    try {
      await loadingTask.destroy?.();
    } catch {
      // ignore
    }
    try {
      await pdf.destroy?.();
    } catch {
      // ignore
    }
  }
}

