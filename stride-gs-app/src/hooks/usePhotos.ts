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
  uploaded_by_name: string | null;
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
  /** v38.93.0 — parent item ID, for cross-entity photo rollup. When set,
   *  (a) uploads stamp item_id on the row so the Item detail panel can find
   *  them, and (b) the Item detail panel (entityType='inventory') queries
   *  by item_id instead of entity_type+entity_id so it catches photos from
   *  tasks, repairs, etc. that were uploaded against this item. */
  itemId?: string | null;
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
// Private bucket — every <img src> needs a signed URL. 1 hour TTL is long
// enough for a warehouse session; panels refetch on focus so URLs get
// refreshed before they expire in practice.
const SIGNED_URL_TTL = 60 * 60;

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

export function usePhotos({ entityType, entityId, tenantId, enabled = true, itemId }: UsePhotosOptions): UsePhotosResult {
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
    // v38.93.0 — Item detail panel queries by item_id for cross-entity rollup.
    // v2026-04-22 — Task/Repair panels (and any future single-item entity
    // panel) can also opt into rollup by passing an explicit `itemId`. When
    // itemId is set AND different from entityId, we rollup; otherwise we
    // fall back to entity-scoped query. Container entities (WC/Shipment)
    // don't pass itemId → they stay entity-scoped.
    const query = supabase.from('item_photos').select('*');
    const rollupItemId = entityType === 'inventory' ? entityId : (itemId || null);
    const scoped = rollupItemId
      ? query.eq('item_id', rollupItemId)
      : query.eq('entity_type', entityType).eq('entity_id', entityId);
    const { data, error: err } = await scoped
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false });
    if (!mountedRef.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    const rows = (data || []) as Photo[];

    // The `photos` bucket is PRIVATE — public URLs return 403. Batch-request
    // 1-hour signed URLs for both the original + thumbnail of every row,
    // then overlay them on the Photo objects so <img src> just works. One
    // RTT per bucket regardless of photo count (createSignedUrls batches).
    try {
      const originalKeys = rows.map(r => r.storage_key).filter(Boolean);
      const thumbKeys = rows.map(r => r.thumbnail_key).filter((k): k is string => !!k);
      const [origSigned, thumbSigned] = await Promise.all([
        originalKeys.length
          ? supabase.storage.from(BUCKET).createSignedUrls(originalKeys, SIGNED_URL_TTL)
          : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
        thumbKeys.length
          ? supabase.storage.from(BUCKET).createSignedUrls(thumbKeys, SIGNED_URL_TTL)
          : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
      ]);
      const origMap: Record<string, string> = {};
      for (const item of origSigned.data || []) {
        if (item.path && item.signedUrl) origMap[item.path] = item.signedUrl;
      }
      const thumbMap: Record<string, string> = {};
      for (const item of thumbSigned.data || []) {
        if (item.path && item.signedUrl) thumbMap[item.path] = item.signedUrl;
      }
      for (const r of rows) {
        const oSigned = origMap[r.storage_key];
        if (oSigned) r.storage_url = oSigned;
        if (r.thumbnail_key) {
          const tSigned = thumbMap[r.thumbnail_key];
          if (tSigned) r.thumbnail_url = tSigned;
        } else if (oSigned) {
          // No thumbnail stored — fall back to the signed original so the
          // grid has *something* to render instead of a 403.
          r.thumbnail_url = oSigned;
        }
      }
    } catch (sigErr) {
      // Non-fatal: the rows still have storage_url (public path) as fallback.
      console.warn('[usePhotos] signed-URL batch failed', sigErr);
    }

    setPhotos(rows);
    setLoading(false);
  }, [enabled, entityType, entityId, itemId]);

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

    // v38.93.0 — always stamp item_id on every upload so the Item detail
    // panel can aggregate photos across task/repair/etc. entities that
    // reference this item. For entityType='inventory' the itemId IS the
    // entityId. For task/repair/etc., the caller passes parent itemId
    // via the hook option.
    const resolvedItemId = (entityType === 'inventory' ? entityId : itemId) || null;
    const { data, error: insErr } = await supabase
      .from('item_photos')
      .insert({
        tenant_id: effectiveTenantId,
        entity_type: entityType,
        entity_id: entityId,
        item_id: resolvedItemId,
        storage_key: storageKey,
        storage_url: urlData.publicUrl,
        thumbnail_key: thumbUploadedKey,
        thumbnail_url: thumbUrl,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'image/jpeg',
        // Session 74: `is_primary` stays on the table (harmless) but is
        // never set from the UI anymore. No auto-assign to first upload;
        // no "Make Primary" action. Kept at false for every new row.
        is_primary: false,
        needs_attention: false,
        is_repair: photoType === 'repair',
        photo_type: photoType,
        uploaded_by: null,
        uploaded_by_name: user?.email || null,
      })
      .select('*')
      .single();
    if (insErr || !data) { setError(insErr?.message || 'Insert failed'); return null; }
    // v2: explicit refetch so the grid updates even if the Realtime channel
    // is slow or dropped. Realtime is still the primary mechanism — this is
    // a belt for the suspenders.
    await refetch();
    return data as Photo;
  }, [effectiveTenantId, entityType, entityId, itemId, photos.length, user?.email, refetch]);

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
    await refetch();
    return true;
  }, [entityType, entityId, refetch]);

  const toggleNeedsAttention = useCallback(async (photoId: string, needsAttention: boolean): Promise<boolean> => {
    const { error: err } = await supabase.from('item_photos')
      .update({ needs_attention: needsAttention })
      .eq('id', photoId);
    if (err) { setError(err.message); return false; }
    await refetch();
    return true;
  }, [refetch]);

  const toggleRepair = useCallback(async (photoId: string, isRepair: boolean): Promise<boolean> => {
    const { error: err } = await supabase.from('item_photos')
      .update({ is_repair: isRepair })
      .eq('id', photoId);
    if (err) { setError(err.message); return false; }
    await refetch();
    return true;
  }, [refetch]);

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
    await refetch();
    return true;
  }, [photos, refetch]);

  return { photos, loading, error, refetch, uploadPhoto, setPrimaryPhoto, toggleNeedsAttention, toggleRepair, deletePhoto };
}
