/**
 * useUrlState — store a single piece of UI state in the URL search params.
 *
 * Why: the browser back button is the contract. If a state change is
 * navigation-meaningful (clicking a row to open a detail panel, switching to a
 * different tab, picking a status filter), it should leave a history entry so
 * that pressing back returns the user to the prior state. The default React
 * pattern of `useState` doesn't do this — every back press just navigates
 * away from the page entirely, losing context.
 *
 * Built on top of react-router-dom v7's `useSearchParams`, which works with
 * HashRouter — the search params live inside the hash route
 * (e.g. `/#/inventory?open=62228&tab=details`) and `useSearchParams` parses
 * them transparently. The hook also re-renders on `popstate`, so back/forward
 * navigation flows naturally back into the component state.
 *
 * Default behaviour pushes a history entry on each change. Pass `replace: true`
 * for transient state (typing in a search box) so back doesn't traverse every
 * keystroke.
 *
 * Limitations:
 *   - String values only. For non-string state (sort arrays, nested objects),
 *     stringify at the call site (e.g. JSON.stringify, then JSON.parse on
 *     read). A JSON-flavoured wrapper can be added later if there's demand.
 *   - The default value is returned when the param is absent OR empty string.
 *     Setting the value to "" deletes the param from the URL — which is the
 *     usual UX intent ("clear the filter" → URL gets shorter).
 *
 * Usage:
 *   const [openId, setOpenId] = useUrlState('open', '');
 *   // openId === '62228' when URL is /#/inventory?open=62228
 *   // setOpenId('44551') pushes /#/inventory?open=44551 (back returns to 62228)
 *   // setOpenId('')      pushes /#/inventory               (back returns to 44551)
 *
 *   const [tab, setTab] = useUrlState('tab', 'orders');
 *   // tab === 'orders' on first load
 *   // setTab('review') pushes /#/orders?tab=review
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface UseUrlStateOptions {
  /**
   * When true, calls to the setter use `history.replaceState` instead of
   * `pushState` — no new history entry is created. Use for transient state
   * like search-box typing or sort hover-states; use the default (push) for
   * deliberate user navigation like clicking a row or switching tabs.
   */
  replace?: boolean;
}

export function useUrlState(
  key: string,
  defaultValue: string,
  opts: UseUrlStateOptions = {}
): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const replace = opts.replace === true;

  // Read the current value. Treat empty-string and missing identically — both
  // resolve to the default. This matches the convention that "" means
  // "no value" for these UI-state slots.
  const raw = searchParams.get(key);
  const value = raw == null || raw === '' ? defaultValue : raw;

  const setValue = useCallback(
    (next: string) => {
      // Read fresh — don't close over stale searchParams from this render. The
      // updater form of setSearchParams gives us the current params at apply
      // time, so concurrent updates to other keys don't get clobbered.
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === '' || next == null) {
            params.delete(key);
          } else {
            params.set(key, next);
          }
          return params;
        },
        { replace }
      );
    },
    [key, replace, setSearchParams]
  );

  return [value, setValue];
}
