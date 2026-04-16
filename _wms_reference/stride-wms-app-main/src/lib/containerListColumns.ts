export type ContainerListColumnKey =
  | 'container_code'
  | 'container_type'
  | 'status'
  | 'warehouse'
  | 'location'
  | 'footprint_cu_ft';

export interface ContainerListColumn {
  key: ContainerListColumnKey;
  label: string;
  tableHeadClassName?: string;
  tableCellClassName?: string;
  templateExample: string | number;
  xlsxWidth?: number;
}

export const CONTAINER_LIST_COLUMNS: ContainerListColumn[] = [
  {
    key: 'container_code',
    label: 'Code',
    templateExample: 'CNT-00001',
    xlsxWidth: 18,
  },
  {
    key: 'container_type',
    label: 'Type',
    templateExample: 'Carton',
    xlsxWidth: 16,
  },
  {
    key: 'status',
    label: 'Status',
    templateExample: 'active',
    xlsxWidth: 12,
  },
  {
    key: 'warehouse',
    label: 'Warehouse',
    tableHeadClassName: 'hidden md:table-cell',
    tableCellClassName: 'hidden md:table-cell',
    templateExample: 'STRIDE LOGISTICS',
    xlsxWidth: 24,
  },
  {
    key: 'location',
    label: 'Location',
    templateExample: 'A1.1',
    xlsxWidth: 16,
  },
  {
    key: 'footprint_cu_ft',
    label: 'Footprint (cu ft)',
    tableHeadClassName: 'text-right',
    tableCellClassName: 'text-right tabular-nums',
    templateExample: 12.5,
    xlsxWidth: 18,
  },
];
