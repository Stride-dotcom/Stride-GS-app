/**
 * ColumnManagerMenu — shared "Columns" popover for every data-table page.
 *
 * One menu, used by Inventory / Tasks / Repairs / Will Calls / Shipments /
 * Billing / Claims / Receiving / Dashboard so column management is identical
 * everywhere. Does two things:
 *   • Show / hide columns (checkbox per toggleable column).
 *   • Reorder columns (▲ / ▼ per row) — replaces the old header drag-and-drop,
 *     which used HTML5 `draggable` (broken on touch, and it fought the
 *     column-resize handle). Reorder persists via the caller's
 *     useTablePreferences `setColumnOrder`.
 *   • Optional "Reset widths" — clears local column-resize state.
 *
 * Rows render in the user's saved `columnOrder` (toggleable columns only),
 * appending any toggleable column not yet present in the order array (so a
 * newly-added column still appears). Pinned columns (e.g. `select` / `actions`)
 * are intentionally NOT in `toggleableIds`, so they can't be hidden or moved.
 *
 * Rendered in a portal, fixed-positioned under the anchor button, so it never
 * gets clipped by the table's overflow container.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { VisibilityState } from '@tanstack/react-table';
import { theme } from '../../styles/theme';

export interface ColumnManagerMenuProps {
  /** Bounding rect of the trigger button — the menu anchors under its right edge. */
  anchorRect: DOMRect;
  /** Columns the user may show/hide + reorder (excludes pinned select/actions). */
  toggleableIds: string[];
  /** id → display label. */
  labels: Record<string, string>;
  visibility: VisibilityState;
  onToggle: (id: string) => void;
  /** Current persisted column order (drives the row sequence). */
  columnOrder: string[];
  /** Move a column one step up (-1) or down (+1). */
  onMove: (id: string, dir: -1 | 1) => void;
  onClose: () => void;
  /** Optional — when provided, renders a "Reset widths" action. */
  onResetWidths?: () => void;
}

export function ColumnManagerMenu({
  anchorRect, toggleableIds, labels, visibility, onToggle, columnOrder, onMove, onClose, onResetWidths,
}: ColumnManagerMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Render in saved order (toggleable only), then any toggleable not yet
  // present (newly-added columns) so nothing is ever unreachable.
  const ordered = [
    ...columnOrder.filter(c => toggleableIds.includes(c)),
    ...toggleableIds.filter(c => !columnOrder.includes(c)),
  ];

  const moveBtn = (disabled: boolean): React.CSSProperties => ({
    width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: theme.radii.sm, background: 'none',
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? theme.colors.borderDefault : theme.colors.textMuted,
    fontSize: 9, padding: 0, flexShrink: 0,
  });

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: anchorRect.bottom + 4,
        right: Math.max(window.innerWidth - anchorRect.right, 8),
        background: theme.colors.bgBase,
        border: `1px solid ${theme.colors.borderDefault}`,
        borderRadius: theme.radii.lg,
        boxShadow: theme.shadows.lg,
        padding: '8px 0',
        zIndex: 9000,
        minWidth: 210,
        maxHeight: 'min(70vh, 460px)',
        overflowY: 'auto',
        fontFamily: theme.typography.fontFamily,
      }}
    >
      <div style={{
        fontSize: theme.typography.sizes.xs, color: theme.colors.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontWeight: theme.typography.weights.semibold,
        padding: '4px 14px 8px',
      }}>
        Columns · show / reorder
      </div>
      {ordered.map((colId, i) => {
        const visible = visibility[colId] !== false;
        return (
          <div key={colId} style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 8px 2px 14px' }}
            onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <button onClick={() => onToggle(colId)} style={{
              display: 'flex', alignItems: 'center', gap: 8, flex: 1,
              padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: theme.typography.sizes.sm, color: theme.colors.textPrimary, textAlign: 'left',
            }}>
              <span style={{
                width: 15, height: 15, borderRadius: theme.radii.sm, flexShrink: 0,
                border: `2px solid ${visible ? theme.colors.primary : theme.colors.borderDefault}`,
                background: visible ? theme.colors.primary : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {visible && <span style={{ width: 7, height: 7, borderRadius: 1, background: '#fff' }} />}
              </span>
              {labels[colId] ?? colId}
            </button>
            <button onClick={() => onMove(colId, -1)} disabled={i === 0} title="Move up" style={moveBtn(i === 0)}>▲</button>
            <button onClick={() => onMove(colId, 1)} disabled={i === ordered.length - 1} title="Move down" style={moveBtn(i === ordered.length - 1)}>▼</button>
          </div>
        );
      })}
      {onResetWidths && (
        <>
          <div style={{ height: 1, background: theme.colors.borderDefault, margin: '6px 0' }} />
          <button
            onClick={() => { onResetWidths(); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '6px 14px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary, fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = theme.colors.bgSubtle)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            Reset column widths
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * Reorder helper shared by all callers — moves `colId` one step in `dir`
 * within the persisted column order, refusing to cross the pinned columns
 * (select first / actions last). Pass the page's `setColumnOrder` +
 * `defaultOrder`.
 */
export function moveColumnInOrder(
  colId: string,
  dir: -1 | 1,
  setColumnOrder: (updater: (prev: string[]) => string[]) => void,
  defaultOrder: string[],
  pinned: string[] = ['select', 'actions'],
) {
  if (pinned.includes(colId)) return;
  setColumnOrder(prev => {
    const order = prev.length ? [...prev] : [...defaultOrder];
    const from = order.indexOf(colId);
    if (from === -1) return prev;
    const to = from + dir;
    const target = order[to];
    if (to < 0 || to >= order.length || pinned.includes(target)) return prev;
    order.splice(from, 1);
    order.splice(to, 0, colId);
    return order;
  });
}
