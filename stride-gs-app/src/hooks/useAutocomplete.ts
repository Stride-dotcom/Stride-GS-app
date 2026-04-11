/**
 * useAutocomplete — Fetches per-client Autocomplete_DB values from the API.
 * Returns { sidemarks, vendors, descriptions } arrays. Caches per clientSheetId.
 */
import { useState, useEffect, useRef } from 'react';
import { fetchAutocomplete, isApiConfigured } from '../lib/api';

interface AutocompleteData {
  sidemarks: string[];
  vendors: string[];
  descriptions: string[];
}

const EMPTY: AutocompleteData = { sidemarks: [], vendors: [], descriptions: [] };

// In-memory cache so switching between clients doesn't re-fetch
const cache = new Map<string, AutocompleteData>();

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

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    fetchAutocomplete(clientSheetId, ctrl.signal)
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
