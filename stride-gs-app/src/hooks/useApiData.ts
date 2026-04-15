/**
 * Generic hook for fetching data from the Stride API.
 * Handles loading, error, refetch, abort-on-unmount, and in-memory caching.
 *
 * Cache behavior:
 * - On mount, returns cached data immediately if available (no loading flash)
 * - Stale data (>5 min) triggers a background refetch (silent — no loading spinner)
 * - refetch() always bypasses cache and fetches fresh (shows loading)
 * - Write hooks should call cacheClearAll() after mutations
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ApiResponse } from '../lib/api';
import { setNextFetchNoCache } from '../lib/api';
import { cacheGet, cacheSet, cacheDelete } from '../lib/apiCache';

export interface UseApiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Timestamp of last successful fetch */
  lastFetched: Date | null;
}

export function useApiData<T>(
  fetchFn: (signal?: AbortSignal) => Promise<ApiResponse<T>>,
  /** Auto-fetch on mount. Set false for lazy loading. */
  autoFetch = true,
  /** Cache key — if provided, responses are cached in memory. Derived from fetchFn name by default. */
  cacheKey?: string
): UseApiDataResult<T> {
  // Derive a stable cache key from the fetch function if not provided
  const resolvedKey = cacheKey || fetchFn.name || '';

  // Check cache for initial data (avoids loading state on revisit)
  const cached = resolvedKey ? cacheGet<T>(resolvedKey) : null;

  const [data, setData] = useState<T | null>(cached);
  const [loading, setLoading] = useState(autoFetch && !cached);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(cached ? new Date() : null);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback((bypassCache = false, silent = false) => {
    // Check cache first (unless bypassing)
    if (!bypassCache && resolvedKey) {
      const hit = cacheGet<T>(resolvedKey);
      if (hit) {
        setData(hit);
        setLoading(false);
        setLastFetched(new Date());
        return;
      }
    }

    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Silent mode: don't show loading spinner (used for background refreshes when cached data shown)
    if (!silent) setLoading(true);
    setError(null);

    fetchFn(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        if (result.ok && result.data) {
          setData(result.data);
          setLastFetched(new Date());
          setError(null);
          // Store in cache
          if (resolvedKey) {
            cacheSet(resolvedKey, result.data);
          }
        } else {
          const errMsg = result.error || 'Unknown error';
          setError(errMsg);
          // Defense in depth (session 60): if the backend rejects the request
          // as an auth/permission failure, clear the displayed data AND the
          // cache entry so stale data from a previous user can never leak
          // through. Transient non-auth errors don't clear — we want the user
          // to keep seeing their last-good data during a flaky-network blip.
          const lower = errMsg.toLowerCase();
          const isAuthFailure =
            lower.includes('insufficient permissions') ||
            lower.includes('access denied') ||
            lower.includes('auth_error') ||
            lower.includes('unauthorized') ||
            lower.includes('not authenticated') ||
            lower.includes('user not found') ||
            lower.includes('deactivated');
          if (isAuthFailure) {
            setData(null);
            if (resolvedKey) cacheDelete(resolvedKey);
          }
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
  }, [fetchFn, resolvedKey]);

  useEffect(() => {
    if (autoFetch) {
      // Check if there's a cache hit for the CURRENT key
      const currentCached = resolvedKey ? cacheGet<T>(resolvedKey) : null;
      if (currentCached) {
        // Show cached data immediately (no loading flash), then do a silent
        // background refresh using the normal cache path (Supabase-first,
        // GAS fallback). The cache key already includes the client ID, so
        // per-client data is already isolated. Previously this forced GAS
        // via skipSupabaseCacheOnce() — removed because it caused 90-180s
        // loads when client scope was missing (see session 63 plan).
        setData(currentCached);
        setLoading(false);
        doFetch(false, true);
      } else {
        doFetch();
      }
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
    // Re-run when autoFetch, doFetch (which changes when fetchFn/resolvedKey change),
    // or resolvedKey change. This ensures client-filter changes trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, doFetch, resolvedKey]);

  // v62 (re-disabled): cacheSubscribe pub/sub was intended to sync multiple
  // useApiData instances for the same key (e.g. AppLayout useClients +
  // page useClients). In practice it cascaded re-renders across the tree
  // and produced tight flashing/refetch loops on pages that use multiple
  // hooks sharing a cache key. The original race it solved is handled in
  // AppLayout — see the comment there about NOT pre-fetching useClients.
  // Keeping this useEffect block empty so cacheSubscribe can be brought
  // back with a different mechanism later without having to re-import.

  // refetch always bypasses ALL cache layers and forces a fresh GAS API call.
  // It also deletes the localStorage entry so stale data doesn't resurface
  // when the user navigates away and back (the component re-mounts with
  // useState(cached) which reads localStorage — without this delete, the
  // old data would flash back every time the page is revisited).
  const refetch = useCallback(() => {
    if (resolvedKey) cacheDelete(resolvedKey); // kill localStorage ghost
    setNextFetchNoCache();     // bypass server-side CacheService
    // NOTE: do NOT call skipSupabaseCacheOnce() here. GAS write-through keeps
    // Supabase within ~1-2s of the authoritative sheet, so forcing GAS is only
    // ~15-60s slower for single-client and catastrophic (90s-minutes) for
    // multi-client (gasClientId becomes undefined → unscoped scan). Session 62
    // fix: trust Supabase on refetch. Rare staleness is handled by
    // entityEvents/Realtime re-pulls.
    doFetch(true, false);      // bypass in-memory cache, show loading spinner
  }, [doFetch, resolvedKey]);

  return { data, loading, error, refetch, lastFetched };
}
