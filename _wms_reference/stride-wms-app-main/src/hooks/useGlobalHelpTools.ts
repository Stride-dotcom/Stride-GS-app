import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { GlobalHelpSourceType, GlobalHelpToolSeed } from '@/lib/globalHelpToolsCatalog';

export interface GlobalHelpTool {
  id: string;
  page_key: string;
  field_key: string;
  help_text: string;
  is_active: boolean;
  route_path: string | null;
  target_selector: string | null;
  source_type: GlobalHelpSourceType;
  icon_symbol: 'info';
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface GlobalHelpToolInput {
  page_key: string;
  field_key: string;
  help_text: string;
  is_active: boolean;
  route_path?: string | null;
  target_selector?: string | null;
  source_type?: GlobalHelpSourceType;
  icon_symbol?: 'info';
}

export function useGlobalHelpTools() {
  const { session } = useAuth();

  return useQuery<GlobalHelpTool[]>({
    queryKey: ['global-help-tools'],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('global_help_tools')
        .select('*')
        .order('page_key', { ascending: true })
        .order('field_key', { ascending: true });

      if (error) throw error;
      return (data || []) as GlobalHelpTool[];
    },
    staleTime: 30_000,
  });
}

export function useGlobalHelpTool(pageKey?: string, fieldKey?: string) {
  const query = useGlobalHelpTools();
  const tool = useMemo(() => {
    if (!pageKey || !fieldKey) return null;
    return query.data?.find((entry) => entry.page_key === pageKey && entry.field_key === fieldKey) || null;
  }, [fieldKey, pageKey, query.data]);

  return {
    ...query,
    tool,
  };
}

export function useCreateGlobalHelpTool() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (input: GlobalHelpToolInput) => {
      const payload = {
        ...input,
        route_path: input.route_path ?? null,
        target_selector: input.target_selector ?? null,
        source_type: input.source_type ?? 'injected',
        icon_symbol: input.icon_symbol ?? 'info',
        created_by: profile?.id ?? null,
        updated_by: profile?.id ?? null,
      };
      const { data, error } = await (supabase as any)
        .from('global_help_tools')
        .insert(payload)
        .select('*')
        .single();

      if (error) throw error;
      return data as GlobalHelpTool;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['global-help-tools'] });
    },
  });
}

export function useUpdateGlobalHelpTool() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<
        Pick<
          GlobalHelpTool,
          'help_text' | 'is_active' | 'route_path' | 'target_selector' | 'source_type' | 'icon_symbol'
        >
      >;
    }) => {
      const payload = {
        ...patch,
        updated_by: profile?.id ?? null,
      };
      const { data, error } = await (supabase as any)
        .from('global_help_tools')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;
      return data as GlobalHelpTool;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['global-help-tools'] });
    },
  });
}

export function useUpsertGlobalHelpTool() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (input: GlobalHelpToolInput) => {
      const payload = {
        ...input,
        route_path: input.route_path ?? null,
        target_selector: input.target_selector ?? null,
        source_type: input.source_type ?? 'injected',
        icon_symbol: input.icon_symbol ?? 'info',
        updated_by: profile?.id ?? null,
      };

      const { data, error } = await (supabase as any)
        .from('global_help_tools')
        .upsert(payload, { onConflict: 'page_key,field_key' })
        .select('*')
        .single();

      if (error) throw error;
      return data as GlobalHelpTool;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['global-help-tools'] });
    },
  });
}

export function useSeedGlobalHelpTools() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (seeds: GlobalHelpToolSeed[]) => {
      if (seeds.length === 0) return { inserted: 0 };

      const { data: existingRows, error: existingError } = await (supabase as any)
        .from('global_help_tools')
        .select('page_key, field_key');
      if (existingError) throw existingError;

      const existingKeys = new Set(
        (existingRows || []).map((row: { page_key: string; field_key: string }) => `${row.page_key}:${row.field_key}`)
      );

      const missing = seeds.filter((seed) => !existingKeys.has(`${seed.pageKey}:${seed.fieldKey}`));
      if (missing.length === 0) return { inserted: 0 };

      const payload = missing.map((seed) => ({
        page_key: seed.pageKey,
        field_key: seed.fieldKey,
        help_text: seed.helpText,
        is_active: true,
        route_path: seed.routePath,
        target_selector: seed.targetSelector ?? null,
        source_type: seed.sourceType,
        icon_symbol: 'info',
        created_by: profile?.id ?? null,
        updated_by: profile?.id ?? null,
      }));

      const { error: insertError } = await (supabase as any)
        .from('global_help_tools')
        .insert(payload);
      if (insertError) throw insertError;

      return { inserted: payload.length };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['global-help-tools'] });
    },
  });
}
