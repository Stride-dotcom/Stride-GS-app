/**
 * useBillingActivity — audit trail feed for the Billing Activity tab.
 * Reads from Supabase billing_activity_log and refetches on realtime events.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  fetchBillingActivityLog,
  type BillingActivityRow,
  type BillingActivityFilters,
} from '../lib/supabaseQueries';
import { entityEvents } from '../lib/entityEvents';

export interface UseBillingActivityResult {
  rows: BillingActivityRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setFilters: (f: BillingActivityFilters) => void;
  filters: BillingActivityFilters;
}

export function useBillingActivity(
  initialFilters: BillingActivityFilters = {},
  enabled: boolean = true,
): UseBillingActivityResult {
  const [rows, setRows] = useState<BillingActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BillingActivityFilters>(initialFilters);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchBillingActivityLog(filters);
      if (result) {
        setRows(result.rows);
      } else {
        setError('Failed to load billing activity');
        setRows([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, filters]);

  // Initial + filter-change fetch
  useEffect(() => { refetch(); }, [refetch]);

  // Realtime: refetch when billing_activity_log changes
  useEffect(() => {
    if (!enabled) return;
    const unsub = entityEvents.subscribe((entityType) => {
      if (entityType === 'billing_activity_log') {
        refetch();
      }
    });
    return unsub;
  }, [enabled, refetch]);

  return { rows, loading, error, refetch, setFilters, filters };
}
