import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { addAoaSheet, setColumnWidths, downloadWorkbook } from '@/lib/excelUtils';
import { Location } from '@/hooks/useLocations';
import { Warehouse } from '@/hooks/useWarehouses';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';
import { useWarehouseZones } from '@/hooks/useWarehouseZones';
import {
  DISPLAY_LOCATION_TYPE_BADGE_COLORS,
  getLocationTypeLabel,
  normalizeLocationType,
  parseDisplayLocationType,
} from '@/lib/locationTypeUtils';
import {
  LOCATION_LIST_COLUMNS,
  type LocationListColumnKey,
} from '@/lib/locationListColumns';

interface LocationsSettingsTabProps {
  locations: Location[];
  warehouses: Warehouse[];
  loading: boolean;
  selectedWarehouse: string;
  onWarehouseChange: (warehouseId: string) => void;
  onEdit: (locationId: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onPrintSelected: (locations: Location[]) => void;
  onImportCSV: (file: File) => void;
  onWarehouseRefresh?: () => void;
}

export function LocationsSettingsTab({
  locations,
  warehouses,
  loading,
  selectedWarehouse,
  onWarehouseChange,
  onEdit,
  onCreate,
  onRefresh,
  onPrintSelected,
  onImportCSV,
  onWarehouseRefresh,
}: LocationsSettingsTabProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // Zones (for zone assignment + filtering). Only enabled when a specific warehouse is selected.
  const zonesEnabled = selectedWarehouse && selectedWarehouse !== 'all';
  const { zones, loading: zonesLoading, refetch: refetchZones } = useWarehouseZones(
    zonesEnabled ? selectedWarehouse : undefined
  );
  const zoneIdToCode = useMemo(() => new Map(zones.map((z) => [z.id, z.zone_code])), [zones]);

  const [zoneFilterId, setZoneFilterId] = useState<string>('all'); // 'all' | 'unassigned' | <zoneId>
  const [savingZoneLocationId, setSavingZoneLocationId] = useState<string | null>(null);
  const { hasRole } = usePermissions();
  const canOpenMapBuilder = hasRole('admin') || hasRole('manager');
  const canOpenHeatMap = canOpenMapBuilder || hasRole('warehouse');
  const hasWarehouseSelected = !!selectedWarehouse && selectedWarehouse !== 'all';

  useEffect(() => {
    // Reset zone filter when warehouse scope changes.
    setZoneFilterId('all');
  }, [selectedWarehouse]);

  // Default shipment location state
  const [defaultRecvLocationId, setDefaultRecvLocationId] = useState<string>('');
  const [defaultOutboundLocationId, setDefaultOutboundLocationId] = useState<string>('');
  const [savingDefaultLocation, setSavingDefaultLocation] = useState(false);
  const [locationValidationErrors, setLocationValidationErrors] = useState<{ inbound?: string; outbound?: string }>({});

  // Persist warehouse filter per user + auto-select when only one warehouse exists
  useEffect(() => {
    if (!profile?.id) return;

    const saved = localStorage.getItem(`stride_location_view_${profile.id}`);
    if (saved && (saved === 'all' || warehouses.some(w => w.id === saved))) {
      onWarehouseChange(saved);
    } else if (warehouses.length === 1) {
      // Auto-select the only warehouse so the user doesn't have to pick it
      onWarehouseChange(warehouses[0].id);
      localStorage.setItem(`stride_location_view_${profile.id}`, warehouses[0].id);
    }
  }, [profile?.id, warehouses, onWarehouseChange]);

  const handleWarehouseFilterChange = useCallback((value: string) => {
    onWarehouseChange(value);
    if (profile?.id) {
      localStorage.setItem(`stride_location_view_${profile.id}`, value);
    }
  }, [onWarehouseChange, profile?.id]);

  // Sync default locations when warehouse selection changes
  useEffect(() => {
    if (selectedWarehouse && selectedWarehouse !== 'all') {
      const wh = warehouses.find(w => w.id === selectedWarehouse);
      setDefaultRecvLocationId((wh as any)?.default_receiving_location_id || '');
      setDefaultOutboundLocationId((wh as any)?.default_outbound_location_id || '');
    } else {
      setDefaultRecvLocationId('');
      setDefaultOutboundLocationId('');
    }
    setLocationValidationErrors({});
  }, [selectedWarehouse, warehouses]);

  const handleSaveDefaultLocations = async () => {
    if (!selectedWarehouse || selectedWarehouse === 'all') return;

    // Validate both fields are set
    const errors: { inbound?: string; outbound?: string } = {};
    if (!defaultRecvLocationId) {
      errors.inbound = 'Default shipment location is required';
    }
    if (!defaultOutboundLocationId) {
      errors.outbound = 'Default outbound location is required';
    }
    if (Object.keys(errors).length > 0) {
      setLocationValidationErrors(errors);
      return;
    }
    setLocationValidationErrors({});

    setSavingDefaultLocation(true);
    try {
      const { error } = await (supabase.from('warehouses') as any)
        .update({
          default_receiving_location_id: defaultRecvLocationId || null,
          default_outbound_location_id: defaultOutboundLocationId || null,
        })
        .eq('id', selectedWarehouse);

      if (error) throw error;

      toast({
        title: 'Default locations saved',
        description: 'Default shipment and outbound locations updated for this warehouse.',
      });
      onWarehouseRefresh?.();
    } catch (error: any) {
      console.error('Error saving default locations:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save default locations.',
      });
    } finally {
      setSavingDefaultLocation(false);
    }
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

  const activeLocationOptions = useMemo((): SelectOption[] => {
    const opts = locations
      .filter((l) => (l as any).is_active !== false)
      .map((loc) => ({
        value: loc.id,
        label: loc.code,
        subtitle: loc.name || undefined,
      }));

    // Keep the existing "None" sentinel to preserve behavior.
    return [{ value: '_none_', label: 'None (no default)' }, ...opts];
  }, [locations]);

  // Filter locations
  const filteredLocations = locations.filter((loc) => {
    // Filter by search
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      const matches = 
        loc.code.toLowerCase().includes(query) ||
        (loc.name && loc.name.toLowerCase().includes(query));
      if (!matches) return false;
    }
    
    // Filter archived (using is_active if available, fallback to status)
    const isActive = (loc as any).is_active !== false;
    if (!showArchived && !isActive) return false;
    if (showArchived && isActive) return false;

    // Zone filter (only when scoped to a specific warehouse and zones exist)
    if (zonesEnabled && zones.length > 0) {
      if (zoneFilterId === 'unassigned') {
        if (loc.zone_id) return false;
      } else if (zoneFilterId !== 'all') {
        if (loc.zone_id !== zoneFilterId) return false;
      }
    }
    
    return true;
  });

  const handleDeleteClick = (location: Location) => {
    setLocationToDelete(location);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!locationToDelete) return;

    try {
      setDeleting(true);
      const { error } = await supabase
        .from('locations')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', locationToDelete.id);

      if (error) throw error;

      toast({
        title: 'Location deleted',
        description: `${locationToDelete.code} has been deleted.`,
      });
      onRefresh();
    } catch (error) {
      console.error('Error deleting location:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete location.',
      });
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setLocationToDelete(null);
    }
  };

  const handleArchive = async (location: Location) => {
    try {
      const { error } = await supabase
        .from('locations')
        .update({ is_active: false } as any)
        .eq('id', location.id);

      if (error) throw error;

      toast({
        title: 'Location archived',
        description: `${location.code} has been archived.`,
      });
      onRefresh();
    } catch (error) {
      console.error('Error archiving location:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to archive location.',
      });
    }
  };

  const handleRestore = async (location: Location) => {
    try {
      const { error } = await supabase
        .from('locations')
        .update({ is_active: true } as any)
        .eq('id', location.id);

      if (error) throw error;

      toast({
        title: 'Location restored',
        description: `${location.code} has been restored.`,
      });
      onRefresh();
    } catch (error) {
      console.error('Error restoring location:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to restore location.',
      });
    }
  };

  const handleUpdateLocationZone = async (locationId: string, zoneId: string | null) => {
    try {
      setSavingZoneLocationId(locationId);
      const { error } = await supabase
        .from('locations')
        .update({ zone_id: zoneId } as any)
        .eq('id', locationId);

      if (error) throw error;
      onRefresh();
    } catch (error) {
      console.error('Error updating location zone:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update zone assignment.',
      });
    } finally {
      setSavingZoneLocationId(null);
    }
  };

  const handleBulkAssignZone = async (zoneId: string | null) => {
    if (!zonesEnabled) {
      toast({
        variant: 'destructive',
        title: 'Select a warehouse',
        description: 'Filter to a specific warehouse before assigning zones.',
      });
      return;
    }
    if (selectedIds.size === 0) return;

    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from('locations')
        .update({ zone_id: zoneId } as any)
        .in('id', ids);

      if (error) throw error;

      toast({
        title: 'Zones updated',
        description: `Updated ${ids.length} location${ids.length === 1 ? '' : 's'}.`,
      });
      setSelectedIds(new Set());
      onRefresh();
      refetchZones();
    } catch (error) {
      console.error('Error bulk assigning zone:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to bulk-assign zone.',
      });
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLocations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLocations.map((l) => l.id)));
    }
  };

  const handlePrintSelected = () => {
    const selected = locations.filter((l) => selectedIds.has(l.id));
    onPrintSelected(selected);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportCSV(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownloadTemplate = async () => {
    const headerRow = LOCATION_LIST_COLUMNS.map((column) => column.label);
    const exampleRow = LOCATION_LIST_COLUMNS.map((column) => column.templateExample);
    const blankRow = LOCATION_LIST_COLUMNS.map(() => '');

    const workbook = new ExcelJS.Workbook();
    const worksheet = addAoaSheet(workbook, [headerRow, exampleRow, blankRow], 'Locations');
    setColumnWidths(worksheet, LOCATION_LIST_COLUMNS.map(() => 18));

    await downloadWorkbook(workbook, 'locations-template.xlsx');
  };

  const handleExportLocations = async () => {
    const headerRow = LOCATION_LIST_COLUMNS.map((column) => column.label);
    const dataRows = filteredLocations.map((location) => {
      const warehouse = warehouseMap.get(location.warehouse_id);
      const isActive = (location as any).is_active !== false;
      return LOCATION_LIST_COLUMNS.map((column) =>
        getLocationColumnExportValue(location, warehouse?.name || '', isActive, column.key)
      );
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = addAoaSheet(workbook, [headerRow, ...dataRows], 'Locations');
    setColumnWidths(worksheet, LOCATION_LIST_COLUMNS.map(() => 18));

    await downloadWorkbook(workbook, 'locations-export.xlsx');
  };

  const getStatusBadge = (status: string, isActive?: boolean) => {
    if (isActive === false) {
      return <Badge variant="secondary">Archived</Badge>;
    }
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-600">Active</Badge>;
      case 'inactive':
        return <Badge variant="secondary">Inactive</Badge>;
      case 'full':
        return <Badge variant="outline" className="border-amber-500 text-amber-500">Full</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
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

  const getDisplayType = (location: Location): string => {
    if (parseDisplayLocationType(location.type)) {
      return location.type;
    }
    const legacyLocationType = (location as any).location_type as string | null | undefined;
    if (parseDisplayLocationType(legacyLocationType)) {
      return legacyLocationType as string;
    }
    return location.type;
  };

  const getLocationColumnCellClassName = (columnKey: LocationListColumnKey): string => {
    switch (columnKey) {
      case 'code':
        return 'font-mono text-sm font-medium';
      case 'zone_code':
        return 'text-sm';
      case 'warehouse':
      case 'capacity':
        return 'text-sm text-muted-foreground';
      case 'sq_ft':
      case 'cu_ft':
        return 'text-right text-sm text-muted-foreground';
      default:
        return '';
    }
  };

  const getLocationColumnValue = (
    location: Location,
    warehouseName: string,
    isActive: boolean,
    columnKey: LocationListColumnKey
  ) => {
    switch (columnKey) {
      case 'code':
        return location.code;
      case 'name':
        return location.name || '—';
      case 'type':
        return getTypeBadge(getDisplayType(location));
      case 'zone_code': {
        if (!zonesEnabled) {
          return '—';
        }
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="min-w-[150px]"
          >
            <select
              value={location.zone_id ?? '_none_'}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                handleUpdateLocationZone(
                  location.id,
                  e.target.value === '_none_' ? null : e.target.value
                )
              }
              disabled={zonesLoading || savingZoneLocationId === location.id}
              className="flex h-8 w-[150px] rounded-xl border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="_none_">Unassigned</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.zone_code}
                </option>
              ))}
            </select>
          </div>
        );
      }
      case 'warehouse':
        return warehouseName;
      case 'capacity': {
        const capacity = (location as unknown as { capacity_cuft?: number | null }).capacity_cuft ?? location.capacity_cu_ft;
        return capacity != null ? `${Number(capacity).toFixed(1)} cuft` : '—';
      }
      case 'status':
        return getStatusBadge(location.status, isActive);
      case 'sq_ft':
        return location.capacity_sq_ft != null ? location.capacity_sq_ft : '—';
      case 'cu_ft': {
        const cuFt = location.capacity_cu_ft ?? (location as unknown as { capacity_cuft?: number | null }).capacity_cuft;
        return cuFt != null ? cuFt : '—';
      }
      default:
        return '—';
    }
  };

  const getLocationColumnExportValue = (
    location: Location,
    warehouseName: string,
    isActive: boolean,
    columnKey: LocationListColumnKey
  ): string | number => {
    switch (columnKey) {
      case 'code':
        return location.code;
      case 'name':
        return location.name || '';
      case 'type':
        return normalizeLocationType(getDisplayType(location));
      case 'zone_code': {
        if (!zonesEnabled) return '';
        if (!location.zone_id) return '';
        return zoneIdToCode.get(location.zone_id) || '';
      }
      case 'warehouse':
        return warehouseName;
      case 'capacity': {
        const capacity = (location as unknown as { capacity_cuft?: number | null }).capacity_cuft ?? location.capacity_cu_ft;
        return capacity ?? '';
      }
      case 'status':
        return isActive ? location.status : 'archived';
      case 'sq_ft':
        return location.capacity_sq_ft ?? '';
      case 'cu_ft': {
        const cuFt = location.capacity_cu_ft ?? (location as unknown as { capacity_cuft?: number | null }).capacity_cuft;
        return cuFt ?? '';
      }
      default:
        return '';
    }
  };

  const activeCount = locations.filter(l => (l as any).is_active !== false).length;
  const archivedCount = locations.filter(l => (l as any).is_active === false).length;

  return (
    <>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MaterialIcon name="map" size="sm" />
              Warehouse Map &amp; Heat Map
            </CardTitle>
            <CardDescription>
              Build map blocks and view utilization by zone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hasWarehouseSelected && (
              <div className="text-sm text-muted-foreground">
                Select a warehouse to manage its Map and Heat Map.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={!hasWarehouseSelected || !canOpenMapBuilder}
                onClick={() => hasWarehouseSelected && navigate(`/warehouses/${selectedWarehouse}/map`)}
              >
                Open Map Builder
              </Button>
              <Button
                variant="outline"
                disabled={!hasWarehouseSelected || !canOpenHeatMap}
                onClick={() => hasWarehouseSelected && navigate(`/warehouses/${selectedWarehouse}/heatmap`)}
              >
                Open Heat Map
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Default Shipment Locations Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MaterialIcon name="pin_drop" size="sm" />
              Default Shipment Locations
            </CardTitle>
            <CardDescription>
              Configure default locations for inbound receiving and outbound shipments.
            </CardDescription>
            {!hasWarehouseSelected && (
              <p className="text-xs text-muted-foreground">
                Select a specific warehouse first to edit default locations.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="default-recv-location">
                  Default Shipment Locations <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <SearchableSelect
                    value={defaultRecvLocationId || '_none_'}
                    onChange={(val) => {
                      setDefaultRecvLocationId(val === '_none_' ? '' : val);
                      setLocationValidationErrors((prev) => ({ ...prev, inbound: undefined }));
                    }}
                    options={activeLocationOptions}
                    placeholder="Select a location…"
                    searchPlaceholder="Search by code or name…"
                    emptyText="No locations found."
                    disabled={savingDefaultLocation || !hasWarehouseSelected}
                    error={locationValidationErrors.inbound}
                    recentKey={`default-recv-location:${selectedWarehouse || 'all'}`}
                  />
                  {!hasWarehouseSelected && (
                    <button
                      type="button"
                      className="absolute inset-0 z-10"
                      aria-label="Select warehouse first"
                      onClick={() => {
                        toast({
                          title: 'Select a warehouse first',
                          description: 'Choose a specific warehouse to edit default receiving and outbound locations.',
                        });
                      }}
                    />
                  )}
                </div>
                {locationValidationErrors.inbound && (
                  <p className="text-xs text-red-500">{locationValidationErrors.inbound}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Default location where inbound items are received
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="default-outbound-location">
                  Default Outbound Location <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <SearchableSelect
                    value={defaultOutboundLocationId || '_none_'}
                    onChange={(val) => {
                      setDefaultOutboundLocationId(val === '_none_' ? '' : val);
                      setLocationValidationErrors((prev) => ({ ...prev, outbound: undefined }));
                    }}
                    options={activeLocationOptions}
                    placeholder="Select a location…"
                    searchPlaceholder="Search by code or name…"
                    emptyText="No locations found."
                    disabled={savingDefaultLocation || !hasWarehouseSelected}
                    error={locationValidationErrors.outbound}
                    recentKey={`default-outbound-location:${selectedWarehouse || 'all'}`}
                  />
                  {!hasWarehouseSelected && (
                    <button
                      type="button"
                      className="absolute inset-0 z-10"
                      aria-label="Select warehouse first"
                      onClick={() => {
                        toast({
                          title: 'Select a warehouse first',
                          description: 'Choose a specific warehouse to edit default receiving and outbound locations.',
                        });
                      }}
                    />
                  )}
                </div>
                {locationValidationErrors.outbound && (
                  <p className="text-xs text-red-500">{locationValidationErrors.outbound}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  When pulling items for outbound, scanned items will automatically be assigned to this location
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSaveDefaultLocations}
                disabled={!hasWarehouseSelected || savingDefaultLocation || (!defaultRecvLocationId && !defaultOutboundLocationId)}
              >
                {savingDefaultLocation ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="save" size="sm" className="mr-2" />
                )}
                Save Locations
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Storage Locations List Card */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <MaterialIcon name="location_on" size="md" />
                <div>
                  <CardTitle>Storage Locations</CardTitle>
                  <CardDescription>
                    {activeCount} active • {archivedCount} archived
                  </CardDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                  <MaterialIcon name="download" size="sm" className="mr-2" />
                  Template
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportLocations}>
                  <MaterialIcon name="download" size="sm" className="mr-2" />
                  Export
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <MaterialIcon name="upload" size="sm" className="mr-2" />
                  Import
                </Button>
                <HelpTip
                  tooltip="Tip: Export your current locations to Excel, edit the rows, then re-import to apply bulk updates. Import uses Warehouse + Code as the unique key: matching codes are updated (not duplicated), and new codes create new locations. For zone assignment imports, use CLEAR to explicitly unassign a zone."
                  pageKey="settings.locations"
                  fieldKey="import_export_help"
                  side="bottom"
                  className="ml-1"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {selectedIds.size > 0 && zonesEnabled && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={zonesLoading}>
                        <MaterialIcon name="grid_on" size="sm" className="mr-2" />
                        Zone
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleBulkAssignZone(null)}>
                        <MaterialIcon name="link_off" size="sm" className="mr-2" />
                        Unassign zone
                      </DropdownMenuItem>
                      {zones.map((z) => (
                        <DropdownMenuItem key={z.id} onClick={() => handleBulkAssignZone(z.id)}>
                          <MaterialIcon name="link" size="sm" className="mr-2" />
                          {z.zone_code}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {selectedIds.size > 0 && (
                  <Button variant="outline" size="sm" onClick={handlePrintSelected}>
                    <MaterialIcon name="print" size="sm" className="mr-2" />
                    Print {selectedIds.size}
                  </Button>
                )}
                <Button size="sm" onClick={onCreate}>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Add Location
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search storage locations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {/* Native <select> instead of Radix Select — portals crash on
                  mobile/tablet because DashboardLayout's overflow-y-auto main
                  and sidebar transform break fixed-position portal anchoring. */}
              <select
                value={selectedWarehouse}
                onChange={(e) => handleWarehouseFilterChange(e.target.value)}
                className="flex h-10 w-full sm:w-[200px] items-center rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none transition-colors duration-150"
              >
                <option value="all">All Warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              {zonesEnabled && zones.length > 0 && (
                <select
                  value={zoneFilterId}
                  onChange={(e) => setZoneFilterId(e.target.value)}
                  disabled={zonesLoading}
                  className="flex h-10 w-full sm:w-[200px] items-center rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none transition-colors duration-150"
                >
                  <option value="all">All Zones</option>
                  <option value="unassigned">Unassigned</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.zone_code}
                    </option>
                  ))}
                </select>
              )}
              <Button 
                variant={showArchived ? "default" : "outline"} 
                size="sm"
                onClick={() => setShowArchived(!showArchived)}
              >
                <MaterialIcon name="archive" size="sm" className="mr-2" />
                {showArchived ? 'Show Active' : 'Show Archived'}
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-32">
                <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredLocations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <MaterialIcon name="location_on" size="lg" className="text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                  {locations.length === 0 
                    ? 'No storage locations yet. Use Add Location to create one.'
                    : showArchived 
                      ? 'No archived locations'
                      : 'No locations match your search'}
                </p>
              </div>
            ) : (
              <div className="rounded-md border max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedIds.size === filteredLocations.length && filteredLocations.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      {LOCATION_LIST_COLUMNS.map((column) => (
                        <TableHead key={column.key} className={column.tableHeadClassName}>
                          {column.label}
                        </TableHead>
                      ))}
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLocations.map((location) => {
                      const warehouse = warehouseMap.get(location.warehouse_id);
                      const isActive = (location as any).is_active !== false;
                      return (
                        <TableRow
                          key={location.id}
                          className={`${!isActive ? 'opacity-60' : ''} cursor-pointer hover:bg-muted/50`}
                          onClick={() => navigate(`/locations/${location.id}`)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(location.id)}
                              onCheckedChange={() => toggleSelect(location.id)}
                            />
                          </TableCell>
                          {LOCATION_LIST_COLUMNS.map((column) => (
                            <TableCell
                              key={column.key}
                              className={getLocationColumnCellClassName(column.key)}
                            >
                              {getLocationColumnValue(
                                location,
                                warehouse?.name || '—',
                                isActive,
                                column.key
                              )}
                            </TableCell>
                          ))}
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MaterialIcon name="more_horiz" size="sm" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onEdit(location.id)}>
                                  <MaterialIcon name="edit" size="sm" className="mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onPrintSelected([location])}>
                                  <MaterialIcon name="print" size="sm" className="mr-2" />
                                  Print Label
                                </DropdownMenuItem>
                                {isActive ? (
                                  <DropdownMenuItem onClick={() => handleArchive(location)}>
                                    <MaterialIcon name="archive" size="sm" className="mr-2" />
                                    Archive
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => handleRestore(location)}>
                                    <MaterialIcon name="refresh" size="sm" className="mr-2" />
                                    Restore
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => handleDeleteClick(location)}
                                >
                                  <MaterialIcon name="delete" size="sm" className="mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{locationToDelete?.code}</strong>?
              This action cannot be undone. Consider archiving instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
