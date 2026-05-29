import { useEffect, useState } from 'react';
import { theme } from '../../styles/theme';

// __APP_VERSION__ and __BUILD_TIME__ are injected at build time by vite.config.ts.
const RUNNING_VERSION = __APP_VERSION__;
const RUNNING_BUILD_TIME = __BUILD_TIME__;

const POLL_INTERVAL_MS = 5 * 60 * 1000;

type VersionPayload = { version?: string; buildTime?: string };

function formatBuildTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface Props {
  collapsed: boolean;
}

export function BuildVersionChip({ collapsed }: Props) {
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  // Light second polling loop next to useVersionCheck so the chip can show
  // a stale-build state. useVersionCheck handles the actual reload; this
  // is purely a UI signal. Sharing the poll between them would couple the
  // hook to the chip's lifetime — keeping them independent is simpler.
  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as VersionPayload;
        if (cancelled) return;
        if (typeof data?.version === 'string') setServerVersion(data.version);
      } catch {
        // ignore — chip just stays in its current state
      }
    };

    void check();
    intervalId = window.setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  if (!RUNNING_VERSION) return null;

  const isStale = serverVersion !== null && serverVersion !== RUNNING_VERSION;
  const shortTime = formatBuildTime(RUNNING_BUILD_TIME);
  const tooltip = isStale
    ? `Build ${RUNNING_VERSION} (${shortTime})\nNewer build available: ${serverVersion}\nReloads on next navigation`
    : `Build ${RUNNING_VERSION}\nDeployed ${shortTime}`;

  return (
    <div
      title={tooltip}
      onClick={() => {
        // Click reloads — gives users a manual escape hatch if they're
        // sitting on a stale bundle and don't want to wait for the next
        // navigation.
        if (isStale) window.location.reload();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        padding: collapsed ? '4px 8px' : '4px 14px 8px',
        fontSize: '10px',
        fontFamily: theme.typography.fontFamily,
        color: isStale ? '#B45309' : theme.colors.textSidebarSecondary,
        cursor: isStale ? 'pointer' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        letterSpacing: '0.02em',
      }}
    >
      {isStale && (
        <span
          aria-hidden
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#F59E0B', flexShrink: 0,
          }}
        />
      )}
      <span>
        {collapsed
          ? RUNNING_VERSION
          : isStale
            ? `v.${RUNNING_VERSION} · update ready`
            : `v.${RUNNING_VERSION}`}
      </span>
    </div>
  );
}
