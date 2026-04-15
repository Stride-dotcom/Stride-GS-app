/**
 * useClientFilterUrlSync — Keeps the URL's `?client=<spreadsheetIds>` query
 * param in sync with the page's clientFilter state (array of client names).
 *
 * Why: before this hook, picking a client in the dropdown didn't change the
 * URL. That meant:
 *   - You couldn't bookmark / share / copy a URL that reflected the current
 *     filter state.
 *   - Email deep links like `#/tasks?open=<id>&client=<sheetId>` only worked
 *     at mount; once the user navigated, the `client` param vanished.
 *
 * Flow:
 *   1. User picks client in MultiSelectFilter → clientFilter updates
 *   2. This hook maps names → spreadsheetIds via apiClients
 *   3. Writes them to the URL via history.replaceState (no navigation)
 *   4. Preserves other hash-level query params (like ?open=)
 *
 * Uses window.history.replaceState so the URL mutation does NOT trigger a
 * react-router re-render / remount. Safe to call every render; cheap.
 */
import { useEffect } from 'react';
import type { ApiClient } from '../lib/api';

export function useClientFilterUrlSync(
  clientFilter: string[],
  apiClients: ApiClient[]
) {
  useEffect(() => {
    // Don't touch the URL until apiClients has loaded — we'd lose the param
    // when clientFilter is empty on mount because name→id lookup returns [].
    if (apiClients.length === 0) return;

    const ids = clientFilter
      .map((n) => apiClients.find((c) => c.name === n)?.spreadsheetId)
      .filter((x): x is string => !!x);

    const hash = window.location.hash; // e.g. "#/tasks?open=X&client=Y"
    const [hashPath, hashSearch = ''] = hash.split('?');
    const params = new URLSearchParams(hashSearch);

    const desired = ids.join(',');
    const current = params.get('client') || '';
    if (current === desired) return;

    if (desired) {
      params.set('client', desired);
    } else {
      params.delete('client');
    }

    const newSearch = params.toString();
    const newHash = newSearch ? `${hashPath}?${newSearch}` : hashPath;

    // Build a full URL so replaceState doesn't strip the origin
    const newUrl = `${window.location.pathname}${window.location.search}${newHash}`;
    window.history.replaceState(window.history.state, '', newUrl);
  }, [clientFilter, apiClients]);
}
