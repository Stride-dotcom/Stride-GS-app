import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ActiveBadge } from '@/components/ui/active-badge';
import { useChargeTypes, type ChargeType } from '@/hooks/useChargeTypes';
import { ensureFlagAlertTrigger } from '@/lib/flagAlertTrigger';
import { HelpTip } from '@/components/ui/help-tip';
import { cn } from '@/lib/utils';
import { BUILTIN_ITEM_EXCEPTION_FLAGS } from '@/lib/items/builtinItemExceptionFlags';
import { useAuth } from '@/contexts/AuthContext';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { useLocations } from '@/hooks/useLocations';
import { usePermissions } from '@/hooks/usePermissions';
import { LocationMultiPicker } from '@/components/locations/LocationMultiPicker';
import {
  fetchFlagLocationSelectionsByWarehouse,
  fetchFlagSpecialStorageRequirement,
  replaceFlagLocationSelectionsByWarehouse,
  upsertFlagSpecialStorageRequirement,
} from '@/lib/putaway/suggestionConfigStore';

export function FlagsTab() {
  const { chargeTypes, loading, refetch, createChargeType, updateChargeType } = useChargeTypes();
  const { profile } = useAuth();
  const { warehouses } = useSelectedWarehouse();
  const { locations } = useLocations();
  const { hasRole } = usePermissions();
  const [expandedItem, setExpandedItem] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const canEditSpecialStorage =
    hasRole('admin') || hasRole('manager') || hasRole('admin_dev');

  const locationOptionsByWarehouse = useMemo(() => {
    const byWarehouse: Record<string, Array<{ id: string; code: string; name: string | null }>> = {};
    for (const warehouse of warehouses) {
      byWarehouse[warehouse.id] = [];
    }
    for (const location of locations) {
      if (!byWarehouse[location.warehouse_id]) {
        byWarehouse[location.warehouse_id] = [];
      }
      byWarehouse[location.warehouse_id].push({
        id: location.id,
        code: location.code,
        name: location.name || null,
      });
    }
    for (const warehouseId of Object.keys(byWarehouse)) {
      byWarehouse[warehouseId].sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: 'base' }));
    }
    return byWarehouse;
  }, [locations, warehouses]);

  const flags = chargeTypes.filter(ct => ct.add_flag);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Built-in flags (non-removable) */}
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MaterialIcon name="verified" size="sm" className="text-muted-foreground" />
          Built-in item exception flags (non-removable)
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          These flags are part of Stride and always available on Item Details and Receiving.
          Pricing flags you add below are tenant-configurable and can be billed/alerted.
        </p>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {BUILTIN_ITEM_EXCEPTION_FLAGS.map((f) => (
            <div
              key={f.code}
              className="flex items-center gap-2 px-2 py-1 rounded-md border bg-background/60 text-xs"
              title={f.description}
            >
              <MaterialIcon name={f.icon || 'flag'} size="sm" className="text-muted-foreground" />
              <span className="truncate">{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Flags mark items with special conditions (e.g., Fragile, Damaged). Flags can create billing charges or serve as visual indicators only.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(true)} className="w-full sm:w-auto">
          <MaterialIcon name="add" size="sm" className="mr-1.5" />
          Add Flag
        </Button>
      </div>

      {/* Add New Flag inline form */}
      {showAddForm && (
        <AddFlagForm
          onSave={async (data) => {
            const result = await createChargeType({
              charge_code: data.charge_code,
              charge_name: data.charge_name,
              notes: data.description || undefined,
              add_flag: true,
              flag_is_indicator: data.flag_behavior === 'indicator',
              alert_rule: data.triggers_alert ? 'email_office' : 'none',
              is_active: data.is_active,
              default_trigger: 'manual',
              category: 'service',
            });
            if (result) {
              // Auto-create/update per-flag alert trigger (tenant derived server-side)
              await ensureFlagAlertTrigger(result.id);
              if (profile?.tenant_id && profile?.id) {
                await upsertFlagSpecialStorageRequirement({
                  tenantId: profile.tenant_id,
                  userId: profile.id,
                  serviceCode: result.charge_code,
                  chargeTypeId: result.id,
                  requiresSpecialStorage: data.requires_special_storage,
                });
                await replaceFlagLocationSelectionsByWarehouse({
                  tenantId: profile.tenant_id,
                  userId: profile.id,
                  serviceCode: result.charge_code,
                  selectionsByWarehouse: data.special_storage_locations_by_warehouse,
                  chargeTypeId: result.id,
                });
              }
              setShowAddForm(false);
              refetch();
            }
          }}
          onCancel={() => setShowAddForm(false)}
          warehouses={warehouses}
          locationOptionsByWarehouse={locationOptionsByWarehouse}
          canEditSpecialStorage={canEditSpecialStorage}
        />
      )}

      {/* Empty state */}
      {flags.length === 0 && !showAddForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <MaterialIcon name="flag" size="xl" className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No flags configured</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Add flags to mark items with special conditions like Fragile, Damaged, or High Value.
          </p>
          <Button onClick={() => setShowAddForm(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1.5" />
            Add First Flag
          </Button>
        </div>
      ) : flags.length > 0 && (
        <Accordion
          type="single"
          collapsible
          value={expandedItem}
          onValueChange={setExpandedItem}
          className="space-y-2"
        >
          {flags.map((flag) => {
            const isIndicator = flag.flag_is_indicator;
            const hasAlert = flag.alert_rule && flag.alert_rule !== 'none';

            return (
              <AccordionItem
                key={flag.id}
                value={flag.id}
                className="border rounded-lg overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                  <div className="flex flex-col flex-1 min-w-0 text-left gap-0.5">
                    <div className="flex items-center gap-2">
                      <MaterialIcon name="flag" size="sm" className="text-muted-foreground shrink-0" />
                      <span className={cn('font-medium text-sm', !flag.is_active && 'opacity-50')}>
                        {flag.charge_name}
                      </span>
                      {isIndicator ? (
                        <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                          INDICATOR
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          <MaterialIcon name="attach_money" className="text-[12px] mr-0.5" />
                          Charge
                        </Badge>
                      )}
                      {hasAlert && (
                        <Badge variant="outline" className="text-xs">
                          <MaterialIcon name="notifications" size="sm" className="mr-0.5" />
                          Alert
                        </Badge>
                      )}
                      <div className="ml-auto mr-2">
                        <ActiveBadge active={flag.is_active} />
                      </div>
                    </div>
                    {flag.notes && (
                      <p className="text-xs text-muted-foreground truncate pl-7">{flag.notes}</p>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <FlagEditForm
                    flag={flag}
                    onSave={async (data) => {
                      const success = await updateChargeType({
                        id: flag.id,
                        notes: data.description,
                        flag_is_indicator: data.flag_behavior === 'indicator',
                        alert_rule: data.triggers_alert ? 'email_office' : 'none',
                        is_active: data.is_active,
                      });
                      if (success) {
                        if (profile?.tenant_id && profile?.id) {
                          await upsertFlagSpecialStorageRequirement({
                            tenantId: profile.tenant_id,
                            userId: profile.id,
                            serviceCode: flag.charge_code,
                            chargeTypeId: flag.id,
                            requiresSpecialStorage: data.requires_special_storage,
                          });
                          await replaceFlagLocationSelectionsByWarehouse({
                            tenantId: profile.tenant_id,
                            userId: profile.id,
                            serviceCode: flag.charge_code,
                            selectionsByWarehouse: data.special_storage_locations_by_warehouse,
                            chargeTypeId: flag.id,
                          });
                        }
                        // Auto-create/disable per-flag alert trigger (tenant derived server-side)
                        await ensureFlagAlertTrigger(flag.id);
                        setExpandedItem('');
                        refetch();
                      }
                    }}
                    onCancel={() => setExpandedItem('')}
                    tenantId={profile?.tenant_id}
                    warehouses={warehouses}
                    locationOptionsByWarehouse={locationOptionsByWarehouse}
                    canEditSpecialStorage={canEditSpecialStorage}
                  />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

// =============================================================================
// FLAG EDIT FORM — inline within accordion
// =============================================================================

interface FlagEditFormProps {
  flag: ChargeType;
  onSave: (data: {
    description: string | null;
    flag_behavior: 'charge' | 'indicator';
    triggers_alert: boolean;
    is_active: boolean;
    requires_special_storage: boolean;
    special_storage_locations_by_warehouse: Record<string, string[]>;
  }) => Promise<void>;
  onCancel: () => void;
  tenantId?: string;
  warehouses: Array<{ id: string; name: string }>;
  locationOptionsByWarehouse: Record<string, Array<{ id: string; code: string; name: string | null }>>;
  canEditSpecialStorage: boolean;
}

function normalizeWarehouseSelections(
  warehouses: Array<{ id: string; name: string }>,
  raw: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const warehouse of warehouses) {
    const set = new Set((raw[warehouse.id] || []).filter(Boolean));
    out[warehouse.id] = Array.from(set);
  }
  return out;
}

function FlagEditForm({
  flag,
  onSave,
  onCancel,
  tenantId,
  warehouses,
  locationOptionsByWarehouse,
  canEditSpecialStorage,
}: FlagEditFormProps) {
  const [description, setDescription] = useState(flag.notes || '');
  const [flagBehavior, setFlagBehavior] = useState<'charge' | 'indicator'>(
    flag.flag_is_indicator ? 'indicator' : 'charge'
  );
  const [triggersAlert, setTriggersAlert] = useState(
    !!flag.alert_rule && flag.alert_rule !== 'none'
  );
  const [isActive, setIsActive] = useState(flag.is_active);
  const [requiresSpecialStorage, setRequiresSpecialStorage] = useState(false);
  const [specialStorageByWarehouse, setSpecialStorageByWarehouse] = useState<Record<string, string[]>>({});
  const [initialRequiresSpecialStorage, setInitialRequiresSpecialStorage] = useState(false);
  const [initialSpecialStorageByWarehouse, setInitialSpecialStorageByWarehouse] = useState<Record<string, string[]>>({});
  const [loadingSpecialStorage, setLoadingSpecialStorage] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDescription(flag.notes || '');
    setFlagBehavior(flag.flag_is_indicator ? 'indicator' : 'charge');
    setTriggersAlert(!!flag.alert_rule && flag.alert_rule !== 'none');
    setIsActive(flag.is_active);
  }, [flag]);

  useEffect(() => {
    let cancelled = false;
    const loadSpecialStorageConfig = async () => {
      if (!tenantId) {
        const normalized = normalizeWarehouseSelections(warehouses, {});
        setRequiresSpecialStorage(false);
        setSpecialStorageByWarehouse(normalized);
        setInitialRequiresSpecialStorage(false);
        setInitialSpecialStorageByWarehouse(normalized);
        return;
      }
      try {
        setLoadingSpecialStorage(true);
        const [requirement, selections] = await Promise.all([
          fetchFlagSpecialStorageRequirement({
            tenantId,
            serviceCode: flag.charge_code,
          }),
          fetchFlagLocationSelectionsByWarehouse({
            tenantId,
            serviceCode: flag.charge_code,
          }),
        ]);
        if (cancelled) return;
        const normalized = normalizeWarehouseSelections(warehouses, selections);
        setRequiresSpecialStorage(requirement.requiresSpecialStorage);
        setSpecialStorageByWarehouse(normalized);
        setInitialRequiresSpecialStorage(requirement.requiresSpecialStorage);
        setInitialSpecialStorageByWarehouse(normalized);
      } catch (error) {
        console.error('[FlagsTab] Failed to load special storage config:', error);
        if (cancelled) return;
        const normalized = normalizeWarehouseSelections(warehouses, {});
        setRequiresSpecialStorage(false);
        setSpecialStorageByWarehouse(normalized);
        setInitialRequiresSpecialStorage(false);
        setInitialSpecialStorageByWarehouse(normalized);
      } finally {
        if (!cancelled) {
          setLoadingSpecialStorage(false);
        }
      }
    };

    void loadSpecialStorageConfig();
    return () => {
      cancelled = true;
    };
  }, [flag.charge_code, tenantId, warehouses]);

  const handleCancel = () => {
    setDescription(flag.notes || '');
    setFlagBehavior(flag.flag_is_indicator ? 'indicator' : 'charge');
    setTriggersAlert(!!flag.alert_rule && flag.alert_rule !== 'none');
    setIsActive(flag.is_active);
    setRequiresSpecialStorage(initialRequiresSpecialStorage);
    setSpecialStorageByWarehouse(initialSpecialStorageByWarehouse);
    onCancel();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        description: description.trim() || null,
        flag_behavior: flagBehavior,
        triggers_alert: triggersAlert,
        is_active: isActive,
        requires_special_storage: requiresSpecialStorage,
        special_storage_locations_by_warehouse: specialStorageByWarehouse,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pt-3 border-t border-dashed">
      {/* Name — read-only */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Name (read-only)</Label>
        <p className="text-sm px-3 py-2 rounded bg-muted/50">{flag.charge_name}</p>
      </div>

      {/* Description — editable */}
      <div className="space-y-2">
        <Label htmlFor={`flag-desc-${flag.id}`} className="text-sm font-medium">Description</Label>
        <Input
          id={`flag-desc-${flag.id}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe when to use this flag"
        />
      </div>

      {/* Flag Behavior — radio */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Flag Behavior</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name={`flag-behavior-${flag.id}`}
              value="charge"
              checked={flagBehavior === 'charge'}
              onChange={() => setFlagBehavior('charge')}
              className="mt-1"
            />
            <div>
              <span className="text-sm font-medium">Creates Billing Charge</span>
              <p className="text-xs text-muted-foreground">When applied to an item, creates a billing event at the configured rate</p>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name={`flag-behavior-${flag.id}`}
              value="indicator"
              checked={flagBehavior === 'indicator'}
              onChange={() => setFlagBehavior('indicator')}
              className="mt-1"
            />
            <div>
              <span className="text-sm font-medium">Indicator Only</span>
              <p className="text-xs text-muted-foreground">Adds a visual warning when this flag is applied. No billing.</p>
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Requires special storage location</Label>
            <p className="text-xs text-muted-foreground">
              When enabled, suggestions and move validation require configured compliant locations.
            </p>
          </div>
          <Switch
            checked={requiresSpecialStorage}
            onCheckedChange={setRequiresSpecialStorage}
            disabled={!canEditSpecialStorage || loadingSpecialStorage}
          />
        </div>

        {!canEditSpecialStorage ? (
          <p className="text-xs text-muted-foreground">
            Read-only: only admin, manager, or admin_dev can edit special storage configuration.
          </p>
        ) : null}

        {requiresSpecialStorage && (
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(140px,220px)_1fr] gap-2 text-xs font-semibold text-muted-foreground">
              <div>Warehouse</div>
              <div>Location search</div>
            </div>
            {warehouses.map((warehouse) => {
              const selectedIds = specialStorageByWarehouse[warehouse.id] || [];
              return (
                <div key={warehouse.id} className="space-y-1">
                  <div className="grid grid-cols-[minmax(140px,220px)_1fr] gap-2 items-start">
                    <div className="pt-2 text-sm">{warehouse.name}</div>
                    <LocationMultiPicker
                      options={locationOptionsByWarehouse[warehouse.id] || []}
                      selectedIds={selectedIds}
                      onChange={(next) =>
                        setSpecialStorageByWarehouse((prev) => ({
                          ...prev,
                          [warehouse.id]: next,
                        }))}
                      disabled={!canEditSpecialStorage || loadingSpecialStorage}
                      placeholder="Search and select locations…"
                      searchPlaceholder="Search by code or name…"
                    />
                  </div>
                  {selectedIds.length === 0 ? (
                    <Alert>
                      <MaterialIcon name="info" size="sm" />
                      <AlertTitle className="text-xs">No compliant locations configured for this warehouse</AlertTitle>
                      <AlertDescription className="text-xs">
                        This is informational only. Suggestions are not blocked until locations are configured.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Toggles */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Triggers Alert</Label>
            <HelpTip
              tooltip="When enabled, applying this flag to an item will send email and in-app notifications to configured recipients."
              pageKey="settings.service_rates"
              fieldKey="flag_alert_behavior_create"
            />
          </div>
          <p className="text-xs text-muted-foreground">Sends email and in-app notification when this flag is applied.</p>
        </div>
        <Switch checked={triggersAlert} onCheckedChange={setTriggersAlert} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Active</Label>
          <HelpTip
            tooltip="Inactive flags are hidden from the item flags panel and cannot be applied to items."
            pageKey="settings.service_rates"
            fieldKey="flag_active_state_create"
          />
        </div>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// ADD FLAG FORM — inline at top of list
// =============================================================================

interface AddFlagFormProps {
  onSave: (data: {
    charge_code: string;
    charge_name: string;
    description: string | null;
    flag_behavior: 'charge' | 'indicator';
    triggers_alert: boolean;
    is_active: boolean;
    requires_special_storage: boolean;
    special_storage_locations_by_warehouse: Record<string, string[]>;
  }) => Promise<void>;
  onCancel: () => void;
  warehouses: Array<{ id: string; name: string }>;
  locationOptionsByWarehouse: Record<string, Array<{ id: string; code: string; name: string | null }>>;
  canEditSpecialStorage: boolean;
}

function AddFlagForm({
  onSave,
  onCancel,
  warehouses,
  locationOptionsByWarehouse,
  canEditSpecialStorage,
}: AddFlagFormProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeManual, setCodeManual] = useState(false);
  const [description, setDescription] = useState('');
  const [flagBehavior, setFlagBehavior] = useState<'charge' | 'indicator'>('charge');
  const [triggersAlert, setTriggersAlert] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [requiresSpecialStorage, setRequiresSpecialStorage] = useState(false);
  const [specialStorageByWarehouse, setSpecialStorageByWarehouse] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!codeManual && name) {
      const trimmed = name.trim().toUpperCase().replace(/\s+/g, '_');
      setCode('FLG_' + trimmed.substring(0, 20));
    }
  }, [name, codeManual]);

  useEffect(() => {
    setSpecialStorageByWarehouse((prev) => {
      const next = normalizeWarehouseSelections(warehouses, prev);
      const same = JSON.stringify(next) === JSON.stringify(prev);
      return same ? prev : next;
    });
  }, [warehouses]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        charge_code: code || 'FLG_' + name.trim().toUpperCase().replace(/\s+/g, '_').substring(0, 20),
        charge_name: name.trim(),
        description: description.trim() || null,
        flag_behavior: flagBehavior,
        triggers_alert: triggersAlert,
        is_active: isActive,
        requires_special_storage: requiresSpecialStorage,
        special_storage_locations_by_warehouse: specialStorageByWarehouse,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/50">
      <CardContent className="pt-4 space-y-4">
        <p className="text-sm font-medium">New Flag</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="new-flag-name" className="text-sm font-medium">Name</Label>
            <Input
              id="new-flag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Fragile, Damaged"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-flag-code" className="text-sm font-medium">Code</Label>
            <Input
              id="new-flag-code"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeManual(true); }}
              placeholder="Auto-generated"
              className="font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-flag-desc" className="text-sm font-medium">Description</Label>
          <Input
            id="new-flag-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe when to use this flag"
          />
        </div>

        {/* Flag Behavior — radio */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Flag Behavior</Label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="new-flag-behavior"
                value="charge"
                checked={flagBehavior === 'charge'}
                onChange={() => setFlagBehavior('charge')}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-medium">Creates Billing Charge</span>
                <p className="text-xs text-muted-foreground">Creates a billing event when applied</p>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="new-flag-behavior"
                value="indicator"
                checked={flagBehavior === 'indicator'}
                onChange={() => setFlagBehavior('indicator')}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-medium">Indicator Only</span>
                <p className="text-xs text-muted-foreground">Adds a visual warning when this flag is applied. No billing.</p>
              </div>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Triggers Alert</Label>
            <HelpTip
              tooltip="When enabled, applying this flag to an item will send email and in-app notifications to configured recipients. A per-flag alert trigger is automatically created in Communications settings."
              pageKey="settings.service_rates"
              fieldKey="flag_alert_behavior_edit"
            />
          </div>
          <Switch checked={triggersAlert} onCheckedChange={setTriggersAlert} />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium">Active</Label>
            <HelpTip
              tooltip="Inactive flags are hidden from the item flags panel and cannot be applied to items."
              pageKey="settings.service_rates"
              fieldKey="flag_active_state_edit"
            />
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Requires special storage location</Label>
              <p className="text-xs text-muted-foreground">
                Configure compliant storage locations per warehouse for this flag.
              </p>
            </div>
            <Switch
              checked={requiresSpecialStorage}
              onCheckedChange={setRequiresSpecialStorage}
              disabled={!canEditSpecialStorage}
            />
          </div>

          {!canEditSpecialStorage ? (
            <p className="text-xs text-muted-foreground">
              Read-only: only admin, manager, or admin_dev can edit special storage configuration.
            </p>
          ) : null}

          {requiresSpecialStorage && (
            <div className="space-y-2">
              <div className="grid grid-cols-[minmax(140px,220px)_1fr] gap-2 text-xs font-semibold text-muted-foreground">
                <div>Warehouse</div>
                <div>Location search</div>
              </div>
              {warehouses.map((warehouse) => {
                const selectedIds = specialStorageByWarehouse[warehouse.id] || [];
                return (
                  <div key={warehouse.id} className="space-y-1">
                    <div className="grid grid-cols-[minmax(140px,220px)_1fr] gap-2 items-start">
                      <div className="pt-2 text-sm">{warehouse.name}</div>
                      <LocationMultiPicker
                        options={locationOptionsByWarehouse[warehouse.id] || []}
                        selectedIds={selectedIds}
                        onChange={(next) =>
                          setSpecialStorageByWarehouse((prev) => ({
                            ...prev,
                            [warehouse.id]: next,
                          }))}
                        disabled={!canEditSpecialStorage}
                        placeholder="Search and select locations…"
                        searchPlaceholder="Search by code or name…"
                      />
                    </div>
                    {selectedIds.length === 0 ? (
                      <Alert>
                        <MaterialIcon name="info" size="sm" />
                        <AlertTitle className="text-xs">No compliant locations configured for this warehouse</AlertTitle>
                        <AlertDescription className="text-xs">
                          This is informational only. Suggestions are not blocked until locations are configured.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
