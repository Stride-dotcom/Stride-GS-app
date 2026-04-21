/**
 * EntitySourceTabs — a row of pill tabs that filters a cross-entity rollup
 * (photos or notes) by the source entity_type that produced each record.
 *
 * Example: opening the Repair panel's Photos tab queries item_photos by
 * item_id. That result contains photos from entity_type in
 * {inventory, task, repair, will_call, ...}. This component renders:
 *
 *   [ All (8) ] [ Item (3) ] [ Task (4) ] [ Repair (1) ]
 *
 * — counts per type, All selected by default. Tabs with 0 records are hidden
 * when `renderRule='non-empty'` (the default).
 *
 * LABEL NORMALIZATION — single source of truth: raw enum keys like
 * `inventory` and `will_call` must NEVER reach the UI. `ENTITY_LABEL`
 * below is the one place these map to user-facing strings.
 *
 * Gated by `enableSourceFilter` at each call site (PhotoGallery, NotesPanel)
 * so Claim and any other legacy consumer sees zero UI change.
 */
import { useMemo } from 'react';
import { theme } from '../../styles/theme';

/** User-facing labels for source entity types. Add new entity types here. */
export const ENTITY_LABEL: Record<string, string> = {
  all:        'All',
  inventory:  'Item',
  task:       'Task',
  repair:     'Repair',
  will_call:  'Will Call',
  shipment:   'Shipment',
  claim:      'Claim',
};

/** Deterministic display order so the tab row stays stable across renders. */
const ORDER: string[] = ['inventory', 'task', 'repair', 'will_call', 'shipment', 'claim'];

function labelFor(key: string): string {
  if (ENTITY_LABEL[key]) return ENTITY_LABEL[key];
  // Fallback for future entity_types we haven't mapped yet: Title Case
  // the snake_case key so nothing raw ever renders.
  return key
    .split('_')
    .map(s => s.length ? s[0].toUpperCase() + s.slice(1) : s)
    .join(' ');
}

interface Props<T extends { entity_type?: string | null }> {
  /** The full list of records (photos or notes). Counts are computed client-side. */
  items: T[];
  /** Currently active filter. 'all' shows everything. */
  activeType: string;
  /** Fires with the next filter key — 'all' or an entity_type string. */
  onChange: (next: string) => void;
  /** 'non-empty' (default) hides tabs with 0 records. 'always' shows them with 0 count. */
  renderRule?: 'non-empty' | 'always';
  /** Optional: pass 'photo' or 'note' to shift the color accent if desired. */
  variant?: 'photo' | 'note';
}

export function EntitySourceTabs<T extends { entity_type?: string | null }>({
  items, activeType, onChange, renderRule = 'non-empty',
}: Props<T>) {
  // Count per entity_type. 'all' is always the total.
  const { counts, total } = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) {
      const k = String(it.entity_type ?? 'unknown');
      c[k] = (c[k] ?? 0) + 1;
    }
    return { counts: c, total: items.length };
  }, [items]);

  // Build the tab list: 'all' always first, then ORDER entries that have
  // records (or are shown unconditionally), then any surprise types we
  // didn't anticipate in ORDER — so nothing gets dropped.
  const tabs = useMemo(() => {
    const out: Array<{ key: string; count: number }> = [{ key: 'all', count: total }];
    const shown = new Set<string>(['all']);
    for (const k of ORDER) {
      const n = counts[k] ?? 0;
      if (renderRule === 'non-empty' && n === 0) continue;
      out.push({ key: k, count: n });
      shown.add(k);
    }
    // Catch unlisted entity_types so future data never goes invisible.
    for (const k of Object.keys(counts)) {
      if (shown.has(k)) continue;
      if (renderRule === 'non-empty' && counts[k] === 0) continue;
      out.push({ key: k, count: counts[k] });
    }
    return out;
  }, [counts, total, renderRule]);

  // If nothing beyond 'all' would render, skip the tab bar entirely — it's
  // just visual noise when there's only one source.
  if (tabs.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Filter by source"
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        background: theme.colors.bgSubtle,
        padding: 4,
        borderRadius: 10,
        marginBottom: 12,
      }}
    >
      {tabs.map(t => {
        const active = t.key === activeType || (activeType === '' && t.key === 'all');
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            style={{
              flex: '1 1 auto',
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: active ? '#FFFFFF' : 'transparent',
              color: active ? theme.colors.text : theme.colors.textMuted,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 120ms, color 120ms',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {labelFor(t.key)} ({t.count})
          </button>
        );
      })}
    </div>
  );
}
