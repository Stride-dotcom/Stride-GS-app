import { ExternalLink, FolderOpen, type LucideIcon } from 'lucide-react';
import { theme } from '../../styles/theme';

interface FolderButtonProps {
  label: string;
  url?: string;
  disabledTooltip?: string;
  icon?: LucideIcon;
}

export function FolderButton({ label, url, disabledTooltip = '', icon: Icon = FolderOpen }: FolderButtonProps) {
  const hasUrl = !!url;

  if (hasUrl) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: '3px 10px',
          fontSize: 10,
          fontWeight: 600,
          border: `1px solid ${theme.colors.orange}`,
          borderRadius: 6,
          background: '#fff',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: theme.colors.orange,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          textDecoration: 'none',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = theme.colors.orangeLight; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
      >
        <Icon size={10} />
        {label}
        <ExternalLink size={9} />
      </a>
    );
  }

  return (
    <span
      title={disabledTooltip}
      style={{
        padding: '3px 10px',
        fontSize: 10,
        fontWeight: 500,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 6,
        background: theme.colors.bgSubtle,
        color: theme.colors.textMuted,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        cursor: 'not-allowed',
      }}
    >
      <Icon size={10} />
      {label}
    </span>
  );
}
