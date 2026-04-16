import { ReactNode, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UpgradeNotificationBanner } from '@/components/prompts';
import { usePermissions } from '@/hooks/usePermissions';
import { useSidebar } from '@/contexts/SidebarContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AvatarWithPresence } from '@/components/ui/online-indicator';
import { usePresence } from '@/hooks/usePresence';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { AppleBanner } from '@/components/ui/AppleBanner';
import { useMessageNotifications } from '@/hooks/useMessageNotifications';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { ResumePausedTaskPrompt } from '@/components/time/ResumePausedTaskPrompt';
import { TimerOfflineSyncManager } from '@/components/time/TimerOfflineSyncManager';
import { HelpToolRuntimeLayer } from '@/components/help/HelpToolRuntimeLayer';
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';
import { TenantSwitcherDialog } from '@/components/admin/TenantSwitcherDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface NavItem {
  label: string;
  href: string;
  /** Material Symbols icon name */
  icon: string;
  requiredRole?: string[];
}

// Base navigation items (excluding special items like QA which has custom gating)
const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: 'dashboard' },
  { label: 'Shipments', href: '/shipments', icon: 'local_shipping' },
  { label: 'Inventory', href: '/inventory', icon: 'inventory_2' },
  { label: 'Containers', href: '/containers', icon: 'all_inbox' },
  { label: 'Tasks', href: '/tasks', icon: 'task_alt' },
  { label: 'Stocktake', href: '/stocktakes', icon: 'fact_check' },
  { label: 'Scan', href: '/scan', icon: 'qr_code_scanner', requiredRole: ['admin', 'manager', 'warehouse', 'technician'] },

  { label: 'Analytics', href: '/reports', icon: 'analytics', requiredRole: ['admin', 'billing_manager'] },
  { label: 'Quotes', href: '/quotes', icon: 'request_quote', requiredRole: ['admin', 'manager'] },
  { label: 'Claims', href: '/claims', icon: 'assignment_late', requiredRole: ['admin'] },
  { label: 'Accounts', href: '/accounts', icon: 'group', requiredRole: ['admin', 'billing_manager'] },
  { label: 'Employees', href: '/employees', icon: 'badge', requiredRole: ['admin', 'manager'] },
  { label: 'Settings', href: '/settings', icon: 'settings', requiredRole: ['admin', 'billing_manager'] },
  { label: 'Diagnostics', href: '/diagnostics', icon: 'bug_report', requiredRole: ['admin'] },
];

interface DashboardLayoutProps {
  children: ReactNode;
}

// Sortable nav item component
interface SortableNavItemProps {
  item: NavItem;
  isActive: boolean;
  sidebarCollapsed: boolean;
  onNavigate: () => void;
}

function SortableNavItem({ item, isActive, sidebarCollapsed, onNavigate }: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.href });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Generate testid from href (e.g., /shipments -> nav-shipments)
  const testId = `nav-${item.href.replace(/\//g, '').replace(/-/g, '_') || 'dashboard'}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group"
      data-testid={testId}
    >
      <Link
        to={item.href}
        onClick={onNavigate}
        title={sidebarCollapsed ? item.label : undefined}
        data-testid={`${testId}-link`}
        className={cn(
          'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-gradient-to-r from-primary/15 to-primary/5 text-primary dark:from-primary/25 dark:to-primary/10 dark:text-primary'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/5',
          sidebarCollapsed && 'lg:justify-center lg:px-2'
        )}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
        )}
        <MaterialIcon
          name={item.icon}
          size="md"
          weight={isActive ? 400 : 300}
          className={cn(
            'flex-shrink-0 transition-colors',
            isActive ? 'text-primary' : 'text-gray-400 dark:text-white/50'
          )}
        />
        <span className={cn(
          "relative z-10 transition-opacity duration-200 flex-1",
          sidebarCollapsed ? "lg:hidden" : ""
        )}>{item.label}</span>
      </Link>
      {/* Drag handle - only visible on hover and when not collapsed */}
      {!sidebarCollapsed && (
        <button
          {...attributes}
          {...listeners}
          className={cn(
            "absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded transition-opacity cursor-grab active:cursor-grabbing",
            "hover:bg-gray-100 dark:hover:bg-white/10",
            // Mobile/tablet (no hover): keep handle visible so the menu is actually reorderable.
            "opacity-100",
            // Desktop: only show on hover to keep the sidebar clean.
            "lg:opacity-0 lg:group-hover:opacity-100",
          )}
          title="Drag to reorder"
        >
          <MaterialIcon name="drag_indicator" size="sm" className="text-gray-400 dark:text-white/40" />
        </button>
      )}
    </div>
  );
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  useMessageNotifications();
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { sidebarCollapsed, setSidebarCollapsed } = useSidebar();
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('stride-theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  const [navOrder, setNavOrder] = useState<string[]>([]);
  const [tenantLogo, setTenantLogo] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('Stride WMS');
  const [unreadCount, setUnreadCount] = useState(0);
  const [inAppAlertsEnabled, setInAppAlertsEnabled] = useState(true);
  const [inAppPreferenceLoading, setInAppPreferenceLoading] = useState(false);
  const [inAppPreferenceSaving, setInAppPreferenceSaving] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);
  const { profile, signOut } = useAuth();
  const { hasRole, isAdmin, isReallyAdminDev, loading: permissionsLoading } = usePermissions();
  const [tenantSwitcherOpen, setTenantSwitcherOpen] = useState(false);
  const { getUserStatus } = usePresence();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    warehouses: availableWarehouses,
    selectedWarehouseId,
    setSelectedWarehouseId,
    loading: warehousesLoading,
    needsWarehouseSelection,
  } = useSelectedWarehouse();
  const canSeeInAppAlertSelfToggle =
    hasRole('manager') || hasRole('admin') || hasRole('admin_dev');

  // Swipe to close sidebar on mobile - with finger-following physics
  const touchStartX = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [sidebarTranslateX, setSidebarTranslateX] = useState(0);
  const [isGesturing, setIsGesturing] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setIsGesturing(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || !sidebarOpen) return;
    const currentX = e.touches[0].clientX;
    const diff = touchStartX.current - currentX;
    
    // Only track left swipe (negative translateX), clamp to sidebar width
    if (diff > 0) {
      const sidebarWidth = sidebarRef.current?.offsetWidth || 256;
      const clampedDiff = Math.min(diff, sidebarWidth);
      setSidebarTranslateX(-clampedDiff);
    }
  }, [sidebarOpen]);

  const handleTouchEnd = useCallback(() => {
    const sidebarWidth = sidebarRef.current?.offsetWidth || 256;
    
    // If swiped more than 40% of sidebar width, close it
    if (Math.abs(sidebarTranslateX) > sidebarWidth * 0.4) {
      setSidebarOpen(false);
    }
    
    // Reset transform (CSS transition will animate back)
    setSidebarTranslateX(0);
    setIsGesturing(false);
    touchStartX.current = null;
  }, [sidebarTranslateX]);

  // Global edge-swipe (right edge → left) to open Scan Hub quickly.
  // Guarded to avoid fighting iOS Safari's forward-swipe gesture unless installed (PWA) or native.
  const edgeSwipeRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startTime: number;
    tracking: boolean;
  } | null>(null);

  const canUseEdgeSwipe = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
    const isStandalone =
      !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      !!(navigator as any).standalone;
    const isCapacitor = !!(window as any).Capacitor;

    if (isIOS && !isStandalone && !isCapacitor) return false;
    return true;
  }, []);

  const handleEdgeSwipeTouchStart = useCallback((e: React.TouchEvent) => {
    if (!canUseEdgeSwipe()) return;
    if (e.touches.length !== 1) return;
    if (typeof window === 'undefined') return;

    const t = e.touches[0];
    const edgePx = 24;
    const winW = window.innerWidth || 0;
    if (winW > 0 && t.clientX < winW - edgePx) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;

    edgeSwipeRef.current = {
      tracking: true,
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      startTime: Date.now(),
    };
  }, [canUseEdgeSwipe]);

  const handleEdgeSwipeTouchMove = useCallback((e: React.TouchEvent) => {
    const state = edgeSwipeRef.current;
    if (!state?.tracking) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    state.lastX = t.clientX;
    state.lastY = t.clientY;
  }, []);

  const handleEdgeSwipeTouchEnd = useCallback(() => {
    const state = edgeSwipeRef.current;
    edgeSwipeRef.current = null;
    if (!state?.tracking) return;

    const dx = state.lastX - state.startX;
    const dy = state.lastY - state.startY;
    const dt = Date.now() - state.startTime;

    const minDx = -90;
    const maxDy = 50;
    const maxDt = 900;
    if (dx <= minDx && Math.abs(dy) <= maxDy && dt <= maxDt) {
      if (location.pathname !== '/scan') {
        navigate('/scan');
      }
    }
  }, [location.pathname, navigate]);

  // Apply theme
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('stride-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Auto-hide header on scroll
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY > lastScrollY.current && currentScrollY > 60) {
        // Scrolling down - hide header
        setHeaderVisible(false);
      } else {
        // Scrolling up - show header
        setHeaderVisible(true);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fetch unread notification/message count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!profile?.id) return;
      try {
        // Try the RPC function first
        const { data, error } = await (supabase as any).rpc('get_total_unread_count', {
          p_user_id: profile.id,
        });
        if (!error && data !== null) {
          setUnreadCount(typeof data === 'number' ? data : 0);
        }
      } catch {
        // Silently fail - tables may not exist yet
      }
    };
    fetchUnreadCount();

    // Set up interval to refresh count periodically
    const interval = setInterval(fetchUnreadCount, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, [profile?.id]);

  // Load per-user in-app alert preference (default ON)
  useEffect(() => {
    if (!profile?.id || !canSeeInAppAlertSelfToggle) return;

    let cancelled = false;
    const loadPreference = async () => {
      setInAppPreferenceLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_preferences')
          .select('preference_value')
          .eq('user_id', profile.id)
          .eq('preference_key', 'in_app_alerts')
          .maybeSingle();

        if (error) throw error;

        const pref = (data?.preference_value || {}) as Record<string, unknown>;
        const enabled = pref.enabled !== false && pref.in_app_alerts_enabled !== false;
        if (!cancelled) {
          setInAppAlertsEnabled(enabled);
        }
      } catch (error) {
        console.error('Failed to load in-app preference:', error);
      } finally {
        if (!cancelled) {
          setInAppPreferenceLoading(false);
        }
      }
    };

    void loadPreference();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, canSeeInAppAlertSelfToggle]);

  const handleToggleInAppAlerts = useCallback(async (checked: boolean) => {
    if (!profile?.id || !canSeeInAppAlertSelfToggle) return;

    const previousValue = inAppAlertsEnabled;
    setInAppAlertsEnabled(checked);
    setInAppPreferenceSaving(true);
    try {
      const { error } = await supabase
        .from('user_preferences')
        .upsert(
          {
            user_id: profile.id,
            preference_key: 'in_app_alerts',
            preference_value: {
              enabled: checked,
              in_app_alerts_enabled: checked,
              updated_at: new Date().toISOString(),
            },
          },
          { onConflict: 'user_id,preference_key' }
        );

      if (error) throw error;
    } catch (error) {
      setInAppAlertsEnabled(previousValue);
      const message = error instanceof Error ? error.message : 'Failed to save in-app preference';
      toast({
        variant: 'destructive',
        title: 'Preference update failed',
        description: message,
      });
    } finally {
      setInAppPreferenceSaving(false);
    }
  }, [canSeeInAppAlertSelfToggle, inAppAlertsEnabled, profile?.id, toast]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Toggle sidebar collapsed state (localStorage handled by context)
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  // Load nav order from localStorage per user
  useEffect(() => {
    if (profile?.id) {
      const savedOrder = localStorage.getItem(`nav-order-${profile.id}`);
      if (savedOrder) {
        try {
          setNavOrder(JSON.parse(savedOrder));
        } catch {
          setNavOrder([]);
        }
      }
    }
  }, [profile?.id]);

  // Save nav order to localStorage
  const saveNavOrder = (order: string[]) => {
    if (profile?.id) {
      localStorage.setItem(`nav-order-${profile.id}`, JSON.stringify(order));
    }
    setNavOrder(order);
  };

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sortedNavItems.findIndex((item) => item.href === active.id);
      const newIndex = sortedNavItems.findIndex((item) => item.href === over.id);
      const newOrder = arrayMove(sortedNavItems, oldIndex, newIndex).map((item) => item.href);
      saveNavOrder(newOrder);
    }
  };

  // Fetch tenant logo and name
  useEffect(() => {
    const fetchTenantBranding = async () => {
      if (!profile?.tenant_id) return;

      try {
        // Fetch tenant name
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', profile.tenant_id)
          .single();

        if (tenantData?.name) {
          setTenantName(tenantData.name);
        }

        // Fetch logo from tenant_company_settings
        const { data: settingsData } = await supabase
          .from('tenant_company_settings')
          .select('logo_url')
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle();

        if (settingsData?.logo_url) {
          setTenantLogo(settingsData.logo_url);
        }
      } catch (error) {
        console.error('Error fetching tenant branding:', error);
      }
    };

    fetchTenantBranding();
  }, [profile?.tenant_id]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const getInitials = () => {
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase();
    }
    if (profile?.email) {
      return profile.email[0].toUpperCase();
    }
    return 'U';
  };

  // Check if user is a technician (repair tech with limited access)
  const isTechnician = hasRole('technician') && !hasRole('warehouse_user') && !isAdmin;

  // Filter and customize nav items based on role
  const filteredNavItems = useMemo(() => {
    // While permissions are loading (e.g. after page navigation remounts the layout),
    // show all nav items to prevent the sidebar from flickering to a reduced set.
    // Route-level RequireRole still guards actual page access.
    if (permissionsLoading) return navItems;

    // Technicians only see "My Tasks"
    if (isTechnician) {
      return [{ label: 'My Tasks', href: '/tasks', icon: 'task_alt' }];
    }

    // Normal role-based filtering for other users
    const baseItems = navItems.filter((item) => {
      if (!item.requiredRole) return true;
      return item.requiredRole.some((role) => hasRole(role)) || isAdmin;
    });

    return baseItems;
  }, [permissionsLoading, isTechnician, hasRole, isAdmin]);

  // Sort nav items based on saved order
  const sortedNavItems = useMemo(() => {
    if (navOrder.length === 0) return filteredNavItems;

    return [...filteredNavItems].sort((a, b) => {
      const aIndex = navOrder.indexOf(a.href);
      const bIndex = navOrder.indexOf(b.href);
      // Items not in saved order go to the end
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }, [filteredNavItems, navOrder]);

  const showWarehousePicker =
    needsWarehouseSelection &&
    !warehousesLoading &&
    !selectedWarehouseId &&
    availableWarehouses.length > 1;

  return (
    <div className="min-h-screen min-h-[100dvh] bg-background flex flex-col">
      <ImpersonationBanner />
      <TenantSwitcherDialog open={tenantSwitcherOpen} onOpenChange={setTenantSwitcherOpen} />
      <Dialog open={showWarehousePicker} onOpenChange={() => { /* controlled */ }}>
        <DialogContent
          className="[&_.stoplight-close]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Select your default warehouse</DialogTitle>
            <DialogDescription>
              Choose a warehouse to continue. This will be saved as your default across devices.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Select
              value={selectedWarehouseId ?? ''}
              onValueChange={(v) => {
                if (!v) return;
                setSelectedWarehouseId(v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {availableWarehouses.map((wh) => (
                  <SelectItem key={wh.id} value={wh.id}>
                    {wh.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="text-xs text-muted-foreground">
              Tip: You can switch warehouses later using the selector on supported pages.
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          // Apply finger-following transform during active gesture
          transform: sidebarOpen && isGesturing && sidebarTranslateX !== 0
            ? `translateX(${sidebarTranslateX}px)`
            : undefined,
          willChange: isGesturing ? 'transform' : 'auto',
        }}
        className={cn(
          'fixed top-0 left-0 z-50 h-full border-r flex flex-col rounded-r-2xl',
          // Light mode: white background
          'bg-white border-gray-200',
          // Dark mode: keep dark gradient
          'dark:bg-gradient-to-b dark:from-slate-800 dark:via-slate-900 dark:to-slate-950 dark:border-slate-700',
          // Only apply CSS transition when NOT actively gesturing
          !isGesturing && 'transform transition-all duration-300 ease-bounce',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0', // Always visible on desktop
          sidebarCollapsed ? 'lg:w-16' : 'lg:w-52',
          'w-64' // Mobile always full width when open
        )}
      >
        {/* Fixed Header */}
        <div className={cn(
          "flex-shrink-0 flex h-12 items-center border-b border-gray-200 dark:border-slate-700",
          sidebarCollapsed ? "lg:justify-center lg:px-2 px-4" : "justify-between px-4"
        )}>
          <Link to="/" className="flex items-center gap-3">
            {tenantLogo ? (
              <img
                src={tenantLogo}
                alt={tenantName}
                className="h-8 w-8 object-contain rounded"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-md">
                <MaterialIcon name="warehouse" size="sm" className="text-white" weight={300} />
              </div>
            )}
            <span className={cn(
              "font-bold text-gray-900 dark:text-white transition-opacity duration-200",
              sidebarCollapsed ? "lg:hidden" : ""
            )}>{tenantName}</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-gray-700 dark:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <MaterialIcon name="menu" size="md" />
          </Button>
        </div>

        {/* Collapse/Expand button - Desktop only, at top */}
        <div className={cn(
          "flex-shrink-0 px-3 py-2 hidden lg:block",
          sidebarCollapsed && "lg:px-2"
        )}>
          <button
            onClick={toggleSidebarCollapsed}
            className={cn(
              "w-full flex items-center justify-center p-2 rounded-xl text-sm font-medium transition-colors",
              "text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-white/70 dark:hover:text-white dark:hover:bg-white/10",
            )}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <MaterialIcon name="menu" size="md" />
          </button>
        </div>

        {/* Scrollable Nav */}
        <nav className={cn(
          "flex-1 overflow-y-auto p-3 space-y-1",
          sidebarCollapsed && "lg:p-2"
        )}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedNavItems.map((item) => item.href)}
              strategy={verticalListSortingStrategy}
            >
              {sortedNavItems.map((item) => (
                <SortableNavItem
                  key={item.href}
                  item={item}
                  isActive={
                    location.pathname === item.href ||
                    (item.href === '/shipments' && location.pathname.startsWith('/incoming'))
                  }
                  sidebarCollapsed={sidebarCollapsed}
                  onNavigate={() => setSidebarOpen(false)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </nav>

        {/* Fixed Footer - Avatar only */}
        <div className={cn(
          "flex-shrink-0 border-t border-gray-200 dark:border-slate-700 p-2",
          sidebarCollapsed && "lg:p-2"
        )}>
          {/* User Avatar/Profile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "w-full flex items-center gap-3 p-2 rounded-xl transition-colors",
                  "hover:bg-gray-100 dark:hover:bg-slate-800",
                  sidebarCollapsed && "lg:justify-center"
                )}
              >
                <AvatarWithPresence
                  status={profile?.id ? getUserStatus(profile.id) : 'offline'}
                  indicatorSize="sm"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                      {getInitials()}
                    </AvatarFallback>
                  </Avatar>
                </AvatarWithPresence>
                {!sidebarCollapsed && (
                  <span className="text-sm font-medium text-gray-900 dark:text-white lg:block hidden truncate">
                    {profile?.first_name} {profile?.last_name}
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {profile?.first_name} {profile?.last_name}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {profile?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isReallyAdminDev && (
                <>
                  <DropdownMenuItem onClick={() => setTenantSwitcherOpen(true)}>
                    <MaterialIcon name="shield_person" size="sm" className="mr-2" />
                    <span>Switch Tenant</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {canSeeInAppAlertSelfToggle && (
                <>
                  <DropdownMenuCheckboxItem
                    checked={inAppAlertsEnabled}
                    disabled={inAppPreferenceLoading || inAppPreferenceSaving}
                    onCheckedChange={(checked) => void handleToggleInAppAlerts(checked === true)}
                  >
                    In-app alert notifications
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={handleSignOut}>
                <MaterialIcon name="logout" size="sm" className="mr-2" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <div className={cn(
        "flex flex-col flex-1 min-h-0 transition-all duration-300",
        sidebarCollapsed ? "lg:pl-16" : "lg:pl-52"
      )}>
        {/* Header - Auto-hides on scroll */}
        <header className={cn(
          "sticky top-0 z-30 shrink-0 bg-card border-b flex items-center px-4 lg:px-6 pt-safe h-[calc(3rem+env(safe-area-inset-top,0px))] transition-transform duration-300 relative",
          !headerVisible && "-translate-y-full"
        )}>
          <AppleBanner />
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-9 w-9"
            onClick={() => setSidebarOpen(true)}
          >
            <MaterialIcon name="menu" size="md" />
          </Button>

          <div className="flex-1" />

          {/* Right side controls */}
          <div className="flex items-center gap-1">
            {/* Theme toggle pill */}
            <button
              onClick={() => setIsDark(!isDark)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="relative flex items-center h-8 w-16 rounded-full bg-gray-200 dark:bg-slate-700 p-1 transition-colors duration-300"
            >
              <span
                className={cn(
                  "absolute h-6 w-6 rounded-full bg-white dark:bg-slate-300 shadow-md flex items-center justify-center transition-transform duration-300",
                  isDark ? "translate-x-8" : "translate-x-0"
                )}
              >
                <MaterialIcon name={isDark ? 'dark_mode' : 'light_mode'} className="text-[14px] text-gray-700" />
              </span>
            </button>

            {/* Notifications */}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 relative"
              onClick={() => navigate('/messages?inbox=messages')}
              title="Messages & Notifications"
            >
              <MaterialIcon name="notifications" size="md" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center h-5 min-w-[20px] px-1.5 text-[10px] font-bold bg-red-500 text-white rounded-full animate-pulse">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Button>
          </div>
        </header>

        {/* Upgrade notification banner */}
        <UpgradeNotificationBanner />

        {/* Page content - scrollable with extra bottom padding for full scrolling */}
        <main
          className="flex-1 overflow-y-auto p-4 pb-48 lg:p-6 lg:pb-48 animate-fade-in"
          onTouchStart={handleEdgeSwipeTouchStart}
          onTouchMove={handleEdgeSwipeTouchMove}
          onTouchEnd={handleEdgeSwipeTouchEnd}
          onTouchCancel={handleEdgeSwipeTouchEnd}
        >
          {children}
        </main>

        <HelpToolRuntimeLayer />

        {/* Global (internal) prompt: resume paused task after job switch */}
        <ResumePausedTaskPrompt />

        {/* Offline timer queue + background sync */}
        <TimerOfflineSyncManager />
      </div>
    </div>
  );
}
