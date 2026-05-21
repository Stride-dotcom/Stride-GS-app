/**
 * useGoBack — history-aware back navigation for detail pages.
 *
 * Returns a callback that pops the SPA history when there's something to
 * pop, and falls back to a hardcoded list route otherwise. The fallback
 * matters for three real cases:
 *
 *   1. Direct links (email CTAs, copy-pasted URLs, fresh-tab bookmarks).
 *      The user lands on /shipments/SHP-001 cold; `navigate(-1)` would
 *      bounce them out of the app to whatever was in the tab before
 *      (google.com, the email client, blank page). The fallback puts them
 *      on the list instead.
 *   2. Error states (not-found, access-denied) reached from inside the
 *      SPA. The page the user came from is still in history.
 *   3. renderAsPage detail-panel close. Same as #2.
 *
 * Why `location.key` instead of `window.history.length`: a fresh tab with
 * one prior site visit has `history.length === 2`, which our previous
 * heuristic interpreted as "came from inside the SPA" and called
 * `navigate(-1)` — that bounced the user OUT of the app to that prior
 * site, never hitting the fallback. React Router stamps the location key
 * the moment a route is pushed via `navigate()`; the very first SPA
 * render uses the literal `'default'` key. So `key !== 'default'` is a
 * precise "have we moved at least one step inside the SPA" signal.
 *
 * Why a hook instead of a one-liner: every detail page used to inline the
 * pattern slightly differently (some had no fallback, some hardcoded the
 * list, some swallowed errors). One hook = one shape, easy to grep, easy
 * to evolve (we may want a `?from=` breadcrumb param later).
 */
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useGoBack(fallbackPath: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    // 'default' is the literal sentinel React Router uses for the very
    // first render of a session. Any subsequent push/replace overwrites it
    // with a unique key — that's our "user moved inside the SPA" signal.
    if (location.key && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  }, [navigate, fallbackPath, location.key]);
}
