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
import { useAuth } from '../contexts/AuthContext';

const STORAGE_KEY_PREFIX = 'stride_client_filter_';

/**
 * Build the user-namespaced storage key. When impersonating, `user.email`
 * is the impersonated client's email (see AuthContext), so the admin's
 * working-scope filter never bleeds into the impersonated view (and vice
 * versa). Falls back to the legacy unkeyed name when the user isn't loaded
 * yet, so the first paint before auth hydrates still works.
 */
function storageKey(pageKey: string, userEmail: string | undefined): string {
  if (!userEmail) return STORAGE_KEY_PREFIX + pageKey;
  return `${STORAGE_KEY_PREFIX}${userEmail}_${pageKey}`;
}

/**
 * One-shot migration: if the legacy unkeyed `stride_client_filter_<page>`
 * still has a value but the new user-namespaced key doesn't, copy it over
 * and delete the legacy entry. Runs once per (user, pageKey) pair the
 * first time this hook mounts after the rollout — admins keep their
 * current filter selection without having to re-pick it.
 */
function migrateLegacyKey(pageKey: string, userEmail: string | undefined): void {
  if (!userEmail) return;
  try {
    const legacyKey = STORAGE_KEY_PREFIX + pageKey;
    const newKey = storageKey(pageKey, userEmail);
    if (legacyKey === newKey) return;
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue === null) return;
    if (localStorage.getItem(newKey) !== null) {
      // User already has a namespaced value — legacy is just stale.
      localStorage.removeItem(legacyKey);
      return;
    }
    localStorage.setItem(newKey, legacyValue);
    localStorage.removeItem(legacyKey);
  } catch {
    /* best-effort */
  }
}

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

function readLocalStorage(pageKey: string, userEmail: string | undefined): string[] {
  try {
    const v = localStorage.getItem(storageKey(pageKey, userEmail));
    if (!v) return [];
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalStorage(pageKey: string, userEmail: string | undefined, names: string[]) {
  try {
    const key = storageKey(pageKey, userEmail);
    if (names.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(names));
  } catch {
    // Ignore quota errors — localStorage is best-effort.
  }
}

export function useClientFilterPersisted(
  pageKey: string,
  apiClients: ApiClient[]
): [string[], React.Dispatch<React.SetStateAction<string[]>>] {
  // user.email comes from AuthContext and reflects the impersonated user
  // during impersonation, so the storage key naturally swaps too.
  const { user } = useAuth();
  const userEmail = user?.email;

  // First-paint hydration. URL takes precedence if both URL and apiClients are
  // available synchronously (cached `useClients`); otherwise we hydrate from
  // localStorage and the URL-read effect below catches up once apiClients lands.
  const [filter, setFilter] = useState<string[]>(() => {
    migrateLegacyKey(pageKey, userEmail);
    const urlIds = readUrlClientIds();
    if (urlIds.length > 0 && apiClients.length > 0) {
      const names = urlIds
        .map(id => apiClients.find(c => c.spreadsheetId === id)?.name)
        .filter((n): n is string => !!n);
      if (names.length > 0) return names;
    }
    return readLocalStorage(pageKey, userEmail);
  });

  // If the user (or impersonation target) changes after mount, re-hydrate
  // from THAT user's stored filter — otherwise an admin who clicked
  // "Impersonate" would briefly keep their admin filter selected before the
  // page re-renders. Skip when URL has an explicit `?client=` because that
  // wins anyway.
  useEffect(() => {
    if (!userEmail) return;
    migrateLegacyKey(pageKey, userEmail);
    const urlIds = readUrlClientIds();
    if (urlIds.length > 0 && apiClients.length > 0) return;
    setFilter(readLocalStorage(pageKey, userEmail));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail, pageKey]);

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
  // the page's default-selection effect). Keyed by user.email so each user
  // (and each impersonation target) gets their own remembered scope.
  useEffect(() => {
    writeLocalStorage(pageKey, userEmail, filter);
  }, [filter, pageKey, userEmail]);

  // Stable setter identity.
  const setFilterStable = useCallback((next: React.SetStateAction<string[]>) => {
    setFilter(next);
  }, []);

  return [filter, setFilterStable];
}
