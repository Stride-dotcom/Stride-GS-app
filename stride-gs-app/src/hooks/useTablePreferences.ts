/**
 * useTablePreferences — Persists table column visibility, sorting, column order,
 * and status filter per page in localStorage. Keyed per user email.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { SortingState, VisibilityState } from '@tanstack/react-table';
import { useAuth } from '../contexts/AuthContext';

interface TablePrefs {
  colVis?: VisibilityState;
  sorting?: SortingState;
  columnOrder?: string[];
  statusFilter?: string[];  // multi-select status chips
}

function loadPrefs(storageKey: string): TablePrefs {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migration: convert old single-string statusFilter to array
    if (typeof parsed.statusFilter === 'string') {
      parsed.statusFilter = parsed.statusFilter ? [parsed.statusFilter] : [];
    }
    return parsed;
  } catch {
    return {};
  }
}

function savePrefs(storageKey: string, prefs: TablePrefs) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch { /* quota exceeded — ignore */ }
}

export function useTablePreferences(
  pageKey: string,
  defaultSorting: SortingState = [],
  defaultColVis: VisibilityState = {},
  defaultColumnOrder: string[] = [],
  defaultStatusFilter: string[] = [],
) {
  const { user } = useAuth();
  const storageKey = user?.email
    ? `stride_table_${user.email}_${pageKey}`
    : `stride_table_${pageKey}`;
  const saved = useRef(loadPrefs(storageKey));

  const [colVis, setColVisRaw] = useState<VisibilityState>(saved.current.colVis ?? defaultColVis);
  const [sorting, setSortingRaw] = useState<SortingState>(saved.current.sorting ?? defaultSorting);
  // Reconcile saved column order with defaults — merge any new columns that were
  // added after the user last saved their preferences (e.g. "sidemark" added to Billing)
  const [columnOrder, setColumnOrderRaw] = useState<string[]>(() => {
    const savedOrder = saved.current.columnOrder;
    if (!savedOrder || !savedOrder.length) return defaultColumnOrder;
    if (!defaultColumnOrder.length) return savedOrder;
    // Find columns in default that aren't in saved — insert them at their default position
    const missing = defaultColumnOrder.filter(c => !savedOrder.includes(c));
    if (!missing.length) return savedOrder;
    const merged = [...savedOrder];
    for (const col of missing) {
      const defaultIdx = defaultColumnOrder.indexOf(col);
      // Insert at the same relative position or at the end
      const insertAt = Math.min(defaultIdx, merged.length);
      merged.splice(insertAt, 0, col);
    }
    return merged;
  });
  const [statusFilter, setStatusFilterRaw] = useState<string[]>(saved.current.statusFilter ?? defaultStatusFilter);

  const setColVis = useCallback((updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
    setColVisRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  const setSorting = useCallback((updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setSortingRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  const setColumnOrder = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setColumnOrderRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  // Toggle a single status in/out of the filter array
  const toggleStatus = useCallback((status: string) => {
    setStatusFilterRaw(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]);
  }, []);

  // Clear all status filters
  const clearStatusFilter = useCallback(() => {
    setStatusFilterRaw([]);
  }, []);

  // Persist on change
  useEffect(() => {
    savePrefs(storageKey, { colVis, sorting, columnOrder, statusFilter });
  }, [storageKey, colVis, sorting, columnOrder, statusFilter]);

  return { colVis, setColVis, sorting, setSorting, columnOrder, setColumnOrder, statusFilter, toggleStatus, clearStatusFilter };
}
