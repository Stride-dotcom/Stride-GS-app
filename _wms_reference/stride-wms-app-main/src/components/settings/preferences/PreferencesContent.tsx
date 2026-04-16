import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useTenantPreferences, TenantPreferencesUpdate, DEFAULT_LABEL_CONFIG } from '@/hooks/useTenantPreferences';
import type { LabelConfig } from '@/hooks/useTenantPreferences';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { StorageInspectionSection } from './StorageInspectionSection';
// FlagSettingsSection moved to PricingSettingsTab
import { TimeTrackingSection } from './TimeTrackingSection';
import { DefaultNotesSection } from './DefaultNotesSection';
import { ComingSoonSection } from './ComingSoonSection';
import { ClaimSettingsSection } from './ClaimSettingsSection';
import { DisplaySettingsSection } from './DisplaySettingsSection';
import { LabelCustomizationSection } from './LabelCustomizationSection';
import { AccountTypesSection } from './AccountTypesSection';
import { SpaceTrackingSection } from './SpaceTrackingSection';
import { ItemDisplaySettingsSection } from './ItemDisplaySettingsSection';
import { SortableCard } from './SortableCard';
import { useOrgPreferences } from '@/hooks/useOrgPreferences';
import type { SpaceTrackingMode, ContainerVolumeMode } from '@/hooks/useOrgPreferences';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTimeTrackingConcurrencyPrefs } from '@/hooks/useTimeTrackingConcurrencyPrefs';
import { ScanShortcutsSection } from './ScanShortcutsSection';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

// Define the card IDs and their default order
const DEFAULT_CARD_ORDER = [
  'space-tracking',
  'scan-shortcuts',
  'storage-inspection',
  'time-tracking',
  
  'item-display-settings',
  'display-settings',
  'label-customization',
  'account-types',
  'claim-settings',
  'custom-field-labels',
  'cancellation-fees',
  'operational-rules',
  'scheduling',
  'break-settings',
  'default-notes',
];

export function PreferencesContent() {
  const { preferences, loading, saving, updatePreferences } = useTenantPreferences();
  const { getCardOrder, setCardOrder, loading: prefsLoading } = useUserPreferences();
  const { preferences: orgPrefs, updatePreference: updateOrgPref } = useOrgPreferences();
  
  // Card order state
  const [cardOrder, setCardOrderState] = useState<string[]>(DEFAULT_CARD_ORDER);
  
  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // Local form state
  const [formData, setFormData] = useState({
    free_storage_days: 0,
    will_call_minimum: 30,
    should_create_inspections: false,
    auto_apply_arrival_no_id_flag: true,
    auto_assembly_on_receiving: false,
    auto_repair_on_damage: false,
    daily_storage_rate_per_cuft: 0.04,
    sales_tax_rate: 0,
    receiving_charge_minimum: 0,
    default_shipment_notes: '',
    terms_of_service_url: '',
    privacy_policy_url: '',
    show_warehouse_in_location: true,
    label_config: DEFAULT_LABEL_CONFIG as LabelConfig,
  });

  // Sync from preferences when loaded
  useEffect(() => {
    if (preferences) {
      setFormData({
        free_storage_days: preferences.free_storage_days,
        will_call_minimum: preferences.will_call_minimum,
        should_create_inspections: preferences.should_create_inspections,
        auto_apply_arrival_no_id_flag: preferences.auto_apply_arrival_no_id_flag ?? true,
        auto_assembly_on_receiving: preferences.auto_assembly_on_receiving || false,
        auto_repair_on_damage: preferences.auto_repair_on_damage || false,
        daily_storage_rate_per_cuft: preferences.daily_storage_rate_per_cuft,
        sales_tax_rate: preferences.sales_tax_rate || 0,
        receiving_charge_minimum: preferences.receiving_charge_minimum || 0,
        default_shipment_notes: preferences.default_shipment_notes || '',
        terms_of_service_url: preferences.terms_of_service_url || '',
        privacy_policy_url: preferences.privacy_policy_url || '',
        show_warehouse_in_location: preferences.show_warehouse_in_location ?? true,
        label_config: (preferences.label_config as LabelConfig | null) ?? DEFAULT_LABEL_CONFIG,
      });
    }
  }, [preferences]);

  // Load saved card order
  useEffect(() => {
    if (!prefsLoading) {
      const savedOrder = getCardOrder('preferences');
      if (savedOrder) {
        // Add any new cards that aren't in the saved order
        const newCards = DEFAULT_CARD_ORDER.filter(id => !savedOrder.includes(id));
        // Remove any cards that no longer exist
        const validSavedOrder = savedOrder.filter(id => DEFAULT_CARD_ORDER.includes(id));
        // Combine: valid saved order + new cards at the end
        const mergedOrder = [...validSavedOrder, ...newCards];
        if (mergedOrder.length === DEFAULT_CARD_ORDER.length) {
          setCardOrderState(mergedOrder);
        }
      }
    }
  }, [prefsLoading, getCardOrder]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = cardOrder.indexOf(active.id as string);
      const newIndex = cardOrder.indexOf(over.id as string);
      const newOrder = arrayMove(cardOrder, oldIndex, newIndex);
      setCardOrderState(newOrder);
      await setCardOrder('preferences', newOrder);
    }
  };

  const handleSave = async () => {
    const updates: TenantPreferencesUpdate = {
      free_storage_days: formData.free_storage_days,
      will_call_minimum: formData.will_call_minimum,
      should_create_inspections: formData.should_create_inspections,
      auto_apply_arrival_no_id_flag: formData.auto_apply_arrival_no_id_flag,
      auto_assembly_on_receiving: formData.auto_assembly_on_receiving,
      auto_repair_on_damage: formData.auto_repair_on_damage,
      daily_storage_rate_per_cuft: formData.daily_storage_rate_per_cuft,
      sales_tax_rate: formData.sales_tax_rate,
      receiving_charge_minimum: formData.receiving_charge_minimum,
      default_shipment_notes: formData.default_shipment_notes || null,
      terms_of_service_url: formData.terms_of_service_url || null,
      privacy_policy_url: formData.privacy_policy_url || null,
      show_warehouse_in_location: formData.show_warehouse_in_location,
      label_config: formData.label_config,
    };
    await updatePreferences(updates);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[150px] w-full" />
      </div>
    );
  }

  // Card components mapped by ID
  const cardComponents: Record<string, React.ReactNode> = {
    'space-tracking': (
      <SortableCard id="space-tracking" key="space-tracking">
        <SpaceTrackingSection
          spaceTrackingMode={orgPrefs.space_tracking_mode}
          containerVolumeMode={orgPrefs.container_volume_mode}
          onSpaceTrackingModeChange={(mode) => updateOrgPref('space_tracking_mode', mode)}
          onContainerVolumeModeChange={(mode) => updateOrgPref('container_volume_mode', mode)}
        />
      </SortableCard>
    ),
    'scan-shortcuts': (
      <SortableCard id="scan-shortcuts" key="scan-shortcuts">
        <ScanShortcutsSection
          scanAudioEnabled={orgPrefs.scan_audio_feedback_enabled}
          openContainerEnabled={orgPrefs.scan_shortcuts_open_container_enabled}
          openLocationEnabled={orgPrefs.scan_shortcuts_open_location_enabled}
          onScanAudioEnabledChange={(next) => updateOrgPref('scan_audio_feedback_enabled', next)}
          onOpenContainerEnabledChange={(next) => updateOrgPref('scan_shortcuts_open_container_enabled', next)}
          onOpenLocationEnabledChange={(next) => updateOrgPref('scan_shortcuts_open_location_enabled', next)}
        />
      </SortableCard>
    ),
    'storage-inspection': (
      <SortableCard id="storage-inspection" key="storage-inspection">
        <StorageInspectionSection
          freeStorageDays={formData.free_storage_days}
          shouldCreateInspections={formData.should_create_inspections}
          shouldAutoApplyArrivalNoIdFlag={formData.auto_apply_arrival_no_id_flag}
          shouldAutoAssembly={formData.auto_assembly_on_receiving}
          shouldAutoRepair={formData.auto_repair_on_damage}
          clientPartialGroupedEnabled={orgPrefs.client_partial_grouped_enabled}
          onFreeStorageDaysChange={(value) => setFormData(prev => ({ ...prev, free_storage_days: value }))}
          onShouldCreateInspectionsChange={(value) => setFormData(prev => ({ ...prev, should_create_inspections: value }))}
          onShouldAutoApplyArrivalNoIdFlagChange={(value) => setFormData(prev => ({ ...prev, auto_apply_arrival_no_id_flag: value }))}
          onShouldAutoAssemblyChange={(value) => setFormData(prev => ({ ...prev, auto_assembly_on_receiving: value }))}
          onShouldAutoRepairChange={(value) => setFormData(prev => ({ ...prev, auto_repair_on_damage: value }))}
          onClientPartialGroupedEnabledChange={(next) => updateOrgPref('client_partial_grouped_enabled', next)}
        />
      </SortableCard>
    ),
    'time-tracking': (
      <SortableCard id="time-tracking" key="time-tracking">
        <TimeTrackingSection
          allowConcurrentTasks={orgPrefs.time_tracking_allow_concurrent_tasks ?? true}
          allowConcurrentShipments={orgPrefs.time_tracking_allow_concurrent_shipments ?? true}
          allowConcurrentStocktakes={orgPrefs.time_tracking_allow_concurrent_stocktakes ?? true}
          onAllowConcurrentTasksChange={(value) => updateOrgPref('time_tracking_allow_concurrent_tasks', value)}
          onAllowConcurrentShipmentsChange={(value) => updateOrgPref('time_tracking_allow_concurrent_shipments', value)}
          onAllowConcurrentStocktakesChange={(value) => updateOrgPref('time_tracking_allow_concurrent_stocktakes', value)}
        />
      </SortableCard>
    ),
    'item-display-settings': (
      <SortableCard id="item-display-settings" key="item-display-settings">
        <ItemDisplaySettingsSection />
      </SortableCard>
    ),
    'display-settings': (
      <SortableCard id="display-settings" key="display-settings">
        <DisplaySettingsSection
          showWarehouseInLocation={formData.show_warehouse_in_location}
          onShowWarehouseInLocationChange={(value) => setFormData(prev => ({ ...prev, show_warehouse_in_location: value }))}
        />
      </SortableCard>
    ),
    'label-customization': (
      <SortableCard id="label-customization" key="label-customization">
        <LabelCustomizationSection
          config={formData.label_config}
          onChange={(config) => setFormData(prev => ({ ...prev, label_config: config }))}
        />
      </SortableCard>
    ),
    'account-types': (
      <SortableCard id="account-types" key="account-types">
        <AccountTypesSection />
      </SortableCard>
    ),
    'claim-settings': (
      <SortableCard id="claim-settings" key="claim-settings">
        <ClaimSettingsSection />
      </SortableCard>
    ),
    'custom-field-labels': (
      <SortableCard id="custom-field-labels" key="custom-field-labels">
        <ComingSoonSection title="Custom Field Labels" iconName="label">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Order Field Label</Label>
              <Input value={preferences?.order_field_label || 'Order #'} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Custom Field 1 Label</Label>
              <Input value={preferences?.custom_field_1_label || 'Sidemark'} disabled className="bg-muted" />
            </div>
          </div>
        </ComingSoonSection>
      </SortableCard>
    ),
    'cancellation-fees': (
      <SortableCard id="cancellation-fees" key="cancellation-fees">
        <ComingSoonSection title="Cancellation & Removal Fees" iconName="cancel">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Late Cancellation Fee</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input value={preferences?.late_cancellation_fee || 100} disabled className="pl-7 bg-muted" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Removal First 2 Pieces</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input value={preferences?.removal_first_2_pieces || 185} disabled className="pl-7 bg-muted" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Extra Piece Rate</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input value={preferences?.removal_extra_piece_default || 0} disabled className="pl-7 bg-muted" />
              </div>
            </div>
          </div>
        </ComingSoonSection>
      </SortableCard>
    ),
    'operational-rules': (
      <SortableCard id="operational-rules" key="operational-rules">
        <ComingSoonSection title="Operational Rules" iconName="settings">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Require Signature to Finish</Label>
              <Switch checked={preferences?.require_signature_to_finish ?? true} disabled />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Allow Typed Name as Signature</Label>
              <Switch checked={preferences?.allow_typed_name_as_signature ?? true} disabled />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Allow Billing to Consumer</Label>
              <Switch checked={preferences?.allow_billing_to_consumer ?? true} disabled />
            </div>
          </div>
        </ComingSoonSection>
      </SortableCard>
    ),
    'scheduling': (
      <SortableCard id="scheduling" key="scheduling">
        <ComingSoonSection title="Scheduling & Reservations" iconName="event">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Morning Starts At</Label>
              <Input type="time" value={preferences?.morning_starts_at || '09:00'} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Window Length (hours)</Label>
              <Input type="number" value={preferences?.window_length_hours || 2} disabled className="bg-muted" />
            </div>
          </div>
        </ComingSoonSection>
      </SortableCard>
    ),
    'break-settings': (
      <SortableCard id="break-settings" key="break-settings">
        <ComingSoonSection title="Break Settings" iconName="local_cafe">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Break Duration (minutes)</Label>
              <Input type="number" value={preferences?.break_minutes || 30} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Break Every (hours)</Label>
              <Input type="number" value={preferences?.break_every_hours || 4} disabled className="bg-muted" />
            </div>
          </div>
        </ComingSoonSection>
      </SortableCard>
    ),
    'default-notes': (
      <SortableCard id="default-notes" key="default-notes">
        <DefaultNotesSection
          defaultShipmentNotes={formData.default_shipment_notes}
          onDefaultShipmentNotesChange={(value) => setFormData(prev => ({ ...prev, default_shipment_notes: value }))}
        />
      </SortableCard>
    ),
  };

  return (
    <div className="space-y-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
          {cardOrder.map((cardId) => cardComponents[cardId])}
        </SortableContext>
      </DndContext>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <MaterialIcon name="save" size="sm" className="mr-2" />
              Save Preferences
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
