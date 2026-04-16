// Custom Report Builder Types

export type DataSourceId =
  | 'items'
  | 'billing_events'
  | 'tasks'
  | 'shipments'
  | 'claims'
  | 'invoices'
  | 'job_time_intervals'
  | 'service_time_jobs';

export type ColumnFormat = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'badge';

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'in'
  | 'between'
  | 'is_null'
  | 'is_not_null';

export type AggregationType = 'sum' | 'count' | 'avg' | 'min' | 'max';

export type ChartType = 'bar' | 'pie' | 'line';

export type SortDirection = 'asc' | 'desc';

export interface ColumnDefinition {
  id: string;
  label: string;
  dbColumn: string;
  format: ColumnFormat;
  sortable: boolean;
  filterable: boolean;
  aggregatable: boolean;
  joinTable?: string;
  joinColumn?: string;
  width?: number;
  badgeConfig?: Record<string, { label: string; variant: string }>;
}

export interface ColumnSelection {
  id: string;
  label: string;
  visible: boolean;
  format: ColumnFormat;
  width?: number;
}

export interface FilterDefinition {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string | string[] | number | number[] | boolean | null;
}

export interface SortDefinition {
  column: string;
  direction: SortDirection;
}

export interface SummaryDefinition {
  id: string;
  column: string;
  aggregation: AggregationType;
  label: string;
}

export interface ChartConfig {
  type: ChartType;
  /** @deprecated Prefer groupBy/valueColumn/aggregation */
  xAxis?: string;
  /** @deprecated Prefer groupBy/valueColumn/aggregation */
  yAxis?: string;
  groupBy?: string;
  /** Aggregation for the metric (defaults to count) */
  aggregation?: AggregationType;
  /** Column id to aggregate (not needed for count) */
  valueColumn?: string;
  /** Limit displayed groups (defaults to 12) */
  maxGroups?: number;
}

export interface ReportConfig {
  columns: ColumnSelection[];
  filters: FilterDefinition[];
  orderBy: SortDefinition[];
  groupBy?: string;
  summaries: SummaryDefinition[];
  chartConfig?: ChartConfig;
  limit?: number;
}

export interface CustomReport {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  data_source: DataSourceId;
  config: ReportConfig;
  is_shared: boolean;
  is_template: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ReportExecution {
  id: string;
  tenant_id: string;
  report_id: string | null;
  report_name: string;
  data_source: DataSourceId;
  filters_applied: FilterDefinition[] | null;
  row_count: number | null;
  execution_time_ms: number | null;
  executed_by: string | null;
  executed_at: string;
}

export interface DataSource {
  id: DataSourceId;
  label: string;
  description: string;
  tableName: string;
  /** Most tenant-scoped tables use soft-delete via deleted_at */
  hasDeletedAt?: boolean;
  columns: ColumnDefinition[];
  defaultFilters?: FilterDefinition[];
  defaultSort?: SortDefinition[];
}

export interface ReportData {
  rows: Record<string, unknown>[];
  totalCount: number;
  summaries: Record<string, number>;
  executionTime: number;
}

// Helper to get operator options based on format
export const OPERATOR_OPTIONS: Record<ColumnFormat, { value: FilterOperator; label: string }[]> = {
  text: [
    { value: 'eq', label: 'Equals' },
    { value: 'ne', label: 'Not Equal' },
    { value: 'contains', label: 'Contains' },
    { value: 'in', label: 'In List' },
    { value: 'is_null', label: 'Is Empty' },
    { value: 'is_not_null', label: 'Is Not Empty' },
  ],
  number: [
    { value: 'eq', label: 'Equals' },
    { value: 'ne', label: 'Not Equal' },
    { value: 'gt', label: 'Greater Than' },
    { value: 'gte', label: 'Greater or Equal' },
    { value: 'lt', label: 'Less Than' },
    { value: 'lte', label: 'Less or Equal' },
    { value: 'between', label: 'Between' },
    { value: 'is_null', label: 'Is Empty' },
  ],
  currency: [
    { value: 'eq', label: 'Equals' },
    { value: 'ne', label: 'Not Equal' },
    { value: 'gt', label: 'Greater Than' },
    { value: 'gte', label: 'Greater or Equal' },
    { value: 'lt', label: 'Less Than' },
    { value: 'lte', label: 'Less or Equal' },
    { value: 'between', label: 'Between' },
  ],
  date: [
    { value: 'eq', label: 'On' },
    { value: 'ne', label: 'Not On' },
    { value: 'gt', label: 'After' },
    { value: 'gte', label: 'On or After' },
    { value: 'lt', label: 'Before' },
    { value: 'lte', label: 'On or Before' },
    { value: 'between', label: 'Between' },
    { value: 'is_null', label: 'Is Empty' },
  ],
  datetime: [
    { value: 'eq', label: 'On' },
    { value: 'gt', label: 'After' },
    { value: 'gte', label: 'On or After' },
    { value: 'lt', label: 'Before' },
    { value: 'lte', label: 'On or Before' },
    { value: 'between', label: 'Between' },
    { value: 'is_null', label: 'Is Empty' },
  ],
  boolean: [
    { value: 'eq', label: 'Is' },
  ],
  badge: [
    { value: 'eq', label: 'Equals' },
    { value: 'ne', label: 'Not Equal' },
    { value: 'in', label: 'In List' },
  ],
};

// Aggregation options
export const AGGREGATION_OPTIONS: { value: AggregationType; label: string }[] = [
  { value: 'sum', label: 'Sum' },
  { value: 'count', label: 'Count' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
];
