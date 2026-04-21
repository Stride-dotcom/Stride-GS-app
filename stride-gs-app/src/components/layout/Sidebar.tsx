import { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  PackageOpen,
  ClipboardList,
  Wrench,
  Truck,
  Settings,
  DollarSign,
  CreditCard,
  LogOut,
  Shield,
  PackageCheck,
  ScanLine,
  Tag,
  RefreshCw,
  AlertCircle,
  GripVertical,
  Mail,
  Calendar,
  Receipt,
  BookOpen,
  MessageSquare,
} from 'lucide-react';
import { theme } from '../../styles/theme';
import { cacheClearAll } from '../../lib/apiCache';
import { useAuth } from '../../contexts/AuthContext';
import { useSidebarOrder } from '../../hooks/useSidebarOrder';

// Admin: full access to everything
const ADMIN_NAV = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { id: 'messages', label: 'Messages', path: '/messages', icon: MessageSquare },
  { id: 'inventory', label: 'Inventory', path: '/inventory', icon: Package },
  { id: 'receiving', label: 'Receiving', path: '/receiving', icon: PackageOpen },
  { id: 'shipments', label: 'Shipments', path: '/shipments', icon: PackageCheck },
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: ClipboardList },
  { id: 'repairs', label: 'Repairs', path: '/repairs', icon: Wrench },
  { id: 'willcalls', label: 'Will Calls', path: '/will-calls', icon: Truck },
  { id: 'billing', label: 'Billing', path: '/billing', icon: DollarSign },
  { id: 'claims', label: 'Claims', path: '/claims', icon: Shield },
  { id: 'payments', label: 'Payments', path: '/payments', icon: CreditCard },
  { id: 'orders', label: 'Delivery', path: '/orders', icon: Calendar },
  { id: 'quotes', label: 'Quotes', path: '/quotes', icon: Receipt },
  { id: 'pricelist', label: 'Price List', path: '/price-list', icon: BookOpen },
  { id: 'marketing', label: 'Marketing', path: '/marketing', icon: Mail },
  { id: 'scanner', label: 'QR Scanner', path: '/scanner', icon: ScanLine },
  { id: 'labels', label: 'Labels', path: '/labels', icon: Tag },
];

// Staff: no billing, claims, payments, or settings — has scanner + labels
const STAFF_NAV = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { id: 'messages', label: 'Messages', path: '/messages', icon: MessageSquare },
  { id: 'inventory', label: 'Inventory', path: '/inventory', icon: Package },
  { id: 'receiving', label: 'Receiving', path: '/receiving', icon: PackageOpen },
  { id: 'shipments', label: 'Shipments', path: '/shipments', icon: PackageCheck },
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: ClipboardList },
  { id: 'repairs', label: 'Repairs', path: '/repairs', icon: Wrench },
  { id: 'willcalls', label: 'Will Calls', path: '/will-calls', icon: Truck },
  { id: 'orders', label: 'Delivery', path: '/orders', icon: Calendar },
  { id: 'scanner', label: 'QR Scanner', path: '/scanner', icon: ScanLine },
  { id: 'labels', label: 'Labels', path: '/labels', icon: Tag },
];

// Client: own data only — dashboard, inventory, shipments, tasks, repairs, will calls, claims
const CLIENT_NAV = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { id: 'messages', label: 'Messages', path: '/messages', icon: MessageSquare },
  { id: 'inventory', label: 'Inventory', path: '/inventory', icon: Package },
  { id: 'shipments', label: 'Shipments', path: '/shipments', icon: PackageCheck },
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: ClipboardList },
  { id: 'repairs', label: 'Repairs', path: '/repairs', icon: Wrench },
  { id: 'willcalls', label: 'Will Calls', path: '/will-calls', icon: Truck },
  { id: 'claims', label: 'Claims', path: '/claims', icon: Shield },
  { id: 'orders', label: 'Delivery', path: '/orders', icon: Calendar },
];

// Role display labels
const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  staff: 'Staff',
  client: 'Client',
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  failureCount?: number;
  onOpenFailures?: () => void;
}

export function Sidebar({ collapsed, onToggle, onNavigate, failureCount = 0, onOpenFailures }: SidebarProps) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  // Nav items based on role
  const roleNav = user?.role === 'client' ? CLIENT_NAV
    : user?.role === 'staff' ? STAFF_NAV
    : ADMIN_NAV;

  const defaultIds = useMemo(() => roleNav.map(n => n.id), [roleNav]);
  const { orderedIds, reorder } = useSidebarOrder(user?.email, defaultIds);

  // Sort nav items by persisted order
  const navItems = useMemo(() => {
    const byId = new Map(roleNav.map(n => [n.id, n]));
    return orderedIds.map(id => byId.get(id)).filter(Boolean) as typeof roleNav;
  }, [roleNav, orderedIds]);

  // Drag state
  const [dragNavId, setDragNavId] = useState<string | null>(null);
  const [dragOverNavId, setDragOverNavId] = useState<string | null>(null);
  const [hoverNavId, setHoverNavId] = useState<string | null>(null);

  return (
    <aside
      style={{
        width: collapsed ? theme.sidebar.widthCollapsed : theme.sidebar.width,
        minWidth: collapsed ? theme.sidebar.widthCollapsed : theme.sidebar.width,
        height: '100%',
        background: '#F5F2EE',
        borderRight: `1px solid rgba(0,0,0,0.06)`,
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease, min-width 0.2s ease',
        overflowX: 'hidden',
        overflowY: 'hidden',
        position: 'sticky',
        top: 0,
        flexShrink: 0,
      }}
    >
      {/* Logo / Brand */}
      <div
        style={{
          height: theme.topbar.height,
          display: 'flex',
          alignItems: 'center',
          padding: collapsed ? '0 14px' : '0 16px',
          borderBottom: `1px solid rgba(0,0,0,0.06)`,
          gap: '10px',
          flexShrink: 0,
          cursor: 'pointer',
        }}
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <img
          src="/stride-logo.png"
          alt="Stride"
          style={{ width: '30px', height: '30px', objectFit: 'contain', flexShrink: 0 }}
        />
        {!collapsed && (
          <div style={{ overflow: 'hidden' }}>
            <div style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.primary,
              fontFamily: theme.typography.fontFamily,
              whiteSpace: 'nowrap', lineHeight: 1.2,
            }}>
              Stride Logistics
            </div>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <nav style={{
        flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column',
        gap: '1px', overflowY: 'auto', overflowX: 'hidden',
      }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);
          const isDragOver = dragOverNavId === item.id && dragNavId !== item.id;
          const isDragging = dragNavId === item.id;
          const isHovered = hoverNavId === item.id;

          return (
            <div
              key={item.id}
              draggable={!collapsed}
              onDragStart={(e) => {
                setDragNavId(item.id);
                e.dataTransfer.effectAllowed = 'move';
                // Use a tiny timeout so the dragged element renders before ghost snapshot
                requestAnimationFrame(() => {});
              }}
              onDragOver={(e) => {
                if (!dragNavId || dragNavId === item.id) return;
                e.preventDefault();
                setDragOverNavId(item.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragNavId && dragNavId !== item.id) {
                  reorder(dragNavId, item.id);
                }
                setDragNavId(null);
                setDragOverNavId(null);
              }}
              onDragEnd={() => { setDragNavId(null); setDragOverNavId(null); }}
              onMouseEnter={() => setHoverNavId(item.id)}
              onMouseLeave={() => setHoverNavId(null)}
              style={{ position: 'relative' }}
            >
              <NavLink to={item.path} end={item.path === '/'} style={{ textDecoration: 'none' }} onClick={onNavigate}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: collapsed ? '10px' : '6px',
                    padding: collapsed ? '10px 16px' : '9px 14px 9px 8px',
                    margin: '1px 8px', borderRadius: theme.radii.lg, cursor: 'pointer',
                    transition: isDragging ? 'none' : 'all 0.15s ease',
                    borderLeft: isActive ? `3px solid #E8692A` : '3px solid transparent',
                    background: isDragOver ? 'rgba(232,105,42,0.10)' : isActive ? 'rgba(232,105,42,0.12)' : 'transparent',
                    opacity: isDragging ? 0.4 : 1,
                    position: 'relative',
                    borderTop: isDragOver ? `2px solid ${theme.colors.primary}` : '2px solid transparent',
                  }}
                  title={collapsed ? item.label : undefined}
                >
                  {/* Drag grip — visible on hover, expanded only */}
                  {!collapsed && (
                    <GripVertical
                      size={12}
                      style={{
                        color: theme.colors.textSidebarSecondary,
                        flexShrink: 0,
                        opacity: isHovered && !dragNavId ? 0.5 : 0,
                        transition: 'opacity 0.15s',
                        cursor: 'grab',
                      }}
                    />
                  )}
                  <Icon
                    size={16}
                    style={{
                      color: isActive ? '#E8692A' : theme.colors.textSidebarSecondary,
                      flexShrink: 0,
                    }}
                  />
                  {!collapsed && (
                    <span style={{
                      fontSize: theme.typography.sizes.sm,
                      fontWeight: isActive ? theme.typography.weights.semibold : theme.typography.weights.medium,
                      color: isActive ? '#E8692A' : theme.colors.textSidebarPrimary,
                      fontFamily: theme.typography.fontFamily,
                      whiteSpace: 'nowrap',
                    }}>
                      {item.label}
                    </span>
                  )}
                </div>
              </NavLink>
            </div>
          );
        })}
      </nav>

      {/* Bottom: Settings + User — always visible (nav scrolls, this doesn't) */}
      <div style={{
        borderTop: `1px solid rgba(0,0,0,0.06)`,
        padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '1px',
        flexShrink: 0,
      }}>
        {/* Settings — admin only */}
        {user?.role === 'admin' && (
          <NavLink to="/settings" style={{ textDecoration: 'none' }} onClick={onNavigate}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: collapsed ? '8px 14px' : '7px 12px 7px 14px',
                margin: '0 6px', borderRadius: theme.radii.md, cursor: 'pointer',
                borderLeft: location.pathname === '/settings'
                  ? '3px solid #E8692A' : '3px solid transparent',
                background: location.pathname === '/settings'
                  ? 'rgba(232,105,42,0.12)' : 'transparent',
              }}
              title={collapsed ? 'Settings' : undefined}
            >
              <Settings
                size={16}
                style={{
                  color: location.pathname === '/settings'
                    ? '#E8692A' : theme.colors.textSecondary,
                  flexShrink: 0,
                }}
              />
              {!collapsed && (
                <span style={{
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: location.pathname === '/settings'
                    ? theme.typography.weights.semibold : theme.typography.weights.medium,
                  color: location.pathname === '/settings'
                    ? '#E8692A' : theme.colors.textSecondary,
                  fontFamily: theme.typography.fontFamily, whiteSpace: 'nowrap',
                }}>
                  Settings
                </span>
              )}
            </div>
          </NavLink>
        )}

        {/* User info row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: collapsed ? '8px 14px' : '8px 14px',
          margin: '2px 6px 0',
        }}>
          {/* Avatar */}
          <div
            style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: theme.colors.orangeLight, display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              fontSize: '11px', fontWeight: 600, color: theme.colors.primary,
              fontFamily: theme.typography.fontFamily,
            }}
            title={collapsed ? (user?.displayName ?? 'User') : undefined}
          >
            {user?.avatarInitials ?? '?'}
          </div>

          {!collapsed && user && (
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.medium,
                color: theme.colors.textSidebarPrimary,
                fontFamily: theme.typography.fontFamily,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {user.displayName}
              </div>
              <div style={{
                fontSize: '10px', color: theme.colors.textSidebarSecondary,
                fontFamily: theme.typography.fontFamily, whiteSpace: 'nowrap',
              }}>
                {ROLE_LABELS[user.role] ?? user.role}
              </div>
            </div>
          )}
        </div>

        {/* Failed Operations button — staff/admin only; badge appears when count > 0 */}
        {onOpenFailures && user?.role !== 'client' && (
          <div
            onClick={onOpenFailures}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onOpenFailures()}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: collapsed ? '7px 16px' : '7px 14px',
              margin: '2px 6px 0', borderRadius: theme.radii.md,
              cursor: 'pointer',
              position: 'relative',
            }}
            title={collapsed
              ? (failureCount > 0 ? `${failureCount} Failed Operation${failureCount !== 1 ? 's' : ''}` : 'Failed Operations')
              : undefined}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.07)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <AlertCircle
                size={14}
                style={{ color: failureCount > 0 ? '#EF4444' : theme.colors.textSecondary }}
              />
              {failureCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-5px',
                  right: '-6px',
                  background: '#EF4444',
                  color: '#fff',
                  fontSize: '9px',
                  fontWeight: 700,
                  fontFamily: theme.typography.fontFamily,
                  borderRadius: '999px',
                  padding: '0 3px',
                  minWidth: '14px',
                  height: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}>
                  {failureCount > 99 ? '99+' : failureCount}
                </span>
              )}
            </div>
            {!collapsed && (
              <span style={{
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.medium,
                color: failureCount > 0 ? '#EF4444' : theme.colors.textSecondary,
                fontFamily: theme.typography.fontFamily,
                whiteSpace: 'nowrap',
              }}>
                {failureCount > 0
                  ? `${failureCount} Failed Operation${failureCount !== 1 ? 's' : ''}`
                  : 'Failed Operations'}
              </span>
            )}
          </div>
        )}

        {/* Refresh Data — staff/admin only */}
        {user?.role !== 'client' && <div
          onClick={() => { cacheClearAll(); window.location.reload(); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && (cacheClearAll(), window.location.reload())}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: collapsed ? '7px 16px' : '7px 14px',
            margin: '2px 6px 0', borderRadius: theme.radii.md,
            cursor: 'pointer',
          }}
          title={collapsed ? 'Refresh Data' : undefined}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <RefreshCw size={14} style={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
          {!collapsed && (
            <span style={{
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.medium,
              color: theme.colors.textSecondary,
              fontFamily: theme.typography.fontFamily,
              whiteSpace: 'nowrap',
            }}>
              Refresh Data
            </span>
          )}
        </div>}

        {/* Sign Out row — clearly labeled */}
        <div
          onClick={signOut}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && signOut()}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: collapsed ? '7px 16px' : '7px 14px',
            margin: '2px 6px 6px', borderRadius: theme.radii.md,
            cursor: 'pointer',
          }}
          title={collapsed ? 'Sign Out' : undefined}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(220,38,38,0.07)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <LogOut size={14} style={{ color: '#DC2626', flexShrink: 0 }} />
          {!collapsed && (
            <span style={{
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.medium,
              color: '#DC2626',
              fontFamily: theme.typography.fontFamily,
              whiteSpace: 'nowrap',
            }}>
              Sign Out
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
