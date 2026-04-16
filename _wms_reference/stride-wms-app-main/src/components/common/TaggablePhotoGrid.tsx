/**
 * TaggablePhotoGrid Component
 * Displays a grid of photos with tagging support (primary, needs attention, repair)
 * Supports both simple URL strings and photo objects with metadata
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PhotoIndicatorChip } from '@/components/ui/PhotoIndicatorChip';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface TaggablePhoto {
  url: string;
  isPrimary?: boolean;
  needsAttention?: boolean;
  isRepair?: boolean;
}

// Normalize input to TaggablePhoto format
function normalizePhotos(input: (string | TaggablePhoto)[]): TaggablePhoto[] {
  return input.map(item => {
    if (typeof item === 'string') {
      return { url: item, isPrimary: false, needsAttention: false, isRepair: false };
    }
    return {
      url: item.url,
      isPrimary: item.isPrimary || false,
      needsAttention: item.needsAttention || false,
      isRepair: item.isRepair || false,
    };
  });
}

interface TaggablePhotoGridProps {
  photos: (string | TaggablePhoto)[];
  onPhotosChange?: (photos: TaggablePhoto[]) => void;
  readonly?: boolean;
  enableTagging?: boolean;
}

export function TaggablePhotoGrid({
  photos,
  onPhotosChange,
  readonly = false,
  enableTagging = true,
}: TaggablePhotoGridProps) {
  const { toast } = useToast();
  const [lightboxPhoto, setLightboxPhoto] = useState<TaggablePhoto | null>(null);

  const normalizedPhotos = normalizePhotos(photos);

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

      const updatedPhotos = normalizedPhotos.filter(p => p.url !== urlToRemove);
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

  const handleSetPrimary = (url: string) => {
    if (!onPhotosChange || readonly) return;

    const updatedPhotos = normalizedPhotos.map(p => ({
      ...p,
      isPrimary: p.url === url,
    }));
    onPhotosChange(updatedPhotos);
    toast({ title: 'Primary Photo Set' });
  };

  const handleToggleAttention = (url: string) => {
    if (!onPhotosChange || readonly) return;

    const updatedPhotos = normalizedPhotos.map(p =>
      p.url === url ? { ...p, needsAttention: !p.needsAttention } : p
    );
    onPhotosChange(updatedPhotos);

    const photo = updatedPhotos.find(p => p.url === url);
    toast({
      title: photo?.needsAttention ? 'Photo Flagged' : 'Flag Removed',
      description: photo?.needsAttention
        ? 'Photo marked as needing attention.'
        : 'Attention flag removed.',
      variant: photo?.needsAttention ? 'destructive' : 'default',
    });
  };

  const handleToggleRepair = (url: string) => {
    if (!onPhotosChange || readonly) return;

    const updatedPhotos = normalizedPhotos.map(p =>
      p.url === url ? { ...p, isRepair: !p.isRepair } : p
    );
    onPhotosChange(updatedPhotos);

    const photo = updatedPhotos.find(p => p.url === url);
    toast({
      title: photo?.isRepair ? 'Repair Photo Tagged' : 'Tag Removed',
      description: photo?.isRepair
        ? 'Photo marked as repair photo.'
        : 'Repair tag removed.',
    });
  };

  if (normalizedPhotos.length === 0) {
    return null;
  }

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {normalizedPhotos.map((photo, index) => {
          return (
            <div
              key={photo.url}
              className={cn(
                'relative aspect-square rounded-lg overflow-hidden bg-muted group cursor-pointer',
                photo.needsAttention && 'ring-2 ring-offset-2 ring-offset-background ring-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.3)]',
                photo.isRepair && !photo.needsAttention && 'ring-2 ring-offset-2 ring-offset-background ring-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.3)]',
                photo.isPrimary && !photo.needsAttention && !photo.isRepair && 'ring-2 ring-offset-2 ring-offset-background ring-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.3)]',
              )}
              onClick={() => setLightboxPhoto(photo)}
            >
              <img
                src={photo.url}
                alt={`Photo ${index + 1}`}
                className="w-full h-full object-cover"
              />

              {/* Tag badges - Glassmorphism chips */}
              {enableTagging && (photo.isPrimary || photo.needsAttention || photo.isRepair) && (
                <div className="absolute top-1 left-1 flex gap-1 flex-wrap">
                  {photo.isPrimary && (
                    <PhotoIndicatorChip type="primary" showLabel={false} />
                  )}
                  {photo.needsAttention && (
                    <PhotoIndicatorChip type="attention" showLabel={false} />
                  )}
                  {photo.isRepair && (
                    <PhotoIndicatorChip type="repair" showLabel={false} />
                  )}
                </div>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <MaterialIcon name="zoom_in" size="lg" className="text-white" />
              </div>

              {/* Action buttons - visible on mobile, hover on desktop */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <div className="flex gap-1 justify-end">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(photo.url, index);
                    }}
                    className="p-2 text-white hover:text-blue-400"
                  >
                    <MaterialIcon name="download" size="sm" />
                  </button>
                  {enableTagging && !readonly && onPhotosChange && (
                    <>
                      {!photo.isPrimary && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetPrimary(photo.url);
                          }}
                          className="p-2 text-amber-400 hover:text-amber-300"
                        >
                          <MaterialIcon name="star" size="sm" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleAttention(photo.url);
                        }}
                        className={`p-2 ${photo.needsAttention ? 'text-red-400 bg-red-500/20 rounded' : 'text-white'} hover:text-red-400`}
                      >
                        <MaterialIcon name="warning" size="sm" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleRepair(photo.url);
                        }}
                        className={`p-2 ${photo.isRepair ? 'text-green-400 bg-green-500/20 rounded' : 'text-white'} hover:text-green-400`}
                      >
                        <MaterialIcon name="build" size="sm" />
                      </button>
                    </>
                  )}
                  {!readonly && onPhotosChange && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(photo.url);
                      }}
                      className="p-2 text-white hover:text-destructive"
                    >
                      <MaterialIcon name="close" size="sm" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxPhoto} onOpenChange={() => setLightboxPhoto(null)}>
        <DialogContent className="w-[calc(100vw-1.5rem)] h-[calc(100dvh-1.5rem)] max-w-6xl max-h-[calc(100dvh-1.5rem)] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              Photo
              {lightboxPhoto?.isPrimary && (
                <PhotoIndicatorChip type="primary" />
              )}
              {lightboxPhoto?.needsAttention && (
                <PhotoIndicatorChip type="attention" />
              )}
              {lightboxPhoto?.isRepair && (
                <PhotoIndicatorChip type="repair" />
              )}
            </DialogTitle>
          </DialogHeader>
          {lightboxPhoto && (
            <div className="relative flex flex-col min-h-0 flex-1">
              <img
                src={lightboxPhoto.url}
                alt="Photo"
                className="w-full flex-1 min-h-0 object-contain rounded-lg bg-muted"
              />
              {/* Actions - icon-only on mobile, text buttons on desktop */}
              <div className="mt-3 sm:mt-4 shrink-0">
                <div className="flex flex-wrap justify-center gap-2 sm:hidden">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-full"
                    aria-label="Download photo"
                    title="Download"
                    onClick={() => {
                      const index = normalizedPhotos.findIndex(p => p.url === lightboxPhoto.url);
                      handleDownload(lightboxPhoto.url, index >= 0 ? index : 0);
                    }}
                  >
                    <MaterialIcon name="download" size="lg" />
                  </Button>

                  {enableTagging && !readonly && onPhotosChange && (
                    <>
                      {!lightboxPhoto.isPrimary && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12 rounded-full text-amber-500"
                          aria-label="Set as primary"
                          title="Set as Primary"
                          onClick={() => {
                            handleSetPrimary(lightboxPhoto.url);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="star" size="lg" />
                        </Button>
                      )}

                      <Button
                        variant={lightboxPhoto.needsAttention ? 'secondary' : 'outline'}
                        size="icon"
                        className={cn(
                          "h-12 w-12 rounded-full",
                          lightboxPhoto.needsAttention && "text-red-600 bg-red-500/10 hover:bg-red-500/15",
                        )}
                        aria-label={lightboxPhoto.needsAttention ? 'Remove attention flag' : 'Mark needs attention'}
                        title={lightboxPhoto.needsAttention ? 'Remove Attention Flag' : 'Mark Needs Attention'}
                        onClick={() => {
                          handleToggleAttention(lightboxPhoto.url);
                          setLightboxPhoto(null);
                        }}
                      >
                        <MaterialIcon name="warning" size="lg" />
                      </Button>

                      <Button
                        variant={lightboxPhoto.isRepair ? 'secondary' : 'outline'}
                        size="icon"
                        className={cn(
                          "h-12 w-12 rounded-full",
                          lightboxPhoto.isRepair && "text-green-700 bg-green-500/10 hover:bg-green-500/15",
                        )}
                        aria-label={lightboxPhoto.isRepair ? 'Remove repair tag' : 'Mark as repair'}
                        title={lightboxPhoto.isRepair ? 'Remove Repair Tag' : 'Mark as Repair'}
                        onClick={() => {
                          handleToggleRepair(lightboxPhoto.url);
                          setLightboxPhoto(null);
                        }}
                      >
                        <MaterialIcon name="build" size="lg" />
                      </Button>
                    </>
                  )}

                  {!readonly && onPhotosChange && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-12 w-12 rounded-full"
                      aria-label="Delete photo"
                      title="Delete"
                      onClick={() => {
                        handleDelete(lightboxPhoto.url);
                        setLightboxPhoto(null);
                      }}
                    >
                      <MaterialIcon name="delete" size="lg" />
                    </Button>
                  )}
                </div>

                <div className="hidden sm:flex gap-2 justify-end flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const index = normalizedPhotos.findIndex(p => p.url === lightboxPhoto.url);
                      handleDownload(lightboxPhoto.url, index >= 0 ? index : 0);
                    }}
                  >
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                    Download
                  </Button>
                  {enableTagging && !readonly && onPhotosChange && (
                    <>
                      {!lightboxPhoto.isPrimary && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            handleSetPrimary(lightboxPhoto.url);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="star" size="sm" className="mr-2" />
                          Set as Primary
                        </Button>
                      )}
                      <Button
                        variant={lightboxPhoto.needsAttention ? 'secondary' : 'outline'}
                        onClick={() => {
                          handleToggleAttention(lightboxPhoto.url);
                          setLightboxPhoto(null);
                        }}
                      >
                        <MaterialIcon name="warning" size="sm" className="mr-2" />
                        {lightboxPhoto.needsAttention ? 'Remove Attention Flag' : 'Mark Needs Attention'}
                      </Button>
                      <Button
                        variant={lightboxPhoto.isRepair ? 'secondary' : 'outline'}
                        className={lightboxPhoto.isRepair ? 'bg-green-100 hover:bg-green-200 text-green-700' : ''}
                        onClick={() => {
                          handleToggleRepair(lightboxPhoto.url);
                          setLightboxPhoto(null);
                        }}
                      >
                        <MaterialIcon name="build" size="sm" className="mr-2" />
                        {lightboxPhoto.isRepair ? 'Remove Repair Tag' : 'Mark as Repair'}
                      </Button>
                    </>
                  )}
                  {!readonly && onPhotosChange && (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        handleDelete(lightboxPhoto.url);
                        setLightboxPhoto(null);
                      }}
                    >
                      <MaterialIcon name="close" size="sm" className="mr-2" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Export helper to convert TaggablePhoto[] back to simple string[] if needed
export function getPhotoUrls(photos: (string | TaggablePhoto)[]): string[] {
  return photos.map(p => (typeof p === 'string' ? p : p.url));
}
