import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { hardReloadForUpdate } from '../lib/versionReload';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// Once we've detected a new bundle, if the user hasn't navigated or
// refocused within this window, reload anyway so a tab can't sit on the
// old version indefinitely. 2 min is short enough that a deploy reaches
// users quickly; long enough that someone mid-scan or mid-form has time
// to finish what they're doing.
const STALE_AUTO_RELOAD_MS = 2 * 60 * 1000;
const RUNNING_VERSION = __APP_VERSION__;
const RUNNING_BUILD_TIME = __BUILD_TIME__;

type VersionPayload = { version?: string; buildTime?: string };

async function fetchServerVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as VersionPayload;
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

// Polls /version.json every 5 minutes (plus on tab-focus). When the server
// version differs from the bundle we're running, flags the app as stale
// and reloads via four triggers, in order of friendliness:
//   1. Tab refocus / visibilitychange visible (user just returned — natural)
//   2. Next navigation (least disruptive — finishes current task first)
//   3. Idle timer at STALE_AUTO_RELOAD_MS (catches scanning sessions
//      parked on /scanner that never navigate)
//   4. Manual click of the build-version chip in the sidebar
//
// All four use hardReloadForUpdate() — plain window.location.reload() may
// be served the SAME stale index.html from GitHub Pages' CDN (default
// max-age=600 on root assets), making the "reload" a no-op from the
// user's perspective. That was the root cause of "auto-refresh ran but I
// still see the old version" complaints. See lib/versionReload.ts.
export function useVersionCheck() {
  const [isStale, setIsStale] = useState(false);
  const firstLocation = useRef(true);
  const location = useLocation();

  // Polling effect — runs once for the app lifetime.
  useEffect(() => {
    if (!RUNNING_VERSION) return;

    let cancelled = false;
    let intervalId: number | undefined;

    const check = async () => {
      if (cancelled) return;
      const serverVersion = await fetchServerVersion();
      if (cancelled || !serverVersion) return;
      if (serverVersion !== RUNNING_VERSION) {
        // eslint-disable-next-line no-console
        console.log(
          `[version-check] New version detected (running=${RUNNING_VERSION} built=${RUNNING_BUILD_TIME}, server=${serverVersion}) — refresh on next nav, tab refocus, or ${STALE_AUTO_RELOAD_MS / 1000}s timer.`
        );
        setIsStale(true);
        if (intervalId !== undefined) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
      }
    };

    const onPollVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };

    void check(); // immediate check so a user who lands right after a deploy is detected fast
    intervalId = window.setInterval(check, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onPollVisibility);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onPollVisibility);
    };
  }, []);

  // Reload on tab refocus once we know we're stale — most natural moment
  // to catch users who left the tab open in the background while a new
  // version shipped. They return, see the new bundle, never noticed the
  // reload happened.
  useEffect(() => {
    if (!isStale) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') hardReloadForUpdate();
    };
    const onFocus = () => hardReloadForUpdate();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [isStale]);

  // Idle auto-reload — if the user neither navigates nor refocuses within
  // STALE_AUTO_RELOAD_MS, reload anyway so a scanning session eventually
  // picks up the fix. Only fires if the tab is still visible to avoid
  // reloading background tabs (the refocus handler above will catch them
  // on their way in).
  useEffect(() => {
    if (!isStale) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') hardReloadForUpdate();
    }, STALE_AUTO_RELOAD_MS);
    return () => window.clearTimeout(timer);
  }, [isStale]);

  // Reload on the next navigation. Keyed on location.key (stable
  // per-navigation id) so deep-link param changes within the same path
  // also count — Stride deep links use ?open=<id>&client=<id>, so a user
  // who lives on one tab still gets the reload when they click through
  // to a different entity.
  useEffect(() => {
    if (firstLocation.current) {
      firstLocation.current = false;
      return;
    }
    if (isStale) {
      hardReloadForUpdate();
    }
  }, [location.key, isStale]);

  return { isStale, runningVersion: RUNNING_VERSION, runningBuildTime: RUNNING_BUILD_TIME };
}
