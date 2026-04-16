/**
 * usePaymentTerms — Fetches the operator-maintained Payment_Terms list from CB.
 *
 * Session 70 fix #2: replaces the hardcoded 6-option Payment Terms dropdown in
 * OnboardClientModal (and the client Edit modal) with a dynamic list sourced
 * from the CB `Payment_Terms` tab, so the list always matches the user's
 * QuickBooks payment-terms list.
 *
 * GAS-only — small payload, short TTL, changes are rare. No Supabase mirror.
 */
import { useMemo, useCallback } from 'react';
import { fetchPaymentTerms } from '../lib/api';
import type { PaymentTermsResponse } from '../lib/api';
import { useApiData } from './useApiData';

export interface UsePaymentTermsResult {
  terms: string[];
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

export function usePaymentTerms(autoFetch = true): UsePaymentTermsResult {
  const fetchFn = useCallback(
    async (signal?: AbortSignal) => fetchPaymentTerms(signal),
    []
  );

  const { data, loading, error, refetch, lastFetched } = useApiData<PaymentTermsResponse>(
    fetchFn,
    autoFetch,
    'payment_terms'
  );

  const terms = useMemo(() => data?.terms ?? [], [data]);

  return {
    terms,
    count: data?.count ?? 0,
    loading,
    error,
    refetch,
    lastFetched,
  };
}
