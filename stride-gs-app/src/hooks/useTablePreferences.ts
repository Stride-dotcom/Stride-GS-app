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
 * and the first debounced write *after* server hydration completes
 * creates the Supabase row.
 *
 * Identity changes (impersonate / exit): when `user.email` flips, the
 * effect re-runs, fetches THAT user's prefs from Supabase, and
 * rehydrates state. Any debounced upsert pending for the previous
 * identity is force-flushed first so it doesn't land under the new
 * identity's key.
 *
 * Impersonation read-only mode: while `isImpersonating` is true the
 * hook surfaces the impersonated user's saved view BUT does not
 * persist any subsequent edits (neither to the admin's localStorage
 * nor to Supabase). Two reasons:
 *   - The Supabase self-policy blocks writes from the admin's JWT
 *     under another `user_email`, so the upsert silently fails RLS.
 *   - Even if it didn't, writing the admin's accidental column-drag
 *     to the impersonated user's persistent view would be a bad
 *     surprise to the client on their next login.
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

/** Normalize a possibly-legacy `statusFilter` value to an array. */
function normalizeStatusFilter(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((s): s is string => typeof s === 'string');
  if (typeof value === 'string') return value ? [value] : [];
  return [];
}

export function useTablePreferences(
  pageKey: string,
  defaultSorting: SortingState = [],
  defaultColVis: VisibilityState = {},
  defaultColumnOrder: string[] = [],
  defaultStatusFilter: string[] = [],
) {
  const { user, isImpersonating } = useAuth();
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

  // ── Hydration / edit-protection refs ─────────────────────────────────
  // Without these refs we get two real bugs:
  //
  //   1. Initial-mount write races the Supabase load. The write effect
  //      below would fire at T=0 (deps just settled) and schedule an
  //      upsert of the localStorage-hydrated prefs. On a slow connection
  //      that 250ms-debounced upsert can land BEFORE the load effect's
  //      fetch returns, overwriting authoritative server state with
  //      stale local data. `serverHydratedRef` flips true once the
  //      fetch settles (with a row or null); the write effect early-
  //      returns until then.
  //
  //   2. Server load clobbers an in-flight user drag. A user dragging
  //      columns at T=10ms while the fetch returns at T=200ms would see
  //      their drag state reset by the rehydration setter calls. The
  //      load effect checks `userEditedRef` and skips rehydration if
  //      the user has touched anything since mount.
  const serverHydratedRef = useRef(false);
  const userEditedRef = useRef(false);

  // Wrap each setter so a user-driven change flips `userEditedRef`. The
  // wrappers identity-preserve the value when the updater function
  // returns the same reference, which is the normal TanStack Table
  // pattern, so we only mark edited on a genuine value change.
  const setColVis = useCallback((updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
    setColVisRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next !== prev) userEditedRef.current = true;
      return next;
    });
  }, []);

  const setSorting = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setSortingRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next !== prev) userEditedRef.current = true;
      return next;
    });
  }, []);

  const setColumnOrder = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setColumnOrderRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next !== prev) userEditedRef.current = true;
      return next;
    });
  }, []);

  // Toggle a single status in/out of the filter array
  const toggleStatus = useCallback((status: string) => {
    setStatusFilterRaw(prev => {
      const next = prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status];
      userEditedRef.current = true;
      return next;
    });
  }, []);

  // Clear all status filters
  const clearStatusFilter = useCallback(() => {
    setStatusFilterRaw(prev => {
      if (prev.length === 0) return prev;
      userEditedRef.current = true;
      return [];
    });
  }, []);

  // Tracks the userEmail the write-effect last fired under. When userEmail
  // flips (impersonate / exit / late auth), the write effect would
  // otherwise fire once with the stale state closure under the new
  // storageKey, briefly clobbering the new identity's saved prefs in
  // localStorage. Same pattern as useClientFilterPersisted.
  const lastWriteUserRef = useRef<string | undefined>(userEmail);

  // Persist on change — synchronous to localStorage (so unload-safe),
  // debounced 250ms to Supabase (so column-drag doesn't hammer the DB).
  // Skipped entirely while impersonating: the admin's edits are
  // intentionally ephemeral so we don't pollute the impersonated user's
  // saved view OR rack up silent RLS-rejected writes.
  useEffect(() => {
    if (lastWriteUserRef.current !== userEmail) {
      // Force-flush any pending debounced upsert for the previous identity
      // before swapping — otherwise it'd land after this rehydration cycle
      // and overwrite the new identity's value.
      flushPendingUserViewPrefs();
      lastWriteUserRef.current = userEmail;
      // Identity changed; next fetch is authoritative — clear the
      // edited flag so the load effect is allowed to rehydrate state
      // under the new identity.
      userEditedRef.current = false;
      serverHydratedRef.current = false;
      return;
    }
    // Don't write until the Supabase load has had a chance to land
    // (or to confirm there's no row). Otherwise we'd race-overwrite
    // authoritative server state with stale local-cache data on first
    // mount.
    if (!serverHydratedRef.current) return;
    if (isImpersonating) return; // ephemeral admin session — see header
    const prefs = { colVis, sorting, columnOrder, statusFilter };
    savePrefs(storageKey, prefs);
    if (userEmail) {
      scheduleUpsertUserViewPrefs(userEmail, pageKey, prefs);
    }
  }, [storageKey, userEmail, pageKey, isImpersonating, colVis, sorting, columnOrder, statusFilter]);

  // Async Supabase load on identity change — fetches THIS user's saved
  // prefs and rehydrates React state if the server has a row. If the
  // server returns null (first time on this device for this user), we
  // keep the localStorage-hydrated state and the next save will create
  // the row server-side.
  //
  // The cancellation flag handles two cases:
  //   - identity flips again before this fetch completes (admin clicks
  //     Impersonate then Exit quickly), and
  //   - the user has already started editing — userEditedRef short-
  //     circuits the rehydration so a slow fetch doesn't clobber an
  //     in-flight column drag.
  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    (async () => {
      const remotePrefs = await fetchUserViewPrefs(userEmail, pageKey);
      if (cancelled) return;
      // User has touched the table since mount — respect their edits
      // and DON'T rehydrate. Their save will eventually persist via
      // the write effect (which is unblocked by serverHydratedRef
      // below) and become the authoritative version next time.
      if (userEditedRef.current) {
        serverHydratedRef.current = true;
        return;
      }
      if (remotePrefs === null) {
        // No server row yet — keep the local-hydrated state. Unblock
        // the write effect so the next user edit creates the row.
        serverHydratedRef.current = true;
        return;
      }
      const next = remotePrefs as TablePrefs;
      const normalizedStatusFilter = next.statusFilter !== undefined
        ? normalizeStatusFilter(next.statusFilter)
        : undefined;
      // Apply each field independently so any missing field falls back
      // to whatever the user already had (the local-hydrated state).
      if (next.colVis !== undefined) setColVisRaw(next.colVis);
      if (next.sorting !== undefined) setSortingRaw(next.sorting);
      if (next.columnOrder !== undefined) {
        setColumnOrderRaw(reconcileColumnOrder(next.columnOrder, defaultColumnOrder));
      }
      if (normalizedStatusFilter !== undefined) {
        setStatusFilterRaw(normalizedStatusFilter);
      }
      // Mirror the freshly-fetched server state into the local cache so
      // the NEXT page load (before Supabase responds) starts from the
      // server's authoritative state. Write the NORMALIZED statusFilter
      // (array form) so the cache never re-introduces the legacy string.
      savePrefs(storageKey, {
        colVis: next.colVis,
        sorting: next.sorting,
        columnOrder: next.columnOrder,
        statusFilter: normalizedStatusFilter,
      });
      serverHydratedRef.current = true;
    })();
    return () => { cancelled = true; };
    // defaultColumnOrder is recreated on every render in some callers
    // (inline literal). Excluding from deps is intentional — we only
    // refetch when the identity or page changes, not when the default
    // array's reference flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, pageKey]);

  // Flush any pending debounced writes on unload so an in-flight drag
  // before the tab closes doesn't get dropped. Modern browsers will
  // typically abort an in-flight fetch on unload, so this is best-
  // effort durability; localStorage remains the authoritative
  // close-tab backstop and a subsequent open will re-flush via the
  // normal write effect.
  useEffect(() => {
    const handler = () => flushPendingUserViewPrefs();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return { colVis, setColVis, sorting, setSorting, columnOrder, setColumnOrder, statusFilter, toggleStatus, clearStatusFilter };
}
