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
import { ArrowLeft } from 'lucide-react';
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
  /** Inline slot rendered immediately to the right of the entity ID.
   *  Used by ItemDetailPanel to surface the (I)(A)(R) `ItemIdBadges` next
   *  to the big item number, matching the list-page presentation. */
  idBadges?: React.ReactNode;
  /** Compact mode — slightly smaller ID / sidemark for tight panels. */
  compact?: boolean;
  /** Render a compact single-row mobile header (~54px) instead of the
   *  multi-line stacked layout. Intended for full-screen mobile panels. */
  mobileCompact?: boolean;
  /** Used when mobileCompact=true to render a ← back button on the far left. */
  onClose?: () => void;
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
  idBadges,
  compact,
  mobileCompact,
  onClose,
}: DetailHeaderProps) {
  const idSize = compact ? 22 : 28;
  const smColor = sidemark ? sidemarkColor(sidemark) : undefined;

  // ── Mobile compact: single-row ~54px header ───────────────────────────
  if (mobileCompact) {
    return (
      <div
        style={{
          padding: '0 12px',
          height: 54,
          background: '#1C1C1C',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {/* Back / close button */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.7)', padding: '0 2px',
              display: 'flex', alignItems: 'center',
              minWidth: 36, minHeight: 44, flexShrink: 0,
            }}
          >
            <ArrowLeft size={22} />
          </button>
        )}
        {/* ID + client name — fills available space, truncates gracefully */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
            {entityId}
          </span>
          {clientName && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {clientName}
            </span>
          )}
        </div>
        {/* Right side: idBadges + actions only (belowId omitted — too wide for 54px row) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {idBadges && (
            <span style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(255,255,255,0.12)', padding: '2px 5px', borderRadius: 5 }}>
              {idBadges}
            </span>
          )}
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: compact ? '20px 24px' : '28px 28px',
        background: '#1C1C1C',
        borderRadius: '20px 20px 0 0',
        flexShrink: 0,
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {entityLabel ? <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '4px', color: '#E8692A', textTransform: 'uppercase', marginBottom: 8 }}>{entityLabel}</div> : null}
          <div style={{ fontSize: idSize, fontWeight: 300, color: '#fff', lineHeight: 1.1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>{entityId}</span>
            {idBadges ? (
              // Brighten the (I)(A)(R) badges for the dark header — they're
              // styled for a light list-page row, so dim backgrounds would
              // disappear. A translucent white pill behind them keeps contrast.
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'rgba(255,255,255,0.12)',
                padding: '3px 6px', borderRadius: 6,
              }}>
                {idBadges}
              </span>
            ) : null}
          </div>
          {belowId ? <div style={{ marginTop: 12 }}>{belowId}</div> : null}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
              marginTop: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>
              {clientName || <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 400 }}>— no client —</span>}
            </div>
            {sidemark ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  padding: '4px 12px',
                  borderRadius: 100,
                  background: smColor || 'rgba(255,255,255,0.15)',
                  color: '#1C1C1C',
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
