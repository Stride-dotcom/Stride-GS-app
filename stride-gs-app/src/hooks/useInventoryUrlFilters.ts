/**
 * useInventoryUrlFilters — read & write the Inventory page's column filters
 * + global search to the URL hash query params, so back-navigation from
 * /inventory/:id restores the exact filter scope the user was on.
 *
 * Without this, column filters and the search box live only in component
 * state. Clicking into an item unmounts the Inventory page; clicking back
 * remounts it with empty filters even though the URL would otherwise carry
 * everything needed to restore the view. Stuffing the filters into the URL
 * also makes the filtered view shareable / bookmarkable.
 *
 * Client filter is handled separately by `useClientFilterUrlSync` /
 * `useClientFilterPersisted` (extra requirements: localStorage backstop,
 * user-scoped impersonation key). This hook covers every other table
 * filter + global search.
 *
 * URL shape (lives inside the HashRouter hash):
 *   #/inventory?client=...&status=Active,Released&vendor=MINOTTI&q=foo
 *
 * Each multi-select column packs as comma-separated values; text columns
 * pass through as-is. `q` carries the global search.
 */
import { useEffect, useMemo } from 'react';
import type { ColumnFiltersState } from '@tanstack/react-table';

// Inventory columns this hook is allowed to round-trip. `clientName` is
// intentionally excluded — the client-name filter has its own URL sync hook
// with stronger semantics (localStorage backstop, late-resolution from
// spreadsheetId, user impersonation).
const MULTI_COLS = ['status', 'sidemark'] as const;
const TEXT_COLS = ['vendor', 'location', 'room', 'reference', 'description', 'itemClass'] as const;

type MultiCol = typeof MULTI_COLS[number];
type TextCol = typeof TEXT_COLS[number];

const ALL_KEYS: ReadonlyArray<MultiCol | TextCol> = [...MULTI_COLS, ...TEXT_COLS];

function isMulti(id: string): id is MultiCol {
  return (MULTI_COLS as readonly string[]).includes(id);
}

function readUrlParams(): URLSearchParams {
  const hash = window.location.hash;
  const qi = hash.indexOf('?');
  if (qi < 0) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qi + 1));
}

/**
 * Read the initial column-filter + global-filter state from the URL.
 * Called once during `useState` lazy init so the page renders the
 * already-filtered view on first paint (no flash of unfiltered content).
 */
export function readInventoryFiltersFromUrl(): {
  columnFilters: ColumnFiltersState;
  globalFilter: string;
} {
  if (typeof window === 'undefined') return { columnFilters: [], globalFilter: '' };
  const params = readUrlParams();
  const columnFilters: ColumnFiltersState = [];
  for (const key of ALL_KEYS) {
    const raw = params.get(key);
    if (!raw) continue;
    if (isMulti(key)) {
      const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) columnFilters.push({ id: key, value: arr });
    } else {
      const v = raw.trim();
      if (v) columnFilters.push({ id: key, value: v });
    }
  }
  const globalFilter = (params.get('q') || '').trim();
  return { columnFilters, globalFilter };
}

/**
 * Returns true if the URL had a `?status=` param on mount. Used to skip the
 * localStorage status-restore effect (URL beats localStorage on first load).
 */
export function urlHadStatusOnMount(): boolean {
  if (typeof window === 'undefined') return false;
  return !!readUrlParams().get('status');
}

/**
 * Mirror state → URL. Uses `history.replaceState` (no extra history entry
 * per keystroke) and only mutates keys this hook owns, leaving `client=` /
 * `open=` etc. intact.
 */
export function useInventoryUrlFiltersWriter(
  columnFilters: ColumnFiltersState,
  globalFilter: string,
): void {
  // Pack into a stable string-map so the effect's dep array compares cheaply.
  const desired = useMemo(() => {
    const map: Partial<Record<MultiCol | TextCol | 'q', string>> = {};
    for (const f of columnFilters) {
      if (!ALL_KEYS.includes(f.id as MultiCol | TextCol)) continue;
      if (isMulti(f.id)) {
        const arr = (f.value as string[] | undefined) ?? [];
        if (arr.length > 0) map[f.id as MultiCol] = arr.join(',');
      } else {
        const v = typeof f.value === 'string' ? f.value.trim() : '';
        if (v) map[f.id as TextCol] = v;
      }
    }
    const q = (globalFilter || '').trim();
    if (q) map.q = q;
    return map;
  }, [columnFilters, globalFilter]);

  useEffect(() => {
    const hash = window.location.hash;
    const [hashPath, hashSearch = ''] = hash.split('?');
    const params = new URLSearchParams(hashSearch);

    let changed = false;
    for (const key of [...ALL_KEYS, 'q'] as const) {
      const next = desired[key as keyof typeof desired];
      const current = params.get(key) || '';
      if (next) {
        if (current !== next) { params.set(key, next); changed = true; }
      } else if (current) {
        params.delete(key); changed = true;
      }
    }
    if (!changed) return;

    const newSearch = params.toString();
    const newHash = newSearch ? `${hashPath}?${newSearch}` : hashPath;
    const newUrl = `${window.location.pathname}${window.location.search}${newHash}`;
    window.history.replaceState(window.history.state, '', newUrl);
  }, [desired]);
}
