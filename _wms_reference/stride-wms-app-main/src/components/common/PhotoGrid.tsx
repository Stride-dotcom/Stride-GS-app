/**
 * PhotoGrid Component
 * Displays a grid of photos with download and delete actions
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';

interface PhotoGridProps {
  photos: string[];
  onPhotosChange?: (urls: string[]) => void;
  readonly?: boolean;
}

export function PhotoGrid({
  photos,
  onPhotosChange,
  readonly = false,
}: PhotoGridProps) {
  const { toast } = useToast();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const handleDownload = async (url: string, index: number) => {
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
  };

  const handleDelete = async (urlToRemove: string) => {
    if (!onPhotosChange) return;

    try {
      // Extract the path from the URL
      const urlParts = urlToRemove.split('/photos/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
        await supabase.storage.from('photos').remove([filePath]);
      }

      const updatedPhotos = photos.filter(url => url !== urlToRemove);
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

  if (photos.length === 0) {
    return null;
  }

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {photos.map((url, index) => (
          <div
            key={url}
            className="relative aspect-square rounded-lg border overflow-hidden bg-muted group cursor-pointer"
            onClick={() => setLightboxUrl(url)}
          >
            <img
              src={url}
              alt={`Photo ${index + 1}`}
              className="w-full h-full object-cover"
            />

            {/* Hover overlay with actions */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <MaterialIcon name="zoom_in" size="lg" className="text-white" />
            </div>

            {/* Action buttons - always visible on touch, hover on desktop */}
            <div className="absolute top-1 right-1 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(url, index);
                }}
                className="p-1.5 bg-blue-500 text-white rounded-full hover:bg-blue-600 shadow-sm"
              >
                <MaterialIcon name="download" className="h-3 w-3" />
              </button>
              {!readonly && onPhotosChange && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(url);
                  }}
                  className="p-1.5 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 shadow-sm"
                >
                  <MaterialIcon name="close" className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="w-[calc(100vw-1.5rem)] h-[calc(100dvh-1.5rem)] max-w-6xl max-h-[calc(100dvh-1.5rem)] overflow-hidden p-3 sm:p-4">
          {lightboxUrl && (
            <div className="relative flex flex-col min-h-0 flex-1">
              <img
                src={lightboxUrl}
                alt="Photo"
                className="w-full flex-1 min-h-0 object-contain rounded-lg bg-muted"
              />
              <div className="flex gap-2 mt-3 justify-center sm:justify-end flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const index = photos.indexOf(lightboxUrl);
                    handleDownload(lightboxUrl, index >= 0 ? index : 0);
                  }}
                >
                  <MaterialIcon name="download" size="sm" className="mr-1" />
                  Download
                </Button>
                {!readonly && onPhotosChange && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      handleDelete(lightboxUrl);
                      setLightboxUrl(null);
                    }}
                  >
                    <MaterialIcon name="close" size="sm" className="mr-1" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
