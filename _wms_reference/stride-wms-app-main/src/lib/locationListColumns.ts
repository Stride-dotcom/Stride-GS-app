export type LocationListColumnKey =
  | 'code'
  | 'name'
  | 'type'
  | 'zone_code'
  | 'warehouse'
  | 'capacity'
  | 'status'
  | 'sq_ft'
  | 'cu_ft';

export interface LocationListColumn {
  key: LocationListColumnKey;
  label: string;
  tableHeadClassName?: string;
  templateExample: string | number;
}

export const LOCATION_LIST_COLUMNS: LocationListColumn[] = [
  { key: 'code', label: 'Code', templateExample: 'A1.1' },
  { key: 'name', label: 'Name', templateExample: 'Row 1 Bay 1' },
  { key: 'type', label: 'Type', templateExample: 'bin' },
  { key: 'zone_code', label: 'Zone Code', templateExample: 'ZN-001' },
  { key: 'warehouse', label: 'Warehouse', templateExample: 'STRIDE LOGISTICS' },
  { key: 'capacity', label: 'Capacity', templateExample: 120 },
  { key: 'status', label: 'Status', templateExample: 'active' },
  { key: 'sq_ft', label: 'Sq Ft', tableHeadClassName: 'text-right', templateExample: 20 },
  { key: 'cu_ft', label: 'Cu Ft', tableHeadClassName: 'text-right', templateExample: 120 },
];
