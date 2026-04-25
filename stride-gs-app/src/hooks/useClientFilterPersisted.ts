/**
 * useClientFilterPersisted — drop-in replacement for `useState<string[]>([])`
 * that persists the per-page client dropdown selection across navigation.
 *
 * Why: every list page (Inventory / Tasks / Repairs / Will Calls / Shipments)
 * holds its `clientFilter` (array of client names) in plain `useState`. When
 * the user clicks into an entity detail page (e.g. `/inventory/12345`) and
 * then hits the browser back button, the list page re-mounts and the filter
 * resets to "all clients" — losing the user's working scope. Same pain when
 * navigating between list pages via the sidebar.
 *
 * The fix layers two persistence mechanisms:
 *
 *   1. URL `?client=<sheetId,sheetId>` (already written by
 *      `useClientFilterUrlSync`). Used for shareable / bookmarkable deep
 *      links (e.g. email CTAs that open a list scoped to one client).
 *   2. localStorage (`stride_client_filter_<pageKey>`). Used as the
 *      "remember my last view" backstop so back-nav works regardless of
 *      whether the URL still carries `?client=`.
 *
 * Initial state precedence on mount:
 *   a. URL `?client=` (resolved to names via apiClients) — this wins when
 *      present so an email deep-link always opens the intended scope.
 *   b. localStorage entry for this pageKey — covers the back-nav case.
 *   c. Empty array — falls through to the page's own role-based default
 *      effect (auto-select all clients for staff/admin, accessible-only
 *      for client-portal users).
 *
 * The page's existing `useClientFilterUrlSync(clientFilter, apiClients)`
 * call is unchanged — this hook only adds the *read* side and the
 * localStorage layer. URL writes still flow through the existing one-way
 * sync hook.
 */
import { useEffect, useState, useCallback } from 'react';
import type { ApiClient } from '../lib/api';

const STORAGE_KEY_PREFIX = 'stride_client_filter_';

function readUrlClientIds(): string[] {
  try {
    const hash = window.location.hash;
    const qi = hash.indexOf('?');
    if (qi < 0) return [];
    const params = new URLSearchParams(hash.slice(qi + 1));
    const v = params.get('client');
    return v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readLocalStorage(pageKey: string): string[] {
  try {
    const v = localStorage.getItem(STORAGE_KEY_PREFIX + pageKey);
    if (!v) return [];
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalStorage(pageKey: string, names: string[]) {
  try {
    if (names.length === 0) localStorage.removeItem(STORAGE_KEY_PREFIX + pageKey);
    else localStorage.setItem(STORAGE_KEY_PREFIX + pageKey, JSON.stringify(names));
  } catch {
    // Ignore quota errors — localStorage is best-effort.
  }
}

export function useClientFilterPersisted(
  pageKey: string,
  apiClients: ApiClient[]
): [string[], React.Dispatch<React.SetStateAction<string[]>>] {
  // First-paint hydration. URL takes precedence if both URL and apiClients are
  // available synchronously (cached `useClients`); otherwise we hydrate from
  // localStorage and the URL-read effect below catches up once apiClients lands.
  const [filter, setFilter] = useState<string[]>(() => {
    const urlIds = readUrlClientIds();
    if (urlIds.length > 0 && apiClients.length > 0) {
      const names = urlIds
        .map(id => apiClients.find(c => c.spreadsheetId === id)?.name)
        .filter((n): n is string => !!n);
      if (names.length > 0) return names;
    }
    return readLocalStorage(pageKey);
  });

  // Late URL resolution: if apiClients arrives after first paint AND the user
  // hasn't picked a filter yet AND the URL has `?client=` IDs, resolve them
  // now. Email deep-links rely on this — they often arrive before clients load.
  // Dep is `apiClients.length` (a stable number, not the array reference, to
  // avoid React #300 from referential instability).
  useEffect(() => {
    if (apiClients.length === 0) return;
    if (filter.length > 0) return;
    const urlIds = readUrlClientIds();
    if (urlIds.length === 0) return;
    const names = urlIds
      .map(id => apiClients.find(c => c.spreadsheetId === id)?.name)
      .filter((n): n is string => !!n);
    if (names.length > 0) setFilter(names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClients.length]);

  // Write to localStorage on every change so the next mount restores the
  // user's last view. Empty array clears the entry (and the next visit gets
  // the page's default-selection effect).
  useEffect(() => {
    writeLocalStorage(pageKey, filter);
  }, [filter, pageKey]);

  // Stable setter identity.
  const setFilterStable = useCallback((next: React.SetStateAction<string[]>) => {
    setFilter(next);
  }, []);

  return [filter, setFilterStable];
}
