/**
 * useDeliveryZones — CRUD for public.delivery_zones + realtime subscription.
 *
 * The table predates this session (created by the Quote Tool's delivery
 * pricing schema) and was extended in `20260420100000_delivery_zones.sql`
 * with the editorial columns the Price List "Zip Codes" category needs
 * (current_rate, updated_rate, out_of_area, call_for_quote, active, notes).
 *
 * Writes go to BOTH `updated_rate` AND `base_rate` so legacy Quote Tool
 * readers (`fetchAllDeliveryZones` / `fetchDeliveryZone` in supabaseQueries)
 * stay coherent with the value an admin edits on the Price List page.
 *
 * RLS: authenticated read for all, admin-only write. The mutate helpers
 * surface the RLS error verbatim if a non-admin tries to edit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';

export interface DeliveryZone {
  id: string;
  zipCode: string;
  city: string;
  serviceDays: string | null;
  updatedRate: number;
  zone: string | null;
  outOfArea: boolean;
  callForQuote: boolean;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string | null;
  zip_code: string;
  city: string | null;
  service_days: string | null;
  updated_rate: string | number | null;
  base_rate: string | number | null;
  zone: string | null;
  out_of_area: boolean | null;
  call_for_quote: boolean | null;
  active: boolean | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function rowToZone(r: DbRow): DeliveryZone {
  // Some legacy rows may have updated_rate=0 with base_rate populated —
  // fall back so the UI always has a display value.
  const updated = num(r.updated_rate) || num(r.base_rate);
  return {
    id: r.id ?? r.zip_code,
    zipCode: r.zip_code,
    city: r.city ?? '',
    serviceDays: r.service_days,
    updatedRate: updated,
    zone: r.zone,
    outOfArea: r.out_of_area === true,
    callForQuote: r.call_for_quote === true,
    active: r.active !== false,
    notes: r.notes,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

export type DeliveryZonePayload = Partial<Omit<DeliveryZone, 'id' | 'createdAt' | 'updatedAt'>> & {
  zipCode: string; // required when adding — pk
};

export interface UseDeliveryZonesResult {
  zones: DeliveryZone[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  add: (payload: DeliveryZonePayload) => Promise<DeliveryZone | null>;
  update: (zipCode: string, patch: Partial<DeliveryZonePayload>) => Promise<boolean>;
  remove: (zipCode: string) => Promise<boolean>;
}

export function useDeliveryZones(): UseDeliveryZonesResult {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
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
      .from('delivery_zones')
      .select('*')
      .order('zip_code', { ascending: true });
    if (!mountedRef.current) return;
    if (err) { setError(err.message); setZones([]); setLoading(false); return; }
    setZones(((data ?? []) as DbRow[]).map(rowToZone));
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime: any insert/update/delete from another admin's session
  // propagates here so two admins editing concurrently converge without
  // a manual refresh. Unique channel per mount avoids registry collisions
  // when two instances of this hook mount in the same tab.
  useEffect(() => {
    // Session 74: Realtime via central channel (see useSupabaseRealtime).
    return entityEvents.subscribe((type) => {
      if (type === 'delivery_zone') void refetch();
    });
  }, [refetch]);

  const buildRow = (patch: Partial<DeliveryZonePayload>): Record<string, unknown> => {
    const row: Record<string, unknown> = {};
    if (patch.zipCode !== undefined)      row.zip_code       = patch.zipCode;
    if (patch.city !== undefined)         row.city           = patch.city;
    if (patch.serviceDays !== undefined)  row.service_days   = patch.serviceDays;
    // Mirror updated_rate → base_rate so the legacy Quote Tool reader
    // (which still looks at base_rate) stays in sync with whatever the
    // Price List editor writes.
    if (patch.updatedRate !== undefined) {
      row.updated_rate = patch.updatedRate;
      row.base_rate    = patch.updatedRate;
    }
    if (patch.zone !== undefined)         row.zone           = patch.zone;
    if (patch.outOfArea !== undefined)    row.out_of_area    = patch.outOfArea;
    if (patch.callForQuote !== undefined) row.call_for_quote = patch.callForQuote;
    if (patch.active !== undefined)       row.active         = patch.active;
    if (patch.notes !== undefined)        row.notes          = patch.notes;
    return row;
  };

  const add = useCallback(async (payload: DeliveryZonePayload): Promise<DeliveryZone | null> => {
    const row = buildRow(payload);
    const { data, error: err } = await supabase
      .from('delivery_zones')
      .insert(row)
      .select('*')
      .single();
    if (err || !data) { setError(err?.message ?? 'Insert failed'); return null; }
    const created = rowToZone(data as DbRow);
    setZones(prev => [...prev.filter(z => z.zipCode !== created.zipCode), created]
      .sort((a, b) => a.zipCode.localeCompare(b.zipCode)));
    return created;
  }, []);

  const update = useCallback(async (zipCode: string, patch: Partial<DeliveryZonePayload>): Promise<boolean> => {
    const row = buildRow(patch);
    if (Object.keys(row).length === 0) return true;
    const { data, error: err } = await supabase
      .from('delivery_zones')
      .update(row)
      .eq('zip_code', zipCode)
      .select('*')
      .single();
    if (err) { setError(err.message); return false; }
    if (data) {
      const updated = rowToZone(data as DbRow);
      setZones(prev => prev.map(z => z.zipCode === zipCode ? updated : z));
    }
    return true;
  }, []);

  const remove = useCallback(async (zipCode: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('delivery_zones')
      .delete()
      .eq('zip_code', zipCode);
    if (err) { setError(err.message); return false; }
    setZones(prev => prev.filter(z => z.zipCode !== zipCode));
    return true;
  }, []);

  return useMemo(() => ({ zones, loading, error, refetch, add, update, remove }),
    [zones, loading, error, refetch, add, update, remove]);
}
