/**
 * ItemIdBadges — Renders (I), (A), (R), (W), (D) indicator badges next to an Item ID.
 * Shows whether the item has open inspection tasks, assembly tasks, repairs,
 * will call associations, or DispatchTrack delivery orders.
 * Used across Inventory, Tasks, Repairs, Shipments, Will Calls, and Dashboard.
 *
 * Color rules for W and D badges:
 *   Orange = open/in-progress (not yet completed)
 *   Green  = completed (released WC / delivered DT order)
 */
import React from 'react';

interface Props {
  itemId: string;
  inspItems: Set<string>;
  asmItems: Set<string>;
  repairItems: Set<string>;
  /** Will call items with status Pending/Scheduled/Partial → orange W */
  wcOpenItems?: Set<string>;
  /** Will call items with status Released (all WCs completed) → green W */
  wcDoneItems?: Set<string>;
  /** DT order items with statusCategory open/in_progress/exception → orange D */
  dtOpenItems?: Set<string>;
  /** DT order items with statusCategory completed → green D */
  dtDoneItems?: Set<string>;
}

const badgeStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 3px',
  lineHeight: 1, fontFamily: 'Inter, system-ui, sans-serif',
};

export function ItemIdBadges({
  itemId, inspItems, asmItems, repairItems,
  wcOpenItems, wcDoneItems, dtOpenItems, dtDoneItems,
}: Props) {
  const hasI = inspItems.has(itemId);
  const hasA = asmItems.has(itemId);
  const hasR = repairItems.has(itemId);

  // W badge: orange wins over green when both are present
  const hasWOpen = wcOpenItems?.has(itemId) ?? false;
  const hasWDone = !hasWOpen && (wcDoneItems?.has(itemId) ?? false);
  const hasW = hasWOpen || hasWDone;

  // D badge: orange wins over green when both are present
  const hasDOpen = dtOpenItems?.has(itemId) ?? false;
  const hasDDone = !hasDOpen && (dtDoneItems?.has(itemId) ?? false);
  const hasD = hasDOpen || hasDDone;

  if (!hasI && !hasA && !hasR && !hasW && !hasD) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 2, marginLeft: 4, flexShrink: 0 }}>
      {hasI && <span style={{ ...badgeStyle, background: '#DBEAFE', color: '#1E40AF' }} title="Inspection task exists">I</span>}
      {hasA && <span style={{ ...badgeStyle, background: '#FEF3C7', color: '#92400E' }} title="Assembly task exists">A</span>}
      {hasR && <span style={{ ...badgeStyle, background: '#FCE7F3', color: '#9D174D' }} title="Repair exists">R</span>}
      {hasW && (
        <span
          style={{ ...badgeStyle, background: hasWOpen ? '#FED7AA' : '#DCFCE7', color: hasWOpen ? '#9A3412' : '#166534' }}
          title={hasWOpen ? 'Will call in progress' : 'Will call released'}
        >W</span>
      )}
      {hasD && (
        <span
          style={{ ...badgeStyle, background: hasDOpen ? '#FED7AA' : '#DCFCE7', color: hasDOpen ? '#9A3412' : '#166534' }}
          title={hasDOpen ? 'Delivery order scheduled' : 'Delivery order completed'}
        >D</span>
      )}
    </span>
  );
}
