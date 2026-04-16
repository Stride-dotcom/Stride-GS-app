import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { DropZone } from '@/components/common/DropZone';

interface PhotoCaptureProps {
  entityType: 'item' | 'shipment' | 'receiving' | 'inspection' | 'repair';
  entityId?: string;
  onPhotosChange: (urls: string[]) => void;
  existingPhotos?: string[];
  maxPhotos?: number;
  label?: string;
  acceptDocuments?: boolean;
}

export function PhotoCapture({
  entityType,
  entityId,
  onPhotosChange,
  existingPhotos = [],
  maxPhotos = 10,
  label = 'Photos',
  acceptDocuments = false,
}: PhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>(existingPhotos);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const acceptTypes = acceptDocuments
    ? 'image/*,application/pdf,.doc,.docx,.xls,.xlsx'
    : 'image/*';

  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${entityType}/${entityId || 'temp'}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('photos')
        .getPublicUrl(fileName);

      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading file:', error);
      return null;
    }
  };

  const processFiles = async (files: File[]) => {
    const remainingSlots = maxPhotos - photos.length;
    if (remainingSlots <= 0) {
      toast({
        title: 'Maximum photos reached',
        description: `You can only upload up to ${maxPhotos} photos.`,
        variant: 'destructive',
      });
      return;
    }

    const filesToUpload = files.slice(0, remainingSlots);
    setUploading(true);

    try {
      const uploadPromises = filesToUpload.map((file) => uploadFile(file));
      const results = await Promise.all(uploadPromises);
      const newUrls = results.filter((url): url is string => url !== null);

      const updatedPhotos = [...photos, ...newUrls];
      setPhotos(updatedPhotos);
      onPhotosChange(updatedPhotos);

      toast({
        title: 'Upload complete',
        description: `${newUrls.length} file(s) uploaded successfully.`,
      });
    } catch (error) {
      console.error('Error uploading files:', error);
      toast({
        title: 'Upload failed',
        description: 'Some files failed to upload. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(Array.from(files));
  };

  const removePhoto = async (urlToRemove: string) => {
    try {
      // Extract the path from the URL
      const urlParts = urlToRemove.split('/photos/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
        await supabase.storage.from('photos').remove([filePath]);
      }

      const updatedPhotos = photos.filter((url) => url !== urlToRemove);
      setPhotos(updatedPhotos);
      onPhotosChange(updatedPhotos);
    } catch (error) {
      console.error('Error removing photo:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove photo.',
        variant: 'destructive',
      });
    }
  };

  const isImageUrl = (url: string) => {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  };

  const handleDownload = async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const ext = isImageUrl(url) ? 'jpg' : url.split('.').pop() || 'file';
      a.download = `file-${index + 1}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: 'Download failed',
        description: 'Could not download the file.',
        variant: 'destructive',
      });
    }
  };

  return (
    <DropZone
      onFiles={processFiles}
      accept={acceptTypes}
      disabled={uploading}
      hint={photos.length < maxPhotos ? `Drag and drop ${acceptDocuments ? 'files' : 'photos'} here, or use the buttons below` : undefined}
    >
    <div className="space-y-3">
      {label && <Label>{label}</Label>}

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((url, index) => (
            <div
              key={index}
              className="relative aspect-square rounded-lg border overflow-hidden bg-muted group"
            >
              {isImageUrl(url) ? (
                <img
                  src={url}
                  alt={`Photo ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <MaterialIcon name="description" size="lg" className="text-muted-foreground" />
                </div>
              )}
              <div className="absolute top-1 right-1 flex gap-1">
                <button
                  type="button"
                  onClick={() => handleDownload(url, index)}
                  className="p-1 bg-blue-500 text-white rounded-full hover:bg-blue-600 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                >
                  <MaterialIcon name="download" className="text-xs" />
                </button>
                <button
                  type="button"
                  onClick={() => removePhoto(url)}
                  className="p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
                >
                  <MaterialIcon name="close" className="text-xs" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Buttons */}
      {photos.length < maxPhotos && (
        <div className="flex gap-2">
          {/* Camera Input (mobile) */}
          <Input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading}
            className="flex-1"
          >
            {uploading ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="photo_camera" size="sm" className="mr-2" />
            )}
            Take Photo
          </Button>

          {/* File Upload Input */}
          <Input
            ref={fileInputRef}
            type="file"
            accept={acceptTypes}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex-1"
          >
            {uploading ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="upload" size="sm" className="mr-2" />
            )}
            Upload {acceptDocuments ? 'Files' : 'Photos'}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {photos.length}/{maxPhotos} {acceptDocuments ? 'files' : 'photos'} uploaded
      </p>
    </div>
    </DropZone>
  );
}
