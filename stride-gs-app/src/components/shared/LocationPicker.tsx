import React, { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * Phase 7A-15: LocationPicker
 * Reusable autocomplete dropdown for warehouse locations.
 * - Loads options from a locations array (mock data)
 * - Allows typed custom values (allowInvalid parity)
 * - Searchable/filterable
 * - Shows loading state placeholder
 */

const DEFAULT_LOCATIONS = [
  'Rec-Dock',
  'A-01-01', 'A-01-02', 'A-01-03',
  'A-02-01', 'A-02-02', 'A-02-03',
  'A-03-01', 'A-03-02',
  'B-01-01', 'B-01-02',
  'B-02-01', 'B-02-02',
  'B-03-01',
  'C-01-01', 'C-01-02',
  'C-02-01',
  'WW1', 'WW2',
  'Staging-Area',
  'Overflow',
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  locations?: string[];
  placeholder?: string;
  allowCustom?: boolean;
  loading?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function LocationPicker({
  value,
  onChange,
  locations = DEFAULT_LOCATIONS,
  placeholder = 'Select or type location...',
  allowCustom = true,
  loading = false,
  disabled = false,
  style,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = locations.filter(l => l.toLowerCase().includes(query.toLowerCase()));
  const showCustomOption = allowCustom && query && !locations.includes(query);

  const select = (loc: string) => {
    setQuery(loc);
    onChange(loc);
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (allowCustom) onChange(e.target.value);
    setOpen(true);
  };

  const handleInputFocus = () => {
    if (!disabled && !loading) setOpen(true);
  };

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    ...style,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 32px 8px 32px', fontSize: 13,
    border: `1px solid ${open ? theme.colors.orange : theme.colors.border}`,
    borderRadius: 8, outline: 'none', fontFamily: 'inherit',
    background: disabled || loading ? theme.colors.bgSubtle : '#fff',
    color: loading ? theme.colors.textMuted : theme.colors.text,
    cursor: disabled ? 'not-allowed' : 'text',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  return (
    <div ref={ref} style={containerStyle}>
      <div style={{ position: 'relative' }}>
        <MapPin size={14} color={theme.colors.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          ref={inputRef}
          value={loading ? 'Loading...' : query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled || loading}
          style={inputStyle}
        />
        <ChevronDown
          size={14}
          color={theme.colors.textMuted}
          style={{ position: 'absolute', right: 10, top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`, pointerEvents: 'none', transition: 'transform 0.15s' }}
        />
      </div>

      {open && !loading && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.length === 0 && !showCustomOption && (
            <div style={{ padding: '10px 14px', fontSize: 12, color: theme.colors.textMuted }}>No locations match "{query}"</div>
          )}
          {showCustomOption && (
            <div
              onClick={() => select(query)}
              style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', borderBottom: `1px solid ${theme.colors.borderLight}`, color: theme.colors.orange, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => e.currentTarget.style.background = theme.colors.orangeLight}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 10 }}>+</span> Use "{query}"
            </div>
          )}
          {filtered.map(loc => (
            <div
              key={loc}
              onClick={() => select(loc)}
              style={{
                padding: '8px 14px', fontSize: 12, cursor: 'pointer',
                background: loc === value ? theme.colors.orangeLight : 'transparent',
                color: loc === value ? theme.colors.orange : theme.colors.text,
                fontWeight: loc === value ? 600 : 400,
                borderBottom: `1px solid ${theme.colors.borderLight}`,
                fontFamily: 'monospace',
              }}
              onMouseEnter={e => { if (loc !== value) e.currentTarget.style.background = theme.colors.bgSubtle; }}
              onMouseLeave={e => { if (loc !== value) e.currentTarget.style.background = 'transparent'; }}
            >
              {loc}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
