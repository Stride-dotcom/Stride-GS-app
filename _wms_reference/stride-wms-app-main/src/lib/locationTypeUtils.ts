export const DISPLAY_LOCATION_TYPES = [
  'row',
  'bay',
  'shelf',
  'bin',
  'dock',
  'area',
] as const;

export type DisplayLocationType = (typeof DISPLAY_LOCATION_TYPES)[number];

const DISPLAY_LOCATION_TYPE_SET = new Set<string>(DISPLAY_LOCATION_TYPES);

const LEGACY_AREA_TYPES = new Set<string>([
  'storage',
  'zone',
  'release',
  'receiving',
  'staging',
  'quarantine',
  'default',
]);

const DISPLAY_LOCATION_TYPE_LABELS: Record<DisplayLocationType, string> = {
  row: 'Row',
  bay: 'Bay',
  shelf: 'Shelf',
  bin: 'Bin',
  dock: 'Dock',
  area: 'Area',
};

export const DISPLAY_LOCATION_TYPE_BADGE_COLORS: Record<DisplayLocationType, string> = {
  row: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  bay: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  shelf: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  bin: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  dock: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  area: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
};

export function normalizeLocationType(rawType: string | null | undefined): DisplayLocationType {
  const normalized = (rawType || '').trim().toLowerCase();
  // Backward-compatible alias: historically stored/displayed as "aisle".
  if (normalized === 'aisle') {
    return 'row';
  }
  if (DISPLAY_LOCATION_TYPE_SET.has(normalized)) {
    return normalized as DisplayLocationType;
  }
  if (LEGACY_AREA_TYPES.has(normalized)) {
    return 'area';
  }
  return 'area';
}

export function parseDisplayLocationType(rawType: string | null | undefined): DisplayLocationType | null {
  const normalized = (rawType || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  // Accept "aisle" as an import/UI alias for "row".
  if (normalized === 'aisle') {
    return 'row';
  }
  if (DISPLAY_LOCATION_TYPE_SET.has(normalized)) {
    return normalized as DisplayLocationType;
  }
  if (LEGACY_AREA_TYPES.has(normalized)) {
    return 'area';
  }
  return null;
}

export function getLocationTypeLabel(rawType: string | null | undefined): string {
  const normalized = normalizeLocationType(rawType);
  return DISPLAY_LOCATION_TYPE_LABELS[normalized];
}

export function toStoredLocationType(rawType: string | null | undefined): string {
  const normalized = (rawType || '').trim().toLowerCase();
  if (!normalized) {
    return 'storage';
  }
  if (normalized === 'area') {
    return 'storage';
  }
  // Keep stored values consistent going forward.
  if (normalized === 'aisle') {
    return 'row';
  }
  return normalized;
}
