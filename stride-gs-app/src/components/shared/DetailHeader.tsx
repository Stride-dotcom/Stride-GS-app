/**
 * DetailHeader.tsx — Canonical header chip for every detail panel + standalone page.
 *
 * Session 70 fix #5: unifies the header layout across Item / Task / Repair /
 * WillCall / Shipment / Claim / Billing so operators always find the same fields
 * in the same spot:
 *   - Entity ID (large, bold, primary)
 *   - Status badges row
 *   - Client name (bold, readable)
 *   - Sidemark chip (normalized + color-coded, same palette as Inventory grid)
 *
 * Keep this lean — the "extras" slot is for entity-specific secondary info
 * (Type badge, Result, Qty, etc.) the parent wants to stick next to the ID.
 */
import React from 'react';
import { theme } from '../../styles/theme';
import { normSidemark } from '../../pages/Inventory';

// Re-use the Inventory palette so the same sidemark gets the same color
// everywhere it appears (list grid, header chip, anywhere else).
const SIDEMARK_PALETTE = [
  '#DBEAFE', '#D1FAE5', '#E9D5FF', '#FEF3C7',
  '#FCE7F3', '#FFEDD5', '#CCFBF1', '#FEE2E2',
  '#E0E7FF', '#D1FAEA', '#FDE68A', '#FFE4E6',
  '#CFFAFE', '#ECFCCB',
];

/** Deterministic sidemark → palette-index hash.
 *  Stable across renders and across pages (doesn't depend on the current list). */
function sidemarkColor(sidemark: string): string | undefined {
  const key = normSidemark(sidemark);
  if (!key) return undefined;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SIDEMARK_PALETTE[h % SIDEMARK_PALETTE.length];
}

export interface DetailHeaderProps {
  /** Primary record identity e.g. "INSP-62545-1" or "SHP-000131". */
  entityId: string;
  /** Optional label prefix (e.g. "Task", "Repair", "Shipment"). */
  entityLabel?: string;
  /** Client name, rendered bold. "—" when missing. */
  clientName?: string;
  /** Sidemark — rendered as a colored chip if present. */
  sidemark?: string;
  /** Right-side slot for action buttons (Edit, Close, etc.). */
  actions?: React.ReactNode;
  /** Below the ID — badges / meta info the parent controls. */
  belowId?: React.ReactNode;
  /** Compact mode — slightly smaller ID / sidemark for tight panels. */
  compact?: boolean;
}

/**
 * Canonical detail header chip.
 *
 * Layout:
 *   [ENTITY_LABEL ID — large bold]            [actions]
 *   [below-id slot e.g. status badges]
 *   [Client: bold]   [Sidemark: colored chip]
 */
export function DetailHeader({
  entityId,
  entityLabel,
  clientName,
  sidemark,
  actions,
  belowId,
  compact,
}: DetailHeaderProps) {
  const idSize = compact ? 18 : 20;
  const smColor = sidemark ? sidemarkColor(sidemark) : undefined;

  return (
    <div
      style={{
        padding: compact ? '14px 20px' : '16px 20px',
        borderBottom: `1px solid ${theme.colors.border}`,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: idSize, fontWeight: 700, color: theme.colors.text }}>
            {entityLabel ? <span style={{ color: theme.colors.textMuted, fontWeight: 600, marginRight: 6 }}>{entityLabel}</span> : null}
            {entityId}
          </div>
          {belowId ? <div style={{ marginTop: 8 }}>{belowId}</div> : null}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
              marginTop: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: theme.colors.text }}>
              {clientName || <span style={{ color: theme.colors.textMuted, fontWeight: 500 }}>— no client —</span>}
            </div>
            {sidemark ? (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '2px 10px',
                  borderRadius: 12,
                  background: smColor || theme.colors.bgSubtle,
                  color: theme.colors.text,
                  lineHeight: 1.3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 320,
                }}
                title={sidemark}
              >
                {sidemark}
              </span>
            ) : null}
          </div>
        </div>
        {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div> : null}
      </div>
    </div>
  );
}
