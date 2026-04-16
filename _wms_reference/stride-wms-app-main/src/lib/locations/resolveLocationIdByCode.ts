type LocationLike = {
  id: string;
  code: string | null;
  warehouse_id: string | null;
};

type ResolveLocationIdByCodeParams = {
  locations: LocationLike[];
  code: string;
  warehouseId?: string | null;
};

export function resolveLocationIdByCode({
  locations,
  code,
  warehouseId,
}: ResolveLocationIdByCodeParams): string | null {
  const normalizedCode = code.trim().toLowerCase();
  if (!normalizedCode) return null;

  const scopedLocations = warehouseId
    ? locations.filter((location) => location.warehouse_id === warehouseId)
    : locations;

  const match = scopedLocations.find(
    (location) => (location.code || "").trim().toLowerCase() === normalizedCode
  );

  return match?.id ?? null;
}
