/**
 * useTablePreferences — Persists table column visibility, sorting, column
 * order, and status filter per page.
 *
 * Storage layers (in order of precedence on read):
 *   1. **Supabase `public.user_view_prefs`** — server-side source of
 *      truth, keyed by `(user_email, page_key)`. Loads asynchronously
 *      after first paint; when it lands it overwrites whatever was
 *      hydrated from localStorage. This is what makes a user's saved
 *      view follow them across devices, and what makes impersonation
 *      show the impersonated client's ACTUAL view rather than the
 *      admin's localStorage on the admin's machine.
 *   2. **localStorage** — first-paint cache so the table never flashes
 *      empty while Supabase loads. Also serves as the offline write
 *      cache: every state change writes to localStorage synchronously
 *      AND schedules a debounced upsert to Supabase, so unsynced
 *      changes survive a Supabase outage and flush on the next render.
 *   3. **Defaults** — what the caller passes in.
 *
 * One-shot migration: on first mount under a given (user, pageKey),
 * Supabase returns null (no row yet) but localStorage might have a
 * carried-forward selection. We hydrate from local on first paint,
 * and the first debounced write creates the Supabase row — no
 * dedicated migration code path required.
 *
 * Identity changes (impersonate / exit): when `user.email` flips, the
 * effect re-runs, fetches THAT user's prefs from Supabase, and
 * rehydrates state. Any debounced upsert pending for the previous
 * identity is force-flushed first so it doesn't land under the new
 * identity's key.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { SortingState, VisibilityState } from '@tanstack/react-table';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchUserViewPrefs,
  flushPendingUserViewPrefs,
  scheduleUpsertUserViewPrefs,
} from '../lib/userViewPrefsClient';

interface TablePrefs {
  colVis?: VisibilityState;
  sorting?: SortingState;
  columnOrder?: string[];
  statusFilter?: string[];  // multi-select status chips
}

function loadPrefs(storageKey: string): TablePrefs {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migration: convert old single-string statusFilter to array
    if (typeof parsed.statusFilter === 'string') {
      parsed.statusFilter = parsed.statusFilter ? [parsed.statusFilter] : [];
    }
    return parsed;
  } catch {
    return {};
  }
}

function savePrefs(storageKey: string, prefs: TablePrefs) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch { /* quota exceeded — ignore */ }
}

/**
 * Merge a saved column order with the current default — if new columns
 * were added since the user last saved (e.g. "sidemark" added to Billing),
 * insert them at their default position so the user sees the new column
 * without losing their custom ordering.
 */
function reconcileColumnOrder(
  savedOrder: string[] | undefined,
  defaultColumnOrder: string[],
): string[] {
  if (!savedOrder || !savedOrder.length) return defaultColumnOrder;
  if (!defaultColumnOrder.length) return savedOrder;
  const missing = defaultColumnOrder.filter(c => !savedOrder.includes(c));
  if (!missing.length) return savedOrder;
  const merged = [...savedOrder];
  for (const col of missing) {
    const defaultIdx = defaultColumnOrder.indexOf(col);
    const insertAt = Math.min(defaultIdx, merged.length);
    merged.splice(insertAt, 0, col);
  }
  return merged;
}

export function useTablePreferences(
  pageKey: string,
  defaultSorting: SortingState = [],
  defaultColVis: VisibilityState = {},
  defaultColumnOrder: string[] = [],
  defaultStatusFilter: string[] = [],
) {
  const { user } = useAuth();
  const userEmail = user?.email;
  const storageKey = userEmail
    ? `stride_table_${userEmail}_${pageKey}`
    : `stride_table_${pageKey}`;
  // First-paint cache hydration from localStorage — synchronous, so the
  // table never flashes empty before Supabase loads. `saved` is a ref
  // because it's only the initial hydration source; subsequent state is
  // owned by React.
  const saved = useRef(loadPrefs(storageKey));

  const [colVis, setColVisRaw] = useState<VisibilityState>(saved.current.colVis ?? defaultColVis);
  const [sorting, setSortingRaw] = useState<SortingState>(saved.current.sorting ?? defaultSorting);
  const [columnOrder, setColumnOrderRaw] = useState<string[]>(() =>
    reconcileColumnOrder(saved.current.columnOrder, defaultColumnOrder),
  );
  const [statusFilter, setStatusFilterRaw] = useState<string[]>(saved.current.statusFilter ?? defaultStatusFilter);

  const setColVis = useCallback((updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
    setColVisRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  const setSorting = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setSortingRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  const setColumnOrder = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setColumnOrderRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  // Toggle a single status in/out of the filter array
  const toggleStatus = useCallback((status: string) => {
    setStatusFilterRaw(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]);
  }, []);

  // Clear all status filters
  const clearStatusFilter = useCallback(() => {
    setStatusFilterRaw([]);
  }, []);

  // Tracks the userEmail the write-effect last fired under. When userEmail
  // flips (impersonate / exit / late auth), the write effect would
  // otherwise fire once with the stale state closure under the new
  // storageKey, briefly clobbering the new identity's saved prefs in
  // localStorage. Same pattern as useClientFilterPersisted.
  const lastWriteUserRef = useRef<string | undefined>(userEmail);

  // Persist on change — synchronous to localStorage (so unload-safe),
  // debounced 250ms to Supabase (so column-drag doesn't hammer the DB).
  useEffect(() => {
    if (lastWriteUserRef.current !== userEmail) {
      // Force-flush any pending debounced upsert for the previous identity
      // before swapping — otherwise it'd land after this rehydration cycle
      // and overwrite the new identity's value.
      flushPendingUserViewPrefs();
      lastWriteUserRef.current = userEmail;
      return;
    }
    const prefs = { colVis, sorting, columnOrder, statusFilter };
    savePrefs(storageKey, prefs);
    if (userEmail) {
      scheduleUpsertUserViewPrefs(userEmail, pageKey, prefs);
    }
  }, [storageKey, userEmail, pageKey, colVis, sorting, columnOrder, statusFilter]);

  // Async Supabase load on identity change — fetches THIS user's saved
  // prefs and rehydrates React state if the server has a row. If the
  // server returns null (first time on this device for this user), we
  // keep the localStorage-hydrated state and the next save will create
  // the row server-side. Cancellable to handle rapid identity flips
  // (admin clicks Impersonate then Exit before the fetch returns).
  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    (async () => {
      const remotePrefs = await fetchUserViewPrefs(userEmail, pageKey);
      if (cancelled) return;
      if (remotePrefs === null) return; // no server row — keep local
      const next = remotePrefs as TablePrefs;
      // Apply each field independently so any missing field falls back
      // to the default (or carries forward existing state, depending on
      // shape). Identity checks aren't worth the extra code — React
      // bails on shallow-equal sets, and these state updates are cheap.
      if (next.colVis !== undefined) setColVisRaw(next.colVis);
      if (next.sorting !== undefined) setSortingRaw(next.sorting);
      if (next.columnOrder !== undefined) {
        setColumnOrderRaw(reconcileColumnOrder(next.columnOrder, defaultColumnOrder));
      }
      if (next.statusFilter !== undefined) {
        // Convert legacy single-string statusFilter to array if the
        // server still has the old shape from a pre-migration write.
        setStatusFilterRaw(
          typeof next.statusFilter === 'string'
            ? (next.statusFilter ? [next.statusFilter] : [])
            : (next.statusFilter as string[]),
        );
      }
      // Mirror the freshly-fetched server state into the local cache so
      // the NEXT page load (before Supabase responds) starts from the
      // server's authoritative state, not whatever was in localStorage
      // before this fetch landed.
      savePrefs(storageKey, {
        colVis: next.colVis,
        sorting: next.sorting,
        columnOrder: next.columnOrder,
        statusFilter: next.statusFilter,
      });
    })();
    return () => { cancelled = true; };
    // defaultColumnOrder is recreated on every render in some callers
    // (inline literal). Excluding from deps is intentional — we only
    // refetch when the identity or page changes, not when the default
    // array's reference flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, pageKey]);

  // Flush any pending debounced writes on unload so an in-flight drag
  // before the tab closes doesn't get dropped.
  useEffect(() => {
    const handler = () => flushPendingUserViewPrefs();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return { colVis, setColVis, sorting, setSorting, columnOrder, setColumnOrder, statusFilter, toggleStatus, clearStatusFilter };
}
