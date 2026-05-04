/**
 * useEntityAddons — Supabase CRUD for public.addons (polymorphic).
 *
 * v38.173.0. Replaces the task-shaped useTaskAddons hook. Same shape +
 * snapshotting semantics, but keys on (parent_type, parent_id) so any
 * entity (task / repair / will_call / inventory) can attach billable
 * add-on services. Materialized to Billing_Ledger by the GAS helper
 * api_writeAddonsToLedger_ at the entity's completion event (task
 * complete / repair complete / WC release).
 *
 * Snapshotting: service_name + rate + item_class are captured at the
 * time of add. If the price list later changes, already-added addons
 * keep their original rate.
 *
 * RLS: staff + admin only. Clients have no read/write access.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export type EntityAddonParent = 'task' | 'repair' | 'will_call' | 'inventory';

export interface EntityAddon {
  id: string;
  tenantId: string;
  parentType: EntityAddonParent;
  parentId: string;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  rate: number | null;
  itemClass: string | null;
  total: number | null;
  addedBy: string | null;
  addedByName: string;
  billed: boolean;
  billedAt: string | null;
  ledgerRowId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AddonRow {
  id: string;
  tenant_id: string;
  parent_type: EntityAddonParent;
  parent_id: string;
  service_code: string;
  service_name: string;
  quantity: number | string | null;
  rate: number | string | null;
  item_class: string | null;
  total: number | string | null;
  added_by: string | null;
  added_by_name: string | null;
  billed: boolean | null;
  billed_at: string | null;
  ledger_row_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAddon(r: AddonRow): EntityAddon {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    parentType: r.parent_type,
    parentId: r.parent_id,
    serviceCode: r.service_code,
    serviceName: r.service_name,
    quantity: Number(r.quantity ?? 1),
    rate: r.rate == null ? null : Number(r.rate),
    itemClass: r.item_class,
    total: r.total == null ? null : Number(r.total),
    addedBy: r.added_by,
    addedByName: r.added_by_name ?? '',
    billed: Boolean(r.billed),
    billedAt: r.billed_at,
    ledgerRowId: r.ledger_row_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface AddEntityAddonInput {
  serviceCode: string;
  serviceName: string;
  quantity: number;
  rate: number | null;
  itemClass: string | null;
}

export interface UseEntityAddonsResult {
  addons: EntityAddon[];
  loading: boolean;
  error: string | null;
  addAddon: (input: AddEntityAddonInput) => Promise<EntityAddon | null>;
  updateAddon: (id: string, patch: { quantity?: number; rate?: number | null }) => Promise<EntityAddon | null>;
  deleteAddon: (id: string) => Promise<boolean>;
  refetch: () => Promise<void>;
}

export function useEntityAddons(
  parentType: EntityAddonParent | null | undefined,
  parentId: string | null | undefined,
  tenantId: string | null | undefined,
): UseEntityAddonsResult {
  const { user } = useAuth();
  const [addons, setAddons] = useState<EntityAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(parentType && parentId && tenantId);

  const refetch = useCallback(async () => {
    if (!enabled) { setAddons([]); setLoading(false); return; }
    setError(null);
    const { data, error: err } = await supabase
      .from('addons')
      .select('*')
      .eq('tenant_id', tenantId!)
      .eq('parent_type', parentType!)
      .eq('parent_id', parentId!)
      .order('created_at', { ascending: true });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setAddons(((data ?? []) as AddonRow[]).map(rowToAddon));
    setLoading(false);
  }, [enabled, parentType, parentId, tenantId]);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`addons:${tenantId}:${parentType}:${parentId}`)
      .on('postgres_changes',
        // Subscribe broadly on tenant — supabase-js doesn't compose multi-
        // column filters here, and the handler refetches with the precise
        // (parent_type, parent_id) eq filters anyway. Worst case is a
        // refetch on an unrelated addon edit in the same tenant — cheap.
        { event: '*', schema: 'public', table: 'addons', filter: `tenant_id=eq.${tenantId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, parentType, parentId, tenantId, refetch]);

  const addAddon = useCallback(async (input: AddEntityAddonInput): Promise<EntityAddon | null> => {
    if (!enabled) { setError('Missing parent or tenant'); return null; }
    const session = await supabase.auth.getSession();
    const authUserId = session.data.session?.user.id ?? null;
    const qty = Number(input.quantity) || 1;
    const rate = input.rate == null ? null : Number(input.rate);
    const total = rate == null ? null : Math.round(qty * rate * 100) / 100;

    const { data, error: err } = await supabase
      .from('addons')
      .insert({
        tenant_id: tenantId!,
        parent_type: parentType!,
        parent_id: parentId!,
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
  }, [enabled, parentType, parentId, tenantId, user]);

  const deleteAddon = useCallback(async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('addons')
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
   * Update qty and/or rate on an existing addon. Recomputes total so
   * the row's `total` column stays consistent. Used by the inline
   * qty/rate inputs inside BillingPreviewCard.
   */
  const updateAddon = useCallback(async (
    id: string,
    patch: { quantity?: number; rate?: number | null },
  ): Promise<EntityAddon | null> => {
    const current = addons.find(a => a.id === id);
    if (!current) return null;
    if (current.billed) {
      // Already materialized to the ledger — staff edits should go
      // against the Billing_Ledger row instead, not the addon snapshot.
      setError('Cannot edit a billed addon');
      return null;
    }
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
      .from('addons')
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
