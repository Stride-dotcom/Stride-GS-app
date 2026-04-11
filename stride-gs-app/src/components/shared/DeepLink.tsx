import React from 'react';
import { ExternalLink } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * DeepLink — renders an anchor that deep-links to another page's detail panel
 * in a new browser tab. All target pages (Inventory, Tasks, Repairs, WillCalls,
 * Shipments) support the `?open=<id>` query param on mount, which auto-opens
 * the matching detail panel.
 *
 * Rationale: Justin wants every cross-entity link to open in a new tab so he
 * can inspect related records without losing his place on the current page.
 *
 * Usage:
 *   <DeepLink kind="inventory" id={task.itemId}>{task.itemId}</DeepLink>
 *   <DeepLink kind="task"      id="INSP-114-1" />
 */

export type DeepLinkKind =
  | 'inventory'
  | 'task'
  | 'repair'
  | 'willcall'
  | 'shipment';

const KIND_TO_ROUTE: Record<DeepLinkKind, string> = {
  inventory: '/inventory',
  task: '/tasks',
  repair: '/repairs',
  willcall: '/will-calls',
  shipment: '/shipments',
};

export interface DeepLinkProps {
  kind: DeepLinkKind;
  id: string | undefined | null;
  /** Visible label. Defaults to the id. */
  children?: React.ReactNode;
  /** Show the external-link icon next to the text. Default true. */
  showIcon?: boolean;
  /** Extra inline styles */
  style?: React.CSSProperties;
  /** Additional className */
  className?: string;
  /** Size — controls font size and icon size. Default 'md'. */
  size?: 'sm' | 'md' | 'lg';
}

export function DeepLink({
  kind,
  id,
  children,
  showIcon = true,
  style,
  className,
  size = 'md',
}: DeepLinkProps) {
  if (!id) {
    return (
      <span style={{ color: theme.colors.textMuted, fontSize: size === 'sm' ? 11 : size === 'lg' ? 14 : 13 }}>
        —
      </span>
    );
  }

  const fontSize = size === 'sm' ? 11 : size === 'lg' ? 14 : 13;
  const iconSize = size === 'sm' ? 10 : size === 'lg' ? 13 : 11;
  const href = `#${KIND_TO_ROUTE[kind]}?open=${encodeURIComponent(id)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className={className}
      style={{
        fontSize,
        color: theme.colors.orange,
        fontWeight: 600,
        textDecoration: 'underline',
        textDecorationColor: 'transparent',
        transition: 'text-decoration-color 0.15s',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'inherit',
        ...style,
      }}
      onMouseEnter={e => (e.currentTarget.style.textDecorationColor = theme.colors.orange)}
      onMouseLeave={e => (e.currentTarget.style.textDecorationColor = 'transparent')}
    >
      {children ?? id}
      {showIcon && <ExternalLink size={iconSize} />}
    </a>
  );
}
