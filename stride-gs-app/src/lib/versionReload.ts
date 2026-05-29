// Force-reload the app to pick up a newer bundle.
//
// `window.location.reload()` is a "soft" reload — the browser may still serve
// the cached index.html (GitHub Pages serves root assets with a 600s
// Cache-Control max-age by default), which means the user reloads but gets
// the SAME stale index.html, which references the SAME old bundle hash.
// That's the root cause of "auto-refresh ran but I still see the old version".
//
// Cache-busting via a query string forces the browser AND the GitHub Pages
// CDN to treat the URL as a fresh request. The hash (HashRouter route) is
// preserved so the user lands back on the page they were on.

const PARAM = '_v';

export function hardReloadForUpdate(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    // Fallback — shouldn't happen in any browser that runs the app.
    window.location.reload();
  }
}

// After a hard-reload-for-update, the URL carries `?_v=<ts>` which is ugly.
// Strip it on first paint so subsequent shares/copies don't carry the param.
export function stripVersionReloadParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    const clean = url.pathname + (url.search ? `?${url.searchParams.toString()}` : '') + url.hash;
    window.history.replaceState(window.history.state, '', clean);
  } catch {
    // ignore — cosmetic only
  }
}
