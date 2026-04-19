/**
 * usePhotos — Supabase CRUD for the `item_photos` table. Adapted from the
 * WMS app's useItemPhotos hook; stripped down to the generic (entityType,
 * entityId) shape so it can back Photos tabs on Inventory, Tasks, Repairs,
 * Will Calls, Shipments, Claims, etc.
 *
 * Storage path: photos/{tenantId}/{entityType}-{entityId}/{filename}
 * Thumbnail:   400 px max edge, JPEG 0.85, generated client-side before
 *              upload and stored alongside the original.
 *
 * Realtime: subscribes to postgres_changes on item_photos and refetches
 * when a row matching the current (entityType, entityId) scope mutates.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export type EntityType =
  | 'inventory' | 'task' | 'repair' | 'will_call' | 'shipment' | 'claim';

export type PhotoType = 'general' | 'inspection' | 'repair' | 'receiving' | 'damage';

export interface Photo {
  id: string;
  tenant_id: string;
  entity_type: EntityType;
  entity_id: string;
  storage_key: string;
  storage_url: string | null;
  thumbnail_key: string | null;
  thumbnail_url: string | null;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  is_primary: boolean;
  needs_attention: boolean;
  is_repair: boolean;
  photo_type: PhotoType;
  uploaded_by: string | null;
  uploaded_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsePhotosOptions {
  entityType: EntityType;
  entityId: string | null | undefined;
  /** Tenant (client spreadsheet ID) the entity belongs to. Required for
   *  uploads — determines the storage path. Reads fall back to client role
   *  tenant when unset. */
  tenantId?: string | null;
  /** Set false to pause fetching (useful for unmounted panels). */
  enabled?: boolean;
}

export interface UsePhotosResult {
  photos: Photo[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  uploadPhoto: (file: File, photoType?: PhotoType) => Promise<Photo | null>;
  setPrimaryPhoto: (photoId: string) => Promise<boolean>;
  toggleNeedsAttention: (photoId: string, needsAttention: boolean) => Promise<boolean>;
  toggleRepair: (photoId: string, isRepair: boolean) => Promise<boolean>;
  deletePhoto: (photoId: string) => Promise<boolean>;
}

const BUCKET = 'photos';
const THUMB_MAX_EDGE = 400;
const THUMB_QUALITY = 0.85;

/** Client-side thumbnail: resize onto a canvas keeping aspect ratio. Returns
 *  a new Blob (JPEG). Returns `null` if the File cannot be decoded (e.g.,
 *  unsupported mime type) — the caller falls back to uploading just the
 *  original. */
async function generateThumbnail(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob | null>(resolve => {
      canvas.toBlob(b => resolve(b), 'image/jpeg', THUMB_QUALITY);
    });
  } catch {
    return null;
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

export function usePhotos({ entityType, entityId, tenantId, enabled = true }: UsePhotosOptions): UsePhotosResult {
  const { user } = useAuth();
  const effectiveTenantId = tenantId ?? user?.clientSheetId ?? null;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const refetch = useCallback(async () => {
    if (!enabled || !entityId) { setPhotos([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data, error: err } = await supabase
      .from('item_photos')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false });
    if (!mountedRef.current) return;
    if (err) setError(err.message);
    else setPhotos((data || []) as Photo[]);
    setLoading(false);
  }, [enabled, entityType, entityId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime — refetch on any INSERT/UPDATE/DELETE matching our scope.
  useEffect(() => {
    if (!enabled || !entityId) return;
    const channel = supabase
      .channel(`item_photos_${entityType}_${entityId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'item_photos', filter: `entity_id=eq.${entityId}` },
        () => { void refetch(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, entityType, entityId, refetch]);

  const uploadPhoto = useCallback(async (file: File, photoType: PhotoType = 'general'): Promise<Photo | null> => {
    if (!effectiveTenantId || !entityId) {
      setError('Missing tenant or entity context');
      return null;
    }
    setError(null);

    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safeName = sanitizeName(file.name || `photo-${ts}.jpg`);
    const basePath = `${effectiveTenantId}/${entityType}-${entityId}`;
    const storageKey = `${basePath}/${ts}-${rand}-${safeName}`;
    const thumbKey = `${basePath}/thumbs/${ts}-${rand}-${safeName}`;

    // Upload original
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storageKey, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (upErr) { setError(upErr.message); return null; }

    // Upload thumbnail (best-effort)
    const thumbBlob = await generateThumbnail(file);
    let thumbUploadedKey: string | null = null;
    if (thumbBlob) {
      const { error: thErr } = await supabase.storage.from(BUCKET).upload(thumbKey, thumbBlob, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (!thErr) thumbUploadedKey = thumbKey;
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storageKey);
    const thumbUrl = thumbUploadedKey
      ? supabase.storage.from(BUCKET).getPublicUrl(thumbUploadedKey).data.publicUrl
      : null;

    const { data, error: insErr } = await supabase
      .from('item_photos')
      .insert({
        tenant_id: effectiveTenantId,
        entity_type: entityType,
        entity_id: entityId,
        storage_key: storageKey,
        storage_url: urlData.publicUrl,
        thumbnail_key: thumbUploadedKey,
        thumbnail_url: thumbUrl,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'image/jpeg',
        is_primary: photos.length === 0, // first photo becomes primary
        needs_attention: false,
        is_repair: photoType === 'repair',
        photo_type: photoType,
        uploaded_by: null,
        uploaded_by_email: user?.email || null,
      })
      .select('*')
      .single();
    if (insErr || !data) { setError(insErr?.message || 'Insert failed'); return null; }
    return data as Photo;
  }, [effectiveTenantId, entityType, entityId, photos.length, user?.email]);

  const setPrimaryPhoto = useCallback(async (photoId: string): Promise<boolean> => {
    if (!entityId) return false;
    // Clear primary on all siblings first.
    await supabase.from('item_photos')
      .update({ is_primary: false })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    const { error: err } = await supabase.from('item_photos')
      .update({ is_primary: true })
      .eq('id', photoId);
    if (err) { setError(err.message); return false; }
    return true;
  }, [entityType, entityId]);

  const toggleNeedsAttention = useCallback(async (photoId: string, needsAttention: boolean): Promise<boolean> => {
    const { error: err } = await supabase.from('item_photos')
      .update({ needs_attention: needsAttention })
      .eq('id', photoId);
    if (err) { setError(err.message); return false; }
    return true;
  }, []);

  const toggleRepair = useCallback(async (photoId: string, isRepair: boolean): Promise<boolean> => {
    const { error: err } = await supabase.from('item_photos')
      .update({ is_repair: isRepair })
      .eq('id', photoId);
    if (err) { setError(err.message); return false; }
    return true;
  }, []);

  const deletePhoto = useCallback(async (photoId: string): Promise<boolean> => {
    const photo = photos.find(p => p.id === photoId);
    if (photo) {
      const keys = [photo.storage_key, photo.thumbnail_key].filter(Boolean) as string[];
      if (keys.length > 0) {
        await supabase.storage.from(BUCKET).remove(keys);
      }
    }
    const { error: err } = await supabase.from('item_photos').delete().eq('id', photoId);
    if (err) { setError(err.message); return false; }
    return true;
  }, [photos]);

  return { photos, loading, error, refetch, uploadPhoto, setPrimaryPhoto, toggleNeedsAttention, toggleRepair, deletePhoto };
}
