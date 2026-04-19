/**
 * useParityMonitor — Admin-only hook that fetches the pricing parity report
 * from GAS (handleGetPricingParity_). Returns a single refresh function so
 * the page can trigger a re-fetch after a sync-to-sheet run.
 *
 * Caching is intentionally disabled — the page is a diagnostic tool and
 * admins need fresh reads after each sync attempt.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchPricingParity, type PricingParityResponse } from '../lib/api';

export interface UseParityMonitorResult {
  data: PricingParityResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastFetchedAt: Date | null;
}

export function useParityMonitor(autoFetch = true): UseParityMonitorResult {
  const [data, setData] = useState<PricingParityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPricingParity()
      .then(res => {
        if (!res.ok || !res.data) {
          setError(res.error || 'Failed to fetch parity data');
          return;
        }
        setData(res.data);
        setLastFetchedAt(new Date());
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (autoFetch) refresh();
  }, [autoFetch, refresh]);

  return { data, loading, error, refresh, lastFetchedAt };
}
