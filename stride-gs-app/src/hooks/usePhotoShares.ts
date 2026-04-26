/**
 * usePhotoShares — CRUD for public photo-share gallery links.
 *
 * createShare requires authentication and inserts into photo_shares.
 * fetchPublicPhotoShare is a standalone async function that works
 * with the anon key (no auth required) for the public
 * /shared/photos/:shareId page.
 *
 * `entity_context` is snapshotted at create time so the public page
 * never needs to read inventory/shipment/etc. tables (and so we don't
 * have to widen anon RLS on those).
 */
import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchItemByIdFromSupabase,
  fetchTaskByIdFromSupabase,
  fetchRepairByIdFromSupabase,
  fetchWillCallByIdFromSupabase,
  fetchShipmentByNoFromSupabase,
} from '../lib/supabaseQueries';
import type { EntityType } from './usePhotos';

export interface EntityShareContext {
  /** Primary identifier shown as the page title (e.g. "INV-1234", "SHP-9876"). */
  label: string;
  /** Optional secondary line — vendor + description for items, client name for jobs. */
  title?: string;
  /** Optional tertiary line — date, status, etc. */
  subtitle?: string;
  /** Free-form key/value pairs rendered as a small details list under the header.
   *  Keep keys short and human-readable. Null/undefined values are skipped at render. */
  meta?: Record<string, string | number | null | undefined>;
}

export interface PhotoShare {
  id: string;
  shareId: string;
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  photoIds: string[];
  entityContext: EntityShareContext;
  title: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
}

interface ShareRow {
  id: string;
  share_id: string;
  entity_type: string;
  entity_id: string;
  tenant_id: string;
  photo_ids: string[];
  entity_context: EntityShareContext | null;
  title: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  expires_at: string | null;
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
    entityContext: row.entity_context ?? { label: row.entity_id },
    title: row.title,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    active: row.active,
  };
}

/** Public URL builder. HashRouter, so the public route lives at #/shared/photos/:id. */
export function buildPublicShareUrl(shareId: string): string {
  if (typeof window === 'undefined') return `#/shared/photos/${shareId}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/shared/photos/${shareId}`;
}

/** Snapshot the entity context (label / title / subtitle / meta) for the
 *  share row so the public page can render the header without ever
 *  querying entity tables. Returns a minimal fallback if the entity lookup
 *  fails — better to ship the share than to block on a stale cache miss. */
export async function buildEntityContext(
  entityType: EntityType,
  entityId: string,
): Promise<EntityShareContext> {
  const fallback: EntityShareContext = {
    label: entityId,
    title: humanEntityLabel(entityType),
  };

  try {
    switch (entityType) {
      case 'inventory': {
        const item = await fetchItemByIdFromSupabase(entityId, {});
        if (!item) return fallback;
        const idLine = item.itemId;
        const vendorDesc = [item.vendor, item.description].filter(Boolean).join(' — ');
        return {
          label: idLine,
          title: vendorDesc || 'Inventory item',
          subtitle: item.clientName || undefined,
          meta: {
            Qty: item.qty,
            Reference: item.reference || undefined,
            Vendor: item.vendor || undefined,
            Description: item.description || undefined,
          },
        };
      }
      case 'task': {
        const task = await fetchTaskByIdFromSupabase(entityId);
        if (!task) return fallback;
        return {
          label: task.taskId,
          title: task.taskNotes || task.type || 'Task',
          subtitle: [task.clientName, task.dueDate].filter(Boolean).join(' — ') || undefined,
          meta: {
            Status: task.status,
            'Item ID': task.itemId,
            Reference: task.reference,
          },
        };
      }
      case 'repair': {
        const repair = await fetchRepairByIdFromSupabase(entityId);
        if (!repair) return fallback;
        return {
          label: repair.repairId,
          title: repair.description || 'Repair',
          subtitle: repair.clientName || undefined,
          meta: {
            Status: repair.status,
            'Item ID': repair.itemId,
            Reference: repair.reference,
          },
        };
      }
      case 'will_call': {
        const wc = await fetchWillCallByIdFromSupabase(entityId);
        if (!wc) return fallback;
        return {
          label: wc.wcNumber,
          title: wc.clientName || 'Will call',
          subtitle: wc.estimatedPickupDate || wc.createdDate || undefined,
          meta: {
            Status: wc.status,
            'Pickup Date': wc.estimatedPickupDate || undefined,
            Items: wc.itemsCount,
          },
        };
      }
      case 'shipment': {
        const shp = await fetchShipmentByNoFromSupabase(entityId);
        if (!shp) return fallback;
        return {
          label: shp.shipmentNumber,
          title: shp.clientName || 'Shipment',
          subtitle: shp.receiveDate || undefined,
          meta: {
            Carrier: shp.carrier,
            Tracking: shp.trackingNumber,
            Items: shp.itemCount,
          },
        };
      }
      case 'claim':
      default:
        return fallback;
    }
  } catch {
    return fallback;
  }
}

function humanEntityLabel(t: EntityType): string {
  switch (t) {
    case 'inventory': return 'Inventory item';
    case 'task': return 'Task';
    case 'repair': return 'Repair';
    case 'will_call': return 'Will call';
    case 'shipment': return 'Shipment';
    case 'claim': return 'Claim';
  }
}

export interface CreateShareOptions {
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  photoIds: string[];
  entityContext: EntityShareContext;
  title?: string | null;
  expiresAt?: string | null;
}

export interface UsePhotoSharesResult {
  creating: boolean;
  error: string | null;
  createShare: (opts: CreateShareOptions) => Promise<PhotoShare | null>;
  revokeShare: (id: string) => Promise<boolean>;
}

export function usePhotoShares(): UsePhotoSharesResult {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createShare = useCallback(async (opts: CreateShareOptions): Promise<PhotoShare | null> => {
    setCreating(true);
    setError(null);

    // Same JWT-refresh dance the price-list shares hook uses: ensure the
    // active session token carries the latest user_metadata (role,
    // clientSheetId), without which the RLS write policy silently rejects.
    try { await supabase.auth.refreshSession(); } catch { /* best-effort */ }

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;

    const payload = {
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      tenant_id: opts.tenantId,
      photo_ids: opts.photoIds,
      entity_context: opts.entityContext,
      title: opts.title?.trim() || null,
      created_by: userId,
      created_by_name: user?.email || null,
      expires_at: opts.expiresAt ?? null,
    };

    const { data, error: err } = await supabase
      .from('photo_shares')
      .insert(payload)
      .select('*')
      .single();

    setCreating(false);
    if (err || !data) {
      console.error('[usePhotoShares] createShare failed', { err, payload });
      setError(err?.message ?? 'Failed to create share link');
      return null;
    }
    return rowToShare(data as ShareRow);
  }, [user?.email]);

  const revokeShare = useCallback(async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('photo_shares')
      .update({ active: false })
      .eq('id', id);
    if (err) { setError(err.message); return false; }
    return true;
  }, []);

  return { creating, error, createShare, revokeShare };
}

/** Standalone fetch — no auth required. Used by PublicPhotoGallery.tsx.
 *  The public_read RLS policy already filters out inactive / expired
 *  rows, but we mirror the check client-side so the page can render a
 *  cleaner "this share is no longer available" instead of a generic
 *  not-found. */
export async function fetchPublicPhotoShare(shareId: string): Promise<PhotoShare | null> {
  const { data, error } = await supabase
    .from('photo_shares')
    .select('*')
    .eq('share_id', shareId)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ShareRow;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return rowToShare(row);
}
