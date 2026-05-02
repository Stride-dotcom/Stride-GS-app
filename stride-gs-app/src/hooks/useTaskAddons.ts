/**
 * useTaskAddons — Supabase CRUD for public.task_addons.
 *
 * Session 91. Add-on services attached to a task by staff/admin
 * (e.g. crate disposal, extra items charged on top of the primary
 * service). Rows accumulate on this table while the task is open and
 * get flushed to Billing_Ledger by handleCompleteTask_ in StrideAPI on
 * task completion.
 *
 * Snapshotting: the row stores `service_name`, `rate`, and `item_class`
 * at the time of add. If the price list later changes, already-added
 * addons keep their original rate (matches the snapshot pattern used by
 * existing billing rows).
 *
 * RLS: staff + admin only. Clients cannot read or write — addons are a
 * back-of-house billing concern.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface TaskAddon {
  id: string;
  tenantId: string;
  taskId: string;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  rate: number | null;
  itemClass: string | null;
  total: number | null;
  addedBy: string | null;
  addedByName: string;
  createdAt: string;
  updatedAt: string;
}

interface AddonRow {
  id: string;
  tenant_id: string;
  task_id: string;
  service_code: string;
  service_name: string;
  quantity: number | string | null;
  rate: number | string | null;
  item_class: string | null;
  total: number | string | null;
  added_by: string | null;
  added_by_name: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAddon(r: AddonRow): TaskAddon {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    taskId: r.task_id,
    serviceCode: r.service_code,
    serviceName: r.service_name,
    quantity: Number(r.quantity ?? 1),
    rate: r.rate == null ? null : Number(r.rate),
    itemClass: r.item_class,
    total: r.total == null ? null : Number(r.total),
    addedBy: r.added_by,
    addedByName: r.added_by_name ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface AddTaskAddonInput {
  serviceCode: string;
  serviceName: string;
  quantity: number;
  rate: number | null;
  itemClass: string | null;
}

export interface UseTaskAddonsResult {
  addons: TaskAddon[];
  loading: boolean;
  error: string | null;
  addAddon: (input: AddTaskAddonInput) => Promise<TaskAddon | null>;
  updateAddon: (id: string, patch: { quantity?: number; rate?: number | null }) => Promise<TaskAddon | null>;
  deleteAddon: (id: string) => Promise<boolean>;
  refetch: () => Promise<void>;
}

export function useTaskAddons(
  taskId: string | null | undefined,
  tenantId: string | null | undefined,
): UseTaskAddonsResult {
  const { user } = useAuth();
  const [addons, setAddons] = useState<TaskAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(taskId && tenantId);

  const refetch = useCallback(async () => {
    if (!enabled) { setAddons([]); setLoading(false); return; }
    setError(null);
    const { data, error: err } = await supabase
      .from('task_addons')
      .select('*')
      .eq('tenant_id', tenantId!)
      .eq('task_id', taskId!)
      .order('created_at', { ascending: true });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setAddons(((data ?? []) as AddonRow[]).map(rowToAddon));
    setLoading(false);
  }, [enabled, taskId, tenantId]);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`task_addons:${tenantId}:${taskId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_addons', filter: `task_id=eq.${taskId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, taskId, tenantId, refetch]);

  const addAddon = useCallback(async (input: AddTaskAddonInput): Promise<TaskAddon | null> => {
    if (!enabled) { setError('Missing taskId or tenantId'); return null; }
    const session = await supabase.auth.getSession();
    const authUserId = session.data.session?.user.id ?? null;
    const qty = Number(input.quantity) || 1;
    const rate = input.rate == null ? null : Number(input.rate);
    const total = rate == null ? null : Math.round(qty * rate * 100) / 100;

    const { data, error: err } = await supabase
      .from('task_addons')
      .insert({
        tenant_id: tenantId!,
        task_id: taskId!,
        service_code: input.serviceCode,
        service_name: input.serviceName,
        quantity: qty,
        rate,
        item_class: input.itemClass,
        total,
        added_by: authUserId,
        added_by_name: user?.displayName ?? user?.email ?? 'Unknown',
      })
      .select('*')
      .single();
    if (err || !data) {
      setError(err?.message ?? 'Failed to add service');
      return null;
    }
    const addon = rowToAddon(data as AddonRow);
    setAddons(prev => [...prev, addon]);
    return addon;
  }, [enabled, taskId, tenantId, user]);

  const deleteAddon = useCallback(async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('task_addons')
      .delete()
      .eq('id', id);
    if (err) {
      setError(err.message);
      return false;
    }
    setAddons(prev => prev.filter(a => a.id !== id));
    return true;
  }, []);

  /**
   * Update qty and/or rate on an existing addon. Recomputes total
   * server-side so the row's `total` column stays consistent. Used by
   * BillingPreviewCard's inline qty/rate inputs.
   */
  const updateAddon = useCallback(async (
    id: string,
    patch: { quantity?: number; rate?: number | null },
  ): Promise<TaskAddon | null> => {
    const current = addons.find(a => a.id === id);
    if (!current) return null;
    const qty = patch.quantity != null ? Number(patch.quantity) : current.quantity;
    const rate = patch.rate !== undefined
      ? (patch.rate == null ? null : Number(patch.rate))
      : current.rate;
    const total = rate == null ? null : Math.round(qty * rate * 100) / 100;
    const update: Record<string, unknown> = {
      quantity: qty,
      rate,
      total,
      updated_at: new Date().toISOString(),
    };
    const { data, error: err } = await supabase
      .from('task_addons')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (err || !data) {
      setError(err?.message ?? 'Failed to update service');
      return null;
    }
    const updated = rowToAddon(data as AddonRow);
    setAddons(prev => prev.map(a => (a.id === id ? updated : a)));
    return updated;
  }, [addons]);

  return useMemo(() => ({
    addons,
    loading,
    error,
    addAddon,
    updateAddon,
    deleteAddon,
    refetch,
  }), [addons, loading, error, addAddon, updateAddon, deleteAddon, refetch]);
}
