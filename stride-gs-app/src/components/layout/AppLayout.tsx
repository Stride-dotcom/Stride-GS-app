import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { theme } from '../../styles/theme';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useFailedOperations } from '../../hooks/useFailedOperations';
import { FailedOperationsDrawer } from '../shared/FailedOperationsDrawer';
import { useSupabaseRealtime } from '../../hooks/useSupabaseRealtime';
import { useAuth } from '../../contexts/AuthContext';
import { useClients } from '../../hooks/useClients';
import { usePricing } from '../../hooks/usePricing';
import { useLocations } from '../../hooks/useLocations';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../hooks/useNotifications';
import { PersistentBanner } from '../notifications/PersistentBanner';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/inventory': 'Inventory',
  '/receiving': 'Receiving',
  '/tasks': 'Tasks',
  '/repairs': 'Repairs',
  '/will-calls': 'Will Calls',
  '/billing': 'Billing',
  '/shipments': 'Shipments',
  '/claims': 'Claims',
  '/payments': 'Payments',
  '/price-list': 'Price List',
  '/settings': 'Settings',
};

export function AppLayout() {
  // Phase 4: subscribe to Supabase Realtime on all 5 cache tables — all users see
  // changes within 1-2s of GAS write completing (write-through is Phase 3)
  useSupabaseRealtime();

  // Session 73 Phase B: subscribe to new-message Realtime events so the bell
  // + toast banners wake up as soon as a recipient row lands for this user.
  useNotifications();

  // Pre-fetch shared data at app level so caches are warm for all pages
  useClients();
  usePricing();
  useLocations();

  // Warm the Supabase connection (first query has ~200-500ms cold start)
  useEffect(() => { supabase.from('inventory').select('item_id', { count: 'exact', head: true }); }, []);

  const { user, isImpersonating, exitImpersonation } = useAuth();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [failuresOpen, setFailuresOpen] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? 'Stride';
  const { isMobile, isTablet } = useIsMobile();
  const { failures, loading: failuresLoading, unresolvedCount, refetch: refetchFailures, dismiss, retry } = useFailedOperations();

  // Auto-collapse sidebar on tablet-sized screens
  useEffect(() => {
    if (isTablet) setSidebarCollapsed(true);
  }, [isTablet]);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div
      style={{
        display: 'flex',
        height: '100dvh',       // dynamic viewport height (avoids iOS URL bar)
        overflow: 'hidden',
        background: theme.colors.bgSubtle,
        fontFamily: theme.typography.fontFamily,
      }}
    >
      {/* Session 73 — floating toast banners for new-message + mention events.
          Self-positions (fixed, top-right). Full-width on mobile via its own
          media query. Renders nothing when there are no active alerts. */}
      <PersistentBanner />

      {/* Mobile overlay backdrop */}
      {isMobile && mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 40,
            backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Sidebar: on mobile it's a slide-out overlay, on desktop/tablet it's in the flow */}
      {isMobile ? (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 41,
          transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        }}>
          <Sidebar
            collapsed={false}
            onToggle={() => setMobileMenuOpen(false)}
            onNavigate={() => setMobileMenuOpen(false)}
            failureCount={unresolvedCount}
            onOpenFailures={() => setFailuresOpen(true)}
          />
        </div>
      ) : (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          failureCount={unresolvedCount}
          onOpenFailures={() => setFailuresOpen(true)}
        />
      )}

      <FailedOperationsDrawer
        open={failuresOpen}
        onClose={() => setFailuresOpen(false)}
        failures={failures}
        loading={failuresLoading}
        onRefetch={refetchFailures}
        onRetry={retry}
        onDismiss={dismiss}
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          // On mobile, take full width (no sidebar in flow)
          width: isMobile ? '100%' : undefined,
        }}
      >
        <TopBar
          title={title}
          isMobile={isMobile}
          onMenuToggle={() => setMobileMenuOpen((v) => !v)}
        />
        {isImpersonating && user && (
          <div style={{
            background: '#F97316',
            color: '#fff',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
          }}>
            <span>
              Viewing as: {user.displayName} ({user.email}) — {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
              {user.clientName ? ` | ${user.clientName}` : ''}
            </span>
            <button
              onClick={exitImpersonation}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.4)',
                color: '#fff',
                borderRadius: 6,
                padding: '4px 14px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Exit
            </button>
          </div>
        )}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: isMobile ? '12px 8px' : theme.spacing['2xl'],
            minHeight: 0,
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
