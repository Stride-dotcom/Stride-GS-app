import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * FloatingActionMenu — mobile-friendly FAB (Floating Action Button) with
 * an expandable action menu. Renders a small orange circle in the bottom-right
 * corner. Tapping it fans out a vertical list of labeled action buttons.
 *
 * Used on all list pages (Tasks, Repairs, WillCalls, Inventory, Shipments)
 * to provide quick access to page-specific actions on touch devices.
 *
 * Desktop: hidden by default (set `show` prop based on isMobile).
 * Mobile: always visible when `show` is true.
 */

export interface FABAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** Optional color override for this action's circle. Default: theme orange */
  color?: string;
  /** If true, show a badge/dot indicating active state (e.g. selection mode on) */
  active?: boolean;
}

interface Props {
  actions: FABAction[];
  show: boolean;
  /** Z-index. Default 200. */
  zIndex?: number;
}

export function FloatingActionMenu({ actions, show, zIndex = 200 }: Props) {
  const [open, setOpen] = useState(false);

  // Close menu when actions change (e.g. navigating away)
  useEffect(() => { setOpen(false); }, [actions]);

  const handleToggle = useCallback(() => setOpen(o => !o), []);

  const handleAction = useCallback((action: FABAction) => {
    setOpen(false);
    // Small delay so the menu closes visually before the action fires
    setTimeout(() => action.onClick(), 100);
  }, []);

  if (!show || actions.length === 0) return null;

  return createPortal(
    <>
      {/* Backdrop — closes menu on tap outside */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: zIndex - 1,
            animation: 'fabFadeIn 0.15s ease-out',
          }}
        />
      )}

      {/* Action buttons — fan out upward from the FAB */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            zIndex,
            display: 'flex',
            flexDirection: 'column-reverse',
            gap: 10,
            animation: 'fabSlideUp 0.2s ease-out',
          }}
        >
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleAction(action)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px 10px 12px',
                border: 'none',
                borderRadius: 28,
                background: action.color || '#fff',
                color: action.color ? '#fff' : theme.colors.text,
                boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                animation: `fabItemIn 0.15s ease-out ${i * 0.04}s both`,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: action.color || theme.colors.orange,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                {action.icon}
                {action.active && (
                  <div style={{
                    position: 'absolute', top: -2, right: -2, width: 10, height: 10,
                    borderRadius: '50%', background: '#16A34A', border: '2px solid #fff',
                  }} />
                )}
              </div>
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Main FAB button */}
      <button
        onClick={handleToggle}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 16,
          zIndex,
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: 'none',
          background: theme.colors.orange,
          color: '#fff',
          boxShadow: '0 6px 20px rgba(232, 93, 45, 0.4)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
        }}
      >
        {open ? <X size={22} /> : <Plus size={22} />}
      </button>

      <style>{`
        @keyframes fabFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fabSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fabItemIn { from { opacity: 0; transform: translateY(10px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
    </>,
    document.body
  );
}
