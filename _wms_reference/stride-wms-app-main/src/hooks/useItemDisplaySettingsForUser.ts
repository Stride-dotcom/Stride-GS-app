import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useItemDisplaySettings } from '@/hooks/useItemDisplaySettings';
import {
  getViewById,
  normalizeItemDisplaySettings,
  type ItemColumnKey,
  type ItemDisplaySettingsV1,
} from '@/lib/items/itemDisplaySettings';
import { arraysEqual } from '@/lib/utils';

const ITEM_DISPLAY_SETTINGS_USER_OVERRIDES_KEY = 'item_display_settings_overrides_v1';

type ItemDisplaySettingsUserOverridesV1 = {
  version: 1;
  /**
   * Per-view overrides. Only stores order/hidden to preserve tenant-managed
   * view names + custom field definitions.
   */
  views: Record<string, { order: ItemColumnKey[]; hidden: ItemColumnKey[] }>;
};

function normalizeOverrides(raw: unknown): ItemDisplaySettingsUserOverridesV1 {
  const obj = (raw && typeof raw === 'object') ? (raw as any) : {};
  const rawViews = (obj.views && typeof obj.views === 'object') ? obj.views : {};

  const views: ItemDisplaySettingsUserOverridesV1['views'] = {};
  for (const [viewId, v] of Object.entries(rawViews as Record<string, any>)) {
    if (!viewId) continue;
    const order = Array.isArray(v?.order) ? v.order.filter((k: unknown): k is ItemColumnKey => typeof k === 'string') : null;
    const hidden = Array.isArray(v?.hidden) ? v.hidden.filter((k: unknown): k is ItemColumnKey => typeof k === 'string') : null;
    if (!order || !hidden) continue;
    views[viewId] = { order, hidden };
  }

  return { version: 1, views };
}

function applyOverrides(
  tenantSettings: ItemDisplaySettingsV1,
  overrides: ItemDisplaySettingsUserOverridesV1
): ItemDisplaySettingsV1 {
  if (!overrides.views || Object.keys(overrides.views).length === 0) return tenantSettings;

  const next: ItemDisplaySettingsV1 = {
    ...tenantSettings,
    views: tenantSettings.views.map((v) => {
      const ov = overrides.views[v.id];
      if (!ov) return v;
      return { ...v, order: ov.order, hidden: ov.hidden };
    }),
  };

  // Ensure new columns are appended and invalid keys are dropped.
  return normalizeItemDisplaySettings(next);
}

/**
 * useItemDisplaySettingsForUser
 *
 * - Tenant settings (default views) are stored in tenant_settings
 * - Individual users can override column order/visibility per view via user_preferences
 * - Only overrides order/hidden; does NOT override custom field definitions or view names
 */
export function useItemDisplaySettingsForUser() {
  const { toast } = useToast();
  const tenant = useItemDisplaySettings();
  const userPrefs = useUserPreferences();
  const [saving, setSaving] = useState(false);

  const storedOverrides = useMemo(() => {
    const raw = userPrefs.getPreference<ItemDisplaySettingsUserOverridesV1>(ITEM_DISPLAY_SETTINGS_USER_OVERRIDES_KEY);
    return normalizeOverrides(raw);
  }, [userPrefs.preferences]);

  const settings = useMemo(() => {
    return applyOverrides(tenant.settings, storedOverrides);
  }, [tenant.settings, storedOverrides]);

  const saveSettings = useCallback(
    async (nextEffectiveSettings: ItemDisplaySettingsV1): Promise<boolean> => {
      // Tenant defaults are the baseline; compute diffs as user overrides.
      const base = tenant.settings;
      const nextOverrides: ItemDisplaySettingsUserOverridesV1 = { version: 1, views: { ...storedOverrides.views } };

      // For each view in the tenant baseline, persist override only when it differs.
      for (const baseView of base.views) {
        const nextView = getViewById(nextEffectiveSettings, baseView.id);
        if (!nextView) continue;

        const differs =
          !arraysEqual(nextView.order, baseView.order) ||
          !arraysEqual(nextView.hidden, baseView.hidden);

        if (!differs) {
          delete nextOverrides.views[baseView.id];
        } else {
          nextOverrides.views[baseView.id] = {
            order: nextView.order,
            hidden: nextView.hidden,
          };
        }
      }

      // Persist to user_preferences (never tenant_settings)
      setSaving(true);
      try {
        const ok = await userPrefs.setPreference(
          ITEM_DISPLAY_SETTINGS_USER_OVERRIDES_KEY,
          nextOverrides as unknown as Record<string, unknown>
        );
        if (!ok) {
          toast({
            title: 'Could not save columns',
            description: 'Your column preferences could not be saved.',
            variant: 'destructive',
          });
        }
        return ok;
      } catch (err: any) {
        console.error('[useItemDisplaySettingsForUser] save error:', err);
        toast({
          title: 'Could not save columns',
          description: err?.message || 'Your column preferences could not be saved.',
          variant: 'destructive',
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [tenant.settings, storedOverrides.views, userPrefs, toast]
  );

  return {
    /** Effective settings = tenant defaults + user overrides */
    settings,
    /** For reset behavior (revert back to tenant defaults) */
    tenantSettings: tenant.settings,
    defaultViewId: tenant.defaultViewId,
    loading: tenant.loading || userPrefs.loading,
    saving,
    saveSettings,
    refetch: tenant.refetch,
  };
}

