import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RUNNING_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

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

// Polls /version.json every 5 minutes. When the server version differs from
// the bundle we're running, flags the app as stale and reloads on the next
// route change so the user is never interrupted mid-task. JS/CSS bundles
// already have content hashes so they cache fine; this hook is the
// detection-and-reload layer for index.html staleness on GitHub Pages.
export function useVersionCheck() {
  const stale = useRef(false);
  const firstLocation = useRef(true);
  const location = useLocation();

  // Polling effect — runs once for the app lifetime.
  useEffect(() => {
    if (!RUNNING_VERSION) return;

    let cancelled = false;

    const check = async () => {
      if (stale.current || cancelled) return;
      const serverVersion = await fetchServerVersion();
      if (cancelled || !serverVersion) return;
      if (serverVersion !== RUNNING_VERSION) {
        stale.current = true;
        // eslint-disable-next-line no-console
        console.log(
          `[version-check] New version detected (running=${RUNNING_VERSION}, server=${serverVersion}) — refreshing on next navigation...`
        );
      }
    };

    const intervalId = window.setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  // Reload on the next navigation after we've detected a new version.
  // Skip the initial mount render so we don't reload on first load.
  useEffect(() => {
    if (firstLocation.current) {
      firstLocation.current = false;
      return;
    }
    if (stale.current) {
      window.location.reload();
    }
  }, [location.pathname]);
}
