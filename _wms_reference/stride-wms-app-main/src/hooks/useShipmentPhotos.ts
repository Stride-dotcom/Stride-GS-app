import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface ShipmentPhoto {
  id: string;
  tenant_id: string;
  shipment_id: string;
  storage_key: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  category: 'PAPERWORK' | 'CONDITION' | 'OTHER';
  is_primary: boolean;
  uploaded_by: string | null;
  created_at: string;
  url?: string;
}

interface UseShipmentPhotosReturn {
  photos: ShipmentPhoto[];
  loading: boolean;
  uploadPhoto: (file: File, category: ShipmentPhoto['category']) => Promise<ShipmentPhoto | null>;
  deletePhoto: (photoId: string) => Promise<boolean>;
  refetch: () => Promise<void>;
  paperworkCount: number;
  conditionCount: number;
}

export function useShipmentPhotos(shipmentId: string | undefined): UseShipmentPhotosReturn {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [photos, setPhotos] = useState<ShipmentPhoto[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPhotos = useCallback(async () => {
    if (!shipmentId || !profile?.tenant_id) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('shipment_photos')
        .select('*')
        .eq('shipment_id', shipmentId)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Generate public URLs for each photo
      const photosWithUrls = (data || []).map((p: ShipmentPhoto) => {
        const { data: urlData } = supabase.storage
          .from('photos')
          .getPublicUrl(p.storage_key);
        return { ...p, url: urlData?.publicUrl || '' };
      });

      setPhotos(photosWithUrls);
    } catch (err) {
      console.error('[useShipmentPhotos] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [shipmentId, profile?.tenant_id]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const uploadPhoto = useCallback(async (
    file: File,
    category: ShipmentPhoto['category']
  ): Promise<ShipmentPhoto | null> => {
    if (!shipmentId || !profile?.tenant_id || !profile?.id) return null;

    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `${profile.tenant_id}/shipments/${shipmentId}/${category}/${timestamp}_${safeFileName}`;

    try {
      // Upload to photos bucket
      const { error: uploadError } = await supabase.storage
        .from('photos')
        .upload(storageKey, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('photos')
        .getPublicUrl(storageKey);

      // Insert record
      const { data, error } = await (supabase as any)
        .from('shipment_photos')
        .insert({
          tenant_id: profile.tenant_id,
          shipment_id: shipmentId,
          storage_key: storageKey,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          category,
          is_primary: false,
          uploaded_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;

      const photo: ShipmentPhoto = { ...data, url: urlData?.publicUrl || '' };
      setPhotos(prev => [...prev, photo]);
      return photo;
    } catch (err: any) {
      console.error('[useShipmentPhotos] upload error:', err);
      toast({
        variant: 'destructive',
        title: 'Upload Failed',
        description: err?.message || 'Failed to upload photo',
      });
      return null;
    }
  }, [shipmentId, profile?.tenant_id, profile?.id, toast]);

  const deletePhoto = useCallback(async (photoId: string): Promise<boolean> => {
    const photo = photos.find(p => p.id === photoId);
    if (!photo) return false;

    try {
      // Delete from storage
      await supabase.storage.from('photos').remove([photo.storage_key]);

      // Delete record
      const { error } = await (supabase as any)
        .from('shipment_photos')
        .delete()
        .eq('id', photoId);

      if (error) throw error;

      setPhotos(prev => prev.filter(p => p.id !== photoId));
      return true;
    } catch (err: any) {
      console.error('[useShipmentPhotos] delete error:', err);
      toast({
        variant: 'destructive',
        title: 'Delete Failed',
        description: err?.message || 'Failed to delete photo',
      });
      return false;
    }
  }, [photos, toast]);

  const paperworkCount = photos.filter(p => p.category === 'PAPERWORK').length;
  const conditionCount = photos.filter(p => p.category === 'CONDITION').length;

  return {
    photos,
    loading,
    uploadPhoto,
    deletePhoto,
    refetch: fetchPhotos,
    paperworkCount,
    conditionCount,
  };
}
