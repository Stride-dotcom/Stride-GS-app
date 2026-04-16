/**
 * PhotoScanner Component
 * Full-screen camera dialog for multi-photo capture
 * Uses live camera preview like DocumentScanner but saves individual photos
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PendingPhoto {
  id: string;
  dataUrl: string;
}

interface PhotoScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: 'item' | 'shipment' | 'receiving' | 'inspection' | 'repair' | 'task' | 'claim';
  entityId?: string;
  tenantId?: string;
  existingPhotos?: string[];
  maxPhotos?: number;
  onPhotosSaved: (urls: string[]) => void;
}

export function PhotoScanner({
  open,
  onOpenChange,
  entityType,
  entityId,
  tenantId,
  existingPhotos = [],
  maxPhotos = 20,
  onPhotosSaved,
}: PhotoScannerProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [capturedPhotos, setCapturedPhotos] = useState<PendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');

  const totalPhotos = existingPhotos.length + capturedPhotos.length;
  const canAddMore = totalPhotos < maxPhotos;

  // Start camera when dialog opens
  useEffect(() => {
    if (open && mode === 'camera') {
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

  const startCamera = async () => {
    try {
      setCameraReady(false);
      setError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Camera is not available. Please use the Upload option.');
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
    } catch (err: any) {
      console.error('Camera error:', err);

      let errorMessage = 'Could not access camera.';
      if (err.name === 'NotAllowedError') {
        errorMessage = 'Camera permission denied. Please allow camera access.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'No camera found. Please use the Upload option.';
      } else if (err.name === 'NotReadableError') {
        errorMessage = 'Camera in use by another app.';
      } else if (err.name === 'OverconstrainedError') {
        // Try simpler constraints
        try {
          const simpleStream = await navigator.mediaDevices.getUserMedia({ video: true });
          streamRef.current = simpleStream;
          if (videoRef.current) {
            videoRef.current.srcObject = simpleStream;
            await videoRef.current.play();
            setCameraReady(true);
          }
          return;
        } catch {
          errorMessage = 'Could not access camera. Please use Upload.';
        }
      }

      setError(errorMessage);
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
    // Revoke object URLs
    capturedPhotos.forEach(p => {
      if (p.dataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(p.dataUrl);
      }
    });
    setCapturedPhotos([]);
    setError(null);
    setMode('camera');
  };

  const captureImage = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !canAddMore) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    const newPhoto: PendingPhoto = {
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      dataUrl,
    };

    setCapturedPhotos(prev => [...prev, newPhoto]);

    toast({
      title: `Photo ${capturedPhotos.length + 1} captured`,
      description: 'Tap capture for more, or Done to save.',
    });
  }, [capturedPhotos.length, canAddMore, toast]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = maxPhotos - totalPhotos;
    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    for (const file of filesToProcess) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          const newPhoto: PendingPhoto = {
            id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
            dataUrl,
          };
          setCapturedPhotos(prev => [...prev, newPhoto]);
        };
        reader.readAsDataURL(file);
      }
    }

    e.target.value = '';
  };

  const removePhoto = (photoId: string) => {
    setCapturedPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const handleDone = async () => {
    if (capturedPhotos.length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const uploadPromises = capturedPhotos.map(async (photo) => {
        // Convert dataUrl to blob
        const response = await fetch(photo.dataUrl);
        const blob = await response.blob();

        const path = tenantId ? `tenants/${tenantId}` : entityType;
        const fileName = `${path}/${entityId || 'temp'}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(fileName, blob, { contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from('photos')
          .getPublicUrl(fileName);

        return data.publicUrl;
      });

      const newUrls = await Promise.all(uploadPromises);
      const allUrls = [...existingPhotos, ...newUrls];

      onPhotosSaved(allUrls);

      toast({
        title: 'Photos saved',
        description: `${newUrls.length} photo(s) saved successfully.`,
      });

      onOpenChange(false);
    } catch (err) {
      console.error('Upload error:', err);
      setError('Failed to save photos. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden [&>button]:hidden">
        {/* Header - no dialog close button */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
          <span className="font-medium">
            Photos ({existingPhotos.length + capturedPhotos.length})
          </span>
          <Button size="sm" onClick={handleDone} disabled={saving}>
            {saving ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />
            ) : (
              <MaterialIcon name="check" size="sm" className="mr-1" />
            )}
            Done
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          {mode === 'upload' ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <MaterialIcon name="upload" className="h-8 w-8 text-primary" />
              </div>
              <p className="text-muted-foreground text-sm">Select photos to upload</p>
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
                Choose Photos
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode('camera')}>
                Or use camera
              </Button>
            </div>
          ) : (
            <>
              {/* Camera View */}
              <div className="aspect-[4/3] bg-black rounded-lg overflow-hidden relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                {!cameraReady && !error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <MaterialIcon name="progress_activity" className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}

                {capturedPhotos.length > 0 && (
                  <div className="absolute top-3 left-3 bg-black/60 text-white px-3 py-1 rounded-full text-sm">
                    {capturedPhotos.length} captured
                  </div>
                )}
              </div>

              {/* Capture Controls */}
              <div className="flex items-center justify-center gap-4">
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
                  disabled={!cameraReady || !canAddMore}
                  className="h-16 w-16 rounded-full"
                >
                  <MaterialIcon name="photo_camera" className="h-8 w-8" />
                </Button>

                <div className="h-12 w-12" /> {/* Spacer for balance */}
              </div>
            </>
          )}

          {/* Thumbnail strip */}
          {capturedPhotos.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs text-muted-foreground mb-2">
                Captured ({capturedPhotos.length}) - will be saved when you tap Done
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {capturedPhotos.map((photo, i) => (
                  <div
                    key={photo.id}
                    className="relative flex-shrink-0 h-16 w-16 rounded-lg border overflow-hidden"
                  >
                    <img
                      src={photo.dataUrl}
                      alt={`Photo ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => removePhoto(photo.id)}
                      className="absolute top-0.5 right-0.5 p-1 bg-destructive text-destructive-foreground rounded-full"
                    >
                      <MaterialIcon name="close" className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {canAddMore && mode === 'camera' && cameraReady && (
                  <button
                    onClick={captureImage}
                    className="flex-shrink-0 h-16 w-16 rounded-lg border-2 border-dashed flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                  >
                    <MaterialIcon name="add" size="md" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Existing photos indicator */}
          {existingPhotos.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {existingPhotos.length} existing photo{existingPhotos.length !== 1 ? 's' : ''} • 
              {maxPhotos - totalPhotos} slots remaining
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
