/**
 * useLocationSuggestions — calls the shared capacity suggestion engine and
 * returns the top-3 suggestions in ranked order.
 *
 * Debounces requests by 250 ms so batch-scan bursts don't spam the RPC.
 * Failures are surfaced as an error string; they NEVER block moves.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { buildSharedLocationSuggestions } from '@/lib/capacity/capacityModule';

export interface LocationSuggestion {
  location_id: string;
  location_code: string;
  capacity_cuft: number;
  used_cuft: number;
  available_cuft: number;
  utilization_pct: number;
  flag_compliant: boolean;
  account_cluster: boolean;
  sku_or_vendor_match: boolean;
  group_match: boolean;
  leftover_cuft: number;
  overflow: boolean;
}

interface UseLocationSuggestionsParams {
  tenantId: string | undefined;
  warehouseId: string | undefined;
  mode: 'single' | 'batch';
  itemId?: string | null;
  itemIds?: string[];
  enabled?: boolean;
}

export function useLocationSuggestions({
  tenantId,
  warehouseId,
  mode,
  itemId,
  itemIds,
  enabled = true,
}: UseLocationSuggestionsParams) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Serialise itemIds so the effect can diff properly
  const itemIdsKey = itemIds ? itemIds.join(',') : '';

  const fetchSuggestions = useCallback(async () => {
    if (!tenantId || !warehouseId || !enabled) {
      setSuggestions([]);
      return;
    }

    if (mode === 'single' && !itemId) {
      setSuggestions([]);
      return;
    }

    if (mode === 'batch' && (!itemIds || itemIds.length === 0)) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results = await buildSharedLocationSuggestions({
        tenantId,
        warehouseId,
        mode,
        itemId: mode === 'single' ? itemId || null : null,
        itemIds: mode === 'batch' ? (itemIds || []) : [],
        topN: 3,
      });
      const filtered = (results || []).filter(
        (r: LocationSuggestion) => r && r.location_id,
      );
      setSuggestions(filtered);
    } catch (err) {
      console.error('[useLocationSuggestions] Unexpected error:', err);
      setError('Suggestions unavailable');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, warehouseId, mode, itemId, itemIdsKey, enabled]);

  // Debounced fetch (250 ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchSuggestions();
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchSuggestions]);

  return { suggestions, loading, error, refetch: fetchSuggestions };
}
