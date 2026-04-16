import { useCallback, useEffect, useState } from 'react';
import {
  fetchWarehouseMapZoneCapacity,
  type WarehouseMapZoneCapacityRow,
} from '@/lib/capacity/capacityModule';

// UUID regex (accepts any version; avoids PostgREST 400s on bad values)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUuid(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  if (!v) return null;
  // Common "sentinel" values that sometimes slip through from filters or URL params.
  if (v === 'all' || v === 'null' || v === 'undefined') return null;
  if (!UUID_REGEX.test(v)) return null;
  return v;
}

export function useWarehouseMapZoneCapacity(mapId?: string) {
  const [rows, setRows] = useState<WarehouseMapZoneCapacityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  const normalizedMapId = normalizeUuid(mapId);

  const fetchCapacity = useCallback(async (overrideMapId?: string) => {
    const targetMapId = normalizeUuid(overrideMapId) ?? normalizedMapId;
    if (!targetMapId) {
      setRows([]);
      setLastRefreshedAt(null);
      return;
    }

    try {
      setLoading(true);
      const data = await fetchWarehouseMapZoneCapacity({ mapId: targetMapId });
      setRows(data);
      setLastRefreshedAt(new Date());
      setErrorCount(0);
    } catch (error: unknown) {
      console.error('Error fetching map zone capacity:', error);
      // Ensure callers never render stale/partial heat map state after a failed load.
      setRows([]);
      setLastRefreshedAt(null);
      setErrorCount((c) => c + 1);
    } finally {
      setLoading(false);
    }
  }, [normalizedMapId]);

  useEffect(() => {
    // Skip fetch when mapId is invalid or after repeated failures
    if (!normalizedMapId || errorCount >= 3) return;
    fetchCapacity();
  }, [fetchCapacity, normalizedMapId, errorCount]);

  return {
    rows,
    loading,
    lastRefreshedAt,
    fetchCapacity,
    refetch: fetchCapacity,
  };
}

