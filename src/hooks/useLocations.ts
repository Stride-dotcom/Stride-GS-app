/**
 * useLocations — Fetches warehouse locations from the Stride API.
 *
 * Returns location strings for dropdowns and the full location objects
 * with notes for reference.
 */
import { useMemo } from 'react';
import { fetchLocations } from '../lib/api';
import type { ApiLocation, LocationsResponse } from '../lib/api';
import { useApiData } from './useApiData';

export interface UseLocationsResult {
  /** Full location objects (location + notes) */
  locations: ApiLocation[];
  /** Just the location strings, for dropdown options */
  locationNames: string[];
  /** Total count */
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

export function useLocations(autoFetch = true): UseLocationsResult {
  const { data, loading, error, refetch, lastFetched } = useApiData<LocationsResponse>(
    fetchLocations,
    autoFetch,
    'locations'
  );

  const locations = data?.locations ?? [];

  const locationNames = useMemo(
    () => locations.map(l => l.location),
    [locations]
  );

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
