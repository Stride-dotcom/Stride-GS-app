import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { logItemActivity } from '@/lib/activity/logItemActivity';

export interface ItemPhoto {
  id: string;
  item_id: string;
  tenant_id: string;
  storage_key: string;
  storage_url: string | null;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  is_primary: boolean;
  needs_attention: boolean;
  is_repair: boolean;
  photo_type: 'general' | 'inspection' | 'repair' | 'receiving';
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  // For task photos that are linked to items
  source_task_id?: string;
  source_task_type?: string;
  source_task_title?: string;
  is_from_task?: boolean;
}

// Structure for photos stored in tasks.metadata.photos JSON field
interface TaskPhotoData {
  url: string;
  isPrimary?: boolean;
  needsAttention?: boolean;
  isRepair?: boolean;
}

// Interface for task metadata containing photos
interface TaskMetadata {
  photos?: (string | TaskPhotoData)[];
}

export function useItemPhotos(itemId: string | undefined, includeTaskPhotos: boolean = true) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [photos, setPhotos] = useState<ItemPhoto[]>([]);
  const [taskPhotos, setTaskPhotos] = useState<ItemPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPhotos = useCallback(async () => {
    if (!itemId) return;

    try {
      setLoading(true);

      // Fetch item photos
      const { data, error } = await (supabase
        .from('item_photos') as any)
        .select('*')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPhotos(data || []);

      // Also fetch task photos if enabled
      if (includeTaskPhotos) {
        await fetchTaskPhotos();
      }
    } catch (error) {
      console.error('Error fetching item photos:', error);
    } finally {
      setLoading(false);
    }
  }, [itemId, includeTaskPhotos]);

  const fetchTaskPhotos = useCallback(async () => {
    if (!itemId) return;

    try {
      // Find all tasks linked to this item via task_items
      // Note: photos are stored in metadata.photos, not a separate photos column
      const { data: taskItemsData, error: taskItemsError } = await (supabase
        .from('task_items') as any)
        .select(`
          task_id,
          task:tasks(
            id,
            title,
            task_type,
            metadata,
            created_at
          )
        `)
        .eq('item_id', itemId);

      if (taskItemsError) {
        console.error('Error fetching task items:', taskItemsError);
        return;
      }

      // Convert task photos to ItemPhoto format
      const convertedTaskPhotos: ItemPhoto[] = [];

      for (const taskItem of taskItemsData || []) {
        const task = taskItem.task;
        const taskMetadata = task?.metadata as TaskMetadata | null;
        const taskPhotos = taskMetadata?.photos;
        if (!task || !taskPhotos || !Array.isArray(taskPhotos)) continue;

        // Map task_type to photo_type
        const photoType = task.task_type === 'Inspection' ? 'inspection'
          : task.task_type === 'Repair' ? 'repair'
          : task.task_type === 'Assembly' ? 'general'
          : 'general';

        taskPhotos.forEach((photo: string | TaskPhotoData, index: number) => {
          const isPhotoObject = typeof photo === 'object' && photo !== null;
          const url: string = isPhotoObject ? (photo as TaskPhotoData).url : (photo as string);
          const isPrimary = isPhotoObject ? (photo as TaskPhotoData).isPrimary || false : false;
          const needsAttention = isPhotoObject ? (photo as TaskPhotoData).needsAttention || false : false;
          const isRepair = isPhotoObject ? (photo as TaskPhotoData).isRepair || false : false;

          convertedTaskPhotos.push({
            id: `task-${task.id}-photo-${index}`,
            item_id: itemId,
            tenant_id: profile?.tenant_id || '',
            storage_key: url,
            storage_url: url,
            file_name: `Task Photo ${index + 1}`,
            file_size: null,
            mime_type: 'image/jpeg',
            is_primary: isPrimary,
            needs_attention: needsAttention,
            is_repair: isRepair,
            photo_type: photoType as ItemPhoto['photo_type'],
            uploaded_by: null,
            created_at: task.created_at,
            updated_at: task.created_at,
            // Mark as from task
            source_task_id: task.id,
            source_task_type: task.task_type,
            source_task_title: task.title,
            is_from_task: true,
          });
        });
      }

      setTaskPhotos(convertedTaskPhotos);
    } catch (error) {
      console.error('Error fetching task photos:', error);
    }
  }, [itemId, profile?.tenant_id]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const addPhoto = async (
    file: File,
    photoType: ItemPhoto['photo_type'] = 'general'
  ): Promise<ItemPhoto | null> => {
    if (!profile?.tenant_id || !itemId) return null;

    try {
      const fileExt = file.name.split('.').pop();
      const storageKey = `items/${itemId}/${photoType}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(storageKey, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('photos')
        .getPublicUrl(storageKey);

      const { data, error } = await (supabase
        .from('item_photos') as any)
        .insert({
          item_id: itemId,
          tenant_id: profile.tenant_id,
          storage_key: storageKey,
          storage_url: urlData.publicUrl,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          photo_type: photoType,
          is_primary: false,
          needs_attention: false,
          is_repair: false,
          uploaded_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;

      logItemActivity({
        tenantId: profile.tenant_id,
        itemId,
        actorUserId: profile.id,
        eventType: 'item_photo_added',
        eventLabel: `Photo added (${photoType})`,
        details: { photo_id: data?.id, photo_type: photoType, file_name: file.name },
      });

      fetchPhotos();
      return data;
    } catch (error) {
      console.error('Error adding photo:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to upload photo',
      });
      return null;
    }
  };

  const setPrimaryPhoto = async (photoId: string) => {
    if (!itemId) return false;

    try {
      // Remove primary from all photos for this item
      await (supabase
        .from('item_photos') as any)
        .update({ is_primary: false })
        .eq('item_id', itemId);

      // Set new primary
      const { error } = await (supabase
        .from('item_photos') as any)
        .update({ is_primary: true })
        .eq('id', photoId);

      if (error) throw error;

      // Update item's primary_photo_url
      const photo = photos.find(p => p.id === photoId);
      if (photo) {
        await (supabase
          .from('items') as any)
          .update({ primary_photo_url: photo.storage_url })
          .eq('id', itemId);
      }

      toast({
        title: 'Primary Photo Set',
        description: 'This photo is now the primary photo for this item.',
      });

      fetchPhotos();
      return true;
    } catch (error) {
      console.error('Error setting primary photo:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to set primary photo',
      });
      return false;
    }
  };

  const toggleNeedsAttention = async (photoId: string, needsAttention: boolean) => {
    if (!profile?.tenant_id || !itemId) return false;

    try {
      const { error } = await (supabase
        .from('item_photos') as any)
        .update({ needs_attention: needsAttention })
        .eq('id', photoId);

      if (error) throw error;

      // Visual flag only — damage status is determined by inspection pass/fail
      if (needsAttention) {
        toast({
          title: 'Photo Flagged',
          description: 'Photo has been flagged as needing attention.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Flag Removed',
          description: 'Needs attention flag has been removed.',
        });
      }

      fetchPhotos();
      return true;
    } catch (error) {
      console.error('Error toggling needs attention:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update photo flag',
      });
      return false;
    }
  };

  const toggleRepair = async (photoId: string, isRepair: boolean) => {
    if (!profile?.tenant_id || !itemId) return false;

    try {
      const { error } = await (supabase
        .from('item_photos') as any)
        .update({ is_repair: isRepair })
        .eq('id', photoId);

      if (error) throw error;

      // If marking as repair, update item's needs_repair flag
      if (isRepair) {
        await (supabase
          .from('items') as any)
          .update({ needs_repair: true })
          .eq('id', itemId);

        toast({
          title: 'Repair Photo Tagged',
          description: 'Photo has been marked as a repair photo.',
        });
      } else {
        toast({
          title: 'Tag Removed',
          description: 'Repair tag has been removed.',
        });
      }

      fetchPhotos();
      return true;
    } catch (error) {
      console.error('Error toggling repair flag:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update photo flag',
      });
      return false;
    }
  };

  const deletePhoto = async (photoId: string) => {
    try {
      const photo = photos.find(p => p.id === photoId);
      if (photo) {
        // Delete from storage
        await supabase.storage.from('photos').remove([photo.storage_key]);
      }

      // Delete from database
      const { error } = await (supabase
        .from('item_photos') as any)
        .delete()
        .eq('id', photoId);

      if (error) throw error;

      toast({
        title: 'Photo Deleted',
        description: 'Photo has been removed.',
      });

      if (itemId && profile) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId,
          actorUserId: profile.id,
          eventType: 'item_photo_removed',
          eventLabel: 'Photo removed',
          details: { photo_id: photoId, file_name: photo?.file_name },
        });
      }

      fetchPhotos();
      return true;
    } catch (error) {
      console.error('Error deleting photo:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete photo',
      });
      return false;
    }
  };

  // Add photo from an already-uploaded URL (used by PhotoScanner)
  const addPhotoFromUrl = async (
    storageUrl: string,
    photoType: ItemPhoto['photo_type'] = 'general'
  ): Promise<ItemPhoto | null> => {
    if (!profile?.tenant_id || !itemId) return null;

    try {
      // Extract storage key from URL
      const urlParts = storageUrl.split('/photos/');
      const storageKey = urlParts[1] || `items/${itemId}/${Date.now()}.jpg`;

      const { data, error } = await (supabase
        .from('item_photos') as any)
        .insert({
          item_id: itemId,
          tenant_id: profile.tenant_id,
          storage_key: storageKey,
          storage_url: storageUrl,
          file_name: storageKey.split('/').pop() || 'photo.jpg',
          file_size: null,
          mime_type: 'image/jpeg',
          photo_type: photoType,
          is_primary: false,
          needs_attention: false,
          is_repair: false,
          uploaded_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;

      logItemActivity({
        tenantId: profile.tenant_id,
        itemId,
        actorUserId: profile.id,
        eventType: 'item_photo_added',
        eventLabel: `Photo added (${photoType})`,
        details: { photo_id: data?.id, photo_type: photoType, file_name: data?.file_name || null, source: 'scanner' },
      });

      return data;
    } catch (error) {
      console.error('Error adding photo from URL:', error);
      return null;
    }
  };

  // Add multiple photos from URLs (batch operation for PhotoScanner)
  const addPhotosFromUrls = async (
    urls: string[],
    photoType: ItemPhoto['photo_type'] = 'general'
  ): Promise<boolean> => {
    if (!profile?.tenant_id || !itemId || urls.length === 0) return false;

    try {
      const records = urls.map(url => {
        const urlParts = url.split('/photos/');
        const storageKey = urlParts[1] || `items/${itemId}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        return {
          item_id: itemId,
          tenant_id: profile.tenant_id,
          storage_key: storageKey,
          storage_url: url,
          file_name: storageKey.split('/').pop() || 'photo.jpg',
          file_size: null,
          mime_type: 'image/jpeg',
          photo_type: photoType,
          is_primary: false,
          needs_attention: false,
          is_repair: false,
          uploaded_by: profile.id,
        };
      });

      const { error } = await (supabase
        .from('item_photos') as any)
        .insert(records);

      if (error) throw error;

      logItemActivity({
        tenantId: profile.tenant_id,
        itemId,
        actorUserId: profile.id,
        eventType: 'item_photo_added',
        eventLabel: `Photos added (${photoType})`,
        details: { photo_type: photoType, count: urls.length, source: 'scanner' },
      });

      fetchPhotos();
      return true;
    } catch (error) {
      console.error('Error adding photos from URLs:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save photos',
      });
      return false;
    }
  };

  // Combine item photos with task photos for the "all photos" view
  const allPhotos = [...photos, ...taskPhotos];

  const primaryPhoto = photos.find(p => p.is_primary) || photos[0] || null;
  const needsAttentionPhotos = allPhotos.filter(p => p.needs_attention);
  const repairPhotos = allPhotos.filter(p => p.is_repair);

  return {
    photos,           // Only direct item photos
    taskPhotos,       // Only photos from linked tasks
    allPhotos,        // Combined: item photos + task photos
    primaryPhoto,
    needsAttentionPhotos,
    repairPhotos,
    loading,
    refetch: fetchPhotos,
    addPhoto,
    addPhotoFromUrl,
    addPhotosFromUrls,
    setPrimaryPhoto,
    toggleNeedsAttention,
    toggleRepair,
    deletePhoto,
  };
}
