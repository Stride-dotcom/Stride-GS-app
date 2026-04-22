/**
 * ItemIdBadges — Renders (I), (A), (R), (W), (D) indicator badges next to an Item ID.
 * Color rules apply to all badge types:
 *   Orange = open / in-progress (job exists but not yet completed)
 *   Green  = completed / released / delivered
 * Cancelled/declined items produce no badge entry (callers should exclude them).
 * Used across Inventory, Tasks, Repairs, Shipments, Will Calls, Dashboard.
 */
import React from 'react';

interface Props {
  itemId: string;
  /** INSP tasks that are open or in progress → orange I */
  inspOpenItems?: Set<string>;
  /** INSP tasks that are completed → green I */
  inspDoneItems?: Set<string>;
  /** ASM tasks that are open or in progress → orange A */
  asmOpenItems?: Set<string>;
  /** ASM tasks that are completed → green A */
  asmDoneItems?: Set<string>;
  /** Repairs that are open/in progress → orange R */
  repairOpenItems?: Set<string>;
  /** Repairs that are completed → green R */
  repairDoneItems?: Set<string>;
  /** Will call items with status Pending/Scheduled/Partial → orange W */
  wcOpenItems?: Set<string>;
  /** Will call items with status Released → green W */
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

const OPEN_BG = '#F97316';  // bold orange
const OPEN_FG = '#fff';
const DONE_BG = '#16A34A';  // bold green
const DONE_FG = '#fff';

function Badge({ label, isOpen, title }: { label: string; isOpen: boolean; title: string }) {
  return (
    <span
      style={{ ...badgeStyle, background: isOpen ? OPEN_BG : DONE_BG, color: isOpen ? OPEN_FG : DONE_FG }}
      title={title}
    >{label}</span>
  );
}

export function ItemIdBadges({
  itemId,
  inspOpenItems, inspDoneItems,
  asmOpenItems, asmDoneItems,
  repairOpenItems, repairDoneItems,
  wcOpenItems, wcDoneItems,
  dtOpenItems, dtDoneItems,
}: Props) {
  const hasIOpen = inspOpenItems?.has(itemId) ?? false;
  const hasIDone = !hasIOpen && (inspDoneItems?.has(itemId) ?? false);

  const hasAOpen = asmOpenItems?.has(itemId) ?? false;
  const hasADone = !hasAOpen && (asmDoneItems?.has(itemId) ?? false);

  const hasROpen = repairOpenItems?.has(itemId) ?? false;
  const hasRDone = !hasROpen && (repairDoneItems?.has(itemId) ?? false);

  const hasWOpen = wcOpenItems?.has(itemId) ?? false;
  const hasWDone = !hasWOpen && (wcDoneItems?.has(itemId) ?? false);

  const hasDOpen = dtOpenItems?.has(itemId) ?? false;
  const hasDDone = !hasDOpen && (dtDoneItems?.has(itemId) ?? false);

  const hasI = hasIOpen || hasIDone;
  const hasA = hasAOpen || hasADone;
  const hasR = hasROpen || hasRDone;
  const hasW = hasWOpen || hasWDone;
  const hasD = hasDOpen || hasDDone;

  if (!hasI && !hasA && !hasR && !hasW && !hasD) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 2, marginLeft: 4, flexShrink: 0 }}>
      {hasI && <Badge label="I" isOpen={hasIOpen} title={hasIOpen ? 'Inspection in progress' : 'Inspection completed'} />}
      {hasA && <Badge label="A" isOpen={hasAOpen} title={hasAOpen ? 'Assembly in progress' : 'Assembly completed'} />}
      {hasR && <Badge label="R" isOpen={hasROpen} title={hasROpen ? 'Repair in progress' : 'Repair completed'} />}
      {hasW && <Badge label="W" isOpen={hasWOpen} title={hasWOpen ? 'Will call in progress' : 'Will call released'} />}
      {hasD && <Badge label="D" isOpen={hasDOpen} title={hasDOpen ? 'Delivery order scheduled' : 'Delivery order completed'} />}
    </span>
  );
}
