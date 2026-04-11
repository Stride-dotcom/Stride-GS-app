import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { theme } from '../../styles/theme';

interface Props {
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  placeholder?: string;
  allowCustom?: boolean;
  debounceMs?: number;
  disabled?: boolean;
  style?: React.CSSProperties;
  icon?: boolean;
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Type to search...',
  allowCustom = true,
  debounceMs = 150,
  disabled = false,
  style,
  icon = true,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const debouncedSetQuery = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), debounceMs);
  }, [debounceMs]);

  const filtered = suggestions.filter(s =>
    s.toLowerCase().includes(debouncedQuery.toLowerCase())
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    debouncedSetQuery(v);
    if (allowCustom) onChange(v);
    setOpen(true);
  };

  const select = (item: string) => {
    setQuery(item);
    setDebouncedQuery(item);
    onChange(item);
    setOpen(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: icon ? '8px 10px 8px 32px' : '8px 10px',
    fontSize: 13,
    border: `1px solid ${open ? theme.colors.orange : theme.colors.border}`,
    borderRadius: 8, outline: 'none', fontFamily: 'inherit',
    background: disabled ? theme.colors.bgSubtle : '#fff',
    cursor: disabled ? 'not-allowed' : 'text',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      {icon && (
        <Search size={14} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 1 }} />
      )}
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => { if (!disabled) setOpen(true); }}
        placeholder={placeholder}
        disabled={disabled}
        style={inputStyle}
      />

      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: 200, overflowY: 'auto',
        }}>
          {filtered.map(item => (
            <div
              key={item}
              onClick={() => select(item)}
              style={{
                padding: '8px 14px', fontSize: 12, cursor: 'pointer',
                background: item === value ? theme.colors.orangeLight : 'transparent',
                color: item === value ? theme.colors.orange : theme.colors.text,
                fontWeight: item === value ? 600 : 400,
                borderBottom: `1px solid ${theme.colors.borderLight}`,
              }}
              onMouseEnter={e => { if (item !== value) e.currentTarget.style.background = theme.colors.bgSubtle; }}
              onMouseLeave={e => { if (item !== value) e.currentTarget.style.background = 'transparent'; }}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
