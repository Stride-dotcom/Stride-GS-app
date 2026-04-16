import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface FieldHelpEntry {
  id: string;
  tenant_id: string;
  page_key: string;
  field_key: string;
  help_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

interface UseFieldHelpEntriesParams {
  search?: string;
  pageKey?: string;
  includeInactive?: boolean;
}

export function useFieldHelpEntries(params: UseFieldHelpEntriesParams = {}) {
  const { session, profile } = useAuth();
  const includeInactive = params.includeInactive ?? true;
  const tenantId = profile?.tenant_id ?? null;
  const userId = session?.user?.id ?? null;
  const queryScope = `${tenantId ?? 'no-tenant'}:${userId ?? 'no-user'}`;

  return useQuery<FieldHelpEntry[]>({
    queryKey: ['field-help-entries', queryScope, params],
    enabled: !!session && !!tenantId,
    queryFn: async () => {
      if (!tenantId) return [];

      let query = (supabase as any).from('field_help_content')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('page_key', { ascending: true })
        .order('field_key', { ascending: true });

      if (params.pageKey) {
        query = query.eq('page_key', params.pageKey);
      }

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const search = params.search?.trim();
      if (search) {
        const like = `%${search}%`;
        query = query.or(`page_key.ilike.${like},field_key.ilike.${like},help_text.ilike.${like}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as FieldHelpEntry[];
    },
    staleTime: 30_000,
  });
}

export function useFieldHelpTooltip(pageKey?: string, fieldKey?: string) {
  const { session, profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const userId = session?.user?.id ?? null;
  const queryScope = `${tenantId ?? 'no-tenant'}:${userId ?? 'no-user'}`;
  const enabled = !!session && !!tenantId && !!pageKey && !!fieldKey;

  const query = useQuery<string | null>({
    queryKey: ['field-help-tooltip', queryScope, pageKey, fieldKey],
    enabled,
    queryFn: async () => {
      if (!tenantId) return null;

      const { data, error } = await (supabase as any).from('field_help_content')
        .select('help_text, is_active')
        .eq('tenant_id', tenantId)
        .eq('page_key', pageKey)
        .eq('field_key', fieldKey)
        .maybeSingle();

      if (error) throw error;
      if (!data || data.is_active === false) return null;
      return (data.help_text as string) || null;
    },
    staleTime: 60_000,
  });

  return {
    ...query,
    helpText: enabled ? query.data ?? null : null,
  };
}

interface UpsertFieldHelpInput {
  page_key: string;
  field_key: string;
  help_text: string;
  is_active?: boolean;
}

export function useUpsertFieldHelpEntry() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertFieldHelpInput) => {
      if (!profile?.tenant_id) throw new Error('No tenant context');

      const payload = {
        tenant_id: profile.tenant_id,
        page_key: input.page_key.trim(),
        field_key: input.field_key.trim(),
        help_text: input.help_text.trim(),
        is_active: input.is_active ?? true,
        updated_by: profile.id ?? null,
      };

      const { data, error } = await (supabase as any).from('field_help_content')
        .upsert(payload, { onConflict: 'tenant_id,page_key,field_key' })
        .select('*')
        .single();

      if (error) throw error;
      return data as FieldHelpEntry;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['field-help-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['field-help-tooltip'] }),
      ]);
    },
  });
}

export function useUpdateFieldHelpEntry() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<FieldHelpEntry, 'help_text' | 'is_active'>>;
    }) => {
      const payload = {
        ...patch,
        updated_by: profile?.id ?? null,
      };

      const { data, error } = await (supabase as any).from('field_help_content')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;
      return data as FieldHelpEntry;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['field-help-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['field-help-tooltip'] }),
      ]);
    },
  });
}

export function useFieldHelpPageKeys(entries: FieldHelpEntry[]) {
  return useMemo(
    () => [...new Set(entries.map((entry) => entry.page_key))].sort((a, b) => a.localeCompare(b)),
    [entries]
  );
}
