import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

const SETTING_KEY = 'container_type_options';

const DEFAULT_CONTAINER_TYPES = ['Carton', 'Gaylord', 'Pallet', 'Vault'] as const;

const normalizeType = (value: string): string => value.trim().replace(/\s+/g, ' ');

const dedupeTypes = (values: string[]): string[] => {
  const byLower = new Map<string, string>();
  values.forEach((value) => {
    const normalized = normalizeType(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (!byLower.has(key)) {
      byLower.set(key, normalized);
    }
  });
  return Array.from(byLower.values());
};

const parseSettingValue = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
    } catch {
      // Ignore and fall back to comma split
    }
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
};

export function useContainerTypes() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const containerTypes = useMemo(
    () => dedupeTypes([...DEFAULT_CONTAINER_TYPES, ...customTypes]),
    [customTypes]
  );

  const fetchContainerTypes = useCallback(async () => {
    if (!profile?.tenant_id) {
      setCustomTypes([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await (supabase.from('tenant_settings') as any)
        .select('setting_value')
        .eq('tenant_id', profile.tenant_id)
        .eq('setting_key', SETTING_KEY)
        .maybeSingle();

      if (error) throw error;

      const parsed = parseSettingValue((data as any)?.setting_value);
      // Persist custom values only; defaults are merged at read-time.
      const defaultsLower = new Set(DEFAULT_CONTAINER_TYPES.map((t) => t.toLowerCase()));
      const onlyCustom = dedupeTypes(parsed).filter((t) => !defaultsLower.has(t.toLowerCase()));
      setCustomTypes(onlyCustom);
    } catch (error) {
      console.error('[useContainerTypes] fetch failed:', error);
      setCustomTypes([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    void fetchContainerTypes();
  }, [fetchContainerTypes]);

  const persistCustomTypes = useCallback(
    async (nextCustomTypes: string[]) => {
      if (!profile?.tenant_id) return false;

      const { error } = await (supabase.from('tenant_settings') as any).upsert(
        [
          {
            tenant_id: profile.tenant_id,
            setting_key: SETTING_KEY,
            setting_value: nextCustomTypes,
            updated_by: profile.id,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'tenant_id,setting_key' }
      );

      if (error) throw error;
      return true;
    },
    [profile?.id, profile?.tenant_id]
  );

  const addContainerType = useCallback(
    async (rawType: string): Promise<string | null> => {
      const normalized = normalizeType(rawType);
      if (!normalized) return null;

      const existing = containerTypes.find((t) => t.toLowerCase() === normalized.toLowerCase());
      if (existing) {
        return existing;
      }

      try {
        const nextCustom = dedupeTypes([...customTypes, normalized]);
        await persistCustomTypes(nextCustom);
        setCustomTypes(nextCustom);
        toast({
          title: 'Container type added',
          description: `"${normalized}" is now available for this tenant.`,
        });
        return normalized;
      } catch (error) {
        console.error('[useContainerTypes] add failed:', error);
        toast({
          variant: 'destructive',
          title: 'Could not add container type',
          description: 'Please try again.',
        });
        return null;
      }
    },
    [containerTypes, customTypes, persistCustomTypes, toast]
  );

  return {
    containerTypes,
    loading,
    addContainerType,
    refetch: fetchContainerTypes,
  };
}
