import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
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
// version differs from the bundle we're running, flags the app as stale and
// reloads on the next route change so the user is never interrupted
// mid-task. JS/CSS bundles already have content hashes so they cache fine;
// this hook is the detection-and-reload layer for index.html staleness on
// GitHub Pages.
export function useVersionCheck() {
  const stale = useRef(false);
  const firstLocation = useRef(true);
  const location = useLocation();

  // Polling effect — runs once for the app lifetime.
  useEffect(() => {
    if (!RUNNING_VERSION) return;

    let cancelled = false;
    let intervalId: number | undefined;

    const check = async () => {
      if (stale.current || cancelled) return;
      const serverVersion = await fetchServerVersion();
      if (cancelled || !serverVersion) return;
      if (serverVersion !== RUNNING_VERSION) {
        stale.current = true;
        // eslint-disable-next-line no-console
        console.log(
          `[version-check] New version detected (running=${RUNNING_VERSION} built=${RUNNING_BUILD_TIME}, server=${serverVersion}) — refreshing on next navigation...`
        );
        if (intervalId !== undefined) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check();
    };

    void check(); // immediate check so a user who lands right after a deploy is detected fast
    intervalId = window.setInterval(check, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Reload on the next navigation after we've detected a new version.
  // Keyed on location.key (stable per-navigation id) so deep-link param
  // changes within the same path also count — Stride deep links use
  // ?open=<id>&client=<id>, so a user who lives on one tab still gets the
  // reload when they click through to a different entity.
  useEffect(() => {
    if (firstLocation.current) {
      firstLocation.current = false;
      return;
    }
    if (stale.current) {
      window.location.reload();
    }
  }, [location.key]);
}
