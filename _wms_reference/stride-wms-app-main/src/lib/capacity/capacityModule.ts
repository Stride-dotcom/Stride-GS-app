import { supabase } from '@/integrations/supabase/client';

interface CapacityLocationRow {
  id: string;
  code: string;
  group_code: string | null;
  capacity_cuft: number | null;
  capacity_cu_ft: number | null;
}

interface CapacityCacheRow {
  location_id: string;
  used_cuft: number | null;
  available_cuft: number | null;
}

interface LocationItemAggregate {
  used: number;
  accounts: Set<string>;
  vendors: Set<string>;
  itemCodes: Set<string>;
}

export interface WarehouseCapacitySummary {
  measuredCount: number;
  totalCount: number;
  totalUsed: number;
  totalCapacity: number;
  utilization: number;
}

export interface WarehouseMapZoneCapacityRow {
  zone_id: string | null;
  zone_code: string | null;
  zone_description: string | null;
  node_id: string;
  node_label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  used_cu_ft: number | null;
  capacity_cu_ft: number | null;
  free_cu_ft: number | null;
  utilization_pct: number | null;
  state: string | null;
  location_count: number | null;
}

export interface WarehouseMapLocationCapacityRow {
  location_id: string;
  location_code: string;
  zone_id: string;
  used_cu_ft: number | null;
  capacity_cu_ft: number | null;
  free_cu_ft: number | null;
  utilization_pct: number | null;
}

export interface CapacitySuggestionRow {
  location_id: string;
  location_code: string;
  capacity_cuft: number;
  used_cuft: number;
  available_cuft: number;
  utilization_pct: number;
  flag_compliant: boolean;
  account_cluster: boolean;
  sku_or_vendor_match: boolean;
  group_match: boolean;
  leftover_cuft: number;
  overflow: boolean;
}

export interface SharedLocationSuggestionsParams {
  tenantId: string;
  warehouseId: string;
  mode: 'single' | 'batch';
  itemId?: string | null;
  itemIds?: string[];
  topN?: number;
}

export interface SpecialStorageComplianceResult {
  isCompliant: boolean;
  requiredFlags: string[];
  enforcedFlags: string[];
  unresolvedFlags: string[];
  missingFlags: string[];
}

function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCapacity(location: CapacityLocationRow): number | null {
  const capacity = location.capacity_cuft ?? location.capacity_cu_ft;
  return capacity == null ? null : toNum(capacity);
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    const normalized = String(id).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function fetchWarehouseLocations(warehouseId: string): Promise<CapacityLocationRow[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('id, code, group_code, capacity_cuft, capacity_cu_ft')
    .eq('warehouse_id', warehouseId)
    .is('deleted_at', null);

  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    code: row.code,
    group_code: row.group_code || null,
    capacity_cuft: row.capacity_cuft != null ? toNum(row.capacity_cuft) : null,
    capacity_cu_ft: row.capacity_cu_ft != null ? toNum(row.capacity_cu_ft) : null,
  }));
}

export async function fetchWarehouseMapZoneCapacity(params: {
  mapId: string;
}): Promise<WarehouseMapZoneCapacityRow[]> {
  const { mapId } = params;
  const { data, error } = await supabase.rpc('rpc_get_warehouse_map_zone_capacity', {
    p_map_id: mapId,
  });
  if (error) {
    console.error('[capacityModule] Failed to fetch warehouse map zone capacity:', error);
    throw error;
  }
  return (data || []).map((row) => ({
    zone_id: row.zone_id || null,
    zone_code: row.zone_code || null,
    zone_description: row.zone_description || null,
    node_id: row.node_id,
    node_label: row.node_label || null,
    x: toNum(row.x),
    y: toNum(row.y),
    width: toNum(row.width),
    height: toNum(row.height),
    used_cu_ft: row.used_cu_ft != null ? toNum(row.used_cu_ft) : null,
    capacity_cu_ft: row.capacity_cu_ft != null ? toNum(row.capacity_cu_ft) : null,
    free_cu_ft: row.free_cu_ft != null ? toNum(row.free_cu_ft) : null,
    utilization_pct: row.utilization_pct != null ? toNum(row.utilization_pct) : null,
    state: row.state || null,
    location_count: row.location_count != null ? toNum(row.location_count) : null,
  }));
}

export async function fetchWarehouseZoneLocationCapacity(params: {
  mapId: string;
  zoneId: string;
}): Promise<WarehouseMapLocationCapacityRow[]> {
  const { mapId, zoneId } = params;
  const { data, error } = await supabase.rpc('rpc_get_warehouse_zone_location_capacity', {
    p_map_id: mapId,
    p_zone_id: zoneId,
  });
  if (error) {
    console.error('[capacityModule] Failed to fetch warehouse zone location capacity:', error);
    throw error;
  }
  return (data || []).map((row) => ({
    location_id: row.location_id,
    location_code: row.location_code,
    zone_id: row.zone_id,
    used_cu_ft: row.used_cu_ft != null ? toNum(row.used_cu_ft) : null,
    capacity_cu_ft: row.capacity_cu_ft != null ? toNum(row.capacity_cu_ft) : null,
    free_cu_ft: row.free_cu_ft != null ? toNum(row.free_cu_ft) : null,
    utilization_pct: row.utilization_pct != null ? toNum(row.utilization_pct) : null,
  }));
}

async function fetchWarehouseSuggestionRuleContext(params: {
  tenantId: string;
  warehouseId: string;
}) {
  const { tenantId, warehouseId } = params;

  const [warehouseRes, sourceRes, exclusionRes, requiredFlagsRes] = await Promise.all([
    supabase
      .from('warehouses')
      .select('default_receiving_location_id')
      .eq('id', warehouseId)
      .maybeSingle(),
    supabase
      .from('put_away_source_locations')
      .select('location_id')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', warehouseId),
    supabase
      .from('put_away_excluded_locations')
      .select('location_id')
      .eq('tenant_id', tenantId)
      .eq('warehouse_id', warehouseId),
    supabase
      .from('put_away_flag_storage_requirements')
      .select('service_code')
      .eq('tenant_id', tenantId)
      .eq('requires_special_storage', true),
  ]);

  if (warehouseRes.error) {
    console.error('[capacityModule] Failed to fetch warehouse rule context:', warehouseRes.error);
  }

  const sourceIds = sourceRes.error
    ? sourceRes.error.code === '42P01'
      ? []
      : (console.error('[capacityModule] Failed to fetch put-away source locations:', sourceRes.error), [])
    : uniqueIds((sourceRes.data || []).map((row: { location_id: string | null }) => row.location_id));

  const excludedIds = exclusionRes.error
    ? exclusionRes.error.code === '42P01'
      ? []
      : (console.error('[capacityModule] Failed to fetch put-away excluded locations:', exclusionRes.error), [])
    : uniqueIds((exclusionRes.data || []).map((row: { location_id: string | null }) => row.location_id));

  const requiredSpecialStorageFlags = requiredFlagsRes.error
    ? requiredFlagsRes.error.code === '42P01'
      ? new Set<string>()
      : (console.error('[capacityModule] Failed to fetch special-storage requirement flags:', requiredFlagsRes.error), new Set<string>())
    : new Set(
        uniqueIds((requiredFlagsRes.data || []).map((row: { service_code: string | null }) => row.service_code)),
      );

  const defaultReceivingLocationId = warehouseRes.data?.default_receiving_location_id || null;
  const autoExcluded = uniqueIds([defaultReceivingLocationId, ...sourceIds, ...excludedIds]);

  return {
    excludedLocationIds: new Set(autoExcluded),
    requiredSpecialStorageFlags,
  };
}

async function fetchCapacityCacheByLocation(locationIds: string[]): Promise<Map<string, CapacityCacheRow>> {
  if (locationIds.length === 0) return new Map<string, CapacityCacheRow>();
  const { data, error } = await supabase
    .from('location_capacity_cache')
    .select('location_id, used_cuft, available_cuft')
    .in('location_id', locationIds);

  if (error) {
    console.error('[capacityModule] Failed to fetch capacity cache rows:', error);
    return new Map<string, CapacityCacheRow>();
  }

  const out = new Map<string, CapacityCacheRow>();
  for (const row of data || []) {
    out.set(row.location_id, {
      location_id: row.location_id,
      used_cuft: row.used_cuft != null ? toNum(row.used_cuft) : null,
      available_cuft: row.available_cuft != null ? toNum(row.available_cuft) : null,
    });
  }
  return out;
}

async function fetchSuggestionItems(
  tenantId: string,
  itemIds: string[],
): Promise<Array<{
  id: string;
  size: number | null;
  account_id: string | null;
  vendor: string | null;
  item_code: string | null;
  current_location_id: string | null;
  location_id: string | null;
}>> {
  if (itemIds.length === 0) return [];
  const { data, error } = await supabase
    .from('items')
    .select('id, size, account_id, vendor, item_code, current_location_id, location_id')
    .eq('tenant_id', tenantId)
    .in('id', itemIds)
    .is('deleted_at', null);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    size: row.size != null ? toNum(row.size) : null,
    account_id: row.account_id || null,
    vendor: row.vendor || null,
    item_code: row.item_code || null,
    current_location_id: row.current_location_id || null,
    location_id: row.location_id || null,
  }));
}

async function fetchItemFlagsByItemId(
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, Set<string>>> {
  if (itemIds.length === 0) return new Map<string, Set<string>>();
  const { data, error } = await supabase
    .from('item_flags')
    .select('item_id, service_code')
    .eq('tenant_id', tenantId)
    .in('item_id', itemIds);

  if (error) {
    console.error('[capacityModule] Failed to fetch item flags for suggestions:', error);
    return new Map<string, Set<string>>();
  }

  const out = new Map<string, Set<string>>();
  for (const row of data || []) {
    const current = out.get(row.item_id) || new Set<string>();
    if (row.service_code) current.add(row.service_code);
    out.set(row.item_id, current);
  }
  return out;
}

async function fetchFlagConfiguredLocationIdsByService(params: {
  tenantId: string;
  warehouseId: string;
  serviceCodes: Set<string>;
}): Promise<Map<string, Set<string>>> {
  const { tenantId, warehouseId, serviceCodes } = params;
  const serviceCodeList = [...serviceCodes];
  const output = new Map<string, Set<string>>();
  for (const code of serviceCodeList) output.set(code, new Set<string>());
  if (serviceCodeList.length === 0) return output;

  const { data, error } = await supabase
    .from('location_flag_links')
    .select('service_code, location_id, location:locations!location_flag_links_location_id_fkey(id, warehouse_id)')
    .eq('tenant_id', tenantId)
    .in('service_code', serviceCodeList);

  if (error) {
    console.error('[capacityModule] Failed to fetch configured location flags:', error);
    return output;
  }

  for (const row of data || []) {
    const serviceCode = row?.service_code as string | null;
    const locationId = row?.location_id as string | null;
    const locationWarehouseId = row?.location?.warehouse_id as string | null;
    if (!serviceCode || !locationId || locationWarehouseId !== warehouseId) continue;
    const current = output.get(serviceCode) || new Set<string>();
    current.add(locationId);
    output.set(serviceCode, current);
  }

  return output;
}

async function fetchLocationItemAggregates(
  tenantId: string,
  locationIds: string[],
): Promise<Map<string, LocationItemAggregate>> {
  if (locationIds.length === 0) return new Map<string, LocationItemAggregate>();

  const [{ data: currentRows, error: currentErr }, { data: legacyRows, error: legacyErr }] = await Promise.all([
    supabase
      .from('items')
      .select('id, current_location_id, account_id, vendor, item_code, size')
      .eq('tenant_id', tenantId)
      .in('current_location_id', locationIds)
      .is('deleted_at', null),
    supabase
      .from('items')
      .select('id, location_id, account_id, vendor, item_code, size')
      .eq('tenant_id', tenantId)
      .in('location_id', locationIds)
      .is('current_location_id', null)
      .is('deleted_at', null),
  ]);

  if (currentErr || legacyErr) {
    console.error('[capacityModule] Failed to fetch location item aggregates:', {
      currentErr,
      legacyErr,
    });
    return new Map<string, LocationItemAggregate>();
  }

  const byLocationId = new Map<string, LocationItemAggregate>();
  const seenItemIds = new Set<string>();
  const upsert = (
    locationId: string | null,
    itemId: string,
    accountId: string | null,
    vendor: string | null,
    itemCode: string | null,
    size: unknown,
  ) => {
    if (!locationId || seenItemIds.has(itemId)) return;
    seenItemIds.add(itemId);
    const current = byLocationId.get(locationId) || {
      used: 0,
      accounts: new Set<string>(),
      vendors: new Set<string>(),
      itemCodes: new Set<string>(),
    };
    current.used += toNum(size);
    if (accountId) current.accounts.add(accountId);
    if (vendor) current.vendors.add(vendor);
    if (itemCode) current.itemCodes.add(itemCode);
    byLocationId.set(locationId, current);
  };

  for (const row of currentRows || []) {
    upsert(
      row.current_location_id || null,
      row.id,
      row.account_id || null,
      row.vendor || null,
      row.item_code || null,
      row.size,
    );
  }
  for (const row of legacyRows || []) {
    upsert(
      row.location_id || null,
      row.id,
      row.account_id || null,
      row.vendor || null,
      row.item_code || null,
      row.size,
    );
  }

  return byLocationId;
}

function resolveRequiredSpecialFlagsForItem(params: {
  itemFlags: Set<string>;
  requiredSpecialStorageFlags: Set<string>;
  configuredLocationIdsByFlag: Map<string, Set<string>>;
}) {
  const { itemFlags, requiredSpecialStorageFlags, configuredLocationIdsByFlag } = params;
  const requiredFlags = [...itemFlags].filter((flag) => requiredSpecialStorageFlags.has(flag));
  const enforcedFlags: string[] = [];
  const unresolvedFlags: string[] = [];
  for (const flag of requiredFlags) {
    const configured = configuredLocationIdsByFlag.get(flag);
    if (configured && configured.size > 0) enforcedFlags.push(flag);
    else unresolvedFlags.push(flag);
  }
  return { requiredFlags, enforcedFlags, unresolvedFlags };
}

function getUsedAndAvailable(
  location: CapacityLocationRow,
  cacheByLoc: Map<string, CapacityCacheRow>,
  aggregatesByLoc: Map<string, LocationItemAggregate>,
) {
  const capacity = normalizeCapacity(location);
  const aggregate = aggregatesByLoc.get(location.id);
  const cache = cacheByLoc.get(location.id);
  const cacheUsed = cache?.used_cuft != null ? toNum(cache.used_cuft) : 0;
  const aggregateUsed = toNum(aggregate?.used);
  // Prefer the higher signal to avoid stale cache rows masking true occupancy.
  const used = Math.max(cacheUsed, aggregateUsed);
  const available = Math.max(toNum(capacity) - used, 0);
  return { capacity, used, available };
}

function sortSuggestionRows(rows: CapacitySuggestionRow[]) {
  rows.sort((a, b) => {
    if (a.flag_compliant !== b.flag_compliant) return a.flag_compliant ? -1 : 1;
    if (a.account_cluster !== b.account_cluster) return a.account_cluster ? -1 : 1;
    if (a.sku_or_vendor_match !== b.sku_or_vendor_match) return a.sku_or_vendor_match ? -1 : 1;
    if (a.group_match !== b.group_match) return a.group_match ? -1 : 1;
    if (a.overflow !== b.overflow) return a.overflow ? 1 : -1;
    if (!a.overflow && !b.overflow && a.leftover_cuft !== b.leftover_cuft) {
      return a.leftover_cuft - b.leftover_cuft;
    }
    if (a.available_cuft !== b.available_cuft) return b.available_cuft - a.available_cuft;
    return a.location_id.localeCompare(b.location_id);
  });
}

export async function fetchWarehouseCapacitySummary(params: {
  tenantId: string;
  warehouseId: string;
}): Promise<WarehouseCapacitySummary> {
  const { tenantId, warehouseId } = params;
  const locations = await fetchWarehouseLocations(warehouseId);
  const locationIds = locations.map((l) => l.id);
  const cacheByLoc = await fetchCapacityCacheByLocation(locationIds);
  const aggregatesByLoc = await fetchLocationItemAggregates(tenantId, locationIds);

  const measured = locations.filter((location) => normalizeCapacity(location) != null);
  const totalCapacity = measured.reduce((sum, location) => {
    const { capacity } = getUsedAndAvailable(location, cacheByLoc, aggregatesByLoc);
    return sum + toNum(capacity);
  }, 0);
  const totalUsed = measured.reduce((sum, location) => {
    const { used } = getUsedAndAvailable(location, cacheByLoc, aggregatesByLoc);
    return sum + used;
  }, 0);

  return {
    measuredCount: measured.length,
    totalCount: locations.length,
    totalUsed,
    totalCapacity,
    utilization: totalCapacity > 0 ? totalUsed / totalCapacity : 0,
  };
}

export async function buildPutAwayFallbackSuggestions(params: {
  tenantId: string;
  warehouseId: string;
  itemIds: string[];
  topN?: number;
}): Promise<Record<string, CapacitySuggestionRow[]>> {
  const { tenantId, warehouseId, topN = 3 } = params;
  const targetItemIds = Array.from(new Set(params.itemIds.filter(Boolean)));
  if (targetItemIds.length === 0) return {};

  const [locations, suggestionContext] = await Promise.all([
    fetchWarehouseLocations(warehouseId),
    fetchWarehouseSuggestionRuleContext({ tenantId, warehouseId }),
  ]);
  const candidates = locations.filter((location) => normalizeCapacity(location) != null);
  if (candidates.length === 0) {
    console.warn(
      '[buildPutAwayFallbackSuggestions] No locations with measured capacity found.',
      { warehouseId, totalLocations: locations.length },
    );
    return {};
  }

  const locationIds = candidates.map((location) => location.id);
  const [
    cacheByLoc,
    aggregatesByLoc,
    items,
    itemFlagsByItemId,
    configuredLocationIdsByFlag,
  ] = await Promise.all([
    fetchCapacityCacheByLocation(locationIds),
    fetchLocationItemAggregates(tenantId, locationIds),
    fetchSuggestionItems(tenantId, targetItemIds),
    fetchItemFlagsByItemId(tenantId, targetItemIds),
    fetchFlagConfiguredLocationIdsByService({
      tenantId,
      warehouseId,
      serviceCodes: suggestionContext.requiredSpecialStorageFlags,
    }),
  ]);

  const groupCodeByLocId = new Map<string, string | null>();
  for (const location of locations) {
    groupCodeByLocId.set(location.id, location.group_code || null);
  }

  const output: Record<string, CapacitySuggestionRow[]> = {};
  for (const item of items) {
    const required = toNum(item.size);
    const itemLocId = item.current_location_id || item.location_id || null;
    const itemGroupCode = itemLocId ? (groupCodeByLocId.get(itemLocId) || null) : null;
    const itemFlags = itemFlagsByItemId.get(item.id) || new Set<string>();
    const flagResolution = resolveRequiredSpecialFlagsForItem({
      itemFlags,
      requiredSpecialStorageFlags: suggestionContext.requiredSpecialStorageFlags,
      configuredLocationIdsByFlag,
    });

    const allowedCandidates = candidates.filter((location) => {
      if (suggestionContext.excludedLocationIds.has(location.id)) return false;
      return flagResolution.enforcedFlags.every((flag) => {
        const allowedLocs = configuredLocationIdsByFlag.get(flag);
        return !!allowedLocs && allowedLocs.has(location.id);
      });
    });

    const ranked = allowedCandidates.map((location) => {
      const { capacity, used, available } = getUsedAndAvailable(location, cacheByLoc, aggregatesByLoc);
      const aggregate = aggregatesByLoc.get(location.id);
      const flagCompliant = flagResolution.enforcedFlags.every((flag) => {
        const configured = configuredLocationIdsByFlag.get(flag);
        return !!configured && configured.has(location.id);
      });
      const accountCluster = !!item.account_id && !!aggregate && aggregate.accounts.has(item.account_id);
      const skuOrVendorMatch =
        (!!item.vendor && !!aggregate && aggregate.vendors.has(item.vendor))
        || (!!item.item_code && !!aggregate && aggregate.itemCodes.has(item.item_code));
      const groupMatch =
        !!itemGroupCode && !!location.group_code && itemGroupCode === location.group_code;
      const leftover = available - required;
      const overflow = leftover < -0.00001;

      const row: CapacitySuggestionRow = {
        location_id: location.id,
        location_code: location.code,
        capacity_cuft: toNum(capacity),
        used_cuft: used,
        available_cuft: available,
        utilization_pct: toNum(capacity) > 0 ? used / toNum(capacity) : 0,
        flag_compliant: flagCompliant,
        account_cluster: accountCluster,
        sku_or_vendor_match: skuOrVendorMatch,
        group_match: groupMatch,
        leftover_cuft: leftover,
        overflow,
      };
      return row;
    });

    sortSuggestionRows(ranked);

    output[item.id] = ranked.slice(0, topN);
  }

  return output;
}

export async function buildSharedLocationSuggestions(
  params: SharedLocationSuggestionsParams,
): Promise<CapacitySuggestionRow[]> {
  const { tenantId, warehouseId, mode, topN = 3 } = params;
  if (mode === 'single') {
    const itemId = params.itemId || null;
    if (!itemId) return [];
    const byItem = await buildPutAwayFallbackSuggestions({
      tenantId,
      warehouseId,
      itemIds: [itemId],
      topN,
    });
    return byItem[itemId] || [];
  }

  const itemIds = uniqueIds(params.itemIds || []);
  if (itemIds.length === 0) return [];

  const [locations, suggestionContext, items, itemFlagsByItemId] = await Promise.all([
    fetchWarehouseLocations(warehouseId),
    fetchWarehouseSuggestionRuleContext({ tenantId, warehouseId }),
    fetchSuggestionItems(tenantId, itemIds),
    fetchItemFlagsByItemId(tenantId, itemIds),
  ]);

  const candidates = locations.filter((location) => normalizeCapacity(location) != null);
  if (candidates.length === 0) return [];

  const locationIds = candidates.map((location) => location.id);
  const [cacheByLoc, aggregatesByLoc, configuredLocationIdsByFlag] = await Promise.all([
    fetchCapacityCacheByLocation(locationIds),
    fetchLocationItemAggregates(tenantId, locationIds),
    fetchFlagConfiguredLocationIdsByService({
      tenantId,
      warehouseId,
      serviceCodes: suggestionContext.requiredSpecialStorageFlags,
    }),
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const referenceItem = itemById.get(itemIds[0]) || items[0];
  if (!referenceItem) return [];

  const requiredVolume = items.reduce((sum, item) => sum + toNum(item.size), 0);

  const requiredFlagUnion = new Set<string>();
  for (const itemId of itemIds) {
    const itemFlags = itemFlagsByItemId.get(itemId);
    if (!itemFlags) continue;
    for (const flag of itemFlags) {
      if (suggestionContext.requiredSpecialStorageFlags.has(flag)) {
        requiredFlagUnion.add(flag);
      }
    }
  }
  const flagResolution = resolveRequiredSpecialFlagsForItem({
    itemFlags: requiredFlagUnion,
    requiredSpecialStorageFlags: suggestionContext.requiredSpecialStorageFlags,
    configuredLocationIdsByFlag,
  });

  const groupCodeByLocId = new Map<string, string | null>();
  for (const location of locations) {
    groupCodeByLocId.set(location.id, location.group_code || null);
  }
  const itemLocId = referenceItem.current_location_id || referenceItem.location_id || null;
  const itemGroupCode = itemLocId ? (groupCodeByLocId.get(itemLocId) || null) : null;

  const allowedCandidates = candidates.filter((location) => {
    if (suggestionContext.excludedLocationIds.has(location.id)) return false;
    return flagResolution.enforcedFlags.every((flag) => {
      const allowedLocs = configuredLocationIdsByFlag.get(flag);
      return !!allowedLocs && allowedLocs.has(location.id);
    });
  });

  const ranked = allowedCandidates.map((location) => {
    const { capacity, used, available } = getUsedAndAvailable(location, cacheByLoc, aggregatesByLoc);
    const aggregate = aggregatesByLoc.get(location.id);
    const flagCompliant = flagResolution.enforcedFlags.every((flag) => {
      const configured = configuredLocationIdsByFlag.get(flag);
      return !!configured && configured.has(location.id);
    });
    const accountCluster =
      !!referenceItem.account_id && !!aggregate && aggregate.accounts.has(referenceItem.account_id);
    const skuOrVendorMatch =
      (!!referenceItem.vendor && !!aggregate && aggregate.vendors.has(referenceItem.vendor))
      || (!!referenceItem.item_code && !!aggregate && aggregate.itemCodes.has(referenceItem.item_code));
    const groupMatch =
      !!itemGroupCode && !!location.group_code && itemGroupCode === location.group_code;
    const leftover = available - requiredVolume;
    const overflow = leftover < -0.00001;
    return {
      location_id: location.id,
      location_code: location.code,
      capacity_cuft: toNum(capacity),
      used_cuft: used,
      available_cuft: available,
      utilization_pct: toNum(capacity) > 0 ? used / toNum(capacity) : 0,
      flag_compliant: flagCompliant,
      account_cluster: accountCluster,
      sku_or_vendor_match: skuOrVendorMatch,
      group_match: groupMatch,
      leftover_cuft: leftover,
      overflow,
    } satisfies CapacitySuggestionRow;
  });

  sortSuggestionRows(ranked);
  return ranked.slice(0, topN);
}

export async function evaluateSpecialStorageCompliance(params: {
  tenantId: string;
  warehouseId: string;
  itemIds: string[];
  destinationLocationId: string;
}): Promise<SpecialStorageComplianceResult> {
  const { tenantId, warehouseId, destinationLocationId } = params;
  const itemIds = uniqueIds(params.itemIds);
  if (!destinationLocationId || itemIds.length === 0) {
    return {
      isCompliant: true,
      requiredFlags: [],
      enforcedFlags: [],
      unresolvedFlags: [],
      missingFlags: [],
    };
  }

  const suggestionContext = await fetchWarehouseSuggestionRuleContext({ tenantId, warehouseId });
  if (suggestionContext.requiredSpecialStorageFlags.size === 0) {
    return {
      isCompliant: true,
      requiredFlags: [],
      enforcedFlags: [],
      unresolvedFlags: [],
      missingFlags: [],
    };
  }

  const itemFlagsByItemId = await fetchItemFlagsByItemId(tenantId, itemIds);
  const requiredFlagUnion = new Set<string>();
  for (const itemId of itemIds) {
    const itemFlags = itemFlagsByItemId.get(itemId);
    if (!itemFlags) continue;
    for (const flag of itemFlags) {
      if (suggestionContext.requiredSpecialStorageFlags.has(flag)) {
        requiredFlagUnion.add(flag);
      }
    }
  }

  const configuredLocationIdsByFlag = await fetchFlagConfiguredLocationIdsByService({
    tenantId,
    warehouseId,
    serviceCodes: requiredFlagUnion,
  });
  const resolution = resolveRequiredSpecialFlagsForItem({
    itemFlags: requiredFlagUnion,
    requiredSpecialStorageFlags: suggestionContext.requiredSpecialStorageFlags,
    configuredLocationIdsByFlag,
  });
  const missingFlags = resolution.enforcedFlags.filter((flag) => {
    const configured = configuredLocationIdsByFlag.get(flag);
    return !(configured && configured.has(destinationLocationId));
  });

  return {
    isCompliant: missingFlags.length === 0,
    requiredFlags: resolution.requiredFlags,
    enforcedFlags: resolution.enforcedFlags,
    unresolvedFlags: resolution.unresolvedFlags,
    missingFlags,
  };
}
