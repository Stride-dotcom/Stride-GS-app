import React from 'react';
import { ExternalLink } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * DeepLink — renders an anchor that deep-links to another entity's detail page
 * in a new browser tab.
 *
 * Standalone pages (task/repair/willcall/shipment) are loaded by ID via
 * Supabase — ~50ms, no client filter needed, RLS handles access.
 * Inventory still uses the ?open= list-page approach (no standalone item page).
 *
 * Rationale: Justin wants every cross-entity link to open in a new tab so he
 * can inspect related records without losing his place on the current page.
 *
 * Usage:
 *   <DeepLink kind="inventory" id={task.itemId} clientSheetId={task.clientSheetId} />
 *   <DeepLink kind="task"      id="INSP-114-1" />
 *   <DeepLink kind="shipment"  id="SHP-0001" />
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

/** Entities with standalone /:id pages — link directly, no ?open= needed */
const STANDALONE_KINDS = new Set<DeepLinkKind>(['task', 'repair', 'willcall', 'shipment']);

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
  /** Owning client's spreadsheet ID. When present, appended as &client=<id>
   *  so the target page can auto-select the client filter without a round-trip. */
  clientSheetId?: string | null;
}

export function DeepLink({
  kind,
  id,
  children,
  showIcon = true,
  style,
  className,
  size = 'md',
  clientSheetId,
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
  // Standalone pages: use /:id route (Supabase direct, no client filter needed)
  // Inventory: still uses ?open= list-page approach (no standalone item page)
  const href = STANDALONE_KINDS.has(kind)
    ? `#${KIND_TO_ROUTE[kind]}/${encodeURIComponent(id)}`
    : `#${KIND_TO_ROUTE[kind]}?open=${encodeURIComponent(id)}${clientSheetId ? `&client=${encodeURIComponent(clientSheetId)}` : ''}`;

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
