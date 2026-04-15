import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { theme } from '../../styles/theme';

interface Props {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * MultiSelectFilter — reusable multi-select dropdown with checkboxes.
 *
 * SEMANTICS (v2 — 2026-04-08):
 *   selected = []           → NOTHING selected (empty state, no filter match)
 *   selected = ['A', 'B']   → A and B selected
 *   selected = [...all]     → ALL explicitly selected
 *
 * "Select All" sets onChange([...options]) — explicitly all options.
 * "Clear" sets onChange([]) — nothing selected.
 * Unchecking the last item stays [] — does NOT auto-reselect all.
 */
export function MultiSelectFilter({ label, options, selected, onChange, placeholder, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, search]);

  // Display logic
  const noneSelected = selected.length === 0;
  const allSelected = options.length > 0 && selected.length === options.length;
  const displayText = noneSelected
    ? (placeholder || 'Select...')
    : allSelected
      ? 'All'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  const toggleItem = (item: string) => {
    if (selected.includes(item)) {
      // Uncheck — remove from list. If last one, stays empty []
      onChange(selected.filter(s => s !== item));
    } else {
      // Check — add to list
      onChange([...selected, item]);
    }
  };

  const selectAll = () => {
    // Select only the visible (filtered) options, merged with any already-selected
    const merged = [...new Set([...selected, ...filtered])];
    onChange(merged);
  };
  const clearAll = () => onChange([]);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 0 }}>
      <div style={{ marginBottom: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          width: '100%', padding: '7px 10px', fontSize: 12, fontWeight: 500,
          border: `1px solid ${open ? theme.colors.orange : theme.colors.border}`,
          borderRadius: 8, background: '#fff', cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', color: noneSelected ? theme.colors.textMuted : theme.colors.text,
          transition: '0.15s', textAlign: 'left', minHeight: 34,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText}</span>
        <ChevronDown size={13} style={{ flexShrink: 0, color: theme.colors.textMuted, transform: open ? 'rotate(180deg)' : undefined, transition: '0.15s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, maxHeight: 280, display: 'flex', flexDirection: 'column',
          minWidth: 200,
        }}>
          {/* Search */}
          {options.length > 6 && (
            <div style={{ padding: '6px 8px', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: theme.colors.bgSubtle }}>
                <Search size={12} color={theme.colors.textMuted} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  autoFocus
                  style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 11, fontFamily: 'inherit', outline: 'none', color: theme.colors.text }}
                />
                {search && <X size={11} style={{ cursor: 'pointer', color: theme.colors.textMuted }} onClick={() => setSearch('')} />}
              </div>
            </div>
          )}

          {/* Select All / Clear */}
          <div style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
            <button onClick={selectAll} style={{ fontSize: 10, fontWeight: 600, color: theme.colors.orange, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Select All</button>
            <button onClick={clearAll} style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Clear</button>
          </div>

          {/* Options — use div+onClick instead of label to avoid touch/iPad bubbling issues */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {filtered.map(opt => {
              const checked = selected.includes(opt);
              return (
                <div key={opt}
                  role="option"
                  aria-selected={checked}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleItem(opt); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                    background: checked ? 'rgba(232,93,45,0.04)' : 'transparent',
                    userSelect: 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = checked ? 'rgba(232,93,45,0.04)' : 'transparent'}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    style={{ accentColor: theme.colors.orange, flexShrink: 0, pointerEvents: 'none' }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: '12px 10px', textAlign: 'center', color: theme.colors.textMuted, fontSize: 11 }}>No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
