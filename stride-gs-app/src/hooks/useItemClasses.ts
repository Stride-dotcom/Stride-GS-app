/**
 * useItemClasses — CRUD for `public.item_classes` + realtime refresh.
 *
 * v2 2026-04-25 PST — exposes `deliveryMinutes` so the Price List Classes
 *                     section can edit dispatch routing time alongside
 *                     storage size. Seeded values (XS=3, S=5, M=10, L=20,
 *                     XL=30, XXL=45) live in migration 20260425000537.
 *
 *
 * The Quote Tool reads this table via useQuoteCatalog (which only exposes
 * id/name/order/active — the columns the tool needs). This hook exposes
 * the full row shape including `storage_size` so the Price List "Classes"
 * section can edit it inline.
 *
 * RLS: authenticated read; admin write. The write path surfaces the RLS
 * error verbatim if a non-admin tries to edit (the UI gates the button
 * too, but server-side is the real authority).
 *
 * Realtime: subscribed via the central entityEvents bus; shared key
 * 'quote_catalog' also triggers a useQuoteCatalog refetch so Quote Tool
 * sessions stay coherent when an admin edits a class.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';

export interface ItemClass {
  id: string;
  name: string;
  storageSize: number;
  /** Default dispatch minutes per item of this class — feeds delivery routing. */
  deliveryMinutes: number;
  displayOrder: number;
  active: boolean;
  createdAt: string;
}

interface DbRow {
  id: string;
  name: string | null;
  storage_size: string | number | null;
  delivery_minutes: number | null;
  display_order: number | null;
  active: boolean | null;
  created_at: string | null;
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function rowToClass(r: DbRow): ItemClass {
  return {
    id: r.id,
    name: r.name ?? '',
    storageSize: num(r.storage_size),
    deliveryMinutes: r.delivery_minutes ?? 0,
    displayOrder: r.display_order ?? 0,
    active: r.active !== false,
    createdAt: r.created_at ?? '',
  };
}

export interface UseItemClassesResult {
  classes: ItemClass[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  update: (id: string, patch: Partial<Pick<ItemClass, 'name' | 'storageSize' | 'deliveryMinutes' | 'displayOrder' | 'active'>>) => Promise<boolean>;
}

export function useItemClasses(): UseItemClassesResult {
  const [classes, setClasses] = useState<ItemClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: err } = await supabase
      .from('item_classes')
      .select('*')
      .order('display_order', { ascending: true });
    if (!mountedRef.current) return;
    if (err) { setError(err.message); setClasses([]); setLoading(false); return; }
    setClasses(((data ?? []) as DbRow[]).map(rowToClass));
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  // Central realtime bus — Quote Tool + Price List both subscribe to
  // 'quote_catalog' so a class edit in one view fans out to the other.
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === 'quote_catalog') void refetch();
    });
  }, [refetch]);

  const update = useCallback(async (id: string, patch: Partial<Pick<ItemClass, 'name' | 'storageSize' | 'deliveryMinutes' | 'displayOrder' | 'active'>>): Promise<boolean> => {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined)             row.name             = patch.name;
    if (patch.storageSize !== undefined)      row.storage_size     = patch.storageSize;
    if (patch.deliveryMinutes !== undefined)  row.delivery_minutes = patch.deliveryMinutes;
    if (patch.displayOrder !== undefined)     row.display_order    = patch.displayOrder;
    if (patch.active !== undefined)           row.active           = patch.active;
    if (Object.keys(row).length === 0) return true;
    const { data, error: err } = await supabase
      .from('item_classes')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (err) { setError(err.message); return false; }
    if (data) {
      const updated = rowToClass(data as DbRow);
      setClasses(prev => prev.map(c => c.id === id ? updated : c));
    }
    return true;
  }, []);

  return useMemo(() => ({ classes, loading, error, refetch, update }),
    [classes, loading, error, refetch, update]);
}
