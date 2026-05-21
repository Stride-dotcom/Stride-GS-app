/**
 * useGoBack — history-aware back navigation for detail pages.
 *
 * Returns a callback that pops the browser history when there's something
 * to pop, and falls back to a hardcoded list route otherwise. The fallback
 * matters for three real cases:
 *
 *   1. Direct links (email CTAs, copy-pasted URLs, Gmail-stripped fragments
 *      auto-corrected). The user lands on /shipments/SHP-001 in a fresh
 *      tab with history.length === 1; `navigate(-1)` would no-op or bounce
 *      them out of the SPA. The fallback puts them on the list instead.
 *   2. Error states (not-found, access-denied). The page the user came
 *      from is still in history, so `navigate(-1)` works.
 *   3. renderAsPage detail-panel close. Same as #2.
 *
 * Why a hook instead of a one-liner: every detail page used to inline the
 * pattern slightly differently (some had no fallback, some hardcoded the
 * list, some swallowed errors). One hook = one shape, easy to grep, easy
 * to evolve (we may want to add ?from= tracking later for true breadcrumb
 * navigation).
 *
 * The history-length check is intentionally generous — anything > 1 means
 * the user took at least one step inside the SPA, so `navigate(-1)` lands
 * somewhere we control. `window.history.length` includes entries from
 * before the SPA loaded (other sites visited in the same tab), so the
 * back step might leave the app — that's the user's intent if they kept
 * tapping back, and is the desired behavior anyway.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useGoBack(fallbackPath: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  }, [navigate, fallbackPath]);
}
