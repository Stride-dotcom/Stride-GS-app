/**
 * useLocations — Fetches warehouse locations.
 *
 * Session 68 rewrite: Supabase-first (~50ms) with GAS fallback. Subscribes to
 * Realtime changes on public.locations so admin/staff adding a new location
 * propagates to every dropdown instantly without a manual refresh.
 */
import { useMemo, useCallback, useEffect } from 'react';
import { fetchLocations } from '../lib/api';
import { fetchLocationsFromSupabase } from '../lib/supabaseQueries';
import { supabase } from '../lib/supabase';
import type { ApiLocation, LocationsResponse } from '../lib/api';
import { useApiData } from './useApiData';

export interface UseLocationsResult {
  locations: ApiLocation[];
  locationNames: string[];
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

export function useLocations(autoFetch = true): UseLocationsResult {
  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      // 1. Supabase first
      try {
        const sb = await fetchLocationsFromSupabase();
        if (sb && sb.locations.length > 0) {
          return { data: sb, ok: true as const, error: null };
        }
      } catch { /* fall through */ }
      // 2. GAS fallback
      return fetchLocations(signal);
    },
    []
  );

  const { data, loading, error, refetch, lastFetched } = useApiData<LocationsResponse>(
    fetchFn,
    autoFetch,
    'locations'
  );

  // Realtime: new / updated / deleted locations trigger silent refetch
  useEffect(() => {
    if (!autoFetch) return;
    const channel = supabase
      .channel('locations-changes')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'locations' },
          () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [autoFetch, refetch]);

  const locations = useMemo(() => data?.locations ?? [], [data]);
  const locationNames = useMemo(() => locations.map(l => l.location), [locations]);

  return {
    locations,
    locationNames,
    count: data?.count ?? 0,
    loading,
    error,
    refetch,
    lastFetched,
  };
}
