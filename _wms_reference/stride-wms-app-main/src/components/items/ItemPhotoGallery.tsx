import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PhotoIndicatorChip } from '@/components/ui/PhotoIndicatorChip';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useItemPhotos, ItemPhoto } from '@/hooks/useItemPhotos';
import { PhotoScanner } from '@/components/common/PhotoScanner';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { DropZone } from '@/components/common/DropZone';

interface ItemPhotoGalleryProps {
  itemId: string;
  isClientUser?: boolean;
}

export function ItemPhotoGallery({ itemId, isClientUser = false }: ItemPhotoGalleryProps) {
  const { profile } = useAuth();
  const {
    photos,
    taskPhotos,
    allPhotos,
    primaryPhoto,
    needsAttentionPhotos,
    repairPhotos,
    loading,
    addPhoto,
    addPhotosFromUrls,
    setPrimaryPhoto,
    toggleNeedsAttention,
    toggleRepair,
    deletePhoto,
  } = useItemPhotos(itemId);
  const { toast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [lightboxPhoto, setLightboxPhoto] = useState<ItemPhoto | null>(null);
  const [photoType, setPhotoType] = useState<ItemPhoto['photo_type']>('general');
  const [filterNeedsAttention, setFilterNeedsAttention] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const handleDownload = async (photo: ItemPhoto) => {
    try {
      const response = await fetch(photo.storage_url || '');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = photo.file_name || `photo-${photo.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: 'Download failed',
        description: 'Could not download the photo.',
        variant: 'destructive',
      });
    }
  };

  const processDroppedFiles = async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setUploading(true);
    for (const file of imageFiles) {
      await addPhoto(file, photoType);
    }
    setUploading(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    for (const file of Array.from(files)) {
      await addPhoto(file, photoType);
    }
    setUploading(false);

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle photos from PhotoScanner - save URLs to item_photos table
  const handleScannerPhotosSaved = async (urls: string[]) => {
    // Filter to only new URLs (not already in existing photos)
    const existingUrls = photos.map(p => p.storage_url);
    const newUrls = urls.filter(url => !existingUrls.includes(url));

    if (newUrls.length === 0) {
      return;
    }

    const success = await addPhotosFromUrls(newUrls, photoType);
    if (success) {
      toast({
        title: 'Photos saved',
        description: `${newUrls.length} photo(s) added to item.`,
      });
    }
  };

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotos(prev =>
      prev.includes(photoId)
        ? prev.filter(id => id !== photoId)
        : [...prev, photoId]
    );
  };

  const handleSetPrimary = async (photoId: string) => {
    await setPrimaryPhoto(photoId);
  };

  const handleToggleAttention = async (photoId: string, current: boolean) => {
    await toggleNeedsAttention(photoId, !current);
  };

  const handleToggleRepair = async (photoId: string, current: boolean) => {
    await toggleRepair(photoId, !current);
  };

  const handleDelete = async (photoId: string) => {
    await deletePhoto(photoId);
  };

  // Filter photos by type and attention flag (using allPhotos which includes task photos)
  const getFilteredPhotos = (type?: ItemPhoto['photo_type']) => {
    let filtered = type ? allPhotos.filter(p => p.photo_type === type) : allPhotos;
    if (filterNeedsAttention) {
      filtered = filtered.filter(p => p.needs_attention);
    }
    return filtered;
  };

  // Helper to check if a photo is from a task (read-only)
  const isTaskPhoto = (photo: ItemPhoto) => photo.is_from_task === true;

  const renderPhotoGrid = (photosToRender: ItemPhoto[]) => (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
      {photosToRender.map((photo) => {
        return (
          <div
            key={photo.id}
            className={cn(
              'relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer group',
              photo.needs_attention && 'ring-2 ring-offset-2 ring-offset-background ring-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.3)]',
              photo.is_repair && !photo.needs_attention && 'ring-2 ring-offset-2 ring-offset-background ring-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.3)]',
              photo.is_primary && !photo.needs_attention && !photo.is_repair && 'ring-2 ring-offset-2 ring-offset-background ring-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.3)]',
            )}
            onClick={() => setLightboxPhoto(photo)}
          >
          <img
            src={photo.storage_url || ''}
            alt={photo.file_name}
            className="w-full h-full object-cover"
          />

          {/* Overlay badges - Glassmorphism chips */}
          <div className="absolute top-1 left-1 flex gap-1 flex-wrap max-w-[calc(100%-2rem)]">
            {isTaskPhoto(photo) && (
              <Badge className="h-6 text-xs bg-blue-600 text-white px-2 shadow-md border border-blue-700">
                <MaterialIcon name="assignment" className="text-[12px] mr-1" />
                {photo.source_task_type || 'Task'}
              </Badge>
            )}
            {photo.is_primary && !isTaskPhoto(photo) && (
              <PhotoIndicatorChip type="primary" />
            )}
            {photo.needs_attention && (
              <PhotoIndicatorChip type="attention" />
            )}
            {photo.is_repair && (
              <PhotoIndicatorChip type="repair" />
            )}
          </div>

          {/* Selection checkbox (for staff) - only for non-task photos */}
          {!isClientUser && !isTaskPhoto(photo) && (
            <div
              className="absolute top-1 right-1"
              onClick={(e) => {
                e.stopPropagation();
                togglePhotoSelection(photo.id);
              }}
            >
              <Checkbox
                checked={selectedPhotos.includes(photo.id)}
                className="h-5 w-5 bg-background border-2"
              />
            </div>
          )}

          {/* Hover actions - always visible on mobile */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <div className="flex gap-2 justify-end">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-white hover:text-blue-400 hover:bg-blue-500/20"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(photo);
                }}
              >
                <MaterialIcon name="download" size="md" />
              </Button>
              {/* Only show editing actions for non-task photos (task photos are read-only from item view) */}
              {!isClientUser && !isTaskPhoto(photo) && (
                <>
                  {!photo.is_primary && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-amber-400 hover:text-amber-300 hover:bg-amber-500/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetPrimary(photo.id);
                      }}
                    >
                      <MaterialIcon name="star" size="md" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-8 w-8 ${photo.needs_attention ? 'text-red-400 bg-red-500/20' : 'text-white'} hover:text-red-400 hover:bg-red-500/20`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleAttention(photo.id, photo.needs_attention);
                    }}
                  >
                    <MaterialIcon name="warning" size="md" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-8 w-8 ${photo.is_repair ? 'text-green-400 bg-green-500/20' : 'text-white'} hover:text-green-400 hover:bg-green-500/20`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleRepair(photo.id, photo.is_repair);
                    }}
                  >
                    <MaterialIcon name="build" size="md" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-white hover:text-destructive hover:bg-destructive/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(photo.id);
                    }}
                  >
                    <MaterialIcon name="close" size="md" />
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Zoom icon - hidden on mobile for cleaner UI */}
          <div className="absolute inset-0 hidden sm:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <MaterialIcon name="zoom_in" className="text-[32px] text-white drop-shadow-lg" />
          </div>
        </div>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <DropZone
        onFiles={processDroppedFiles}
        accept="image/*"
        disabled={uploading || isClientUser}
        hint={!isClientUser ? 'Drag and drop photos here, or use the buttons above' : undefined}
      >
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <span>📸</span>
              Photos ({allPhotos.length})
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {taskPhotos.length > 0
                ? `Item photos and ${taskPhotos.length} from tasks`
                : 'Photos for this item'}
              {needsAttentionPhotos.length > 0 && ` · ${needsAttentionPhotos.length} need attention`}
            </p>
          </div>
        </CardHeader>
        <CardContent className="pb-6">
          {allPhotos.length === 0 ? (
            <div className="text-center py-8">
              <MaterialIcon name="photo_camera" className="mx-auto text-[48px] text-muted-foreground" />
              <p className="mt-2 text-muted-foreground">
                {isClientUser
                  ? 'No photos available for this item.'
                  : 'No photos yet'}
              </p>
            </div>
          ) : (
            <Tabs defaultValue="all" onValueChange={(v) => setPhotoType(v as ItemPhoto['photo_type'])}>
              <div className="overflow-x-auto -mx-1 px-1 pb-2">
                <TabsList className="w-full min-w-max grid grid-cols-4 mb-4">
                  <TabsTrigger value="all" className="text-xs sm:text-sm px-2 sm:px-3">
                    All ({allPhotos.length})
                  </TabsTrigger>
                  <TabsTrigger value="general" className="text-xs sm:text-sm px-2 sm:px-3">
                    General ({allPhotos.filter(p => p.photo_type === 'general').length})
                  </TabsTrigger>
                  <TabsTrigger value="inspection" className="text-xs sm:text-sm px-2 sm:px-3">
                    Inspect ({allPhotos.filter(p => p.photo_type === 'inspection').length})
                  </TabsTrigger>
                  <TabsTrigger value="repair" className="text-xs sm:text-sm px-2 sm:px-3">
                    Repair ({allPhotos.filter(p => p.photo_type === 'repair').length})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="all">
                {renderPhotoGrid(getFilteredPhotos())}
              </TabsContent>
              <TabsContent value="general">
                {renderPhotoGrid(getFilteredPhotos('general'))}
              </TabsContent>
              <TabsContent value="inspection">
                {renderPhotoGrid(getFilteredPhotos('inspection'))}
              </TabsContent>
              <TabsContent value="repair">
                {renderPhotoGrid(getFilteredPhotos('repair'))}
              </TabsContent>
            </Tabs>
          )}

          {/* Action buttons - centered at bottom */}
          {!isClientUser && (
            <div className="flex justify-center gap-3 mt-6 pt-4 border-t">
              <Button
                variant={filterNeedsAttention ? 'secondary' : 'outline'}
                onClick={() => setFilterNeedsAttention(!filterNeedsAttention)}
              >
                <MaterialIcon name="filter_list" size="sm" className="mr-2" />
                Filter
              </Button>

              <Button
                variant="outline"
                onClick={() => setScannerOpen(true)}
                disabled={uploading}
              >
                <MaterialIcon name="photo_camera" size="sm" className="mr-2" />
                Take Photo
              </Button>

              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
                ) : (
                  <MaterialIcon name="upload" size="sm" className="mr-2" />
                )}
                Upload
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      </DropZone>

      {/* Lightbox Dialog */}
      <Dialog open={!!lightboxPhoto} onOpenChange={() => setLightboxPhoto(null)}>
        <DialogContent className="w-[calc(100vw-1.5rem)] h-[calc(100dvh-1.5rem)] max-w-6xl max-h-[calc(100dvh-1.5rem)] overflow-hidden">
          <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
              Photo
              {lightboxPhoto && isTaskPhoto(lightboxPhoto) && (
                <Badge className="bg-blue-600 text-white">
                  <MaterialIcon name="assignment" className="text-[12px] mr-1" />
                  From {lightboxPhoto.source_task_type || 'Task'}
                </Badge>
              )}
              {lightboxPhoto?.is_primary && !lightboxPhoto?.is_from_task && (
                <PhotoIndicatorChip type="primary" />
              )}
              {/* Tappable attention chip - click to toggle for staff */}
              {lightboxPhoto?.needs_attention && !isClientUser && !isTaskPhoto(lightboxPhoto) && (
                <span
                  className="cursor-pointer"
                  onClick={() => {
                    handleToggleAttention(lightboxPhoto.id, lightboxPhoto.needs_attention);
                    setLightboxPhoto(null);
                  }}
                >
                  <PhotoIndicatorChip type="attention" />
                </span>
              )}
              {lightboxPhoto?.needs_attention && (isClientUser || isTaskPhoto(lightboxPhoto)) && (
                <PhotoIndicatorChip type="attention" />
              )}
              {/* Tappable repair chip - click to toggle for staff */}
              {lightboxPhoto?.is_repair && !isClientUser && !isTaskPhoto(lightboxPhoto) && (
                <span
                  className="cursor-pointer"
                  onClick={() => {
                    handleToggleRepair(lightboxPhoto.id, lightboxPhoto.is_repair);
                    setLightboxPhoto(null);
                  }}
                >
                  <PhotoIndicatorChip type="repair" />
                </span>
              )}
              {lightboxPhoto?.is_repair && (isClientUser || isTaskPhoto(lightboxPhoto)) && (
                <PhotoIndicatorChip type="repair" />
              )}
            </DialogTitle>
          </DialogHeader>
          {lightboxPhoto && (
            <div className="relative flex flex-col min-h-0 flex-1">
              {/* Task info banner for task photos */}
              {isTaskPhoto(lightboxPhoto) && lightboxPhoto.source_task_title && (
                <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm flex items-center gap-2">
                  <MaterialIcon name="assignment" size="sm" className="text-blue-600" />
                  <span className="text-muted-foreground">From task:</span>
                  <a
                    href={`/tasks/${lightboxPhoto.source_task_id}`}
                    className="text-blue-600 hover:underline font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {lightboxPhoto.source_task_title}
                  </a>
                </div>
              )}
              <img
                src={lightboxPhoto.storage_url || ''}
                alt={lightboxPhoto.file_name}
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
                    onClick={() => handleDownload(lightboxPhoto)}
                  >
                    <MaterialIcon name="download" size="lg" />
                  </Button>

                  {/* Only show editing actions for non-task photos */}
                  {!isClientUser && !isTaskPhoto(lightboxPhoto) && (
                    <>
                      {!lightboxPhoto.is_primary && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12 rounded-full text-amber-500"
                          aria-label="Set as primary"
                          title="Set as Primary"
                          onClick={() => {
                            handleSetPrimary(lightboxPhoto.id);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="star" size="lg" />
                        </Button>
                      )}
                      {/* Add flag buttons only shown when flags are NOT set */}
                      {!lightboxPhoto.needs_attention && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12 rounded-full text-red-600"
                          aria-label="Mark needs attention"
                          title="attention"
                          onClick={() => {
                            handleToggleAttention(lightboxPhoto.id, false);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="warning" size="lg" />
                        </Button>
                      )}
                      {!lightboxPhoto.is_repair && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12 rounded-full text-green-700"
                          aria-label="Mark as repair"
                          title="repair"
                          onClick={() => {
                            handleToggleRepair(lightboxPhoto.id, false);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="build" size="lg" />
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-12 w-12 rounded-full"
                        aria-label="Delete photo"
                        title="Delete"
                        onClick={() => {
                          handleDelete(lightboxPhoto.id);
                          setLightboxPhoto(null);
                        }}
                      >
                        <MaterialIcon name="delete" size="lg" />
                      </Button>
                    </>
                  )}
                </div>

                <div className="hidden sm:flex gap-2 justify-end flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => handleDownload(lightboxPhoto)}
                  >
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                    Download
                  </Button>
                  {/* Only show editing actions for non-task photos */}
                  {!isClientUser && !isTaskPhoto(lightboxPhoto) && (
                    <>
                      {!lightboxPhoto.is_primary && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            handleSetPrimary(lightboxPhoto.id);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="star" size="sm" className="mr-2" />
                          Set as Primary
                        </Button>
                      )}
                      {/* Add flag buttons only shown when flags are NOT set */}
                      {!lightboxPhoto.needs_attention && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            handleToggleAttention(lightboxPhoto.id, false);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="warning" size="sm" className="mr-2" />
                          attention
                        </Button>
                      )}
                      {!lightboxPhoto.is_repair && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            handleToggleRepair(lightboxPhoto.id, false);
                            setLightboxPhoto(null);
                          }}
                        >
                          <MaterialIcon name="build" size="sm" className="mr-2" />
                          repair
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        onClick={() => {
                          handleDelete(lightboxPhoto.id);
                          setLightboxPhoto(null);
                        }}
                      >
                        <MaterialIcon name="close" size="sm" className="mr-2" />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PhotoScanner Dialog */}
      <PhotoScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        entityType="item"
        entityId={itemId}
        tenantId={profile?.tenant_id}
        existingPhotos={photos.map(p => p.storage_url || '')}
        maxPhotos={50}
        onPhotosSaved={handleScannerPhotosSaved}
      />
    </>
  );
}
