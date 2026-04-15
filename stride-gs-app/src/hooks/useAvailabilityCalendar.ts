/**
 * useAvailabilityCalendar — Reads/writes the delivery_availability table.
 *
 * Session 65. Warehouse-wide calendar (tenant_id = 'stride'). All
 * authenticated users can read; only admin can write (enforced by RLS +
 * the upsert_delivery_availability RPC function).
 *
 * Adapted from the Stride WMS reference files — no React Query, uses
 * useState/useEffect matching the existing GS Inventory hook pattern.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Types ───────────────────────────────────────────────────────────────
export type AvailabilityStatus = 'open' | 'limited' | 'closed';

export interface AvailabilityEntry {
  id: string;
  tenant_id: string;
  date: string;       // YYYY-MM-DD
  status: AvailabilityStatus;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface UpsertEntry {
  date: string;        // YYYY-MM-DD
  status: AvailabilityStatus;
}

const TENANT_ID = 'stride'; // warehouse-global

// ── Hook ────────────────────────────────────────────────────────────────
export function useAvailabilityCalendar() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [entries, setEntries] = useState<AvailabilityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('delivery_availability')
        .select('*')
        .eq('tenant_id', TENANT_ID)
        .order('date', { ascending: true });

      if (err) throw err;
      setEntries((data as AvailabilityEntry[]) ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchEntries(); }, [fetchEntries]);

  // ── Derived state ─────────────────────────────────────────────────────
  const availabilityMap = useMemo(() => {
    const map = new Map<string, AvailabilityEntry>();
    for (const entry of entries) map.set(entry.date, entry);
    return map;
  }, [entries]);

  const lastUpdated = useMemo(() => {
    return entries.reduce<string | null>((latest, e) => {
      if (!latest || e.updated_at > latest) return e.updated_at;
      return latest;
    }, null);
  }, [entries]);

  const getStatus = useCallback(
    (dateStr: string): AvailabilityStatus => {
      return availabilityMap.get(dateStr)?.status ?? 'open';
    },
    [availabilityMap]
  );

  // ── Mutations ─────────────────────────────────────────────────────────
  const upsert = useCallback(async (upsertEntries: UpsertEntry[]) => {
    if (!isAdmin || upsertEntries.length === 0) return;
    setIsUpdating(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc('upsert_delivery_availability', {
        p_tenant_id: TENANT_ID,
        p_entries: upsertEntries,
      });
      if (err) throw err;
      // Optimistic: update local state immediately
      setEntries(prev => {
        const updated = [...prev];
        for (const ue of upsertEntries) {
          const idx = updated.findIndex(e => e.date === ue.date);
          const now = new Date().toISOString();
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], status: ue.status, updated_at: now, updated_by: user?.email ?? null };
          } else {
            updated.push({
              id: crypto.randomUUID(),
              tenant_id: TENANT_ID,
              date: ue.date,
              status: ue.status,
              updated_by: user?.email ?? null,
              updated_at: now,
              created_at: now,
            });
          }
        }
        return updated.sort((a, b) => a.date.localeCompare(b.date));
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      // Refetch to resync on error
      void fetchEntries();
    } finally {
      setIsUpdating(false);
    }
  }, [isAdmin, user?.email, fetchEntries]);

  const updateSingle = useCallback(
    (date: string, status: AvailabilityStatus) => { void upsert([{ date, status }]); },
    [upsert]
  );

  const updateBatch = useCallback(
    (batch: UpsertEntry[]) => { void upsert(batch); },
    [upsert]
  );

  return {
    entries,
    availabilityMap,
    lastUpdated,
    loading,
    error,
    isAdmin,
    isUpdating,
    getStatus,
    updateSingle,
    updateBatch,
    refetch: fetchEntries,
  };
}
