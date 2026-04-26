/**
 * usePhotoShares — CRUD for public photo-share gallery links.
 *
 * createPhotoShare() requires authentication (admin/staff RLS). It writes a
 * row to photo_shares with the selected photo IDs and a snapshot of the
 * entity header so the public gallery never needs to query entity tables.
 *
 * fetchPublicPhotoShare() works with the anon key — used by the public
 * /shared/photos/:shareId route. The photo_shares public_read policy allows
 * SELECT on active rows, and the companion item_photos / storage.objects
 * policies (see migration 20260426090000_photo_shares.sql) gate anon photo
 * + storage access through these share rows.
 *
 * Photo share links are PERMANENT — there is no expires_at. Revocation is
 * via deactivate (active=false).
 */
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { EntityType } from './usePhotos';

/**
 * Snapshot of entity header data captured at share-creation time. Two
 * shapes — item-level and job-level — distinguished by `kind`. Both are
 * optional fields so a caller can pass partial data without failing.
 */
export type PhotoShareHeader =
  | {
      kind: 'item';
      itemId?: string | null;
      vendor?: string | null;
      description?: string | null;
      quantity?: number | null;
      reference?: string | null;
      clientName?: string | null;
    }
  | {
      kind: 'job';
      jobId?: string | null;
      jobLabel?: string | null;
      clientName?: string | null;
      date?: string | null;
      reference?: string | null;
      status?: string | null;
    }
  | {
      kind: 'generic';
      label?: string | null;
      reference?: string | null;
      clientName?: string | null;
    };

export interface PhotoShare {
  id: string;
  shareId: string;
  tenantId: string;
  entityType: EntityType;
  entityId: string;
  photoIds: string[];
  header: PhotoShareHeader;
  title: string | null;
  createdAt: string;
  createdByName: string | null;
  active: boolean;
}

interface ShareRow {
  id: string;
  share_id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  photo_ids: string[];
  header: PhotoShareHeader | null;
  title: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  active: boolean;
}

function rowToShare(row: ShareRow): PhotoShare {
  const raw = (row.header && typeof row.header === 'object' ? row.header : null) as
    | (Partial<PhotoShareHeader> & { kind?: string })
    | null;
  const header: PhotoShareHeader =
    raw && (raw.kind === 'item' || raw.kind === 'job' || raw.kind === 'generic')
      ? (raw as PhotoShareHeader)
      : { kind: 'generic' };
  return {
    id: row.id,
    shareId: row.share_id,
    tenantId: row.tenant_id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    photoIds: row.photo_ids ?? [],
    header,
    title: row.title,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    active: row.active,
  };
}

export interface CreatePhotoShareInput {
  tenantId: string;
  entityType: EntityType;
  entityId: string;
  photoIds: string[];
  header: PhotoShareHeader;
  title?: string | null;
}

export function usePhotoShares() {
  const { user } = useAuth();

  const createPhotoShare = useCallback(
    async (input: CreatePhotoShareInput): Promise<PhotoShare | null> => {
      // Mirror usePriceListShares: refresh the JWT before INSERT so the
      // user_metadata.role claim is fresh and the staff_write RLS policy
      // evaluates correctly.
      try { await supabase.auth.refreshSession(); } catch { /* best-effort */ }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;

      const payload = {
        tenant_id: input.tenantId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        photo_ids: input.photoIds,
        header: input.header,
        title: input.title?.trim() || null,
        created_by: userId,
        created_by_name: user?.displayName || user?.email || null,
      };
      const { data, error } = await supabase
        .from('photo_shares')
        .insert(payload)
        .select('*')
        .single();
      if (error || !data) {
        console.error('[usePhotoShares] createPhotoShare failed', { error, payload });
        return null;
      }
      return rowToShare(data as ShareRow);
    },
    [user?.email, user?.displayName],
  );

  const deactivatePhotoShare = useCallback(
    async (id: string): Promise<boolean> => {
      const { error } = await supabase
        .from('photo_shares')
        .update({ active: false })
        .eq('id', id);
      if (error) {
        console.error('[usePhotoShares] deactivatePhotoShare failed', error);
        return false;
      }
      return true;
    },
    [],
  );

  return { createPhotoShare, deactivatePhotoShare };
}

/** Standalone fetch — no auth required. Used by PublicPhotoShare.tsx. */
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
