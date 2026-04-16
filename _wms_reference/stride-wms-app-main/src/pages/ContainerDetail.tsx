import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { HelpTip } from '@/components/ui/help-tip';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ScanToContainerDialog } from '@/components/containers/ScanToContainerDialog';
import { PrintContainerLabelsDialog } from '@/components/containers/PrintContainerLabelsDialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useContainerUnits } from '@/hooks/useContainerUnits';
import { useContainerActions } from '@/hooks/useContainerActions';
import { useOrgPreferences, type InventoryLineFormat } from '@/hooks/useOrgPreferences';
import { useContainerTypes } from '@/hooks/useContainerTypes';
import { useContainers } from '@/hooks/useContainers';
import { useLocations } from '@/hooks/useLocations';
import type { Database } from '@/integrations/supabase/types';
import type { ContainerLabelData } from '@/lib/labelGenerator';

type ContainerRow = Database['public']['Tables']['containers']['Row'];

export default function ContainerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [container, setContainer] = useState<ContainerRow | null>(null);
  const [locationCode, setLocationCode] = useState<string>('');
  const [pageLoading, setPageLoading] = useState(true);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  const [editingFootprint, setEditingFootprint] = useState(false);
  const [footprintValue, setFootprintValue] = useState<string>('');
  const [savingFootprint, setSavingFootprint] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [typeValue, setTypeValue] = useState<string>('');
  const [newTypeValue, setNewTypeValue] = useState<string>('');
  const [savingType, setSavingType] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [detachingItemId, setDetachingItemId] = useState<string | null>(null);
  const [warehouseName, setWarehouseName] = useState<string>('');
  const [printOpen, setPrintOpen] = useState(false);

  const { units, loading: unitsLoading, refetch: refetchUnits } = useContainerUnits(id);
  const { moveContainer, loading: actionLoading } = useContainerActions();
  const { updateContainer } = useContainers();
  const { containerTypes, addContainerType } = useContainerTypes();
  const { locations } = useLocations();
  const { preferences, updatePreference } = useOrgPreferences();

  useEffect(() => {
    if (id) {
      fetchContainer(id);
    }
  }, [id]);

  const fetchContainer = async (containerId: string) => {
    try {
      setPageLoading(true);
      const { data, error } = await supabase
        .from('containers')
        .select('*')
        .eq('id', containerId)
        .single();

      if (error) throw error;
      setContainer(data);
      setFootprintValue(data.footprint_cu_ft != null ? String(data.footprint_cu_ft) : '');
      setTypeValue(data.container_type || '');
      setEditingType(false);
      setNewTypeValue('');

      // Fetch location code
      if (data.location_id) {
        const { data: loc } = await supabase
          .from('locations')
          .select('code')
          .eq('id', data.location_id)
          .single();
        setLocationCode(loc?.code || '');
      } else {
        setLocationCode('');
      }

      // Fetch warehouse name (best-effort, used for container labels)
      if (data.warehouse_id) {
        const { data: wh } = await supabase
          .from('warehouses')
          .select('name')
          .eq('id', data.warehouse_id)
          .single();
        setWarehouseName(wh?.name || '');
      } else {
        setWarehouseName('');
      }
    } catch (error) {
      console.error('Error fetching container:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load container details.',
      });
      navigate(-1);
    } finally {
      setPageLoading(false);
    }
  };

  const handleMove = async () => {
    if (!container || !selectedLocationId) return;

    const result = await moveContainer(container.id, selectedLocationId);
    if (result) {
      setMoveDialogOpen(false);
      setSelectedLocationId('');
      fetchContainer(container.id);
      refetchUnits();
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!profile?.tenant_id) return;

    setDetachingItemId(itemId);
    try {
      const { data: row, error: loadError } = await (supabase.from('items') as any)
        .select('metadata')
        .eq('tenant_id', profile.tenant_id)
        .eq('id', itemId)
        .is('deleted_at', null)
        .maybeSingle();
      if (loadError) throw loadError;

      const existingMeta = row?.metadata && typeof row.metadata === 'object'
        ? ({ ...(row.metadata as Record<string, unknown>) })
        : {};
      delete existingMeta.container_id;
      delete existingMeta.container_code;

      const patch: Record<string, unknown> = {
        metadata: existingMeta,
      };
      if (container?.location_id) {
        patch.current_location_id = container.location_id;
      }

      const { error: updateError } = await (supabase.from('items') as any)
        .update(patch)
        .eq('tenant_id', profile.tenant_id)
        .eq('id', itemId);
      if (updateError) throw updateError;

      toast({
        title: 'Item removed',
        description: 'Item detached from container and kept at its location.',
      });
      refetchUnits();
    } catch (error) {
      console.error('Error removing item from container:', error);
      toast({
        variant: 'destructive',
        title: 'Remove Failed',
        description: error instanceof Error ? error.message : 'Failed to remove item from container.',
      });
    } finally {
      setDetachingItemId(null);
    }
  };

  const updateContainerStatus = async (nextStatus: 'active' | 'closed' | 'archived') => {
    if (!container) return;
    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Not signed in',
        description: 'Please sign in again and retry.',
      });
      return;
    }

    try {
      if (nextStatus === 'archived') {
        const ok = window.confirm(
          `Archive container ${container.container_code}?\n\n` +
            `Archived containers cannot accept new items.`
        );
        if (!ok) return;
      }

      setSavingStatus(true);

      const patch: Partial<ContainerRow> & { updated_at: string } = {
        status: nextStatus,
        // Keep legacy is_active broadly in sync for older queries.
        is_active: nextStatus !== 'archived',
        updated_at: new Date().toISOString(),
      };

      const { error } = await (supabase.from('containers') as any)
        .update(patch)
        .eq('tenant_id', profile.tenant_id)
        .eq('id', container.id);

      if (error) throw error;

      toast({
        title: 'Container updated',
        description: `Status set to ${nextStatus}.`,
      });
      fetchContainer(container.id);
    } catch (error) {
      console.error('[ContainerDetail] status update error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update container status.',
      });
    } finally {
      setSavingStatus(false);
    }
  };

  const handleSaveFootprint = async () => {
    if (!container) return;
    setSavingFootprint(true);
    try {
      const value = footprintValue.trim() ? Number(footprintValue) : null;
      const result = await updateContainer(container.id, { footprint_cu_ft: value });
      if (result) {
        setContainer((prev) => prev ? { ...prev, footprint_cu_ft: value } : prev);
        setEditingFootprint(false);
      }
    } finally {
      setSavingFootprint(false);
    }
  };

  const handleAddContainerType = async () => {
    if (addingType) return;
    const next = newTypeValue.trim();
    if (!next) return;

    setAddingType(true);
    try {
      const added = await addContainerType(next);
      if (added) {
        setTypeValue(added);
        setNewTypeValue('');
      }
    } finally {
      setAddingType(false);
    }
  };

  const handleSaveType = async () => {
    if (!container) return;
    const nextType = typeValue.trim();
    if (!nextType) {
      toast({
        variant: 'destructive',
        title: 'Container type required',
        description: 'Select or enter a type before saving.',
      });
      return;
    }

    setSavingType(true);
    try {
      const result = await updateContainer(container.id, { container_type: nextType });
      if (result) {
        setContainer((prev) => (prev ? { ...prev, container_type: nextType } : prev));
        setEditingType(false);
      }
    } finally {
      setSavingType(false);
    }
  };

  const handleRefreshAll = () => {
    refetchUnits();
    if (id) fetchContainer(id);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      closed: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      archived: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return (
      <Badge variant="outline" className={colors[status] || ''}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
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

  if (!container) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Container not found.</p>
          <Button variant="link" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const totalVolume = units.reduce((sum, u) => sum + (u.size_cu_ft || 0), 0);
  const labelData: ContainerLabelData[] = [
    {
      id: container.id,
      containerCode: container.container_code,
      containerType: container.container_type,
      warehouseName: warehouseName || null,
      locationCode: locationCode || null,
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              {container.location_id && (
                <>
                  <Link to={`/locations/${container.location_id}`} className="hover:underline">
                    Location: {locationCode}
                  </Link>
                  <MaterialIcon name="chevron_right" size="sm" />
                </>
              )}
              <span>Container</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">
                <code className="bg-muted px-2 py-0.5 rounded">{container.container_code}</code>
              </h1>
              {getStatusBadge(container.status)}
            </div>
            <div className="text-muted-foreground mt-1">
              {!editingType ? (
                <div className="flex items-center gap-2">
                  <span>Type: {container.container_type || '—'}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => {
                      setTypeValue(container.container_type || containerTypes[0] || 'Carton');
                      setEditingType(true);
                    }}
                    title="Edit container type"
                  >
                    <MaterialIcon name="edit" size="sm" />
                  </Button>
                </div>
              ) : (
                <div className="mt-2 space-y-2 rounded-md border p-3 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Select value={typeValue} onValueChange={setTypeValue}>
                      <SelectTrigger className="w-[220px] h-8 text-xs">
                        <SelectValue placeholder="Select container type" />
                      </SelectTrigger>
                      <SelectContent>
                        {containerTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingType(false);
                        setTypeValue(container.container_type || '');
                        setNewTypeValue('');
                      }}
                      disabled={savingType || addingType}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveType} disabled={savingType || addingType || !typeValue.trim()}>
                      {savingType ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Add custom type (e.g., Vault)"
                      value={newTypeValue}
                      onChange={(e) => setNewTypeValue(e.target.value)}
                      onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddContainerType().catch(err => {
                            toast({ variant: 'destructive', title: 'Error', description: 'Failed to add container type' });
                            console.error(err);
                          });
                        }
                      }}
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddContainerType().catch(err => {
                        toast({ variant: 'destructive', title: 'Error', description: 'Failed to add container type' });
                        console.error(err);
                      })}
                      disabled={!newTypeValue.trim() || addingType || savingType}
                    >
                      {addingType ? 'Adding…' : 'Add Type'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Custom types are saved for your tenant and available across container creation and editing.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
              Back
            </Button>
          </div>
        </div>

        {/* Info + Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Location</CardTitle>
            </CardHeader>
            <CardContent>
              {container.location_id ? (
                <Link
                  to={`/locations/${container.location_id}`}
                  className="text-primary hover:underline font-medium"
                >
                  {locationCode || container.location_id}
                </Link>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                <HelpTip
                  tooltip="Total number of inventory items currently stored in this container."
                  pageKey="containers.detail"
                  fieldKey="unit_count"
                >
                  Contents
                </HelpTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{units.length} item{units.length !== 1 ? 's' : ''}</p>
              {totalVolume > 0 && (
                <p className="text-xs text-muted-foreground">{totalVolume.toFixed(1)} cu ft total</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                <HelpTip
                  tooltip="The physical footprint volume of the container itself, used in bounded footprint capacity calculations. Click the edit icon to update."
                  pageKey="containers.detail"
                  fieldKey="footprint_volume"
                >
                  Footprint
                </HelpTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editingFootprint ? (
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="cu ft"
                    value={footprintValue}
                    onChange={(e) => setFootprintValue(e.target.value)}
                    className="w-24 h-8 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveFootprint();
                      if (e.key === 'Escape') {
                        setEditingFootprint(false);
                        setFootprintValue(container.footprint_cu_ft != null ? String(container.footprint_cu_ft) : '');
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={handleSaveFootprint}
                    disabled={savingFootprint}
                  >
                    <MaterialIcon name="check" size="sm" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingFootprint(false);
                      setFootprintValue(container.footprint_cu_ft != null ? String(container.footprint_cu_ft) : '');
                    }}
                  >
                    <MaterialIcon name="close" size="sm" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {container.footprint_cu_ft != null ? `${container.footprint_cu_ft} cu ft` : 'Not set'}
                  </p>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => setEditingFootprint(true)}
                    title="Edit footprint"
                  >
                    <MaterialIcon name="edit" size="sm" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setPrintOpen(true)}>
            <MaterialIcon name="print" size="sm" className="mr-2" />
            Print Label
          </Button>
          <Button
            variant="outline"
            onClick={() => setMoveDialogOpen(true)}
            disabled={container.status === 'archived' || savingStatus}
          >
            <MaterialIcon name="move_item" size="sm" className="mr-2" />
            Move Container
          </Button>
          <Button
            variant="outline"
            onClick={() => setScanDialogOpen(true)}
            disabled={container.status !== 'active' || savingStatus}
          >
            <MaterialIcon name="qr_code_scanner" size="sm" className="mr-2" />
            Scan Units Into Container
          </Button>
          {container.status === 'active' && (
            <Button
              variant="outline"
              onClick={() => updateContainerStatus('closed')}
              disabled={savingStatus}
            >
              <MaterialIcon name="lock" size="sm" className="mr-2" />
              Close Container
            </Button>
          )}
          {container.status === 'closed' && (
            <Button
              variant="outline"
              onClick={() => updateContainerStatus('active')}
              disabled={savingStatus}
            >
              <MaterialIcon name="lock_open" size="sm" className="mr-2" />
              Reopen Container
            </Button>
          )}
          {container.status !== 'archived' && (
            <Button
              variant="outline"
              onClick={() => updateContainerStatus('archived')}
              disabled={savingStatus}
            >
              <MaterialIcon name="archive" size="sm" className="mr-2" />
              Archive Container
            </Button>
          )}
        </div>

        {/* Contents Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <HelpTip
                tooltip="Inventory items stored inside this container. Removing an item keeps it at the same location but detaches it from the container."
                pageKey="containers.detail"
                fieldKey="inventory_units"
              >
                Container Contents
              </HelpTip>
            </CardTitle>
            <CardDescription>
              {units.length} item{units.length !== 1 ? 's' : ''} in this container
            </CardDescription>
            <div className="flex items-center gap-2 mt-2">
              <HelpTip
                tooltip="Switch between detailed table rows and a compact single-line format."
                pageKey="containers.detail"
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
                This container is empty.
              </p>
            ) : preferences.inventory_line_format === 'single_line' ? (
                <div className="divide-y">
                  {units.map((unit) => (
                    <div key={unit.id} className="px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-muted/30">
                      <code className="bg-muted px-1 py-0.5 rounded text-xs font-medium">{unit.item_code}</code>
                      <span className="text-muted-foreground">•</span>
                      <StatusIndicator status={unit.status} size="sm" />
                      {unit.class_code && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-xs">{unit.class_code}</span>
                        </>
                      )}
                      {unit.description && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-xs truncate max-w-[180px] text-muted-foreground">{unit.description}</span>
                        </>
                      )}
                      <span className="ml-auto">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          disabled={actionLoading || detachingItemId === unit.id}
                          onClick={() => handleRemoveItem(unit.id)}
                          title="Remove from container"
                        >
                          <MaterialIcon name="logout" size="sm" />
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Volume</TableHead>
                      <TableHead className="w-[70px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {units.map((unit) => (
                      <TableRow key={unit.id}>
                        <TableCell className="font-medium">
                          <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                            {unit.item_code}
                          </code>
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          {unit.description || '—'}
                        </TableCell>
                        <TableCell>
                          <StatusIndicator status={unit.status} size="sm" />
                        </TableCell>
                        <TableCell>{unit.class_code || '—'}</TableCell>
                        <TableCell>
                          {unit.size_cu_ft != null ? `${unit.size_cu_ft} cu ft` : '—'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={actionLoading || detachingItemId === unit.id}
                            onClick={() => handleRemoveItem(unit.id)}
                            title="Remove from container"
                          >
                            <MaterialIcon name="logout" size="sm" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

          </CardContent>
        </Card>
      </div>

      {/* Move Container Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Container</DialogTitle>
            <DialogDescription>
              Select a new location for container <strong>{container.container_code}</strong>.
              All {units.length} item{units.length !== 1 ? 's' : ''} inside will be moved automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {(() => {
              const activeLocations = locations.filter((l) => l.id !== container.location_id && l.status === 'active');
              if (activeLocations.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No active locations available. All locations are archived or this is the only one.
                  </p>
                );
              }
              return (
                <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target location" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.code} {loc.name ? `(${loc.name})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleMove}
              disabled={!selectedLocationId || actionLoading}
            >
              {actionLoading && (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              )}
              Move Container
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan to Container Dialog */}
      <ScanToContainerDialog
        open={scanDialogOpen}
        onOpenChange={setScanDialogOpen}
        containerId={container.id}
        containerCode={container.container_code}
        onSuccess={handleRefreshAll}
      />

      <PrintContainerLabelsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        containers={labelData}
      />
    </DashboardLayout>
  );
}
