import { supabase } from '@/integrations/supabase/client';

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    const normalized = String(id).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export async function fetchPutAwayExcludedLocationIds(params: {
  tenantId: string;
  warehouseId: string;
}): Promise<string[]> {
  const { tenantId, warehouseId } = params;
  const { data, error } = await supabase
    .from('put_away_excluded_locations')
    .select('location_id')
    .eq('tenant_id', tenantId)
    .eq('warehouse_id', warehouseId);
  if (error) throw error;
  return uniqueIds((data || []).map((row) => row.location_id));
}

export async function replacePutAwayExcludedLocationIds(params: {
  tenantId: string;
  warehouseId: string;
  userId: string;
  locationIds: string[];
}): Promise<void> {
  const { tenantId, warehouseId, userId, locationIds } = params;
  const normalized = uniqueIds(locationIds);

  const { error: deleteError } = await supabase
    .from('put_away_excluded_locations')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('warehouse_id', warehouseId);
  if (deleteError) throw deleteError;

  if (normalized.length === 0) return;

  const payload = normalized.map((locationId) => ({
    tenant_id: tenantId,
    warehouse_id: warehouseId,
    location_id: locationId,
    created_by: userId,
  }));
  const { error: insertError } = await supabase
    .from('put_away_excluded_locations')
    .insert(payload);
  if (insertError) throw insertError;
}

export async function fetchFlagSpecialStorageRequirement(params: {
  tenantId: string;
  serviceCode: string;
}): Promise<{
  requiresSpecialStorage: boolean;
  chargeTypeId: string | null;
}> {
  const { tenantId, serviceCode } = params;
  const { data, error } = await supabase
    .from('put_away_flag_storage_requirements')
    .select('requires_special_storage, charge_type_id')
    .eq('tenant_id', tenantId)
    .eq('service_code', serviceCode)
    .maybeSingle();
  if (error) throw error;

  return {
    requiresSpecialStorage: Boolean(data?.requires_special_storage),
    chargeTypeId: data?.charge_type_id || null,
  };
}

export async function upsertFlagSpecialStorageRequirement(params: {
  tenantId: string;
  userId: string;
  serviceCode: string;
  chargeTypeId?: string | null;
  requiresSpecialStorage: boolean;
}): Promise<void> {
  const { tenantId, userId, serviceCode, chargeTypeId = null, requiresSpecialStorage } = params;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('put_away_flag_storage_requirements')
    .upsert(
      [
        {
          tenant_id: tenantId,
          service_code: serviceCode,
          charge_type_id: chargeTypeId,
          requires_special_storage: requiresSpecialStorage,
          created_by: userId,
          updated_by: userId,
          updated_at: nowIso,
        },
      ],
      { onConflict: 'tenant_id,service_code' },
    );
  if (error) throw error;
}

export async function fetchFlagLocationSelectionsByWarehouse(params: {
  tenantId: string;
  serviceCode: string;
}): Promise<Record<string, string[]>> {
  const { tenantId, serviceCode } = params;
  const { data, error } = await supabase
    .from('location_flag_links')
    .select('location_id, location:locations!location_flag_links_location_id_fkey(id, warehouse_id)')
    .eq('tenant_id', tenantId)
    .eq('service_code', serviceCode);
  if (error) throw error;

  const out: Record<string, string[]> = {};
  for (const row of data || []) {
    const locationId = row?.location_id as string | null;
    const warehouseId = row?.location?.warehouse_id as string | null;
    if (!locationId || !warehouseId) continue;
    const current = out[warehouseId] || [];
    if (!current.includes(locationId)) {
      out[warehouseId] = [...current, locationId];
    }
  }
  return out;
}

export async function replaceFlagLocationSelectionsByWarehouse(params: {
  tenantId: string;
  userId: string;
  serviceCode: string;
  selectionsByWarehouse: Record<string, string[]>;
  chargeTypeId?: string | null;
}): Promise<void> {
  const { tenantId, userId, serviceCode, selectionsByWarehouse, chargeTypeId = null } = params;

  const { error: deleteError } = await supabase
    .from('location_flag_links')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('service_code', serviceCode);
  if (deleteError) throw deleteError;

  const insertRows = uniqueIds(
    Object.values(selectionsByWarehouse).flatMap((ids) => ids || []),
  ).map((locationId) => ({
    tenant_id: tenantId,
    location_id: locationId,
    service_code: serviceCode,
    charge_type_id: chargeTypeId,
    created_by: userId,
  }));

  if (insertRows.length === 0) return;
  const { error: insertError } = await supabase
    .from('location_flag_links')
    .insert(insertRows);
  if (insertError) throw insertError;
}

export async function fetchRequiredSpecialStorageServiceCodes(params: {
  tenantId: string;
}): Promise<Set<string>> {
  const { tenantId } = params;
  const { data, error } = await supabase
    .from('put_away_flag_storage_requirements')
    .select('service_code')
    .eq('tenant_id', tenantId)
    .eq('requires_special_storage', true);
  if (error) throw error;

  return new Set(
    uniqueIds((data || []).map((row) => row.service_code)),
  );
}
