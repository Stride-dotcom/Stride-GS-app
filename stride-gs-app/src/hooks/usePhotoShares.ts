/**
 * usePhotoShares — create + fetch public photo share links.
 *
 * createPhotoShare requires authentication (RLS limits writes to admin/staff).
 * fetchPublicPhotoShare is a standalone async function that works with the
 * Supabase anon key and is used by the public /shared/photos/:shareId page.
 */
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { EntityType, Photo } from './usePhotos';

const BUCKET = 'photos';
// 1-hour signed URL TTL for the public gallery. The page refreshes URLs on
// each refetch; the share record itself is permanent.
const PUBLIC_SIGNED_URL_TTL = 60 * 60;

/** Snapshot of header fields stamped onto a share at create time so the
 *  public gallery can render a meaningful header without joining live entity
 *  tables (which live in Sheets and aren't reachable from the anon client).
 *
 *  All fields are optional — the consumer passes whatever it has. The public
 *  page picks an item-level vs job-level layout based on `entity_type` and
 *  renders the fields that are present. */
export interface PhotoShareHeaderContext {
  itemId?: string | null;
  vendor?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  jobId?: string | null;
  clientName?: string | null;
  date?: string | null;
  reference?: string | null;
}

export interface PhotoShare {
  id: string;
  shareId: string;
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  photoIds: string[];
  headerContext: PhotoShareHeaderContext;
  title: string | null;
  createdByName: string | null;
  createdAt: string;
  active: boolean;
}

interface ShareRow {
  id: string;
  share_id: string;
  entity_type: string;
  entity_id: string;
  tenant_id: string;
  photo_ids: string[];
  header_context: PhotoShareHeaderContext | null;
  title: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  active: boolean;
}

function rowToShare(row: ShareRow): PhotoShare {
  return {
    id: row.id,
    shareId: row.share_id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    tenantId: row.tenant_id,
    photoIds: row.photo_ids,
    headerContext: row.header_context ?? {},
    title: row.title,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    active: row.active,
  };
}

export interface CreatePhotoShareInput {
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  photoIds: string[];
  headerContext?: PhotoShareHeaderContext;
  title?: string;
}

export function usePhotoShares() {
  const { user } = useAuth();

  const createPhotoShare = useCallback(
    async (input: CreatePhotoShareInput): Promise<PhotoShare | null> => {
      if (input.photoIds.length === 0) return null;

      // Mirror usePriceListShares: refresh the JWT before insert so RLS sees
      // current user_metadata.role. Newly-promoted admins occasionally hit
      // insufficient_privilege without this when their session JWT predates
      // the role assignment.
      try { await supabase.auth.refreshSession(); } catch { /* best-effort */ }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;

      const payload = {
        entity_type: input.entityType,
        entity_id: input.entityId,
        tenant_id: input.tenantId,
        photo_ids: input.photoIds,
        header_context: input.headerContext ?? {},
        title: input.title?.trim() || null,
        created_by: userId,
        created_by_name: user?.email || null,
      };
      const { data, error } = await supabase
        .from('photo_shares')
        .insert(payload)
        .select('*')
        .single();
      if (error || !data) {
        console.error('[usePhotoShares] create failed', { error, payload });
        return null;
      }
      return rowToShare(data as ShareRow);
    },
    [user?.email],
  );

  return { createPhotoShare };
}

/** Fetch a public share by its slug. Works with the anon key — no auth. */
export async function fetchPublicPhotoShare(shareId: string): Promise<PhotoShare | null> {
  const { data, error } = await supabase
    .from('photo_shares')
    .select('*')
    .eq('share_id', shareId)
    .eq('active', true)
    .single();
  if (error || !data) return null;
  return rowToShare(data as ShareRow);
}

/** Fetch the photos in a share + signed URLs for both originals and thumbs.
 *  Mirrors usePhotos's signed-URL pattern but works against the anon RLS
 *  policies added in 20260426100000_photo_shares.sql. */
export async function fetchSharedPhotos(share: PhotoShare): Promise<Photo[]> {
  if (share.photoIds.length === 0) return [];
  const { data, error } = await supabase
    .from('item_photos')
    .select('*')
    .in('id', share.photoIds);
  if (error || !data) return [];

  // Preserve the order chosen by the share creator.
  const orderIndex: Record<string, number> = {};
  share.photoIds.forEach((id, i) => { orderIndex[id] = i; });
  const rows = (data as Photo[])
    .slice()
    .sort((a, b) => (orderIndex[a.id] ?? 0) - (orderIndex[b.id] ?? 0));

  const originalKeys = rows.map(r => r.storage_key).filter(Boolean);
  const thumbKeys = rows.map(r => r.thumbnail_key).filter((k): k is string => !!k);
  try {
    const [origSigned, thumbSigned] = await Promise.all([
      originalKeys.length
        ? supabase.storage.from(BUCKET).createSignedUrls(originalKeys, PUBLIC_SIGNED_URL_TTL)
        : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
      thumbKeys.length
        ? supabase.storage.from(BUCKET).createSignedUrls(thumbKeys, PUBLIC_SIGNED_URL_TTL)
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
        r.thumbnail_url = oSigned;
      }
    }
  } catch (sigErr) {
    console.warn('[fetchSharedPhotos] signed-URL batch failed', sigErr);
  }
  return rows;
}

/** Build the full public URL for a share (used by the copy-link button). */
export function buildPhotoShareUrl(shareId: string): string {
  if (typeof window === 'undefined') return `#/shared/photos/${shareId}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/shared/photos/${shareId}`;
}
