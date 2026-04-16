import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ItemPreviewPhoto {
  id: string;
  storage_url: string;
  photo_type: string | null;
  is_primary: boolean;
}

interface ItemPreviewData {
  id: string;
  item_code: string;
  description: string | null;
  vendor: string | null;
  status: string;
  primary_photo_url: string | null;
  sidemark: string | null;
  room: string | null;
  quantity: number;
}

interface ItemPreviewResult {
  item: ItemPreviewData | null;
  photos: ItemPreviewPhoto[];
}

export function useItemPreview(itemId: string | undefined) {
  return useQuery({
    queryKey: ['item-preview', itemId],
    queryFn: async (): Promise<ItemPreviewResult> => {
      if (!itemId) return { item: null, photos: [] };

      // Fetch item details from view
      const { data: item, error: itemError } = await (supabase
        .from('v_items_with_location') as any)
        .select('id, item_code, description, vendor, status, primary_photo_url, sidemark, room, quantity, client_account, location_code, warehouse_name')
        .eq('id', itemId)
        .single();

      if (itemError) {
        console.error('Error fetching item preview:', itemError);
        return { item: null, photos: [] };
      }

      // Fetch photos (item_photos does NOT have deleted_at column)
      const { data: photos, error: photosError } = await supabase
        .from('item_photos')
        .select('id, storage_url, photo_type, is_primary')
        .eq('item_id', itemId)
        .order('is_primary', { ascending: false })
        .limit(5);

      if (photosError) {
        console.error('Error fetching item photos:', photosError);
      }

      return {
        item: item as ItemPreviewData,
        photos: (photos || []) as ItemPreviewPhoto[],
      };
    },
    enabled: !!itemId,
    staleTime: 30000, // Cache for 30 seconds
  });
}
