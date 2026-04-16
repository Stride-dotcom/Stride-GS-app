import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { HelpTip } from '@/components/ui/help-tip';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { CreateContainerDialog } from '@/components/containers/CreateContainerDialog';
import { ScanToContainerDialog } from '@/components/containers/ScanToContainerDialog';
import { PrintContainerLabelsDialog } from '@/components/containers/PrintContainerLabelsDialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useContainersAtLocation } from '@/hooks/useContainersAtLocation';
import { useUnitsAtLocation, type UnitFilters } from '@/hooks/useUnitsAtLocation';
import { useLocationCapacity } from '@/hooks/useLocationCapacity';
import { useOrgPreferences, type InventoryGroupMode, type InventoryLineFormat } from '@/hooks/useOrgPreferences';
import { useContainerActions } from '@/hooks/useContainerActions';
import type { Database } from '@/integrations/supabase/types';
import type { ContainerLabelData } from '@/lib/labelGenerator';
import {
  DISPLAY_LOCATION_TYPE_BADGE_COLORS,
  getLocationTypeLabel,
  normalizeLocationType,
  parseDisplayLocationType,
} from '@/lib/locationTypeUtils';

type LocationRow = Database['public']['Tables']['locations']['Row'];

export default function LocationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [location, setLocation] = useState<LocationRow | null>(null);
  const [warehouseName, setWarehouseName] = useState<string>('');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [pageLoading, setPageLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [containerFilter, setContainerFilter] = useState<string>('');
  const [createContainerOpen, setCreateContainerOpen] = useState(false);
  const [scanContainerId, setScanContainerId] = useState<string | null>(null);
  const [scanContainerCode, setScanContainerCode] = useState<string>('');
  const [printOpen, setPrintOpen] = useState(false);
  const [printContainers, setPrintContainers] = useState<ContainerLabelData[]>([]);

  // Container unit counts (fetched separately for display)
  const [containerUnitCounts, setContainerUnitCounts] = useState<Record<string, number>>({});

  const { containers, loading: containersLoading, refetch: refetchContainers } = useContainersAtLocation(id);
  const { moveContainer } = useContainerActions();

  const unitFilters: UnitFilters = useMemo(() => ({
    search: search || undefined,
    status: statusFilter && statusFilter !== 'all' ? statusFilter : undefined,
    containerId: containerFilter && containerFilter !== 'all' ? containerFilter : undefined,
  }), [search, statusFilter, containerFilter]);

  const { units, loading: unitsLoading, refetch: refetchUnits } = useUnitsAtLocation(id, unitFilters);
  const { capacity, loading: capacityLoading, fetchCapacity } = useLocationCapacity(id);
  const { preferences, updatePreference } = useOrgPreferences();

  useEffect(() => {
    if (id) {
      fetchLocation(id);
      fetchCapacity(id);
    }
  }, [id]);

  // Fetch container unit counts when containers change
  useEffect(() => {
    if (containers.length > 0) {
      fetchContainerUnitCounts();
    }
  }, [containers]);

  const fetchContainerUnitCounts = async () => {
    if (!id) return;
    try {
      const { data, error } = await (supabase.from('items') as any)
        .select('metadata')
        .eq('current_location_id', id)
        .is('deleted_at', null);

      if (error) throw error;

      const counts: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        const meta = row?.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : null;
        const containerId =
          meta && typeof meta.container_id === 'string' && meta.container_id.trim().length > 0
            ? meta.container_id
            : null;
        if (containerId) {
          counts[containerId] = (counts[containerId] || 0) + 1;
        }
      });
      setContainerUnitCounts(counts);
    } catch (error) {
      console.error('Error fetching container unit counts:', error);
    }
  };

  const fetchLocation = async (locationId: string) => {
    try {
      setPageLoading(true);
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('id', locationId)
        .single();

      if (error) throw error;
      setLocation(data);

      // Fetch warehouse name
      if (data.warehouse_id) {
        setWarehouseId(data.warehouse_id);
        const { data: wh } = await supabase
          .from('warehouses')
          .select('name')
          .eq('id', data.warehouse_id)
          .single();
        setWarehouseName(wh?.name || '');
      }

    } catch (error) {
      console.error('Error fetching location:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load location details.',
      });
      navigate('/settings');
    } finally {
      setPageLoading(false);
    }
  };

  const getTypeBadge = (type: string) => {
    const normalizedType = normalizeLocationType(type);
    return (
      <Badge variant="outline" className={DISPLAY_LOCATION_TYPE_BADGE_COLORS[normalizedType]}>
        {getLocationTypeLabel(type)}
      </Badge>
    );
  };

  const getDisplayType = (value: LocationRow): string => {
    if (parseDisplayLocationType(value.type)) {
      return value.type;
    }
    if (parseDisplayLocationType(value.location_type)) {
      return value.location_type as string;
    }
    return value.type;
  };

  const formatLocationDisplay = (containerCode: string | null) => {
    if (!location) return '';
    if (containerCode) {
      return `${location.code} (in ${containerCode})`;
    }
    return location.code;
  };

  const handleRefreshAll = () => {
    refetchContainers();
    refetchUnits();
    fetchContainerUnitCounts();
    if (id) fetchCapacity(id);
  };

  if (pageLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!location) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Location not found.</p>
          <Button variant="link" onClick={() => navigate('/settings')}>
            Back to Settings
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const utilizationPct = capacity?.utilization_pct ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Link to="/settings" className="hover:underline">Settings</Link>
              <MaterialIcon name="chevron_right" size="sm" />
              <span>Locations</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">
                <code className="bg-muted px-2 py-0.5 rounded">{location.code}</code>
              </h1>
              {getTypeBadge(getDisplayType(location))}
              <StatusIndicator status={location.status} size="sm" />
            </div>
            {location.name && (
              <p className="text-muted-foreground mt-1">{location.name}</p>
            )}
            {warehouseName && (
              <p className="text-sm text-muted-foreground">Warehouse: {warehouseName}</p>
            )}
          </div>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
            Back
          </Button>
        </div>

        {/* Capacity Panel */}
        {preferences.space_tracking_mode !== 'none' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                <HelpTip
                  tooltip="Shows the volume utilization of this location based on inventory items and containers stored here. Calculated using the org-level capacity mode (bounded footprint or units-only)."
                  pageKey="locations.detail"
                  fieldKey="volume_utilization"
                >
                  Capacity Utilization
                </HelpTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {capacityLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                  Loading capacity data...
                </div>
              ) : capacity ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Used (cu ft)</p>
                      <p className="text-lg font-semibold">
                        {capacity.used_cu_ft != null ? capacity.used_cu_ft.toFixed(1) : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Capacity (cu ft)</p>
                      <p className="text-lg font-semibold">
                        {capacity.capacity_cu_ft != null ? capacity.capacity_cu_ft.toFixed(1) : 'Not set'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Capacity (sq ft)</p>
                      <p className="text-lg font-semibold">
                        {location.capacity_sq_ft != null ? Number(location.capacity_sq_ft).toFixed(1) : 'Not set'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Utilization</p>
                      <p className="text-lg font-semibold">
                        {utilizationPct != null ? `${utilizationPct.toFixed(1)}%` : 'N/A'}
                      </p>
                    </div>
                  </div>
                  {/* Utilization Bar */}
                  {utilizationPct != null && (
                    <div className="space-y-1">
                      <Progress
                        value={Math.min(utilizationPct, 100)}
                        className="h-2"
                      />
                      {utilizationPct > 90 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          This location is {utilizationPct >= 100 ? 'at or over' : 'near'} capacity.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No capacity data available.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="containers">
          <TabsList>
            <TabsTrigger value="containers">
              Containers ({containers.length})
            </TabsTrigger>
            <TabsTrigger value="inventory">
              Inventory ({units.length})
            </TabsTrigger>
          </TabsList>

          {/* Containers Tab */}
          <TabsContent value="containers" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      <HelpTip
                        tooltip="Containers currently located at this storage location. Move containers between locations to relocate all their contents at once."
                        pageKey="locations.detail"
                        fieldKey="containers_at_location"
                      >
                        Containers at Location
                      </HelpTip>
                    </CardTitle>
                    <CardDescription>
                      {containers.length} container{containers.length !== 1 ? 's' : ''} at this location
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCreateContainerOpen(true)}
                    >
                      <MaterialIcon name="add" size="sm" className="mr-1" />
                      Create Container
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {containersLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                  </div>
                ) : containers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No containers at this location.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Footprint</TableHead>
                        <TableHead className="w-[120px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {containers.map((container) => (
                        <TableRow key={container.id}>
                          <TableCell className="font-medium">
                            <Link
                              to={`/containers/${container.id}`}
                              className="text-primary hover:underline"
                            >
                              <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                                {container.container_code}
                              </code>
                            </Link>
                          </TableCell>
                          <TableCell>{container.container_type || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {containerUnitCounts[container.id] || 0}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <StatusIndicator status={container.status} size="sm" />
                          </TableCell>
                          <TableCell>
                            {container.footprint_cu_ft != null
                              ? `${container.footprint_cu_ft} cu ft`
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title={
                                  container.status === 'active'
                                    ? 'Scan units into container'
                                    : 'Container must be active to add units'
                                }
                                disabled={container.status !== 'active'}
                                onClick={() => {
                                  setScanContainerId(container.id);
                                  setScanContainerCode(container.container_code);
                                }}
                              >
                                <MaterialIcon name="qr_code_scanner" size="sm" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Print container label"
                                onClick={() => {
                                  setPrintContainers([
                                    {
                                      id: container.id,
                                      containerCode: container.container_code,
                                      containerType: container.container_type,
                                      warehouseName: warehouseName || null,
                                      locationCode: location?.code || null,
                                    },
                                  ]);
                                  setPrintOpen(true);
                                }}
                              >
                                <MaterialIcon name="print" size="sm" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => navigate(`/containers/${container.id}`)}
                                title="Open container detail"
                              >
                                <MaterialIcon name="open_in_new" size="sm" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      <HelpTip
                        tooltip="All inventory items physically present at this location, whether in containers or loose. Based on item current_location_id plus container metadata links."
                        pageKey="locations.detail"
                        fieldKey="inventory_units"
                      >
                        Inventory Items
                      </HelpTip>
                    </CardTitle>
                    <CardDescription>
                      {units.length} item{units.length !== 1 ? 's' : ''} at this location
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Input
                    placeholder="Search item code, vendor, description..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-xs"
                  />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="released">Released</SelectItem>
                      <SelectItem value="disposed">Disposed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={containerFilter} onValueChange={setContainerFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All containers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All containers</SelectItem>
                      {containers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.container_code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2 mt-2 items-center">
                  <HelpTip
                    tooltip="Group items by shared attribute. View-only — does not affect data."
                    pageKey="locations.detail"
                    fieldKey="group_by"
                  >
                    <span className="text-xs font-medium text-muted-foreground">Group by:</span>
                  </HelpTip>
                  <Select
                    value={preferences.inventory_group_mode}
                    onValueChange={(v) => updatePreference('inventory_group_mode', v as InventoryGroupMode)}
                  >
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="description">Description</SelectItem>
                      <SelectItem value="container">Container</SelectItem>
                    </SelectContent>
                  </Select>
                  <HelpTip
                    tooltip="Switch between detailed table rows and a compact single-line format."
                    pageKey="locations.detail"
                    fieldKey="view_mode"
                  >
                    <span className="text-xs font-medium text-muted-foreground">Format:</span>
                  </HelpTip>
                  <Select
                    value={preferences.inventory_line_format}
                    onValueChange={(v) => updatePreference('inventory_line_format', v as InventoryLineFormat)}
                  >
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Table</SelectItem>
                      <SelectItem value="single_line">Single Line</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {unitsLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                  </div>
                ) : units.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No inventory items at this location.
                  </p>
                ) : preferences.inventory_line_format === 'single_line' ? (
                    /* ── Single-line compact format ── */
                    <div className="rounded-md border max-h-[600px] overflow-auto">
                      {(() => {
                        const groupMode = preferences.inventory_group_mode;
                        const grouped = groupMode === 'none'
                          ? { '': units }
                          : units.reduce<Record<string, typeof units>>((acc, u) => {
                              const key = groupMode === 'container'
                                ? (u.container_code || 'Uncontained')
                                : (u.description || 'No Description');
                              (acc[key] = acc[key] || []).push(u);
                              return acc;
                            }, {});
                        const sortedKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
                        return (
                          <div className="divide-y">
                            {sortedKeys.map((groupKey) => (
                              <div key={groupKey}>
                                {groupMode !== 'none' && (
                                  <div className="px-3 py-1.5 bg-muted/50 text-xs font-semibold text-muted-foreground sticky top-0">
                                    {groupKey} ({grouped[groupKey].length})
                                  </div>
                                )}
                                {grouped[groupKey].map((unit) => (
                                  <div key={unit.id} className="px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-muted/30">
                                    <code className="bg-muted px-1 py-0.5 rounded text-xs font-medium">{unit.item_code}</code>
                                    <span className="text-muted-foreground">•</span>
                                    <StatusIndicator status={unit.status} size="sm" />
                                    <span className="text-muted-foreground">•</span>
                                    <span className="text-xs text-muted-foreground">{formatLocationDisplay(unit.container_code)}</span>
                                    {unit.vendor && (
                                      <>
                                        <span className="text-muted-foreground">•</span>
                                        <span className="text-xs truncate max-w-[120px]">{unit.vendor}</span>
                                      </>
                                    )}
                                    {unit.description && (
                                      <>
                                        <span className="text-muted-foreground">•</span>
                                        <span className="text-xs truncate max-w-[180px] text-muted-foreground">{unit.description}</span>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    /* ── Default table format ── */
                    <div className="rounded-md border max-h-[600px] overflow-auto">
                      {(() => {
                        const groupMode = preferences.inventory_group_mode;
                        const grouped = groupMode === 'none'
                          ? { '': units }
                          : units.reduce<Record<string, typeof units>>((acc, u) => {
                              const key = groupMode === 'container'
                                ? (u.container_code || 'Uncontained')
                                : (u.description || 'No Description');
                              (acc[key] = acc[key] || []).push(u);
                              return acc;
                            }, {});
                        const sortedKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
                        return sortedKeys.map((groupKey) => (
                          <div key={groupKey}>
                            {groupMode !== 'none' && (
                              <div className="px-3 py-2 bg-muted/50 text-xs font-semibold text-muted-foreground border-b">
                                {groupKey} ({grouped[groupKey].length})
                              </div>
                            )}
                            <Table>
                              {groupKey === sortedKeys[0] && (
                                <TableHeader className="sticky top-0 bg-background">
                                  <TableRow>
                                    <TableHead>Item Code</TableHead>
                                    <TableHead>Vendor</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Class</TableHead>
                                    <TableHead>Location</TableHead>
                                    <TableHead>Volume</TableHead>
                                  </TableRow>
                                </TableHeader>
                              )}
                              <TableBody>
                                {grouped[groupKey].map((unit) => (
                                  <TableRow key={unit.id}>
                                    <TableCell className="font-medium">
                                      <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                                        {unit.item_code}
                                      </code>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {unit.vendor || '—'}
                                    </TableCell>
                                    <TableCell className="text-sm max-w-[200px] truncate">
                                      {unit.description || '—'}
                                    </TableCell>
                                    <TableCell>
                                      <StatusIndicator status={unit.status} size="sm" />
                                    </TableCell>
                                    <TableCell>{unit.class_code || '—'}</TableCell>
                                    <TableCell className="text-sm">
                                      {formatLocationDisplay(unit.container_code)}
                                    </TableCell>
                                    <TableCell>
                                      {unit.size_cu_ft != null ? `${unit.size_cu_ft} cu ft` : '—'}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ));
                      })()}
                    </div>
                  )}

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Container Dialog */}
      <CreateContainerDialog
        open={createContainerOpen}
        onOpenChange={setCreateContainerOpen}
        warehouseId={warehouseId}
        locationId={id}
        onSuccess={handleRefreshAll}
      />

      <PrintContainerLabelsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        containers={printContainers}
      />

      {/* Scan to Container Dialog */}
      {scanContainerId && (
        <ScanToContainerDialog
          open={!!scanContainerId}
          onOpenChange={(open) => {
            if (!open) {
              setScanContainerId(null);
              setScanContainerCode('');
            }
          }}
          containerId={scanContainerId}
          containerCode={scanContainerCode}
          onSuccess={handleRefreshAll}
        />
      )}
    </DashboardLayout>
  );
}
