/**
 * DocumentScanner Component
 * Main scanner modal with camera capture, review, and upload
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import type { DocumentContext, ScanState, UploadProgress, OcrResult } from '@/lib/scanner/types';
import {
  startScannerSession,
  addImageToSession,
  removeImageFromSession,
  replaceImageInSession,
  getSessionImages,
  completeScannerSession,
  cancelScannerSession,
  cleanupScanOutput,
  resizeImage,
  fileToDataUrl,
} from '@/lib/scanner';
import { uploadDocument } from '@/lib/scanner/uploadService';
import { performOcr } from '@/lib/scanner/ocrService';
import { cropImageDataUrl, detectDocumentBounds, type CropRect } from '@/lib/scanner/pageCrop';

interface DocumentScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: DocumentContext;
  isSensitive?: boolean;
  enableOcr?: boolean;
  onSuccess?: (documentId: string) => void;
  onError?: (error: Error) => void;
  initialMode?: 'camera' | 'upload';
}

export function DocumentScanner({
  open,
  onOpenChange,
  context,
  isSensitive = false,
  enableOcr = false,
  onSuccess,
  onError,
  initialMode = 'camera',
}: DocumentScannerProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<ScanState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [originalImages, setOriginalImages] = useState<string[]>([]);
  const [cropRects, setCropRects] = useState<Array<CropRect | null>>([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [documentLabel, setDocumentLabel] = useState('');
  const [autoFileName, setAutoFileName] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'camera' | 'upload'>(initialMode);
  const [cameraReady, setCameraReady] = useState(false);

  // Crop adjustment UI (per-page; axis-aligned rect)
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [cropDraft, setCropDraft] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [cropImageSize, setCropImageSize] = useState<{ w: number; h: number } | null>(null);
  const [cropBusy, setCropBusy] = useState(false);

  // Start camera when dialog opens
  useEffect(() => {
    if (open && mode === 'camera' && state === 'idle') {
      startCamera();
    }
    
    return () => {
      stopCamera();
    };
  }, [open, mode]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      cleanup();
    }
  }, [open]);

  const autoNameEnabled = context.type === 'shipment';
  const shipmentNumberForName = context.type === 'shipment' ? (context.shipmentNumber || '') : '';

  const buildAutoShipmentFileName = useCallback(() => {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timePart = now.toISOString().slice(11, 19).replace(/:/g, ''); // HHMMSS
    const uniq = Math.random().toString(36).slice(2, 7).toUpperCase();
    const base = shipmentNumberForName.trim() || 'SHIPMENT';
    return `${base}_${datePart}_${timePart}_${uniq}.pdf`;
  }, [shipmentNumberForName]);

  useEffect(() => {
    if (!open) return;
    if (!autoNameEnabled) return;
    // Create once per open session so the user sees a stable name.
    setAutoFileName((prev) => prev || buildAutoShipmentFileName());
  }, [open, autoNameEnabled, buildAutoShipmentFileName]);

  const startCamera = async () => {
    try {
      setState('scanning');
      setCameraReady(false);
      
      // Check if camera API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Camera is not available on this device. Please use the Upload option instead.');
        setState('error');
        return;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
      
      // Start a new session
      const session = startScannerSession();
      setSessionId(session.id);
    } catch (err: any) {
      console.error('Camera error:', err);
      
      // Provide specific error messages based on the error type
      let errorMessage = 'Could not access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Camera permission denied. Please allow camera access in your browser settings and try again.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera found on this device. Please use the Upload option instead.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Camera is in use by another application. Please close other apps using the camera and try again.';
      } else if (err.name === 'OverconstrainedError') {
        errorMessage = 'Camera does not support the required settings. Trying with default settings...';
        // Try again with simpler constraints
        try {
          const simpleStream = await navigator.mediaDevices.getUserMedia({ video: true });
          streamRef.current = simpleStream;
          if (videoRef.current) {
            videoRef.current.srcObject = simpleStream;
            await videoRef.current.play();
            setCameraReady(true);
          }
          const session = startScannerSession();
          setSessionId(session.id);
          return; // Success with simple constraints
        } catch {
          errorMessage = 'Could not access camera with any settings. Please use the Upload option.';
        }
      }
      
      setError(errorMessage);
      setState('error');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  const cleanup = () => {
    stopCamera();
    if (sessionId) {
      cancelScannerSession(sessionId);
    }
    setSessionId(null);
    setCapturedImages([]);
    setOriginalImages([]);
    setCropRects([]);
    setCurrentPreviewIndex(0);
    setDocumentLabel('');
    setAutoFileName('');
    setUploadProgress(null);
    setError(null);
    setState('idle');
    setMode(initialMode);
    setCropDialogOpen(false);
    setCropIndex(null);
    setCropDraft(null);
    setCropImageSize(null);
    setCropBusy(false);
  };

  const captureImage = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !sessionId) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Resize if needed
    const original = await resizeImage(dataUrl, 1920, 1920, 0.85);

    // Auto edge-detect + crop (best-effort; non-blocking if it fails)
    let cropRect: CropRect | null = null;
    let processed = original;
    try {
      cropRect = await detectDocumentBounds(original);
      if (cropRect) {
        processed = await cropImageDataUrl(original, cropRect, { mode: 'color', output: 'jpeg', quality: 0.9 });
      }
    } catch (err) {
      console.warn('[DocumentScanner] auto-crop failed:', err);
    }

    addImageToSession(sessionId, processed);
    setCapturedImages(getSessionImages(sessionId));
    setOriginalImages((prev) => [...prev, original]);
    setCropRects((prev) => [...prev, cropRect]);

    const nextPage = getSessionImages(sessionId).length;
    toast({
      title: `Page ${nextPage} captured`,
      description: 'Tap capture for more pages, or Done to finish.',
    });
  }, [sessionId, toast]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setState('scanning');
    
    // Start session if not already started
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      const session = startScannerSession();
      currentSessionId = session.id;
      setSessionId(currentSessionId);
    }

    try {
      const originalsToAdd: string[] = [];
      const rectsToAdd: Array<CropRect | null> = [];
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) {
          const dataUrl = await fileToDataUrl(file);
          const original = await resizeImage(dataUrl, 1920, 1920, 0.85);

          let cropRect: CropRect | null = null;
          let processed = original;
          try {
            cropRect = await detectDocumentBounds(original);
            if (cropRect) {
              processed = await cropImageDataUrl(original, cropRect, { mode: 'color', output: 'jpeg', quality: 0.9 });
            }
          } catch (err) {
            console.warn('[DocumentScanner] auto-crop failed (upload):', err);
          }

          addImageToSession(currentSessionId, processed);
          originalsToAdd.push(original);
          rectsToAdd.push(cropRect);
        }
      }
      
      setCapturedImages(getSessionImages(currentSessionId));
      setOriginalImages((prev) => [...prev, ...originalsToAdd]);
      setCropRects((prev) => [...prev, ...rectsToAdd]);
      setState('reviewing');
    } catch (err) {
      console.error('File upload error:', err);
      setError('Failed to process uploaded files.');
      setState('error');
    }
    
    // Reset input
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    if (!sessionId) return;
    removeImageFromSession(sessionId, index);
    const images = getSessionImages(sessionId);
    setCapturedImages(images);
    setOriginalImages((prev) => prev.filter((_, i) => i !== index));
    setCropRects((prev) => prev.filter((_, i) => i !== index));
    
    if (currentPreviewIndex >= images.length) {
      setCurrentPreviewIndex(Math.max(0, images.length - 1));
    }
  };

  const getOriginalForIndex = (index: number) => {
    return originalImages[index] || capturedImages[index] || null;
  };

  const loadImageSize = async (dataUrl: string): Promise<{ w: number; h: number }> => {
    const img = new Image();
    img.decoding = 'async';
    img.src = dataUrl;
    await img.decode();
    return {
      w: img.naturalWidth || img.width,
      h: img.naturalHeight || img.height,
    };
  };

  const clampPct = (n: number) => Math.max(0, Math.min(100, n));

  const openCropDialogForIndex = async (index: number) => {
    if (!sessionId) return;
    const original = getOriginalForIndex(index);
    if (!original) return;
    setCropBusy(true);
    try {
      setCropIndex(index);
      const { w, h } = await loadImageSize(original);
      setCropImageSize({ w, h });

      const rect = cropRects[index];
      const left = rect ? (rect.x / w) * 100 : 0;
      const top = rect ? (rect.y / h) * 100 : 0;
      const right = rect ? ((rect.x + rect.width) / w) * 100 : 100;
      const bottom = rect ? ((rect.y + rect.height) / h) * 100 : 100;

      setCropDraft({
        left: clampPct(left),
        top: clampPct(top),
        right: clampPct(right),
        bottom: clampPct(bottom),
      });
      setCropDialogOpen(true);
    } catch (err) {
      console.warn('[DocumentScanner] open crop failed:', err);
    } finally {
      setCropBusy(false);
    }
  };

  const applyCropDraft = async () => {
    if (!sessionId || !cropDraft || !cropImageSize) return;
    const index = cropIndex ?? currentPreviewIndex;
    const original = getOriginalForIndex(index);
    if (!original) return;

    const { w, h } = cropImageSize;
    const left = clampPct(Math.min(cropDraft.left, cropDraft.right - 1));
    const right = clampPct(Math.max(cropDraft.right, left + 1));
    const top = clampPct(Math.min(cropDraft.top, cropDraft.bottom - 1));
    const bottom = clampPct(Math.max(cropDraft.bottom, top + 1));

    const rect: CropRect = {
      x: (left / 100) * w,
      y: (top / 100) * h,
      width: ((right - left) / 100) * w,
      height: ((bottom - top) / 100) * h,
    };

    setCropBusy(true);
    try {
      const processed = await cropImageDataUrl(original, rect, { mode: 'color', output: 'jpeg', quality: 0.9 });
      replaceImageInSession(sessionId, index, processed);
      setCapturedImages(getSessionImages(sessionId));
      setCropRects((prev) => prev.map((r, i) => (i === index ? rect : r)));
      setCropDialogOpen(false);
      setCropIndex(null);
    } catch (err) {
      console.warn('[DocumentScanner] apply crop failed:', err);
      toast({
        variant: 'destructive',
        title: 'Crop failed',
        description: 'Could not apply crop. Please try again.',
      });
    } finally {
      setCropBusy(false);
    }
  };

  const autoDetectCropForCurrent = async () => {
    const index = cropIndex ?? currentPreviewIndex;
    const original = getOriginalForIndex(index);
    if (!original) return;
    setCropBusy(true);
    try {
      const rect = await detectDocumentBounds(original);
      if (!rect) return;

      const { w, h } = await loadImageSize(original);
      setCropImageSize({ w, h });
      setCropDraft({
        left: clampPct((rect.x / w) * 100),
        top: clampPct((rect.y / h) * 100),
        right: clampPct(((rect.x + rect.width) / w) * 100),
        bottom: clampPct(((rect.y + rect.height) / h) * 100),
      });
    } catch (err) {
      console.warn('[DocumentScanner] auto detect crop failed:', err);
    } finally {
      setCropBusy(false);
    }
  };

  const handleDone = () => {
    if (capturedImages.length === 0) {
      setError('Please capture at least one page.');
      return;
    }
    stopCamera();
    setState('reviewing');
  };

  const handleUpload = async () => {
    if (!sessionId || capturedImages.length === 0) return;

    setState('uploading');
    setError(null);

    try {
      // Complete the session to generate PDF
      const scanOutput = await completeScannerSession(sessionId);
      
      // Perform OCR if enabled and we have page images
      let ocrResult: OcrResult | null = null;
      if (enableOcr && scanOutput.pageImageUris.length > 0) {
        setUploadProgress({ stage: 'preparing', percentage: 30 });
        try {
          ocrResult = await performOcr(scanOutput.pageImageUris);
        } catch (ocrErr) {
          console.warn('OCR failed, continuing without OCR:', ocrErr);
          // Continue without OCR - don't block upload
        }
      }
      
      // Upload the document with OCR result
      const labelForUpload = autoNameEnabled
        ? (shipmentNumberForName.trim()
            ? `Receiving Document - ${shipmentNumberForName.trim()}`
            : 'Receiving Document')
        : (documentLabel || undefined);

      const fileNameForUpload = autoNameEnabled
        ? (autoFileName || buildAutoShipmentFileName())
        : undefined;

      const result = await uploadDocument(
        scanOutput,
        context,
        ocrResult,
        {
          label: labelForUpload,
          fileName: fileNameForUpload,
          isSensitive,
          enableOcr,
        },
        setUploadProgress
      );
      
      // Cleanup
      cleanupScanOutput(scanOutput);
      
      setState('complete');
      toast({
        title: 'Document saved',
        description: 'Your document has been uploaded successfully.',
      });
      
      onSuccess?.(result.documentId);
      
      // Close after short delay
      setTimeout(() => {
        onOpenChange(false);
      }, 1000);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload document.');
      setState('error');
      onError?.(err instanceof Error ? err : new Error('Upload failed'));
    }
  };

  const handleRetry = () => {
    setError(null);
    if (mode === 'camera') {
      setState('scanning');
      startCamera();
    } else {
      setState('idle');
    }
  };

  const renderContent = () => {
    switch (state) {
      case 'idle':
      case 'scanning':
        if (mode === 'upload') {
          return (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                <MaterialIcon name="upload" className="text-primary" style={{ fontSize: '40px' }} />
              </div>
              <p className="text-muted-foreground">Select images to create a document</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button onClick={() => fileInputRef.current?.click()}>
                <MaterialIcon name="upload" size="sm" className="mr-2" />
                Choose Files
              </Button>
              <Button variant="ghost" onClick={() => setMode('camera')}>
                Or use camera instead
              </Button>
            </div>
          );
        }
        
        return (
          <div className="relative">
            {/* Camera View */}
            <div className="bg-black rounded-lg overflow-hidden relative h-[44vh] min-h-[260px] max-h-[420px]">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <MaterialIcon name="progress_activity" className="animate-spin text-white" style={{ fontSize: '32px' }} />
                </div>
              )}
              
              {/* Page count indicator */}
              {capturedImages.length > 0 && (
                <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm">
                  {capturedImages.length} page{capturedImages.length !== 1 ? 's' : ''} captured
                </div>
              )}
            </div>
            
            {/* Capture Controls */}
            <div className="flex items-center justify-center gap-4 mt-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setMode('upload')}
                className="h-12 w-12 rounded-full"
              >
                <MaterialIcon name="upload" size="md" />
              </Button>
              
              <Button
                size="icon"
                onClick={captureImage}
                disabled={!cameraReady}
                className="h-16 w-16 rounded-full"
              >
                <MaterialIcon name="photo_camera" style={{ fontSize: '32px' }} />
              </Button>
              
              <Button
                variant="outline"
                size="icon"
                onClick={handleDone}
                disabled={capturedImages.length === 0}
                className="h-12 w-12 rounded-full"
              >
                <MaterialIcon name="check" size="md" />
              </Button>
            </div>
            
            {/* Thumbnail strip */}
            {capturedImages.length > 0 && (
              <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
                {capturedImages.map((img, i) => (
                  <div
                    key={i}
                    className="relative flex-shrink-0 h-16 w-12 rounded border overflow-hidden"
                  >
                    <img src={img} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute top-0 right-0 bg-destructive text-destructive-foreground p-0.5 rounded-bl"
                    >
                      <MaterialIcon name="close" style={{ fontSize: '12px' }} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={captureImage}
                  disabled={!cameraReady}
                  className="flex-shrink-0 h-16 w-12 rounded border-2 border-dashed flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  <MaterialIcon name="add" size="md" />
                </button>
              </div>
            )}
          </div>
        );

      case 'reviewing':
        return (
          <div className="space-y-4">
            {/* Preview carousel */}
            <div className="relative bg-muted rounded-lg overflow-hidden h-[44vh] min-h-[260px] max-h-[420px]">
              {capturedImages[currentPreviewIndex] && (
                <img
                  src={capturedImages[currentPreviewIndex]}
                  alt={`Page ${currentPreviewIndex + 1}`}
                  className="w-full h-full object-contain"
                />
              )}

              {/* Crop adjustment */}
              {capturedImages[currentPreviewIndex] && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void openCropDialogForIndex(currentPreviewIndex)}
                  disabled={cropBusy}
                  className="absolute top-2 right-2 bg-background/80"
                >
                  <MaterialIcon name="crop" size="sm" className="mr-2" />
                  Crop
                </Button>
              )}
              
              {capturedImages.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setCurrentPreviewIndex(i => Math.max(0, i - 1))}
                    disabled={currentPreviewIndex === 0}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80"
                  >
                    <MaterialIcon name="chevron_left" size="md" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setCurrentPreviewIndex(i => Math.min(capturedImages.length - 1, i + 1))}
                    disabled={currentPreviewIndex === capturedImages.length - 1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80"
                  >
                    <MaterialIcon name="chevron_right" size="md" />
                  </Button>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-sm">
                    Page {currentPreviewIndex + 1} of {capturedImages.length}
                  </div>
                </>
              )}
            </div>

            {/* Document label */}
            {autoNameEnabled ? (
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <MaterialIcon name="auto_awesome" size="sm" />
                  Auto-named
                </div>
                <div className="font-mono text-xs text-foreground break-all">{autoFileName || '—'}</div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="doc-label">Document Label (optional)</Label>
                <Input
                  id="doc-label"
                  placeholder="e.g., Bill of Lading, Invoice, etc."
                  value={documentLabel}
                  onChange={(e) => setDocumentLabel(e.target.value)}
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setState('scanning');
                  if (mode === 'camera') startCamera();
                }}
                className="flex-1"
              >
                <MaterialIcon name="undo" size="sm" className="mr-2" />
                Retake
              </Button>
              <Button onClick={handleUpload} className="flex-1">
                <MaterialIcon name="check" size="sm" className="mr-2" />
                Save Document
              </Button>
            </div>
          </div>
        );

      case 'uploading':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <MaterialIcon name="progress_activity" className="animate-spin text-primary" style={{ fontSize: '48px' }} />
            <p className="font-medium">Uploading document...</p>
            {uploadProgress && (
              <div className="w-full max-w-xs space-y-2">
                <Progress value={uploadProgress.percentage} />
                <p className="text-sm text-muted-foreground text-center">
                  {uploadProgress.stage === 'preparing' && 'Preparing...'}
                  {uploadProgress.stage === 'uploading' && 'Uploading...'}
                  {uploadProgress.stage === 'saving' && 'Saving record...'}
                  {uploadProgress.stage === 'complete' && 'Complete!'}
                </p>
              </div>
            )}
          </div>
        );

      case 'complete':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <MaterialIcon name="check" className="text-green-600" style={{ fontSize: '32px' }} />
            </div>
            <p className="font-medium text-green-600">Document saved successfully!</p>
          </div>
        );

      case 'error':
        return (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <MaterialIcon name="warning" className="text-destructive" style={{ fontSize: '32px' }} />
            </div>
            <p className="text-destructive font-medium">Something went wrong</p>
            <p className="text-sm text-muted-foreground text-center">{error}</p>
            <Button onClick={handleRetry}>Try Again</Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Note: document scanning UI needs more vertical room on mobile; increase max-height
          and keep capture controls visible without relying on scroll gestures over <video>. */}
      <DialogContent className="max-w-md max-h-[95vh]">
        <DialogHeader>
          <DialogTitle>
            {state === 'reviewing' ? 'Review Document' :
             state === 'uploading' ? 'Uploading...' :
             state === 'complete' ? 'Complete' :
             state === 'error' ? 'Error' :
             'Scan Document'}
          </DialogTitle>
        </DialogHeader>
        
        {renderContent()}

        {/* Crop dialog (manual adjustment) */}
        <Dialog
          open={cropDialogOpen}
          onOpenChange={(next) => {
            if (!next) {
              setCropDialogOpen(false);
              setCropIndex(null);
              setCropDraft(null);
              setCropImageSize(null);
            } else {
              setCropDialogOpen(true);
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MaterialIcon name="crop" size="sm" />
                Adjust crop
              </DialogTitle>
              <DialogDescription>
                Auto edge-detection picks a crop box. Adjust if needed.
              </DialogDescription>
            </DialogHeader>

            {cropDraft && cropIndex != null ? (
              <div className="space-y-4">
                <div className="relative rounded-lg overflow-hidden border bg-muted">
                  {getOriginalForIndex(cropIndex) ? (
                    <img
                      src={getOriginalForIndex(cropIndex) as string}
                      alt={`Crop page ${cropIndex + 1}`}
                      className="w-full h-auto"
                    />
                  ) : null}

                  {/* Overlay */}
                  <div className="absolute inset-0 pointer-events-none">
                    {/* Top */}
                    <div className="absolute left-0 right-0 top-0 bg-black/40" style={{ height: `${cropDraft.top}%` }} />
                    {/* Bottom */}
                    <div className="absolute left-0 right-0 bottom-0 bg-black/40" style={{ height: `${100 - cropDraft.bottom}%` }} />
                    {/* Left */}
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-black/40"
                      style={{
                        top: `${cropDraft.top}%`,
                        bottom: `${100 - cropDraft.bottom}%`,
                        width: `${cropDraft.left}%`,
                      }}
                    />
                    {/* Right */}
                    <div
                      className="absolute top-0 bottom-0 right-0 bg-black/40"
                      style={{
                        top: `${cropDraft.top}%`,
                        bottom: `${100 - cropDraft.bottom}%`,
                        width: `${100 - cropDraft.right}%`,
                      }}
                    />
                    {/* Crop border */}
                    <div
                      className="absolute border-2 border-primary rounded-sm"
                      style={{
                        left: `${cropDraft.left}%`,
                        top: `${cropDraft.top}%`,
                        width: `${cropDraft.right - cropDraft.left}%`,
                        height: `${cropDraft.bottom - cropDraft.top}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Sliders */}
                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Left</span>
                      <span>{Math.round(cropDraft.left)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, Math.floor(cropDraft.right - 1))}
                      value={cropDraft.left}
                      onChange={(e) => {
                        const left = Number(e.target.value);
                        setCropDraft((prev) => (prev ? { ...prev, left } : prev));
                      }}
                      disabled={cropBusy}
                    />
                  </div>
                  <div className="grid gap-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Right</span>
                      <span>{Math.round(cropDraft.right)}%</span>
                    </div>
                    <input
                      type="range"
                      min={Math.min(100, Math.ceil(cropDraft.left + 1))}
                      max={100}
                      value={cropDraft.right}
                      onChange={(e) => {
                        const right = Number(e.target.value);
                        setCropDraft((prev) => (prev ? { ...prev, right } : prev));
                      }}
                      disabled={cropBusy}
                    />
                  </div>
                  <div className="grid gap-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Top</span>
                      <span>{Math.round(cropDraft.top)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, Math.floor(cropDraft.bottom - 1))}
                      value={cropDraft.top}
                      onChange={(e) => {
                        const top = Number(e.target.value);
                        setCropDraft((prev) => (prev ? { ...prev, top } : prev));
                      }}
                      disabled={cropBusy}
                    />
                  </div>
                  <div className="grid gap-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Bottom</span>
                      <span>{Math.round(cropDraft.bottom)}%</span>
                    </div>
                    <input
                      type="range"
                      min={Math.min(100, Math.ceil(cropDraft.top + 1))}
                      max={100}
                      value={cropDraft.bottom}
                      onChange={(e) => {
                        const bottom = Number(e.target.value);
                        setCropDraft((prev) => (prev ? { ...prev, bottom } : prev));
                      }}
                      disabled={cropBusy}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-sm text-muted-foreground">
                Loading crop…
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCropDialogOpen(false);
                  setCropIndex(null);
                  setCropDraft(null);
                  setCropImageSize(null);
                }}
                disabled={cropBusy}
              >
                Cancel
              </Button>
              <Button type="button" variant="secondary" onClick={() => void autoDetectCropForCurrent()} disabled={cropBusy}>
                <MaterialIcon name="auto_awesome" size="sm" className="mr-2" />
                Auto
              </Button>
              <Button type="button" onClick={() => void applyCropDraft()} disabled={cropBusy || !cropDraft}>
                <MaterialIcon name="check" size="sm" className="mr-2" />
                Apply
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
