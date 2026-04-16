import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface LabelFieldConfig {
  key: string;
  label: string;
  enabled: boolean;
  fontSize: number;
  bold: boolean;
}

export interface LabelConfig {
  fields: LabelFieldConfig[];
  qrSize: number;
  showQR: boolean;
  showBorder: boolean;
}

export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  fields: [
    { key: 'account', label: 'Account', enabled: true, fontSize: 22, bold: true },
    { key: 'sidemark', label: 'Sidemark', enabled: true, fontSize: 18, bold: true },
    { key: 'room', label: 'Room', enabled: true, fontSize: 14, bold: false },
    { key: 'itemCode', label: 'Item Code', enabled: true, fontSize: 28, bold: true },
    { key: 'sku', label: 'SKU', enabled: false, fontSize: 14, bold: false },
    { key: 'vendor', label: 'Vendor', enabled: true, fontSize: 14, bold: false },
    { key: 'description', label: 'Description', enabled: true, fontSize: 14, bold: false },
    { key: 'warehouseName', label: 'Warehouse', enabled: false, fontSize: 12, bold: false },
    { key: 'locationCode', label: 'Location', enabled: false, fontSize: 12, bold: false },
  ],
  qrSize: 160,
  showQR: true,
  showBorder: true,
};

function mergeLabelConfigWithDefaults(config: unknown): LabelConfig {
  const raw = (config || {}) as Partial<LabelConfig>;
  const rawFields = Array.isArray(raw.fields) ? (raw.fields as unknown[]) : [];

  // Keep saved order/settings where possible; append any new default fields.
  const byKey = new Map<string, Partial<LabelFieldConfig>>();
  for (const f of rawFields) {
    if (!f || typeof f !== 'object') continue;
    const key = (f as any).key;
    if (typeof key !== 'string' || !key) continue;
    byKey.set(key, f as Partial<LabelFieldConfig>);
  }

  const seen = new Set<string>();
  const mergedFields: LabelFieldConfig[] = [];

  // 1) preserve saved order
  for (const f of rawFields) {
    const key = (f as any)?.key;
    if (typeof key !== 'string' || !key || seen.has(key)) continue;
    const def = DEFAULT_LABEL_CONFIG.fields.find((d) => d.key === key);
    const base = def || { key, label: key, enabled: false, fontSize: 12, bold: false };
    const saved = byKey.get(key) || {};
    mergedFields.push({
      ...base,
      ...saved,
      key,
      label: typeof saved.label === 'string' && saved.label.trim() ? saved.label : base.label,
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : base.enabled,
      fontSize: typeof saved.fontSize === 'number' ? saved.fontSize : base.fontSize,
      bold: typeof saved.bold === 'boolean' ? saved.bold : base.bold,
    });
    seen.add(key);
  }

  // 2) append any new default fields not present
  for (const def of DEFAULT_LABEL_CONFIG.fields) {
    if (seen.has(def.key)) continue;
    mergedFields.push(def);
    seen.add(def.key);
  }

  return {
    fields: mergedFields,
    qrSize: typeof raw.qrSize === 'number' ? raw.qrSize : DEFAULT_LABEL_CONFIG.qrSize,
    showQR: typeof raw.showQR === 'boolean' ? raw.showQR : DEFAULT_LABEL_CONFIG.showQR,
    showBorder: typeof raw.showBorder === 'boolean' ? raw.showBorder : DEFAULT_LABEL_CONFIG.showBorder,
  };
}

export interface TenantPreferences {
  id: string;
  tenant_id: string;
  // Storage & Inspection (ACTIVE)
  free_storage_days: number;
  will_call_minimum: number;
  should_create_inspections: boolean;
  auto_apply_arrival_no_id_flag: boolean;
  // Auto-task settings (ACTIVE)
  auto_assembly_on_receiving: boolean;
  auto_repair_on_damage: boolean;
  // Billing & Rate Settings (ACTIVE)
  daily_storage_rate_per_cuft: number;
  sales_tax_rate: number;
  receiving_charge_minimum: number;
  // Future billing rates
  shipment_minimum: number | null;
  hourly_rate: number | null;
  base_rate_includes_pieces: number | null;
  additional_piece_rate: number | null;
  items_to_switch_to_hourly: number | null;
  max_assemblies_in_base_rate: number | null;
  base_order_minutes: number | null;
  extra_stop_rate: number | null;
  high_rise_additional_piece_fee: number | null;
  exchange_order_addition: number | null;
  extra_furniture_moving_minimum: number | null;
  // Cancellation (future)
  late_cancellation_fee: number | null;
  removal_first_2_pieces: number | null;
  removal_extra_piece_default: number | null;
  // Custom Fields (future)
  order_field_label: string | null;
  order_field_required: boolean | null;
  custom_field_1_label: string | null;
  custom_field_1_required: boolean | null;
  // Operational Rules (future)
  require_signature_to_finish: boolean | null;
  allow_typed_name_as_signature: boolean | null;
  allow_billing_to_consumer: boolean | null;
  allow_billing_to_account: boolean | null;
  allow_felt_pads: boolean | null;
  // Scheduling (future)
  default_order_bill_to: string | null;
  morning_starts_at: string | null;
  window_length_hours: number | null;
  reservation_cut_off_time: string | null;
  reservation_prep_days_required: number | null;
  num_reservation_date_choices: number | null;
  minutes_before_arrival_notification: number | null;
  // Breaks (future)
  break_minutes: number | null;
  break_every_hours: number | null;
  // Default Notes
  default_shipment_notes: string | null;
  // Legal Links (ACTIVE)
  terms_of_service_url: string | null;
  privacy_policy_url: string | null;
  // Display Settings
  show_warehouse_in_location: boolean;
  // Label Customization
  label_config: LabelConfig | null;
  // Timestamps
  created_at: string;
  updated_at: string;
}

export type TenantPreferencesUpdate = Partial<Omit<TenantPreferences, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>;

export function useTenantPreferences() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<TenantPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPreferences = useCallback(async () => {
    if (!profile?.tenant_id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('tenant_preferences')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setPreferences({
          ...(data as unknown as TenantPreferences),
          label_config: mergeLabelConfigWithDefaults((data as any).label_config),
        });
      } else {
        // Auto-create default preferences if none exist
        const { data: newPrefs, error: insertError } = await supabase
          .from('tenant_preferences')
          .insert({ tenant_id: profile.tenant_id })
          .select()
          .single();

        if (insertError) throw insertError;
        setPreferences({
          ...(newPrefs as unknown as TenantPreferences),
          label_config: mergeLabelConfigWithDefaults((newPrefs as any).label_config),
        });
      }
    } catch (error) {
      console.error('Error fetching tenant preferences:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load preferences',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const updatePreferences = async (updates: TenantPreferencesUpdate): Promise<boolean> => {
    if (!profile?.tenant_id || !preferences?.id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No preferences to update',
      });
      return false;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('tenant_preferences')
        .update(updates as Record<string, unknown>)
        .eq('id', preferences.id)
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      setPreferences(prev => prev ? { ...prev, ...updates } : null);
      
      toast({
        title: 'Preferences Saved',
        description: 'Your preferences have been updated.',
      });
      
      return true;
    } catch (error) {
      console.error('Error updating preferences:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save preferences',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    preferences,
    loading,
    saving,
    updatePreferences,
    refetch: fetchPreferences,
  };
}
