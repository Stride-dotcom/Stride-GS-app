import { useCallback, useEffect, useState } from 'react';
import {
  fetchWarehouseZoneLocationCapacity,
  type WarehouseMapLocationCapacityRow,
} from '@/lib/capacity/capacityModule';
import { useToast } from '@/hooks/use-toast';

// UUID regex (accepts any version; avoids PostgREST 400s on bad values)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUuid(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  if (!v) return null;
  if (v === 'all' || v === 'null' || v === 'undefined') return null;
  if (!UUID_REGEX.test(v)) return null;
  return v;
}

/**
 * Location-level capacity rollup for Heat Map drill-down.
 *
 * Important: do not fetch on initial heat map load (can be large).
 * Fetch on-demand when a zone is selected.
 */
export function useWarehouseMapLocationCapacity(mapId?: string, zoneId?: string | null) {
  const { toast } = useToast();
  const [rows, setRows] = useState<WarehouseMapLocationCapacityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  const normalizedMapId = normalizeUuid(mapId);
  const normalizedZoneId = normalizeUuid(zoneId ?? null);

  const fetchLocations = useCallback(async (overrideMapId?: string) => {
    const targetMapId = normalizeUuid(overrideMapId) ?? normalizedMapId;
    const targetZoneId = normalizedZoneId;
    if (!targetMapId || !targetZoneId) {
      setRows([]);
      setLastRefreshedAt(null);
      return;
    }

    try {
      setLoading(true);
      const data = await fetchWarehouseZoneLocationCapacity({
        mapId: targetMapId,
        zoneId: targetZoneId,
      });
      setRows(data);
      setLastRefreshedAt(new Date());
      setErrorCount(0);
    } catch (error: unknown) {
      console.error('Error fetching map location capacity:', error);
      setRows([]);
      setLastRefreshedAt(null);
      setErrorCount((c) => c + 1);
      setTimeout(() => {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load location drill-down data.',
        });
      }, 0);
    } finally {
      setLoading(false);
    }
  }, [normalizedMapId, normalizedZoneId, toast]);

  useEffect(() => {
    // Skip fetch when params are invalid or after repeated failures
    if (!normalizedMapId || !normalizedZoneId || errorCount >= 3) return;
    fetchLocations();
  }, [fetchLocations, normalizedMapId, normalizedZoneId, errorCount]);

  return {
    rows,
    loading,
    lastRefreshedAt,
    fetchLocations,
    refetch: fetchLocations,
  };
}

