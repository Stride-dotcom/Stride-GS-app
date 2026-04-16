import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useAuth } from '@/contexts/AuthContext';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useLocations } from '@/hooks/useLocations';
import { LocationMultiPicker } from '@/components/locations/LocationMultiPicker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchPutAwayExcludedLocationIds,
  replacePutAwayExcludedLocationIds,
} from '@/lib/putaway/suggestionConfigStore';
import { useToast } from '@/hooks/use-toast';

interface StorageInspectionSectionProps {
  freeStorageDays: number;
  shouldCreateInspections: boolean;
  shouldAutoApplyArrivalNoIdFlag: boolean;
  shouldAutoAssembly: boolean;
  shouldAutoRepair: boolean;
  clientPartialGroupedEnabled: boolean;
  onFreeStorageDaysChange: (value: number) => void;
  onShouldCreateInspectionsChange: (value: boolean) => void;
  onShouldAutoApplyArrivalNoIdFlagChange: (value: boolean) => void;
  onShouldAutoAssemblyChange: (value: boolean) => void;
  onShouldAutoRepairChange: (value: boolean) => void;
  onClientPartialGroupedEnabledChange: (value: boolean) => void;
}

export function StorageInspectionSection({
  freeStorageDays,
  shouldCreateInspections,
  shouldAutoApplyArrivalNoIdFlag,
  shouldAutoAssembly,
  shouldAutoRepair,
  clientPartialGroupedEnabled,
  onFreeStorageDaysChange,
  onShouldCreateInspectionsChange,
  onShouldAutoApplyArrivalNoIdFlagChange,
  onShouldAutoAssemblyChange,
  onShouldAutoRepairChange,
  onClientPartialGroupedEnabledChange,
}: StorageInspectionSectionProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedWarehouseId, warehouses } = useSelectedWarehouse();
  const { hasRole } = usePermissions();

  const [open, setOpen] = useState(true);
  const [configWarehouseId, setConfigWarehouseId] = useState<string>('');
  const [excludedLocationIds, setExcludedLocationIds] = useState<string[]>([]);
  const [loadingExcludedLocations, setLoadingExcludedLocations] = useState(false);
  const [savingExcludedLocations, setSavingExcludedLocations] = useState(false);

  const canEditExcludedLocations =
    hasRole('admin') || hasRole('manager') || hasRole('admin_dev');

  useEffect(() => {
    const fallbackWarehouseId = selectedWarehouseId || warehouses[0]?.id || '';
    if (!configWarehouseId && fallbackWarehouseId) {
      setConfigWarehouseId(fallbackWarehouseId);
      return;
    }
    if (
      configWarehouseId
      && !warehouses.some((warehouse) => warehouse.id === configWarehouseId)
    ) {
      setConfigWarehouseId(fallbackWarehouseId);
    }
  }, [configWarehouseId, selectedWarehouseId, warehouses]);

  const { locations: warehouseLocations } = useLocations(configWarehouseId || undefined);

  const warehouseLocationOptions = useMemo(() => {
    return warehouseLocations
      .map((location) => ({
        id: location.id,
        code: location.code,
        name: location.name || null,
      }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: 'base' }));
  }, [warehouseLocations]);

  useEffect(() => {
    const load = async () => {
      if (!profile?.tenant_id || !configWarehouseId) {
        setExcludedLocationIds([]);
        return;
      }
      try {
        setLoadingExcludedLocations(true);
        const ids = await fetchPutAwayExcludedLocationIds({
          tenantId: profile.tenant_id,
          warehouseId: configWarehouseId,
        });
        setExcludedLocationIds(ids);
      } catch (error) {
        console.error('[StorageInspectionSection] Failed to fetch excluded locations:', error);
        setExcludedLocationIds([]);
      } finally {
        setLoadingExcludedLocations(false);
      }
    };

    void load();
  }, [configWarehouseId, profile?.tenant_id]);

  const saveExcludedLocations = async () => {
    if (!profile?.tenant_id || !profile?.id || !configWarehouseId) return;
    if (!canEditExcludedLocations) return;
    try {
      setSavingExcludedLocations(true);
      await replacePutAwayExcludedLocationIds({
        tenantId: profile.tenant_id,
        warehouseId: configWarehouseId,
        userId: profile.id,
        locationIds: excludedLocationIds,
      });
      toast({
        title: 'Excluded locations saved',
        description: 'Suggested Put Away exclusions were updated for this warehouse.',
      });
    } catch (error) {
      console.error('[StorageInspectionSection] Failed to save excluded locations:', error);
      toast({
        title: 'Save failed',
        description: 'Could not save excluded locations.',
        variant: 'destructive',
      });
    } finally {
      setSavingExcludedLocations(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MaterialIcon name="inventory_2" size="sm" />
              Storage & Automation
            </CardTitle>
            <CardDescription className="text-xs">
              Configure storage billing and automatic task creation
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-[220px]">
              <Select
                value={configWarehouseId || undefined}
                onValueChange={(next) => {
                  setConfigWarehouseId(next);
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Collapse section' : 'Expand section'}
              title={open ? 'Collapse' : 'Expand'}
            >
              <MaterialIcon name={open ? 'expand_less' : 'expand_more'} size="sm" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {open ? (
      <CardContent className="space-y-4">
        {/* Free Storage Days - Compact */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <Label htmlFor="free_storage_days" className="text-sm">Free Storage Days</Label>
            <p className="text-xs text-muted-foreground">
              Days before billing begins
            </p>
          </div>
          <Input
            id="free_storage_days"
            type="number"
            min="0"
            max="365"
            value={freeStorageDays}
            onChange={(e) => onFreeStorageDaysChange(parseInt(e.target.value) || 0)}
            className="w-20 text-right"
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="space-y-0.5">
            <Label className="text-sm">Exclude locations from Suggested Put Away</Label>
            <p className="text-xs text-muted-foreground">
              Hard-exclude staging/receiving/outbound or other zones from suggestion results.
            </p>
          </div>

          {!configWarehouseId ? (
            <p className="text-xs text-muted-foreground">
              Select a warehouse to configure excluded locations.
            </p>
          ) : (
            <>
              <LocationMultiPicker
                options={warehouseLocationOptions}
                selectedIds={excludedLocationIds}
                onChange={setExcludedLocationIds}
                placeholder={loadingExcludedLocations ? 'Loading locations…' : 'Search and select locations…'}
                disabled={loadingExcludedLocations || !canEditExcludedLocations}
                searchPlaceholder="Type location code or name…"
              />
              <div className="flex items-center justify-between">
                {!canEditExcludedLocations ? (
                  <p className="text-xs text-muted-foreground">
                    Read-only: admin, manager, or admin_dev can edit this setting.
                  </p>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={saveExcludedLocations}
                  disabled={!canEditExcludedLocations || savingExcludedLocations || loadingExcludedLocations}
                >
                  {savingExcludedLocations ? 'Saving…' : 'Save exclusions'}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Automation Toggles - Compact Grid */}
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2 min-w-0">
              <MaterialIcon name="checklist" size="sm" className="text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <Label className="text-sm">Auto-Create Inspections</Label>
                <p className="text-xs text-muted-foreground truncate">
                  Create inspection tasks on receiving
                </p>
              </div>
            </div>
            <Switch
              checked={shouldCreateInspections}
              onCheckedChange={onShouldCreateInspectionsChange}
            />
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2 min-w-0">
              <MaterialIcon name="flag" size="sm" className="text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <Label className="text-sm">Auto-Apply ARRIVAL_NO_ID Flag</Label>
                <p className="text-xs text-muted-foreground truncate">
                  On unidentified intake completion
                </p>
              </div>
            </div>
            <Switch
              checked={shouldAutoApplyArrivalNoIdFlag}
              onCheckedChange={onShouldAutoApplyArrivalNoIdFlagChange}
            />
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2 min-w-0">
              <MaterialIcon name="construction" size="sm" className="text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <Label className="text-sm">Auto-Create Assembly Tasks</Label>
                <p className="text-xs text-muted-foreground truncate">
                  Create assembly tasks on receiving
                </p>
              </div>
            </div>
            <Switch
              checked={shouldAutoAssembly}
              onCheckedChange={onShouldAutoAssemblyChange}
            />
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2 min-w-0">
              <MaterialIcon name="build" size="sm" className="text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <Label className="text-sm">Auto-Create Repair Tasks</Label>
                <p className="text-xs text-muted-foreground truncate">
                  Create repair tasks when damaged
                </p>
              </div>
            </div>
            <Switch
              checked={shouldAutoRepair}
              onCheckedChange={onShouldAutoRepairChange}
            />
          </div>

          <div className="flex items-center justify-between gap-3 py-1">
            <div className="flex items-center gap-2 min-w-0">
              <MaterialIcon name="call_split" size="sm" className="text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <Label className="text-sm">Allow Client Partial-Quantity Requests</Label>
                <p className="text-xs text-muted-foreground truncate">
                  Clients can request partial qty from grouped items
                </p>
              </div>
            </div>
            <Switch
              checked={clientPartialGroupedEnabled}
              onCheckedChange={onClientPartialGroupedEnabledChange}
            />
          </div>
        </div>
      </CardContent>
      ) : null}
    </Card>
  );
}
