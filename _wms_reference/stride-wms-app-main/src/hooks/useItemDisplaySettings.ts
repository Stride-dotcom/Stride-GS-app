import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  ITEM_DISPLAY_SETTINGS_TENANT_KEY,
  type ItemDisplaySettingsV1,
  createDefaultItemDisplaySettings,
  normalizeItemDisplaySettings,
} from '@/lib/items/itemDisplaySettings';

export function useItemDisplaySettings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<ItemDisplaySettingsV1>(createDefaultItemDisplaySettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!profile?.tenant_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('tenant_settings')
        .select('setting_value')
        .eq('tenant_id', profile.tenant_id)
        .eq('setting_key', ITEM_DISPLAY_SETTINGS_TENANT_KEY)
        .maybeSingle();

      if (error) throw error;

      // If the setting doesn't exist yet, just use defaults locally.
      // We only persist when an authorized user explicitly saves in Settings.
      if (!data?.setting_value) {
        setSettings(normalizeItemDisplaySettings(createDefaultItemDisplaySettings()));
      } else {
        setSettings(normalizeItemDisplaySettings(data.setting_value));
      }
    } catch (err: any) {
      console.error('[useItemDisplaySettings] fetch error:', err);
      toast({
        title: 'Could not load item display settings',
        description: 'Falling back to defaults.',
        variant: 'destructive',
      });
      setSettings(createDefaultItemDisplaySettings());
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, profile?.id, toast]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const saveSettings = useCallback(
    async (next: ItemDisplaySettingsV1): Promise<boolean> => {
      if (!profile?.tenant_id) return false;
      setSaving(true);
      try {
        const normalized = normalizeItemDisplaySettings(next);
        const { error } = await (supabase as any)
          .from('tenant_settings')
          .upsert(
            [
              {
                tenant_id: profile.tenant_id,
                setting_key: ITEM_DISPLAY_SETTINGS_TENANT_KEY,
                setting_value: normalized,
                updated_by: profile.id,
                updated_at: new Date().toISOString(),
              },
            ],
            { onConflict: 'tenant_id,setting_key' }
          );

        if (error) throw error;
        setSettings(normalized);
        toast({ title: 'Saved', description: 'Item display settings updated.' });
        return true;
      } catch (err: any) {
        console.error('[useItemDisplaySettings] save error:', err);
        toast({
          title: 'Save failed',
          description: err?.message || 'Could not save item display settings.',
          variant: 'destructive',
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [profile?.tenant_id, profile?.id, toast]
  );

  const defaultViewId = useMemo(() => settings.views.find((v) => v.is_default)?.id || settings.views[0]?.id || 'default', [settings.views]);

  return {
    settings,
    loading,
    saving,
    defaultViewId,
    saveSettings,
    refetch: fetchSettings,
  };
}

