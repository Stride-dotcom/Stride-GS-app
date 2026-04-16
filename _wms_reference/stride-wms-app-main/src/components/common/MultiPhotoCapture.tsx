import { useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { DropZone } from '@/components/common/DropZone';

interface PendingPhoto {
  id: string;
  file: File;
  preview: string;
}

interface MultiPhotoCaptureProps {
  entityType: 'item' | 'shipment' | 'receiving' | 'inspection' | 'repair' | 'task' | 'claim';
  entityId?: string;
  tenantId?: string;
  onPhotosSaved: (urls: string[]) => void;
  existingPhotos?: string[];
  maxPhotos?: number;
  label?: string;
}

export function MultiPhotoCapture({
  entityType,
  entityId,
  tenantId,
  onPhotosSaved,
  existingPhotos = [],
  maxPhotos = 10,
  label = 'Photos',
}: MultiPhotoCaptureProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [savedPhotos, setSavedPhotos] = useState<string[]>(existingPhotos);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const totalPhotos = savedPhotos.length + pendingPhotos.length;
  const canAddMore = totalPhotos < maxPhotos;

  // Handle camera capture
  const handleCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = maxPhotos - totalPhotos;
    if (remainingSlots <= 0) {
      toast({
        title: 'Maximum photos reached',
        description: `You can only have up to ${maxPhotos} photos.`,
        variant: 'destructive',
      });
      return;
    }

    const filesToAdd = Array.from(files).slice(0, remainingSlots);
    const newPendingPhotos: PendingPhoto[] = filesToAdd.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      file,
      preview: URL.createObjectURL(file),
    }));

    setPendingPhotos(prev => [...prev, ...newPendingPhotos]);

    // Reset input
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }, [totalPhotos, maxPhotos, toast]);

  // Remove pending photo
  const removePendingPhoto = useCallback((id: string) => {
    setPendingPhotos(prev => {
      const photo = prev.find(p => p.id === id);
      if (photo) {
        URL.revokeObjectURL(photo.preview);
      }
      return prev.filter(p => p.id !== id);
    });
  }, []);

  // Download a saved photo
  const handleDownload = useCallback(async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `photo-${index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: 'Download failed',
        description: 'Could not download the photo.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  // Remove saved photo
  const removeSavedPhoto = useCallback(async (urlToRemove: string) => {
    try {
      const urlParts = urlToRemove.split('/photos/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
        await supabase.storage.from('photos').remove([filePath]);
      }

      const updatedPhotos = savedPhotos.filter(url => url !== urlToRemove);
      setSavedPhotos(updatedPhotos);
      onPhotosSaved(updatedPhotos);
    } catch (error) {
      console.error('Error removing photo:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove photo.',
        variant: 'destructive',
      });
    }
  }, [savedPhotos, onPhotosSaved, toast]);

  // Clear all pending photos
  const clearPending = useCallback(() => {
    pendingPhotos.forEach(p => URL.revokeObjectURL(p.preview));
    setPendingPhotos([]);
  }, [pendingPhotos]);

  // Save all pending photos
  const saveAllPhotos = useCallback(async () => {
    if (pendingPhotos.length === 0) return;

    setSaving(true);
    try {
      const uploadPromises = pendingPhotos.map(async (photo) => {
        const fileExt = photo.file.name.split('.').pop();
        const path = tenantId ? `tenants/${tenantId}` : entityType;
        const fileName = `${path}/${entityId || 'temp'}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(fileName, photo.file);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from('photos')
          .getPublicUrl(fileName);

        return data.publicUrl;
      });

      const urls = await Promise.all(uploadPromises);
      const allUrls = [...savedPhotos, ...urls];

      // Clean up previews
      pendingPhotos.forEach(p => URL.revokeObjectURL(p.preview));

      setSavedPhotos(allUrls);
      setPendingPhotos([]);
      onPhotosSaved(allUrls);

      toast({
        title: 'Photos saved',
        description: `${urls.length} photo(s) saved successfully.`,
      });
    } catch (error) {
      console.error('Error saving photos:', error);
      toast({
        title: 'Save failed',
        description: 'Some photos failed to save. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [pendingPhotos, savedPhotos, entityType, entityId, tenantId, onPhotosSaved, toast]);

  const handleDroppedFiles = useCallback((files: File[]) => {
    const remainingSlots = maxPhotos - totalPhotos;
    if (remainingSlots <= 0) {
      toast({
        title: 'Maximum photos reached',
        description: `You can only have up to ${maxPhotos} photos.`,
        variant: 'destructive',
      });
      return;
    }

    const imageFiles = files.filter(f => f.type.startsWith('image/')).slice(0, remainingSlots);
    const newPendingPhotos: PendingPhoto[] = imageFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      file,
      preview: URL.createObjectURL(file),
    }));

    setPendingPhotos(prev => [...prev, ...newPendingPhotos]);
  }, [totalPhotos, maxPhotos, toast]);

  return (
    <DropZone
      onFiles={handleDroppedFiles}
      accept="image/*"
      disabled={saving}
      hint={canAddMore ? 'Drag and drop photos here, or use the buttons below' : undefined}
    >
    <div className="space-y-4">
      {label && <Label className="text-base font-medium">{label}</Label>}

      {/* Saved Photos */}
      {savedPhotos.length > 0 && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">Saved ({savedPhotos.length})</p>
          <div className="grid grid-cols-4 gap-2">
            {savedPhotos.map((url, index) => (
              <div
                key={url}
                className="relative aspect-square rounded-lg border overflow-hidden bg-muted group"
              >
                <img
                  src={url}
                  alt={`Saved ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-1 right-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleDownload(url, index)}
                    className="p-1 bg-blue-500 text-white rounded-full hover:bg-blue-600 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  >
                    <MaterialIcon name="download" className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSavedPhoto(url)}
                    className="p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
                  >
                    <MaterialIcon name="close" className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Photos (not yet saved) */}
      {pendingPhotos.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">
              Pending ({pendingPhotos.length}) - not saved yet
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearPending}
              className="text-destructive hover:text-destructive"
            >
              <MaterialIcon name="delete" className="h-3 w-3 mr-1" />
              Clear All
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-2 p-2 border-2 border-dashed border-primary/50 rounded-lg bg-primary/5">
            {pendingPhotos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square rounded-lg border overflow-hidden bg-muted"
              >
                <img
                  src={photo.preview}
                  alt="Pending"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePendingPhoto(photo.id)}
                  className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
                >
                  <MaterialIcon name="close" className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {/* Camera Input */}
        <Input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleCapture}
          className="hidden"
        />

        {canAddMore && (
          <Button
            type="button"
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            disabled={saving}
            className="flex-1"
          >
            <MaterialIcon name="photo_camera" size="sm" className="mr-2" />
            Take Photo
          </Button>
        )}

        {pendingPhotos.length > 0 && (
          <Button
            type="button"
            onClick={saveAllPhotos}
            disabled={saving}
            className="flex-1"
          >
            {saving ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="save" size="sm" className="mr-2" />
            )}
            Save {pendingPhotos.length} Photo{pendingPhotos.length > 1 ? 's' : ''}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {totalPhotos}/{maxPhotos} photos ({savedPhotos.length} saved, {pendingPhotos.length} pending)
      </p>
    </div>
    </DropZone>
  );
}
