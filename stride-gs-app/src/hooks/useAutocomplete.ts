/**
 * useAutocomplete — Fetches per-client Autocomplete_DB values from the API.
 * Returns { sidemarks, vendors, descriptions } arrays. Caches per clientSheetId.
 *
 * Session 72 fix: InlineEditableCell instances use this hook per-cell. On a
 * cold page load with 84+ rows, hundreds of identical in-flight fetches used
 * to fire because the in-memory cache only helped AFTER the first response.
 * Added an inflight Map keyed on clientSheetId so all per-cell instances
 * piggy-back on the single shared fetch.
 */
import { useState, useEffect, useRef } from 'react';
import { fetchAutocomplete, isApiConfigured } from '../lib/api';
import type { AutocompleteResponse, ApiResponse } from '../lib/api';

interface AutocompleteData {
  sidemarks: string[];
  vendors: string[];
  descriptions: string[];
}

const EMPTY: AutocompleteData = { sidemarks: [], vendors: [], descriptions: [] };

// In-memory result cache (survives hook unmount/remount within one page).
const cache = new Map<string, AutocompleteData>();

// Session 72 dedup: if a fetch for this clientSheetId is already in flight
// (e.g. cold load fires N cells in parallel), share the promise.
const inflight = new Map<string, Promise<ApiResponse<AutocompleteResponse>>>();

function dedupFetch(clientSheetId: string): Promise<ApiResponse<AutocompleteResponse>> {
  const existing = inflight.get(clientSheetId);
  if (existing) return existing;
  // IMPORTANT: don't pass any one consumer's AbortController to a shared fetch
  // — unmounting one cell would cancel the fetch for every other cell.
  const p = fetchAutocomplete(clientSheetId).finally(() => {
    if (inflight.get(clientSheetId) === p) inflight.delete(clientSheetId);
  });
  inflight.set(clientSheetId, p);
  return p;
}

export function useAutocomplete(clientSheetId: string | undefined) {
  const [data, setData] = useState<AutocompleteData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!clientSheetId || !isApiConfigured()) {
      setData(EMPTY);
      return;
    }

    // Return cached if available
    const cached = cache.get(clientSheetId);
    if (cached) {
      setData(cached);
      return;
    }

    // Own controller tracks only this consumer's unmount state.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    dedupFetch(clientSheetId)
      .then(resp => {
        if (ctrl.signal.aborted) return;
        if (resp.ok && resp.data) {
          cache.set(clientSheetId, resp.data);
          setData(resp.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [clientSheetId]);

  return { ...data, loading };
}
