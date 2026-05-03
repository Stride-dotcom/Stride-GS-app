/**
 * useAutocomplete — Per-client Sidemark / Vendor / Description value lists
 * used by InlineEditableCell and intake/edit forms.
 *
 * v2026-05-03 (session 92): Supabase-first. Reads `public.autocomplete_db`
 * directly and subscribes to realtime, with the GAS getAutocomplete
 * endpoint kept as a fallback for tenants that haven't been backfilled
 * yet (and as a one-time bootstrap on cold load when Supabase returns
 * zero rows). The slow GAS round-trip used to be the only path; the
 * inflight-dedup + result cache below remain because the GAS fallback
 * still pays that cost on first hit.
 */
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAutocomplete, isApiConfigured } from '../lib/api';
import type { AutocompleteResponse, ApiResponse } from '../lib/api';

interface AutocompleteData {
  sidemarks: string[];
  vendors: string[];
  descriptions: string[];
}

const EMPTY: AutocompleteData = { sidemarks: [], vendors: [], descriptions: [] };

const cache = new Map<string, AutocompleteData>();
const inflight = new Map<string, Promise<ApiResponse<AutocompleteResponse>>>();

function dedupGasFetch(clientSheetId: string): Promise<ApiResponse<AutocompleteResponse>> {
  const existing = inflight.get(clientSheetId);
  if (existing) return existing;
  const p = fetchAutocomplete(clientSheetId).finally(() => {
    if (inflight.get(clientSheetId) === p) inflight.delete(clientSheetId);
  });
  inflight.set(clientSheetId, p);
  return p;
}

function compareCi(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

async function fetchFromSupabase(clientSheetId: string): Promise<AutocompleteData | null> {
  const { data, error } = await supabase
    .from('autocomplete_db')
    .select('field, value')
    .eq('tenant_id', clientSheetId)
    .limit(50000);
  if (error || !data) return null;
  const sidemarks: string[] = [];
  const vendors: string[] = [];
  const descriptions: string[] = [];
  for (const row of data as { field: string; value: string }[]) {
    if (!row.value) continue;
    if (row.field === 'Sidemark') sidemarks.push(row.value);
    else if (row.field === 'Vendor') vendors.push(row.value);
    else if (row.field === 'Description') descriptions.push(row.value);
  }
  sidemarks.sort(compareCi);
  vendors.sort(compareCi);
  descriptions.sort(compareCi);
  return { sidemarks, vendors, descriptions };
}

export function useAutocomplete(clientSheetId: string | undefined) {
  const [data, setData] = useState<AutocompleteData>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientSheetId) {
      setData(EMPTY);
      return;
    }

    const cached = cache.get(clientSheetId);
    if (cached) setData(cached);

    let cancelled = false;
    setLoading(true);

    // Supabase-first. Falls back to GAS on Supabase error OR when the
    // Supabase row count is zero (covers tenants that haven't been
    // backfilled yet — first GAS call also kicks off a write-through on
    // the StrideAPI side, so by the second open the table is populated).
    (async () => {
      const sb = await fetchFromSupabase(clientSheetId);
      if (cancelled) return;
      const sbCount = sb ? sb.sidemarks.length + sb.vendors.length + sb.descriptions.length : 0;
      if (sb && sbCount > 0) {
        cache.set(clientSheetId, sb);
        setData(sb);
        setLoading(false);
        return;
      }
      if (!isApiConfigured()) {
        if (sb) { cache.set(clientSheetId, sb); setData(sb); }
        setLoading(false);
        return;
      }
      try {
        const resp = await dedupGasFetch(clientSheetId);
        if (cancelled) return;
        if (resp.ok && resp.data) {
          cache.set(clientSheetId, resp.data);
          setData(resp.data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [clientSheetId]);

  // Realtime — refetch on any insert/update for this tenant. Cheap
  // because the row count per tenant is small (a few hundred values
  // typically).
  const refetchRef = useRef<() => void>(() => {});
  useEffect(() => {
    refetchRef.current = async () => {
      if (!clientSheetId) return;
      const sb = await fetchFromSupabase(clientSheetId);
      if (sb) {
        cache.set(clientSheetId, sb);
        setData(sb);
      }
    };
  }, [clientSheetId]);

  useEffect(() => {
    if (!clientSheetId) return;
    const channel = supabase
      .channel(`autocomplete_db:${clientSheetId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'autocomplete_db', filter: `tenant_id=eq.${clientSheetId}` },
        () => { void refetchRef.current(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [clientSheetId]);

  return { ...data, loading };
}
