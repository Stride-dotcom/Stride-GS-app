import { useState, useEffect } from 'react';
import { Bell, Search, Menu } from 'lucide-react';
import { theme } from '../../styles/theme';
import { UniversalSearch } from '../shared/UniversalSearch';

interface TopBarProps {
  title?: string;
  isMobile?: boolean;
  onMenuToggle?: () => void;
}

export function TopBar({ isMobile, onMenuToggle }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <header
        style={{
          height: theme.topbar.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 12px' : `0 ${theme.spacing['2xl']}`,
          borderBottom: `1px solid ${theme.colors.borderSubtle}`,
          background: theme.colors.bgBase,
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          // v38.61.1 — was 10; bumped so the mobile hamburger is never covered
          // by in-page sticky headers (Dashboard table thead uses zIndex: 2).
          // Still below the mobile sidebar overlay (zIndex 40/41) so the menu
          // closes correctly by tapping the backdrop.
          zIndex: 30,
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          {isMobile && onMenuToggle && (
            <button
              onClick={onMenuToggle}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, background: 'transparent', border: 'none',
                borderRadius: theme.radii.md, cursor: 'pointer',
                color: theme.colors.textPrimary, flexShrink: 0,
              }}
            >
              <Menu size={20} />
            </button>
          )}
          {/* Page title removed — each page renders its own title in larger text below */}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px', flexShrink: 0 }}>
          {/* Search trigger */}
          {isMobile ? (
            <button onClick={() => setSearchOpen(true)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, background: theme.colors.bgSubtle,
              border: `1px solid ${theme.colors.borderDefault}`,
              borderRadius: 8, cursor: 'pointer', color: theme.colors.textMuted,
            }}>
              <Search size={16} />
            </button>
          ) : (
            <button onClick={() => setSearchOpen(true)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 100,
              border: '1px solid rgba(0,0,0,0.08)',
              background: '#fff',
              cursor: 'pointer', color: '#888',
              fontSize: 13, fontFamily: theme.typography.fontFamily,
              minWidth: 240, transition: 'border-color 0.15s',
            }}>
              <Search size={14} />
              <span>Search items, tasks...</span>
              <span style={{
                marginLeft: 'auto', fontSize: 10, background: theme.colors.bgBase,
                border: `1px solid ${theme.colors.borderDefault}`,
                padding: '1px 6px', borderRadius: 4, color: theme.colors.textMuted,
              }}>⌘K</span>
            </button>
          )}

          {/* Notification Bell */}
          <button style={{
            position: 'relative', width: '32px', height: '32px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            borderRadius: theme.radii.md, cursor: 'pointer',
            color: theme.colors.textSecondary,
          }}>
            <Bell size={16} />
            <span style={{
              position: 'absolute', top: '4px', right: '4px',
              width: '8px', height: '8px', borderRadius: '50%',
              background: theme.colors.primary,
              border: `2px solid ${theme.colors.bgBase}`,
            }} />
          </button>
        </div>
      </header>

      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
