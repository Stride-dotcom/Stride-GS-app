/**
 * AutocompleteSelect — type-to-filter dropdown with keyboard navigation.
 *
 * Shows full list on focus/click, filters as you type.
 * Keyboard: ArrowUp/Down to navigate, Enter to select, Escape to close.
 * Closes on outside click. Selected value shown as text when not focused.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { theme } from '../../styles/theme';

export interface AutocompleteOption {
  value: string;
  label: string;
}

interface Props {
  options: AutocompleteOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** Max height of dropdown list in px (default 260) */
  maxHeight?: number;
}

export function AutocompleteSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  style,
  maxHeight = 260,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel = useMemo(
    () => options.find(o => o.value === value)?.label || '',
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, search]);

  // Reset highlight when filtered list changes
  useEffect(() => { setHighlightIdx(0); }, [filtered]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightIdx < 0 || !listRef.current) return;
    const items = listRef.current.children;
    if (items[highlightIdx]) {
      (items[highlightIdx] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setSearch('');
    setHighlightIdx(0);
    // Focus the input after state update
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const handleSelect = useCallback((val: string) => {
    onChange(val);
    setOpen(false);
    setSearch('');
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIdx]) handleSelect(filtered[highlightIdx].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  };

  const baseStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    ...style,
  };

  const triggerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    width: '100%',
    padding: '7px 12px',
    fontSize: 13,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 8,
    background: '#fff',
    fontFamily: 'inherit',
    color: value ? theme.colors.text : theme.colors.textMuted,
    cursor: disabled ? 'not-allowed' : 'pointer',
    outline: 'none',
    opacity: disabled ? 0.5 : 1,
    boxSizing: 'border-box',
  };

  return (
    <div ref={containerRef} style={baseStyle}>
      {/* Trigger — shows selected value or opens input */}
      {!open ? (
        <button
          type="button"
          onClick={handleOpen}
          disabled={disabled}
          style={triggerStyle}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedLabel || placeholder}
          </span>
          <ChevronDown size={14} color={theme.colors.textMuted} style={{ flexShrink: 0 }} />
        </button>
      ) : (
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selectedLabel || placeholder}
          style={{
            ...triggerStyle,
            color: theme.colors.text,
            cursor: 'text',
            borderColor: theme.colors.orange,
            boxShadow: `0 0 0 2px ${theme.colors.orange}22`,
          }}
        />
      )}

      {/* Dropdown list */}
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            maxHeight,
            overflowY: 'auto',
            background: '#fff',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            zIndex: 300,
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: theme.colors.textMuted, textAlign: 'center' }}>
              No matches
            </div>
          )}
          {filtered.map((opt, i) => {
            const isHighlighted = i === highlightIdx;
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onMouseDown={e => { e.preventDefault(); handleSelect(opt.value); }}
                onMouseEnter={() => setHighlightIdx(i)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  background: isHighlighted ? theme.colors.orangeLight : 'transparent',
                  color: isSelected ? theme.colors.orange : theme.colors.text,
                  fontWeight: isSelected ? 600 : 400,
                  borderBottom: i < filtered.length - 1 ? `1px solid ${theme.colors.borderLight}` : undefined,
                }}
              >
                {opt.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
