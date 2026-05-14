/**
 * useGraphRollup — cross-entity rollup readers for photos and notes.
 *
 * Detail panels for Item / Task / Repair / Shipment / Will Call / Claim each
 * have their own native scope, but the user expects to see related photos
 * and notes from neighboring entities in the graph too. Examples:
 *
 *   - Task page should see photos from the linked Shipment / Will Call /
 *     Claim, not just photos uploaded against the task itself.
 *   - Shipment page should see photos from items inside the shipment plus
 *     each item's task/repair photos.
 *
 * The rollup is a single Supabase query that ORs together:
 *   - rows where item_id IN (...)            ← catches item, task, repair
 *   - rows where (entity_type, entity_id)    ← catches container photos
 *     matches any of the supplied scopes       (shipment / WC / claim)
 *
 * Writes (uploads / new notes) still flow through the entity-scoped
 * useEntityNotes / usePhotos hooks — those continue to stamp item_id
 * correctly on insert. This module is read-only by design.
 *
 * Realtime: subscribes to all changes on the table for the tenant and
 * refetches on any match. Single channel per hook instance.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Photo } from './usePhotos';
import type { EntityNote } from './useEntityNotes';

const PHOTO_BUCKET = 'photos';
const SIGNED_URL_TTL = 60 * 60;

export interface RollupScope {
  /** entity_type column value, e.g. 'shipment', 'will_call', 'claim'. */
  entityType: string;
  /** entity_id column value. */
  entityId: string;
}

export interface RollupContext {
  /** Tenant (client spreadsheet) ID, used both for query scoping and the
   *  realtime channel filter. */
  tenantId?: string | null;
  /** Item IDs to fold in — every photo/note stamped with one of these
   *  item_id values is included. Catches inventory/task/repair photos. */
  itemIds: string[];
  /** Container scopes to fold in — every photo/note matching one of these
   *  (entity_type, entity_id) pairs is included. Catches shipment/WC/claim
   *  photos that have null item_id. */
  scopes: RollupScope[];
  /** When false, the hook returns empty results without touching the
   *  network. Defaults to true. */
  enabled?: boolean;
}

interface PhotoRow {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  item_id: string | null;
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
  photo_type: string;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  entity_type: string;
  entity_id: string;
  item_id: string | null;
  body: string;
  visibility: string | null;
  mentions: string[] | null;
  is_system: boolean | null;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  created_at: string;
}

/**
 * Build the PostgREST `.or(...)` filter string for a rollup context. Returns
 * null when the context produces zero conditions — caller should short-circuit
 * (we can't fire `.or('')` because it returns everything).
 *
 * Entity IDs in Stride are alphanumeric with dashes (IK-1234, SHP-000249,
 * INSP-62942-1, WC-00123, CL-00456) — safe to inline. We still wrap them
 * defensively with the `(...)` syntax PostgREST expects for `.in.()`.
 */
function buildOrFilter(ctx: RollupContext): string | null {
  const parts: string[] = [];
  const cleanItemIds = Array.from(new Set(ctx.itemIds.filter(Boolean)));
  if (cleanItemIds.length > 0) {
    const list = cleanItemIds.map(id => `"${id}"`).join(',');
    parts.push(`item_id.in.(${list})`);
  }
  const seenScopes = new Set<string>();
  for (const s of ctx.scopes) {
    if (!s.entityType || !s.entityId) continue;
    const key = `${s.entityType}::${s.entityId}`;
    if (seenScopes.has(key)) continue;
    seenScopes.add(key);
    parts.push(`and(entity_type.eq.${s.entityType},entity_id.eq.${s.entityId})`);
  }
  if (parts.length === 0) return null;
  return parts.join(',');
}

/** Stable cache key for a rollup context — used to drive useEffect deps
 *  without triggering an extra refetch every render. */
function ctxKey(ctx: RollupContext): string {
  const ids = [...new Set(ctx.itemIds.filter(Boolean))].sort().join('|');
  const scopes = [...new Set(ctx.scopes
    .filter(s => s.entityType && s.entityId)
    .map(s => `${s.entityType}:${s.entityId}`))]
    .sort().join('|');
  return `${ctx.tenantId ?? ''}::${ids}::${scopes}::${ctx.enabled === false ? '0' : '1'}`;
}

/**
 * Short, stable digest of a ctxKey for the realtime channel name. Channel
 * names need to be unique across hook instances on the same tenant — two
 * panels open at once (e.g. Item + Task) routinely produce different
 * scopes, and a naive `slice(0, 32)` of a tenant-prefixed key collides.
 * Tiny FNV-1a, plenty for distinguishing scopes per tenant.
 */
function ctxDigest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

function rowToPhoto(r: PhotoRow): Photo {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    entity_type: r.entity_type as Photo['entity_type'],
    entity_id: r.entity_id,
    item_id: r.item_id,
    storage_key: r.storage_key,
    storage_url: r.storage_url,
    thumbnail_key: r.thumbnail_key,
    thumbnail_url: r.thumbnail_url,
    file_name: r.file_name,
    file_size: r.file_size,
    mime_type: r.mime_type,
    is_primary: !!r.is_primary,
    needs_attention: !!r.needs_attention,
    is_repair: !!r.is_repair,
    photo_type: (r.photo_type as Photo['photo_type']) ?? 'general',
    uploaded_by: r.uploaded_by,
    uploaded_by_name: r.uploaded_by_name,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToNote(r: NoteRow): EntityNote {
  const v = r.visibility === 'internal' || r.visibility === 'staff_only' ? 'internal' : 'public';
  const role = r.author_role === 'admin' || r.author_role === 'staff' || r.author_role === 'client'
    ? r.author_role
    : null;
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    itemId: r.item_id ?? null,
    body: r.body,
    visibility: v as EntityNote['visibility'],
    mentions: Array.isArray(r.mentions) ? r.mentions : [],
    isSystem: !!r.is_system,
    authorId: r.author_id,
    authorName: r.author_name ?? '',
    authorRole: role,
    createdAt: r.created_at,
  };
}

export interface PhotoRollupResult {
  photos: Photo[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * usePhotoGraphRollup — read-only photo list assembled across an entity's
 * graph neighborhood. Pass a context describing which item_ids and entity
 * scopes to fold in.
 */
export function usePhotoGraphRollup(ctx: RollupContext): PhotoRollupResult {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const key = ctxKey(ctx);
  const enabled = ctx.enabled !== false;

  const refetch = useCallback(async () => {
    if (!enabled) { setPhotos([]); setLoading(false); return; }
    const filter = buildOrFilter(ctx);
    if (!filter) { setPhotos([]); setLoading(false); return; }
    setLoading(true); setError(null);

    // v2026-05-04: Don't filter by tenant_id at the app level. RLS already
    // enforces tenant scoping for client users; admin/staff legitimately
    // see all tenants. Filtering by the *current* panel's tenant_id was
    // hiding shipment-scoped photos for cross-tenant transferred items —
    // e.g. shipment SHP-001005 received under tenant A, item later
    // transferred to tenant B, viewer opens the item on tenant B and the
    // shipment photos (still tagged tenant A) got filtered out. The OR
    // filter on item_id / scope pairs is narrow enough without it.
    const { data, error: err } = await supabase
      .from('item_photos').select('*').or(filter)
      .order('created_at', { ascending: false })
      .limit(500);
    if (!mountedRef.current) return;
    if (err) { setError(err.message); setLoading(false); return; }

    const rows = ((data ?? []) as PhotoRow[]).map(rowToPhoto);

    // Sign URLs for the originals + thumbnails. Same pattern as usePhotos —
    // batched in two requests regardless of row count.
    try {
      const originalKeys = rows.map(r => r.storage_key).filter(Boolean);
      const thumbKeys = rows.map(r => r.thumbnail_key).filter((k): k is string => !!k);
      const [origSigned, thumbSigned] = await Promise.all([
        originalKeys.length
          ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(originalKeys, SIGNED_URL_TTL)
          : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
        thumbKeys.length
          ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(thumbKeys, SIGNED_URL_TTL)
          : Promise.resolve({ data: [] as Array<{ path: string | null; signedUrl: string }>, error: null }),
      ]);
      const origMap: Record<string, string> = {};
      for (const item of origSigned.data ?? []) {
        if (item.path && item.signedUrl) origMap[item.path] = item.signedUrl;
      }
      const thumbMap: Record<string, string> = {};
      for (const item of thumbSigned.data ?? []) {
        if (item.path && item.signedUrl) thumbMap[item.path] = item.signedUrl;
      }
      for (const r of rows) {
        const o = origMap[r.storage_key];
        if (o) r.storage_url = o;
        if (r.thumbnail_key) {
          const t = thumbMap[r.thumbnail_key];
          if (t) r.thumbnail_url = t;
        } else if (o) {
          r.thumbnail_url = o;
        }
      }
    } catch (sigErr) {
      console.warn('[usePhotoGraphRollup] signed-URL batch failed', sigErr);
    }

    setPhotos(rows);
    setLoading(false);
    // ctxKey intentionally drives the dep — buildOrFilter is pure over ctx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime — one channel per tenant. We refetch on any photo change for
  // this tenant and let the query above re-derive the rollup. Cheaper than
  // wiring N filtered subscriptions and stays correct as scopes evolve.
  useEffect(() => {
    if (!enabled || !ctx.tenantId) return;
    const channel = supabase
      .channel(`item_photos_rollup:${ctx.tenantId}:${ctxDigest(key)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'item_photos', filter: `tenant_id=eq.${ctx.tenantId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ctx.tenantId, key]);

  return useMemo(() => ({ photos, loading, error, refetch }), [photos, loading, error, refetch]);
}

export interface NoteRollupResult {
  notes: EntityNote[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * useNoteGraphRollup — read-only entity_notes list assembled across an
 * entity's graph neighborhood. Mirror of usePhotoGraphRollup.
 *
 * Note: the legacy `useEntityNotesRollup(itemId)` hook in useEntityNotes.ts
 * is kept for back-compat with the Item-only rollup path. New panels should
 * prefer this hook so they can fold in container scopes too.
 */
export function useNoteGraphRollup(ctx: RollupContext): NoteRollupResult {
  const [notes, setNotes] = useState<EntityNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const key = ctxKey(ctx);
  const enabled = ctx.enabled !== false;

  const refetch = useCallback(async () => {
    if (!enabled) { setNotes([]); setLoading(false); return; }
    const filter = buildOrFilter(ctx);
    if (!filter) { setNotes([]); setLoading(false); return; }
    setLoading(true); setError(null);

    // v2026-05-04: Drop the app-level tenant_id filter — RLS handles
    // tenant scoping for clients, admin/staff see all tenants legitimately,
    // and cross-tenant transferred items need their shipment / WC scope
    // photos to surface. Same fix as the photo path above.
    const { data, error: err } = await supabase
      .from('entity_notes').select('*').or(filter)
      .order('created_at', { ascending: false })
      .limit(500);
    if (!mountedRef.current) return;
    if (err) { setError(err.message); setLoading(false); return; }
    setNotes(((data ?? []) as NoteRow[]).map(rowToNote));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    if (!enabled || !ctx.tenantId) return;
    const channel = supabase
      .channel(`entity_notes_rollup:${ctx.tenantId}:${ctxDigest(key)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entity_notes', filter: `tenant_id=eq.${ctx.tenantId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ctx.tenantId, key]);

  return useMemo(() => ({ notes, loading, error, refetch }), [notes, loading, error, refetch]);
}
