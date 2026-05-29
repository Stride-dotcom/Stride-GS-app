import { theme } from '../../styles/theme';
import { hardReloadForUpdate } from '../../lib/versionReload';

// __APP_VERSION__ and __BUILD_TIME__ are injected at build time by vite.config.ts.
const RUNNING_VERSION = __APP_VERSION__;
const RUNNING_BUILD_TIME = __BUILD_TIME__;

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
  // Driven by useVersionCheck at the AppLayout level — single source of
  // truth for "is the running bundle stale". When true the chip turns
  // amber and clicks force-reload via the same cache-busting helper
  // useVersionCheck uses internally.
  isStale: boolean;
}

export function BuildVersionChip({ collapsed, isStale }: Props) {
  if (!RUNNING_VERSION) return null;

  const shortTime = formatBuildTime(RUNNING_BUILD_TIME);
  const tooltip = isStale
    ? `Build ${RUNNING_VERSION} (${shortTime})\nNewer build available — refreshing on next navigation, tab focus, or 2 min.\nClick to refresh now.`
    : `Build ${RUNNING_VERSION}\nDeployed ${shortTime}`;

  const handleClick = () => {
    if (isStale) hardReloadForUpdate();
  };

  return (
    <div
      title={tooltip}
      onClick={handleClick}
      role={isStale ? 'button' : undefined}
      tabIndex={isStale ? 0 : undefined}
      onKeyDown={(e) => {
        if (isStale && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick();
        }
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
