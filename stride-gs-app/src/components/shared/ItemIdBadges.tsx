/**
 * ItemIdBadges — Renders (I), (A), (R) indicator badges next to an Item ID.
 * Shows whether the item has open inspection tasks, assembly tasks, or repairs.
 * Used across Inventory, Tasks, Repairs, Shipments, Will Calls, and Dashboard.
 */
import React from 'react';

interface Props {
  itemId: string;
  inspItems: Set<string>;
  asmItems: Set<string>;
  repairItems: Set<string>;
}

const badgeStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 3px',
  lineHeight: 1, fontFamily: 'Inter, system-ui, sans-serif',
};

export function ItemIdBadges({ itemId, inspItems, asmItems, repairItems }: Props) {
  const hasI = inspItems.has(itemId);
  const hasA = asmItems.has(itemId);
  const hasR = repairItems.has(itemId);
  if (!hasI && !hasA && !hasR) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 2, marginLeft: 4, flexShrink: 0 }}>
      {hasI && <span style={{ ...badgeStyle, background: '#DBEAFE', color: '#1E40AF' }} title="Inspection task exists">I</span>}
      {hasA && <span style={{ ...badgeStyle, background: '#FEF3C7', color: '#92400E' }} title="Assembly task exists">A</span>}
      {hasR && <span style={{ ...badgeStyle, background: '#FCE7F3', color: '#9D174D' }} title="Repair exists">R</span>}
    </span>
  );
}
