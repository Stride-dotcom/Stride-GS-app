/**
 * Hook that integrates @tanstack/react-virtual with TanStack Table.
 *
 * Replaces pagination with virtual scrolling — only renders rows visible
 * in the scroll viewport plus a small overscan buffer.
 *
 * Usage:
 *   const { containerRef, virtualRows, totalHeight, measureElement } = useVirtualRows(table);
 *   // Wrap <table> in a scrollable div with ref={containerRef}
 *   // In <tbody>, render virtualRows instead of table.getRowModel().rows
 */
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Table } from '@tanstack/react-table';

const ROW_HEIGHT = 40; // estimated row height in px
const OVERSCAN = 10;   // extra rows rendered above/below viewport

export function useVirtualRows<T>(table: Table<T>) {
  const rows = table.getRowModel().rows;
  const containerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return {
    /** Attach this ref to the scrollable container div */
    containerRef,
    /** The actual Row objects to render (use virtualRow.index to get the TanStack row) */
    virtualRows,
    /** All rows from the table model — index into this with virtualRow.index */
    rows,
    /** Total virtual height for the spacer */
    totalHeight,
    /** Total row count (for display) */
    rowCount: rows.length,
    /** Pass to <tr ref={...}> for dynamic measurement */
    measureElement: virtualizer.measureElement,
  };
}
