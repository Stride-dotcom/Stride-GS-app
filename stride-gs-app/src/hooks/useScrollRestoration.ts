/**
 * useScrollRestoration — restore + persist a scrollable container's scroll
 * position across navigations.
 *
 * Why: when a user scrolls partway through a long list (Inventory has 1k+
 * rows under TanStack virtualization), clicks into an entity detail page
 * (e.g. `/inventory/12345`), and hits the browser back button, they expect
 * to land at the same scroll position. React Router 7's `<ScrollRestoration />`
 * handles window-scroll for BrowserRouter only — and never handles internal
 * scroll containers, which is exactly what virtualized tables use.
 *
 * Strategy: save the container's `scrollTop` to `sessionStorage` under a
 * stable per-page key. On the next mount + once `isReady` flips true (data
 * has loaded so the container is full-height and the virtualizer has
 * measured), restore the saved position via `requestAnimationFrame`.
 *
 * Why sessionStorage (not history.state):
 *   - sessionStorage is per-tab and survives back/forward navigation.
 *   - history.state IS technically per-entry but doesn't survive React
 *     Router's `replaceState` calls (which we use for filter URL syncing),
 *     and is awkward to read on a fresh mount.
 *   - sessionStorage clears on tab close, which is the right "fresh start"
 *     boundary — restoring scroll from a week-old session would be confusing.
 *
 * Page-key scoping: a single per-route key. Filter changes intentionally do
 * NOT get their own scroll histories — switching client filter is
 * conceptually a new view, and restoring a scroll position from a different
 * filter would land on rows that aren't visible anymore.
 */
import { useEffect, useRef } from 'react';

const STORAGE_KEY_PREFIX = 'stride_scroll_';

export function useScrollRestoration(
  key: string,
  scrollElementRef: React.RefObject<HTMLElement | null>,
  isReady: boolean
) {
  // Save scroll position throttled via rAF.
  useEffect(() => {
    const el = scrollElementRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        try {
          // Skip writes when scrollTop is 0 — that's the default and writing
          // it would clobber a real saved position from the previous mount
          // before isReady flips true.
          if (el.scrollTop > 0) {
            sessionStorage.setItem(STORAGE_KEY_PREFIX + key, String(el.scrollTop));
          }
        } catch {
          // Ignore quota / private-mode failures — sessionStorage is best-effort.
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, scrollElementRef]);

  // Restore once data is ready. Guarded by `restoredRef` so we don't fight
  // user scroll if `isReady` later flips back-and-forth (e.g. refetch loops).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!isReady) return;
    if (restoredRef.current) return;
    const el = scrollElementRef.current;
    if (!el) return;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_PREFIX + key);
      if (saved) {
        const top = parseInt(saved, 10);
        if (!isNaN(top) && top > 0) {
          // Wait one frame so the virtualizer has measured the total height
          // and the container has full content. Without rAF, scrollTop = top
          // can clamp to whatever the placeholder height was at this instant.
          requestAnimationFrame(() => {
            if (el) el.scrollTop = top;
          });
        }
      }
    } catch {
      // Ignore.
    }
    restoredRef.current = true;
  }, [key, scrollElementRef, isReady]);
}
