/**
 * ⚠️  PROTECTED COMPONENT — FolderButton has broken multiple times from
 * seemingly unrelated edits. Do NOT modify the props interface, the URL
 * handling logic, or the click handler without testing on Task Detail,
 * Repair Detail, Item Detail, Shipment Detail, Will Call Detail, and
 * Dashboard pages. All must open the correct Drive folder in a new tab.
 *
 * v2026-04-22 — upgraded to pill-shaped style matching the new tabbed
 * panel design (12px radius, larger tap target, cleaner outline). The
 * functional contract (props, URL handling, new-tab behavior, disabled
 * tooltip) is unchanged; only the visual shell moved.
 */
import { ExternalLink, FolderOpen, type LucideIcon } from 'lucide-react';
import { theme } from '../../styles/theme';

interface FolderButtonProps {
  label: string;
  url?: string;
  disabledTooltip?: string;
  icon?: LucideIcon;
}

// Shared pill styling so every instance renders identically and a future
// design refresh touches one place.
const PILL_BASE: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 999,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
};

export function FolderButton({ label, url, disabledTooltip = '', icon: Icon = FolderOpen }: FolderButtonProps) {
  const hasUrl = !!url;

  if (hasUrl) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          ...PILL_BASE,
          border: `1px solid ${theme.colors.orange}`,
          background: '#fff',
          color: theme.colors.orange,
          cursor: 'pointer',
          textDecoration: 'none',
          transition: 'background 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = theme.colors.orangeLight;
          e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = '#fff';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <Icon size={12} />
        {label}
        <ExternalLink size={11} style={{ opacity: 0.7 }} />
      </a>
    );
  }

  return (
    <span
      title={disabledTooltip}
      style={{
        ...PILL_BASE,
        fontWeight: 500,
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.bgSubtle,
        color: theme.colors.textMuted,
        cursor: 'not-allowed',
      }}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}
