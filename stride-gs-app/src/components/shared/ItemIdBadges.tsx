/**
 * ItemIdBadges — Renders (I), (A), (R), (W), (D), ($) indicator badges next to an Item ID.
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
  /** INSP tasks that completed with result=Fail → red I (overrides done/open) */
  inspFailedItems?: Set<string>;
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
  /** Inventory items flagged cod_storage=true → amber "$" badge (end customer pays storage) */
  codItems?: Set<string>;
}

const badgeStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 0',
  lineHeight: 1, fontFamily: 'Inter, system-ui, sans-serif',
  // Fixed width keeps thin letters (I) the same square size as wider ones
  // (W, D) so the badge row reads as a uniform pill strip.
  display: 'inline-block', minWidth: 12, textAlign: 'center',
  boxSizing: 'border-box',
};

const OPEN_BG = '#F97316';  // bold orange
const OPEN_FG = '#fff';
const DONE_BG = '#16A34A';  // bold green
const DONE_FG = '#fff';
const FAIL_BG = '#DC2626';  // bright red — failed inspection
const FAIL_FG = '#fff';
const COD_BG = '#CA8A04';   // amber — COD storage (end customer pays); distinct from open/done/failed
const COD_FG = '#fff';

type BadgeState = 'open' | 'done' | 'failed' | 'cod';

function Badge({ label, state, title }: { label: string; state: BadgeState; title: string }) {
  const bg = state === 'failed' ? FAIL_BG : state === 'cod' ? COD_BG : state === 'open' ? OPEN_BG : DONE_BG;
  const fg = state === 'failed' ? FAIL_FG : state === 'cod' ? COD_FG : state === 'open' ? OPEN_FG : DONE_FG;
  const fontWeight = state === 'failed' ? 900 : 700;
  return (
    <span style={{ ...badgeStyle, background: bg, color: fg, fontWeight }} title={title}>{label}</span>
  );
}

export function ItemIdBadges({
  itemId,
  inspOpenItems, inspDoneItems, inspFailedItems,
  asmOpenItems, asmDoneItems,
  repairOpenItems, repairDoneItems,
  wcOpenItems, wcDoneItems,
  dtOpenItems, dtDoneItems,
  codItems,
}: Props) {
  const hasIFailed = inspFailedItems?.has(itemId) ?? false;
  const hasIOpen = !hasIFailed && (inspOpenItems?.has(itemId) ?? false);
  const hasIDone = !hasIFailed && !hasIOpen && (inspDoneItems?.has(itemId) ?? false);

  const hasAOpen = asmOpenItems?.has(itemId) ?? false;
  const hasADone = !hasAOpen && (asmDoneItems?.has(itemId) ?? false);

  const hasROpen = repairOpenItems?.has(itemId) ?? false;
  const hasRDone = !hasROpen && (repairDoneItems?.has(itemId) ?? false);

  const hasWOpen = wcOpenItems?.has(itemId) ?? false;
  const hasWDone = !hasWOpen && (wcDoneItems?.has(itemId) ?? false);

  const hasDOpen = dtOpenItems?.has(itemId) ?? false;
  const hasDDone = !hasDOpen && (dtDoneItems?.has(itemId) ?? false);

  const hasI = hasIFailed || hasIOpen || hasIDone;
  const hasA = hasAOpen || hasADone;
  const hasR = hasROpen || hasRDone;
  const hasW = hasWOpen || hasWDone;
  const hasD = hasDOpen || hasDDone;
  const hasCod = codItems?.has(itemId) ?? false;

  if (!hasI && !hasA && !hasR && !hasW && !hasD && !hasCod) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 2, marginLeft: 4, flexShrink: 0 }}>
      {hasI && (
        <Badge
          label="I"
          state={hasIFailed ? 'failed' : hasIOpen ? 'open' : 'done'}
          title={hasIFailed ? 'Inspection failed' : hasIOpen ? 'Inspection in progress' : 'Inspection completed'}
        />
      )}
      {hasA && <Badge label="A" state={hasAOpen ? 'open' : 'done'} title={hasAOpen ? 'Assembly in progress' : 'Assembly completed'} />}
      {hasR && <Badge label="R" state={hasROpen ? 'open' : 'done'} title={hasROpen ? 'Repair in progress' : 'Repair completed'} />}
      {hasW && <Badge label="W" state={hasWOpen ? 'open' : 'done'} title={hasWOpen ? 'Will call in progress' : 'Will call released'} />}
      {hasD && <Badge label="D" state={hasDOpen ? 'open' : 'done'} title={hasDOpen ? 'Delivery order scheduled' : 'Delivery order completed'} />}
      {hasCod && <Badge label="$" state="cod" title="End customer pays storage (COD)" />}
    </span>
  );
}
