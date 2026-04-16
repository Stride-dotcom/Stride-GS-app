import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useLocations, Location } from '@/hooks/useLocations';
import { useUsers } from '@/hooks/useUsers';
import { usePermissions } from '@/hooks/usePermissions';
import { LocationsSettingsTab } from '@/components/settings/LocationsSettingsTab';
import { LocationDialog } from '@/components/locations/LocationDialog';
import { PrintLabelsDialog } from '@/components/locations/PrintLabelsDialog';
import { CSVImportDialog } from '@/components/settings/CSVImportDialog';
import { WarehouseList } from '@/components/warehouses/WarehouseList';
import { WarehouseDialog } from '@/components/warehouses/WarehouseDialog';
import { UserList } from '@/components/settings/UserList';
import { UserDialog } from '@/components/settings/UserDialog';
import { InviteUserDialog } from '@/components/settings/InviteUserDialog';
// Removed: ItemTypesSettingsTab, RateSheetsSettingsTab, BillableServicesSettingsTab - using unified service_events pricing
// Removed: EmployeesSettingsTab - employee functionality consolidated into Users tab
import { OrganizationSettingsTab } from '@/components/settings/OrganizationSettingsTab';
import { ServiceRatesConsole } from '@/components/settings/ServiceRatesConsole';

import { AlertsSettingsTab } from '@/components/settings/AlertsSettingsTab';
import { IntegrationsSettingsTab } from '@/components/settings/IntegrationsSettingsTab';
import { OperationsSettingsTab } from '@/components/settings/OperationsSettingsTab';
import { QATestConsoleTab } from '@/components/settings/QATestConsoleTab';
import { OnboardingChecklistTab } from '@/components/settings/OnboardingChecklistTab';
import { DevConsoleSettingsTab } from '@/components/settings/DevConsoleSettingsTab';
import packageJson from '../../package.json';
import { cn } from '@/lib/utils';
import { isUsernameFormatValid, normalizeUsernameInput, USERNAME_FORMAT_HINT } from '@/lib/users/username';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
}

type SettingsTabVisibility = 'all' | 'admin' | 'admin_dev';

const TAB_OPTIONS = [
  { value: 'onboarding', label: 'Onboarding', visibility: 'admin' as const },
  { value: 'profile', label: 'Profile', visibility: 'all' as const },
  { value: 'organization', label: 'Organization', visibility: 'all' as const },
  { value: 'alerts', label: 'Alerts', visibility: 'all' as const },
  { value: 'operations', label: 'Users', visibility: 'admin' as const },
  { value: 'service-rates', label: 'Service Rates', visibility: 'admin' as const },
  { value: 'integrations', label: 'Integrations', visibility: 'admin' as const },
  { value: 'dev-console', label: 'Dev Console', visibility: 'admin_dev' as const },
  { value: 'warehouses', label: 'Warehouses', visibility: 'all' as const },
  { value: 'locations', label: 'Locations', visibility: 'all' as const },
  { value: 'qa', label: 'QA Tests', visibility: 'admin' as const },
];

type TabOption = (typeof TAB_OPTIONS)[number];

function SortableTabRow({ tab, disabled }: { tab: TabOption; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.value,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
    >
      <button
        type="button"
        className={cn(
          "cursor-grab touch-none text-muted-foreground hover:text-foreground",
          disabled && "cursor-default opacity-40"
        )}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        disabled={disabled}
      >
        <MaterialIcon name="drag_indicator" size="sm" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{tab.label}</div>
      </div>
      {tab.visibility !== 'all' && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {tab.visibility === 'admin' ? 'Admin' : 'Admin Dev'}
        </span>
      )}
    </div>
  );
}

export default function Settings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'profile');
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [profileData, setProfileData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: '',
  });
  const [originalUsername, setOriginalUsername] = useState('');
  const [usernameIsManual, setUsernameIsManual] = useState(false);

  // Locations state
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<string | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedLocationsForPrint, setSelectedLocationsForPrint] = useState<Location[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvImportDialogOpen, setCsvImportDialogOpen] = useState(false);

  // Warehouse state
  const [warehouseDialogOpen, setWarehouseDialogOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<string | null>(null);

  // User state
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const { warehouses, loading: warehousesLoading, refetch: refetchWarehouses } = useWarehouses();
  const { locations, loading: locationsLoading, refetch: refetchLocations } = useLocations(
    selectedWarehouse === 'all' ? undefined : selectedWarehouse
  );
  const {
    users,
    roles,
    loading: usersLoading,
    refetch: refetchUsers,
    deleteUser,
    assignRole,
    removeRole,
    updatePromptLevel,
    resendInvite,
    revokeAccess,
  } = useUsers();
  const { isAdmin: isPermissionsAdmin, isAdminDev, hasRole } = usePermissions();
  const isAdmin = isPermissionsAdmin || hasRole('billing_manager');

  const settingsTabOrderKey = useMemo(() => {
    if (!profile?.id) return null;
    return `stride.settingsTabOrder.${profile.id}`;
  }, [profile?.id]);

  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const skipNextTabOrderPersistRef = useRef(false);
  const [reorderTabsOpen, setReorderTabsOpen] = useState(false);

  // Load saved tab order per user
  useEffect(() => {
    if (!settingsTabOrderKey) return;
    // Prevent overwriting the saved value with the initial `[]` before this effect's state update lands.
    skipNextTabOrderPersistRef.current = true;
    const saved = localStorage.getItem(settingsTabOrderKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setTabOrder(parsed.filter((v) => typeof v === 'string'));
      }
    } catch {
      // ignore
    }
  }, [settingsTabOrderKey]);

  // Persist tab order per user
  useEffect(() => {
    if (!settingsTabOrderKey) return;
    if (skipNextTabOrderPersistRef.current) {
      skipNextTabOrderPersistRef.current = false;
      return;
    }
    localStorage.setItem(settingsTabOrderKey, JSON.stringify(tabOrder));
  }, [settingsTabOrderKey, tabOrder]);

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchSettingsData();
    }
  }, [profile?.tenant_id]);

  // Handle URL parameters for QBO callback
  useEffect(() => {
    const tab = searchParams.get('tab');
    const qboStatus = searchParams.get('qbo');
    const message = searchParams.get('message');

    if (tab) {
      setActiveTab(tab);
    }

    if (qboStatus === 'connected') {
      toast({
        title: 'QuickBooks Connected',
        description: 'Your QuickBooks account has been successfully connected.',
      });
      // Clean up URL params
      searchParams.delete('qbo');
      setSearchParams(searchParams, { replace: true });
    } else if (qboStatus === 'error') {
      toast({
        title: 'QuickBooks Connection Failed',
        description: message || 'Failed to connect to QuickBooks. Please try again.',
        variant: 'destructive',
      });
      // Clean up URL params
      searchParams.delete('qbo');
      searchParams.delete('message');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  useEffect(() => {
    if (profile) {
      setProfileData({
        firstName: profile.first_name || '',
        lastName: profile.last_name || '',
        email: profile.email || '',
        username: (profile as any).username || '',
      });
      setOriginalUsername((profile as any).username || '');
      setUsernameIsManual(Boolean((profile as any).username_is_manual));
    }
  }, [profile]);

  const fetchSettingsData = async () => {
    if (!profile?.tenant_id) return;

    try {
      // Fetch tenant info
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('id, name, slug, status')
        .eq('id', profile.tenant_id)
        .single();

      if (tenantData) setTenant(tenantData);

      if (profile?.id && profile?.tenant_id) {
        const { data: userData, error: userError } = await (supabase as any)
          .from('users')
          .select('username, username_is_manual')
          .eq('id', profile.id)
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .maybeSingle();
        if (!userError) {
          const loadedUsername = (userData?.username as string | null) || '';
          setProfileData((prev) => ({
            ...prev,
            username: loadedUsername,
          }));
          setOriginalUsername(loadedUsername);
          setUsernameIsManual(Boolean((userData as any)?.username_is_manual));
        }
      }
    } catch (error) {
      console.error('Error fetching settings data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile?.id || !profile?.tenant_id) return;

    setSaving(true);
    try {
      const requestedUsername = profileData.username.trim();
      const normalizedUsername = normalizeUsernameInput(requestedUsername);
      const existingUsername = normalizeUsernameInput(originalUsername || '');
      const usernameChanged = normalizedUsername !== existingUsername;
      const nextUsernameIsManual = normalizedUsername
        ? (usernameChanged ? true : usernameIsManual)
        : false;

      if (requestedUsername && !normalizedUsername) {
        toast({
          variant: 'destructive',
          title: 'Invalid username',
          description: USERNAME_FORMAT_HINT,
        });
        return;
      }

      if (normalizedUsername && !isUsernameFormatValid(normalizedUsername)) {
        toast({
          variant: 'destructive',
          title: 'Invalid username',
          description: USERNAME_FORMAT_HINT,
        });
        return;
      }

      if (normalizedUsername) {
        const { data: existingUsernameOwner, error: usernameCheckError } = await (supabase as any)
          .from('users')
          .select('id')
          .eq('tenant_id', profile.tenant_id)
          .eq('username', normalizedUsername)
          .is('deleted_at', null)
          .neq('id', profile.id)
          .limit(1)
          .maybeSingle();

        if (usernameCheckError) throw usernameCheckError;
        if (existingUsernameOwner?.id) {
          toast({
            variant: 'destructive',
            title: 'Username unavailable',
            description: `@${normalizedUsername} is already in use.`,
          });
          return;
        }
      }

      const { error } = await (supabase as any)
        .from('users')
        .update({
          first_name: profileData.firstName,
          last_name: profileData.lastName,
          username: normalizedUsername || null,
          username_is_manual: nextUsernameIsManual,
        })
        .eq('id', profile.id);

      if (error) throw error;

      setProfileData((prev) => ({
        ...prev,
        username: normalizedUsername,
      }));
      setOriginalUsername(normalizedUsername);
      setUsernameIsManual(nextUsernameIsManual);

      toast({
        title: 'Profile Updated',
        description: 'Your profile has been successfully updated.',
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      if ((error as any)?.code === '23505') {
        toast({
          variant: 'destructive',
          title: 'Username unavailable',
          description: 'This username is already in use in your organization.',
        });
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: 'Failed to update your profile. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  // Location handlers
  const handleCreateLocation = () => {
    setEditingLocation(null);
    setLocationDialogOpen(true);
  };

  const handleEditLocation = (locationId: string) => {
    setEditingLocation(locationId);
    setLocationDialogOpen(true);
  };

  const handleLocationDialogClose = () => {
    setLocationDialogOpen(false);
    setEditingLocation(null);
  };

  const handleLocationSuccess = () => {
    handleLocationDialogClose();
    refetchLocations();
  };

  const handlePrintSelected = (selected: Location[]) => {
    setSelectedLocationsForPrint(selected);
    setPrintDialogOpen(true);
  };

  const handleImportCSV = (file: File) => {
    setCsvFile(file);
    setCsvImportDialogOpen(true);
  };

  const handleImportSuccess = () => {
    refetchLocations();
    setCsvImportDialogOpen(false);
    setCsvFile(null);
  };

  // Warehouse handlers
  const handleCreateWarehouse = () => {
    setEditingWarehouse(null);
    setWarehouseDialogOpen(true);
  };

  const handleEditWarehouse = (warehouseId: string) => {
    setEditingWarehouse(warehouseId);
    setWarehouseDialogOpen(true);
  };

  const handleWarehouseDialogClose = () => {
    setWarehouseDialogOpen(false);
    setEditingWarehouse(null);
  };

  const handleWarehouseSuccess = () => {
    handleWarehouseDialogClose();
    refetchWarehouses();
  };

  const baseVisibleTabs = useMemo(
    () => TAB_OPTIONS.filter((tab) => {
      const visibility: SettingsTabVisibility = tab.visibility;
      if (visibility === 'all') return true;
      if (visibility === 'admin') return isAdmin;
      return isAdminDev;
    }),
    [isAdmin, isAdminDev]
  );

  const visibleTabs = useMemo(() => {
    if (tabOrder.length === 0) return baseVisibleTabs;
    const map = new Map(baseVisibleTabs.map((t) => [t.value, t] as const));
    const ordered = tabOrder.map((v) => map.get(v)).filter(Boolean) as TabOption[];
    const remaining = baseVisibleTabs.filter((t) => !tabOrder.includes(t.value));
    return [...ordered, ...remaining];
  }, [baseVisibleTabs, tabOrder]);

  // If current tab becomes unavailable (e.g. role change), fall back to first visible tab.
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((t) => t.value === activeTab)) {
      setActiveTab(visibleTabs[0].value);
    }
  }, [visibleTabs, activeTab]);

  // Sync tab state to URL so back-button and deep-links work
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    next.delete('subtab');
    setSearchParams(next, { replace: true });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleTabReorder = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = visibleTabs.map((t) => t.value);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    setTabOrder(next);
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 px-2 sm:px-0">
        <div className="flex items-start justify-between">
          <PageHeader
            primaryText="System"
            accentText="Config"
            description="Manage your account and organization settings"
          />
          {/* TEMPORARY: Build stamp for mobile confirmation */}
          <div className="text-[10px] text-muted-foreground/60 text-right leading-tight shrink-0 mt-1 font-mono">
            <div>v{packageJson.version}</div>
            <div>{typeof __BUILD_TIMESTAMP__ !== 'undefined' ? __BUILD_TIMESTAMP__.replace('T', ' ').slice(0, 19) : 'dev'}</div>
            {typeof __COMMIT_HASH__ !== 'undefined' && __COMMIT_HASH__ && <div>{__COMMIT_HASH__}</div>}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          {/* Mobile: Dropdown navigation */}
          <div className="sm:hidden">
            <Select value={activeTab} onValueChange={handleTabChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select section" />
              </SelectTrigger>
              <SelectContent>
                {visibleTabs.map((tab) => (
                  <SelectItem key={tab.value} value={tab.value}>
                    {tab.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop: Tab navigation */}
          <TabsList className="hidden sm:flex flex-wrap h-auto gap-1">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Reorder tabs */}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setReorderTabsOpen(true)}
            >
              <MaterialIcon name="swap_vert" size="sm" />
              Reorder Tabs
            </Button>
          </div>

          {isAdmin && (
            <TabsContent value="onboarding">
              <OnboardingChecklistTab />
            </TabsContent>
          )}

          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Profile Settings</CardTitle>
                <CardDescription>
                  Update your personal information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={profileData.firstName}
                      onChange={(e) =>
                        setProfileData({ ...profileData, firstName: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={profileData.lastName}
                      onChange={(e) =>
                        setProfileData({ ...profileData, lastName: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={profileData.email} disabled />
                  <p className="text-sm text-muted-foreground">
                    Email cannot be changed from this page
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                    <Input
                      id="username"
                      value={profileData.username}
                      onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                      onBlur={(e) => {
                        const raw = e.target.value;
                        const normalized = normalizeUsernameInput(raw);
                        if (normalized !== raw) {
                          toast({ title: 'Username formatted', description: 'Special characters removed' });
                        }
                        setProfileData({ ...profileData, username: normalized });
                      }}
                      className="pl-8"
                      placeholder="first_last"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {USERNAME_FORMAT_HINT} Leave blank to use auto-generated.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setProfileData({ ...profileData, username: '' });
                      setUsernameIsManual(false);
                    }}
                  >
                    Reset to auto-generated
                  </Button>
                </div>
                <Separator />
                <Button onClick={handleSaveProfile} disabled={saving}>
                  {saving ? (
                    <>
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <MaterialIcon name="save" size="sm" className="mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="organization">
            <OrganizationSettingsTab />
          </TabsContent>

          <TabsContent value="alerts">
            <AlertsSettingsTab />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="operations">
              <OperationsSettingsTab
                usersContent={
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-medium flex items-center gap-2">
                          <MaterialIcon name="group" size="md" />
                          Users
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Manage users and their roles in your organization
                        </p>
                      </div>
                    </div>
                    <UserList
                      users={users}
                      roles={roles}
                      loading={usersLoading}
                      currentUserId={profile?.id}
                      onEdit={(userId) => {
                        setEditingUser(userId);
                        setUserDialogOpen(true);
                      }}
                      onDelete={deleteUser}
                      onRefresh={refetchUsers}
                      onInvite={() => setInviteDialogOpen(true)}
                    />
                  </div>
                }
              />
            </TabsContent>
          )}

          {/* Billing tab removed - charge templates moved to Rate Sheets */}

          {isAdmin && (
            <TabsContent value="service-rates">
              <ServiceRatesConsole />
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="integrations">
              <IntegrationsSettingsTab />
            </TabsContent>
          )}

          {isAdminDev && (
            <TabsContent value="dev-console">
              <DevConsoleSettingsTab />
            </TabsContent>
          )}

          {/* Removed: Sidemarks, Services, Rate Sheets, Classes tabs - consolidated or using unified service_events pricing system */}

          <TabsContent value="warehouses">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <MaterialIcon name="warehouse" size="md" />
                    Warehouses
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Manage your warehouse locations and configurations
                  </p>
                </div>
                <Button onClick={handleCreateWarehouse} className="w-full sm:w-auto">
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Add Warehouse
                </Button>
              </div>
              <WarehouseList
                warehouses={warehouses}
                loading={warehousesLoading}
                onEdit={handleEditWarehouse}
                onRefresh={refetchWarehouses}
              />
            </div>
          </TabsContent>

          <TabsContent value="locations">
            <LocationsSettingsTab
              locations={locations}
              warehouses={warehouses}
              loading={locationsLoading || warehousesLoading}
              selectedWarehouse={selectedWarehouse}
              onWarehouseChange={setSelectedWarehouse}
              onEdit={handleEditLocation}
              onCreate={handleCreateLocation}
              onRefresh={refetchLocations}
              onPrintSelected={handlePrintSelected}
              onImportCSV={handleImportCSV}
              onWarehouseRefresh={refetchWarehouses}
            />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="qa">
              <QATestConsoleTab />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Tab reorder dialog (persists locally per user) */}
      <Dialog open={reorderTabsOpen} onOpenChange={setReorderTabsOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Reorder Settings Tabs</DialogTitle>
            <DialogDescription>
              Drag tabs to change their order. This is saved for your user on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTabReorder}
            >
              <SortableContext
                items={visibleTabs.map((t) => t.value)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {visibleTabs.map((tab) => (
                    <SortableTabRow key={tab.value} tab={tab} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => setTabOrder([])}>
              Reset
            </Button>
            <Button type="button" onClick={() => setReorderTabsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Location Dialog */}
      <LocationDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        locationId={editingLocation}
        warehouses={warehouses}
        locations={locations}
        defaultWarehouseId={selectedWarehouse === 'all' ? undefined : selectedWarehouse}
        onSuccess={handleLocationSuccess}
      />

      {/* Print Labels Dialog */}
      <PrintLabelsDialog
        open={printDialogOpen}
        onOpenChange={setPrintDialogOpen}
        locations={selectedLocationsForPrint}
        warehouses={warehouses}
      />

      {/* CSV Import Dialog */}
      <CSVImportDialog
        open={csvImportDialogOpen}
        onOpenChange={setCsvImportDialogOpen}
        file={csvFile}
        warehouses={warehouses}
        onSuccess={handleImportSuccess}
      />

      {/* Warehouse Dialog */}
      <WarehouseDialog
        open={warehouseDialogOpen}
        onOpenChange={setWarehouseDialogOpen}
        warehouseId={editingWarehouse}
        onSuccess={handleWarehouseSuccess}
      />

      {/* User Dialog */}
      <UserDialog
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
        userId={editingUser}
        users={users}
        roles={roles}
        currentUserId={profile?.id}
        onSuccess={() => {
          setUserDialogOpen(false);
          setEditingUser(null);
          refetchUsers();
        }}
        onAssignRole={assignRole}
        onRemoveRole={removeRole}
        onUpdatePromptLevel={updatePromptLevel}
        onResendInvite={resendInvite}
        onRevokeAccess={revokeAccess}
      />

      {/* Invite User Dialog */}
      <InviteUserDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        roles={roles}
        onSuccess={() => {
          setInviteDialogOpen(false);
          refetchUsers();
        }}
      />
    </DashboardLayout>
  );
}
