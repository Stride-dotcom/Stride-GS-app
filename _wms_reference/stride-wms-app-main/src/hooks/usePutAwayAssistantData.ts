import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { usePermissions } from '@/hooks/usePermissions';

export interface PutAwaySourceLocation {
  id: string;
  code: string;
  name: string | null;
}

export interface PutAwayAssistantItem {
  id: string;
  item_code: string;
  description: string | null;
  current_location_id: string | null;
  current_location_code: string | null;
  received_at: string | null;
  size: number | null;
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    const v = id.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function usePutAwayAssistantData() {
  const { profile } = useAuth();
  const { hasRole } = usePermissions();
  const { selectedWarehouseId, warehouses } = useSelectedWarehouse();

  const [loadingSources, setLoadingSources] = useState(true);
  const [savingSources, setSavingSources] = useState(false);
  const [extraSourceLocations, setExtraSourceLocations] = useState<PutAwaySourceLocation[]>([]);

  const [loadingItems, setLoadingItems] = useState(true);
  const [items, setItems] = useState<PutAwayAssistantItem[]>([]);
  const [putAwayCount, setPutAwayCount] = useState(0);
  const [putAwayUrgentCount, setPutAwayUrgentCount] = useState(0);
  const [putAwayTimeEstimate, setPutAwayTimeEstimate] = useState(0);

  const selectedWarehouse = useMemo(
    () => warehouses.find((w) => w.id === selectedWarehouseId) || null,
    [warehouses, selectedWarehouseId],
  );

  const defaultReceivingLocationId =
    (selectedWarehouse as any)?.default_receiving_location_id || null;

  const canEditSources =
    hasRole('admin') || hasRole('manager') || hasRole('admin_dev');

  const sourceLocationIds = useMemo(
    () =>
      uniqueIds([
        defaultReceivingLocationId,
        ...extraSourceLocations.map((l) => l.id),
      ]),
    [defaultReceivingLocationId, extraSourceLocations],
  );

  const sourceLocations = useMemo(() => {
    const defaults: PutAwaySourceLocation[] = [];
    if (defaultReceivingLocationId) {
      const defaultLoc = extraSourceLocations.find((l) => l.id === defaultReceivingLocationId);
      if (defaultLoc) {
        defaults.push(defaultLoc);
      } else {
        defaults.push({
          id: defaultReceivingLocationId,
          code: 'DEFAULT RECEIVING',
          name: null,
        });
      }
    }

    const extras = extraSourceLocations.filter((l) => l.id !== defaultReceivingLocationId);
    return [...defaults, ...extras];
  }, [defaultReceivingLocationId, extraSourceLocations]);

  const fetchSources = useCallback(async () => {
    if (!profile?.tenant_id || !selectedWarehouseId) {
      setExtraSourceLocations([]);
      setLoadingSources(false);
      return;
    }

    try {
      setLoadingSources(true);
      const { data, error } = await (supabase as any)
        .from('put_away_source_locations')
        .select(`
          location_id,
          location:locations!put_away_source_locations_location_id_fkey(id, code, name, warehouse_id)
        `)
        .eq('tenant_id', profile.tenant_id)
        .eq('warehouse_id', selectedWarehouseId);

      if (error) throw error;

      const mapped: PutAwaySourceLocation[] = (data || [])
        .map((row: any) => {
          const loc = row?.location;
          if (!loc?.id || !loc?.code) return null;
          return {
            id: loc.id as string,
            code: loc.code as string,
            name: (loc.name as string | null) || null,
          };
        })
        .filter(Boolean) as PutAwaySourceLocation[];

      setExtraSourceLocations(mapped);
    } catch (err) {
      console.error('[usePutAwayAssistantData] Failed to fetch source locations:', err);
      setExtraSourceLocations([]);
    } finally {
      setLoadingSources(false);
    }
  }, [profile?.tenant_id, selectedWarehouseId]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const updateExtraSourceLocationIds = useCallback(
    async (nextLocationIds: string[]) => {
      if (!profile?.tenant_id || !profile?.id || !selectedWarehouseId) return false;
      if (!canEditSources) return false;

      const normalized = uniqueIds(nextLocationIds).filter((id) => id !== defaultReceivingLocationId);
      setSavingSources(true);
      try {
        const { error: deleteError } = await (supabase as any)
          .from('put_away_source_locations')
          .delete()
          .eq('tenant_id', profile.tenant_id)
          .eq('warehouse_id', selectedWarehouseId);

        if (deleteError) throw deleteError;

        if (normalized.length > 0) {
          const payload = normalized.map((locationId) => ({
            tenant_id: profile.tenant_id,
            warehouse_id: selectedWarehouseId,
            location_id: locationId,
            created_by: profile.id,
          }));

          const { error: insertError } = await (supabase as any)
            .from('put_away_source_locations')
            .insert(payload);

          if (insertError) throw insertError;
        }

        await fetchSources();
        return true;
      } catch (err) {
        console.error('[usePutAwayAssistantData] Failed to update source locations:', err);
        return false;
      } finally {
        setSavingSources(false);
      }
    },
    [
      canEditSources,
      defaultReceivingLocationId,
      fetchSources,
      profile?.id,
      profile?.tenant_id,
      selectedWarehouseId,
    ],
  );

  const fetchItems = useCallback(async () => {
    if (!profile?.tenant_id || !selectedWarehouseId || sourceLocationIds.length === 0) {
      setItems([]);
      setPutAwayCount(0);
      setPutAwayUrgentCount(0);
      setPutAwayTimeEstimate(0);
      setLoadingItems(false);
      return;
    }

    try {
      setLoadingItems(true);
      const urgentCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [
        { count: totalCount, error: totalErr },
        { count: urgentCount, error: urgentErr },
        { data: itemRows, error: rowsErr },
        { data: serviceRows, error: serviceErr },
      ] = await Promise.all([
        (supabase.from('items') as any)
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', profile.tenant_id)
          .eq('status', 'active')
          .is('deleted_at', null)
          .in('current_location_id', sourceLocationIds),
        (supabase.from('items') as any)
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', profile.tenant_id)
          .eq('status', 'active')
          .is('deleted_at', null)
          .in('current_location_id', sourceLocationIds)
          .lt('received_at', urgentCutoffIso),
        (supabase.from('items') as any)
          .select(`
            id,
            item_code,
            description,
            current_location_id,
            received_at,
            size,
            location:locations!items_current_location_id_fkey(id, code, name)
          `)
          .eq('tenant_id', profile.tenant_id)
          .eq('status', 'active')
          .is('deleted_at', null)
          .in('current_location_id', sourceLocationIds)
          .order('received_at', { ascending: true })
          .limit(250),
        (supabase.from('service_events') as any)
          .select('service_code, service_time_minutes')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_active', true)
          .in('service_code', ['PUT_AWAY', 'PUTAWAY']),
      ]);

      if (totalErr) throw totalErr;
      if (urgentErr) throw urgentErr;
      if (rowsErr) throw rowsErr;
      if (serviceErr) throw serviceErr;

      const mappedItems: PutAwayAssistantItem[] = (itemRows || []).map((row: any) => ({
        id: row.id,
        item_code: row.item_code,
        description: row.description || null,
        current_location_id: row.current_location_id || null,
        current_location_code: row.location?.code || null,
        received_at: row.received_at || null,
        size: row.size != null ? Number(row.size) : null,
      }));

      const times = (serviceRows || [])
        .map((r: any) => Number(r.service_time_minutes))
        .filter((v: number) => Number.isFinite(v) && v > 0);
      const avgTime = times.length > 0
        ? Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length)
        : 2;

      const count = totalCount || 0;
      setItems(mappedItems);
      setPutAwayCount(count);
      setPutAwayUrgentCount(urgentCount || 0);
      setPutAwayTimeEstimate(count * avgTime);
    } catch (err) {
      console.error('[usePutAwayAssistantData] Failed to fetch items:', err);
      setItems([]);
      setPutAwayCount(0);
      setPutAwayUrgentCount(0);
      setPutAwayTimeEstimate(0);
    } finally {
      setLoadingItems(false);
    }
  }, [profile?.tenant_id, selectedWarehouseId, sourceLocationIds]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return {
    selectedWarehouse,
    selectedWarehouseId,
    defaultReceivingLocationId,
    sourceLocationIds,
    sourceLocations,
    extraSourceLocations,
    canEditSources,
    loadingSources,
    savingSources,
    updateExtraSourceLocationIds,
    items,
    putAwayCount,
    putAwayUrgentCount,
    putAwayTimeEstimate,
    loadingItems,
    loading: loadingSources || loadingItems,
    refetch: fetchItems,
    refetchSources: fetchSources,
  };
}
