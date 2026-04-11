import { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { theme } from '../../styles/theme';

interface SearchDropdownProps {
  placeholder?: string;
  onSearch?: (value: string) => void;
}

export function SearchDropdown({ placeholder = 'Search...', onSearch }: SearchDropdownProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Search
        size={14}
        style={{
          position: 'absolute',
          left: '10px',
          color: theme.colors.textMuted,
          pointerEvents: 'none',
        }}
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onSearch?.(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          paddingLeft: '32px',
          paddingRight: focused || value ? '10px' : '64px',
          paddingTop: '6px',
          paddingBottom: '6px',
          width: '240px',
          fontSize: theme.typography.sizes.sm,
          fontFamily: theme.typography.fontFamily,
          color: theme.colors.textPrimary,
          background: theme.colors.bgSubtle,
          border: `1px solid ${focused ? theme.colors.borderDefault : theme.colors.borderSubtle}`,
          borderRadius: theme.radii.lg,
          outline: 'none',
          transition: 'border-color 0.15s, width 0.2s',
        }}
      />
      {!focused && !value && (
        <span
          style={{
            position: 'absolute',
            right: '10px',
            fontSize: '11px',
            color: theme.colors.textMuted,
            background: theme.colors.bgBase,
            border: `1px solid ${theme.colors.borderDefault}`,
            borderRadius: '4px',
            padding: '1px 5px',
            lineHeight: 1.5,
            pointerEvents: 'none',
          }}
        >
          ⌘K
        </span>
      )}
    </div>
  );
}
